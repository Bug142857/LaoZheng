import { app, dialog, ipcMain } from 'electron'
import { join } from 'node:path'

import { readFile, writeFile } from 'node:fs/promises'

import { writeJsonAtomic } from '../store'
import { lastDialogDir, rememberDialogDir } from '../settings'







import { listVodSource } from '../vod'
import { normalizeLiveSources } from '../live'





import { isWallpaperTemplate } from '../../src/shared/wallpaper'

import { isMeituTemplate } from '../../src/shared/meitu'















import { isSkAdapter } from '../../src/shared/shuangkan'














import {
  exportMagnetSources,
  importMagnetSources,
  loadMagnetState,
  openMagnet,
  openMagnetLog,
  resetMagnetSources,
  saveMagnetSources,
  searchMagnetAll,
  searchMagnetSource,
  testMagnetSource
} from '../magnet'
import type { MagnetOptions, MagnetSource } from '../../src/shared/magnet'


import { cachedResponse } from '../apiCache'







import type { VodSourceInput } from '../../src/shared/vod'

import { NOVEL_SOURCE_TEMPLATES, type NovelSourceTemplate } from '../../src/shared/novel'






import { isVodSourceInput, stamp } from './shared'

export function registerSourcesIpc(): void {
  ipcMain.handle('comic:exportSources', async (_e, sources: unknown) => {
    const list = Array.isArray(sources) ? sources : []
    const picked = await dialog.showSaveDialog({
      title: '导出漫画源',
      defaultPath: join(
        lastDialogDir('comic', app.getPath('documents')),
        `老郑分享-漫画源-${stamp()}.json`
      ),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await rememberDialogDir('comic', picked.filePath)
    try {
      const rows = list
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
          template:
            s.template === 'komiic' ||
            s.template === 'bikahub' ||
            s.template === 'tptoon' ||
            s.template === 'jmcomic'
              ? s.template
              : 'yumanhua',
          enabled: s.enabled !== false
        }))
        .filter((s) => /^https?:\/\//i.test(s.baseUrl))
      await writeJsonAtomic(picked.filePath, rows)
      return { canceled: false, path: picked.filePath, count: rows.length }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })

  // 导出小说书源为 JSON（名称 / 地址 / 解析模板 / 启用状态）
  ipcMain.handle('novel:exportSources', async (_e, sources: unknown) => {
    const list = Array.isArray(sources) ? sources : []
    const picked = await dialog.showSaveDialog({
      title: '导出小说书源',
      defaultPath: join(
        lastDialogDir('novel', app.getPath('documents')),
        `老郑分享-小说书源-${stamp()}.json`
      ),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await rememberDialogDir('novel', picked.filePath)
    try {
      const rows = list
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
          template: typeof s.template === 'string' ? s.template : '',
          enabled: s.enabled !== false
        }))
        .filter(
          (s) =>
            /^https?:\/\//i.test(s.baseUrl) &&
            NOVEL_SOURCE_TEMPLATES.includes(s.template as NovelSourceTemplate)
        )
      await writeJsonAtomic(picked.filePath, rows)
      return { canceled: false, path: picked.filePath, count: rows.length }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })

  // ---------- 磁力搜索（第三方索引站） ----------
  ipcMain.handle('magnet:state', () => loadMagnetState())
  ipcMain.handle('magnet:saveSources', (_e, sources: MagnetSource[]) =>
    saveMagnetSources(sources)
  )
  ipcMain.handle('magnet:resetSources', () => resetMagnetSources())
  ipcMain.handle('magnet:exportSources', (_e, sources: MagnetSource[]) =>
    exportMagnetSources(sources)
  )
  ipcMain.handle('magnet:importSources', () => importMagnetSources())
  ipcMain.handle('magnet:openLog', () => openMagnetLog())
  ipcMain.handle('magnet:test', (_e, source: MagnetSource) => testMagnetSource(source))
  ipcMain.handle(
    'magnet:search',
    (_e, source: MagnetSource, keyword: string, page: number, options: MagnetOptions) => {
      if (typeof keyword !== 'string' || !Number.isFinite(page)) {
        return {
          ok: false,
          items: [],
          hasNext: false,
          page: 1,
          sourceId: null,
          errors: [],
          error: '搜索参数无效'
        }
      }
      return searchMagnetSource(source, keyword, page, options)
    }
  )
  ipcMain.handle(
    'magnet:searchAll',
    (_e, sources: MagnetSource[], keyword: string, options: MagnetOptions) => {
      if (typeof keyword !== 'string') {
        return {
          ok: false,
          items: [],
          hasNext: false,
          page: 1,
          sourceId: null,
          errors: [],
          error: '搜索参数无效'
        }
      }
      return searchMagnetAll(sources, keyword, options)
    }
  )
  ipcMain.handle('magnet:open', (_e, magnet: string) => openMagnet(magnet))

  // 导出片源 / 电视源为 JSON 文件（只导名称与地址，不含任何账号信息）
  ipcMain.handle('vod:exportSources', async (_e, sources: unknown) => {
    const list = Array.isArray(sources) ? sources : []
    const picked = await dialog.showSaveDialog({
      title: '导出影视源',
      defaultPath: join(
        lastDialogDir('vod', app.getPath('documents')),
        `老郑分享-影视源-${stamp()}.json`
      ),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await rememberDialogDir('vod', picked.filePath)
    try {
      const rows = list
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          name: typeof s.name === 'string' ? s.name : '',
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

  // 导出番号源为 JSON（默认四个外网采集站 + 用户添加的）
  ipcMain.handle('h1:exportSources', async (_e, sources: unknown) => {
    const list = Array.isArray(sources) ? sources : []
    const picked = await dialog.showSaveDialog({
      title: '导出番号源',
      defaultPath: join(
        lastDialogDir('h1', app.getPath('documents')),
        `老郑分享-番号源-${stamp()}.json`
      ),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await rememberDialogDir('h1', picked.filePath)
    try {
      const rows = list
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
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

  // 导出短剧源为 JSON（含西饭短剧及其自定义地址）
  ipcMain.handle('drama:exportSources', async (_e, sources: unknown) => {
    const list = Array.isArray(sources) ? sources : []
    const picked = await dialog.showSaveDialog({
      title: '导出短剧源',
      defaultPath: join(
        lastDialogDir('drama', app.getPath('documents')),
        `老郑分享-短剧源-${stamp()}.json`
      ),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await rememberDialogDir('drama', picked.filePath)
    try {
      const rows = list
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
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

  // 片源管理：影视源 / 短剧源 / 电视源 / 磁力源一起导出或导入
  ipcMain.handle('sources:exportAll', async (_e, bundle: unknown) => {
    const raw = bundle && typeof bundle === 'object' ? (bundle as Record<string, unknown>) : {}
    const rowsOf = (key: string): Record<string, unknown>[] =>
      Array.isArray(raw[key])
        ? (raw[key] as unknown[]).filter(
            (item): item is Record<string, unknown> => !!item && typeof item === 'object'
          )
        : []
    const picked = await dialog.showSaveDialog({
      title: '导出全部源',
      defaultPath: join(
        lastDialogDir('all-sources', app.getPath('documents')),
        `老郑分享-全部源-${stamp()}.json`
      ),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await rememberDialogDir('all-sources', picked.filePath)
    try {
      const toFeedRows = (rows: Record<string, unknown>[]) =>
        rows
          .map((s) => ({
            name: typeof s.name === 'string' ? s.name : '',
            baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
            enabled: s.enabled !== false,
            // 手动归组必须一起带走，否则导入后外网源会被重新分到国内
            region: s.region === 'proxy' ? 'proxy' : 'cn',
            regionManual: s.regionManual === true
          }))
          .filter((s) => /^https?:\/\//i.test(s.baseUrl))
      const vodSources = toFeedRows(rowsOf('vodSources'))
      const dramaSources = rowsOf('dramaSources')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
          enabled: s.enabled !== false
        }))
        .filter((s) => s.id === 'xifan' || /^https?:\/\//i.test(s.baseUrl))
      const liveSources = normalizeLiveSources(rowsOf('liveSources')).map((s) => ({
        name: s.name,
        url: s.url,
        enabled: s.enabled,
        content: s.content
      }))
      const magnetSources = rowsOf('magnetSources').map((s) => ({
        ...s,
        testStatus: null,
        testMsg: null,
        testAt: 0
      }))
      const trainerSources = rowsOf('trainerSources')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          type:
            s.type === 'fling' ||
            s.type === '3dm' ||
            s.type === 'gamersky' ||
            s.type === 'ali213'
              ? s.type
              : '',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
          enabled: s.enabled !== false
        }))
        .filter((s) => !!s.type && /^https?:\/\//i.test(s.baseUrl))
      const musicBackupOf = (
        value: unknown
      ): { id: string; name: string; baseUrl: string; enabled: boolean } | null => {
        if (!value || typeof value !== 'object') return null
        const b = value as Record<string, unknown>
        const baseUrl = typeof b.baseUrl === 'string' ? b.baseUrl.trim() : ''
        if (!/^https?:\/\//i.test(baseUrl)) return null
        return {
          id: typeof b.id === 'string' && b.id ? b.id : 's33ve',
          name: typeof b.name === 'string' ? b.name : '',
          baseUrl,
          enabled: b.enabled !== false
        }
      }
      const musicSources = rowsOf('musicSources')
        .map((s) => {
          // 无名闪闪音乐的主备两条线路必须一起导出，否则导入端会退回默认备用线路
          const backup = musicBackupOf(s.backup)
          return {
            id: typeof s.id === 'string' ? s.id : '',
            name: typeof s.name === 'string' ? s.name : '',
            baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
            enabled: s.enabled !== false,
            // 洛雪脚本源的类型与平台偏好：缺失时由地址 / 脚本自动推断，有则原样带走
            ...(s.kind === 'lx' || s.kind === 'site' ? { kind: s.kind } : {}),
            ...(Array.isArray(s.platforms)
              ? {
                  platforms: s.platforms.filter(
                    (item): item is string => typeof item === 'string'
                  )
                }
              : {}),
            ...(backup ? { backup } : {})
          }
        })
        .filter((s) => /^https?:\/\//i.test(s.baseUrl))
      const novelSources = rowsOf('novelSources')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
          template: typeof s.template === 'string' ? s.template : '',
          enabled: s.enabled !== false
        }))
        .filter(
          (s) =>
            /^https?:\/\//i.test(s.baseUrl) &&
            NOVEL_SOURCE_TEMPLATES.includes(s.template as NovelSourceTemplate)
        )
      const comicSources = rowsOf('comicSources')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
          template:
            s.template === 'yumanhua' ||
            s.template === 'komiic' ||
            s.template === 'bikahub' ||
            s.template === 'tptoon' ||
            s.template === 'jmcomic'
              ? s.template
              : '',
          enabled: s.enabled !== false
        }))
        .filter((s) => /^https?:\/\//i.test(s.baseUrl) && !!s.template)
      const h1Sources = rowsOf('h1Sources')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
          enabled: s.enabled !== false
        }))
        .filter((s) => /^https?:\/\//i.test(s.baseUrl))
      const livePlatformSources = rowsOf('livePlatformSources')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
          enabled: s.enabled !== false
        }))
        .filter((s) => /^https?:\/\//i.test(s.baseUrl))
      const wallpaperSources = rowsOf('wallpaperSources')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
          template: isWallpaperTemplate(s.template) ? s.template : '',
          enabled: s.enabled !== false
        }))
        .filter((s) => /^https?:\/\//i.test(s.baseUrl) && !!isWallpaperTemplate(s.template))
      const meituSources = rowsOf('meituSources')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
          template: isMeituTemplate(s.template) ? s.template : '',
          enabled: s.enabled !== false
        }))
        .filter((s) => /^https?:\/\//i.test(s.baseUrl) && !!isMeituTemplate(s.template))
      const shuangkanSources = rowsOf('shuangkanSources')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
          enabled: s.enabled !== false,
          // 短域名镜像（x123 / xv123）无法按域名推断站点，必须带上源类型
          ...(isSkAdapter(s.adapter) ? { adapter: s.adapter } : {})
        }))
        .filter((s) => /^https?:\/\//i.test(s.baseUrl))
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        vodSources,
        dramaSources,
        liveSources,
        magnetSources,
        trainerSources,
        musicSources,
        novelSources,
        comicSources,
        h1Sources,
        livePlatformSources,
        wallpaperSources,
        meituSources,
        shuangkanSources
      }
      await writeJsonAtomic(picked.filePath, payload)
      return {
        canceled: false,
        path: picked.filePath,
        count:
          vodSources.length +
          dramaSources.length +
          liveSources.length +
          magnetSources.length +
          trainerSources.length +
          musicSources.length +
          novelSources.length +
          comicSources.length +
          h1Sources.length +
          livePlatformSources.length +
          wallpaperSources.length +
          meituSources.length +
          shuangkanSources.length
      }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('sources:importAll', async () => {
    const picked = await dialog.showOpenDialog({
      title: '导入全部源',
      defaultPath: lastDialogDir('all-sources', app.getPath('documents')),
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true }
    await rememberDialogDir('all-sources', picked.filePaths[0])
    try {
      const text = (await readFile(picked.filePaths[0], 'utf8')).replace(/^\uFEFF/, '')
      const raw = JSON.parse(text) as unknown
      const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const rowsOf = (key: string): unknown[] => (Array.isArray(o[key]) ? (o[key] as unknown[]) : [])
      const data = {
        vodSources: rowsOf('vodSources'),
        dramaSources: rowsOf('dramaSources'),
        liveSources: normalizeLiveSources(rowsOf('liveSources')),
        magnetSources: rowsOf('magnetSources'),
        trainerSources: rowsOf('trainerSources'),
        musicSources: rowsOf('musicSources'),
        novelSources: rowsOf('novelSources'),
        comicSources: rowsOf('comicSources'),
        h1Sources: rowsOf('h1Sources'),
        livePlatformSources: rowsOf('livePlatformSources'),
        wallpaperSources: rowsOf('wallpaperSources'),
        meituSources: rowsOf('meituSources'),
        shuangkanSources: rowsOf('shuangkanSources')
      }
      if (
        !data.vodSources.length &&
        !data.dramaSources.length &&
        !data.liveSources.length &&
        !data.magnetSources.length &&
        !data.trainerSources.length &&
        !data.musicSources.length &&
        !data.novelSources.length &&
        !data.comicSources.length &&
        !data.h1Sources.length &&
        !data.livePlatformSources.length &&
        !data.wallpaperSources.length &&
        !data.meituSources.length &&
        !data.shuangkanSources.length
      ) {
        return { canceled: false, error: '文件里没有可导入的源' }
      }
      return { canceled: false, data }
    } catch (err) {
      return { canceled: false, error: `读取失败：${(err as Error).message}` }
    }
  })

  // 清单管理：清单 / 关联 / 条目单独导出或导入
  ipcMain.handle('lists:export', async (_e, bundle: unknown) => {
    const raw = bundle && typeof bundle === 'object' ? (bundle as Record<string, unknown>) : {}
    const rowsOf = (key: string): unknown[] => (Array.isArray(raw[key]) ? (raw[key] as unknown[]) : [])
    const lists = rowsOf('lists')
    const picked = await dialog.showSaveDialog({
      title: '导出清单',
      defaultPath: join(
        lastDialogDir('lists', app.getPath('documents')),
        `老郑分享-清单-${stamp()}.json`
      ),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await rememberDialogDir('lists', picked.filePath)
    try {
      await writeFile(
        picked.filePath,
        JSON.stringify(
          {
            version: 1,
            exportedAt: new Date().toISOString(),
            lists,
            listItems: rowsOf('listItems'),
            items: rowsOf('items')
          },
          null,
          2
        ),
        'utf8'
      )
      return { canceled: false, path: picked.filePath, count: lists.length }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('lists:import', async () => {
    const picked = await dialog.showOpenDialog({
      title: '导入清单',
      defaultPath: lastDialogDir('lists', app.getPath('documents')),
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true }
    await rememberDialogDir('lists', picked.filePaths[0])
    try {
      const text = (await readFile(picked.filePaths[0], 'utf8')).replace(/^\uFEFF/, '')
      const raw = JSON.parse(text) as unknown
      const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const rowsOf = (key: string): unknown[] => (Array.isArray(o[key]) ? (o[key] as unknown[]) : [])
      const data = {
        lists: rowsOf('lists'),
        listItems: rowsOf('listItems'),
        items: rowsOf('items')
      }
      if (!data.lists.length) return { canceled: false, error: '文件里没有清单' }
      return { canceled: false, data }
    } catch (err) {
      return { canceled: false, error: `读取失败：${(err as Error).message}` }
    }
  })

  ipcMain.handle(
    'vod:list',
    (_e, source: VodSourceInput, page: number, typeId: number, keyword: string) => {
      if (
        !isVodSourceInput(source) ||
        !Number.isInteger(page) ||
        !Number.isInteger(typeId) ||
        typeof keyword !== 'string' ||
        keyword.length > 80
      ) {
        return { ok: false, error: '参数无效' }
      }
      return cachedResponse(
        `vod:list|${source.id}|${source.baseUrl}|${page}|${typeId}|${keyword}`,
        30 * 60 * 1000,
        () => listVodSource(source, page, typeId, keyword)
      )
    }
  )


}
