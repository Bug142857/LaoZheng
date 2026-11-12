import {
  ROU07_DRAMA_SOURCE_ID,
  type DramaCatalogResponse,
  type DramaCategory,
  type DramaDetailResponse,
  type DramaEpisode,
  type DramaItem,
  type DramaPlayResponse,
  type DramaSourceInput
} from '../src/shared/drama'
import {
  fetchVodCategories,
  fetchVodDetail,
  listVodSource,
  searchVodSource
} from './vod'
import { parse as parseHtml } from 'node-html-parser'
import {
  shuangkanCatalog,
  shuangkanDetail,
  shuangkanPlay,
  shuangkanSeriesSearch
} from './shuangkan'

/**
 * 短剧数据源：
 * - 西饭：内置源，公开 App 接口（分类 / 列表 / 搜索 / 详情 / 分集）
 * - 苹果CMS：用户添加的短剧源，复用苹果 CMS V10 接口
 * - 红果 / 河马：旧版本内置源，保留代码兼容旧数据，新配置不再提供
 *
 * 所有请求都在主进程完成，渲染进程只拿结构化结果。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const TIMEOUT_MS = 15_000

const HG_ORIGIN = 'https://hongguoduanju.com'
const XF_ORIGIN = 'https://xifan-api-cn.youlishipin.com'
const HM_ORIGIN = 'https://www.kuaikaw.cn'

const HG_CATEGORIES: DramaCategory[] = [
  { slug: 'real-drama', label: '真人' },
  { slug: 'comic-drama', label: '漫剧' },
  { slug: 'ai-drama', label: 'AI' },
  { slug: 'hot-drama', label: '热播' }
]

const str = (v: unknown): string => (v == null ? '' : String(v))
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const asObj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const plain = (v: unknown): string => str(v).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()

function decodeHtml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|quot|apos|amp|lt|gt);/gi, (entity, key: string) => {
    if (key[0] !== '#') {
      const map: Record<string, string> = {
        quot: '"',
        apos: "'",
        amp: '&',
        lt: '<',
        gt: '>'
      }
      return map[key.toLowerCase()] ?? entity
    }
    const code = key[1].toLowerCase() === 'x' ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  })
}

async function requestText(url: string, init: RequestInit = {}, timeout = TIMEOUT_MS): Promise<string> {
  const res = await fetch(url, {
    ...init,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function requestJson(url: string, init: RequestInit = {}, timeout = TIMEOUT_MS): Promise<unknown> {
  const text = await requestText(url, init, timeout)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('接口返回内容不是有效 JSON')
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function httpsUrl(value: unknown): string {
  const raw = str(value)
  return /^https:\/\//i.test(raw) ? raw : ''
}

function uniqueTags(raw: unknown): string[] {
  const out: string[] = []
  for (const item of asArr(raw)) {
    const label = typeof item === 'string' ? item : plain(asObj(item)?.name ?? asObj(item)?.tag_name)
    if (label && !out.includes(label)) out.push(label)
    if (out.length >= 6) break
  }
  return out
}

// ---------------- 红果 ----------------

/** 从页面里截取 `_ROUTER_DATA = {...}`（括号配对，不执行远端脚本） */
function readRouterData(html: string): Record<string, unknown> {
  const match = /(?:window\.)?_ROUTER_DATA\s*=\s*(\{)/.exec(html)
  if (!match) throw new Error('红果页面未返回目录数据')
  const start = match.index + match[0].length - 1
  let depth = 0
  let quoted = false
  let escaped = false
  for (let i = start; i < html.length; i += 1) {
    const char = html[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{') depth += 1
    else if (char === '}' && (depth -= 1) === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1)) as Record<string, unknown>
      } catch {
        throw new Error('红果目录数据不完整')
      }
    }
  }
  throw new Error('红果目录数据不完整')
}

function hgItem(video: Record<string, unknown>, sourceName: string): DramaItem | null {
  const seriesId = str(video.series_id)
  const title = plain(video.series_name ?? video.series_title)
  if (!/^\d{6,}$/.test(seriesId) || !title) return null
  return {
    seriesId,
    title,
    cover:/https?:\/\//i.test(str(video.series_cover)) ? str(video.series_cover) : '',
    episodeCount: num(video.episode_cnt),
    tags: uniqueTags(video.tags),
    remarks: plain(video.episode_right_text),
    sourceId: 'hongguo',
    sourceName
  }
}

function parseHgCategory(html: string, genre: string, sourceName: string): DramaCatalogResponse {
  const router = readRouterData(html)
  const loader = asObj(router.loaderData) ?? {}
  const data = Object.values(loader)
    .map((value) => asObj(value))
    .find((value) => str(asObj(value?.categoryRoute)?.contentType) === genre)
  if (!data) throw new Error('红果目录暂无数据')
  if (data.isSuccess === false) throw new Error('红果目录暂不可用')
  const list = asArr(data.recommendList)
  const items = list
    .map((raw) => {
      const video = asObj(raw)
      return video ? hgItem(video, sourceName) : null
    })
    .filter((item): item is DramaItem => !!item)
  const pagination = asObj(data.pagination) ?? {}
  const page = num(pagination.pageNum) || 1
  const pageCount = num(pagination.totalPages) || 1
  return {
    ok: true,
    items,
    page,
    pageCount,
    hasMore: page < pageCount,
    categories: HG_CATEGORIES
  }
}

