import { parse } from 'node-html-parser'
import { session } from 'electron'
import {
  TPTOON_CATEGORIES,
  TPTOON_DEFAULT_BASE,
  TPTOON_GOHOME_URL,
  TPTOON_PAGE_SIZE,
  TPTOON_SOURCE_ID,
  tptoonComicId,
  tptoonComicSlug,
  tptoonComicSourceId,
  type TptoonCategoryCountsResponse
} from '../src/shared/tptoon'
import type {
  YumanhuaChapter,
  YumanhuaChaptersResponse,
  YumanhuaComic,
  YumanhuaDetailResponse,
  YumanhuaImagesResponse,
  YumanhuaListResponse
} from '../src/shared/yumanhua'

/**
 * 头牌漫画（tptoon.net）客户端。
 *
 * 站点是静态 HTML（头牌 hm8 模板）：分类 / 更新 / 排行都是 /<slug>/index_N.html，
 * 详情页 /book/<id>.html 带完整目录，章节图在 /chapter/<id>.html 的 data-original，
 * 一章可能拆成多页（_1、_2 …）。搜索是 EmpireCMS 的 POST /e/search/index.php，
 * 成功后会跳到 /so/<id>.html。
 *
 * 站点经常换域名：请求失败时读取 tpmh8.cc 地址发布页，逐条探活后自动切到可用线路，
 * 结果缓存 10 分钟；图片在独立图床，不受换址影响。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const TIMEOUT_MS = 25_000
const PROBE_TIMEOUT_MS = 10_000
const BASE_TTL = 10 * 60 * 1000
const BOOK_CACHE_TTL = 5 * 60 * 1000
const IMAGE_CACHE_TTL = 10 * 60 * 1000
/** 搜索一次最多翻这么多页（每页 20 条），避免宽泛关键词拉太久 */
const SEARCH_MAX_PAGES = 10
/** 一章最多拼这么多分段页 */
const CHAPTER_MAX_PAGES = 80

class TptoonNetworkError extends Error {}

const baseCache = new Map<string, { base: string; at: number }>()
const resolving = new Map<string, Promise<string>>()
const bookCache = new Map<string, { html: string; base: string; at: number }>()
const imageCache = new Map<string, { urls: string[]; at: number }>()

function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return '加载失败'
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
}

function text(value: string | undefined | null): string {
  return decodeEntities(String(value ?? '').replace(/<[^>]+>/g, '')).trim()
}

function attr(
  node: { getAttribute: (name: string) => string | undefined } | null | undefined,
  name: string
): string {
  return node?.getAttribute(name)?.trim() ?? ''
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

/* ---------------- 站点可用地址 ---------------- */

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
    throw new TptoonNetworkError('连不上头牌漫画站点')
  }
  if (res.status >= 500 || res.status === 429) {
    throw new TptoonNetworkError(`头牌漫画站点返回 HTTP ${res.status}`)
  }
  if (res.status === 404) throw new Error('页面不存在（404）')
  if (!res.ok) throw new TptoonNetworkError(`头牌漫画站点返回 HTTP ${res.status}`)
  const body = await res.text()
  if (!body) throw new Error('站点返回了空页面')
  return body
}

async function probeSite(base: string): Promise<boolean> {
  try {
    // 用更新列表探活：既验证是头牌同款站点，也验证 /update/ 这类真实页面没被换模板
    const html = await fetchText(`${base}/update/`, `${base}/`, PROBE_TIMEOUT_MS)
    const signed = /头牌漫画|头牌漫畫/.test(html) || html.includes('/template/hm8/')
    return signed && /mipui-xs-item-list/.test(html)
  } catch {
    return false
  }
}

