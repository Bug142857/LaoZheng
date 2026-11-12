import { parse } from 'node-html-parser'
import { session } from 'electron'
import {
  BIKAHUB_COMIC_CATEGORIES,
  BIKAHUB_COMIC_SOURCE_ID,
  BIKAHUB_DEFAULT_BASE,
  BIKAHUB_NOVEL_CATEGORIES,
  bikahubComicId,
  bikahubComicSlug,
  bikahubComicSourceId,
  type BikahubCategoryCountsResponse
} from '../src/shared/bikahub'
import type {
  NovelChapter,
  NovelChapterResponse,
  NovelDetail,
  NovelDetailResponse,
  NovelItem,
  NovelListResponse
} from '../src/shared/novel'
import type {
  YumanhuaChapter,
  YumanhuaChaptersResponse,
  YumanhuaComic,
  YumanhuaDetailResponse,
  YumanhuaImagesResponse,
  YumanhuaListResponse
} from '../src/shared/yumanhua'

/**
 * 哔咔（bikahub.net）小说 / 漫画客户端。
 *
 * 站点是 Nuxt SSR：页面里的 __NUXT_DATA__ 带完整列表 / 详情 / 章节 / 章节图数据，
 * 解析它比抠 DOM 稳定。站点会换域名，请求失败时读 /go-home 的防失联线路，
 * 逐条探活后自动切到可用镜像，并在 10 分钟内复用。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const TIMEOUT_MS = 25_000
const PROBE_TIMEOUT_MS = 12_000
const BASE_TTL = 10 * 60 * 1000
const PAGE_CACHE_TTL = 5 * 60 * 1000
const GOHOME_HOSTS = [
  'https://bikahub.net',
  'https://bikago.net',
  'https://mlaridyo.cc',
  'https://7ed43.dojqybrcm.com'
]

type Json = Record<string, unknown>

class BikahubNetworkError extends Error {}

const asObj = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
const asArr = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const str = (value: unknown): string => (typeof value === 'string' ? value : '')
/** 搜索 API 的 id 是数字，列表 payload 的 id 是字符串，统一转成字符串 */
const idText = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : ''
const num = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return '加载失败'
}

function originOf(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (!value) return ''
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).origin
  } catch {
    return ''
  }
}

/* ---------------- __NUXT_DATA__ 解析 ---------------- */

interface Boxed {
  __type: string
  v1?: unknown
}

function decodeNuxtData(html: string): Json | null {
  const anchor = html.indexOf('id="__NUXT_DATA__"')
  if (anchor < 0) return null
  const gt = html.indexOf('>', anchor)
  if (gt < 0) return null
  let rest = html.slice(gt + 1)
  const end = rest.indexOf('</script>')
  if (end >= 0) rest = rest.slice(0, end)
  let values: unknown
  try {
    values = JSON.parse(rest)
  } catch {
    return null
  }
  if (!Array.isArray(values)) return null

  const hydrated: unknown[] = []
  const hydrate = (index: number): unknown => {
    if (index === -1) return undefined
    if (index === -2) return null
    if (index === -3) return Number.NaN
    if (index === -4) return Infinity
    if (index === -5) return -Infinity
    if (index === -6) return -0
    if (!Number.isInteger(index) || index < 0 || index >= values.length) return undefined
    if (hydrated[index] !== undefined) return hydrated[index]
    const value = values[index]
    if (Array.isArray(value) && typeof value[0] === 'string') {
      const type = value[0]
      if (type === 'Date') return (hydrated[index] = new Date(str(value[1])))
      if (type === 'Set') {
        const set = new Set<unknown>()
        hydrated[index] = set
        for (let k = 1; k < value.length; k += 1) set.add(hydrate(Number(value[k])))
        return set
      }
      if (type === 'Map') {
        const map = new Map<unknown, unknown>()
        hydrated[index] = map
        for (let k = 1; k + 1 < value.length; k += 2) {
          map.set(hydrate(Number(value[k])), hydrate(Number(value[k + 1])))
        }
        return map
      }
      if (type === 'RegExp') return (hydrated[index] = new RegExp(str(value[1]), str(value[2])))
      if (type === 'BigInt') return (hydrated[index] = str(value[1]))
      const boxed: Boxed = { __type: type }
      hydrated[index] = boxed
      for (let k = 1; k < value.length; k += 1) {
        ;(boxed as unknown as Json)[`v${k}`] = hydrate(Number(value[k]))
      }
      return boxed
    }
    if (Array.isArray(value)) {
      const arr: unknown[] = []
      hydrated[index] = arr
      for (const item of value) arr.push(hydrate(Number(item)))
      return arr
    }
    if (asObj(value)) {
      const obj: Json = {}
      hydrated[index] = obj
      for (const [key, ref] of Object.entries(value as Record<string, unknown>)) {
        obj[key] = hydrate(Number(ref))
      }
      return obj
    }
    hydrated[index] = value
    return value
  }

  const deepUnwrap = (value: unknown, depth = 0): unknown => {
    if (depth > 24) return value
    if (Array.isArray(value)) return value.map((entry) => deepUnwrap(entry, depth + 1))
    const obj = asObj(value)
    if (!obj) return value
    if (typeof obj.__type === 'string') {
      if (obj.__type === 'EmptyRef') return undefined
      if ('v1' in obj) return deepUnwrap(obj.v1, depth + 1)
    }
    const out: Json = {}
    for (const [key, entry] of Object.entries(obj)) out[key] = deepUnwrap(entry, depth + 1)
    return out
  }

  let root = deepUnwrap(hydrate(0))
  // 根节点依次是 ShallowReactive → { data } → ShallowReactive
  for (let i = 0; i < 6; i += 1) {
    const obj = asObj(root)
    if (!obj) break
    if (asObj(obj.data)) {
      root = obj.data
      continue
    }
    break
  }
  const data = asObj(root)
  return data
}