function parseHgRank(html: string, page: number, sourceName: string): DramaCatalogResponse {
  const seen = new Set<string>()
  const items: DramaItem[] = []
  for (const match of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
    const article = match[1]
    const heading = /<h2\b[^>]*\bid=["']rank-title-(\d+)["'][^>]*>([\s\S]*?)<\/h2>/i.exec(article)
    if (!heading) continue
    const seriesId = heading[1]
    if (!new RegExp(`/detail\\?series_id=${seriesId}`).test(article)) continue
    const title = plain(decodeHtml(heading[2]))
    if (!title || seen.has(seriesId)) continue
    seen.add(seriesId)
    const cover = /<img\b[^>]*\bsrc=(?:"([^"]*)"|'([^']*)')/i.exec(article)
    const tagsBlock =
      /<p\b[^>]*class=["'][^"']*pc-categories-[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(article)
    const tags = tagsBlock
      ? Array.from(tagsBlock[1].matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi), (tag) =>
          plain(decodeHtml(tag[1]))
        ).filter(Boolean)
      : []
    const statusTag =
      /<li\b[^>]*class=["'][^"']*pc-status-tag[^"']*["'][^>]*>([\s\S]*?)<\/li>/i.exec(article)
    items.push({
      seriesId,
      title,
      cover: cover ? decodeHtml(cover[1] ?? cover[2]) : '',
      episodeCount: 0,
      tags: tags.slice(0, 6),
      remarks: statusTag ? plain(decodeHtml(statusTag[1])) : '',
      sourceId: 'hongguo',
      sourceName
    })
  }
  if (!items.length) throw new Error('红果榜单暂不可用')
  const nav = /<nav\b[^>]*aria-label=["']榜单分页["'][^>]*>([\s\S]*?)<\/nav>/i.exec(html)?.[1] ?? ''
  const pages = Array.from(nav.matchAll(/[?&]page=(\d+)/g), (m) => num(m[1])).filter((n) => n > 0)
  const pageCount = pages.length ? Math.max(page, ...pages) : 0
  return {
    ok: true,
    items,
    page,
    pageCount,
    hasMore: pageCount > 0 ? page < pageCount : items.length >= 20,
    categories: HG_CATEGORIES
  }
}

async function hgCatalog(
  source: DramaSourceInput,
  genre: string,
  page: number
): Promise<DramaCatalogResponse> {
  const key = HG_CATEGORIES.some((item) => item.slug === genre) ? genre : 'real-drama'
  const url = key.startsWith('hot-')
    ? `${HG_ORIGIN}/rank/${key}${page > 1 ? `?page=${page}` : ''}`
    : `${HG_ORIGIN}/category/${key}${page > 1 ? `?page=${page}` : ''}`
  const html = await requestText(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html', Referer: `${HG_ORIGIN}/` }
  })
  const parsed = key.startsWith('hot-')
    ? parseHgRank(html, page, source.name)
    : parseHgCategory(html, key, source.name)
  return { ...parsed, page, categories: HG_CATEGORIES }
}

async function hgSearch(source: DramaSourceInput, keyword: string, page: number): Promise<DramaCatalogResponse> {
  const url = `${HG_ORIGIN}/api/search/result?aid=8662&query=${encodeURIComponent(keyword)}&page=${page}`
  const raw = asObj(
    await requestJson(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        Referer: `${HG_ORIGIN}/`
      }
    })
  )
  if (!raw) throw new Error('红果搜索返回异常')
  if (typeof raw.code === 'string') throw new Error('红果搜索服务暂不可用')
  if (!Array.isArray(raw.searchList)) throw new Error('红果搜索返回异常')
  const seen = new Set<string>()
  const items: DramaItem[] = []
  for (const entry of asArr(raw.searchList)) {
    const item = asObj(entry)
    if (!item) continue
    const video = asObj(item.video_data) ?? item
    const parsed = hgItem(video, source.name)
    if (!parsed || seen.has(parsed.seriesId)) continue
    seen.add(parsed.seriesId)
    items.push(parsed)
  }
  const totalPages = num(raw.totalPages)
  const current = num(raw.pageNum) || page
  return {
    ok: true,
    items,
    page: current,
    pageCount: totalPages,
    hasMore: raw.hasMore === true || (totalPages > 0 && current < totalPages),
    categories: HG_CATEGORIES
  }
}

async function hgDetail(source: DramaSourceInput, seriesId: string): Promise<DramaDetailResponse> {
  if (!/^\d{6,}$/.test(seriesId)) return { ok: false, error: '红果剧集编号无效' }
  const html = await requestText(`${HG_ORIGIN}/player/${seriesId}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html', Referer: `${HG_ORIGIN}/` }
  })
  const router = readRouterData(html)
  const loader = asObj(router.loaderData) ?? {}
  const data = Object.values(loader)
    .map((value) => asObj(value))
    .find((value) => !!asObj(value?.seriesDetail) && str(asObj(value?.seriesDetail)?.series_id) === seriesId)
  const detail = asObj(data?.seriesDetail)
  if (!detail) return { ok: false, error: '红果未返回该剧集信息' }
  const vids = asArr(detail.vid_list).map((vid) => str(vid)).filter((vid) => /^\d{1,30}$/.test(vid))
  if (!vids.length) return { ok: false, error: '红果没有返回可用分集' }
  const accessible = num(detail.accessible_episode_cnt)
  const publicEpisodes = accessible > 0 ? Math.min(accessible, vids.length) : vids.length
  const episodes: DramaEpisode[] = vids.map((vid, index) => ({
    id: vid,
    index: index + 1,
    name: `第${index + 1}集`,
    locked: index >= publicEpisodes,
    ...(index >= publicEpisodes ? { lockedReason: '红果网页仅公开前几集，完整剧集请在红果官方 App 观看' } : {})
  }))
  return {
    ok: true,
    detail: {
      seriesId,
      title: plain(detail.series_name) || '未命名短剧',
      cover: str(detail.series_cover),
      intro: plain(detail.series_intro),
      tags: uniqueTags(detail.tags),
      episodes,
      sourceId: 'hongguo',
      sourceName: source.name,
      publicEpisodes
    }
  }
}

/** 从 ld+json 里找与当前 player 页绑定的 VideoObject */
function hgContentUrl(html: string, seriesId: string, vid: string): string {
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(script[1])) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(script[2]) as unknown
    } catch {
      continue
    }
    const candidates = [parsed, ...asArr(asObj(parsed)?.['@graph'])]
    for (const candidate of candidates) {
      const video = asObj(candidate)
      if (!video || video['@type'] !== 'VideoObject') continue
      const pageUrl = str(video.url)
      if (pageUrl && !pageUrl.includes(`/player/${seriesId}`)) continue
      const raw = str(video.contentUrl).replace(/\\u002F/gi, '/').replace(/&amp;/g, '&')
      try {
        const url = new URL(raw)
        if (url.protocol !== 'https:' || url.hostname !== 'hongguoduanju.com') continue
        if (!url.pathname.startsWith('/video/public/')) continue
        if (!url.pathname.includes(`/${vid}/`)) continue
        return url.href
      } catch {
        continue
      }
    }
  }
  return ''
}

async function hgPlay(seriesId: string, episodeId: string): Promise<DramaPlayResponse> {
  if (!/^\d{6,}$/.test(seriesId) || !/^\d{1,30}$/.test(episodeId)) {
    return { ok: false, error: '红果剧集编号无效' }
  }
  const candidates = [
    `${HG_ORIGIN}/player/${seriesId}/${episodeId}`,
    `${HG_ORIGIN}/player/_/${episodeId}`
  ]
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html', Referer: `${HG_ORIGIN}/` },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      if (!res.ok) continue
      const html = await res.text()
      // 第 6 集之后官网会 302 回第 1 集并带 pc_locked_episode
      if (/pc_locked_episode=/.test(res.url)) {
        return { ok: false, error: '该集红果网页未公开，完整剧集请在红果官方 App 观看' }
      }
      const contentUrl = hgContentUrl(html, seriesId, episodeId)
      if (contentUrl) return { ok: true, url: contentUrl }
    } catch {
      // 换下一个候选地址
    }
  }
  return { ok: false, error: '红果没有返回该集的公开播放地址' }
}

// ---------------- 西饭 ----------------

interface XifanCategory extends DramaCategory {
  categoryId: number
  version: number
  name: string
}

let xifanCategoryCache = new Map<string, { at: number; items: XifanCategory[] }>()

function parseXifanCategories(result: Record<string, unknown>): XifanCategory[] {
  const out: XifanCategory[] = []
  const seen = new Set<string>()
  const push = (raw: unknown): void => {
    const category = asObj(raw)
    if (!category) return
    const categoryId = num(category.categoryId)
    const label = plain(category.oppoCategory)
    if (categoryId <= 0 || !label) return
    const key = `${categoryId}|${label}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      slug: `${categoryId}|${num(category.version) || 1}|${encodeURIComponent(label)}`,
      label,
      categoryId,
      version: num(category.version) || 1,
      name: label
    })
  }
  for (const element of asArr(result.elements)) {
    for (const content of asArr(asObj(element)?.contents)) {
      const category = asObj(asObj(content)?.categoryItemVo)
      if (!category) continue
      const subs = asArr(category.subCategories)
      if (subs.length) subs.forEach(push)
      else push(category)
    }
  }
  return out
}