/** 从 tpmh8.cc 地址发布页里挑出可能是头牌镜像的域名 */
function mirrorCandidates(html: string): string[] {
  const root = parse(html)
  const out: string[] = []
  for (const node of root.querySelectorAll('a[href]')) {
    const origin = originOf(attr(node, 'href'))
    if (!origin) continue
    const host = origin.replace(/^https?:\/\//, '').toLowerCase()
    if (!/tptoon|tpmh|toupai|toonmh|mttoon|rrtoon|mhqun|bbmh|dybqg|qqmh/.test(host)) continue
    if (!out.includes(origin)) out.push(origin)
  }
  return out
}

async function discoverRoutes(): Promise<string[]> {
  try {
    const html = await fetchText(TPTOON_GOHOME_URL, TPTOON_GOHOME_URL, PROBE_TIMEOUT_MS)
    return mirrorCandidates(html)
  } catch {
    return []
  }
}

/** 发布页里的线路按页面顺序并发探活，取第一个能打开头牌漫画的 */
async function pickMirror(routes: string[], skip: string): Promise<string | null> {
  const candidates = routes.filter((route) => route !== skip).slice(0, 12)
  if (!candidates.length) return null
  const results = await Promise.all(
    candidates.map(async (route) => ({ route, ok: await probeSite(route) }))
  )
  return results.find((item) => item.ok)?.route ?? null
}

async function resolveBase(preferredRaw: string | undefined, force = false): Promise<string> {
  const preferred = originOf(preferredRaw) || TPTOON_DEFAULT_BASE
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
    const mirror = await pickMirror(await discoverRoutes(), preferred)
    if (mirror) {
      baseCache.set(preferred, { base: mirror, at: Date.now() })
      return mirror
    }
    throw new Error('头牌漫画站点无法访问，防失联页也没有可用线路')
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
    if (!(err instanceof TptoonNetworkError)) throw err
    const fresh = await resolveBase(preferred, true)
    return run(fresh)
  }
}

/* ---------------- 列表 ---------------- */

function comicOf(row: ReturnType<typeof parse>, sourceId: string, base: string): YumanhuaComic | null {
  const link =
    row.querySelector('a.item-link') ??
    row.querySelector('h4.list-title a') ??
    row.querySelector('a')
  const href = attr(link, 'href')
  const matched = /\/book\/(\d+)\.html/.exec(href)
  if (!matched) return null
  const title = text(attr(link, 'title')) || text(row.querySelector('h4.list-title')?.text)
  if (!title) return null
  const media = row.querySelector('.item-media img') ?? row.querySelector('.item-media mip-img')
  const cover = absoluteUrl(attr(media, 'data-original') || attr(media, 'src'), base)
  const description = row.querySelector('p.description')
  const latest = text(description?.querySelector('a')?.text)
  const spans = row.querySelectorAll('p.info span')
  const author = spans.length ? text(spans[0].text) : ''
  const statusLine = spans.length ? text(spans[spans.length - 1].text) : ''
  const status = /完结/.test(statusLine) ? '已完结' : /连载/.test(statusLine) ? '连载中' : ''
  return {
    id: tptoonComicId(matched[1], sourceId),
    title,
    cover,
    author,
    tags: [],
    status,
    latest,
    intro: ''
  }
}

function absoluteUrl(raw: string, base: string): string {
  const value = raw.trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  try {
    return new URL(value, base).href
  } catch {
    return ''
  }
}

function parseList(html: string, sourceId: string, base: string): YumanhuaComic[] {
  const root = parse(html)
  const items: YumanhuaComic[] = []
  const seen = new Set<string>()
  for (const row of root.querySelectorAll('.mipui-xs-item-list')) {
    const item = comicOf(row, sourceId, base)
    if (!item) continue
    const slug = tptoonComicSlug(item.id)
    if (seen.has(slug)) continue
    seen.add(slug)
    items.push(item)
  }
  return items
}

function listPath(categoryId: string, page: number): string {
  const slug = categoryId || 'update'
  return page <= 1 ? `/${slug}/` : `/${slug}/index_${page}.html`
}