function payloadEntry(data: Json, prefix: string): Json | null {
  const key = Object.keys(data).find((item) => item.startsWith(prefix))
  return key ? asObj(data[key]) : null
}

/* ---------------- 站点可用地址 ---------------- */

const baseCache = new Map<string, { base: string; at: number }>()
const resolving = new Map<string, Promise<string>>()
const pageCache = new Map<string, { data: Json; at: number }>()

async function fetchText(url: string, referer?: string, timeout = TIMEOUT_MS): Promise<string> {
  let res: Response
  try {
    res = await session.defaultSession.fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...(referer ? { Referer: referer } : {})
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout)
    })
  } catch {
    throw new BikahubNetworkError('连不上哔咔站点')
  }
  if (res.status >= 500 || res.status === 429) {
    throw new BikahubNetworkError(`哔咔站点返回 HTTP ${res.status}`)
  }
  if (res.status === 404) throw new Error('页面不存在（404）')
  if (!res.ok) throw new BikahubNetworkError(`哔咔站点返回 HTTP ${res.status}`)
  const text = await res.text()
  if (!text) throw new Error('站点返回了空页面')
  return text
}

async function probeSite(base: string): Promise<boolean> {
  try {
    const html = await fetchText(`${base}/go-home`, `${base}/`, PROBE_TIMEOUT_MS)
    return html.includes('id="__NUXT_DATA__"') || html.includes('回家的路')
  } catch {
    return false
  }
}

/** 从防失联页读「国内可用地址」与「永久访问地址」，按优先级返回域名 */
function extractRoutes(html: string): string[] {
  const root = parse(html)
  const routes: string[] = []
  const push = (raw: string) => {
    const value = raw.trim()
    if (!value) return
    const origin = originOf(value)
    if (origin && !routes.includes(origin)) routes.push(origin)
  }
  for (const node of root.querySelectorAll('p[title]')) push(node.getAttribute('title') ?? '')
  for (const node of root.querySelectorAll('strong')) {
    const value = node.text.trim()
    if (/^(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/.*)?$/i.test(value)) push(value)
  }
  return routes
}

async function discoverRoutes(preferred: string): Promise<string[]> {
  const hosts = [preferred, ...GOHOME_HOSTS].filter((host, index, list) => !!host && list.indexOf(host) === index)
  for (const host of hosts) {
    try {
      const html = await fetchText(`${host}/go-home`, `${host}/`, PROBE_TIMEOUT_MS)
      const routes = extractRoutes(html)
      if (routes.length) return routes
    } catch {
      // 这个发布页也打不开，换下一个固定域名
    }
  }
  return []
}