/** 西饭源允许在片源管理里改地址：默认用官方接口地址 */
function xifanBase(source: DramaSourceInput): string {
  const raw = (source.baseUrl ?? '').trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(raw) ? raw : XF_ORIGIN
}

async function xifanCategories(base: string): Promise<XifanCategory[]> {
  const cached = xifanCategoryCache.get(base)
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
    return cached.items
  }
  const raw = asObj(
    await requestJson(
      `${base}/xifan/drama/portalPage?reqType=duanjuCategory&version=2001001&androidVersionCode=28`,
      { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }
    )
  )
  const result = asObj(raw?.result)
  if (!result || num(raw?.ret) !== 0) throw new Error('西饭分类接口暂不可用')
  const items = parseXifanCategories(result)
  if (!items.length) throw new Error('西饭没有返回可用分类')
  xifanCategoryCache.set(base, { at: Date.now(), items })
  return items
}

function xifanItem(raw: unknown, sourceName: string): DramaItem | null {
  const item = asObj(raw)
  if (!item) return null
  const source = str(item.source)
  const duanjuId = str(item.duanjuId)
  const title = plain(item.title)
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(source) || !/^[a-zA-Z0-9_-]{1,200}$/.test(duanjuId) || !title) {
    return null
  }
  return {
    seriesId: `xifan:${source}:${duanjuId}`,
    title,
    cover: httpsUrl(item.coverImageUrl),
    episodeCount: num(item.total),
    tags: uniqueTags(item.categories),
    remarks: str(item.updateStatus) === 'over' ? '已完结' : '',
    sourceId: 'xifan',
    sourceName
  }
}

function parseXifanList(result: Record<string, unknown>, page: number, sourceName: string): DramaCatalogResponse {
  const seen = new Set<string>()
  const items: DramaItem[] = []
  for (const element of asArr(result.elements)) {
    for (const content of asArr(asObj(element)?.contents)) {
      const item = xifanItem(asObj(content)?.duanjuVo, sourceName)
      if (!item || seen.has(item.seriesId)) continue
      seen.add(item.seriesId)
      items.push(item)
    }
  }
  const hasMore = result.hasMore === true && items.length > 0
  return {
    ok: true,
    items,
    page,
    pageCount: 0,
    hasMore,
    categories: []
  }
}

async function xifanCatalog(
  source: DramaSourceInput,
  genre: string,
  page: number
): Promise<DramaCatalogResponse> {
  const base = xifanBase(source)
  const categories = await xifanCategories(base)
  const picked =
    (genre ? categories.find((item) => item.slug === genre) : undefined) ??
    categories.find((item) => item.label === '都市') ??
    categories[0]
  if (!picked) throw new Error('西饭题材无效')
  const offset = (page - 1) * 30
  const url = `${base}/xifan/drama/portalPage?reqType=aggregationPage&offset=${offset}&categoryId=${picked.categoryId}&categoryNames=${encodeURIComponent(picked.name)}&categoryVersion=${picked.version}&version=2001001&androidVersionCode=28`
  const raw = asObj(
    await requestJson(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } })
  )
  const result = asObj(raw?.result)
  if (!result || num(raw?.ret) !== 0) throw new Error('西饭列表接口暂不可用')
  return {
    ...parseXifanList(result, page, source.name),
    categories: categories.map((item) => ({ slug: item.slug, label: item.label }))
  }
}

async function xifanSearch(
  source: DramaSourceInput,
  keyword: string,
  page: number
): Promise<DramaCatalogResponse> {
  const url = `${xifanBase(source)}/xifan/search/getSearchList?keyword=${encodeURIComponent(keyword)}&pageIndex=${page}&version=2001001&androidVersionCode=28`
  const raw = asObj(
    await requestJson(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } })
  )
  const result = asObj(raw?.result)
  if (!result || num(raw?.ret) !== 0) throw new Error('西饭搜索暂不可用')
  return parseXifanList(result, page, source.name)
}