async function comicList(
  baseUrl: string | undefined,
  mode: 'recent' | 'hot' | 'category',
  categoryId: string,
  page: number,
  sourceId: string
): Promise<YumanhuaListResponse> {
  try {
    const current = Math.max(1, Math.min(9999, Number.isFinite(page) ? Math.floor(page) : 1))
    const path = listPath(mode === 'hot' ? 'ranking' : categoryId, current)
    const { html, base } = await withSite(baseUrl, async (base) => ({
      html: await fetchText(`${base}${path}`, `${base}/`),
      base
    }))
    const items = parseList(html, sourceId, base)
    if (!items.length) throw new Error('站点没有返回可解析的漫画')
    return { ok: true, items, hasMore: items.length >= TPTOON_PAGE_SIZE }
  } catch (err) {
    return { ok: false, items: [], error: errorText(err) }
  }
}

export async function tptoonComicRecent(
  baseUrl?: string,
  sourceId = TPTOON_SOURCE_ID,
  page = 1
): Promise<YumanhuaListResponse> {
  return comicList(baseUrl, 'recent', '', page, sourceId)
}

export async function tptoonComicHot(
  baseUrl?: string,
  sourceId = TPTOON_SOURCE_ID,
  page = 1
): Promise<YumanhuaListResponse> {
  return comicList(baseUrl, 'hot', '', page, sourceId)
}

export async function tptoonComicCategory(
  categoryId: string,
  baseUrl?: string,
  sourceId = TPTOON_SOURCE_ID,
  page = 1
): Promise<YumanhuaListResponse> {
  if (!/^[a-z0-9-]{1,30}$/i.test(categoryId)) {
    return { ok: false, items: [], error: '分类参数无效' }
  }
  if (!TPTOON_CATEGORIES.some((item) => item.id === categoryId)) {
    return { ok: false, items: [], error: '分类不存在' }
  }
  return comicList(baseUrl, 'category', categoryId, page, sourceId)
}

/* ---------------- 搜索 ---------------- */

function lastSearchPage(root: ReturnType<typeof parse>, searchId: string): number {
  const pagination = root.querySelector('.pagination')
  if (!pagination) return 1
  let max = 1
  const pattern = new RegExp(`/so/${searchId}_(\\d+)\\.html`)
  for (const anchor of pagination.querySelectorAll('a')) {
    const matched = pattern.exec(attr(anchor, 'href'))
    if (matched) max = Math.max(max, Number(matched[1]) + 1)
    const label = text(anchor.text)
    if (/^\d{1,5}$/.test(label)) max = Math.max(max, Number(label))
  }
  return max
}

export async function tptoonComicSearch(
  keyword: string,
  baseUrl?: string,
  sourceId = TPTOON_SOURCE_ID
): Promise<YumanhuaListResponse> {
  const query = keyword.trim()
  if (!query) return { ok: true, items: [], hasMore: false }
  try {
    const items = await withSite(baseUrl, async (base) => {
      let res: Response
      try {
        res = await session.defaultSession.fetch(`${base}/e/search/index.php`, {
          method: 'POST',
          headers: {
            'User-Agent': UA,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            Referer: `${base}/`
          },
          body: `show=title&keyboard=${encodeURIComponent(query)}`,
          redirect: 'follow',
          signal: AbortSignal.timeout(TIMEOUT_MS)
        })
      } catch {
        throw new TptoonNetworkError('连不上头牌漫画站点')
      }
      if (res.status >= 500 || res.status === 429) {
        throw new TptoonNetworkError(`头牌漫画站点返回 HTTP ${res.status}`)
      }
      if (!res.ok) throw new TptoonNetworkError(`头牌漫画站点返回 HTTP ${res.status}`)
      const firstHtml = await res.text()
      // Electron 的 session.fetch 跟随后 res.url 为空，只能从分页链接里认搜索页编号
      const rows: YumanhuaComic[] = parseList(firstHtml, sourceId, base)
      if (!rows.length) return []
      const searchId = /\/so\/(\d+)(?:_\d+)?\.html/.exec(firstHtml)?.[1] ?? ''
      const lastPage = searchId
        ? Math.min(lastSearchPage(parse(firstHtml), searchId), SEARCH_MAX_PAGES)
        : 1
      if (searchId && lastPage > 1) {
        const pages = Array.from({ length: lastPage - 1 }, (_v, index) => index + 2)
        const results: YumanhuaComic[][] = []
        const queue = [...pages]
        const worker = async (): Promise<void> => {
          for (;;) {
            const page = queue.shift()
            if (!page) return
            try {
              const html = await fetchText(
                `${base}/so/${searchId}_${page - 1}.html`,
                `${base}/`
              )
              results.push(parseList(html, sourceId, base))
            } catch (err) {
              if (err instanceof TptoonNetworkError) throw err
              // 单页失败不影响已拿到的结果
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(3, pages.length) }, worker))
        for (const batch of results) rows.push(...batch)
      }
      const seen = new Set<string>()
      return rows.filter((item) => {
        const slug = tptoonComicSlug(item.id)
        if (seen.has(slug)) return false
        seen.add(slug)
        return true
      })
    })
    return { ok: true, items, hasMore: false }
  } catch (err) {
    return { ok: false, items: [], error: errorText(err) }
  }
}

