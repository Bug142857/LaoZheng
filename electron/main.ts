import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  powerSaveBlocker,
  session,
  shell,
  Tray
} from 'electron'
import { join } from 'node:path'
import { appendFileSync, existsSync } from 'node:fs'

import { dataFilePath } from './store'
import { initSettings } from './settings'
import { cleanupUpdatesDir } from './cacheManager'

import { loadWindowState, saveWindowState, type WindowState } from './windowState'
import { scheduleIdleAccountChecks } from './idleTasks'
import { seedDefaultData, syncSeedExtras } from './seed'
import { ensureDailySnapshot } from './snapshots'

import { initDoubanAuth } from './doubanAuth'

import { initLiveAuth } from './livePlatform/auth'
import { BILI_UA, DOUYU_UA, DOUYIN_UA } from './livePlatform/common'
import { bilibiliMediaAuth } from './singing'

import { startMediaServer } from './downloads'

import { melonImageAuth } from './melon'

import { noteShuangkanMediaRedirect, shuangkanImageAuth, shuangkanMediaAuth } from './shuangkan'

import { initAccounts } from './accounts'

import { komiicImageAuth } from './komiic'

import {
  registerImageCacheScheme,
  setupImageCacheHandler,
  setupImageRequestRedirect
} from './imageCache'

import { IMAGE_REFERER, IMAGE_UA, VOD_UA, KOMIIC_UA, BIKA_UA } from './userAgents'
import { flushProgressSync, progress } from './progress'
import { autoUpdateCheck } from './updateManager'
import { registerIpc } from './ipc'

const isDev = !app.isPackaged

// 图片缓存用的自定义协议必须在 app ready 之前注册
registerImageCacheScheme()

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
/** 有媒体在播放时阻止系统休眠 / 关屏；播放暂停后释放 */
const playingWebContents = new Set<number>()
let mediaPowerBlockerId: number | null = null

function updateMediaPowerBlocker(): void {
  if (playingWebContents.size && mediaPowerBlockerId === null) {
    mediaPowerBlockerId = powerSaveBlocker.start('prevent-display-sleep')
  } else if (!playingWebContents.size && mediaPowerBlockerId !== null) {
    powerSaveBlocker.stop(mediaPowerBlockerId)
    mediaPowerBlockerId = null
  }
}
/** 通过托盘菜单 / 系统退出时为 true，允许真正关闭窗口 */
let quitting = false
let trayTipShown = false

function trayIconPath(): string | null {
  const candidates = [
    join(process.resourcesPath, 'tray.png'),
    join(app.getAppPath(), 'resources', 'tray.png'),
    join(__dirname, '../../resources/tray.png')
  ]
  return candidates.find((file) => existsSync(file)) ?? null
}