function parseXifanSeriesId(seriesId: string): { source: string; duanjuId: string } | null {
  const parts = seriesId.split(':')
  if (parts.length !== 3 || parts[0] !== 'xifan') return null
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(parts[1]) || !/^[a-zA-Z0-9_-]{1,200}$/.test(parts[2])) {
    return null
  }
  return { source: parts[1], duanjuId: parts[2] }
}

async function xifanDetail(source: DramaSourceInput, seriesId: string): Promise<DramaDetailResponse> {
  const id = parseXifanSeriesId(seriesId)
  if (!id) return { ok: false, error: '西饭剧集编号无效' }
  const url = `${xifanBase(source)}/xifan/drama/getDuanjuInfo?source=${encodeURIComponent(id.source)}&duanjuId=${encodeURIComponent(id.duanjuId)}&version=2001001&androidVersionCode=28`
  const raw = asObj(
    await requestJson(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } })
  )
  const result = asObj(raw?.result)
  if (!result || num(raw?.ret) !== 0) return { ok: false, error: '西饭未返回该剧集信息' }
  const episodes: DramaEpisode[] = asArr(result.episodeList)
    .map((rawEpisode, index) => {
      const episode = asObj(rawEpisode)
      if (!episode) return null
      const episodeId = str(episode.episodeId)
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(episodeId)) return null
      const unlocked = episode.unlock === true
      return {
        id: episodeId,
        index: num(episode.index) || index + 1,
        name: plain(episode.title) || `第${num(episode.index) || index + 1}集`,
        locked: !unlocked,
        ...(unlocked ? {} : { lockedReason: '该集当前未解锁，请在官方平台确认可看范围' })
      } satisfies DramaEpisode
    })
    .filter((episode): episode is DramaEpisode => !!episode)
    .sort((a, b) => a.index - b.index)
  if (!episodes.length) return { ok: false, error: '西饭没有返回可用分集' }
  return {
    ok: true,
    detail: {
      seriesId,
      title: plain(result.title) || '未命名短剧',
      cover: httpsUrl(result.coverImageUrl),
      intro: plain(result.desc),
      tags: uniqueTags(result.categories),
      episodes,
      sourceId: 'xifan',
      sourceName: source.name
    }
  }
}

async function xifanPlay(
  source: DramaSourceInput,
  seriesId: string,
  episodeId: string
): Promise<DramaPlayResponse> {
  const id = parseXifanSeriesId(seriesId)
  if (!id) return { ok: false, error: '西饭剧集编号无效' }
  const url = `${xifanBase(source)}/xifan/drama/getDuanjuInfo?source=${encodeURIComponent(id.source)}&duanjuId=${encodeURIComponent(id.duanjuId)}&version=2001001&androidVersionCode=28`
  const raw = asObj(
    await requestJson(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } })
  )
  const result = asObj(raw?.result)
  const episode = asArr(result?.episodeList)
    .map((item) => asObj(item))
    .find((item) => str(item?.episodeId) === episodeId)
  if (!episode) return { ok: false, error: '西饭未找到该分集' }
  if (episode.unlock !== true) return { ok: false, error: '该集当前未解锁，请在官方平台确认可看范围' }
  const playUrl = httpsUrl(episode.playUrl)
  if (!playUrl) return { ok: false, error: '西饭没有返回有效播放地址' }
  return { ok: true, url: playUrl }
}

// ---------------- 河马 ----------------

function parseNextData(html: string): Record<string, unknown> {
  const match = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)
  if (!match) throw new Error('河马页面未返回数据')
  try {
    const data = asObj((JSON.parse(match[1]) as Record<string, unknown>).props)
    return asObj(data?.pageProps) ?? {}
  } catch {
    throw new Error('河马页面数据解析失败')
  }
}

function hemaCategoriesOf(page: Record<string, unknown>): DramaCategory[] {
  const out: DramaCategory[] = []
  const seen = new Set<string>()
  for (const raw of asArr(page.typeThreeList)) {
    const item = asObj(raw)
    if (!item) continue
    const ids = asArr(item.typeThreeIds).map((id) => str(id)).filter((id) => /^\d{1,30}$/.test(id))
    const label = plain(item.name)
    if (!ids.length || !label) continue
    const slug = ids.join('-')
    if (seen.has(slug)) continue
    seen.add(slug)
    out.push({ slug, label })
  }
  return out
}

function hemaItem(raw: unknown, sourceName: string): DramaItem | null {
  const item = asObj(raw)
  if (!item) return null
  const bookId = str(item.bookId)
  const title = plain(item.bookName)
  if (!/^\d{1,30}$/.test(bookId) || !title) return null
  return {
    seriesId: `hema:${bookId}`,
    title,
    cover: httpsUrl(item.coverWap),
    episodeCount: num(item.totalChapterNum),
    tags: uniqueTags(item.bookTypeThree),
    remarks: '',
    sourceId: 'hema',
    sourceName
  }
}

