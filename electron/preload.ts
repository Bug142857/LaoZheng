import { contextBridge, ipcRenderer } from 'electron'
import type { AppData, ExportResult, ImportResult, LaozhengApi } from '../src/shared/types'

const api: LaozhengApi = {
  loadData: () => ipcRenderer.invoke('data:load') as Promise<AppData>,
  saveData: (data) => ipcRenderer.invoke('data:save', data) as Promise<void>,
  importData: () => ipcRenderer.invoke('data:import') as Promise<ImportResult>,
  exportData: (data) => ipcRenderer.invoke('data:export', data) as Promise<ExportResult>,
  openDataDir: () => ipcRenderer.invoke('data:openDir') as Promise<void>,
  dataDir: () => ipcRenderer.invoke('data:dir') as Promise<string>,
  appVersion: () => ipcRenderer.invoke('app:version') as Promise<string>
}

contextBridge.exposeInMainWorld('laozheng', api)
