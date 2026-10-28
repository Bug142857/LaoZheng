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
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url)
}

contextBridge.exposeInMainWorld('laozheng', api)