async function hemaCatalog(
  source: DramaSourceInput,
  genre: string,
  page: number
): Promise<DramaCatalogResponse> {
  const slug = /^\d{1,30}(?:-\d{1,30}){0,15}$/.test(genre) ? genre : '0'
  const path = slug === '0' && page === 1 ? '/browse' : `/browse/${slug}${page > 1 ? `/${page}` : ''}`
  const html = await requestText(`${HM_ORIGIN}${path}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html', Referer: `${HM_ORIGIN}/` }
  })
  const data = parseNextData(html)
  const seen = new Set<string>()
  const items = asArr(data.bookList)
    .map((raw) => hemaItem(raw, source.name))
    .filter((item): item is DramaItem => {
      if (!item || seen.has(item.seriesId)) return false
      seen.add(item.seriesId)
      return true
    })
  const current = num(data.page) || page
  const pageCount = num(data.pages)
  return {
    ok: true,
    items,
    page: current,
    pageCount,
    hasMore: pageCount > 0 ? current < pageCount : items.length >= 10,
    categories: hemaCategoriesOf(data)
  }
}

async function hemaSearch(
  source: DramaSourceInput,
  keyword: string,
  page: number
): Promise<DramaCatalogResponse> {
  const raw = asObj(
    await requestJson(`${HM_ORIGIN}/seo/video/6007`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'application/json',
        'Content-Type': 'application/json',
        pname: 'www.kuaikaw.cn',
        Origin: HM_ORIGIN,
        Referer: `${HM_ORIGIN}/`
      },
      body: JSON.stringify({ sourceType: 1, keyword, index: page })
    })
  )
  if (!raw || num(raw.retCode) !== 0) throw new Error('河马搜索暂不可用')
  const data = asObj(raw.data)
  if (!data) throw new Error('河马搜索返回异常')
  const seen = new Set<string>()
  const items = asArr(data.bookList)
    .map((item) => hemaItem(item, source.name))
    .filter((item): item is DramaItem => {
      if (!item || seen.has(item.seriesId)) return false
      seen.add(item.seriesId)
      return true
    })
  const hasMore = num(data.isMore) === 1 && items.length > 0
  return {
    ok: true,
    items,
    page,
    pageCount: 0,
    hasMore,
    categories: []
  }
}

function parseHemaSeriesId(seriesId: string): string | null {
  const parts = seriesId.split(':')
  if (parts.length !== 2 || parts[0] !== 'hema' || !/^\d{1,30}$/.test(parts[1])) return null
  return parts[1]
}

async function hemaDetailData(bookId: string): Promise<Record<string, unknown>> {
  const html = await requestText(`${HM_ORIGIN}/drama/${bookId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html', Referer: `${HM_ORIGIN}/` }
  })
  const page = parseNextData(html)
  if (str(asObj(page.bookInfoVo)?.bookId) !== bookId) throw new Error('河马返回的剧集与请求不一致')
  return page
}

async function hemaDetail(source: DramaSourceInput, seriesId: string): Promise<DramaDetailResponse> {
  const bookId = parseHemaSeriesId(seriesId)
  if (!bookId) return { ok: false, error: '河马剧集编号无效' }
  const page = await hemaDetailData(bookId)
  const info = asObj(page.bookInfoVo) ?? {}
  const episodes: DramaEpisode[] = asArr(page.chapterList)
    .map((raw, index) => {
      const chapter = asObj(raw)
      if (!chapter) return null
      const chapterId = str(chapter.chapterId)
      if (!/^\d{1,30}$/.test(chapterId)) return null
      const locked = str(chapter.isCharge) !== '0'
      return {
        id: chapterId,
        index: num(chapter.chapterIndex) || index + 1,
        name: plain(chapter.chapterName) || `第${index + 1}集`,
        locked,
        ...(locked ? { lockedReason: '该集在河马官方平台为付费内容' } : {})
      } satisfies DramaEpisode
    })
    .filter((episode): episode is DramaEpisode => !!episode)
    .sort((a, b) => a.index - b.index)
  if (!episodes.length) return { ok: false, error: '河马没有返回可用分集' }
  return {
    ok: true,
    detail: {
      seriesId,
      title: plain(info.bookName) || '未命名短剧',
      cover: httpsUrl(info.coverWap),
      intro: plain(info.introduction),
      tags: [],
      episodes,
      sourceId: 'hema',
      sourceName: source.name
    }
  }
}

async function hemaPlay(seriesId: string, episodeId: string): Promise<DramaPlayResponse> {
  const bookId = parseHemaSeriesId(seriesId)
  if (!bookId) return { ok: false, error: '河马剧集编号无效' }
  const page = await hemaDetailData(bookId)
  const chapter = asArr(page.chapterList)
    .map((item) => asObj(item))
    .find((item) => str(item?.chapterId) === episodeId)
  if (!chapter) return { ok: false, error: '河马未找到该分集' }
  if (str(chapter.isCharge) !== '0') return { ok: false, error: '该集在河马官方平台为付费内容' }
  const video = asObj(chapter.chapterVideoVo) ?? {}
  const url =
    httpsUrl(video.mp4720p) ||
    httpsUrl(video.mp4) ||
    httpsUrl(video.m3u8720p) ||
    httpsUrl(video.m3u8)
  if (!url) return { ok: false, error: '河马没有返回有效播放地址' }
  return { ok: true, url }
}

// ---------------- 自定义（苹果 CMS 影视源） ----------------

function customVodSource(source: DramaSourceInput): { id: string; name: string; baseUrl: string } {
  if (!isHttpUrl(source.baseUrl ?? '')) throw new Error('自定义短剧源未配置影视源接口')
  return { id: `custom:${source.id}`, name: source.name, baseUrl: source.baseUrl! }
}

async function customCatalog(
  source: DramaSourceInput,
  genre: string,
  page: number,
  keyword: string
): Promise<DramaCatalogResponse> {
  const vod = customVodSource(source)
  const typeId = Number.parseInt(genre, 10) || 0
  if (keyword) {
    const res = await searchVodSource(vod, keyword)
    if (!res.ok) throw new Error(res.error || '自定义源搜索失败')
    const items = res.items.map((item) => ({
      seriesId: String(item.vod_id),
      title: item.vod_name,
      cover: /^https?:\/\//i.test(item.vod_pic) ? item.vod_pic : '',
      episodeCount: 0,
      tags: item.type_name ? [item.type_name] : [],
      remarks: item.vod_remarks,
      sourceId: source.id,
      sourceName: source.name
    }))
    const categories = await vodCategories(vod)
    return { ok: true, items, page: 1, pageCount: 0, hasMore: false, categories }
  }
  const [list, categories] = await Promise.all([
    listVodSource(vod, page, typeId, ''),
    vodCategories(vod)
  ])
  if (!list.ok) throw new Error(list.error || '自定义源加载失败')
  const items = (list.items ?? []).map((item) => ({
    seriesId: String(item.vod_id),
    title: item.vod_name,
    cover: /^https?:\/\//i.test(item.vod_pic) ? item.vod_pic : '',
    episodeCount: 0,
    tags: item.type_name ? [item.type_name] : [],
    remarks: item.vod_remarks,
    sourceId: source.id,
    sourceName: source.name
  }))
  const pageCount = list.pageCount ?? 1
  return {
    ok: true,
    items,
    page: list.page ?? page,
    pageCount,
    hasMore: page < pageCount,
    categories,
    total: list.total ?? 0
  }
}

