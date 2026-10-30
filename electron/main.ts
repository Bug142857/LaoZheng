import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  Tray
} from 'electron'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  dataFilePath,
  exportToFile,
  importFromFile,
  loadData,
  saveData,
  saveDataSync
} from './store'
import {
  initSettings,
  downloadRoot,
  lastImageDir,
  setLastImageDir,
  setUiSettings,
  uiSettings,
  settingsSnapshot,
  applySettingsSnapshot
} from './settings'
import { seedDefaultData } from './seed'
import {
  fetchPersonFull,
  fetchSubjectComments,
  fetchSubjectCredits,
  fetchSubjectDetail,
  fetchSubjectFull,
  searchSubjects
} from './douban'
import { doubanAuthStatus, initDoubanAuth, logoutDouban, openDoubanLogin } from './doubanAuth'
import {
  fetchVodCategories,
  fetchVodDetail,
  listVodSource,
  searchVodSource,
  testVodSource
} from './vod'
import {
  loadLiveChannels,
  loadLiveSources,
  makeLocalSource,
  normalizeLiveSources,
  saveLiveSources,
  testLiveSource
} from './live'
import { resolveMusic, resolveLegacyMusic, searchMusic } from './music'
import {
  addComicBatchDownload,
  addDownload,
  cancelTask,
  changeDownloadRoot,
  exportDownloadRecords,
  hasRunningDownloads,
  importDownloadRecords,
  listDownloads,
  openDownloadItem,
  openDownloadsDir,
  playDownloadItem,
  readDownloadItem,
  removeDownload,
  startMediaServer
} from './downloads'
import type { ComicBatchDownloadInput, DownloadAddInput } from '../src/shared/downloads'
import { xCategories, xDetail, xList } from './xsite'
import { pCategoryCount, pList, pResolve } from './psite'
import {
  melonCategoryCounts,
  melonDetail,
  melonFetchImage,
  melonImageAuth,
  melonList,
  melonVideoDuration,
  trackMelonImages
} from './melon'
import { initAccounts, listAccounts } from './accounts'
import {
  bikaCategories,
  bikaCategoryCounts,
  bikaChapters,
  bikaDetail,
  bikaEnsureLogin,
  bikaImages,
  bikaList,
  bikaSearch
} from './bika'
import {
  komiicByCategory,
  komiicCategories,
  komiicChapters,
  komiicDetail,
  komiicEnsureLogin,
  komiicHot,
  komiicImageAuth,
  komiicImages,
  komiicRecent,
  komiicSearch
} from './komiic'
import {
  openWygamerLogin,
  wygamerByCategory,
  wygamerCategories,
  wygamerDetail,
  wygamerEnsureLogin,
  wygamerHome,
  wygamerResolveDownload,
  wygamerSearch
} from './wygamer'
import {
  autoZlibLogin,
  openZlibLogin,
  zlibDetail,
  zlibDownloadBook,
  zlibLogout,
  zlibSaveCredentials,
  zlibSearch,
  zlibStatus
} from './zlib'
import type { AccountActionResult, AccountSite } from '../src/shared/accounts'
import { downloadSync, getSyncConfig, saveSyncConfig, testSync, uploadSync } from './sync'
import { cachedResponse, clearApiCacheMemory } from './apiCache'
import {
  registerImageCacheScheme,
  setupImageCacheHandler,
  setupImageRequestRedirect
} from './imageCache'
import type { SyncConfigInput } from '../src/shared/sync'
import { compareVersions } from '../src/shared/update'
import type { UpdateCheckResult, UpdateDownloadResult, UpdateProgress } from '../src/shared/update'
import type { LiveSource } from '../src/shared/live'
import { normalizeData, type AppData } from '../src/shared/types'
import type { SearchCategory, SubjectKind } from '../src/shared/douban'
import type { VodSourceInput } from '../src/shared/vod'
import type { CacheClearResult, CacheInfo, UiSettings } from '../src/shared/settings'

const isDev = !app.isPackaged

// 图片缓存用的自定义协议必须在 app ready 之前注册
registerImageCacheScheme()

