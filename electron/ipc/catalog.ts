import { ipcMain } from 'electron'










































import { listAccounts } from '../accounts'
import {
  bikaCategories,
  bikaCategoryCounts,
  bikaChapters,
  bikaDetail,
  bikaEnsureLogin,
  bikaImages,
  bikaList,
  bikaSearch
} from '../bika'
import { komiicByCategory, komiicCategories, komiicChapters, komiicDetail, komiicEnsureLogin, komiicHot, komiicImages, komiicRecent, komiicSearch } from '../komiic'
import {
  yumanhuaCategory,
  yumanhuaChapters,
  yumanhuaDetail,
  yumanhuaHot,
  yumanhuaImages,
  yumanhuaRecent,
  yumanhuaSearch
} from '../yumanhua'
import { bikahubComicCategory, bikahubComicCategoryCounts, bikahubComicChapters, bikahubComicDetail, bikahubComicHot, bikahubComicImages, bikahubComicRecent, bikahubComicSearch } from '../bikahub'
import { tptoonComicCategory, tptoonComicCategoryCounts, tptoonComicChapters, tptoonComicDetail, tptoonComicHot, tptoonComicImages, tptoonComicRecent, tptoonComicSearch } from '../tptoon'
import {
  jmcomicCategory,
  jmcomicCategoryCounts,
  jmcomicChapters,
  jmcomicDetail,
  jmcomicHot,
  jmcomicImages,
  jmcomicRecent,
  jmcomicSearch
} from '../jmcomic'
import {
  openWygamerLogin,
  wygamerByCategory,
  wygamerCategories,
  wygamerDetail,
  wygamerEnsureLogin,
  wygamerHome,
  wygamerResolveDownload,
  wygamerSearch
} from '../wygamer'
import { emuList, emuSearch, emuTagCounts, openEmuGame } from '../emu'
import { isEmuPlatform } from '../../src/shared/emu'



import type { AccountActionResult, AccountSite } from '../../src/shared/accounts'

import { cachedResponse } from '../apiCache'
















import { HOUR, DAY } from './shared'

