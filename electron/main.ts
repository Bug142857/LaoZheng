import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron'
import { basename, join, resolve, sep } from 'node:path'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dataFilePath, exportToFile, importFromFile, loadData, saveData } from './store'
import { fetchSubjectDetail, searchSubjects } from './douban'
import { fetchVodDetail, searchVodSource, testVodSource } from './vod'
import {
  loadLiveChannels,
  loadLiveSources,
  makeLocalSource,
  normalizeLiveSources,
  saveLiveSources
} from './live'
import { resolveMusic, resolveLegacyMusic, searchMusic } from './music'
import {
  addDownload,
  addImageDownload,
  cancelTask,
  listDownloads,
  openDownloadItem,
  openDownloadsDir,
  removeDownload,
  startMediaServer
} from './downloads'
import type { DownloadAddInput, ImageDownloadInput } from '../src/shared/downloads'
import { xCategories, xDetail, xList } from './xsite'
import { pList, pResolve } from './psite'
import { melonDetail, melonList } from './melon'
import { initAccounts, listAccounts } from './accounts'
import {
  bikaCategories,
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
import { openZlibLogin, zlibDetail, zlibDownloadBook, zlibSearch, zlibStatus } from './zlib'
import type { AccountActionResult, AccountSite } from '../src/shared/accounts'
import {
  downloadSync,
  getSyncConfig,
  saveSyncConfig,
  testSync,
  uploadSync
} from './sync'
import type { SyncConfigInput } from '../src/shared/sync'
import { compareVersions } from '../src/shared/update'
import type { UpdateCheckResult, UpdateDownloadResult, UpdateProgress } from '../src/shared/update'
import type { LiveSource } from '../src/shared/live'
import type { AppData } from '../src/shared/types'
import type { SearchCategory, SubjectKind } from '../src/shared/douban'
import type { VodSourceInput } from '../src/shared/vod'

const isDev = !app.isPackaged

/** electron-builder 要求三段式版本，对外显示与安装包名去掉末尾的 .0（0.5.0 → 0.5） */
function displayVersion(): string {
  return app.getVersion().replace(/\.0$/, '')
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#141318',
    title: '老郑分享',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

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
  return win
}

const IMAGE_REFERER = 'https://m.douban.com/'
const IMAGE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
const IMAGE_URLS = ['*://*.doubanio.com/*', '*://*.douban.com/*']
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

/**
 * 请求层规则：
 * 1) 封面图补 Referer / 移动 UA，旧图床域重写；
 * 2) 播放请求（media / m3u8 分片）统一 UA，并注入 CORS 头，避免渲染进程被跨域拦截。
 */
function setupRequestRules(): void {
  const ses = session.defaultSession

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders
    let host = ''
    try {
      host = new URL(details.url).hostname
    } catch {
      // 忽略非法 URL
    }
    if (/(^|\.)doubanio\.com$|(^|\.)douban\.com$/.test(host)) {
      headers['Referer'] = IMAGE_REFERER
      headers['User-Agent'] = IMAGE_UA
    } else if (/(^|\.)phncdn\.com$/.test(host)) {
      // P站 CDN 对部分节点校验来源页，补 Referer + 移动 UA
      headers['Referer'] = 'https://www.pornhub.com/'
      headers['User-Agent'] = VOD_UA
    } else if (/(^|\.)komiic\.(com|cc)$/.test(host)) {
      // Komiic 章节图：注入登录 Cookie + 完整路径 Referer（防盗链），缺口归属在查询参数里
      try {
        const auth = komiicImageAuth(new URL(details.url))
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
    } else if (
      details.resourceType === 'media' ||
      (details.resourceType === 'xhr' && /\.(m3u8|ts|key|mp4|flv)(\?|$)/i.test(details.url))
    ) {
      headers['User-Agent'] = VOD_UA
    }
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

  ses.webRequest.onBeforeRequest({ urls: IMAGE_URLS }, (details, callback) => {
    try {
      const url = new URL(details.url)
      if (/^qnmob\d*\.doubanio\.com$/.test(url.hostname)) {
        url.hostname = 'img2.doubanio.com'
        callback({ redirectURL: url.toString() })
        return
      }
    } catch {
      // URL 解析失败时按原请求继续
    }
    callback({})
  })
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

function registerIpc(): void {
  ipcMain.handle('data:load', () => loadData())

  ipcMain.handle('subject:search', (_e, category: SearchCategory, query: string) => {
    if (!SEARCH_CATEGORIES.has(category) || typeof query !== 'string' || query.length > 100) {
      return { ok: false, items: [], error: '搜索参数无效' }
    }
    return searchSubjects(category, query)
  })

  ipcMain.handle('subject:detail', (_e, kind: SubjectKind, id: string) => {
    if (!SUBJECT_KINDS.has(kind) || typeof id !== 'string') {
      return { ok: false, error: '条目参数无效' }
    }
    return fetchSubjectDetail(kind, id)
  })

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
      return searchVodSource(source, keyword, year)
    }
  )

  ipcMain.handle('vod:detail', (_e, source: VodSourceInput, vodId: number) => {
    if (!isVodSourceInput(source) || !Number.isInteger(vodId)) {
      return { ok: false, error: '条目参数无效' }
    }
    return fetchVodDetail(source, vodId)
  })

  ipcMain.handle('vod:test', (_e, source: VodSourceInput) => {
    if (!isVodSourceInput(source)) {
      return { ok: true, status: 'dead', message: '已失效 · 地址无效', testAt: Date.now(), region: 'cn' }
    }
    return testVodSource(source)
  })

  ipcMain.handle('live:loadSources', () => loadLiveSources())

  ipcMain.handle('live:saveSources', async (_e, sources: LiveSource[]) => {
    if (!Array.isArray(sources)) throw new Error('参数无效')
    await saveLiveSources(normalizeLiveSources(sources).slice(0, 100))
  })

  ipcMain.handle('live:channels', (_e, source: LiveSource) => {
    if (!isLiveSource(source)) {
      return { sourceId: '', sourceName: '', channels: [], error: '电视源参数无效' }
    }
    return loadLiveChannels(source)
  })

  ipcMain.handle('music:search', (_e, keyword: string, page: number) => {
    if (typeof keyword !== 'string' || keyword.length > 80 || !Number.isInteger(page)) {
      return { ok: false, items: [], error: '搜索参数无效' }
    }
    return searchMusic(keyword, page)
  })

  ipcMain.handle('music:resolve', (_e, songId: string) => {
    if (typeof songId !== 'string') return { ok: false, error: '歌曲参数无效' }
    return resolveMusic(songId)
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
      sourceName: typeof input.sourceName === 'string' ? input.sourceName : ''
    })
  })

  ipcMain.handle('downloads:remove', (_e, id: string, deleteFile: boolean) => {
    if (typeof id !== 'string') throw new Error('参数无效')
    return removeDownload(id, !!deleteFile)
  })

  ipcMain.handle('downloads:cancel', (_e, id: string) => {
    if (typeof id === 'string') cancelTask(id)
  })

  ipcMain.handle('downloads:openDir', () => openDownloadsDir())

  ipcMain.handle('xsite:categories', () => xCategories())

  ipcMain.handle('xsite:list', (_e, range: string, page: number, category: string) => {
    if (
      !['weekly', 'monthly', 'all'].includes(range) ||
      !Number.isInteger(page) ||
      typeof category !== 'string' ||
      category.length > 60
    ) {
      return { ok: false, error: '参数无效' }
    }
    return xList(range, page, category)
  })

  ipcMain.handle('xsite:detail', (_e, urlCd: string) => {
    if (typeof urlCd !== 'string' || urlCd.length > 100) return { ok: false, error: '参数无效' }
    return xDetail(urlCd)
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
        return { ok: false, items: [], lastPage: 0, error: '参数无效' }
      }
      return pList(sort, catId, query, page)
    }
  )

  ipcMain.handle('psite:resolve', (_e, vkey: string) => {
    if (typeof vkey !== 'string' || vkey.length > 50) return { ok: false, error: '参数无效' }
    return pResolve(vkey)
  })

  ipcMain.handle('melon:list', (_e, path: string) => {
    if (typeof path !== 'string' || path.length > 300) {
      return { ok: false, error: '参数无效' }
    }
    return melonList(path)
  })

  ipcMain.handle('melon:detail', (_e, id: string) => {
    if (typeof id !== 'string' || !/^\d+$/.test(id)) {
      return { ok: false, error: '参数无效' }
    }
    return melonDetail(id)
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
  ipcMain.handle('bika:categories', () => bikaCategories())

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
    return bikaList(page, category, sort)
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
    return bikaSearch(keyword.trim(), page, sort)
  })

  ipcMain.handle('bika:detail', (_e, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, comic: null, error: '参数无效' }
    }
    return bikaDetail(id)
  })

  ipcMain.handle('bika:chapters', (_e, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return bikaChapters(id)
  })

  ipcMain.handle('bika:images', (_e, id: string, order: number) => {
    if (typeof id !== 'string' || !id || id.length > 80 || !Number.isInteger(order) || order < 0) {
      return { ok: false, urls: [], error: '参数无效' }
    }
    return bikaImages(id, order)
  })

  // ---------- Komiic ----------
  ipcMain.handle('komiic:recent', (_e, offset: number) => {
    if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return komiicRecent(offset)
  })

  ipcMain.handle('komiic:hot', (_e, offset: number) => {
    if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return komiicHot(offset)
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
    return komiicByCategory(categoryId, offset)
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
    return komiicSearch(keyword.trim(), offset)
  })

  ipcMain.handle('komiic:categories', () => komiicCategories())

  ipcMain.handle('komiic:detail', (_e, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, comic: null, error: '参数无效' }
    }
    return komiicDetail(id)
  })

  ipcMain.handle('komiic:chapters', (_e, comicId: string) => {
    if (typeof comicId !== 'string' || !comicId || comicId.length > 80) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return komiicChapters(comicId)
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

  ipcMain.handle('downloads:addImages', (_e, input: ImageDownloadInput) => {
    if (!input || typeof input !== 'object' || !Array.isArray(input.urls)) {
      return { ok: false, error: '下载参数无效' }
    }
    if (typeof input.title !== 'string' || input.title.length > 120) {
      return { ok: false, error: '下载参数无效' }
    }
    return addImageDownload({
      title: input.title,
      urls: input.urls.slice(0, 300),
      referer: typeof input.referer === 'string' ? input.referer.slice(0, 300) : '',
      coverUrl: typeof input.coverUrl === 'string' ? input.coverUrl.slice(0, 500) : '',
      sourceName: typeof input.sourceName === 'string' ? input.sourceName.slice(0, 40) : ''
    })
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
    return wygamerHome(page)
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
    return wygamerSearch(keyword.trim(), page)
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
    return wygamerByCategory(url, page)
  })

  ipcMain.handle('wygamer:categories', () => wygamerCategories())

  ipcMain.handle('wygamer:detail', (_e, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 120) {
      return { ok: false, game: null, error: '参数无效' }
    }
    return wygamerDetail(id)
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
    return zlibSearch(keyword.trim(), page)
  })

  ipcMain.handle('zlib:detail', (_e, id: string, hash: string) => {
    if (typeof id !== 'string' || typeof hash !== 'string' || id.length > 40 || hash.length > 80) {
      return { ok: false, book: null, error: '参数无效' }
    }
    return zlibDetail(id, hash)
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

  ipcMain.handle('sync:test', () => testSync())
  ipcMain.handle('sync:upload', (_e, data: AppData) => uploadSync(data))
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
      await exportToFile(picked.filePath, data)
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
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.laozheng.pc')
    Menu.setApplicationMenu(null)
    initAccounts()
    setupRequestRules()
    registerIpc()
    await startMediaServer()
    const win = createWindow()
    console.log('[app] data file:', dataFilePath())

    // 静默自动更新：清单里给了安装包直链时后台下载，完成后询问是否安装
    win.webContents.once('did-finish-load', () => {
      void autoUpdateCheck(win)
    })

    // 内置账号静默登录：哔咔 / Komiic 直接换 token，无忧恢复持久化会话（失效时自动过滑块）
    void bikaEnsureLogin()
    void komiicEnsureLogin()
    void wygamerEnsureLogin()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