/** electron-builder 要求三段式版本，对外显示与安装包名去掉末尾的 .0（0.5.0 → 0.5） */
function displayVersion(): string {
  return app.getVersion().replace(/\.0$/, '')
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
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

function createWindow(): BrowserWindow {
  const iconPath = trayIconPath()
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
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

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  mainWindow = win
  return win
}

const IMAGE_REFERER = 'https://m.douban.com/'
const IMAGE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
const VOD_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
const KOMIIC_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const BIKA_UA = 'okhttp/3.8.1'
/** 公开更新清单：私有仓库的 Releases 匿名 API 不可见，这里只公开版本号与发布页地址 */
const UPDATE_MANIFEST_URL =
  'https://gist.githubusercontent.com/Bug142857/802551160083623580189fc536724d65/raw/update.json'

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
  } else if (/(^|\.)komiic\.(com|cc)$/.test(host)) {
    // Komiic 章节图：注入登录 Cookie + 完整路径 Referer（防盗链），缺口归属在查询参数里
    try {
      const auth = komiicImageAuth(new URL(rawUrl))
      if (auth) {
        headers['Cookie'] = auth.cookie
        headers['Referer'] = auth.referer
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

function isLiveSource(value: unknown): value is LiveSource {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.url === 'string' &&
    (o.url.startsWith('http') || o.url.startsWith('local://')) &&
    typeof o.content === 'string'
  )
}

function isVodSourceInput(value: unknown): value is VodSourceInput {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.baseUrl === 'string' &&
    /^https?:\/\//i.test(o.baseUrl) &&
    o.baseUrl.length <= 300
  )
}

const SEARCH_CATEGORIES = new Set<SearchCategory>(['video', 'book', 'game', 'person'])
const SUBJECT_KINDS = new Set<SubjectKind>(['movie', 'tv', 'book', 'game'])

/** 检查更新：公开仓库优先走 GitHub API（能拿到 exe 资产直链），失败再读公开清单 */
async function checkUpdateInternal(): Promise<UpdateCheckResult> {
  const current = displayVersion()
  const api = await checkViaGithubApi(current)
  if (api) return api
  const manifest = await checkViaManifest(current)
  if (manifest) return manifest
  return { ok: false, current, error: '检查更新失败（网络不可用）' }
}

interface GithubAsset {
  name?: string
  size?: number
  browser_download_url?: string
}

/** GitHub Releases API（仓库公开后匿名可用，能直接拿到安装包地址） */
async function checkViaGithubApi(current: string): Promise<UpdateCheckResult | null> {
  try {
    const res = await fetch('https://api.github.com/repos/Bug142857/LaoZheng/releases/latest', {
      headers: { 'User-Agent': 'laozheng-pc', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      tag_name?: string
      html_url?: string
      body?: string
      assets?: GithubAsset[]
    }
    const tag = (json.tag_name ?? '').trim()
    if (!tag) return null
    const latest = tag.replace(/^v/i, '')
    const assets = Array.isArray(json.assets) ? json.assets : []
    const exe = assets.find(
      (a) =>
        typeof a.browser_download_url === 'string' &&
        /\.exe$/i.test(a.name ?? '') &&
        !/\.blockmap$/i.test(a.name ?? '')
    )
    return {
      ok: true,
      current,
      latest,
      hasUpdate: compareVersions(latest, current) > 0,
      url: json.html_url,
      downloadUrl: exe?.browser_download_url,
      notes: (json.body ?? '').slice(0, 2000)
    }
  } catch {
    return null
  }
}

/** 公开清单兜底（GitHub API 被墙 / 限流时） */
async function checkViaManifest(current: string): Promise<UpdateCheckResult | null> {
  try {
    const res = await fetch(UPDATE_MANIFEST_URL, {
      headers: { 'User-Agent': 'laozheng-pc', Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      version?: string
      url?: string
      exe?: string
      downloadUrl?: string
      notes?: string
    }
    const latest = (json.version ?? '').trim().replace(/^v/i, '')
    if (!latest) return null
    const exe = (json.exe ?? json.downloadUrl ?? '').trim()
    return {
      ok: true,
      current,
      latest,
      hasUpdate: compareVersions(latest, current) > 0,
      url: typeof json.url === 'string' ? json.url : undefined,
      downloadUrl: /^https:\/\//i.test(exe) ? exe : undefined,
      notes: (json.notes ?? '').slice(0, 2000)
    }
  } catch {
    return null
  }
}

function updatesDir(): string {
  return join(app.getPath('userData'), 'updates')
}

/** 启动时清掉上一次下载的安装包，避免 updates 目录越积越多 */
async function cleanupUpdatesDir(): Promise<void> {
  const dir = updatesDir()
  try {
    for (const name of await readdir(dir)) {
      await rm(join(dir, name), { recursive: true, force: true }).catch(() => undefined)
    }
  } catch {
    // 目录不存在时无需处理
  }
}

/** Electron 网络 / 图片 / 代码缓存目录（不动 Local Storage，避免清掉网页登录态） */
const CACHE_DIR_NAMES = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'blob_storage',
  'image-cache',
  'api-cache'
]

async function dirSize(dir: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) total += await dirSize(full)
    else if (entry.isFile()) total += await stat(full).then((s) => s.size).catch(() => 0)
  }
  return total
}

/** 下载目录里未完成的 .part 临时文件（中断下载的残留） */
async function partFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await partFiles(full)))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.part')) out.push(full)
  }
  return out
}

async function cacheInfo(): Promise<CacheInfo> {
  let bytes = 0
  for (const name of CACHE_DIR_NAMES) {
    bytes += await dirSize(join(app.getPath('userData'), name))
  }
  bytes += await dirSize(updatesDir())
  const parts = await partFiles(downloadRoot())
  for (const file of parts) bytes += await stat(file).then((s) => s.size).catch(() => 0)
  return { bytes, parts: parts.length }
}

/** 清理缓存：图片 / 网络缓存、已下载的更新安装包、下载临时文件；不影响收藏、清单、登录态 */
async function clearCache(): Promise<CacheClearResult> {
  try {
    const before = await cacheInfo()
    await session.defaultSession.clearCache()
    for (const name of CACHE_DIR_NAMES) {
      await rm(join(app.getPath('userData'), name), { recursive: true, force: true }).catch(
        () => undefined
      )
    }
    // apiCache 还有内存副本：不清掉的话，删了磁盘仍会命中旧数据
    clearApiCacheMemory()
    await cleanupUpdatesDir()
    // 有下载任务在跑时不能删 .part，否则正在写入的文件会被直接删掉
    if (!hasRunningDownloads()) {
      for (const file of await partFiles(downloadRoot())) {
        await rm(file, { force: true }).catch(() => undefined)
      }
    }
    return { ok: true, freed: before.bytes }
  } catch (err) {
    return { ok: false, freed: 0, error: (err as Error).message }
  }
}

/** 图片下载：按站点补防盗链头，统一成 Buffer（图片右键保存用） */
function imageHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': VOD_UA, Accept: 'image/*,*/*' }
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return headers
  }
  if (/(^|\.)doubanio\.com$|(^|\.)douban\.com$/.test(host)) {
    headers['Referer'] = IMAGE_REFERER
    headers['User-Agent'] = IMAGE_UA
  } else if (/(^|\.)phncdn\.com$/.test(host)) {
    headers['Referer'] = 'https://www.pornhub.com/'
    headers['Cookie'] = 'accessAgeDisclaimerPH=1; age_verified=1; accessPH=1'
  } else if (/(^|\.)komiic\.(com|cc)$/.test(host)) {
    try {
      const auth = komiicImageAuth(new URL(url))
      if (auth) {
        headers['Cookie'] = auth.cookie
        headers['Referer'] = auth.referer
        headers['User-Agent'] = KOMIIC_UA
      }
    } catch {
      // 非法 URL 用默认头
    }
  } else if (/(^|\.)picacomic\.com$|(^|\.)go2778\.com$/.test(host)) {
    headers['User-Agent'] = BIKA_UA
    headers['Referer'] = 'https://picaapi.picacomic.com/'
  }
  return headers
}

