import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'



import { writeJsonAtomic } from '../store'
import { lastDialogDir, rememberDialogDir } from '../settings'






import { doubanAuthStatus, logoutDouban, openDoubanLogin } from '../doubanAuth'







import {
  isWallpaperDevice,
  isWallpaperTemplate,
  type WallpaperDevice,
  type WallpaperSourceRef
} from '../../src/shared/wallpaper'
import { wallpaperCategories, wallpaperList, wallpaperResolve } from '../wallpaper'
import { isMeituTemplate, type MeituSourceRef } from '../../src/shared/meitu'
import { meituCategories, meituDetail, meituList } from '../meitu'








import { xCategories, xDetail, xList } from '../xsite'
import { pCategoryCount, pList, pResolve } from '../psite'
import { melonCategoryCounts, melonDetail, melonFetchImage, melonList, melonVideoDuration, trackMelonImages } from '../melon'
import { newsFeed, newsNode } from '../news'
import { shuangkanCatalog, shuangkanDetail, shuangkanMirrors, shuangkanPlay, shuangkanSearch, trackShuangkanImages } from '../shuangkan'
import { mirrorLatencies, routesFor } from '../gohome'
import { defaultSkSort, inferSkAdapter, isSkAdapter, isSkSort } from '../../src/shared/shuangkan'
import type { ShuangkanSourceRef } from '../../src/shared/shuangkan'






import { bikahubMirrorList } from '../bikahub'
import { tptoonMirrorList } from '../tptoon'




import {
  openZlibLogin,
  zlibDetail,
  zlibDownloadBook,
  zlibLogout,
  zlibSaveCredentials,
  zlibSearch,
  zlibStatus
} from '../zlib'




import { cachedResponse } from '../apiCache'












import { stamp, HOUR, DAY } from './shared'