async function resolveBase(preferredRaw: string | undefined, force = false): Promise<string> {
  const preferred = originOf(preferredRaw) || BIKAHUB_DEFAULT_BASE
  const cached = baseCache.get(preferred)
  if (!force && cached && Date.now() - cached.at < BASE_TTL) return cached.base
  if (!force) {
    const running = resolving.get(preferred)
    if (running) return running
  }
  let task: Promise<string>
  task = (async () => {
    if (await probeSite(preferred)) {
      baseCache.set(preferred, { base: preferred, at: Date.now() })
      return preferred
    }
    const routes = await discoverRoutes(preferred)
    for (const base of routes) {
      if (base === preferred) continue
      if (await probeSite(base)) {
        baseCache.set(preferred, { base, at: Date.now() })
        return base
      }
    }
    throw new Error('哔咔站点无法访问，防失联页也没有可用线路')
  })().finally(() => {
    if (resolving.get(preferred) === task) resolving.delete(preferred)
  })
  resolving.set(preferred, task)
  return task
}

async function withSite<T>(preferred: string | undefined, run: (base: string) => Promise<T>): Promise<T> {
  const base = await resolveBase(preferred)
  try {
    return await run(base)
  } catch (err) {
    if (!(err instanceof BikahubNetworkError)) throw err
    const fresh = await resolveBase(preferred, true)
    return run(fresh)
  }
}

async function fetchData(url: string, base: string, cache = true): Promise<Json> {
  const cached = pageCache.get(url)
  if (cache && cached && Date.now() - cached.at < PAGE_CACHE_TTL) return cached.data
  const html = await fetchText(url, `${base}/`)
  const data = decodeNuxtData(html)
  if (!data) throw new BikahubNetworkError('站点返回了无法解析的页面')
  if (cache) pageCache.set(url, { data, at: Date.now() })
  return data
}

/* ---------------- 小说 ---------------- */

function tagNames(value: unknown): string[] {
  return asArr(value)
    .map((entry) => str(asObj(entry)?.name))
    .filter(Boolean)
}

/** API 的连载状态：1 = 已完结，2 = 连载中 */
function serialStatusText(value: unknown): string {
  const status = num(value)
  if (status === 1) return '已完结'
  if (status === 2) return '连载中'
  return ''
}

function novelItemOf(value: unknown): NovelItem | null {
  const item = asObj(value)
  if (!item) return null
  const bookId = idText(item.id)
  const title = str(item.title)
  if (!bookId || !title) return null
  const tags = tagNames(item.tags)
  return {
    bookId,
    title,
    author: str(item.author),
    cover: str(item.cover),
    category: str(item.categoryName) || str(item.category) || tags[0] || '',
    status: str(item.status) || serialStatusText(item.serialStatus),
    latestChapter: ''
  }
}

async function novelList(
  baseUrl: string | undefined,
  categoryId: string,
  page: number
): Promise<NovelListResponse> {
  try {
    const current = Math.max(1, Math.min(999, Number.isFinite(page) ? Math.floor(page) : 1))
    const path = `${categoryId ? `/novel/category/${categoryId}` : '/novel'}${
      current > 1 ? `/page/${current}` : ''
    }`
    const data = await withSite(baseUrl, (base) => fetchData(`${base}${path}`, base))
    const list = payloadEntry(data, 'novel-list-page')
    const items = asArr(list?.items)
      .map(novelItemOf)
      .filter((item): item is NovelItem => !!item)
    if (!items.length) throw new Error('站点没有返回可解析的书目')
    const total = num(list?.total)
    const totalPages = num(list?.totalPages)
    return { ok: true, items, hasMore: totalPages > current, total, totalPages }
  } catch (err) {
    return { ok: false, items: [], error: errorText(err) }
  }
}

export async function bikahubNovelHome(baseUrl?: string): Promise<NovelListResponse> {
  return novelList(baseUrl, '', 1)
}

export async function bikahubNovelCategory(
  baseUrl: string | undefined,
  categoryId: string,
  page: number
): Promise<NovelListResponse> {
  if (!/^[a-z0-9-]{1,30}$/i.test(categoryId)) {
    return { ok: false, items: [], error: '分类参数无效' }
  }
  return novelList(baseUrl, categoryId, page)
}

/** 搜索接口每页条数（站点前端用 48，这里放大到 100 减少请求次数） */
const SEARCH_PAGE_SIZE = 100
/** 搜索结果最多翻到第 6 页：站点本身约 100 条上限，第 6 页通常已为空 */
const SEARCH_MAX_PAGES = 6

/**
 * 走站点搜索 API 拉全量结果。
 * SSR 搜索页只渲染首批 15~16 条，API 分页还能继续取到后面的结果。
 */