/* ---------------- 详情 / 章节 ---------------- */

async function fetchBookHtml(
  slug: string,
  baseUrl?: string
): Promise<{ html: string; base: string }> {
  const key = `${originOf(baseUrl) || TPTOON_DEFAULT_BASE}|${slug}`
  const cached = bookCache.get(key)
  if (cached && Date.now() - cached.at < BOOK_CACHE_TTL) return cached
  const result = await withSite(baseUrl, async (base) => ({
    html: await fetchText(`${base}/book/${slug}.html`, `${base}/`),
    base
  }))
  bookCache.set(key, { ...result, at: Date.now() })
  return result
}

interface BookInfo {
  title: string
  cover: string
  author: string
  category: string
  latest: string
  status: string
  intro: string
  chapters: { id: string; name: string }[]
}

function parseBook(html: string, slug: string, base: string): BookInfo {
  const root = parse(html)
  const info = root.querySelector('.book-top')
  const title = text(info?.querySelector('h1')?.text) || `漫画 ${slug}`
  const coverNode = info?.querySelector('.left img') ?? info?.querySelector('.left mip-img')
  const cover = absoluteUrl(attr(coverNode, 'src') || attr(coverNode, 'data-original'), base)
  const right = info?.querySelector('.right')
  const firstP = right?.querySelector('p')
  const links = firstP?.querySelectorAll('a') ?? []
  const category = text(links[0]?.text)
  const latest = text(links[1]?.text)
  const infoLines = (right?.querySelectorAll('div') ?? []).map((node) => text(node.text))
  const author =
    infoLines.find((line) => line.startsWith('作者'))?.replace(/^作者[:：]\s*/, '') ?? ''
  const intro = text(right?.querySelector('p.hidden-xs')?.text)
  const chapters: { id: string; name: string }[] = []
  const seen = new Set<string>()
  const lists = root.querySelectorAll('.bookAll-item-list')
  const chapterList = lists[lists.length - 1]
  if (chapterList) {
    for (const anchor of chapterList.querySelectorAll('li a')) {
      const href = attr(anchor, 'href')
      const matched = /\/c?chapter\/(\d+)\.html/.exec(href)
      if (!matched || seen.has(matched[1])) continue
      const name = text(anchor.text) || attr(anchor, 'title')
      if (!name) continue
      seen.add(matched[1])
      // cchapter 与 chapter 是两套阅读页，用 c 前缀记住，取图时才知道走哪个路径
      const id = href.includes('/cchapter/') ? `c${matched[1]}` : matched[1]
      chapters.push({ id, name })
    }
  }
  // 目录偶尔是倒序，统一按话数升序存放
  if (chapters.length > 1) {
    const first = Number(chapters[0].id.replace(/^c/, ''))
    const last = Number(chapters[chapters.length - 1].id.replace(/^c/, ''))
    if (Number.isFinite(first) && Number.isFinite(last) && first > last) chapters.reverse()
  }
  return { title, cover, author, category, latest, status: '', intro, chapters }
}

