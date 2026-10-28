import { contextBridge, ipcRenderer } from 'electron'
import type { AppData, ExportResult, ImportResult, LaozhengApi } from '../src/shared/types'
import type { LiveSource } from '../src/shared/live'

const api: LaozhengApi = {
  loadData: () => ipcRenderer.invoke('data:load') as Promise<AppData>,
  saveData: (data) => ipcRenderer.invoke('data:save', data) as Promise<void>,
  importData: () => ipcRenderer.invoke('data:import') as Promise<ImportResult>,
  exportData: (data) => ipcRenderer.invoke('data:export', data) as Promise<ExportResult>,
  openDataDir: () => ipcRenderer.invoke('data:openDir') as Promise<void>,
  dataDir: () => ipcRenderer.invoke('data:dir') as Promise<string>,
  appVersion: () => ipcRenderer.invoke('app:version') as Promise<string>,
  searchSubjects: (category, query) => ipcRenderer.invoke('subject:search', category, query),
  fetchSubjectDetail: (kind, id) => ipcRenderer.invoke('subject:detail', kind, id),
  searchVod: (source, keyword, year) => ipcRenderer.invoke('vod:search', source, keyword, year ?? ''),
  fetchVodDetail: (source, vodId) => ipcRenderer.invoke('vod:detail', source, vodId),
  testVodSource: (source) => ipcRenderer.invoke('vod:test', source),
  loadLiveSources: () => ipcRenderer.invoke('live:loadSources') as Promise<LiveSource[]>,
  saveLiveSources: (sources) => ipcRenderer.invoke('live:saveSources', sources) as Promise<void>,
  loadLiveChannels: (source) => ipcRenderer.invoke('live:channels', source),
  importLiveFile: () => ipcRenderer.invoke('live:importFile'),
  searchMusic: (keyword, page) => ipcRenderer.invoke('music:search', keyword, page ?? 1),
  resolveMusic: (songId) => ipcRenderer.invoke('music:resolve', songId),
  listDownloads: () => ipcRenderer.invoke('downloads:list'),
  addDownload: (input) => ipcRenderer.invoke('downloads:add', input),
  removeDownload: (id, deleteFile) => ipcRenderer.invoke('downloads:remove', id, deleteFile),
  cancelDownload: (id) => ipcRenderer.invoke('downloads:cancel', id),
  openDownloadsDir: () => ipcRenderer.invoke('downloads:openDir'),
  onDownloadsChanged: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('downloads:changed', handler)
    return () => ipcRenderer.removeListener('downloads:changed', handler)
  },
  xCategories: () => ipcRenderer.invoke('xsite:categories'),
  xList: (range, page, category) => ipcRenderer.invoke('xsite:list', range, page, category),
  xDetail: (urlCd) => ipcRenderer.invoke('xsite:detail', urlCd),
  pList: (sort, catId, query, page) => ipcRenderer.invoke('psite:list', sort, catId, query, page),
  pResolve: (vkey) => ipcRenderer.invoke('psite:resolve', vkey),
  melonList: (path) => ipcRenderer.invoke('melon:list', path),
  melonDetail: (id) => ipcRenderer.invoke('melon:detail', id),
  getSyncConfig: () => ipcRenderer.invoke('sync:getConfig'),
  saveSyncConfig: (input) => ipcRenderer.invoke('sync:saveConfig', input),
  testSync: () => ipcRenderer.invoke('sync:test'),
  uploadSync: (data) => ipcRenderer.invoke('sync:upload', data),
  downloadSync: () => ipcRenderer.invoke('sync:download'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  downloadUpdate: (url) => ipcRenderer.invoke('app:downloadUpdate', url),
  installUpdate: (path) => ipcRenderer.invoke('app:installUpdate', path) as Promise<void>,
  onUpdateProgress: (callback) => {
    const handler = (_e: unknown, progress: Parameters<typeof callback>[0]): void => callback(progress)
    ipcRenderer.on('update:progress', handler)
    return () => ipcRenderer.removeListener('update:progress', handler)
  },
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  loginAccount: (site) => ipcRenderer.invoke('accounts:login', site),
  openAccountLogin: (site) => ipcRenderer.invoke('accounts:openLogin', site) as Promise<void>,
  onAccountsChanged: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('accounts:changed', handler)
    return () => ipcRenderer.removeListener('accounts:changed', handler)
  },
  bikaCategories: () => ipcRenderer.invoke('bika:categories'),
  bikaList: (page, category, sort) => ipcRenderer.invoke('bika:list', page, category, sort),
  bikaSearch: (keyword, page, sort) => ipcRenderer.invoke('bika:search', keyword, page, sort),
  bikaDetail: (id) => ipcRenderer.invoke('bika:detail', id),
  bikaChapters: (id) => ipcRenderer.invoke('bika:chapters', id),
  bikaImages: (id, order) => ipcRenderer.invoke('bika:images', id, order),
  komiicRecent: (offset) => ipcRenderer.invoke('komiic:recent', offset),
  komiicHot: (offset) => ipcRenderer.invoke('komiic:hot', offset),
  komiicByCategory: (categoryId, offset) =>
    ipcRenderer.invoke('komiic:byCategory', categoryId, offset),
  komiicSearch: (keyword, offset) => ipcRenderer.invoke('komiic:search', keyword, offset),
  komiicCategories: () => ipcRenderer.invoke('komiic:categories'),
  komiicDetail: (id) => ipcRenderer.invoke('komiic:detail', id),
  komiicChapters: (comicId) => ipcRenderer.invoke('komiic:chapters', comicId),
  komiicImages: (comicId, chapterId) =>
    ipcRenderer.invoke('komiic:images', comicId, chapterId),
  wygamerHome: (page) => ipcRenderer.invoke('wygamer:home', page),
  wygamerSearch: (keyword, page) => ipcRenderer.invoke('wygamer:search', keyword, page),
  wygamerByCategory: (url, page) => ipcRenderer.invoke('wygamer:byCategory', url, page),
  wygamerCategories: () => ipcRenderer.invoke('wygamer:categories'),
  wygamerDetail: (id) => ipcRenderer.invoke('wygamer:detail', id),
  wygamerResolveDownload: (payUrl) => ipcRenderer.invoke('wygamer:resolveDownload', payUrl),
  zlibStatus: () => ipcRenderer.invoke('zlib:status'),
  zlibLogin: () => ipcRenderer.invoke('zlib:login'),
  zlibSearch: (keyword, page) => ipcRenderer.invoke('zlib:search', keyword, page),
  zlibDetail: (id, hash) => ipcRenderer.invoke('zlib:detail', id, hash),
  zlibDownload: (id, hash, title) => ipcRenderer.invoke('zlib:download', id, hash, title),
  addImageDownload: (input) => ipcRenderer.invoke('downloads:addImages', input),
  openDownloadItem: (id) => ipcRenderer.invoke('downloads:openItem', id) as Promise<void>,
  resolveLegacyMusic: (name, artists) =>
    ipcRenderer.invoke('music:resolveLegacy', name, artists)
}

contextBridge.exposeInMainWorld('laozheng', api)