async function searchApiItems(
  base: string,
  keyword: string,
  type: 'novel' | 'comic'
): Promise<unknown[]> {
  const rows: unknown[] = []
  const seen = new Set<string>()
  for (let page = 1; page <= SEARCH_MAX_PAGES; page += 1) {
    const url = `${base}/api/v1/search?keyword=${encodeURIComponent(keyword)}&type=${type}&page=${page}&pageSize=${SEARCH_PAGE_SIZE}`
    const text = await fetchText(url, `${base}/`)
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('搜索接口返回了非 JSON 内容')
    }
    const root = asObj(parsed)
    if (num(root?.code) !== 0) throw new Error(str(root?.message) || '搜索接口返回错误')
    const data = asObj(root?.data)
    const bucket = asObj(data?.[type === 'novel' ? 'novels' : 'comics'])
    const items = asArr(bucket?.items)
    if (!items.length) break
    for (const item of items) {
      const id = idText(asObj(item)?.id)
      if (!id || seen.has(id)) continue
      seen.add(id)
      rows.push(item)
    }
  }
  return rows
}

export async function bikahubNovelSearch(
  baseUrl: string | undefined,
  keyword: string
): Promise<NovelListResponse> {
  const query = keyword.trim()
  if (!query) return { ok: true, items: [] }
  try {
    const items = await withSite(baseUrl, async (base) => {
      const rows = await searchApiItems(base, query, 'novel')
      return rows.map(novelItemOf).filter((item): item is NovelItem => !!item)
    })
    return { ok: true, items }
  } catch (err) {
    return { ok: false, items: [], error: errorText(err) }
  }
}

function novelDetailOf(bookId: string, item: Json): NovelDetail {
  const chapters: NovelChapter[] = []
  asArr(item.chapters).forEach((entry, index) => {
    const chapter = asObj(entry)
    if (!chapter) return
    const order = num(chapter.order) || index + 1
    const label = str(chapter.label) || `第${order}章`
    // 少数章节的 badge 自带「第183章」前缀，去掉后再和 label 拼，避免出现两个章号
    const badge = str(chapter.badge)
      .replace(/^第\s*\d+(?:\.\d+)?\s*[章节话回]\s*/u, '')
      .trim()
    chapters.push({
      id: String(order),
      name: badge ? `${label} ${badge}` : label,
      index: order
    })
  })
  return {
    bookId,
    title: str(item.title) || `书籍 ${bookId}`,
    author: str(item.author),
    cover: str(item.cover),
    intro: str(item.synopsis),
    category: str(item.category),
    status: str(item.status),
    latestChapter: str(item.latestChapter),
    chapters
  }
}

