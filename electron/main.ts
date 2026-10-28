import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron'
import { basename, join } from 'node:path'
import { readFile } from 'node:fs/promises'
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
import { resolveMusic, searchMusic } from './music'
import {
  addDownload,
  cancelTask,
  listDownloads,
  openDownloadsDir,
  removeDownload,
  startMediaServer
} from './downloads'
import type { DownloadAddInput } from '../src/shared/downloads'
import { xCategories, xDetail, xList } from './xsite'
import { pList, pResolve } from './psite'
import { melonDetail, melonList } from './melon'
import {
  downloadSync,
  getSyncConfig,
  saveSyncConfig,
  testSync,
  uploadSync
} from './sync'
import type { SyncConfigInput } from '../src/shared/sync'
import { compareVersions } from '../src/shared/update'
import type { UpdateCheckResult } from '../src/shared/update'
import type { LiveSource } from '../src/shared/live'
import type { AppData } from '../src/shared/types'
import type { SearchCategory, SubjectKind } from '../src/shared/douban'
import type { VodSourceInput } from '../src/shared/vod'

const isDev = !app.isPackaged

function createWindow(): void {
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
}

const IMAGE_REFERER = 'https://m.douban.com/'
const IMAGE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
const IMAGE_URLS = ['*://*.doubanio.com/*', '*://*.douban.com/*']
const VOD_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'

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

  ipcMain.handle('sync:getConfig', () => getSyncConfig())

  ipcMain.handle('sync:saveConfig', (_e, input: SyncConfigInput) => {
    if (!input || typeof input !== 'object') throw new Error('参数无效')
    return saveSyncConfig({
      url: typeof input.url === 'string' ? input.url.slice(0, 500) : '',
      username: typeof input.username === 'string' ? input.username.slice(0, 200) : '',
      password: typeof input.password === 'string' ? input.password.slice(0, 200) : undefined
    })
  })

  ipcMain.handle('app:checkUpdate', async (): Promise<UpdateCheckResult> => {
    const current = app.getVersion()
    try {
      const res = await fetch('https://api.github.com/repos/Bug142857/LaoZheng/releases/latest', {
        headers: { 'User-Agent': 'laozheng-pc', Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15_000)
      })
      if (res.status === 404) return { ok: true, current, hasUpdate: false }
      if (!res.ok) return { ok: false, current, error: `GitHub 返回 HTTP ${res.status}` }
      const json = (await res.json()) as {
        tag_name?: string
        html_url?: string
        body?: string
      }
      const tag = (json.tag_name ?? '').trim()
      if (!tag) return { ok: false, current, error: 'Release 缺少版本号' }
      const latest = tag.replace(/^v/i, '')
      return {
        ok: true,
        current,
        latest,
        hasUpdate: compareVersions(latest, current) > 0,
        url: json.html_url,
        notes: (json.body ?? '').slice(0, 2000)
      }
    } catch (err) {
      return {
        ok: false,
        current,
        error:
          err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
            ? '检查更新超时'
            : '检查更新失败（网络不可用）'
      }
    }
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

  ipcMain.handle('app:version', () => app.getVersion())

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
    setupRequestRules()
    registerIpc()
    await startMediaServer()
    createWindow()
    console.log('[app] data file:', dataFilePath())

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