function showMainWindow(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 关闭按钮改为隐藏到右下角托盘，保证下载 / 播放不被误关；托盘菜单里可真正退出 */
function ensureTray(): void {
  if (tray || !mainWindow) return
  const iconPath = trayIconPath()
  // 找不到图标时宁可不做托盘，否则窗口隐藏后没有入口可以恢复
  if (!iconPath) return
  const image = nativeImage.createFromPath(iconPath)
  tray = new Tray(image.resize({ width: 16, height: 16 }))
  tray.setToolTip('老郑分享')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主界面', click: () => showMainWindow() },
      { label: '隐藏到托盘', click: () => mainWindow?.hide() },
      { type: 'separator' },
      {
        label: '退出老郑分享',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
}

function hideToTray(): void {
  const win = mainWindow
  if (!win) return
  win.hide()
  if (!trayTipShown && tray) {
    trayTipShown = true
    tray.displayBalloon({
      title: '老郑分享',
      content: '已最小化到右下角托盘，点击托盘图标可以重新打开。',
      icon: trayIconPath() ?? undefined
    })
  }
}

function windowStateFile(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/** 启动时读取到的窗口位置 / 最大化状态；createWindow 同步使用 */
let startupWindowState: WindowState = {}

function createWindow(): BrowserWindow {
  const iconPath = trayIconPath()
  const restored = startupWindowState.bounds
  const win = new BrowserWindow({
    ...(restored
      ? { x: restored.x, y: restored.y, width: restored.width, height: restored.height }
      : { width: 1280, height: 820 }),
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#141318',
    title: '老郑分享',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 应用内阅读 PDF 需要 Chromium 内置 PDF 查看器
      plugins: true
    }
  })

  if (startupWindowState.maximized) win.maximize()

  // 视频 / 音频播放期间阻止系统进入睡眠或关闭显示器（长视频、演唱会常用）
  const mediaId = win.webContents.id
  win.webContents.on('media-started-playing', () => {
    playingWebContents.add(mediaId)
    updateMediaPowerBlocker()
  })
  win.webContents.on('media-paused', () => {
    playingWebContents.delete(mediaId)
    updateMediaPowerBlocker()
  })
  win.webContents.on('destroyed', () => {
    playingWebContents.delete(mediaId)
    updateMediaPowerBlocker()
  })

  // 窗口尺寸 / 位置：变化防抖保存，关闭时立即保存；最大化状态单独记录
  let boundsTimer: NodeJS.Timeout | null = null
  const saveBounds = (): void => {
    if (boundsTimer) {
      clearTimeout(boundsTimer)
      boundsTimer = null
    }
    if (win.isDestroyed()) return
    const maximized = win.isMaximized()
    const bounds =
      maximized || win.isFullScreen() ? win.getNormalBounds() : win.getBounds()
    void saveWindowState(windowStateFile(), { bounds, maximized }).catch((err) =>
      console.error('[window] 保存窗口位置失败', err)
    )
    startupWindowState = { bounds, maximized }
  }
  const scheduleBoundsSave = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(saveBounds, 600)
    boundsTimer.unref?.()
  }
  win.on('resize', scheduleBoundsSave)
  win.on('move', scheduleBoundsSave)
  win.on('maximize', scheduleBoundsSave)
  win.on('unmaximize', scheduleBoundsSave)
  win.on('close', saveBounds)

  const devUrl = process.env['ELECTRON_RENDERER_URL']

  win.once('ready-to-show', () => {
    win.show()
    ensureTray()
  })

  // 点窗口的 × 只是隐藏到右下角托盘，不中断下载 / 播放；托盘菜单可真正退出
  win.on('close', (event) => {
    if (quitting || !tray) return
    event.preventDefault()
    hideToTray()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // 外部链接一律交给系统浏览器，避免在应用内打开不可控页面
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 防止内容里的普通链接把主窗口导航走：远程页面会继承 preload，绝不能让它替换应用页面
  win.webContents.on('will-navigate', (event, target) => {
    const devOrigin = isDev && devUrl ? new URL(devUrl).origin : ''
    const allowed = target.startsWith('file://') || (devOrigin && target.startsWith(devOrigin))
    if (allowed) return
    event.preventDefault()
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target)
  })

  if (isDev && devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  mainWindow = win
  return win
}

function setResponseHeader(headers: Record<string, string[]>, name: string, value: string): void {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase()) ?? name
  headers[key] = [value]
}

/** 按域名补 Referer / UA / Cookie：渲染进程请求与主进程取图（图片缓存）共用同一套规则 */
function applyRequestHeaders(
  rawUrl: string,
  resourceType: string,
  headers: Record<string, string>
): void {
  let host = ''
  try {
    host = new URL(rawUrl).hostname
  } catch {
    // 忽略非法 URL
  }
  let melonAuth: { referer: string; ua: string } | null = null
  if (resourceType === 'image') {
    try {
      melonAuth = melonImageAuth(new URL(rawUrl))
    } catch {
      melonAuth = null
    }
  }
  let skAuth: { referer: string; ua: string } | null = null
  try {
    skAuth = shuangkanImageAuth(new URL(rawUrl))
  } catch {
    skAuth = null
  }
  // 爽看站点自己签发的播放流（jmpres 等）：不带站点 Cookie / Referer 时镜像只回几秒提示片。
  // 只对媒体类请求生效，避免抢走同域名封面图需要 Referer 的规则
  let skMedia: { referer?: string; cookie?: string; ua?: string } | null = null
  if (resourceType !== 'image') {
    try {
      skMedia = shuangkanMediaAuth(new URL(rawUrl))
    } catch {
      skMedia = null
    }
  }
  // 演唱模块播放的 B站视频直链：CDN 域名由主进程解析时登记，这里只补来源页
  let biliMedia: { referer: string; ua: string } | null = null
  if (resourceType !== 'image') {
    try {
      biliMedia = bilibiliMediaAuth(new URL(rawUrl))
    } catch {
      biliMedia = null
    }
  }
  if (/(^|\.)doubanio\.com$|(^|\.)douban\.com$/.test(host)) {
    headers['Referer'] = IMAGE_REFERER
    headers['User-Agent'] = IMAGE_UA
  } else if (/(^|\.)twimg\.com$/.test(host)) {
    // X站视频在 video.twimg.com，部分节点要求来源页，否则 403
    headers['Referer'] = 'https://x.com/'
    headers['User-Agent'] = VOD_UA
  } else if (/(^|\.)phncdn\.com$|(^|\.)pornhub\.com$/.test(host)) {
    // P站 CDN / 站点对部分节点校验来源页与年龄 Cookie，补 Referer + 移动 UA
    headers['Referer'] = 'https://www.pornhub.com/'
    headers['User-Agent'] = VOD_UA
    headers['Cookie'] = 'accessAgeDisclaimerPH=1; age_verified=1; accessPH=1'
  } else if (skMedia) {
    // 肉视频探测登记的是「只带 UA」的鉴权，其它站点带完整 Cookie / Referer
    if (skMedia.referer) headers['Referer'] = skMedia.referer
    if (skMedia.cookie) headers['Cookie'] = skMedia.cookie
    if (skMedia.ua) headers['User-Agent'] = skMedia.ua
    // 网关会把播放清单伪装成 index.png，Chromium 会按图片给 Accept 头，
    // 部分节点据此回 206 分段内容，hls.js 解析不出来（实测过），这里按普通资源取
    if (/\.png(\?|$)/i.test(rawUrl)) headers['Accept'] = '*/*'
  } else if (/(^|\.)komiic\.(com|cc)$/.test(host)) {
    // Komiic 章节图：注入登录 Cookie + 完整路径 Referer（防盗链），缺口归属在查询参数里
    try {
      const auth = komiicImageAuth(new URL(rawUrl))
      if (auth) {
        headers['Cookie'] = auth.cookie
        headers['Referer'] = auth.referer
        headers['User-Agent'] = KOMIIC_UA
      } else if (/(^|\.)public\.komiic\.(com|cc)$/.test(host)) {
        // 封面图床部分节点校验来源页 / 浏览器 UA，缺了会 403
        headers['Referer'] = 'https://komiic.com/'
        headers['User-Agent'] = KOMIIC_UA
      }
    } catch {
      // 非法 URL 交给默认处理
    }
  } else if (/(^|\.)picacomic\.com$|(^|\.)go2778\.com$/.test(host)) {
    // 哔咔图床只校验 UA（不需要 token）
    headers['User-Agent'] = BIKA_UA
    headers['Referer'] = 'https://picaapi.picacomic.com/'
  } else if (melonAuth) {
    // 吃瓜镜像的图床有防盗链：补镜像 Referer + 站点同款移动 UA
    headers['Referer'] = melonAuth.referer
    headers['User-Agent'] = melonAuth.ua
  } else if (skAuth) {
    // 爽看封面 CDN 校验站点 Referer 与浏览器 UA，缺了会 403
    headers['Referer'] = skAuth.referer
    headers['User-Agent'] = skAuth.ua
  } else if (/(^|\.)(mayiwsk\.info|biquges\.com)$/.test(host)) {
    // 小说封面 / 站内图片：补站点 Referer，避免部分节点防盗链
    headers['Referer'] = 'http://www.mayiwsk.info/'
    headers['User-Agent'] = VOD_UA
  } else if (/(^|\.)(95dushu\.info|jwdushu\.com)$/.test(host)) {
    headers['Referer'] = 'http://www.95dushu.info/'
    headers['User-Agent'] = VOD_UA
  } else if (/(^|\.)(xuanhuange\.info|xuanhuange\.net|xuanhuange\.com)$/.test(host)) {
    headers['Referer'] = 'http://www.xuanhuange.info/'
    headers['User-Agent'] = VOD_UA
  } else if (/(^|\.)(ecombdimg\.com|shimolife\.com)$/.test(host)) {
    // 漫画客封面 / 章节图：图床按来源页做防盗链
    headers['Referer'] = 'http://www.yumanhua.com/'
    headers['User-Agent'] = VOD_UA
  } else if (/(^|\.)haowallpaper\.com$/.test(host)) {
    headers['Referer'] = 'https://haowallpaper.com/'
  } else if (/(^|\.)wallspic\.com$/.test(host)) {
    headers['Referer'] = 'https://wallspic.com/'
  } else if (/(^|\.)bzee\.cn$/.test(host)) {
    // 壁纸迷图床（xz / imgtu 等子域）按来源页做防盗链
    headers['Referer'] = 'https://www.bizhimi.cn/'
  } else if (biliMedia) {
    headers['Referer'] = biliMedia.referer
    headers['User-Agent'] = biliMedia.ua
  } else if (/(^|\.)(hdslb\.com|bilivideo\.com|bilivideo\.cn|acgvideo\.com)$/.test(host)) {
    // B站直播封面 / 直播流分片：CDN 校验来源页
    headers['Referer'] = 'https://live.bilibili.com/'
    headers['User-Agent'] = BILI_UA
  } else if (/(^|\.)(douyucdn\.cn|douyucdn2\.cn|edgesrv\.com)$/.test(host)) {
    // 斗鱼直播流：CDN 校验来源页
    headers['Referer'] = 'https://www.douyu.com/'
    headers['User-Agent'] = DOUYU_UA
  } else if (
    /(^|\.)(douyincdn\.com|douyinvod\.com|douyinpic\.com|douyinstatic\.com|ibytedtos\.com|zjcdn\.com|byteimg\.com|bytefcdnrd\.com|bytefcdn\.com)$/.test(
      host
    )
  ) {
    // 抖音直播流 / 封面：按直播间来源页取流
    headers['Referer'] = 'https://live.douyin.com/'
    headers['User-Agent'] = DOUYIN_UA
  } else if (
    resourceType === 'media' ||
    (resourceType === 'xhr' && /\.(m3u8|ts|key|mp4|flv)(\?|$)/i.test(rawUrl))
  ) {
    headers['User-Agent'] = VOD_UA
  }
}

/**
 * 请求层规则：
 * 1) 封面图补 Referer / 移动 UA，并重定向到图片磁盘缓存；
 * 2) 播放请求（media / m3u8 分片）统一 UA，并注入 CORS 头，避免渲染进程被跨域拦截。
 */
function setupRequestRules(): void {
  const ses = session.defaultSession

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders
    applyRequestHeaders(details.url, details.resourceType, headers)
    callback({ requestHeaders: headers })
  })

  // v0.122：站点主域的播放请求重定向到 CDN 网关（jre*.vc*.top 等）时，
  // 把网关域名也继承同一份鉴权——实测 CDN 对 master / variant / 分片 / key
  // 每个请求都做鉴权检查，漏了就只回几秒提示片
  ses.webRequest.onBeforeRedirect((details) => {
    if (!details.redirectURL) return
    try {
      noteShuangkanMediaRedirect(details.url, details.redirectURL)
    } catch {
      // 忽略非法 URL
    }
  })

  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders
    if (!headers) {
      callback({})
      return
    }
    if (details.resourceType === 'xhr' || details.resourceType === 'media') {
      setResponseHeader(headers, 'Access-Control-Allow-Origin', '*')
      setResponseHeader(headers, 'Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS')
      setResponseHeader(headers, 'Access-Control-Allow-Headers', '*')
      setResponseHeader(headers, 'Access-Control-Expose-Headers', 'Content-Length,Content-Range,Content-Type')
    }
    callback({ responseHeaders: headers })
  })

  // 所有图片请求改走 lzimg:// 磁盘缓存（同时完成旧图床域名重写）
  setupImageRequestRedirect(ses)
}

