import { app, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'



import { dataFilePath, exportToFile, importFromFile, loadData, saveData, saveDataSync } from '../store'
import { lastDialogDir, rememberDialogDir, applySettingsSnapshot } from '../settings'


import { createDataSnapshot, listDataSnapshots, readDataSnapshot } from '../snapshots'

import { markBuiltinVodSources } from '../seed'



import { normalizeLiveSources, saveLiveSources } from '../live'















import { importDownloadRecords } from '../downloads'






















import { saveMagnetSources } from '../magnet'



import { clearApiCache } from '../apiCache'





import { normalizeData, type AppData } from '../../src/shared/types'







import { progress } from '../progress'


import { buildBackupPayload, snapshotsRoot, isAppDataShape, stamp } from './shared'

export function registerDataIpc(): void {
  // 磁力搜索结果只在本次运行期间保留：应用重启后从空结果开始
  ipcMain.handle('data:load', async () => {
    const data = await loadData()
    // 播放进度独立存储：启动时合并进度文件（进度文件为准），旧数据首次启动时迁移进去
    const stored = await progress().load()
    const mergedProgress = { ...data.readProgress, ...stored }
    if (!Object.keys(stored).length && Object.keys(data.readProgress).length) {
      await progress().replaceAll(data.readProgress)
    }
    const next: AppData = { ...data, readProgress: mergedProgress }
    if (!data.magnetSearch) return next
    const cleaned: AppData = { ...next, magnetSearch: undefined }
    await saveData(cleaned).catch((err) => console.error('[data] 清理磁力搜索缓存失败', err))
    return cleaned
  })

  // 播放进度只提交 key + seconds，内存立即更新、磁盘按窗口批量写入
  ipcMain.handle('data:setProgress', async (_e, key: unknown, value: unknown) => {
    await progress().set(String(key ?? ''), String(value ?? ''))
  })

  ipcMain.handle('data:flushProgress', () => progress().flush())

  // 覆盖前快照：整体导入 / 云恢复前由渲染层调用，失败则中止覆盖
  ipcMain.handle('data:snapshot', async (_e, reason: unknown) => {
    try {
      const info = await createDataSnapshot(
        snapshotsRoot(),
        dataFilePath(),
        typeof reason === 'string' ? reason : 'manual',
        // 快照生成前把主进程内存里的最新播放 / 阅读进度一起写进去
        progress().peek()
      )
      return { ok: true, snapshot: info }
    } catch (err) {
      console.error('[data] 创建本地快照失败', err)
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('data:snapshots', () => listDataSnapshots(snapshotsRoot()))

  ipcMain.handle('data:restoreSnapshot', async (_e, name: unknown) => {
    if (typeof name !== 'string' || !name) return { ok: false, error: '快照名称无效' }
    try {
      const text = await readDataSnapshot(snapshotsRoot(), name)
      return { ok: true, data: normalizeData(JSON.parse(text)) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

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
    if (Array.isArray(data.magnetSources)) {
      await saveMagnetSources(data.magnetSources)
    }
    if (Array.isArray(data.downloads)) {
      await importDownloadRecords(data.downloads)
    }
    // 导入 / 云恢复的播放进度写回独立存储
    if (data.readProgress && typeof data.readProgress === 'object') {
      await progress().replaceAll(data.readProgress)
    }
    // 旧数据可能已被导入的备份替换：清掉接口缓存，避免页面继续显示导入前的列表
    await clearApiCache()
  })


  ipcMain.handle('data:save', async (_e, data: AppData) => {
    // 轻量结构校验：渲染层异常数据不落盘，避免写坏 data.json 后下次启动变成空数据
    if (!isAppDataShape(data)) {
      console.error('[data] 拒绝保存结构非法的数据')
      throw new Error('数据结构异常，已拒绝保存')
    }
    await saveData(data)
  })


  ipcMain.handle('data:dir', () => app.getPath('userData'))

  ipcMain.handle('data:openDir', async () => {
    const err = await shell.openPath(app.getPath('userData'))
    if (err) throw new Error(err)
  })

  ipcMain.handle('data:import', async () => {
    const picked = await dialog.showOpenDialog({
      title: '导入备份',
      defaultPath: lastDialogDir('data', app.getPath('documents')),
      properties: ['openFile'],
      filters: [{ name: '备份 JSON', extensions: ['json'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
    await rememberDialogDir('data', picked.filePaths[0])
    try {
      const data = await importFromFile(picked.filePaths[0])
      // 备份里的影视源补上内置标记：默认源不可删除
      await markBuiltinVodSources(data)
      return { canceled: false, data }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('data:export', async (_e, data: AppData) => {
    const picked = await dialog.showSaveDialog({
      title: '导出备份',
      defaultPath: join(
        lastDialogDir('data', app.getPath('documents')),
        `老郑分享备份-${stamp()}.json`
      ),
      filters: [{ name: '备份 JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await rememberDialogDir('data', picked.filePath)
    try {
      await exportToFile(picked.filePath, await buildBackupPayload(data))
      return { canceled: false, path: picked.filePath }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })

}
