import { app, dialog, ipcMain, shell } from 'electron'
import { basename, join } from 'node:path'

import { readFile, writeFile } from 'node:fs/promises'

import { writeJsonAtomic } from '../store'
import { downloadRoot, lastDialogDir, rememberDialogDir, setUiSettings, uiSettings } from '../settings'
import { cacheInfo, chooseCacheDir, clearCache } from '../cacheManager'



import { markBuiltinVodSources, saveDefaultToolNote, saveSingingVideoDefault } from '../seed'



import { makeLocalSource } from '../live'










import { resolveLegacyMusic } from '../music'

import { collectSystemInfo } from '../sysinfo'
import {
  deleteTrainer,
  downloadTrainer,
  openTrainerFolder,
  runTrainer,
  scanTrainerLibrary,
  searchTrainers,
  testTrainerSource,
  trainerDetail
} from '../trainers'
import type { TrainerDownloadInput, TrainerSourceInput } from '../../src/shared/trainers'
import { addComicBatchDownload, addDownload, cancelTask, changeDownloadRoot, listDownloads, pauseTask, refreshDownloads, resumeTask, openDownloadItem, openDownloadFolder, openDownloadsDir, playDownloadItem, readDownloadItem, removeDownload, runTrainerDownload, setDownloadWallpaper, setWallpaperFromUrl } from '../downloads'
import type { ComicBatchDownloadInput, DownloadAddInput, DownloadKind } from '../../src/shared/downloads'
























import { downloadSync, getSyncConfig, saveSyncConfig, testSync, uploadSync } from '../sync'
import { cachedResponse, forceApiCache } from '../apiCache'

import type { SyncConfigInput } from '../../src/shared/sync'

import type { UpdateDownloadResult } from '../../src/shared/update'

import { type AppData } from '../../src/shared/types'




import type { UiSettings } from '../../src/shared/settings'



import {
  cancelUpdateDownload,
  checkUpdateInternal,
  displayVersion,
  downloadUpdateInstaller,
  installUpdateInstaller,
  pauseUpdateDownload,
  resumeUpdateDownload,
  takePendingUpdateNotice
} from '../updateManager'

import { buildBackupPayload, saveImageToFile, stamp, TRAINER_CACHE_VERSION } from './shared'

