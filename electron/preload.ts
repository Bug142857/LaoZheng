import { contextBridge, ipcRenderer } from 'electron'
import type { AppData, ExportResult, ImportResult, LaozhengApi } from '../src/shared/types'
import type { LiveSource } from '../src/shared/live'
import type { NovelDownloadProgress } from '../src/shared/novel'

const api: LaozhengApi = {
  loadData: () => ipcRenderer.invoke('data:load') as Promise<AppData>,
  saveData: (data) => ipcRenderer.invoke('data:save', data) as Promise<void>,
  saveDataSync: (data) => {
    ipcRenderer.sendSync('data:saveSync', data)
  },
  applyBackupExtras: (data) => ipcRenderer.invoke('data:applyExtras', data) as Promise<void>,
  importData: () => ipcRenderer.invoke('data:import') as Promise<ImportResult>,
  exportData: (data) => ipcRenderer.invoke('data:export', data) as Promise<ExportResult>,
  exportLists: (bundle) => ipcRenderer.invoke('lists:export', bundle),
  importLists: () => ipcRenderer.invoke('lists:import'),
  openDataDir: () => ipcRenderer.invoke('data:openDir') as Promise<void>,
  dataDir: () => ipcRenderer.invoke('data:dir') as Promise<string>,
  appVersion: () => ipcRenderer.invoke('app:version') as Promise<string>,
  systemInfo: (force) => ipcRenderer.invoke('app:systemInfo', force === true),
  searchTrainers: (sources, keyword, page) =>
    ipcRenderer.invoke('trainers:search', sources, keyword, page),
  trainerDetail: (source, url) => ipcRenderer.invoke('trainers:detail', source, url),
  downloadTrainer: (input) => ipcRenderer.invoke('trainers:download', input),
  testTrainerSource: (source) => ipcRenderer.invoke('trainers:test', source),
  exportTrainerSources: (sources) => ipcRenderer.invoke('trainers:exportSources', sources),
  scanTrainerLibrary: () => ipcRenderer.invoke('trainers:scan'),
  runTrainer: (folder, exe) => ipcRenderer.invoke('trainers:run', folder, exe),
  openTrainerFolder: (folder) => ipcRenderer.invoke('trainers:openFolder', folder),
  deleteTrainer: (folder) => ipcRenderer.invoke('trainers:delete', folder),
  searchSubjects: (category, query) => ipcRenderer.invoke('subject:search', category, query),
  doubanHot: (kind, tag, pageStart, pageLimit) =>
    ipcRenderer.invoke('douban:hot', kind, tag, pageStart, pageLimit),
  fetchSubjectDetail: (kind, id) => ipcRenderer.invoke('subject:detail', kind, id),
  fetchSubjectFull: (kind, id) => ipcRenderer.invoke('subject:full', kind, id),
  fetchSubjectComments: (kind, id, order) =>
    ipcRenderer.invoke('subject:comments', kind, id, order),
  fetchPersonFull: (id) => ipcRenderer.invoke('subject:person', id),
  fetchSubjectCredits: (kind, id) => ipcRenderer.invoke('subject:credits', kind, id),
  saveImage: (url) => ipcRenderer.invoke('app:saveImage', url),
  wallpaperList: (source, category, page, keyword) =>
    ipcRenderer.invoke('wallpaper:list', source, category, page, keyword),
  wallpaperCategories: (source, device) =>
    ipcRenderer.invoke('wallpaper:categories', source, device),
  wallpaperResolve: (source, pageUrl, width, height) =>
    ipcRenderer.invoke('wallpaper:resolve', source, pageUrl, width, height),
  exportWallpaperSources: (sources) => ipcRenderer.invoke('wallpaper:exportSources', sources),
  searchVod: (source, keyword, year) => ipcRenderer.invoke('vod:search', source, keyword, year ?? ''),
  listVod: (source, page, typeId, keyword) =>
    ipcRenderer.invoke('vod:list', source, page, typeId, keyword),
  fetchVodDetail: (source, vodId) => ipcRenderer.invoke('vod:detail', source, vodId),
  testVodSource: (source) => ipcRenderer.invoke('vod:test', source),
  vodCategories: (source) => ipcRenderer.invoke('vod:categories', source),
  exportVodSources: (sources) => ipcRenderer.invoke('vod:exportSources', sources),
  exportH1Sources: (sources) => ipcRenderer.invoke('h1:exportSources', sources),
  magnetState: () => ipcRenderer.invoke('magnet:state'),
  saveMagnetSources: (sources) => ipcRenderer.invoke('magnet:saveSources', sources),
  resetMagnetSources: () => ipcRenderer.invoke('magnet:resetSources'),
  exportMagnetSources: (sources) => ipcRenderer.invoke('magnet:exportSources', sources),
  importMagnetSources: () => ipcRenderer.invoke('magnet:importSources'),
  openMagnetLog: () => ipcRenderer.invoke('magnet:openLog') as Promise<void>,
  testMagnetSource: (source) => ipcRenderer.invoke('magnet:test', source),
  searchMagnet: (source, keyword, page, options) =>
    ipcRenderer.invoke('magnet:search', source, keyword, page, options),
  searchMagnetAll: (sources, keyword, options) =>
    ipcRenderer.invoke('magnet:searchAll', sources, keyword, options),
  openMagnet: (magnet) => ipcRenderer.invoke('magnet:open', magnet) as Promise<void>,
  loadLiveSources: () => ipcRenderer.invoke('live:loadSources') as Promise<LiveSource[]>,
  saveLiveSources: (sources) => ipcRenderer.invoke('live:saveSources', sources) as Promise<void>,
  loadLiveChannels: (source) => ipcRenderer.invoke('live:channels', source),
  testLiveSource: (source) => ipcRenderer.invoke('live:test', source),
  exportLiveSources: (sources) => ipcRenderer.invoke('live:exportSources', sources),
  importLiveFile: () => ipcRenderer.invoke('live:importFile'),
  livePlatformCategories: (platform) => ipcRenderer.invoke('livePlatform:categories', platform),
  livePlatformList: (platform, kind, params) =>
    ipcRenderer.invoke('livePlatform:list', platform, kind, params),
  livePlatformRoom: (platform, input, qualityId) =>
    ipcRenderer.invoke('livePlatform:room', platform, input, qualityId),
  livePlatformLoginStatus: (platform) =>
    ipcRenderer.invoke('livePlatform:loginStatus', platform),
  livePlatformQrStart: () => ipcRenderer.invoke('livePlatform:qrStart'),
  livePlatformQrPoll: (key) => ipcRenderer.invoke('livePlatform:qrPoll', key),
  livePlatformOpenLogin: (platform) =>
    ipcRenderer.invoke('livePlatform:openLogin', platform),
  livePlatformLogout: (platform) => ipcRenderer.invoke('livePlatform:logout', platform),
  livePlatformTestSource: (source) => ipcRenderer.invoke('livePlatform:testSource', source),
  livePlatformExportSources: (sources) =>
    ipcRenderer.invoke('livePlatform:exportSources', sources),
  searchMusic: (sources, keyword, page) =>
    ipcRenderer.invoke('music:search', sources, keyword, page ?? 1),
  resolveMusic: (songId, platform, baseUrl, title, artists, quality) =>
    ipcRenderer.invoke(
      'music:resolve',
      songId,
      platform ?? 'mvmp3',
      baseUrl,
      title,
      artists,
      quality
    ),
  testMusicSource: (source) => ipcRenderer.invoke('music:testSource', source),
  exportMusicSources: (sources) => ipcRenderer.invoke('music:exportSources', sources),
  saveMusicLyrics: (input) => ipcRenderer.invoke('music:saveLyrics', input),
  listDownloads: () => ipcRenderer.invoke('downloads:list'),
  addDownload: (input) => ipcRenderer.invoke('downloads:add', input),
  removeDownload: (id, deleteFile) => ipcRenderer.invoke('downloads:remove', id, deleteFile),
  cancelDownload: (id) => ipcRenderer.invoke('downloads:cancel', id),
  openDownloadsDir: (kind) => ipcRenderer.invoke('downloads:openDir', kind),
  downloadRoot: () => ipcRenderer.invoke('downloads:root') as Promise<string>,
  chooseDownloadRoot: () => ipcRenderer.invoke('downloads:chooseRoot'),
  changeDownloadRoot: (root, move) => ipcRenderer.invoke('downloads:changeRoot', root, move),
  cacheInfo: () => ipcRenderer.invoke('app:cacheInfo'),
  clearCache: () => ipcRenderer.invoke('app:clearCache'),
  chooseCacheDir: () => ipcRenderer.invoke('app:chooseCacheDir'),
  getUiSettings: () => ipcRenderer.invoke('settings:getUi'),
  setUiSettings: (input) => ipcRenderer.invoke('settings:setUi', input),
  getNavOrder: () => ipcRenderer.invoke('settings:getNavOrder'),
  setNavOrder: (order) => ipcRenderer.invoke('settings:setNavOrder', order),
  doubanStatus: () => ipcRenderer.invoke('douban:status'),
  doubanLogin: () => ipcRenderer.invoke('douban:login'),
  doubanLogout: () => ipcRenderer.invoke('douban:logout'),
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
  pCategoryCount: (catId) => ipcRenderer.invoke('psite:categoryCount', catId),
  melonList: (path) => ipcRenderer.invoke('melon:list', path),
  melonDetail: (id) => ipcRenderer.invoke('melon:detail', id),
  melonCategoryCounts: () => ipcRenderer.invoke('melon:counts'),
  trackMelonImages: (urls) => ipcRenderer.invoke('melon:trackImages', urls),
  melonImage: (url) => ipcRenderer.invoke('melon:image', url),
  melonDuration: (url) => ipcRenderer.invoke('melon:duration', url),
  dramaCatalog: (source, genre, page, keyword) =>
    ipcRenderer.invoke('drama:catalog', source, genre, page, keyword),
  dramaDetail: (source, seriesId) => ipcRenderer.invoke('drama:detail', source, seriesId),
  dramaPlay: (source, seriesId, episodeId) =>
    ipcRenderer.invoke('drama:play', source, seriesId, episodeId),
  exportDramaSources: (sources) => ipcRenderer.invoke('drama:exportSources', sources),
  novelHome: (source) => ipcRenderer.invoke('novel:home', source),
  novelSearch: (source, keyword) => ipcRenderer.invoke('novel:search', source, keyword),
  novelCategory: (source, categoryId, page) =>
    ipcRenderer.invoke('novel:category', source, categoryId, page),
  novelDetail: (source, bookId) => ipcRenderer.invoke('novel:detail', source, bookId),
  novelChapter: (source, bookId, chapterId) =>
    ipcRenderer.invoke('novel:chapter', source, bookId, chapterId),
  novelDownload: (input) => ipcRenderer.invoke('novel:download', input),
  onNovelDownloadProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: NovelDownloadProgress): void =>
      callback(progress)
    ipcRenderer.on('novel:downloadProgress', handler)
    return () => ipcRenderer.removeListener('novel:downloadProgress', handler)
  },
  testNovelSource: (source) => ipcRenderer.invoke('novel:test', source),
  exportNovelSources: (sources) => ipcRenderer.invoke('novel:exportSources', sources),
  exportAllSources: (bundle) => ipcRenderer.invoke('sources:exportAll', bundle),
  importAllSources: () => ipcRenderer.invoke('sources:importAll'),
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
  bikaCategoryCounts: () => ipcRenderer.invoke('bika:counts'),
  bikaList: (page, category, sort) => ipcRenderer.invoke('bika:list', page, category, sort),
  bikaSearch: (keyword, page, sort) => ipcRenderer.invoke('bika:search', keyword, page, sort),
  bikaDetail: (id) => ipcRenderer.invoke('bika:detail', id),
  bikaChapters: (id) => ipcRenderer.invoke('bika:chapters', id),
  bikaImages: (id, order) => ipcRenderer.invoke('bika:images', id, order),
  komiicRecent: (offset, status) => ipcRenderer.invoke('komiic:recent', offset, status ?? ''),
  komiicHot: (offset) => ipcRenderer.invoke('komiic:hot', offset),
  komiicByCategory: (categoryId, offset) =>
    ipcRenderer.invoke('komiic:byCategory', categoryId, offset),
  komiicSearch: (keyword, offset) => ipcRenderer.invoke('komiic:search', keyword, offset),
  komiicCategories: () => ipcRenderer.invoke('komiic:categories'),
  komiicDetail: (id) => ipcRenderer.invoke('komiic:detail', id),
  komiicChapters: (comicId) => ipcRenderer.invoke('komiic:chapters', comicId),
  komiicImages: (comicId, chapterId) =>
    ipcRenderer.invoke('komiic:images', comicId, chapterId),
  yumanhuaRecent: (baseUrl, sourceId) =>
    ipcRenderer.invoke('yumanhua:recent', baseUrl, sourceId),
  yumanhuaHot: (baseUrl, sourceId) => ipcRenderer.invoke('yumanhua:hot', baseUrl, sourceId),
  yumanhuaCategory: (categoryId, baseUrl, sourceId) =>
    ipcRenderer.invoke('yumanhua:category', categoryId, baseUrl, sourceId),
  yumanhuaSearch: (keyword, baseUrl, sourceId) =>
    ipcRenderer.invoke('yumanhua:search', keyword, baseUrl, sourceId),
  yumanhuaDetail: (id, baseUrl) => ipcRenderer.invoke('yumanhua:detail', id, baseUrl),
  yumanhuaChapters: (id, baseUrl) => ipcRenderer.invoke('yumanhua:chapters', id, baseUrl),
  yumanhuaImages: (comicId, chapterId, baseUrl) =>
    ipcRenderer.invoke('yumanhua:images', comicId, chapterId, baseUrl),
  testComicSource: (source) => ipcRenderer.invoke('comic:testSource', source),
  exportComicSources: (sources) => ipcRenderer.invoke('comic:exportSources', sources),
  wygamerHome: (page) => ipcRenderer.invoke('wygamer:home', page),
  wygamerSearch: (keyword, page) => ipcRenderer.invoke('wygamer:search', keyword, page),
  wygamerByCategory: (url, page) => ipcRenderer.invoke('wygamer:byCategory', url, page),
  wygamerCategories: () => ipcRenderer.invoke('wygamer:categories'),
  wygamerDetail: (id) => ipcRenderer.invoke('wygamer:detail', id),
  wygamerResolveDownload: (payUrl) => ipcRenderer.invoke('wygamer:resolveDownload', payUrl),
  zlibStatus: () => ipcRenderer.invoke('zlib:status'),
  zlibLogin: () => ipcRenderer.invoke('zlib:login'),
  zlibLogout: () => ipcRenderer.invoke('zlib:logout'),
  saveZlibCredentials: (username, password) =>
    ipcRenderer.invoke('zlib:saveCredentials', username, password),
  zlibSearch: (keyword, page) => ipcRenderer.invoke('zlib:search', keyword, page),
  zlibDetail: (id, hash) => ipcRenderer.invoke('zlib:detail', id, hash),
  zlibDownload: (id, hash, title) => ipcRenderer.invoke('zlib:download', id, hash, title),
  addComicBatchDownload: (input) => ipcRenderer.invoke('downloads:addComicBatch', input),
  openDownloadItem: (id) => ipcRenderer.invoke('downloads:openItem', id) as Promise<void>,
  openDownloadFolder: (id) => ipcRenderer.invoke('downloads:openFolder', id) as Promise<void>,
  setWallpaper: (id) => ipcRenderer.invoke('downloads:setWallpaper', id) as Promise<void>,
  runDownloadTrainer: (id) => ipcRenderer.invoke('downloads:runTrainer', id) as Promise<void>,
  playDownloadItem: (id) => ipcRenderer.invoke('downloads:playItem', id) as Promise<void>,
  readDownloadItem: (id) => ipcRenderer.invoke('downloads:readItem', id),
  resolveLegacyMusic: (name, artists) =>
    ipcRenderer.invoke('music:resolveLegacy', name, artists)
}

contextBridge.exposeInMainWorld('laozheng', api)
