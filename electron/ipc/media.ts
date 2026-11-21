import { app, dialog, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { join } from 'node:path'



import { writeJsonAtomic } from '../store'
import { lastDialogDir, rememberDialogDir } from '../settings'





import {
  fetchDoubanHot,
  fetchPersonFull,
  fetchSubjectComments,
  fetchSubjectCredits,
  fetchSubjectDetail,
  fetchSubjectFull,
  searchSubjects
} from '../douban'

import { fetchVodCategories, fetchVodDetail, probeVodQualities, searchVodSource, testVodSource } from '../vod'
import { loadLiveChannels, loadLiveSources, normalizeLiveSources, saveLiveSources, testLiveSource } from '../live'
import { liveCategories, liveList, liveRoom } from '../livePlatform'
import { bilibiliQrPoll, bilibiliQrStart, liveLoginStatus, logoutPlatform, openPlatformLogin } from '../livePlatform/auth'
import { DOUYIN_UA } from '../livePlatform/common'
import { singingDanmaku, singingPlay, singingVideoInfo } from '../singing'
import {
  isLivePlatformId,
  type LiveListKind,
  type LiveListParams
} from '../../src/shared/livePlatform'





import { fetchMusicLyric, fetchMusicTop, resolveMusic, searchMusic, testMusicSource } from '../music'
import type { MusicSourceInput } from '../../src/shared/music'



import { saveMusicLyrics } from '../downloads'









import { dramaCatalog, dramaDetail, dramaPlay } from '../drama'
import {
  novelChapter,
  novelDetail,
  novelDownload,
  novelHome,
  novelSearch,
  novelCategory,
  testNovelSource
} from '../novel'




import { bikahubNovelCategoryCounts } from '../bikahub'










import { cachedResponse } from '../apiCache'




import type { LiveSource } from '../../src/shared/live'

import type { SearchCategory, SubjectKind } from '../../src/shared/douban'
import type { VodSourceInput } from '../../src/shared/vod'
import type { DramaSourceInput } from '../../src/shared/drama'
import { type NovelDownloadInput, type NovelDownloadProgress, type NovelSourceInput } from '../../src/shared/novel'





import { isLiveSource, isVodSourceInput, isDramaSourceInput, isNovelSourceInput, SEARCH_CATEGORIES, SUBJECT_KINDS, doubanCacheScope, stamp, HOUR, DAY } from './shared'

export function registerMediaIpc(): void {
  ipcMain.handle('subject:search', (_e, category: SearchCategory, query: string) => {
    if (!SEARCH_CATEGORIES.has(category) || typeof query !== 'string' || query.length > 100) {
      return { ok: false, items: [], error: '搜索参数无效' }
    }
    return cachedResponse(`subject:search|${doubanCacheScope()}|${category}|${query}`, 12 * HOUR, () =>
      searchSubjects(category, query)
    )
  })

  // 观影首页榜单：每个分类 1 个请求，静默刷新间隔 1 小时（与参考站一致）
  ipcMain.handle(
    'douban:hot',
    (_e, kind: 'movie' | 'tv', tag: string, pageStart: number, pageLimit: number) => {
      if (kind !== 'movie' && kind !== 'tv') {
        return { ok: false, items: [], error: '榜单类型无效' }
      }
      if (typeof tag !== 'string' || !tag.trim() || tag.length > 30) {
        return { ok: false, items: [], error: '榜单标签无效' }
      }
      const start =
        typeof pageStart === 'number' && Number.isFinite(pageStart)
          ? Math.max(0, Math.floor(pageStart))
          : 0
      const limit =
        typeof pageLimit === 'number' && Number.isFinite(pageLimit)
          ? Math.min(50, Math.max(1, Math.floor(pageLimit)))
          : 20
      return cachedResponse(
        `douban:hot|${doubanCacheScope()}|${kind}|${tag}|${start}|${limit}`,
        HOUR,
        () => fetchDoubanHot(kind, tag, start, limit)
      )
    }
  )

  ipcMain.handle('subject:detail', (_e, kind: SubjectKind, id: string) => {
    if (!SUBJECT_KINDS.has(kind) || typeof id !== 'string') {
      return { ok: false, error: '条目参数无效' }
    }
    return cachedResponse(`subject:detail|${doubanCacheScope()}|${kind}|${id}`, 7 * DAY, () =>
      fetchSubjectDetail(kind, id)
    )
  })

  ipcMain.handle('subject:full', (_e, kind: SubjectKind, id: string) => {
    if (!SUBJECT_KINDS.has(kind) || typeof id !== 'string') {
      return { ok: false, error: '条目参数无效' }
    }
    return cachedResponse(`subject:full|${doubanCacheScope()}|${kind}|${id}`, 7 * DAY, () =>
      fetchSubjectFull(kind, id)
    )
  })

  ipcMain.handle('subject:person', (_e, id: string) => {
    if (typeof id !== 'string') return { ok: false, error: '人物参数无效' }
    return cachedResponse(`subject:person|${doubanCacheScope()}|${id}`, 7 * DAY, () =>
      fetchPersonFull(id)
    )
  })

  ipcMain.handle('subject:credits', (_e, kind: SubjectKind, id: string) => {
    if (!SUBJECT_KINDS.has(kind) || typeof id !== 'string' || !/^\d+$/.test(id)) {
      return { ok: false, credits: [], error: '条目参数无效' }
    }
    return cachedResponse(`subject:credits|${doubanCacheScope()}|${kind}|${id}`, 7 * DAY, () =>
      fetchSubjectCredits(kind, id)
    )
  })

  ipcMain.handle(
    'subject:comments',
    (_e, kind: SubjectKind, id: string, order: 'hot' | 'new') => {
      if (!SUBJECT_KINDS.has(kind) || typeof id !== 'string') {
        return { ok: false, comments: [], error: '条目参数无效' }
      }
      const picked = order === 'new' ? 'new' : 'hot'
      return cachedResponse(
        `subject:comments|${doubanCacheScope()}|${kind}|${id}|${picked}`,
        6 * HOUR,
        () => fetchSubjectComments(kind, id, picked)
      )
    }
  )

  ipcMain.handle(
    'vod:search',
    (_e, source: VodSourceInput, keyword: string, year: string) => {
      if (
        !isVodSourceInput(source) ||
        typeof keyword !== 'string' ||
        keyword.length > 80 ||
        typeof year !== 'string'
      ) {
        return { ok: false, items: [], error: '搜索参数无效' }
      }
      return cachedResponse(
        `vod:search|${source.id}|${source.baseUrl}|${keyword}|${year}`,
        6 * HOUR,
        () => searchVodSource(source, keyword, year)
      )
    }
  )

  ipcMain.handle('vod:detail', (_e, source: VodSourceInput, vodId: number) => {
    if (!isVodSourceInput(source) || !Number.isInteger(vodId)) {
      return { ok: false, error: '条目参数无效' }
    }
    return cachedResponse(
      `vod:detail|${source.id}|${source.baseUrl}|${vodId}`,
      30 * 60 * 1000,
      () => fetchVodDetail(source, vodId),
      6 * HOUR
    )
  })

  ipcMain.handle('vod:test', (_e, source: VodSourceInput) => {
    if (!isVodSourceInput(source)) {
      return { ok: true, status: 'dead', message: '已失效 · 地址无效', testAt: Date.now(), region: 'cn' }
    }
    return testVodSource(source)
  })

  ipcMain.handle('vod:categories', (_e, source: VodSourceInput) => {
    if (!isVodSourceInput(source)) return { ok: false, error: '片源参数无效' }
    return cachedResponse(`vod:categories|${source.id}|${source.baseUrl}`, 7 * DAY, () =>
      fetchVodCategories(source)
    )
  })

  // 搜索结果条目清晰度探测：多码率读主清单、单码率用 ffmpeg 读流头，按地址哈希缓存 30 分钟
  // playUrl 是完整的 vod_play_url（「名称$地址$$$…」），只要里面带 http 地址即可
  ipcMain.handle('vod:probe', (_e, from: string, playUrl: string) => {
    if (
      typeof from !== 'string' ||
      typeof playUrl !== 'string' ||
      from.length > 4000 ||
      playUrl.length > 20_000 ||
      !/https?:\/\//i.test(playUrl)
    ) {
      return { ok: true, qualities: [] }
    }
    const key = `vod:probe:v3|${createHash('sha1').update(`${from}|${playUrl}`).digest('hex')}`
    return cachedResponse(key, 30 * 60 * 1000, () => probeVodQualities(from, playUrl))
  })

  // ---------- 短剧（红果 / 西饭 / 河马 / 自定义） ----------
  ipcMain.handle(
    'drama:catalog',
    (_e, source: DramaSourceInput, genre: string, page: number, keyword: string) => {
      if (
        !isDramaSourceInput(source) ||
        typeof genre !== 'string' ||
        genre.length > 200 ||
        !Number.isFinite(page) ||
        typeof keyword !== 'string' ||
        keyword.length > 100
      ) {
        return {
          ok: false,
          items: [],
          page: 1,
          pageCount: 0,
          hasMore: false,
          categories: [],
          error: '短剧参数无效'
        }
      }
      return cachedResponse(
        `drama:catalog|${source.id}|${source.baseUrl ?? ''}|${genre}|${Math.floor(page)}|${keyword}`,
        10 * 60 * 1000,
        () => dramaCatalog(source, genre, page, keyword)
      )
    }
  )

  ipcMain.handle('drama:detail', (_e, source: DramaSourceInput, seriesId: string) => {
    if (
      !isDramaSourceInput(source) ||
      typeof seriesId !== 'string' ||
      !seriesId ||
      seriesId.length > 300
    ) {
      return { ok: false, error: '短剧参数无效' }
    }
    return cachedResponse(
      `drama:detail|${source.id}|${source.baseUrl ?? ''}|${seriesId}`,
      10 * 60 * 1000,
      () => dramaDetail(source, seriesId)
    )
  })

  ipcMain.handle(
    'drama:play',
    (_e, source: DramaSourceInput, seriesId: string, episodeId: string) => {
      if (
        !isDramaSourceInput(source) ||
        typeof seriesId !== 'string' ||
        !seriesId ||
        seriesId.length > 300 ||
        typeof episodeId !== 'string' ||
        !episodeId ||
        episodeId.length > 300
      ) {
        return { ok: false, error: '短剧参数无效' }
      }
      return cachedResponse(
        `drama:play|${source.id}|${source.baseUrl ?? ''}|${seriesId}|${episodeId}`,
        60 * 1000,
        () => dramaPlay(source, seriesId, episodeId),
        2 * 60 * 1000
      )
    }
  )

  // ---------- 小说（笔趣阁系书源） ----------
  ipcMain.handle('novel:home', (_e, source: NovelSourceInput) => {
    if (!isNovelSourceInput(source)) return { ok: false, items: [], error: '书源参数无效' }
    return cachedResponse(
      `novel:home|${source.id}|${source.baseUrl}|${source.template}`,
      10 * 60 * 1000,
      () => novelHome(source)
    )
  })

  ipcMain.handle('novel:search', (_e, source: NovelSourceInput, keyword: string) => {
    if (!isNovelSourceInput(source) || typeof keyword !== 'string' || keyword.length > 80) {
      return { ok: false, items: [], error: '搜索参数无效' }
    }
    return cachedResponse(
      `novel:search|v3|${source.id}|${source.baseUrl}|${source.template}|${keyword}`,
      10 * 60 * 1000,
      () => novelSearch(source, keyword)
    )
  })

  ipcMain.handle('novel:categoryCounts', (_e, source: NovelSourceInput) => {
    if (!isNovelSourceInput(source)) return { ok: false, counts: {}, error: '书源参数无效' }
    if (source.template !== 'bikahub') {
      return { ok: false, counts: {}, error: '该源不支持分类数量' }
    }
    return cachedResponse(
      `novel:categoryCounts|${source.baseUrl}`,
      10 * 60 * 1000,
      () => bikahubNovelCategoryCounts(source.baseUrl)
    )
  })

  ipcMain.handle(
    'novel:category',
    (_e, source: NovelSourceInput, categoryId: string, page: number) => {
      if (
        !isNovelSourceInput(source) ||
        typeof categoryId !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,20}$/.test(categoryId) ||
        typeof page !== 'number' ||
        !Number.isFinite(page) ||
        page < 1 ||
        page > 999
      ) {
        return { ok: false, items: [], error: '分类参数无效' }
      }
      return cachedResponse(
        `novel:category|${source.id}|${source.baseUrl}|${source.template}|${categoryId}|${page}`,
        10 * 60 * 1000,
        () => novelCategory(source, categoryId, page)
      )
    }
  )

  ipcMain.handle('novel:detail', (_e, source: NovelSourceInput, bookId: string) => {
    if (
      !isNovelSourceInput(source) ||
      typeof bookId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(bookId)
    ) {
      return { ok: false, error: '书籍参数无效' }
    }
    return cachedResponse(
      `novel:detail|${source.id}|${source.baseUrl}|${source.template}|${bookId}`,
      10 * 60 * 1000,
      () => novelDetail(source, bookId)
    )
  })

  ipcMain.handle(
    'novel:chapter',
    (_e, source: NovelSourceInput, bookId: string, chapterId: string) => {
      if (
        !isNovelSourceInput(source) ||
        typeof bookId !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(bookId) ||
        typeof chapterId !== 'string' ||
        !/^\d{1,20}$/.test(chapterId)
      ) {
        return { ok: false, error: '章节参数无效' }
      }
      return cachedResponse(
        `novel:chapter|${source.id}|${source.baseUrl}|${source.template}|${bookId}|${chapterId}`,
        60 * 60 * 1000,
        () => novelChapter(source, bookId, chapterId)
      )
    }
  )

  ipcMain.handle('novel:test', (_e, source: NovelSourceInput) => {
    if (!isNovelSourceInput(source)) return { ok: false, error: '书源参数无效' }
    return testNovelSource(source)
  })

  // 整本下载：主进程抓全部章节并合并成一个 TXT，进度通过事件推给页面
  ipcMain.handle('novel:download', (event, input: NovelDownloadInput) => {
    if (
      !input ||
      typeof input !== 'object' ||
      !isNovelSourceInput(input.source) ||
      typeof input.bookId !== 'string' ||
      !/^[a-zA-Z0-9_]{1,60}$/.test(input.bookId) ||
      typeof input.title !== 'string' ||
      !input.title.trim() ||
      input.title.length > 160 ||
      !Array.isArray(input.chapters) ||
      input.chapters.length === 0 ||
      input.chapters.length > 20000
    ) {
      return { ok: false, error: '下载参数无效' }
    }
    let lastAt = 0
    const onProgress = (progress: NovelDownloadProgress): void => {
      const now = Date.now()
      if (progress.done < progress.total && now - lastAt < 300) return
      lastAt = now
      if (!event.sender.isDestroyed()) {
        event.sender.send('novel:downloadProgress', progress)
      }
    }
    return novelDownload(input, onProgress)
  })

  // 导出漫画源为 JSON（名称 / 地址 / 模板 / 启用状态）

  ipcMain.handle('live:loadSources', () => loadLiveSources())

  ipcMain.handle('live:saveSources', async (_e, sources: LiveSource[]) => {
    if (!Array.isArray(sources)) throw new Error('参数无效')
    await saveLiveSources(normalizeLiveSources(sources).slice(0, 100))
  })

  ipcMain.handle('live:channels', (_e, source: LiveSource) => {
    if (!isLiveSource(source)) {
      return { sourceId: '', sourceName: '', channels: [], error: '电视源参数无效' }
    }
    return cachedResponse(
      `live:channels|v2|${source.id}|${source.url}`,
      10 * 60 * 1000,
      () => loadLiveChannels(source),
      30 * 60 * 1000
    )
  })

  ipcMain.handle('live:test', (_e, source: LiveSource) => {
    if (!isLiveSource(source)) return { ok: false, channels: 0, message: '电视源参数无效' }
    return testLiveSource(source)
  })

  ipcMain.handle('live:exportSources', async (_e, sources: unknown) => {
    const list = Array.isArray(sources) ? sources : []
    const picked = await dialog.showSaveDialog({
      title: '导出电视源',
      defaultPath: join(
        lastDialogDir('live', app.getPath('documents')),
        `老郑分享-电视源-${stamp()}.json`
      ),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await rememberDialogDir('live', picked.filePath)
    try {
      const rows = normalizeLiveSources(list).map((s) => ({
        name: s.name,
        url: s.url,
        enabled: s.enabled,
        content: s.url.startsWith('local://') ? s.content : ''
      }))
      await writeJsonAtomic(picked.filePath, rows)
      return { canceled: false, path: picked.filePath, count: rows.length }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })

  // 平台直播（B站 / 斗鱼 / 抖音）：与上面的「电视」M3U 模块分开
  ipcMain.handle('livePlatform:categories', (_e, platform: unknown) => {
    if (!isLivePlatformId(platform)) {
      return { groups: [], error: '平台参数无效' }
    }
    return liveCategories(platform)
  })

  ipcMain.handle(
    'livePlatform:list',
    (_e, platform: unknown, kind: unknown, params: unknown) => {
      if (!isLivePlatformId(platform)) {
        return { items: [], hasMore: false, error: '平台参数无效' }
      }
      const mode: LiveListKind =
        kind === 'category' || kind === 'search' ? kind : 'recommend'
      const input = (params ?? {}) as LiveListParams
      return liveList(platform, mode, {
        page: typeof input.page === 'number' ? input.page : 1,
        parentId: typeof input.parentId === 'string' ? input.parentId : '',
        areaId: typeof input.areaId === 'string' ? input.areaId : '',
        keyword: typeof input.keyword === 'string' ? input.keyword.slice(0, 60) : '',
        excludeIds: Array.isArray(input.excludeIds)
          ? input.excludeIds
              .filter((id): id is string => typeof id === 'string' && id.length > 0)
              .slice(0, 800)
          : undefined
      })
    }
  )

  ipcMain.handle(
    'livePlatform:room',
    (_e, platform: unknown, input: unknown, qualityId: unknown) => {
      if (!isLivePlatformId(platform)) {
        return {
          detail: {
            platform: 'bilibili',
            roomId: '',
            title: '',
            anchor: '',
            cover: '',
            area: '',
            watching: '',
            status: 'unknown'
          },
          qualities: [],
          lines: [],
          error: '平台参数无效'
        }
      }
      const roomInput = typeof input === 'string' ? input.slice(0, 300) : ''
      const quality = typeof qualityId === 'string' ? qualityId : undefined
      return liveRoom(platform, roomInput, quality)
    }
  )

  ipcMain.handle('livePlatform:loginStatus', (_e, platform: unknown) => {
    if (!isLivePlatformId(platform)) return { platform: 'bilibili', loggedIn: false }
    return liveLoginStatus(platform)
  })

  ipcMain.handle('livePlatform:qrStart', () => bilibiliQrStart())

  ipcMain.handle('livePlatform:qrPoll', (_e, key: unknown) => {
    return bilibiliQrPoll(typeof key === 'string' ? key : '')
  })

  ipcMain.handle('livePlatform:openLogin', (_e, platform: unknown) => {
    if (!isLivePlatformId(platform)) return { canceled: true, error: '平台参数无效' }
    return openPlatformLogin(platform)
  })

  ipcMain.handle('livePlatform:logout', (_e, platform: unknown) => {
    if (!isLivePlatformId(platform)) return { platform: 'bilibili', loggedIn: false }
    return logoutPlatform(platform)
  })

  ipcMain.handle('singing:videoInfo', (_e, input: unknown) =>
    singingVideoInfo(typeof input === 'string' ? input.slice(0, 500) : '')
  )

  ipcMain.handle('singing:play', (_e, bvid: unknown, page: unknown, qualityId: unknown) =>
    singingPlay(
      typeof bvid === 'string' ? bvid.slice(0, 40) : '',
      Number(page) || 1,
      typeof qualityId === 'string' ? qualityId.slice(0, 10) : undefined
    )
  )

  ipcMain.handle('singing:danmaku', (_e, bvid: unknown, page: unknown) =>
    singingDanmaku(typeof bvid === 'string' ? bvid.slice(0, 40) : '', Number(page) || 1)
  )

  ipcMain.handle('livePlatform:testSource', async (_e, source: unknown) => {
    const input = source && typeof source === 'object' ? (source as Record<string, unknown>) : {}
    const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : ''
    if (!/^https?:\/\//i.test(baseUrl)) {
      return { ok: false, status: 'dead', message: '地址无效', testAt: Date.now(), region: 'cn' }
    }
    try {
      const res = await fetch(baseUrl, {
        headers: { 'User-Agent': DOUYIN_UA, Referer: baseUrl },
        redirect: 'follow',
        signal: AbortSignal.timeout(12_000)
      })
      return {
        ok: res.ok,
        status: res.ok ? 'ok' : 'dead',
        message: res.ok ? `可用（HTTP ${res.status}）` : `HTTP ${res.status}`,
        testAt: Date.now(),
        region: 'cn'
      }
    } catch (err) {
      return {
        ok: false,
        status: 'dead',
        message: (err as Error).message || '连接失败',
        testAt: Date.now(),
        region: 'cn'
      }
    }
  })

  ipcMain.handle('livePlatform:exportSources', async (_e, sources: unknown) => {
    const list = Array.isArray(sources) ? sources : []
    const picked = await dialog.showSaveDialog({
      title: '导出直播源',
      defaultPath: join(
        lastDialogDir('live-platform', app.getPath('documents')),
        `老郑分享-直播源-${stamp()}.json`
      ),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await rememberDialogDir('live-platform', picked.filePath)
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

  /** 音乐源 IPC 入参：只保留主进程需要的字段（含备用线路） */
  const parseMusicSourceInputs = (sources: unknown): MusicSourceInput[] =>
    (Array.isArray(sources) ? sources : [])
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .map((s) => {
        const rawBackup =
          s.backup && typeof s.backup === 'object' ? (s.backup as Record<string, unknown>) : null
        const backupBase =
          rawBackup && typeof rawBackup.baseUrl === 'string' ? rawBackup.baseUrl.trim() : ''
        return {
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl.trim() : '',
          backup:
            backupBase && /^https?:\/\//i.test(backupBase)
              ? {
                  id: typeof rawBackup?.id === 'string' ? rawBackup.id : 's33ve',
                  name: typeof rawBackup?.name === 'string' ? rawBackup.name : '',
                  baseUrl: backupBase
                }
              : undefined
        }
      })
      .filter((s) => !!s.id && /^https?:\/\//i.test(s.baseUrl))
      .slice(0, 20)


  ipcMain.handle('music:search', (_e, sources: unknown, keyword: string, page: number) => {
    const list = parseMusicSourceInputs(sources)
    if (typeof keyword !== 'string' || keyword.length > 80 || !Number.isInteger(page)) {
      return { ok: false, items: [], error: '搜索参数无效' }
    }
    const key = `music:search|${list
      .map((s) => `${s.id}@${s.baseUrl}@${s.backup?.baseUrl ?? ''}`)
      .join(',')}|${keyword}|${page}`
    return cachedResponse(key, 6 * HOUR, () => searchMusic(list, keyword, page))
  })

  ipcMain.handle('music:top', (_e, sources: unknown, category: unknown) => {
    const list = parseMusicSourceInputs(sources)
    if (typeof category !== 'string' || !category || category.length > 40) {
      return { ok: false, items: [], error: '榜单参数无效' }
    }
    const key = `music:top|${category}|${list
      .map((s) => `${s.id}@${s.baseUrl}@${s.backup?.baseUrl ?? ''}`)
      .join(',')}`
    return cachedResponse(key, 2 * HOUR, () => fetchMusicTop(list, category))
  })

  ipcMain.handle(
    'music:resolve',
    (
      _e,
      songId: string,
      platform: string,
      baseUrl?: string,
      title?: string,
      artists?: string,
      quality?: unknown
    ) => {
      if (typeof songId !== 'string') return { ok: false, error: '歌曲参数无效' }
      const base =
        typeof baseUrl === 'string' && /^https?:\/\//i.test(baseUrl.trim())
          ? baseUrl.trim()
          : undefined
      const rawQuality =
        quality && typeof quality === 'object' ? (quality as Record<string, unknown>) : null
      const format = typeof rawQuality?.format === 'string' ? rawQuality.format.trim() : ''
      const bitrate = typeof rawQuality?.bitrate === 'string' ? rawQuality.bitrate.trim() : ''
      return resolveMusic(
        songId,
        typeof platform === 'string' ? platform : 'mvmp3',
        base,
        typeof title === 'string' ? title.slice(0, 200) : undefined,
        typeof artists === 'string' ? artists.slice(0, 200) : undefined,
        format && bitrate && /^[a-z0-9]+$/i.test(format) && /^\d+$/.test(bitrate)
          ? { format: format.toLowerCase(), bitrate }
          : undefined
      )
    }
  )

  ipcMain.handle('music:testSource', (_e, source: unknown) => {
    if (!source || typeof source !== 'object') return { ok: false, error: '参数无效' }
    const input = source as Partial<MusicSourceInput>
    const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : ''
    if (!/^https?:\/\//i.test(baseUrl)) return { ok: false, error: '音源地址无效' }
    return testMusicSource({
      id: typeof input.id === 'string' && input.id ? input.id : 'custom',
      name: typeof input.name === 'string' ? input.name : '',
      baseUrl
    })
  })

  ipcMain.handle('music:lyric', (_e, input: { songId?: unknown }) => {
    if (!input || typeof input !== 'object') return { ok: false, error: '参数无效' }
    const songId = typeof input.songId === 'string' ? input.songId.trim() : ''
    if (!songId || songId.length > 4000) return { ok: false, error: '歌曲参数无效' }
    return fetchMusicLyric(songId)
  })

  ipcMain.handle('music:saveLyrics', (_e, input: { title?: unknown; artists?: unknown; lrc?: unknown }) => {
    if (!input || typeof input !== 'object') return { ok: false, error: '参数无效' }
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    const artists = typeof input.artists === 'string' ? input.artists.trim() : ''
    const lrc = typeof input.lrc === 'string' ? input.lrc : ''
    if (!title || !lrc.trim()) return { ok: false, error: '歌词内容为空' }
    return saveMusicLyrics({
      title: title.slice(0, 200),
      artists: artists.slice(0, 200),
      lrc: lrc.slice(0, 200_000)
    })
  })

  // 导出音乐源为 JSON（名称 / 地址 / 启用状态 / 备用线路）
  ipcMain.handle('music:exportSources', async (_e, sources: unknown) => {
    const list = Array.isArray(sources) ? sources : []
    const picked = await dialog.showSaveDialog({
      title: '导出音乐源',
      defaultPath: join(
        lastDialogDir('music', app.getPath('documents')),
        `老郑分享-音乐源-${stamp()}.json`
      ),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await rememberDialogDir('music', picked.filePath)
    try {
      const rows = list
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => {
          const backupRaw =
            s.backup && typeof s.backup === 'object'
              ? (s.backup as Record<string, unknown>)
              : null
          const backupBase =
            backupRaw && typeof backupRaw.baseUrl === 'string' ? backupRaw.baseUrl.trim() : ''
          return {
            id: typeof s.id === 'string' ? s.id : '',
            name: typeof s.name === 'string' ? s.name : '',
            baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
            enabled: s.enabled !== false,
            ...(backupBase && /^https?:\/\//i.test(backupBase)
              ? {
                  backup: {
                    id: typeof backupRaw?.id === 'string' ? backupRaw.id : 's33ve',
                    name: typeof backupRaw?.name === 'string' ? backupRaw.name : '',
                    baseUrl: backupBase,
                    enabled: backupRaw?.enabled !== false
                  }
                }
              : {})
          }
        })
        .filter((s) => /^https?:\/\//i.test(s.baseUrl))
      await writeJsonAtomic(picked.filePath, rows)
      return { canceled: false, path: picked.filePath, count: rows.length }
    } catch (err) {
      return { canceled: false, error: (err as Error).message }
    }
  })


}