export function registerSystemIpc(): void {
  ipcMain.handle('downloads:list', () => listDownloads())

  ipcMain.handle('downloads:refresh', () => refreshDownloads())

  ipcMain.handle('downloads:add', (_e, input: DownloadAddInput) => {
    if (!input || typeof input !== 'object') return { ok: false, error: '参数无效' }
    const { title, url, kind } = input
    if (
      typeof title !== 'string' ||
      title.length > 200 ||
      typeof url !== 'string' ||
      !/^https?:\/\//i.test(url) ||
      !['video', 'music', 'comic', 'book', 'novel', 'wallpaper', 'meitu', 'trainer', 'file'].includes(
        kind
      )
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

  ipcMain.handle('downloads:pause', (_e, id: string) => {
    if (typeof id === 'string') return pauseTask(id)
    return undefined
  })

  ipcMain.handle('downloads:resume', (_e, id: string) => {
    if (typeof id === 'string') return resumeTask(id)
    return undefined
  })

  ipcMain.handle('downloads:openDir', (_e, kind?: DownloadKind) => openDownloadsDir(kind))

  ipcMain.handle('downloads:root', () => downloadRoot())

  ipcMain.handle('downloads:chooseRoot', async () => {
    const picked = await dialog.showOpenDialog({
      title: '选择下载总目录',
      defaultPath: lastDialogDir('downloadRoot', downloadRoot()),
      properties: ['openDirectory', 'createDirectory']
    })
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true }
    await rememberDialogDir('downloadRoot', picked.filePaths[0], true)
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
  ipcMain.handle('app:chooseCacheDir', () => chooseCacheDir())

  // 用户点标题 / 刷新按钮时，让对应模块的接口缓存短时间失效，直接拉最新数据
  const FORCE_REFRESH_PREFIXES: Record<string, string[]> = {
    watch: ['vod:', 'subject:'],
    search: ['vod:', 'subject:'],
    drama: ['drama:'],
    live: ['live:'],
    liveRooms: ['livePlatform:'],
    music: ['music:'],
    comic: ['bika:', 'komiic:', 'yumanhua:', 'bikahub:', 'tptoon:', 'jmcomic:'],
    novel: ['novel:', 'bikahub:'],
    melon: ['melon:'],
    news: ['news:'],
    game: ['wygamer:'],
    emu: ['emu:'],
    book: ['zlib:'],
    wallpaper: ['wallpaper:'],
    meitu: ['meitu:'],
    gamecheat: ['trainers:'],
    shuangkan: ['shuangkan:'],
    psite: ['psite:'],
    xsite: ['xsite:']
  }
  ipcMain.handle('cache:forceRefresh', (_e, scope: unknown) => {
    const prefixes = typeof scope === 'string' ? FORCE_REFRESH_PREFIXES[scope] : undefined
    if (prefixes?.length) forceApiCache(prefixes)
    return { ok: true }
  })

  ipcMain.handle('settings:getUi', () => uiSettings())
  ipcMain.handle('settings:setUi', (_e, input: Partial<UiSettings>) => {
    if (!input || typeof input !== 'object') throw new Error('参数无效')
    return setUiSettings(input)
  })


  ipcMain.handle('downloads:openItem', (_e, id: string) => {
    if (typeof id !== 'string') throw new Error('参数无效')
    return openDownloadItem(id)
  })

  ipcMain.handle('downloads:openFolder', (_e, id: string) => {
    if (typeof id !== 'string') throw new Error('参数无效')
    return openDownloadFolder(id)
  })

  ipcMain.handle('downloads:setWallpaper', (_e, id: string) => {
    if (typeof id !== 'string' || !id) throw new Error('参数无效')
    return setDownloadWallpaper(id)
  })

  // 壁纸详情页：远程原图直接设为桌面壁纸
  ipcMain.handle('wallpaper:setFromUrl', (_e, url: unknown, referer: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || url.length > 2_000_000) {
      throw new Error('壁纸地址无效')
    }
    return setWallpaperFromUrl(url, typeof referer === 'string' ? referer : undefined)
  })

  ipcMain.handle('downloads:runTrainer', (_e, id: string) => {
    if (typeof id !== 'string') throw new Error('参数无效')
    return runTrainerDownload(id)
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

  ipcMain.handle('app:pendingUpdate', () => takePendingUpdateNotice())

  ipcMain.handle(
    'app:downloadUpdate',
    async (_e, url: string, sha256?: unknown): Promise<UpdateDownloadResult> => {
      if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
        return { ok: false, error: '更新地址无效' }
      }
      return downloadUpdateInstaller(url, typeof sha256 === 'string' ? sha256 : undefined)
    }
  )

  ipcMain.handle('app:pauseUpdate', () => pauseUpdateDownload())

  ipcMain.handle('app:resumeUpdate', () => resumeUpdateDownload())

  ipcMain.handle('app:cancelUpdate', () => cancelUpdateDownload())

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

  // 使用经验里的小配置文件：只接受 octet-stream data URL（≤1MB），存到用户选择的路径
  ipcMain.handle('app:saveNoteFile', async (_e, name: unknown, dataUrl: unknown) => {
    const prefix = 'data:application/octet-stream;base64,'
    if (typeof name !== 'string' || typeof dataUrl !== 'string') {
      return { ok: false, error: '参数无效' }
    }
    if (!dataUrl.startsWith(prefix) || dataUrl.length > 1_500_000) {
      return { ok: false, error: '文件内容无效或超过 1MB' }
    }
    const safeName = name.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 120) || '配置文件'
    const picked = await dialog.showSaveDialog({
      title: '保存配置文件',
      defaultPath: join(app.getPath('downloads'), safeName)
    })
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
    try {
      await writeFile(picked.filePath, Buffer.from(dataUrl.slice(prefix.length), 'base64'))
      return { ok: true, path: picked.filePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '保存失败' }
    }
  })

  // 老郑专用：软件经验与演唱默认视频写回种子，随下个版本更新给用户
  ipcMain.handle('app:saveToolNoteDefault', (_e, toolId: unknown, html: unknown) => {
    if (typeof toolId !== 'string' || typeof html !== 'string') return false
    return saveDefaultToolNote(toolId, html)
  })
  ipcMain.handle('app:saveSingingVideoDefault', (_e, video: unknown) =>
    saveSingingVideoDefault(video)
  )

  ipcMain.handle('sync:test', () => testSync())
  ipcMain.handle('sync:upload', async (_e, data: AppData) =>
    uploadSync(await buildBackupPayload(data))
  )
  ipcMain.handle('sync:download', async () => {
    const result = await downloadSync()
    // 备份里的影视源补上内置标记：默认源不可删除
    if (result.data) await markBuiltinVodSources(result.data as AppData)
    return result
  })

  ipcMain.handle('live:importFile', async () => {
    const picked = await dialog.showOpenDialog({
      title: '导入 M3U 直播源',
      defaultPath: lastDialogDir('live', app.getPath('documents')),
      properties: ['openFile'],
      filters: [{ name: 'M3U 播放列表', extensions: ['m3u', 'm3u8', 'txt'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
    const file = picked.filePaths[0]
    await rememberDialogDir('live', file)
    try {
      const text = await readFile(file, 'utf8')
      if (!text.trim()) return { canceled: false, error: '文件内容为空' }
      return { canceled: false, source: makeLocalSource(basename(file), text) }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })


  ipcMain.handle('app:version', () => displayVersion())

  ipcMain.handle('app:systemInfo', (_e, force: unknown) => collectSystemInfo(force === true))

  // ---------- 游戏修改（多源训练器） ----------
  ipcMain.handle(
    'trainers:search',
    (_e, sources: TrainerSourceInput[], keyword: string, page: number) => {
      if (
        !Array.isArray(sources) ||
        sources.length === 0 ||
        sources.length > 8 ||
        typeof keyword !== 'string' ||
        keyword.length > 80 ||
        !Number.isInteger(page) ||
        page < 1 ||
        page > 500
      ) {
        return { ok: false, items: [], page: 1, hasMore: false, error: '参数无效' }
      }
      const key = sources
        .map((source) => `${source?.id ?? ''}:${source?.type ?? ''}:${source?.baseUrl ?? ''}`)
        .join(',')
      return cachedResponse(
        `trainers:v${TRAINER_CACHE_VERSION}:search|${key}|${keyword.trim()}|${page}`,
        30 * 60 * 1000,
        () => searchTrainers(sources, keyword, page)
      )
    }
  )


  ipcMain.handle('trainers:detail', (_e, source: TrainerSourceInput, url: string) => {
    if (!source || typeof source !== 'object' || typeof url !== 'string' || url.length > 500) {
      return { ok: false, trainer: null, error: '参数无效' }
    }
    const key = `${source.type ?? ''}|${source.baseUrl ?? ''}|${url}`
    return cachedResponse(
      `trainers:v${TRAINER_CACHE_VERSION}:detail|${key}`,
      12 * 60 * 60 * 1000,
      () => trainerDetail(source, url)
    )
  })

  ipcMain.handle('trainers:test', (_e, source: TrainerSourceInput) => {
    if (!source || typeof source !== 'object') return { ok: false, error: '参数无效' }
    return testTrainerSource(source)
  })

  // 导出修改器源为 JSON（名称 / 类型 / 地址 / 启用状态）
  ipcMain.handle('trainers:exportSources', async (_e, sources: unknown) => {
    const list = Array.isArray(sources) ? sources : []
    const picked = await dialog.showSaveDialog({
      title: '导出修改器源',
      defaultPath: join(
        lastDialogDir('trainer', app.getPath('documents')),
        `老郑分享-修改器源-${stamp()}.json`
      ),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await rememberDialogDir('trainer', picked.filePath)
    try {
      const rows = list
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          type:
            s.type === 'fling' ||
            s.type === '3dm' ||
            s.type === 'gamersky' ||
            s.type === 'ali213'
              ? s.type
              : 'fling',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
          enabled: s.enabled !== false
        }))
        .filter((s) => /^https?:\/\//i.test(s.baseUrl))
      await writeJsonAtomic(picked.filePath, rows)
      return { canceled: false, path: picked.filePath, count: rows.length }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('trainers:download', (_e, input: TrainerDownloadInput) => {
    if (!input || typeof input !== 'object') return { ok: false, error: '参数无效' }
    return downloadTrainer(input)
  })

  ipcMain.handle('trainers:scan', () => scanTrainerLibrary())

  ipcMain.handle('trainers:run', (_e, folder: string, exe: string) => {
    if (typeof folder !== 'string' || typeof exe !== 'string') {
      return { ok: false, error: '参数无效' }
    }
    return runTrainer(folder, exe)
  })

  ipcMain.handle('trainers:openFolder', (_e, folder?: string) => {
    if (folder !== undefined && typeof folder !== 'string') {
      return { ok: false, error: '参数无效' }
    }
    return openTrainerFolder(folder)
  })

  ipcMain.handle('trainers:delete', (_e, folder: string) => {
    if (typeof folder !== 'string') return { ok: false, error: '参数无效' }
    return deleteTrainer(folder)
  })


}