export async function tptoonComicDetail(
  id: string,
  baseUrl?: string
): Promise<YumanhuaDetailResponse> {
  const slug = tptoonComicSlug(id)
  if (!/^\d{1,20}$/.test(slug)) return { ok: false, comic: null, error: '漫画编号无效' }
  try {
    const book = await fetchBookHtml(slug, baseUrl)
    const parsed = parseBook(book.html, slug, book.base)
    return {
      ok: true,
      comic: {
        id: tptoonComicId(slug, tptoonComicSourceId(id) || TPTOON_SOURCE_ID),
        title: parsed.title,
        cover: parsed.cover,
        author: parsed.author,
        tags: parsed.category ? [parsed.category] : [],
        status: parsed.status,
        latest: parsed.latest,
        intro: parsed.intro
      }
    }
  } catch (err) {
    return { ok: false, comic: null, error: errorText(err) }
  }
}

export async function tptoonComicChapters(
  id: string,
  baseUrl?: string
): Promise<YumanhuaChaptersResponse> {
  const slug = tptoonComicSlug(id)
  if (!/^\d{1,20}$/.test(slug)) return { ok: false, items: [], error: '漫画编号无效' }
  try {
    const book = await fetchBookHtml(slug, baseUrl)
    const parsed = parseBook(book.html, slug, book.base)
    if (!parsed.chapters.length) return { ok: false, items: [], error: '站点没有返回章节' }
    const items: YumanhuaChapter[] = parsed.chapters.map((chapter, index) => ({
      id: chapter.id,
      name: chapter.name,
      index: index + 1,
      size: 0
    }))
    return { ok: true, items }
  } catch (err) {
    return { ok: false, items: [], error: errorText(err) }
  }
}