export function registerCatalogIpc(): void {
  // ---------- 内置账号（哔咔 / Komiic / 无忧） ----------
  const ACCOUNT_SITES = new Set<AccountSite>(['bika', 'komiic', 'wygamer'])

  ipcMain.handle('accounts:list', () => listAccounts())

  ipcMain.handle(
    'accounts:login',
    async (_e, site: AccountSite): Promise<AccountActionResult> => {
      if (!ACCOUNT_SITES.has(site)) return { ok: false, message: '站点参数无效' }
      let ok = false
      if (site === 'bika') ok = await bikaEnsureLogin()
      else if (site === 'komiic') ok = await komiicEnsureLogin()
      else ok = await wygamerEnsureLogin(true)
      const item = listAccounts().items.find((i) => i.site === site)
      return { ok, message: item?.message ?? (ok ? '登录成功' : '登录失败') }
    }
  )

  ipcMain.handle('accounts:openLogin', async (_e, site: AccountSite) => {
    if (site === 'wygamer') await openWygamerLogin()
  })

  // ---------- 哔咔 ----------
  ipcMain.handle('bika:categories', () =>
    cachedResponse('bika:categories', 7 * DAY, () => bikaCategories())
  )

  ipcMain.handle('bika:counts', () =>
    cachedResponse('bika:counts', 6 * HOUR, () => bikaCategoryCounts())
  )

  ipcMain.handle('bika:list', (_e, page: number, category: string, sort: string) => {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000 ||
      typeof category !== 'string' ||
      category.length > 60 ||
      typeof sort !== 'string' ||
      sort.length > 10
    ) {
      return { ok: false, items: [], page: 1, pages: 1, total: 0, error: '参数无效' }
    }
    return cachedResponse(`bika:list|${page}|${category}|${sort}`, 15 * 60 * 1000, () =>
      bikaList(page, category, sort)
    )
  })

  ipcMain.handle('bika:search', (_e, keyword: string, page: number, sort: string) => {
    if (
      typeof keyword !== 'string' ||
      !keyword.trim() ||
      keyword.length > 80 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000 ||
      typeof sort !== 'string'
    ) {
      return { ok: false, items: [], page: 1, pages: 1, total: 0, error: '参数无效' }
    }
    return cachedResponse(`bika:search|${keyword.trim()}|${page}|${sort}`, 30 * 60 * 1000, () =>
      bikaSearch(keyword.trim(), page, sort)
    )
  })

  ipcMain.handle('bika:detail', (_e, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, comic: null, error: '参数无效' }
    }
    return cachedResponse(`bika:detail|${id}`, 12 * HOUR, () => bikaDetail(id))
  })

  ipcMain.handle('bika:chapters', (_e, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return cachedResponse(`bika:chapters|${id}`, 12 * HOUR, () => bikaChapters(id))
  })

  ipcMain.handle('bika:images', (_e, id: string, order: number) => {
    if (typeof id !== 'string' || !id || id.length > 80 || !Number.isInteger(order) || order < 0) {
      return { ok: false, urls: [], error: '参数无效' }
    }
    return bikaImages(id, order)
  })

  // ---------- Komiic ----------
  ipcMain.handle('komiic:recent', (_e, offset: number, status: string) => {
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 100_000 ||
      (status !== undefined && typeof status !== 'string')
    ) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return cachedResponse(
      `komiic:recent|${offset}|${status ?? ''}`,
      15 * 60 * 1000,
      () => komiicRecent(offset, status === 'ONGOING' || status === 'END' ? status : '')
    )
  })

  ipcMain.handle('komiic:hot', (_e, offset: number) => {
    if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return cachedResponse(`komiic:hot|${offset}`, 15 * 60 * 1000, () => komiicHot(offset))
  })

  ipcMain.handle('komiic:byCategory', (_e, categoryId: string, offset: number) => {
    if (
      typeof categoryId !== 'string' ||
      !categoryId ||
      categoryId.length > 60 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 100_000
    ) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return cachedResponse(`komiic:category|${categoryId}|${offset}`, 15 * 60 * 1000, () =>
      komiicByCategory(categoryId, offset)
    )
  })

  ipcMain.handle('komiic:search', (_e, keyword: string, offset: number) => {
    if (
      typeof keyword !== 'string' ||
      !keyword.trim() ||
      keyword.length > 80 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 100_000
    ) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return cachedResponse(`komiic:search|${keyword.trim()}|${offset}`, 30 * 60 * 1000, () =>
      komiicSearch(keyword.trim(), offset)
    )
  })

  ipcMain.handle('komiic:categories', () =>
    cachedResponse('komiic:categories', 7 * DAY, () => komiicCategories())
  )

  ipcMain.handle('komiic:detail', (_e, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, comic: null, error: '参数无效' }
    }
    return cachedResponse(`komiic:detail|${id}`, 12 * HOUR, () => komiicDetail(id))
  })

  ipcMain.handle('komiic:chapters', (_e, comicId: string) => {
    if (typeof comicId !== 'string' || !comicId || comicId.length > 80) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return cachedResponse(`komiic:chapters|${comicId}`, 12 * HOUR, () => komiicChapters(comicId))
  })

  ipcMain.handle('komiic:images', (_e, comicId: string, chapterId: string) => {
    if (
      typeof comicId !== 'string' ||
      !comicId ||
      comicId.length > 80 ||
      typeof chapterId !== 'string' ||
      !chapterId ||
      chapterId.length > 80
    ) {
      return { ok: false, urls: [], error: '参数无效' }
    }
    return komiicImages(comicId, chapterId)
  })

  // ---------- 漫画客（yumanhua） ----------
  ipcMain.handle('yumanhua:recent', (_e, baseUrl?: string, sourceId?: string) =>
    cachedResponse(`yumanhua:recent|${baseUrl ?? ''}|${sourceId ?? ''}`, 15 * 60 * 1000, () =>
      yumanhuaRecent(baseUrl, sourceId)
    )
  )

  ipcMain.handle('yumanhua:hot', (_e, baseUrl?: string, sourceId?: string) =>
    cachedResponse(`yumanhua:hot|${baseUrl ?? ''}|${sourceId ?? ''}`, 15 * 60 * 1000, () =>
      yumanhuaHot(baseUrl, sourceId)
    )
  )

  ipcMain.handle(
    'yumanhua:category',
    (_e, categoryId: string, baseUrl?: string, sourceId?: string, page?: number) => {
      if (typeof categoryId !== 'string' || !/^\d{1,3}$/.test(categoryId)) {
        return { ok: false, items: [], error: '参数无效' }
      }
      const current = Number.isFinite(page)
        ? Math.max(1, Math.min(999, Math.floor(page as number)))
        : 1
      return cachedResponse(
        `yumanhua:category|${categoryId}|${baseUrl ?? ''}|${sourceId ?? ''}|${current}`,
        15 * 60 * 1000,
        () => yumanhuaCategory(categoryId, baseUrl, sourceId, current)
      )
    }
  )

  ipcMain.handle('yumanhua:search', (_e, keyword: string, baseUrl?: string, sourceId?: string) => {
    if (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 40) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return cachedResponse(
      `yumanhua:search|${keyword.trim()}|${baseUrl ?? ''}|${sourceId ?? ''}`,
      30 * 60 * 1000,
      () => yumanhuaSearch(keyword.trim(), baseUrl, sourceId)
    )
  })

  ipcMain.handle('yumanhua:detail', (_e, id: string, baseUrl?: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, comic: null, error: '参数无效' }
    }
    return cachedResponse(`yumanhua:detail|${id}|${baseUrl ?? ''}`, 12 * HOUR, () =>
      yumanhuaDetail(id, baseUrl)
    )
  })

  ipcMain.handle('yumanhua:chapters', (_e, id: string, baseUrl?: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, items: [], error: '参数无效' }
    }
    // 章节列表不落缓存：站点更新后要立刻能看到最新集数
    return yumanhuaChapters(id, baseUrl)
  })

  ipcMain.handle('yumanhua:images', (_e, comicId: string, chapterId: string, baseUrl?: string) => {
    if (
      typeof comicId !== 'string' ||
      !comicId ||
      comicId.length > 80 ||
      typeof chapterId !== 'string' ||
      !chapterId ||
      chapterId.length > 80
    ) {
      return { ok: false, urls: [], error: '参数无效' }
    }
    return yumanhuaImages(comicId, chapterId, baseUrl)
  })

  // ---------- 哔咔漫画（bikahub，站点故障时自动走 /go-home 防失联换址） ----------
  ipcMain.handle('bikahub:recent', (_e, baseUrl?: string, sourceId?: string, page?: number) => {
    const current = Number.isFinite(page) ? Math.max(1, Math.min(999, Math.floor(page as number))) : 1
    return cachedResponse(
      `bikahub:recent|${baseUrl ?? ''}|${sourceId ?? ''}|${current}`,
      15 * 60 * 1000,
      () => bikahubComicRecent(baseUrl, sourceId, current)
    )
  })

  ipcMain.handle('bikahub:hot', (_e, baseUrl?: string, sourceId?: string, page?: number) => {
    const current = Number.isFinite(page) ? Math.max(1, Math.min(999, Math.floor(page as number))) : 1
    return cachedResponse(
      `bikahub:hot|${baseUrl ?? ''}|${sourceId ?? ''}|${current}`,
      15 * 60 * 1000,
      () => bikahubComicHot(baseUrl, sourceId, current)
    )
  })

  ipcMain.handle(
    'bikahub:category',
    (_e, categoryId: string, baseUrl?: string, sourceId?: string, page?: number) => {
      if (typeof categoryId !== 'string' || !/^[a-z0-9-]{1,30}$/i.test(categoryId)) {
        return { ok: false, items: [], error: '参数无效' }
      }
      const current = Number.isFinite(page)
        ? Math.max(1, Math.min(999, Math.floor(page as number)))
        : 1
      return cachedResponse(
        `bikahub:category|${categoryId}|${baseUrl ?? ''}|${sourceId ?? ''}|${current}`,
        15 * 60 * 1000,
        () => bikahubComicCategory(categoryId, baseUrl, sourceId, current)
      )
    }
  )

  ipcMain.handle('bikahub:categoryCounts', (_e, baseUrl?: string) =>
    cachedResponse(`bikahub:categoryCounts|${baseUrl ?? ''}`, 10 * 60 * 1000, () =>
      bikahubComicCategoryCounts(baseUrl)
    )
  )

  ipcMain.handle('bikahub:search', (_e, keyword: string, baseUrl?: string, sourceId?: string) => {
    if (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 40) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return cachedResponse(
      `bikahub:search|v3|${keyword.trim()}|${baseUrl ?? ''}|${sourceId ?? ''}`,
      30 * 60 * 1000,
      () => bikahubComicSearch(keyword.trim(), baseUrl, sourceId)
    )
  })

  ipcMain.handle('bikahub:detail', (_e, id: string, baseUrl?: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, comic: null, error: '参数无效' }
    }
    return cachedResponse(`bikahub:detail|${id}|${baseUrl ?? ''}`, 12 * HOUR, () =>
      bikahubComicDetail(id, baseUrl)
    )
  })

  ipcMain.handle('bikahub:chapters', (_e, id: string, baseUrl?: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return bikahubComicChapters(id, baseUrl)
  })

  ipcMain.handle('bikahub:images', (_e, comicId: string, chapterId: string, baseUrl?: string) => {
    if (
      typeof comicId !== 'string' ||
      !comicId ||
      comicId.length > 80 ||
      typeof chapterId !== 'string' ||
      !chapterId ||
      chapterId.length > 80
    ) {
      return { ok: false, urls: [], error: '参数无效' }
    }
    return bikahubComicImages(comicId, chapterId, baseUrl)
  })

  // ---------- 头牌漫画（tptoon，站点故障时走 tpmh8.cc 防失联换址） ----------
  ipcMain.handle('tptoon:recent', (_e, baseUrl?: string, sourceId?: string, page?: number) => {
    const current = Number.isFinite(page) ? Math.max(1, Math.min(9999, Math.floor(page as number))) : 1
    return cachedResponse(
      `tptoon:v1:recent|${baseUrl ?? ''}|${sourceId ?? ''}|${current}`,
      15 * 60 * 1000,
      () => tptoonComicRecent(baseUrl, sourceId, current)
    )
  })

  ipcMain.handle('tptoon:hot', (_e, baseUrl?: string, sourceId?: string, page?: number) => {
    const current = Number.isFinite(page) ? Math.max(1, Math.min(9999, Math.floor(page as number))) : 1
    return cachedResponse(
      `tptoon:v1:hot|${baseUrl ?? ''}|${sourceId ?? ''}|${current}`,
      15 * 60 * 1000,
      () => tptoonComicHot(baseUrl, sourceId, current)
    )
  })

  ipcMain.handle(
    'tptoon:category',
    (_e, categoryId: string, baseUrl?: string, sourceId?: string, page?: number) => {
      if (typeof categoryId !== 'string' || !/^[a-z0-9-]{1,30}$/i.test(categoryId)) {
        return { ok: false, items: [], error: '参数无效' }
      }
      const current = Number.isFinite(page)
        ? Math.max(1, Math.min(9999, Math.floor(page as number)))
        : 1
      return cachedResponse(
        `tptoon:v1:category|${categoryId}|${baseUrl ?? ''}|${sourceId ?? ''}|${current}`,
        15 * 60 * 1000,
        () => tptoonComicCategory(categoryId, baseUrl, sourceId, current)
      )
    }
  )

  ipcMain.handle('tptoon:categoryCounts', (_e, baseUrl?: string) =>
    cachedResponse(`tptoon:v1:categoryCounts|${baseUrl ?? ''}`, 24 * 60 * 60 * 1000, () =>
      tptoonComicCategoryCounts(baseUrl)
    )
  )

  ipcMain.handle('tptoon:search', (_e, keyword: string, baseUrl?: string, sourceId?: string) => {
    if (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 40) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return cachedResponse(
      `tptoon:v1:search|${keyword.trim()}|${baseUrl ?? ''}|${sourceId ?? ''}`,
      30 * 60 * 1000,
      () => tptoonComicSearch(keyword.trim(), baseUrl, sourceId)
    )
  })

  ipcMain.handle('tptoon:detail', (_e, id: string, baseUrl?: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, comic: null, error: '参数无效' }
    }
    return cachedResponse(`tptoon:v1:detail|${id}|${baseUrl ?? ''}`, 12 * HOUR, () =>
      tptoonComicDetail(id, baseUrl)
    )
  })

  ipcMain.handle('tptoon:chapters', (_e, id: string, baseUrl?: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return tptoonComicChapters(id, baseUrl)
  })

  ipcMain.handle('tptoon:images', (_e, comicId: string, chapterId: string, baseUrl?: string) => {
    if (
      typeof comicId !== 'string' ||
      !comicId ||
      comicId.length > 80 ||
      typeof chapterId !== 'string' ||
      !chapterId ||
      chapterId.length > 80
    ) {
      return { ok: false, urls: [], error: '参数无效' }
    }
    return tptoonComicImages(comicId, chapterId, baseUrl)
  })

  // ---------- 禁漫天堂（18comic，站点故障时走 x99dh.net 优选访问换址） ----------
  ipcMain.handle('jmcomic:recent', (_e, baseUrl?: string, sourceId?: string, page?: number) => {
    const current = Number.isFinite(page) ? Math.max(1, Math.min(9999, Math.floor(page as number))) : 1
    return cachedResponse(
      `jmcomic:v1:recent|${baseUrl ?? ''}|${sourceId ?? ''}|${current}`,
      15 * 60 * 1000,
      () => jmcomicRecent(baseUrl, sourceId, current)
    )
  })

  ipcMain.handle('jmcomic:hot', (_e, baseUrl?: string, sourceId?: string, page?: number) => {
    const current = Number.isFinite(page) ? Math.max(1, Math.min(9999, Math.floor(page as number))) : 1
    return cachedResponse(
      `jmcomic:v1:hot|${baseUrl ?? ''}|${sourceId ?? ''}|${current}`,
      15 * 60 * 1000,
      () => jmcomicHot(baseUrl, sourceId, current)
    )
  })

  ipcMain.handle(
    'jmcomic:category',
    (_e, categoryId: string, baseUrl?: string, sourceId?: string, page?: number) => {
      if (typeof categoryId !== 'string' || !/^[a-z0-9-]{1,30}$/i.test(categoryId)) {
        return { ok: false, items: [], error: '参数无效' }
      }
      const current = Number.isFinite(page)
        ? Math.max(1, Math.min(9999, Math.floor(page as number)))
        : 1
      return cachedResponse(
        `jmcomic:v1:category|${categoryId}|${baseUrl ?? ''}|${sourceId ?? ''}|${current}`,
        15 * 60 * 1000,
        () => jmcomicCategory(categoryId, baseUrl, sourceId, current)
      )
    }
  )

  ipcMain.handle('jmcomic:categoryCounts', (_e, baseUrl?: string) =>
    cachedResponse(`jmcomic:v1:categoryCounts|${baseUrl ?? ''}`, 24 * HOUR, () =>
      jmcomicCategoryCounts(baseUrl)
    )
  )

  ipcMain.handle(
    'jmcomic:search',
    (_e, keyword: string, baseUrl?: string, sourceId?: string, page?: number) => {
      if (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 40) {
        return { ok: false, items: [], error: '参数无效' }
      }
      const current = Number.isFinite(page)
        ? Math.max(1, Math.min(9999, Math.floor(page as number)))
        : 1
      return cachedResponse(
        `jmcomic:v1:search|${keyword.trim()}|${baseUrl ?? ''}|${sourceId ?? ''}|${current}`,
        30 * 60 * 1000,
        () => jmcomicSearch(keyword.trim(), baseUrl, sourceId, current)
      )
    }
  )

  ipcMain.handle('jmcomic:detail', (_e, id: string, baseUrl?: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, comic: null, error: '参数无效' }
    }
    return cachedResponse(`jmcomic:v1:detail|${id}|${baseUrl ?? ''}`, 12 * HOUR, () =>
      jmcomicDetail(id, baseUrl)
    )
  })

  ipcMain.handle('jmcomic:chapters', (_e, id: string, baseUrl?: string) => {
    if (typeof id !== 'string' || !id || id.length > 80) {
      return { ok: false, items: [], error: '参数无效' }
    }
    return jmcomicChapters(id, baseUrl)
  })

  ipcMain.handle('jmcomic:images', (_e, comicId: string, chapterId: string, baseUrl?: string) => {
    if (
      typeof comicId !== 'string' ||
      !comicId ||
      comicId.length > 80 ||
      typeof chapterId !== 'string' ||
      !chapterId ||
      chapterId.length > 80
    ) {
      return { ok: false, urls: [], error: '参数无效' }
    }
    return jmcomicImages(comicId, chapterId, baseUrl)
  })

  ipcMain.handle('comic:testSource', async (_e, source: unknown) => {
    const input = source as {
      id?: unknown
      name?: unknown
      baseUrl?: unknown
      template?: unknown
    }
    if (!input || typeof input !== 'object') return { ok: false, error: '漫画源参数无效' }
    const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : ''
    const id = typeof input.id === 'string' ? input.id.trim() : ''
    const template =
      input.template === 'komiic'
        ? 'komiic'
        : input.template === 'bikahub'
          ? 'bikahub'
          : input.template === 'tptoon'
            ? 'tptoon'
            : input.template === 'jmcomic'
              ? 'jmcomic'
              : 'yumanhua'
    if (!id || !/^https?:\/\//i.test(baseUrl)) return { ok: false, error: '漫画源地址无效' }
    try {
      const res =
        template === 'komiic'
          ? await komiicRecent(0, '')
          : template === 'bikahub'
            ? await bikahubComicRecent(baseUrl, id)
            : template === 'tptoon'
              ? await tptoonComicRecent(baseUrl, id)
              : template === 'jmcomic'
                ? await jmcomicRecent(baseUrl, id)
                : await yumanhuaRecent(baseUrl, id)
      if (!res.ok || !res.items.length) return { ok: false, error: res.error ?? '没有返回漫画' }
      return { ok: true, count: res.items.length, message: `可用，返回 ${res.items.length} 部` }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '测试失败' }
    }
  })


  ipcMain.handle('wygamer:home', (_e, page: number) => {
    if (!Number.isInteger(page) || page < 1 || page > 1000) {
      return { ok: false, items: [], page: 1, lastPage: 0, error: '参数无效' }
    }
    return cachedResponse(`wygamer:home|${page}`, 30 * 60 * 1000, () => wygamerHome(page))
  })

  ipcMain.handle('wygamer:search', (_e, keyword: string, page: number) => {
    if (
      typeof keyword !== 'string' ||
      !keyword.trim() ||
      keyword.length > 80 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000
    ) {
      return { ok: false, items: [], page: 1, lastPage: 0, error: '参数无效' }
    }
    return cachedResponse(`wygamer:search|${keyword.trim()}|${page}`, 30 * 60 * 1000, () =>
      wygamerSearch(keyword.trim(), page)
    )
  })

  ipcMain.handle('wygamer:byCategory', (_e, url: string, page: number) => {
    if (
      typeof url !== 'string' ||
      !/^https?:\/\/(www\.)?wygamer\.com\//i.test(url) ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000
    ) {
      return { ok: false, items: [], page: 1, lastPage: 0, error: '参数无效' }
    }
    return cachedResponse(`wygamer:category|${url}|${page}`, 30 * 60 * 1000, () =>
      wygamerByCategory(url, page)
    )
  })

  ipcMain.handle('wygamer:categories', () =>
    cachedResponse('wygamer:categories', 7 * DAY, () => wygamerCategories())
  )

  ipcMain.handle('wygamer:detail', (_e, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 120) {
      return { ok: false, game: null, error: '参数无效' }
    }
    return cachedResponse(`wygamer:detail|${id}`, 12 * HOUR, () => wygamerDetail(id))
  })

  ipcMain.handle('wygamer:resolveDownload', (_e, payUrl: string) => {
    if (typeof payUrl !== 'string' || !/^https:\/\/(www\.)?wygamer\.com\//i.test(payUrl)) {
      return { ok: false, error: '参数无效' }
    }
    return wygamerResolveDownload(payUrl)
  })

  // ---------- 模拟（yikm 小霸王 / GBA / 街机） ----------
  ipcMain.handle('emu:list', (_e, platform: string, tag: string, page: number) => {
    if (
      !isEmuPlatform(platform) ||
      typeof tag !== 'string' ||
      tag.length > 40 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 5000
    ) {
      return { ok: false, items: [], page: 1, lastPage: 0, hasMore: false, error: '参数无效' }
    }
    return cachedResponse(`emu:list|v2|${platform}|${tag}|${page}`, 30 * 60 * 1000, () =>
      emuList(platform, tag, page)
    )
  })

  ipcMain.handle('emu:tagCounts', (_e, platform: string) => {
    if (!isEmuPlatform(platform)) {
      return { ok: false, counts: {}, pages: {}, error: '参数无效' }
    }
    return cachedResponse(`emu:tagCounts|v1|${platform}`, 24 * 60 * 60 * 1000, () =>
      emuTagCounts(platform)
    )
  })

  ipcMain.handle('emu:search', (_e, keyword: string) => {
    if (typeof keyword !== 'string' || !keyword.trim() || keyword.trim().length > 40) {
      return { ok: false, items: [], error: '请输入 1~40 个字的搜索关键词' }
    }
    const query = keyword.trim()
    return cachedResponse(`emu:search|v2|${query}`, 30 * 60 * 1000, () => emuSearch(query))
  })

  ipcMain.handle('emu:open', (_e, id: string) => {
    if (typeof id !== 'string' || !/^\d{1,9}$/.test(id)) {
      return { ok: false, error: '参数无效' }
    }
    return openEmuGame(id)
  })

  // ---------- Z-Library ----------

}