export function registerServicesIpc(): void {
  ipcMain.handle('douban:status', () => doubanAuthStatus())
  ipcMain.handle('douban:login', () => openDoubanLogin(BrowserWindow.getFocusedWindow()))
  ipcMain.handle('douban:logout', () => logoutDouban())

  ipcMain.handle('xsite:categories', () =>
    cachedResponse('xsite:categories', 7 * DAY, () => xCategories())
  )

  ipcMain.handle('xsite:list', (_e, range: string, page: number, category: string) => {
    if (
      !['weekly', 'monthly', 'all'].includes(range) ||
      !Number.isInteger(page) ||
      typeof category !== 'string' ||
      category.length > 60
    ) {
      return { ok: false, error: '参数无效' }
    }
    return cachedResponse(
      `xsite:list|${range}|${page}|${category}`,
      30 * 60 * 1000,
      () => xList(range, page, category),
      6 * HOUR
    )
  })

  ipcMain.handle('xsite:detail', (_e, urlCd: string) => {
    if (typeof urlCd !== 'string' || urlCd.length > 100) return { ok: false, error: '参数无效' }
    return cachedResponse(
      `xsite:detail|${urlCd}`,
      30 * 60 * 1000,
      () => xDetail(urlCd),
      6 * HOUR
    )
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
        return { ok: false, items: [], lastPage: 0, hasMore: false, error: '参数无效' }
      }
      return cachedResponse(
        `psite:list|${sort}|${catId}|${query}|${page}`,
        30 * 60 * 1000,
        () => pList(sort, catId, query, page)
      )
    }
  )

  ipcMain.handle('psite:resolve', (_e, vkey: string) => {
    if (typeof vkey !== 'string' || vkey.length > 50) return { ok: false, error: '参数无效' }
    return pResolve(vkey)
  })

  ipcMain.handle('psite:categoryCount', (_e, catId: number) => {
    if (!Number.isInteger(catId) || catId < 0) return { ok: false, error: '参数无效' }
    return pCategoryCount(catId)
  })

  ipcMain.handle('melon:list', (_e, path: string) => {
    if (typeof path !== 'string' || path.length > 300) {
      return { ok: false, error: '参数无效' }
    }
    return cachedResponse(`melon:list|${path}`, 20 * 60 * 1000, () => melonList(path))
  })

  ipcMain.handle('melon:detail', (_e, id: string) => {
    if (typeof id !== 'string' || !/^\d+$/.test(id)) {
      return { ok: false, error: '参数无效' }
    }
    return cachedResponse(`melon:detail|${id}`, 6 * HOUR, () => melonDetail(id), 6 * HOUR)
  })

  ipcMain.handle('melon:counts', () =>
    cachedResponse('melon:counts', 6 * HOUR, () => melonCategoryCounts())
  )

  ipcMain.handle('melon:trackImages', (_e, urls: unknown) => {
    if (!Array.isArray(urls)) return
    trackMelonImages(urls.filter((u): u is string => typeof u === 'string'))
  })

  // ---------- 资讯（今日热榜 tophub.today） ----------
  ipcMain.handle('news:feed', (_e, category: string, query: unknown, page: unknown) => {
    if (typeof category !== 'string' || !/^[a-z]{2,12}$/.test(category)) {
      return { ok: false, error: '参数无效' }
    }
    const q = typeof query === 'string' ? query.slice(0, 40) : ''
    const p = typeof page === 'number' && Number.isFinite(page) ? Math.floor(page) : 1
    return cachedResponse(`news:feed|${category}|${q}|${p}`, 10 * 60 * 1000, () =>
      newsFeed(category, q, p)
    )
  })

  ipcMain.handle('news:node', (_e, id: string) => {
    if (typeof id !== 'string' || !/^[A-Za-z0-9]{4,30}$/.test(id)) {
      return { ok: false, error: '参数无效' }
    }
    return cachedResponse(`news:node|${id}`, 10 * 60 * 1000, () => newsNode(id))
  })

  // ---------- 爽看（肉视频；站点失效时走 x99dh.net 优选访问换址） ----------
  const sanitizeShuangkanSource = (raw: unknown): ShuangkanSourceRef | null => {
    if (!raw || typeof raw !== 'object') return null
    const record = raw as Record<string, unknown>
    const baseUrl =
      typeof record.baseUrl === 'string' ? record.baseUrl.trim().slice(0, 300) : ''
    if (!/^https?:\/\//i.test(baseUrl)) return null
    return {
      id: typeof record.id === 'string' ? record.id.slice(0, 80) : '',
      name: typeof record.name === 'string' ? record.name.slice(0, 80) : '',
      baseUrl,
      adapter: isSkAdapter(record.adapter) ? record.adapter : inferSkAdapter(baseUrl)
    }
  }

  const isSkContent = (value: unknown): value is 'video' | 'series' =>
    value === 'video' || value === 'series'

  ipcMain.handle(
    'shuangkan:catalog',
    (_e, rawSource: unknown, content: string, category: string, page: number, sort: unknown) => {
      const source = sanitizeShuangkanSource(rawSource)
      if (!source || !isSkContent(content)) {
        return { ok: false, items: [], page: 1, lastPage: 0, categories: [], error: '参数无效' }
      }
      if (typeof category !== 'string' || category.length > 80) {
        return { ok: false, items: [], page: 1, lastPage: 0, categories: [], error: '参数无效' }
      }
      const current = Number.isInteger(page) ? Math.max(1, Math.min(20_000, page)) : 1
      const adapter = source.adapter ?? inferSkAdapter(source.baseUrl)
      const currentSort = isSkSort(sort) ? sort : defaultSkSort(adapter)
      return cachedResponse(
        `shuangkan:v5:catalog|${source.id}|${adapter}|${source.baseUrl}|${content}|${category}|${current}|${currentSort}`,
        15 * 60 * 1000,
        () => shuangkanCatalog(content, category, current, source.baseUrl, adapter, currentSort)
      )
    }
  )

  ipcMain.handle(
    'shuangkan:search',
    (_e, rawSource: unknown, content: string, keyword: string, page: number) => {
      const source = sanitizeShuangkanSource(rawSource)
      if (!source || !isSkContent(content) || typeof keyword !== 'string') {
        return { ok: false, items: [], page: 1, lastPage: 0, categories: [], error: '参数无效' }
      }
      const query = keyword.trim().slice(0, 100)
      const current = Number.isInteger(page) ? Math.max(1, Math.min(20_000, page)) : 1
      return cachedResponse(
        `shuangkan:v4:search|${source.id}|${source.adapter}|${source.baseUrl}|${content}|${current}|${query}`,
        15 * 60 * 1000,
        () => shuangkanSearch(content, query, current, source.baseUrl, source.adapter)
      )
    }
  )

  ipcMain.handle('shuangkan:detail', (_e, rawSource: unknown, content: string, id: string) => {
    const source = sanitizeShuangkanSource(rawSource)
    if (!source || !isSkContent(content) || typeof id !== 'string') {
      return { ok: false, error: '参数无效' }
    }
    return cachedResponse(
      `shuangkan:v5:detail|${source.id}|${source.adapter}|${source.baseUrl}|${content}|${id}`,
      6 * HOUR,
      async () => {
        const res = await shuangkanDetail(content, id, source.baseUrl, source.adapter)
        // v0.122：播放地址带短时效签名（网关几分钟就可能过期），不能跟着 6 小时的详情缓存走，
        // 否则再次打开同一个视频会拿到已过期的地址（实测直接 410 / 提示片）。
        // 播放地址统一由 shuangkan:play 现取。
        return res.ok && res.detail ? { ...res, detail: { ...res.detail, playUrl: null } } : res
      },
      6 * HOUR
    )
  })

  ipcMain.handle('shuangkan:play', (_e, rawSource: unknown, id: string) => {
    const source = sanitizeShuangkanSource(rawSource)
    if (!source || typeof id !== 'string' || !/^[A-Za-z0-9_~./-]{1,160}$/.test(id)) {
      return { ok: false, error: '参数无效' }
    }
    return cachedResponse(
      `shuangkan:v6:play|${source.id}|${source.adapter}|${source.baseUrl}|${id}`,
      60 * 1000,
      () => shuangkanPlay(id, source.baseUrl, source.adapter),
      60 * 60 * 1000
    )
  })

  ipcMain.handle('shuangkan:trackImages', (_e, urls: unknown, baseUrl: unknown) => {
    if (!Array.isArray(urls)) return
    trackShuangkanImages(
      urls.filter((u): u is string => typeof u === 'string'),
      typeof baseUrl === 'string' ? baseUrl : undefined
    )
  })

  // 导航站优选地址：片源管理修改皇片源时按延迟选线路
  ipcMain.handle('shuangkan:mirrors', (_e, adapter: unknown, measure: unknown) => {
    if (!isSkAdapter(adapter)) {
      return { ok: false, measured: false, mirrors: [], error: '未知的源类型' }
    }
    // measure 不传时默认测速；打开修改弹窗会显式传 false 只拿线路列表，点刷新按钮才传 true
    return shuangkanMirrors(adapter, measure !== false)
  })

  // 漫画源的优选线路：禁漫天堂 / 头牌漫画 / 哔咔各有自己的地址发布页
  ipcMain.handle('comic:mirrors', async (_e, template: unknown, measure: unknown) => {
    // measure 不传时默认测速；弹窗打开时显式传 false 只拿线路列表
    const shouldMeasure = measure !== false
    if (template === 'jmcomic') {
      const match = /禁漫天堂/
      if (!shouldMeasure) {
        const urls = (await routesFor(match)).slice(0, 60)
        return urls.length
          ? { ok: true, measured: false, mirrors: urls.map((url) => ({ url, ms: null })) }
          : {
              ok: false,
              measured: false,
              mirrors: [],
              error: '导航站没有返回禁漫天堂的优选地址'
            }
      }
      const mirrors = await mirrorLatencies(match)
      return mirrors.length
        ? { ok: true, measured: true, mirrors }
        : { ok: false, measured: true, mirrors: [], error: '导航站没有返回禁漫天堂的优选地址' }
    }
    if (template === 'tptoon' || template === 'bikahub') {
      try {
        const mirrors =
          template === 'tptoon'
            ? await tptoonMirrorList(shouldMeasure)
            : await bikahubMirrorList(shouldMeasure)
        return mirrors.length
          ? { ok: true, measured: shouldMeasure, mirrors }
          : { ok: false, measured: shouldMeasure, mirrors: [], error: '没有解析到可用的镜像地址' }
      } catch (err) {
        return {
          ok: false,
          measured: shouldMeasure,
          mirrors: [],
          error: err instanceof Error ? err.message : '读取镜像地址失败'
        }
      }
    }
    return { ok: false, measured: false, mirrors: [], error: '该漫画源没有镜像地址' }
  })

  // 导出皇片源为 JSON
  ipcMain.handle('shuangkan:exportSources', async (_e, sources: unknown) => {
    const list = Array.isArray(sources) ? sources : []
    const picked = await dialog.showSaveDialog({
      title: '导出皇片源',
      defaultPath: join(
        lastDialogDir('shuangkan', app.getPath('documents')),
        `老郑分享-皇片源-${stamp()}.json`
      ),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await rememberDialogDir('shuangkan', picked.filePath)
    try {
      const rows = list
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
          enabled: s.enabled !== false,
          ...(isSkAdapter(s.adapter) ? { adapter: s.adapter } : {})
        }))
        .filter((s) => /^https?:\/\//i.test(s.baseUrl))
      await writeJsonAtomic(picked.filePath, rows)
      return { canceled: false, path: picked.filePath, count: rows.length }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })

  // ---------- 壁纸（Wallspic / 壁纸迷） ----------
  const sanitizeWallpaperSource = (raw: unknown): WallpaperSourceRef | null => {
    if (!raw || typeof raw !== 'object') return null
    const record = raw as Record<string, unknown>
    const template = isWallpaperTemplate(record.template) ? record.template : null
    const baseUrl =
      typeof record.baseUrl === 'string' ? record.baseUrl.trim().slice(0, 300) : ''
    if (!template || !/^https?:\/\//i.test(baseUrl)) return null
    return {
      id:
        typeof record.id === 'string' && record.id
          ? record.id.slice(0, 80)
          : template,
      template,
      baseUrl
    }
  }

  ipcMain.handle(
    'wallpaper:list',
    (_e, rawSource: unknown, category: string, page: number, keyword: string) => {
      const source = sanitizeWallpaperSource(rawSource)
      if (
        !source ||
        typeof category !== 'string' ||
        category.length > 80 ||
        !Number.isFinite(page) ||
        typeof keyword !== 'string' ||
        keyword.length > 80
      ) {
        return { ok: false, error: '参数无效' }
      }
      const safeKeyword = keyword.trim()
      return cachedResponse(
        `wallpaper:list:v3|${source.id}|${source.template}|${source.baseUrl}|${category}|${Math.round(page)}|${safeKeyword}`,
        30 * 60 * 1000,
        () => wallpaperList(source, category, page, safeKeyword)
      )
    }
  )

  ipcMain.handle(
    'wallpaper:categories',
    (_e, rawSource: unknown, device: WallpaperDevice) => {
      const source = sanitizeWallpaperSource(rawSource)
      if (!source || !isWallpaperDevice(device)) {
        return { ok: false, error: '参数无效' }
      }
      return cachedResponse(
        `wallpaper:categories:v5|${source.id}|${source.template}|${source.baseUrl}|${device}`,
        12 * 60 * 60 * 1000,
        () => wallpaperCategories(source, device)
      )
    }
  )

  ipcMain.handle(
    'wallpaper:resolve',
    (_e, rawSource: unknown, pageUrl: string, width: number, height: number) => {
      const source = sanitizeWallpaperSource(rawSource)
      if (
        !source ||
        typeof pageUrl !== 'string' ||
        pageUrl.length > 600 ||
        !Number.isFinite(width) ||
        !Number.isFinite(height)
      ) {
        return { ok: false, error: '参数无效' }
      }
      // 原图地址可能是带时效签名的直链，不做长时间缓存
      return wallpaperResolve(source, pageUrl, width, height)
    }
  )

  ipcMain.handle('wallpaper:exportSources', async (_e, sources: unknown) => {
    const list = Array.isArray(sources) ? sources : []
    const picked = await dialog.showSaveDialog({
      title: '导出壁纸源',
      defaultPath: join(
        lastDialogDir('wallpaper', app.getPath('documents')),
        `老郑分享-壁纸源-${stamp()}.json`
      ),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await rememberDialogDir('wallpaper', picked.filePath)
    try {
      const rows = list
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
          template: isWallpaperTemplate(s.template) ? s.template : '',
          enabled: s.enabled !== false
        }))
        .filter(
          (s) => s.name && /^https?:\/\//i.test(s.baseUrl) && !!isWallpaperTemplate(s.template)
        )
      await writeJsonAtomic(picked.filePath, rows)
      return { canceled: false, path: picked.filePath, count: rows.length }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })

  // ---------- 美图（魅影画廊 / 雪月映画） ----------
  const sanitizeMeituSource = (raw: unknown): MeituSourceRef | null => {
    if (!raw || typeof raw !== 'object') return null
    const record = raw as Record<string, unknown>
    const template = isMeituTemplate(record.template) ? record.template : null
    const baseUrl =
      typeof record.baseUrl === 'string' ? record.baseUrl.trim().slice(0, 300) : ''
    if (!template || !/^https?:\/\//i.test(baseUrl)) return null
    return {
      id: typeof record.id === 'string' && record.id ? record.id.slice(0, 80) : template,
      template,
      baseUrl
    }
  }

  ipcMain.handle(
    'meitu:list',
    (_e, rawSource: unknown, category: string, page: number, keyword: string) => {
      const source = sanitizeMeituSource(rawSource)
      if (
        !source ||
        typeof category !== 'string' ||
        category.length > 80 ||
        !Number.isFinite(page) ||
        typeof keyword !== 'string' ||
        keyword.length > 80
      ) {
        return { ok: false, error: '参数无效' }
      }
      const safeKeyword = keyword.trim()
      return cachedResponse(
        `meitu:list:v2|${source.id}|${source.template}|${source.baseUrl}|${category}|${Math.round(page)}|${safeKeyword}`,
        30 * 60 * 1000,
        () => meituList(source, category, Math.round(page), safeKeyword)
      )
    }
  )

  ipcMain.handle('meitu:categories', (_e, rawSource: unknown) => {
    const source = sanitizeMeituSource(rawSource)
    if (!source) return { ok: false, error: '参数无效' }
    return cachedResponse(
      `meitu:categories:v2|${source.id}|${source.template}|${source.baseUrl}`,
      12 * 60 * 60 * 1000,
      () => meituCategories(source)
    )
  })

  ipcMain.handle('meitu:detail', (_e, rawSource: unknown, pageUrl: string) => {
    const source = sanitizeMeituSource(rawSource)
    if (
      !source ||
      typeof pageUrl !== 'string' ||
      pageUrl.length > 600 ||
      !/^https?:\/\//i.test(pageUrl)
    ) {
      return { ok: false, error: '参数无效' }
    }
    return cachedResponse(
      `meitu:detail:v1|${source.id}|${source.template}|${pageUrl}`,
      60 * 60 * 1000,
      () => meituDetail(source, pageUrl)
    )
  })

  ipcMain.handle('meitu:exportSources', async (_e, sources: unknown) => {
    const list = Array.isArray(sources) ? sources : []
    const picked = await dialog.showSaveDialog({
      title: '导出套图源',
      defaultPath: join(
        lastDialogDir('meitu', app.getPath('documents')),
        `老郑分享-套图源-${stamp()}.json`
      ),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await rememberDialogDir('meitu', picked.filePath)
    try {
      const rows = list
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
          template: isMeituTemplate(s.template) ? s.template : '',
          enabled: s.enabled !== false
        }))
        .filter((s) => s.name && /^https?:\/\//i.test(s.baseUrl) && !!isMeituTemplate(s.template))
      await writeJsonAtomic(picked.filePath, rows)
      return { canceled: false, path: picked.filePath, count: rows.length }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('melon:image', (_e, url: string) => {
    if (typeof url !== 'string' || url.length > 500) {
      return { ok: false, error: '图片地址无效' }
    }
    return melonFetchImage(url)
  })

  ipcMain.handle('melon:duration', (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || url.length > 1000) {
      return { ok: false, error: '视频地址无效' }
    }
    return cachedResponse(`melon:duration|${url}`, 7 * DAY, () => melonVideoDuration(url))
  })


  ipcMain.handle('zlib:status', () => zlibStatus())

  ipcMain.handle('zlib:login', async () => {
    const res = await openZlibLogin()
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('accounts:changed')
    return res
  })

  ipcMain.handle('zlib:logout', async () => {
    const status = await zlibLogout()
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('accounts:changed')
    return status
  })

  ipcMain.handle('zlib:saveCredentials', (_e, username: string, password: string) => {
    if (typeof username !== 'string' || typeof password !== 'string') {
      return { ok: false, message: '参数无效' }
    }
    return zlibSaveCredentials(username.slice(0, 200), password.slice(0, 200))
  })

  ipcMain.handle('zlib:search', (_e, keyword: string, page: number) => {
    if (
      typeof keyword !== 'string' ||
      !keyword.trim() ||
      keyword.length > 80 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000
    ) {
      return { ok: false, books: [], page: 1, totalPages: 0, error: '参数无效' }
    }
    return cachedResponse(`zlib:search|${keyword.trim()}|${page}`, 30 * 60 * 1000, () =>
      zlibSearch(keyword.trim(), page)
    )
  })

  ipcMain.handle('zlib:detail', (_e, id: string, hash: string) => {
    if (typeof id !== 'string' || typeof hash !== 'string' || id.length > 40 || hash.length > 80) {
      return { ok: false, book: null, error: '参数无效' }
    }
    return cachedResponse(
      `zlib:detail|${id}|${hash}`,
      6 * HOUR,
      () => zlibDetail(id, hash),
      6 * HOUR
    )
  })

  ipcMain.handle('zlib:download', (_e, id: string, hash: string, title: string) => {
    if (
      typeof id !== 'string' ||
      typeof hash !== 'string' ||
      typeof title !== 'string' ||
      !/^\d+$/.test(id) ||
      title.length > 200
    ) {
      return { ok: false, error: '参数无效' }
    }
    return zlibDownloadBook(id, hash, title)
  })


}