async function vodCategories(vod: { id: string; name: string; baseUrl: string }): Promise<DramaCategory[]> {
  const res = await fetchVodCategories({ id: vod.id, name: vod.name, baseUrl: vod.baseUrl })
  return (res.categories ?? []).map((category) => ({
    slug: String(category.type_id),
    label: category.type_name
  }))
}

function parseCustomSeriesId(seriesId: string): number | null {
  if (!/^\d{1,30}$/.test(seriesId)) return null
  const id = Number(seriesId)
  return Number.isInteger(id) && id > 0 ? id : null
}

async function customDetail(source: DramaSourceInput, seriesId: string): Promise<DramaDetailResponse> {
  const vod = customVodSource(source)
  const vodId = parseCustomSeriesId(seriesId)
  if (!vodId) return { ok: false, error: '自定义源剧集编号无效' }
  const res = await fetchVodDetail(vod, vodId)
  if (!res.ok || !res.item) return { ok: false, error: res.error ?? '自定义源没有返回该剧集' }
  const episodes: DramaEpisode[] = []
  let index = 0
  for (const [groupIndex, group] of (res.groups ?? []).entries()) {
    for (const [episodeIndex, episode] of group.episodes.entries()) {
      index += 1
      episodes.push({
        id: `${groupIndex}:${episodeIndex}`,
        index,
        name: episode.name || `第${index}集`,
        locked: false
      })
    }
  }
  if (!episodes.length) return { ok: false, error: '自定义源没有返回可播放分集' }
  return {
    ok: true,
    detail: {
      seriesId,
      title: res.item.vod_name,
      cover: /^https?:\/\//i.test(res.item.vod_pic) ? res.item.vod_pic : '',
      intro: '',
      tags: res.item.type_name ? [res.item.type_name] : [],
      episodes,
      sourceId: source.id,
      sourceName: source.name
    }
  }
}

async function customPlay(
  source: DramaSourceInput,
  seriesId: string,
  episodeId: string
): Promise<DramaPlayResponse> {
  const vod = customVodSource(source)
  const vodId = parseCustomSeriesId(seriesId)
  if (!vodId) return { ok: false, error: '自定义源剧集编号无效' }
  const match = /^(\d{1,3}):(\d{1,4})$/.exec(episodeId)
  if (!match) return { ok: false, error: '自定义源分集编号无效' }
  const res = await fetchVodDetail(vod, vodId)
  if (!res.ok || !res.item) return { ok: false, error: res.error ?? '自定义源没有返回该剧集' }
  const group = res.groups?.[Number(match[1])]
  const episode = group?.episodes[Number(match[2])]
  if (!episode) return { ok: false, error: '自定义源未找到该分集' }
  return { ok: true, url: episode.url }
}

// ---------------- 五五短剧（duanju55） ----------------
// 该站苹果 CMS 接口已关闭（api.php 返回 closed），改为直接解析网页：
// 列表 / 搜索 / 详情 / 播放页都是标准苹果 CMS 模板，接口挂掉也不影响使用；
// 同时保留备用域名，主域名失效时自动切换，避免整源不可用。

const DJ55_SOURCE_ID = 'duanju55'
const DJ55_ORIGINS = ['https://www.duanju55.com', 'https://duanju55.com']
const DJ55_CATEGORIES: DramaCategory[] = [
  { slug: '6', label: '女频恋爱' },
  { slug: '7', label: '反转爽剧' },
  { slug: '8', label: '古装仙侠' },
  { slug: '9', label: '年代穿越' },
  { slug: '10', label: '脑洞悬疑' },
  { slug: '11', label: '现代都市' }
]
const dj55OriginCache = new Map<string, string>()

type HtmlRoot = ReturnType<typeof parseHtml>

function isDuanju55Source(source: DramaSourceInput): boolean {
  if (source.id === DJ55_SOURCE_ID) return true
  try {
    return /(^|\.)duanju55\.(com|cc|net|vip|top)$/i.test(new URL(source.baseUrl ?? '').host)
  } catch {
    return false
  }
}

function dj55CleanText(value: string): string {
  return plain(value).replace(/\u200b/g, '').replace(/\s+/g, ' ').trim()
}

function dj55Origins(source: DramaSourceInput): string[] {
  const cacheKey = (source.baseUrl ?? '').trim().toLowerCase() || 'default'
  const origins: string[] = []
  try {
    const base = new URL(source.baseUrl ?? '')
    if (base.protocol === 'http:' || base.protocol === 'https:') origins.push(base.origin)
  } catch {
    // 没配 baseUrl 时只用内置备用域名
  }
  for (const origin of DJ55_ORIGINS) if (!origins.includes(origin)) origins.push(origin)
  const preferred = dj55OriginCache.get(cacheKey)
  return preferred && origins.includes(preferred)
    ? [preferred, ...origins.filter((origin) => origin !== preferred)]
    : origins
}

async function dj55Request(source: DramaSourceInput, path: string): Promise<string> {
  let lastError: Error | null = null
  const cacheKey = (source.baseUrl ?? '').trim().toLowerCase() || 'default'
  for (const origin of dj55Origins(source)) {
    try {
      const text = await requestText(`${origin}${path}`, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' }
      })
      dj55OriginCache.set(cacheKey, origin)
      return text
    } catch (err) {
      lastError = err as Error
    }
  }
  throw lastError ?? new Error('五五短剧暂时无法访问')
}

function dj55MaxPage(root: HtmlRoot, fallback: number): number {
  let max = fallback
  for (const anchor of root.querySelectorAll('a')) {
    const matched = /\/page\/(\d+)(?:\/|\.html|$)/.exec(anchor.getAttribute('href') ?? '')
    if (matched) max = Math.max(max, num(matched[1]))
  }
  return max
}