function sniffImageExt(contentType: string, fallback: string): string {
  const type = contentType.toLowerCase()
  if (type.includes('image/png')) return '.png'
  if (type.includes('image/webp')) return '.webp'
  if (type.includes('image/gif')) return '.gif'
  if (type.includes('image/jpeg')) return '.jpg'
  if (type.includes('image/avif')) return '.avif'
  return fallback
}

async function saveImageToFile(rawUrl: string): Promise<{ canceled: boolean; path?: string; error?: string }> {
  try {
    const url = rawUrl.trim()
    if (!url) return { canceled: false, error: '图片地址为空' }
    let buffer: Buffer
    let ext = '.jpg'
    let base = `老郑分享图片-${stamp()}`
    if (url.startsWith('data:')) {
      const match = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
      if (!match) return { canceled: false, error: '图片数据无效' }
      ext = sniffImageExt(match[1] ?? '', '.jpg')
      buffer = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]))
    } else {
      if (!/^https?:\/\//i.test(url)) return { canceled: false, error: '图片地址无效' }
      // 吃瓜图床是 AES 密文，必须走解密接口
      let melon = false
      try {
        melon = !!melonImageAuth(new URL(url))
      } catch {
        melon = false
      }
      if (melon) {
        const res = await melonFetchImage(url)
        if (!res.ok || !res.dataUrl) return { canceled: false, error: res.error ?? '图片解密失败' }
        return saveImageToFile(res.dataUrl)
      }
      const res = await fetch(url, {
        headers: imageHeaders(url),
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000)
      })
      if (!res.ok) return { canceled: false, error: `图片下载失败：HTTP ${res.status}` }
      buffer = Buffer.from(await res.arrayBuffer())
      ext = sniffImageExt(res.headers.get('content-type') ?? '', ext)
      try {
        const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
        if (name && name.length <= 80) {
          base = name.replace(/\.[a-z0-9]+$/i, '') || base
        }
      } catch {
        // 用默认文件名
      }
    }
    const picked = await dialog.showSaveDialog({
      title: '保存图片',
      defaultPath: join(
        lastImageDir() || app.getPath('pictures'),
        `${safeFileBase(base)}${ext}`
      ),
      filters: [{ name: '图片', extensions: ['jpg', 'png', 'webp', 'gif', 'avif'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await writeFile(picked.filePath, buffer)
    await setLastImageDir(dirname(picked.filePath))
    return { canceled: false, path: picked.filePath }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

function safeFileBase(raw: string): string {
  return (
    raw
      .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || '图片'
  )
}

function broadcastUpdateProgress(progress: UpdateProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update:progress', progress)
  }
}

/** GitHub 直连 + 两个实测可用的镜像前缀（与手机端一致） */
function updateChannels(url: string): string[] {
  const list = [url]
  if (/^https:\/\/github\.com\//i.test(url)) {
    list.push(`https://gh-proxy.com/${url}`, `https://ghproxy.net/${url}`)
  }
  return [...new Set(list)]
}

/** 下载安装包到 userData/updates，逐条线路回退；仅接受 https 直链 */
async function downloadUpdateInstaller(url: string): Promise<UpdateDownloadResult> {
  let target: string
  let base: string
  try {
    const dir = updatesDir()
    await mkdir(dir, { recursive: true })
    const raw = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
    base = (raw || `laozheng-update-${Date.now()}.exe`).replace(/[\\/:*?"<>|]/g, '_')
    target = join(dir, base.toLowerCase().endsWith('.exe') ? base : `${base}.exe`)
  } catch {
    return { ok: false, error: '更新地址无效' }
  }

  let lastError = '下载更新失败'
  for (const channel of updateChannels(url)) {
    const tmp = `${target}.part`
    try {
      const res = await fetch(channel, {
        headers: { 'User-Agent': 'laozheng-pc', Accept: '*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(30 * 60 * 1000)
      })
      if (!res.ok || !res.body) {
        lastError = `下载失败 HTTP ${res.status}`
        continue
      }
      const type = res.headers.get('content-type') ?? ''
      if (type.includes('text/html')) {
        lastError = '下载线路返回了网页而不是安装包'
        continue
      }
      const total = Number(res.headers.get('content-length') ?? 0) || 0
      let received = 0
      let lastAt = 0
      const meter = new Transform({
        transform(chunk, _enc, cb) {
          received += chunk.length
          const now = Date.now()
          if (now - lastAt > 200) {
            lastAt = now
            broadcastUpdateProgress({
              received,
              total,
              percent: total > 0 ? received / total : 0
            })
          }
          cb(null, chunk)
        }
      })
      await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(tmp))
      await rename(tmp, target)
      broadcastUpdateProgress({ received, total: total || received, percent: 1 })
      return { ok: true, path: target }
    } catch (err) {
      await unlink(tmp).catch(() => undefined)
      lastError = err instanceof Error ? err.message : '下载更新失败'
    }
  }
  return { ok: false, error: lastError }
}

/**
 * 安装更新：直接拉起 NSIS 安装向导（与手机端点「安装」一致），
 * 应用先退出，安装器接管文件替换。
 */
async function installUpdateInstaller(path: string): Promise<void> {
  const abs = resolve(path)
  const dir = resolve(updatesDir())
  if (!abs.startsWith(dir + sep)) throw new Error('安装包路径无效')
  if (!abs.toLowerCase().endsWith('.exe')) throw new Error('安装包格式无效')
  await stat(abs)
  const child = spawn(abs, [], { detached: true, stdio: 'ignore' })
  child.unref()
  setTimeout(() => app.quit(), 900)
}

/** 启动后静默检查：有直链更新则后台下载，完成后询问是否安装 */
async function autoUpdateCheck(win: BrowserWindow): Promise<void> {
  const info = await checkUpdateInternal()
  if (!info.ok || !info.hasUpdate || !info.downloadUrl) return
  const downloaded = await downloadUpdateInstaller(info.downloadUrl)
  if (!downloaded.ok || !downloaded.path) return
  if (win.isDestroyed()) return
  const answer = await dialog.showMessageBox(win, {
    type: 'info',
    title: '发现新版本',
    message: `新版本 ${info.latest} 已下载完成`,
    detail: '点击「立即安装」会关闭应用并打开安装向导，按提示完成即可。',
    buttons: ['立即安装', '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })
  if (answer.response === 0) await installUpdateInstaller(downloaded.path)
}

/**
 * 备份 / 云同步统一出口：把只存在主进程的数据（电视源、下载记录、本机设置）
 * 一起合并进备份，避免导出或同步时漏掉。
 */
async function buildBackupPayload(data: AppData): Promise<AppData> {
  const [liveSources, downloads] = await Promise.all([
    loadLiveSources(),
    exportDownloadRecords()
  ])
  return {
    ...data,
    version: 1,
    liveSources,
    downloads,
    settings: settingsSnapshot()
  }
}

function registerIpc(): void {
  ipcMain.handle('data:load', () => loadData())

  // 退出前同步落盘：渲染进程在 beforeunload 里调用
  ipcMain.on('data:saveSync', (event, data: AppData) => {
    try {
      saveDataSync(normalizeData(data))
      event.returnValue = true
    } catch (err) {
      console.error('[data] 退出前同步保存失败', err)
      event.returnValue = false
    }
  })

  // 导入 / 云恢复：基础数据由渲染进程保存，这里补写电视源、下载记录与本机设置
  ipcMain.handle('data:applyExtras', async (_e, data: AppData) => {
    if (!data || typeof data !== 'object') return
    if (data.settings && typeof data.settings === 'object') {
      await applySettingsSnapshot(data.settings)
    }
    if (Array.isArray(data.liveSources)) {
      await saveLiveSources(normalizeLiveSources(data.liveSources))
    }
    if (Array.isArray(data.downloads)) {
      await importDownloadRecords(data.downloads)
    }
  })

  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR

  ipcMain.handle('subject:search', (_e, category: SearchCategory, query: string) => {
    if (!SEARCH_CATEGORIES.has(category) || typeof query !== 'string' || query.length > 100) {
      return { ok: false, items: [], error: '搜索参数无效' }
    }
    return cachedResponse(`subject:search|${category}|${query}`, 12 * HOUR, () =>
      searchSubjects(category, query)
    )
  })

  ipcMain.handle('subject:detail', (_e, kind: SubjectKind, id: string) => {
    if (!SUBJECT_KINDS.has(kind) || typeof id !== 'string') {
      return { ok: false, error: '条目参数无效' }
    }
    return cachedResponse(`subject:detail|${kind}|${id}`, 7 * DAY, () =>
      fetchSubjectDetail(kind, id)
    )
  })

  ipcMain.handle('subject:full', (_e, kind: SubjectKind, id: string) => {
    if (!SUBJECT_KINDS.has(kind) || typeof id !== 'string') {
      return { ok: false, error: '条目参数无效' }
    }
    return cachedResponse(`subject:full|${kind}|${id}`, 7 * DAY, () =>
      fetchSubjectFull(kind, id)
    )
  })

  ipcMain.handle('subject:person', (_e, id: string) => {
    if (typeof id !== 'string') return { ok: false, error: '人物参数无效' }
    return cachedResponse(`subject:person|${id}`, 7 * DAY, () => fetchPersonFull(id))
  })

  ipcMain.handle('subject:credits', (_e, kind: SubjectKind, id: string) => {
    if (!SUBJECT_KINDS.has(kind) || typeof id !== 'string' || !/^\d+$/.test(id)) {
      return { ok: false, credits: [], error: '条目参数无效' }
    }
    return cachedResponse(`subject:credits|${kind}|${id}`, 7 * DAY, () =>
      fetchSubjectCredits(kind, id)
    )
  })

  ipcMain.handle(
    'subject:comments',
    (_e, kind: SubjectKind, id: string, order: 'hot' | 'new') => {
      if (!SUBJECT_KINDS.has(kind) || typeof id !== 'string') {
        return { ok: false, comments: [], error: '条目参数无效' }
      }
      const picked = order === 'new' ? 'new' : 'hot'
      return cachedResponse(`subject:comments|${kind}|${id}|${picked}`, 6 * HOUR, () =>
        fetchSubjectComments(kind, id, picked)
      )
    }
  )

  ipcMain.handle(
    'vod:search',
    (_e, source: VodSourceInput, keyword: string, year: string) => {
      if (
        !isVodSourceInput(source) ||
        typeof keyword !== 'string' ||
        keyword.length > 80 ||
        typeof year !== 'string'
      ) {
        return { ok: false, items: [], error: '搜索参数无效' }
      }
      return cachedResponse(
        `vod:search|${source.id}|${source.baseUrl}|${keyword}|${year}`,
        6 * HOUR,
        () => searchVodSource(source, keyword, year)
      )
    }
  )

  ipcMain.handle('vod:detail', (_e, source: VodSourceInput, vodId: number) => {
    if (!isVodSourceInput(source) || !Number.isInteger(vodId)) {
      return { ok: false, error: '条目参数无效' }
    }
    return cachedResponse(
      `vod:detail|${source.id}|${source.baseUrl}|${vodId}`,
      30 * 60 * 1000,
      () => fetchVodDetail(source, vodId),
      6 * HOUR
    )
  })

  ipcMain.handle('vod:test', (_e, source: VodSourceInput) => {
    if (!isVodSourceInput(source)) {
      return { ok: true, status: 'dead', message: '已失效 · 地址无效', testAt: Date.now(), region: 'cn' }
    }
    return testVodSource(source)
  })

  ipcMain.handle('vod:categories', (_e, source: VodSourceInput) => {
    if (!isVodSourceInput(source)) return { ok: false, error: '片源参数无效' }
    return cachedResponse(`vod:categories|${source.id}|${source.baseUrl}`, 7 * DAY, () =>
      fetchVodCategories(source)
    )
  })

  // 导出片源 / 电视源为 JSON 文件（只导名称与地址，不含任何账号信息）
  ipcMain.handle('vod:exportSources', async (_e, sources: unknown) => {
    const list = Array.isArray(sources) ? sources : []
    const picked = await dialog.showSaveDialog({
      title: '导出影视源',
      defaultPath: join(app.getPath('documents'), `老郑分享-影视源-${stamp()}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    try {
      const rows = list
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          name: typeof s.name === 'string' ? s.name : '',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
          enabled: s.enabled !== false
        }))
        .filter((s) => /^https?:\/\//i.test(s.baseUrl))
      await writeFile(picked.filePath, JSON.stringify(rows, null, 2), 'utf8')
      return { canceled: false, path: picked.filePath, count: rows.length }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(
    'vod:list',
    (_e, source: VodSourceInput, page: number, typeId: number, keyword: string) => {
      if (
        !isVodSourceInput(source) ||
        !Number.isInteger(page) ||
        !Number.isInteger(typeId) ||
        typeof keyword !== 'string' ||
        keyword.length > 80
      ) {
        return { ok: false, error: '参数无效' }
      }
      return cachedResponse(
        `vod:list|${source.id}|${source.baseUrl}|${page}|${typeId}|${keyword}`,
        30 * 60 * 1000,
        () => listVodSource(source, page, typeId, keyword)
      )
    }
  )

  ipcMain.handle('live:loadSources', () => loadLiveSources())

  ipcMain.handle('live:saveSources', async (_e, sources: LiveSource[]) => {
    if (!Array.isArray(sources)) throw new Error('参数无效')
    await saveLiveSources(normalizeLiveSources(sources).slice(0, 100))
  })

  ipcMain.handle('live:channels', (_e, source: LiveSource) => {
    if (!isLiveSource(source)) {
      return { sourceId: '', sourceName: '', channels: [], error: '电视源参数无效' }
    }
    return cachedResponse(
      `live:channels|${source.id}|${source.url}`,
      10 * 60 * 1000,
      () => loadLiveChannels(source),
      30 * 60 * 1000
    )
  })

  ipcMain.handle('live:test', (_e, source: LiveSource) => {
    if (!isLiveSource(source)) return { ok: false, channels: 0, message: '电视源参数无效' }
    return testLiveSource(source)
  })

  ipcMain.handle('live:exportSources', async (_e, sources: unknown) => {
    const list = Array.isArray(sources) ? sources : []
    const picked = await dialog.showSaveDialog({
      title: '导出电视源',
      defaultPath: join(app.getPath('documents'), `老郑分享-电视源-${stamp()}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    try {
      const rows = normalizeLiveSources(list).map((s) => ({
        name: s.name,
        url: s.url,
        enabled: s.enabled,
        content: s.url.startsWith('local://') ? s.content : ''
      }))
      await writeFile(picked.filePath, JSON.stringify(rows, null, 2), 'utf8')
      return { canceled: false, path: picked.filePath, count: rows.length }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('music:search', (_e, keyword: string, page: number) => {
    if (typeof keyword !== 'string' || keyword.length > 80 || !Number.isInteger(page)) {
      return { ok: false, items: [], error: '搜索参数无效' }
    }
    return cachedResponse(`music:search|${keyword}|${page}`, 6 * HOUR, () =>
      searchMusic(keyword, page)
    )
  })

  ipcMain.handle('music:resolve', (_e, songId: string, platform: string) => {
    if (typeof songId !== 'string') return { ok: false, error: '歌曲参数无效' }
    return resolveMusic(songId, typeof platform === 'string' ? platform : 'mvmp3')
  })

  ipcMain.handle('downloads:list', () => listDownloads())

  ipcMain.handle('downloads:add', (_e, input: DownloadAddInput) => {
    if (!input || typeof input !== 'object') return { ok: false, error: '参数无效' }
    const { title, url, kind } = input
    if (
      typeof title !== 'string' ||
      title.length > 200 ||
      typeof url !== 'string' ||
      !/^https?:\/\//i.test(url) ||
      !['video', 'music', 'file'].includes(kind)
    ) {
      return { ok: false, error: '下载参数无效' }
    }
    return addDownload({
      title,
      url,
      kind,
      coverUrl: typeof input.coverUrl === 'string' ? input.coverUrl : '',
      sourceName: typeof input.sourceName === 'string' ? input.sourceName : '',
      durationSec:
        typeof input.durationSec === 'number' && Number.isFinite(input.durationSec)
          ? input.durationSec
          : undefined,
      referer: typeof input.referer === 'string' ? input.referer : undefined
    })
  })

  ipcMain.handle('downloads:remove', (_e, id: string, deleteFile: boolean) => {
    if (typeof id !== 'string') throw new Error('参数无效')
    return removeDownload(id, !!deleteFile)
  })

  ipcMain.handle('downloads:cancel', (_e, id: string) => {
    if (typeof id === 'string') return cancelTask(id)
    return undefined
  })

  ipcMain.handle('downloads:openDir', () => openDownloadsDir())

  ipcMain.handle('downloads:root', () => downloadRoot())

  ipcMain.handle('downloads:chooseRoot', async () => {
    const picked = await dialog.showOpenDialog({
      title: '选择下载总目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true }
    return { canceled: false, root: picked.filePaths[0] }
  })

  ipcMain.handle('downloads:changeRoot', async (_e, root: string, move: boolean) => {
    if (typeof root !== 'string' || root.length > 400) {
      return { ok: false, error: '目录参数无效' }
    }
    return changeDownloadRoot(root, !!move)
  })

  ipcMain.handle('app:cacheInfo', () => cacheInfo())
  ipcMain.handle('app:clearCache', () => clearCache())

  ipcMain.handle('settings:getUi', () => uiSettings())
  ipcMain.handle('settings:setUi', (_e, input: Partial<UiSettings>) => {
    if (!input || typeof input !== 'object') throw new Error('参数无效')
    return setUiSettings(input)
  })

  ipcMain.handle('douban:status', () => doubanAuthStatus())
  ipcMain.handle('douban:login', () => openDoubanLogin(BrowserWindow.getFocusedWindow()))
  ipcMain.handle('douban:logout', () => logoutDouban())

  ipcMain.handle('xsite:categories', () =>
    cachedResponse('xsite:categories', 7 * DAY, () => xCategories())
  )

  ipcMain.handle('xsite:list', (_e, range: string, page: number, category: string) => {
    if (
      !['weekly', 'monthly', 'all'].includes(range) ||
      !Number.isInteger(page) ||
      typeof category !== 'string' ||
      category.length > 60
    ) {
      return { ok: false, error: '参数无效' }
    }
    return cachedResponse(
      `xsite:list|${range}|${page}|${category}`,
      30 * 60 * 1000,
      () => xList(range, page, category),
      6 * HOUR
    )
  })

  ipcMain.handle('xsite:detail', (_e, urlCd: string) => {
    if (typeof urlCd !== 'string' || urlCd.length > 100) return { ok: false, error: '参数无效' }
    return cachedResponse(
      `xsite:detail|${urlCd}`,
      30 * 60 * 1000,
      () => xDetail(urlCd),
      6 * HOUR
    )
  })

  ipcMain.handle(
    'psite:list',
    (_e, sort: string, catId: number, query: string, page: number) => {
      if (
        typeof sort !== 'string' ||
        !['', 'recommended', 'ht', 'mv', 'tr'].includes(sort) ||
        !Number.isInteger(catId) ||
        typeof query !== 'string' ||
        query.length > 80 ||
        !Number.isInteger(page)
      ) {
        return { ok: false, items: [], lastPage: 0, hasMore: false, error: '参数无效' }
      }
      return cachedResponse(
        `psite:list|${sort}|${catId}|${query}|${page}`,
        30 * 60 * 1000,
        () => pList(sort, catId, query, page)
      )
    }
  )

  ipcMain.handle('psite:resolve', (_e, vkey: string) => {
    if (typeof vkey !== 'string' || vkey.length > 50) return { ok: false, error: '参数无效' }
    return pResolve(vkey)
  })

  ipcMain.handle('psite:categoryCount', (_e, catId: number) => {
    if (!Number.isInteger(catId) || catId < 0) return { ok: false, error: '参数无效' }
    return pCategoryCount(catId)
  })

  ipcMain.handle('melon:list', (_e, path: string) => {
    if (typeof path !== 'string' || path.length > 300) {
      return { ok: false, error: '参数无效' }
    }
    return cachedResponse(`melon:list|${path}`, 20 * 60 * 1000, () => melonList(path))
  })

  ipcMain.handle('melon:detail', (_e, id: string) => {
    if (typeof id !== 'string' || !/^\d+$/.test(id)) {
      return { ok: false, error: '参数无效' }
    }
    return cachedResponse(`melon:detail|${id}`, 6 * HOUR, () => melonDetail(id), 6 * HOUR)
  })

  ipcMain.handle('melon:counts', () =>
    cachedResponse('melon:counts', 6 * HOUR, () => melonCategoryCounts())
  )

  ipcMain.handle('melon:trackImages', (_e, urls: unknown) => {
    if (!Array.isArray(urls)) return
    trackMelonImages(urls.filter((u): u is string => typeof u === 'string'))
  })

  ipcMain.handle('melon:image', (_e, url: string) => {
    if (typeof url !== 'string' || url.length > 500) {
      return { ok: false, error: '图片地址无效' }
    }
    return melonFetchImage(url)
  })

  ipcMain.handle('melon:duration', (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || url.length > 1000) {
      return { ok: false, error: '视频地址无效' }
    }
    return cachedResponse(`melon:duration|${url}`, 7 * DAY, () => melonVideoDuration(url))
  })

  // ---------- 内置账号（哔咔 / Komiic / 无忧） ----------
  const ACCOUNT_SITES = new Set<AccountSite>(['bika', 'komiic', 'wygamer'])

  ipcMain.handle('accounts:list', () => listAccounts())

  ipcMain.handle(
    'accounts:login',
    async (_e, site: AccountSite): Promise<AccountActionResult> => {
      if (!ACCOUNT_SITES.has(site)) return { ok: false, message: '站点参数无效' }
      let ok = false
      if (site === 'bika') ok = await bikaEnsureLogin()
      else if (site === 'komiic') ok = await komiicEnsureLogin()
      else ok = await wygamerEnsureLogin(true)
      const item = listAccounts().items.find((i) => i.site === site)
      return { ok, message: item?.message ?? (ok ? '登录成功' : '登录失败') }
    }
  )

  ipcMain.handle('accounts:openLogin', async (_e, site: AccountSite) => {
    if (site === 'wygamer') await openWygamerLogin()
  })

  // ---------- 哔咔 ----------
  ipcMain.handle('bika:categories', () =>
    cachedResponse('bika:categories', 7 * DAY, () => bikaCategories())
  )

  ipcMain.handle('bika:counts', () =>
    cachedResponse('bika:counts', 6 * HOUR, () => bikaCategoryCounts())
  )

  ipcMain.handle('bika:list', (_e, page: number, category: string, sort: string) => {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000 ||
      typeof category !== 'string' ||
      category.length > 60 ||
      typeof sort !== 'string' ||
      sort.length > 10
    ) {
      return { ok: false, items: [], page: 1, pages: 1, total: 0, error: '参数无效' }
    }
    return cachedResponse(`bika:list|${page}|${category}|${sort}`, 15 * 60 * 1000, () =>
      bikaList(page, category, sort)
    )
  })

  ipcMain.handle('bika:search', (_e, keyword: string, page: number, sort: string) => {
    if (
      typeof keyword !== 'string' ||
      !keyword.trim() ||
      keyword.length > 80 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000 ||
      typeof sort !== 'string'
    ) {
      return { ok: false, items: [], page: 1, pages: 1, total: 0, error: '参数无效' }
    }
    return cachedResponse(`bika:search|${keyword.trim()}|${page}|${sort}`, 30 * 60 * 1000, () =>
      bikaSearch(keyword.trim(), page, sort)
    )
  })

  ipcMain.handle('bika:detail', (_e, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, comic: null, error: '参数无效' }
    }
    return cachedResponse(`bika:detail|${id}`, 12 * HOUR, () => bikaDetail(id))
  })

  ipcMain.handle('bika:chapters', (_e, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return cachedResponse(`bika:chapters|${id}`, 12 * HOUR, () => bikaChapters(id))
  })

  ipcMain.handle('bika:images', (_e, id: string, order: number) => {
    if (typeof id !== 'string' || !id || id.length > 80 || !Number.isInteger(order) || order < 0) {
      return { ok: false, urls: [], error: '参数无效' }
    }
    return bikaImages(id, order)
  })

  // ---------- Komiic ----------
  ipcMain.handle('komiic:recent', (_e, offset: number, status: string) => {
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 100_000 ||
      (status !== undefined && typeof status !== 'string')
    ) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return cachedResponse(
      `komiic:recent|${offset}|${status ?? ''}`,
      15 * 60 * 1000,
      () => komiicRecent(offset, status === 'ONGOING' || status === 'END' ? status : '')
    )
  })

  ipcMain.handle('komiic:hot', (_e, offset: number) => {
    if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return cachedResponse(`komiic:hot|${offset}`, 15 * 60 * 1000, () => komiicHot(offset))
  })

  ipcMain.handle('komiic:byCategory', (_e, categoryId: string, offset: number) => {
    if (
      typeof categoryId !== 'string' ||
      !categoryId ||
      categoryId.length > 60 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 100_000
    ) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return cachedResponse(`komiic:category|${categoryId}|${offset}`, 15 * 60 * 1000, () =>
      komiicByCategory(categoryId, offset)
    )
  })

  ipcMain.handle('komiic:search', (_e, keyword: string, offset: number) => {
    if (
      typeof keyword !== 'string' ||
      !keyword.trim() ||
      keyword.length > 80 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 100_000
    ) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return cachedResponse(`komiic:search|${keyword.trim()}|${offset}`, 30 * 60 * 1000, () =>
      komiicSearch(keyword.trim(), offset)
    )
  })

  ipcMain.handle('komiic:categories', () =>
    cachedResponse('komiic:categories', 7 * DAY, () => komiicCategories())
  )

  ipcMain.handle('komiic:detail', (_e, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, comic: null, error: '参数无效' }
    }
    return cachedResponse(`komiic:detail|${id}`, 12 * HOUR, () => komiicDetail(id))
  })

  ipcMain.handle('komiic:chapters', (_e, comicId: string) => {
    if (typeof comicId !== 'string' || !comicId || comicId.length > 80) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return cachedResponse(`komiic:chapters|${comicId}`, 12 * HOUR, () => komiicChapters(comicId))
  })

  ipcMain.handle('komiic:images', (_e, comicId: string, chapterId: string) => {
    if (
      typeof comicId !== 'string' ||
      !comicId ||
      comicId.length > 80 ||
      typeof chapterId !== 'string' ||
      !chapterId ||
      chapterId.length > 80
    ) {
      return { ok: false, urls: [], error: '参数无效' }
    }
    return komiicImages(comicId, chapterId)
  })

  ipcMain.handle('downloads:openItem', (_e, id: string) => {
    if (typeof id !== 'string') throw new Error('参数无效')
    return openDownloadItem(id)
  })

  ipcMain.handle('downloads:playItem', (_e, id: string) => {
    if (typeof id !== 'string') throw new Error('参数无效')
    return playDownloadItem(id)
  })

  ipcMain.handle('downloads:readItem', (_e, id: string) => {
    if (typeof id !== 'string') throw new Error('参数无效')
    return readDownloadItem(id)
  })

  ipcMain.handle('downloads:addComicBatch', (_e, input: ComicBatchDownloadInput) => {
    if (!input || typeof input !== 'object' || !Array.isArray(input.chapters)) {
      return { ok: false, error: '下载参数无效' }
    }
    return addComicBatchDownload(input)
  })

  ipcMain.handle('music:resolveLegacy', (_e, name: string, artists: string) => {
    if (typeof name !== 'string' || name.length > 120) {
      return { ok: false, error: '歌曲参数无效' }
    }
    return resolveLegacyMusic(name, typeof artists === 'string' ? artists.slice(0, 120) : '')
  })

  // ---------- 无忧游戏库 ----------
  ipcMain.handle('wygamer:home', (_e, page: number) => {
    if (!Number.isInteger(page) || page < 1 || page > 1000) {
      return { ok: false, items: [], page: 1, lastPage: 0, error: '参数无效' }
    }
    return cachedResponse(`wygamer:home|${page}`, 30 * 60 * 1000, () => wygamerHome(page))
  })

  ipcMain.handle('wygamer:search', (_e, keyword: string, page: number) => {
    if (
      typeof keyword !== 'string' ||
      !keyword.trim() ||
      keyword.length > 80 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000
    ) {
      return { ok: false, items: [], page: 1, lastPage: 0, error: '参数无效' }
    }
    return cachedResponse(`wygamer:search|${keyword.trim()}|${page}`, 30 * 60 * 1000, () =>
      wygamerSearch(keyword.trim(), page)
    )
  })

  ipcMain.handle('wygamer:byCategory', (_e, url: string, page: number) => {
    if (
      typeof url !== 'string' ||
      !/^https?:\/\/(www\.)?wygamer\.com\//i.test(url) ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000
    ) {
      return { ok: false, items: [], page: 1, lastPage: 0, error: '参数无效' }
    }
    return cachedResponse(`wygamer:category|${url}|${page}`, 30 * 60 * 1000, () =>
      wygamerByCategory(url, page)
    )
  })

  ipcMain.handle('wygamer:categories', () =>
    cachedResponse('wygamer:categories', 7 * DAY, () => wygamerCategories())
  )

  ipcMain.handle('wygamer:detail', (_e, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 120) {
      return { ok: false, game: null, error: '参数无效' }
    }
    return cachedResponse(`wygamer:detail|${id}`, 12 * HOUR, () => wygamerDetail(id))
  })

  ipcMain.handle('wygamer:resolveDownload', (_e, payUrl: string) => {
    if (typeof payUrl !== 'string' || !/^https:\/\/(www\.)?wygamer\.com\//i.test(payUrl)) {
      return { ok: false, error: '参数无效' }
    }
    return wygamerResolveDownload(payUrl)
  })

  // ---------- Z-Library ----------
  ipcMain.handle('zlib:status', () => zlibStatus())

  ipcMain.handle('zlib:login', async () => {
    const res = await openZlibLogin()
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('accounts:changed')
    return res
  })

  ipcMain.handle('zlib:logout', async () => {
    const status = await zlibLogout()
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('accounts:changed')
    return status
  })

  ipcMain.handle('zlib:saveCredentials', (_e, username: string, password: string) => {
    if (typeof username !== 'string' || typeof password !== 'string') {
      return { ok: false, message: '参数无效' }
    }
    return zlibSaveCredentials(username.slice(0, 200), password.slice(0, 200))
  })

  ipcMain.handle('zlib:search', (_e, keyword: string, page: number) => {
    if (
      typeof keyword !== 'string' ||
      !keyword.trim() ||
      keyword.length > 80 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000
    ) {
      return { ok: false, books: [], page: 1, totalPages: 0, error: '参数无效' }
    }
    return cachedResponse(`zlib:search|${keyword.trim()}|${page}`, 30 * 60 * 1000, () =>
      zlibSearch(keyword.trim(), page)
    )
  })

  ipcMain.handle('zlib:detail', (_e, id: string, hash: string) => {
    if (typeof id !== 'string' || typeof hash !== 'string' || id.length > 40 || hash.length > 80) {
      return { ok: false, book: null, error: '参数无效' }
    }
    return cachedResponse(
      `zlib:detail|${id}|${hash}`,
      6 * HOUR,
      () => zlibDetail(id, hash),
      6 * HOUR
    )
  })

  ipcMain.handle('zlib:download', (_e, id: string, hash: string, title: string) => {
    if (
      typeof id !== 'string' ||
      typeof hash !== 'string' ||
      typeof title !== 'string' ||
      !/^\d+$/.test(id) ||
      title.length > 200
    ) {
      return { ok: false, error: '参数无效' }
    }
    return zlibDownloadBook(id, hash, title)
  })

  ipcMain.handle('sync:getConfig', () => getSyncConfig())

  ipcMain.handle('sync:saveConfig', (_e, input: SyncConfigInput) => {
    if (!input || typeof input !== 'object') throw new Error('参数无效')
    return saveSyncConfig({
      url: typeof input.url === 'string' ? input.url.slice(0, 500) : '',
      username: typeof input.username === 'string' ? input.username.slice(0, 200) : '',
      password: typeof input.password === 'string' ? input.password.slice(0, 200) : undefined
    })
  })

  ipcMain.handle('app:checkUpdate', () => checkUpdateInternal())

  ipcMain.handle('app:downloadUpdate', async (_e, url: string): Promise<UpdateDownloadResult> => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
      return { ok: false, error: '更新地址无效' }
    }
    return downloadUpdateInstaller(url)
  })

  ipcMain.handle('app:installUpdate', async (_e, path: string) => {
    if (typeof path !== 'string') throw new Error('参数无效')
    await installUpdateInstaller(path)
  })

  ipcMain.handle('app:openExternal', async (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('URL 无效')
    await shell.openExternal(url)
  })

  ipcMain.handle('app:saveImage', (_e, url: string) => {
    if (
      typeof url !== 'string' ||
      (url.startsWith('data:') ? url.length > 30_000_000 : url.length > 2_000_000)
    ) {
      return { canceled: false, error: '图片地址无效' }
    }
    return saveImageToFile(url)
  })

  ipcMain.handle('sync:test', () => testSync())
  ipcMain.handle('sync:upload', async (_e, data: AppData) =>
    uploadSync(await buildBackupPayload(data))
  )
  ipcMain.handle('sync:download', () => downloadSync())

  ipcMain.handle('live:importFile', async () => {
    const picked = await dialog.showOpenDialog({
      title: '导入 M3U 直播源',
      properties: ['openFile'],
      filters: [{ name: 'M3U 播放列表', extensions: ['m3u', 'm3u8', 'txt'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
    const file = picked.filePaths[0]
    try {
      const text = await readFile(file, 'utf8')
      if (!text.trim()) return { canceled: false, error: '文件内容为空' }
      return { canceled: false, source: makeLocalSource(basename(file), text) }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('data:save', async (_e, data: AppData) => {
    await saveData(data)
  })

  ipcMain.handle('app:version', () => displayVersion())

  ipcMain.handle('data:dir', () => app.getPath('userData'))

  ipcMain.handle('data:openDir', async () => {
    const err = await shell.openPath(app.getPath('userData'))
    if (err) throw new Error(err)
  })

  ipcMain.handle('data:import', async () => {
    const picked = await dialog.showOpenDialog({
      title: '导入备份',
      properties: ['openFile'],
      filters: [{ name: '备份 JSON', extensions: ['json'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
    try {
      const data = await importFromFile(picked.filePaths[0])
      return { canceled: false, data }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('data:export', async (_e, data: AppData) => {
    const picked = await dialog.showSaveDialog({
      title: '导出备份',
      defaultPath: join(app.getPath('documents'), `老郑分享备份-${stamp()}.json`),
      filters: [{ name: '备份 JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    try {
      await exportToFile(picked.filePath, await buildBackupPayload(data))
      return { canceled: false, path: picked.filePath }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  // 系统关机 / 安装更新等真正退出时，允许窗口关闭
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('will-quit', () => {
    tray?.destroy()
    tray = null
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.laozheng.pc')
    Menu.setApplicationMenu(null)
    await initSettings()
    await seedDefaultData()
    initAccounts()
    initDoubanAuth()
    setupRequestRules()
    setupImageCacheHandler((url) => {
      const headers: Record<string, string> = { Accept: 'image/*,*/*;q=0.8' }
      applyRequestHeaders(url, 'image', headers)
      return headers
    })
    registerIpc()
    await startMediaServer()
    const win = createWindow()
    console.log('[app] data file:', dataFilePath())

    // 静默自动更新：清单里给了安装包直链时后台下载，完成后询问是否安装
    win.webContents.once('did-finish-load', () => {
      void cleanupUpdatesDir().then(() => autoUpdateCheck(win))
    })

    // 内置账号静默登录：哔咔 / Komiic 直接换 token，无忧恢复持久化会话（失效时自动过滑块）
    void bikaEnsureLogin()
    void komiicEnsureLogin()
    void wygamerEnsureLogin()
    // Z-Library：有保存账密时静默自动登录（失败不打扰用户）
    void autoZlibLogin()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      ensureTray()
      showMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    // 有托盘时窗口只是隐藏 / 被销毁也不退出，必须从托盘菜单选「退出」
    if (process.platform !== 'darwin' && !tray) app.quit()
  })
}