export async function bikahubNovelDetail(
  baseUrl: string | undefined,
  bookId: string
): Promise<NovelDetailResponse> {
  if (!/^\d{1,20}$/.test(bookId)) return { ok: false, error: '书籍编号无效' }
  try {
    const data = await withSite(baseUrl, (base) => fetchData(`${base}/novel/${bookId}`, base))
    const entry =
      payloadEntry(data, `novel-detail-${bookId}`) ?? payloadEntry(data, 'novel-detail')
    const item = asObj(entry?.item)
    if (!item) throw new Error('详情解析失败')
    return { ok: true, detail: novelDetailOf(bookId, item) }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

export async function bikahubNovelChapter(
  baseUrl: string | undefined,
  bookId: string,
  chapterId: string
): Promise<NovelChapterResponse> {
  if (!/^\d{1,20}$/.test(bookId) || !/^\d{1,20}$/.test(chapterId)) {
    return { ok: false, error: '章节编号无效' }
  }
  try {
    const html = await withSite(baseUrl, (base) =>
      fetchText(`${base}/novel/read/${bookId}/${chapterId}`, `${base}/novel/${bookId}`)
    )
    const root = parse(html)
    const paragraphs = root
      .querySelectorAll('.novel-reader-pc-copy p')
      .map((node) => node.text.trim())
      .filter(Boolean)
    let content = paragraphs.join('\n')
    if (!content) {
      const data = decodeNuxtData(html)
      const entry = data
        ? (payloadEntry(data, `novel-reader-${bookId}-${chapterId}`) ?? payloadEntry(data, 'novel-reader'))
        : null
      const detail = asObj(entry?.detail)
      const fallback = asArr(detail?.content)
        .map((line) => str(line).trim())
        .filter(Boolean)
      if (fallback.length) content = fallback.join('\n')
    }
    if (!content) return { ok: false, error: '站点没有返回章节正文' }
    return { ok: true, chapter: { id: chapterId, content } }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

/* ---------------- 漫画 ---------------- */

function comicOf(value: unknown, sourceId: string): YumanhuaComic | null {
  const item = asObj(value)
  if (!item) return null
  const id = idText(item.id)
  const title = str(item.title)
  if (!id || !title) return null
  return {
    id: bikahubComicId(id, sourceId),
    title,
    cover: str(item.cover),
    author: str(item.author),
    tags: tagNames(item.tags),
    status: str(item.status) || serialStatusText(item.serialStatus),
    latest: str(item.latestChapter),
    intro: str(item.synopsis)
  }
}

async function comicList(
  baseUrl: string | undefined,
  categoryId: string,
  page: number,
  sourceId: string
): Promise<YumanhuaListResponse> {
  try {
    const current = Math.max(1, Math.min(999, Number.isFinite(page) ? Math.floor(page) : 1))
    const path = `${categoryId ? `/comic/category/${categoryId}` : '/comic'}${
      current > 1 ? `/page/${current}` : ''
    }`
    const data = await withSite(baseUrl, (base) => fetchData(`${base}${path}`, base))
    const list = payloadEntry(data, 'comic-list')
    const items = asArr(list?.items)
      .map((entry) => comicOf(entry, sourceId))
      .filter((item): item is YumanhuaComic => !!item)
    if (!items.length) throw new Error('站点没有返回可解析的漫画')
    const totalPages = num(list?.totalPages)
    return {
      ok: true,
      items,
      hasMore: totalPages > current,
      totalPages: totalPages || undefined
    }
  } catch (err) {
    return { ok: false, items: [], error: errorText(err) }
  }
}

export async function bikahubComicRecent(
  baseUrl?: string,
  sourceId = BIKAHUB_COMIC_SOURCE_ID,
  page = 1
): Promise<YumanhuaListResponse> {
  return comicList(baseUrl, '', page, sourceId)
}

export async function bikahubComicHot(
  baseUrl?: string,
  sourceId = BIKAHUB_COMIC_SOURCE_ID,
  page = 1
): Promise<YumanhuaListResponse> {
  return comicList(baseUrl, '', page, sourceId)
}

export async function bikahubComicCategory(
  categoryId: string,
  baseUrl?: string,
  sourceId = BIKAHUB_COMIC_SOURCE_ID,
  page = 1
): Promise<YumanhuaListResponse> {
  if (!/^[a-z0-9-]{1,30}$/i.test(categoryId)) {
    return { ok: false, items: [], error: '分类参数无效' }
  }
  return comicList(baseUrl, categoryId, page, sourceId)
}

export async function bikahubComicSearch(
  keyword: string,
  baseUrl?: string,
  sourceId = BIKAHUB_COMIC_SOURCE_ID
): Promise<YumanhuaListResponse> {
  const query = keyword.trim()
  if (!query) return { ok: true, items: [], hasMore: false }
  try {
    const items = await withSite(baseUrl, async (base) => {
      const rows = await searchApiItems(base, query, 'comic')
      return rows
        .map((entry) => comicOf(entry, sourceId))
        .filter((item): item is YumanhuaComic => !!item)
    })
    return { ok: true, items, hasMore: false }
  } catch (err) {
    return { ok: false, items: [], error: errorText(err) }
  }
}

async function comicDetailEntry(
  id: string,
  baseUrl?: string
): Promise<{ detail: Json; base: string } | null> {
  const slug = bikahubComicSlug(id)
  if (!/^\d{1,20}$/.test(slug)) return null
  const result = await withSite(baseUrl, async (base) => {
    const data = await fetchData(`${base}/comic/${slug}`, base)
    const entry =
      payloadEntry(data, `comic-detail-${slug}`) ?? payloadEntry(data, 'comic-detail')
    const detail = asObj(entry?.detail)
    return detail ? { detail, base } : null
  })
  return result
}

export async function bikahubComicDetail(
  id: string,
  baseUrl?: string
): Promise<YumanhuaDetailResponse> {
  try {
    const entry = await comicDetailEntry(id, baseUrl)
    if (!entry) return { ok: false, comic: null, error: '漫画编号无效或详情解析失败' }
    const slug = bikahubComicSlug(id)
    const sourceId = bikahubComicSourceId(id) || BIKAHUB_COMIC_SOURCE_ID
    const item = {
      ...entry.detail,
      id: slug,
      latest: entry.detail.latestChapter
    }
    const comic = comicOf(item, sourceId)
    if (!comic) return { ok: false, comic: null, error: '详情解析失败' }
    return { ok: true, comic }
  } catch (err) {
    return { ok: false, comic: null, error: errorText(err) }
  }
}

export async function bikahubComicChapters(
  id: string,
  baseUrl?: string
): Promise<YumanhuaChaptersResponse> {
  try {
    const entry = await comicDetailEntry(id, baseUrl)
    if (!entry) return { ok: false, items: [], error: '漫画编号无效或章节解析失败' }
    const items: YumanhuaChapter[] = []
    asArr(entry.detail.chapters).forEach((chapter, index) => {
      const row = asObj(chapter)
      if (!row) return
      const order = str(row.routeParam) || String(num(row.id)) || String(index + 1)
      items.push({
        id: order,
        name: str(row.label) || `第${index + 1}话`,
        index: index + 1,
        size: 0
      })
    })
    if (!items.length) return { ok: false, items: [], error: '站点没有返回章节' }
    return { ok: true, items }
  } catch (err) {
    return { ok: false, items: [], error: errorText(err) }
  }
}

export async function bikahubComicImages(
  comicId: string,
  chapterId: string,
  baseUrl?: string
): Promise<YumanhuaImagesResponse> {
  const slug = bikahubComicSlug(comicId)
  if (!/^\d{1,20}$/.test(slug) || !/^\d{1,20}$/.test(chapterId)) {
    return { ok: false, urls: [], error: '章节参数无效' }
  }
  try {
    const data = await withSite(baseUrl, (base) =>
      fetchData(`${base}/reader/${slug}/${chapterId}`, base)
    )
    const entry =
      payloadEntry(data, `comic-reader-${slug}-${chapterId}`) ?? payloadEntry(data, 'comic-reader')
    const detail = asObj(entry?.detail)
    const urls = asArr(detail?.pages)
      .map((page) => str(asObj(page)?.src).trim())
      .filter((url) => /^https?:\/\//i.test(url))
    if (!urls.length) return { ok: false, urls: [], error: '本章没有解析到图片' }
    return { ok: true, urls }
  } catch (err) {
    return { ok: false, urls: [], error: errorText(err) }
  }
}

/* ---------------- 分类数量 ---------------- */

const countsCache = new Map<string, { counts: Record<string, number>; at: number }>()
const COUNTS_TTL = 10 * 60 * 1000

async function fetchCategoryCounts(
  baseUrl: string | undefined,
  kind: 'novel' | 'comic',
  categories: readonly { id: string }[]
): Promise<BikahubCategoryCountsResponse> {
  const cacheKey = `${kind}|${originOf(baseUrl) || BIKAHUB_DEFAULT_BASE}`
  const cached = countsCache.get(cacheKey)
  if (cached && Date.now() - cached.at < COUNTS_TTL) {
    return { ok: true, counts: cached.counts }
  }
  try {
    const counts = await withSite(baseUrl, async (base) => {
      const out: Record<string, number> = {}
      const queue = [...categories]
      const worker = async (): Promise<void> => {
        for (;;) {
          const category = queue.shift()
          if (!category) return
          try {
            const path =
              kind === 'novel'
                ? `/novel/category/${category.id}`
                : `/comic/category/${category.id}`
            const data = await fetchData(`${base}${path}`, base)
            const list = payloadEntry(
              data,
              kind === 'novel' ? 'novel-list-page' : 'comic-list'
            )
            out[category.id] = num(list?.total)
          } catch (err) {
            // 网络级失败交给 withSite 换镜像重试；单个分类解析失败只标记 -1
            if (err instanceof BikahubNetworkError) throw err
            out[category.id] = -1
          }
        }
      }
      await Promise.all(Array.from({ length: 4 }, worker))
      return out
    })
    countsCache.set(cacheKey, { counts, at: Date.now() })
    return { ok: true, counts }
  } catch (err) {
    return { ok: false, counts: {}, error: errorText(err) }
  }
}

export async function bikahubNovelCategoryCounts(
  baseUrl?: string
): Promise<BikahubCategoryCountsResponse> {
  return fetchCategoryCounts(baseUrl, 'novel', BIKAHUB_NOVEL_CATEGORIES)
}

export async function bikahubComicCategoryCounts(
  baseUrl?: string
): Promise<BikahubCategoryCountsResponse> {
  return fetchCategoryCounts(baseUrl, 'comic', BIKAHUB_COMIC_CATEGORIES)
}