function dj55Items(root: HtmlRoot, source: DramaSourceInput): DramaItem[] {
  const cards = [
    ...root.querySelectorAll('.BrowseList_itemBox'),
    ...root.querySelectorAll('.TagBookList_tagItem')
  ]
  const items: DramaItem[] = []
  const seen = new Set<string>()
  for (const card of cards) {
    const link = card.querySelector('a[href*="/vod/detail/id/"]')
    const matched = /\/vod\/detail\/id\/(\d+)\.html/.exec(link?.getAttribute('href') ?? '')
    if (!matched || seen.has(matched[1])) continue
    const image = card.querySelector('img')
    const titleEl = card.querySelector('.BrowseList_bookName') ?? card.querySelector('.TagBookList_bookName')
    // 列表标题里夹着「367人在追」的火苗徽标，先去掉再取标题；搜索页标题里的高亮 <font> 保留文本
    titleEl?.querySelector('.BrowseList_bookRate')?.remove()
    const title = dj55CleanText(titleEl?.text ?? '') || dj55CleanText(image?.getAttribute('alt') ?? '')
    if (!title) continue
    seen.add(matched[1])
    const rawCover = image?.getAttribute('src') ?? ''
    const remarks = dj55CleanText(
      card.querySelector('.BrowseList_totalChapterNum')?.text ??
        card.querySelector('.TagBookList_totalChapterNum')?.text ??
        ''
    )
    items.push({
      seriesId: matched[1],
      title,
      cover: /^https?:\/\//i.test(rawCover) ? rawCover : rawCover.startsWith('//') ? `https:${rawCover}` : '',
      episodeCount: 0,
      tags: [],
      remarks,
      sourceId: source.id,
      sourceName: source.name
    })
  }
  return items
}

async function dj55Catalog(
  source: DramaSourceInput,
  genre: string,
  page: number,
  keyword: string
): Promise<DramaCatalogResponse> {
  const typeId = /^\d{1,4}$/.test(genre) ? genre : '1'
  const path = keyword
    ? `/index.php/vod/search/page/${page}/wd/${encodeURIComponent(keyword)}.html`
    : page > 1
      ? `/index.php/vod/type/id/${typeId}/page/${page}.html`
      : `/index.php/vod/type/id/${typeId}.html`
  const root = parseHtml(await dj55Request(source, path))
  const items = dj55Items(root, source)
  const pageCount = dj55MaxPage(root, page)
  return {
    ok: true,
    items,
    page,
    pageCount,
    hasMore: items.length > 0 && page < pageCount,
    categories: DJ55_CATEGORIES
  }
}

async function dj55Detail(source: DramaSourceInput, seriesId: string): Promise<DramaDetailResponse> {
  if (!/^\d{1,30}$/.test(seriesId)) return { ok: false, error: '五五短剧剧集编号无效' }
  const root = parseHtml(await dj55Request(source, `/index.php/vod/detail/id/${seriesId}.html`))
  const title =
    dj55CleanText(root.querySelector('h1')?.text ?? '') ||
    dj55CleanText(root.querySelector('title')?.text ?? '')
  let cover = ''
  for (const image of root.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? ''
    if (!/\/upload\/vod\//.test(src)) continue
    cover = /^https?:\/\//i.test(src) ? src : src.startsWith('//') ? `https:${src}` : ''
    if (cover) break
  }
  const introEl = root
    .querySelectorAll('[class]')
    .find((el) => /introduction/i.test(el.getAttribute('class') ?? ''))
  const desc = root.querySelector('meta[name="description"]')?.getAttribute('content') ?? ''
  const intro = dj55CleanText(introEl?.text ?? '') || dj55CleanText(desc)
  // 详情页可能同时有「线路 / 全集」等多组播放列表，取分集最多的那一组，避免混入全集条目
  const groups = new Map<string, DramaEpisode[]>()
  const seen = new Set<string>()
  const episodeRe = new RegExp(`/vod/play/id/${seriesId}/sid/(\\d+)/nid/(\\d+)\\.html`)
  for (const anchor of root.querySelectorAll('a')) {
    const matched = episodeRe.exec(anchor.getAttribute('href') ?? '')
    if (!matched) continue
    const [, sid, nid] = matched
    const id = `${sid}:${nid}`
    if (seen.has(id)) continue
    seen.add(id)
    const list = groups.get(sid) ?? []
    const label = dj55CleanText(anchor.text)
    const index = list.length + 1
    list.push({
      id,
      index,
      name: /^\d+$/.test(nid) ? `第${num(nid)}集` : label || `第${index}集`,
      locked: false
    })
    groups.set(sid, list)
  }
  const episodes = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? []
  episodes.forEach((episode, i) => {
    episode.index = i + 1
  })
  if (!episodes.length) return { ok: false, error: '五五短剧没有返回可播放分集' }
  return {
    ok: true,
    detail: {
      seriesId,
      title: title || `五五短剧 ${seriesId}`,
      cover,
      intro,
      tags: [],
      episodes,
      sourceId: source.id,
      sourceName: source.name
    }
  }
}

/** 从页面里截取 `player_aaaa = {...}`（括号配对，不执行远端脚本） */
function readJsObject(html: string, marker: RegExp): Record<string, unknown> | null {
  const matched = marker.exec(html)
  if (!matched) return null
  const start = matched.index + matched[0].length - 1
  let depth = 0
  let quoted = false
  let escaped = false
  for (let i = start; i < html.length; i += 1) {
    const char = html[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{') depth += 1
    else if (char === '}' && (depth -= 1) === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1)) as Record<string, unknown>
      } catch {
        return null
      }
    }
  }
  return null
}

