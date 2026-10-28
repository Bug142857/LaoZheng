import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import { dataFilePath, exportToFile, importFromFile, loadData, saveData } from './store'
import type { AppData } from '../src/shared/types'

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

function registerIpc(): void {
  ipcMain.handle('data:load', () => loadData())

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

  app.whenReady().then(() => {
    app.setAppUserModelId('com.laozheng.pc')
    Menu.setApplicationMenu(null)
    registerIpc()
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