export async function tptoonComicImages(
  comicId: string,
  chapterId: string,
  baseUrl?: string
): Promise<YumanhuaImagesResponse> {
  const slug = tptoonComicSlug(comicId)
  if (!/^\d{1,20}$/.test(slug) || !/^c?\d{1,20}$/.test(chapterId)) {
    return { ok: false, urls: [], error: '章节参数无效' }
  }
  const folder = chapterId.startsWith('c') ? 'cchapter' : 'chapter'
  const chapterSlug = chapterId.replace(/^c/, '')
  const key = `${originOf(baseUrl) || TPTOON_DEFAULT_BASE}|${chapterId}`
  const cached = imageCache.get(key)
  if (cached && Date.now() - cached.at < IMAGE_CACHE_TTL) {
    return { ok: true, urls: cached.urls }
  }
  try {
    const urls = await withSite(baseUrl, async (base) => {
      const collected: string[] = []
      const seen = new Set<string>()
      const pages = new Set<number>()
      let nextPage = 0
      for (let step = 0; step < CHAPTER_MAX_PAGES; step += 1) {
        const path =
          nextPage <= 0
            ? `/${folder}/${chapterSlug}.html`
            : `/${folder}/${chapterSlug}_${nextPage}.html`
        if (pages.has(nextPage)) break
        pages.add(nextPage)
        const html = await fetchText(`${base}${path}`, `${base}/${folder}/${chapterSlug}.html`)
        const root = parse(html)
        const comicNodes = root.querySelectorAll('img.comic_img')
        const imageNodes = comicNodes.length ? comicNodes : root.querySelectorAll('[data-original]')
        for (const img of imageNodes) {
          const raw = attr(img, 'data-original') || attr(img, 'src')
          if (!raw || /load\.gif|loaderr/i.test(raw)) continue
          let absolute = ''
          try {
            absolute = new URL(raw, base).href
          } catch {
            continue
          }
          if (!/^https?:\/\//i.test(absolute) || seen.has(absolute)) continue
          seen.add(absolute)
          collected.push(absolute)
        }
        const next = root
          .querySelectorAll('a')
          .find(
            (node) =>
              text(node.text) === '下一页' &&
              new RegExp(`/${folder}/${chapterSlug}_\\d+\\.html`).test(attr(node, 'href'))
          )
        const matched = next
          ? new RegExp(`/${folder}/${chapterSlug}_(\\d+)\\.html`).exec(attr(next, 'href'))
          : null
        if (!matched) break
        nextPage = Number(matched[1])
      }
      return collected
    })
    if (!urls.length) return { ok: false, urls: [], error: '本章没有解析到图片' }
    imageCache.set(key, { urls, at: Date.now() })
    return { ok: true, urls }
  } catch (err) {
    return { ok: false, urls: [], error: errorText(err) }
  }
}

/* ---------------- 分类数量 ---------------- */

const countsCache = new Map<string, { counts: Record<string, number>; at: number }>()
const COUNTS_TTL = 24 * 60 * 60 * 1000
/** 分类最多翻到这么多页，防止站点异常时无限探测 */
const COUNTS_MAX_PAGE = 4096

/** 取分类某一页的条目数；页面不存在返回 null，网络级失败抛给 withSite 换镜像 */
async function categoryPageItems(
  baseUrl: string | undefined,
  categoryId: string,
  page: number
): Promise<number | null> {
  try {
    const { html, base } = await withSite(baseUrl, async (base) => ({
      html: await fetchText(`${base}${listPath(categoryId, page)}`, `${base}/`),
      base
    }))
    return parseList(html, TPTOON_SOURCE_ID, base).length
  } catch (err) {
    if (err instanceof TptoonNetworkError) throw err
    return null
  }
}

/** 站点不显示分类总数：二分探到最后一页，再按 30 条/页折算 */
async function categoryCount(baseUrl: string | undefined, categoryId: string): Promise<number> {
  const first = await categoryPageItems(baseUrl, categoryId, 1)
  if (first === null) return -1
  if (first === 0) return 0
  let low = 1
  let lowItems = first
  let high = 2
  while (high <= COUNTS_MAX_PAGE) {
    const items = await categoryPageItems(baseUrl, categoryId, high)
    if (items === null || items === 0) break
    low = high
    lowItems = items
    high *= 2
  }
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2)
    const items = await categoryPageItems(baseUrl, categoryId, mid)
    if (items !== null && items > 0) {
      low = mid
      lowItems = items
    } else {
      high = mid
    }
  }
  return (low - 1) * TPTOON_PAGE_SIZE + lowItems
}

export async function tptoonComicCategoryCounts(
  baseUrl?: string
): Promise<TptoonCategoryCountsResponse> {
  const cacheKey = originOf(baseUrl) || TPTOON_DEFAULT_BASE
  const cached = countsCache.get(cacheKey)
  if (cached && Date.now() - cached.at < COUNTS_TTL) {
    return { ok: true, counts: cached.counts }
  }
  try {
    const counts: Record<string, number> = {}
    const queue = [...TPTOON_CATEGORIES]
    const worker = async (): Promise<void> => {
      for (;;) {
        const category = queue.shift()
        if (!category) return
        try {
          counts[category.id] = await categoryCount(baseUrl, category.id)
        } catch (err) {
          // 单个分类网络失败只标记 -1，其他分类继续
          if (err instanceof TptoonNetworkError) throw err
          counts[category.id] = -1
        }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker))
    countsCache.set(cacheKey, { counts, at: Date.now() })
    return { ok: true, counts }
  } catch (err) {
    return { ok: false, counts: {}, error: errorText(err) }
  }
}