async function dj55Play(
  source: DramaSourceInput,
  seriesId: string,
  episodeId: string
): Promise<DramaPlayResponse> {
  const matched = /^(\d{1,4}):(\d{1,5})$/.exec(episodeId)
  if (!matched) return { ok: false, error: '五五短剧分集编号无效' }
  const html = await dj55Request(
    source,
    `/index.php/vod/play/id/${seriesId}/sid/${matched[1]}/nid/${matched[2]}.html`
  )
  let url = str(readJsObject(html, /player_aaaa\s*=\s*\{/)?.url)
  if (!url) {
    const fallback = /https?:\\?\/\\?\/[^"'\s\\]+\.m3u8[^"'\s\\]*/i.exec(html)
    url = fallback ? fallback[0].replace(/\\\//g, '/') : ''
  }
  if (!url) return { ok: false, error: '五五短剧没有返回播放地址' }
  if (url.startsWith('//')) url = `https:${url}`
  return { ok: true, url }
}

// ---------------- 肉视频（rou07，与爽看同源的短剧库） ----------------

function rou07EpisodeCount(duration: string): number {
  const matched = /^全\s*(\d+)\s*集$/.exec(duration)
  return matched ? num(matched[1]) : 0
}

async function rou07Catalog(
  source: DramaSourceInput,
  genre: string,
  page: number,
  keyword: string
): Promise<DramaCatalogResponse> {
  const res = keyword
    ? await shuangkanSeriesSearch(keyword, page, source.baseUrl)
    : await shuangkanCatalog('series', genre, page, source.baseUrl)
  if (!res.ok) throw new Error(res.error || '肉视频短剧加载失败')
  return {
    ok: true,
    items: res.items.map((item) => ({
      seriesId: item.id,
      title: item.title,
      cover: item.cover,
      episodeCount: rou07EpisodeCount(item.duration),
      tags: [],
      remarks: /^全\s*\d+\s*集$/.test(item.duration) ? '' : item.duration,
      sourceId: ROU07_DRAMA_SOURCE_ID,
      sourceName: source.name
    })),
    page: res.page,
    pageCount: res.lastPage,
    hasMore: res.page < res.lastPage,
    categories: res.categories.map((category) => ({
      slug: category.slug,
      label: category.label,
      count: category.count
    }))
  }
}

async function rou07Detail(
  source: DramaSourceInput,
  seriesId: string
): Promise<DramaDetailResponse> {
  const res = await shuangkanDetail('series', seriesId, source.baseUrl)
  if (!res.ok || !res.detail) return { ok: false, error: res.error ?? '肉视频没有返回该剧集' }
  if (!res.detail.episodes.length) return { ok: false, error: '这部剧还没有可播放的集数' }
  return {
    ok: true,
    detail: {
      seriesId,
      title: res.detail.title,
      cover: res.detail.cover,
      intro: res.detail.intro,
      tags: res.detail.tags,
      episodes: res.detail.episodes.map((episode) => ({
        id: episode.id,
        index: episode.index,
        name: episode.name,
        locked: false
      })),
      sourceId: ROU07_DRAMA_SOURCE_ID,
      sourceName: source.name
    }
  }
}

async function rou07Play(episodeId: string, baseUrl?: string): Promise<DramaPlayResponse> {
  const res = await shuangkanPlay(episodeId, baseUrl)
  if (!res.ok || !res.url) return { ok: false, error: res.error ?? '取播放地址失败' }
  return { ok: true, url: res.url }
}

// ---------------- 对外入口 ----------------

function sourceNameOf(source: DramaSourceInput): string {
  const fallback: Record<string, string> = {
    hongguo: '红果短剧',
    xifan: '西饭短剧',
    hema: '河马短剧',
    rou07: '肉视频短剧',
    duanju55: '免费五五短剧',
    custom: '自定义源'
  }
  return source.name.trim() || fallback[source.id] || (source.baseUrl ? hostOf(source.baseUrl) : '短剧源')
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function normalizeInput(source: DramaSourceInput): DramaSourceInput {
  return { ...source, name: sourceNameOf(source) }
}

export async function dramaCatalog(
  rawSource: DramaSourceInput,
  genre: string,
  page: number,
  keyword: string
): Promise<DramaCatalogResponse> {
  const source = normalizeInput(rawSource)
  const pg = Math.max(1, Math.floor(page) || 1)
  const kw = keyword.trim()
  try {
    if (source.id === 'hongguo') {
      return kw ? await hgSearch(source, kw, pg) : await hgCatalog(source, genre, pg)
    }
    if (source.id === 'xifan') {
      return kw ? await xifanSearch(source, kw, pg) : await xifanCatalog(source, genre, pg)
    }
    if (source.id === 'hema') {
      return kw ? await hemaSearch(source, kw, pg) : await hemaCatalog(source, genre, pg)
    }
    if (source.id === ROU07_DRAMA_SOURCE_ID) {
      return await rou07Catalog(source, genre, pg, kw)
    }
    if (isDuanju55Source(source)) {
      return await dj55Catalog(source, genre, pg, kw)
    }
    if (source.id === 'custom' || source.baseUrl) {
      return await customCatalog(source, genre, pg, kw)
    }
    return {
      ok: false,
      items: [],
      page: pg,
      pageCount: 0,
      hasMore: false,
      categories: [],
      error: '未知短剧源'
    }
  } catch (err) {
    return {
      ok: false,
      items: [],
      page: pg,
      pageCount: 0,
      hasMore: false,
      categories: [],
      error: (err as Error).message || '加载失败'
    }
  }
}

export async function dramaDetail(
  rawSource: DramaSourceInput,
  seriesId: string
): Promise<DramaDetailResponse> {
  const source = normalizeInput(rawSource)
  try {
    if (source.id === 'hongguo') return await hgDetail(source, seriesId)
    if (source.id === 'xifan') return await xifanDetail(source, seriesId)
    if (source.id === 'hema') return await hemaDetail(source, seriesId)
    if (source.id === ROU07_DRAMA_SOURCE_ID) return await rou07Detail(source, seriesId)
    if (isDuanju55Source(source)) return await dj55Detail(source, seriesId)
    if (source.id === 'custom' || source.baseUrl) return await customDetail(source, seriesId)
    return { ok: false, error: '未知短剧源' }
  } catch (err) {
    return { ok: false, error: (err as Error).message || '加载失败' }
  }
}

export async function dramaPlay(
  rawSource: DramaSourceInput,
  seriesId: string,
  episodeId: string
): Promise<DramaPlayResponse> {
  const source = normalizeInput(rawSource)
  try {
    if (source.id === 'hongguo') return await hgPlay(seriesId, episodeId)
    if (source.id === 'xifan') return await xifanPlay(source, seriesId, episodeId)
    if (source.id === 'hema') return await hemaPlay(seriesId, episodeId)
    if (source.id === ROU07_DRAMA_SOURCE_ID) return await rou07Play(episodeId, source.baseUrl)
    if (isDuanju55Source(source)) return await dj55Play(source, seriesId, episodeId)
    if (source.id === 'custom' || source.baseUrl) return await customPlay(source, seriesId, episodeId)
    return { ok: false, error: '未知短剧源' }
  } catch (err) {
    return { ok: false, error: (err as Error).message || '取播放地址失败' }
  }
}