const gotLock = app.requestSingleInstanceLock()
process.on('unhandledRejection', (reason) => {
  // 主进程后台任务（登录 / 更新 / 缓存刷新）的兜底日志，避免静默失败
  console.error('[app] 未处理的 Promise rejection', reason)
})

process.on('uncaughtException', (err) => {
  // 同步代码未捕获异常：落崩溃日志并提示用户，避免窗口毫无征兆地消失
  console.error('[app] 未捕获异常，准备退出', err)
  try {
    const log = join(app.getPath('userData'), 'crash.log')
    appendFileSync(log, `[${new Date().toISOString()}] ${err?.stack ?? String(err)}\n`, 'utf8')
  } catch {
    // 崩溃日志写入失败不影响后续提示
  }
  try {
    dialog.showErrorBox(
      '老郑分享遇到错误',
      `程序遇到未处理的错误，需要重启。\n\n${err?.message ?? String(err)}`
    )
  } catch {
    // 提示失败也继续退出
  }
  app.quit()
})

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  // 系统关机 / 安装更新等真正退出时，允许窗口关闭
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('will-quit', () => {
    // 播放进度独立存储：真正退出前同步落盘，避免最后一次进度丢失
    flushProgressSync()
    if (mediaPowerBlockerId !== null) {
      powerSaveBlocker.stop(mediaPowerBlockerId)
      mediaPowerBlockerId = null
    }
    tray?.destroy()
    tray = null
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.laozheng.pc')
    Menu.setApplicationMenu(null)
    // 本机设置 / 默认数据 / 本地媒体服务失败都不能阻止主窗口打开
    try {
      await initSettings()
    } catch (err) {
      console.error('[app] 初始化本机设置失败，继续使用默认设置', err)
    }
    try {
      await seedDefaultData()
    } catch (err) {
      console.error('[app] 播种默认数据失败，跳过', err)
    }
    await initAccounts()
    await initLiveAuth()
    await initDoubanAuth()
    setupRequestRules()
    setupImageCacheHandler((url) => {
      // 兜底 UA 必须带上：部分图床（如 chaoxing）对没有 UA 的请求直接 403 / 404
      const headers: Record<string, string> = {
        Accept: 'image/*,*/*;q=0.8',
        'User-Agent': VOD_UA
      }
      applyRequestHeaders(url, 'image', headers)
      return headers
    })
    registerIpc()
    try {
      await startMediaServer()
    } catch (err) {
      console.error('[app] 本地媒体服务启动失败，已下载文件将无法在应用内播放', err)
    }
    try {
      startupWindowState = await loadWindowState(windowStateFile())
    } catch (err) {
      console.error('[app] 读取窗口位置失败，使用默认尺寸', err)
    }
    const win = createWindow()
    console.log('[app] data file:', dataFilePath())

    // 启动后检查更新：发现新版本先弹窗确认，确认后才下载
    win.webContents.once('did-finish-load', () => {
      void cleanupUpdatesDir().then(() => autoUpdateCheck(win))
      // 种子大文件解析（软件经验 / 演唱默认视频）与每日快照放到首屏之后，
      // 避免 1.2MB JSON 解析和写盘与开窗抢时间；失败只记日志，下次启动再补。
      setTimeout(() => {
        void syncSeedExtras()
          .then((changed) => {
            // 新版首次启动：种子里的标题 / 使用经验在开窗后才合并，
            // 通知渲染层重新读一次数据，避免用户以为「更新后没变化」
            if (changed && !win.isDestroyed()) win.webContents.send('data:seedSynced')
          })
          .catch((err) => console.error('[seed] 空闲同步种子附加数据失败', err))
          .finally(() => {
            void ensureDailySnapshot(
              app.getPath('userData'),
              dataFilePath(),
              progress().peek()
            )
          })
      }, 1200)
    })

    // 内置账号静默登录改为空闲延迟执行：不阻塞启动；离线时直接跳过，
    // 避免反复创建隐藏窗口和等待超时。用户进入对应模块时仍会自动登录。
    scheduleIdleAccountChecks()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      ensureTray()
      showMainWindow()
    })
  }).catch((err) => {
    // 走到这里说明主窗口都没创建成功：给出明确提示，避免用户以为双击没反应
    console.error('[app] 启动失败', err)
    dialog.showErrorBox(
      '老郑分享启动失败',
      err instanceof Error ? err.message : String(err || '未知错误')
    )
    app.quit()
  })

  app.on('window-all-closed', () => {
    // 有托盘时窗口只是隐藏 / 被销毁也不退出，必须从托盘菜单选「退出」
    if (process.platform !== 'darwin' && !tray) app.quit()
  })
}
