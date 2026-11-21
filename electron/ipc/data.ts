import { app, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'



import { exportToFile, importFromFile, loadData, saveData, saveDataSync } from '../store'
import { lastDialogDir, rememberDialogDir, applySettingsSnapshot } from '../settings'


import { listDataSnapshots, readDataSnapshot, writeDataSnapshot } from '../snapshots'

import { markBuiltinVodSources } from '../seed'



import { normalizeLiveSources, saveLiveSources } from '../live'















import { importDownloadRecords } from '../downloads'






















import { saveMagnetSources } from '../magnet'



import { clearApiCache } from '../apiCache'





import {
  mergeLocalPcFields,
  missingLocalPcFields,
  normalizeData,
  type AppData
} from '../../src/shared/types'







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
      // 用与导出 / 云同步同一份完整备份做快照：data.json 之外单独存储的
      // 电视源 / 下载记录 / 磁力源 / 本机设置也要能通过「恢复快照」回滚
      const payload = await buildBackupPayload(await loadData())
      const info = await writeDataSnapshot(
        snapshotsRoot(),
        typeof reason === 'string' ? reason : 'manual',
        payload
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
      const raw = JSON.parse(text) as unknown
      // 旧快照 / 不含 PC 扩展字段的快照：缺的字段保留本机现值，不能把本机数据清空
      return {
        ok: true,
        data: mergeLocalPcFields(raw, normalizeData(raw), await loadData()),
        missingLocalFields: missingLocalPcFields(raw)
      }
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
  ipcMain.handle(
    'data:applyExtras',
    async (
      _e,
      data: AppData,
      options?: { replaceDownloads?: boolean; skipDownloads?: boolean }
    ) => {
      if (!data || typeof data !== 'object') return
      // 先清接口缓存：导入后常驻模块会立即按新数据重新请求，清晚了可能命中导入前的列表
      await clearApiCache()
      if (data.settings && typeof data.settings === 'object') {
        await applySettingsSnapshot(data.settings)
      }
      if (Array.isArray(data.liveSources)) {
        await saveLiveSources(normalizeLiveSources(data.liveSources))
      }
      if (Array.isArray(data.magnetSources)) {
        await saveMagnetSources(data.magnetSources)
      }
      // 换机导入 / 云恢复不需要备份里的下载记录：记录跟着本机文件走
      // 只有「恢复本地快照」才处理下载记录，且整体替换才能回滚快照后的下载
      if (!options?.skipDownloads && Array.isArray(data.downloads)) {
        await importDownloadRecords(data.downloads, {
          replace: options?.replaceDownloads === true
        })
      }
      // 导入 / 云恢复的播放进度写回独立存储；备份没带进度时保留本机进度
      if (
        data.readProgress &&
        typeof data.readProgress === 'object' &&
        Object.keys(data.readProgress).length > 0
      ) {
        await progress().replaceAll(data.readProgress)
      }
    }
  )


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
      const { data, missingLocalFields } = await importFromFile(picked.filePaths[0])
      // 备份里的影视源补上内置标记：默认源不可删除
      await markBuiltinVodSources(data)
      return { canceled: false, data, missingLocalFields }
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
