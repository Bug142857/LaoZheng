import { parse } from 'node-html-parser'
import { session } from 'electron'
import {
  JMCOMIC_CATEGORIES,
  JMCOMIC_DEFAULT_BASE,
  JMCOMIC_GOHOME_URL,
  JMCOMIC_PAGE_SIZE,
  JMCOMIC_SOURCE_ID,
  jmcomicComicId,
  jmcomicComicSlug,
  jmcomicComicSourceId,
  type JmcomicCategoryCountsResponse
} from '../src/shared/jmcomic'
import type {
  YumanhuaChapter,
  YumanhuaChaptersResponse,
  YumanhuaComic,
  YumanhuaDetailResponse,
  YumanhuaImagesResponse,
  YumanhuaListResponse
} from '../src/shared/yumanhua'

/**
 * 禁漫天堂（18comic）客户端。
 *
 * 站点是传统服务端渲染 HTML：
 *   最近 /albums?o=mr、热门 /albums?o=mv、分类 /albums/<slug>、搜索 /search/photos
 *   详情 /album/<id>（目录在 #episode-block），章节图 /photo/<chapterId> 的 data-original。
 *
 * 章节图对 id > 220980 的本子做了纵向分段倒序处理，图片字节需要在主进程还原
 * （见 jmcomicImage.ts），否则看到的是错位图。
 *
 * 站点经常换域名：探活失败时读取 x99dh.net 的「优选访问」数据，按顺序找可用线路，
 * 结果缓存 10 分钟。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const TIMEOUT_MS = 25_000
const PROBE_TIMEOUT_MS = 8_000
const BASE_TTL = 10 * 60 * 1000

class JmNetworkError extends Error {}

const baseCache = new Map<string, { base: string; at: number }>()
const resolving = new Map<string, Promise<string>>()
const warmedBases = new Set<string>()

/** 首次访问先过一下 /enter 拿年龄确认 cookie，部分镜像后续页面会校验 */
async function warmUpCookies(base: string): Promise<void> {
  if (warmedBases.has(base)) return
  warmedBases.add(base)
  try {
    await fetchText(`${base}/enter`, `${base}/`, { timeout: PROBE_TIMEOUT_MS })
  } catch {
    // 年龄页拿不到也不影响：多数镜像不校验
  }
}

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
  return decodeEntities(String(value ?? '').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
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

/* ---------------- 站点可用地址 ---------------- */

async function fetchText(
  url: string,
  referer?: string,
  options: { timeout?: number; allowErrorStatus?: boolean } = {}
): Promise<string> {
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
      signal: AbortSignal.timeout(options.timeout ?? TIMEOUT_MS)
    })
  } catch {
    throw new JmNetworkError('连不上禁漫天堂站点')
  }
  // x99dh 发布页偶尔返回 500，但页面数据仍然完整，这里只关心正文
  if (!options.allowErrorStatus && (res.status >= 500 || res.status === 429)) {
    throw new JmNetworkError(`禁漫天堂站点返回 HTTP ${res.status}`)
  }
  if (!options.allowErrorStatus && res.status === 404) throw new Error('页面不存在（404）')
  if (!options.allowErrorStatus && !res.ok) {
    throw new JmNetworkError(`禁漫天堂站点返回 HTTP ${res.status}`)
  }
  const body = await res.text()
  if (!body) throw new Error('站点返回了空页面')
  return body
}

/** status.html 固定返回 ok，体积最小，作为探活接口 */
async function probeSite(base: string): Promise<boolean> {
  try {
    const body = await fetchText(`${base}/status.html`, `${base}/`, {
      timeout: PROBE_TIMEOUT_MS
    })
    if (body.trim().toLowerCase() === 'ok') return true
  } catch {
    // status.html 不可用时退回首页验签
  }
  try {
    const html = await fetchText(`${base}/enter`, `${base}/`, { timeout: PROBE_TIMEOUT_MS })
    return /禁漫天堂|禁漫車|scramble_id/.test(html) || /\/media\/albums\//.test(html)
  } catch {
    return false
  }
}

/**
 * 从 x99dh.net 发布页解析「优选访问」数据。
 * 页面把站点列表 base64 + URI 编码后塞在脚本里，按名称找到「禁漫天堂」，取其线路。
 */
async function discoverRoutes(): Promise<string[]> {
  try {
    const html = await fetchText(JMCOMIC_GOHOME_URL, JMCOMIC_GOHOME_URL, {
      timeout: PROBE_TIMEOUT_MS,
      allowErrorStatus: true
    })
    const matched = /["'](JTVC[A-Za-z0-9+/=]{80,})["']/.exec(html)
    if (!matched) return []
    const json = decodeURIComponent(Buffer.from(matched[1], 'base64').toString('utf8'))
    const list = JSON.parse(json) as Array<{
      name?: string
      url?: string
      urls?: Array<{ url?: string; testUrl?: string }>
    }>
    const entry = list.find((item) => /禁漫/.test(String(item?.name ?? '')))
    if (!entry) return []
    const out: string[] = []
    const push = (raw?: string): void => {
      const origin = originOf(raw)
      if (origin && !out.includes(origin)) out.push(origin)
    }
    push(entry.url)
    for (const item of entry.urls ?? []) push(item?.url || item?.testUrl)
    return out
  } catch {
    return []
  }
}

/** 优选访问里的线路按顺序并发探活，取第一个可用的 */
async function pickMirror(candidates: string[], skip: string): Promise<string | null> {
  const routes = candidates.filter((route) => route !== skip).slice(0, 30)
  if (!routes.length) return null
  const results = await Promise.all(
    routes.map(async (route) => ({ route, ok: await probeSite(route) }))
  )
  return results.find((item) => item.ok)?.route ?? null
}

async function resolveBase(preferredRaw: string | undefined, force = false): Promise<string> {
  const preferred = originOf(preferredRaw) || JMCOMIC_DEFAULT_BASE
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
      await warmUpCookies(preferred)
      return preferred
    }
    const mirror = await pickMirror(await discoverRoutes(), preferred)
    if (mirror) {
      baseCache.set(preferred, { base: mirror, at: Date.now() })
      await warmUpCookies(mirror)
      return mirror
    }
    throw new Error('禁漫天堂站点无法访问，x99dh 优选访问里也没有可用线路')
  })().finally(() => {
    if (resolving.get(preferred) === task) resolving.delete(preferred)
  })
  resolving.set(preferred, task)
  return task
}

async function withSite<T>(
  preferred: string | undefined,
  run: (base: string) => Promise<T>
): Promise<T> {
  const base = await resolveBase(preferred)
  try {
    return await run(base)
  } catch (err) {
    if (!(err instanceof JmNetworkError)) throw err
    const fresh = await resolveBase(preferred, true)
    return run(fresh)
  }
}

/* ---------------- 列表 ---------------- */

function statusOf(tags: string[]): string {
  const value = tags.join(' ')
  if (/已完結|已完结|完結|完结/.test(value)) return '已完结'
  if (/連載中|连载中|連載|连载/.test(value)) return '连载中'
  return ''
}

function comicOf(row: ReturnType<typeof parse>, sourceId: string, base: string): YumanhuaComic | null {
  const link = row.querySelector('a[href*="/album/"]')
  const href = attr(link, 'href')
  const matched = /\/album\/(\d+)/.exec(href)
  if (!matched) return null
  const img = row.querySelector('img')
  const title =
    text(row.querySelector('.video-title')?.text) || text(attr(img, 'title')) || text(attr(img, 'alt'))
  if (!title) return null
  const cover = absoluteUrl(attr(img, 'data-original') || attr(img, 'src'), base)
  const authors: string[] = []
  for (const node of row.querySelectorAll('a[href*="main_tag=2"]')) {
    const name = text(node.text)
    if (name && !authors.includes(name)) authors.push(name)
  }
  const tags: string[] = []
  for (const node of row.querySelectorAll('.tags a')) {
    const name = text(node.text)
    if (name && !tags.includes(name)) tags.push(name)
  }
  return {
    id: jmcomicComicId(matched[1], sourceId),
    title,
    cover,
    author: authors.join(' / '),
    tags,
    status: statusOf(tags),
    latest: '',
    intro: ''
  }
}

function lastPageOf(root: ReturnType<typeof parse>): number {
  let last = 1
  for (const node of root.querySelectorAll('.pagination a, .pagination option')) {
    const value = attr(node, 'href') || attr(node, 'value')
    const matched = /[?&]page=(\d+)/.exec(value)
    if (matched) last = Math.max(last, Number(matched[1]))
  }
  return last
}

function parseList(
  html: string,
  sourceId: string,
  base: string
): { items: YumanhuaComic[]; lastPage: number } {
  const root = parse(html)
  const items: YumanhuaComic[] = []
  const seen = new Set<string>()
  for (const row of root.querySelectorAll('.list-col')) {
    const item = comicOf(row, sourceId, base)
    if (!item) continue
    const slug = jmcomicComicSlug(item.id)
    if (seen.has(slug)) continue
    seen.add(slug)
    items.push(item)
  }
  return { items, lastPage: lastPageOf(root) }
}

function listPath(
  mode: 'recent' | 'hot' | 'category' | 'search',
  categoryId: string,
  keyword: string,
  page: number
): string {
  const suffix = page > 1 ? `&page=${page}` : ''
  if (mode === 'search') {
    return `/search/photos?search_query=${encodeURIComponent(keyword)}${suffix}`
  }
  if (mode === 'category' && categoryId) {
    return `/albums/${encodeURIComponent(categoryId)}?page=${page}`
  }
  return `/albums?o=${mode === 'hot' ? 'mv' : 'mr'}${suffix}`
}

async function comicList(
  baseUrl: string | undefined,
  mode: 'recent' | 'hot' | 'category' | 'search',
  categoryId: string,
  keyword: string,
  page: number,
  sourceId: string
): Promise<YumanhuaListResponse> {
  try {
    const current = Math.max(1, Math.min(9999, Number.isFinite(page) ? Math.floor(page) : 1))
    const path = listPath(mode, categoryId, keyword, current)
    const { html, base } = await withSite(baseUrl, async (base) => ({
      html: await fetchText(`${base}${path}`, `${base}/`),
      base
    }))
    const parsed = parseList(html, sourceId, base)
    if (!parsed.items.length && mode !== 'search') {
      throw new Error('站点没有返回可解析的漫画')
    }
    return {
      ok: true,
      items: parsed.items,
      hasMore: current < parsed.lastPage,
      totalPages: parsed.lastPage
    }
  } catch (err) {
    return { ok: false, items: [], error: errorText(err) }
  }
}

export async function jmcomicRecent(
  baseUrl?: string,
  sourceId = JMCOMIC_SOURCE_ID,
  page = 1
): Promise<YumanhuaListResponse> {
  return comicList(baseUrl, 'recent', '', '', page, sourceId)
}

export async function jmcomicHot(
  baseUrl?: string,
  sourceId = JMCOMIC_SOURCE_ID,
  page = 1
): Promise<YumanhuaListResponse> {
  return comicList(baseUrl, 'hot', '', '', page, sourceId)
}

export async function jmcomicCategory(
  categoryId: string,
  baseUrl?: string,
  sourceId = JMCOMIC_SOURCE_ID,
  page = 1
): Promise<YumanhuaListResponse> {
  return comicList(baseUrl, 'category', categoryId, '', page, sourceId)
}

export async function jmcomicSearch(
  keyword: string,
  baseUrl?: string,
  sourceId = JMCOMIC_SOURCE_ID,
  page = 1
): Promise<YumanhuaListResponse> {
  return comicList(baseUrl, 'search', '', keyword, page, sourceId)
}

/* ---------------- 分类数量 ---------------- */

const countsCache = new Map<string, { counts: Record<string, number>; at: number }>()
const COUNTS_TTL = 24 * 60 * 60 * 1000

/** 分类某一页的条目数 + 末页页码（末页页码来自分页里的「末页」链接和下拉选项） */
async function categoryPage(
  baseUrl: string | undefined,
  categoryId: string,
  page: number
): Promise<{ items: number; lastPage: number }> {
  const { html, base } = await withSite(baseUrl, async (base) => ({
    html: await fetchText(
      `${base}/albums/${encodeURIComponent(categoryId)}?page=${page}`,
      `${base}/albums/${encodeURIComponent(categoryId)}`
    ),
    base
  }))
  const parsed = parseList(html, JMCOMIC_SOURCE_ID, base)
  return { items: parsed.items.length, lastPage: parsed.lastPage }
}

/** 站点不显示分类总数：第一页拿末页页码，再取末页条目数折算 */
async function categoryCount(baseUrl: string | undefined, categoryId: string): Promise<number> {
  const first = await categoryPage(baseUrl, categoryId, 1)
  if (!first.items) return 0
  const last = first.lastPage
  if (last <= 1) return first.items
  const tail = await categoryPage(baseUrl, categoryId, last)
  return (last - 1) * JMCOMIC_PAGE_SIZE + tail.items
}

export async function jmcomicCategoryCounts(
  baseUrl?: string
): Promise<JmcomicCategoryCountsResponse> {
  const cacheKey = originOf(baseUrl) || JMCOMIC_DEFAULT_BASE
  const cached = countsCache.get(cacheKey)
  if (cached && Date.now() - cached.at < COUNTS_TTL) {
    return { ok: true, counts: cached.counts }
  }
  try {
    const counts: Record<string, number> = {}
    const queue = [...JMCOMIC_CATEGORIES]
    const worker = async (): Promise<void> => {
      for (;;) {
        const category = queue.shift()
        if (!category) return
        try {
          counts[category.id] = await categoryCount(baseUrl, category.id)
        } catch (err) {
          // 单个分类网络失败只标记 -1，其他分类继续
          if (err instanceof JmNetworkError) throw err
          counts[category.id] = -1
        }
      }
    }
    await Promise.all(Array.from({ length: 3 }, worker))
    countsCache.set(cacheKey, { counts, at: Date.now() })
    return { ok: true, counts }
  } catch (err) {
    return { ok: false, counts: {}, error: errorText(err) }
  }
}

/* ---------------- 详情 / 章节 / 图片 ---------------- */

function albumPathOf(id: string): string {
  const slug = jmcomicComicSlug(id).trim()
  if (!/^\d{1,12}$/.test(slug)) throw new Error('漫画 ID 无效')
  return `/album/${slug}`
}

function parseChapters(html: string): YumanhuaChapter[] {
  const root = parse(html)
  const items: YumanhuaChapter[] = []
  const seen = new Set<string>()
  let index = 0
  for (const node of root.querySelectorAll('#episode-block .episode a[href*="/photo/"]')) {
    const matched = /\/photo\/(\d+)/.exec(attr(node, 'href'))
    if (!matched || seen.has(matched[1])) continue
    seen.add(matched[1])
    const name = text(node.querySelector('h3')?.text) || `第${index + 1}话`
    items.push({ id: matched[1], name, index, size: 0 })
    index += 1
  }
  return items
}

export async function jmcomicDetail(
  id: string,
  baseUrl?: string
): Promise<YumanhuaDetailResponse> {
  try {
    const path = albumPathOf(id)
    const { html, base } = await withSite(baseUrl, async (base) => ({
      html: await fetchText(`${base}${path}`, `${base}/`),
      base
    }))
    const root = parse(html)
    const title = text(root.querySelector('#book-name')?.text || root.querySelector('.book-name')?.text)
    if (!title) throw new Error('详情页没有解析到标题')

    let cover = ''
    for (const img of root.querySelectorAll('#album_photo_cover img')) {
      const src = attr(img, 'data-original') || attr(img, 'src') || attr(img, 'data-src')
      if (src && !/\/blank\.jpg/i.test(src)) {
        cover = absoluteUrl(src, base)
        break
      }
    }

    const authors: string[] = []
    for (const node of root.querySelectorAll('#intro-block span[data-type="author"] a')) {
      const name = text(node.text)
      if (name && !authors.includes(name)) authors.push(name)
    }
    const tags: string[] = []
    for (const node of root.querySelectorAll('#intro-block span[data-type="tags"] a')) {
      const name = text(node.text)
      if (name && !tags.includes(name)) tags.push(name)
    }

    let intro = ''
    for (const node of root.querySelectorAll('#intro-block h2')) {
      const value = text(node.text)
      if (/^敘述[:：]?/.test(value)) {
        intro = value.replace(/^敘述[:：]?\s*/, '')
        break
      }
    }

    const chapters = parseChapters(html)
    return {
      ok: true,
      comic: {
        id: jmcomicComicId(
          jmcomicComicSlug(id),
          jmcomicComicSourceId(id) || JMCOMIC_SOURCE_ID
        ),
        title,
        cover,
        author: authors.join(' / '),
        tags,
        status: statusOf(tags),
        latest: chapters.length ? chapters[chapters.length - 1].name : '',
        intro
      }
    }
  } catch (err) {
    return { ok: false, comic: null, error: errorText(err) }
  }
}

export async function jmcomicChapters(
  id: string,
  baseUrl?: string
): Promise<YumanhuaChaptersResponse> {
  try {
    const path = albumPathOf(id)
    const { html } = await withSite(baseUrl, async (base) => ({
      html: await fetchText(`${base}${path}`, `${base}/`)
    }))
    const items = parseChapters(html)
    if (!items.length) throw new Error('详情页没有解析到章节')
    return { ok: true, items }
  } catch (err) {
    return { ok: false, items: [], error: errorText(err) }
  }
}

export async function jmcomicImages(
  comicId: string,
  chapterId: string,
  baseUrl?: string
): Promise<YumanhuaImagesResponse> {
  try {
    const slug = jmcomicComicSlug(chapterId).trim()
    if (!/^\d{1,12}$/.test(slug)) throw new Error('章节 ID 无效')
    const albumSlug = jmcomicComicSlug(comicId).trim()
    const refererPath = /^\d{1,12}$/.test(albumSlug) ? `/album/${albumSlug}` : '/'
    const { html, base } = await withSite(baseUrl, async (base) => ({
      html: await fetchText(`${base}/photo/${slug}`, `${base}${refererPath}`),
      base
    }))
    const root = parse(html)
    const urls: string[] = []
    const seen = new Set<string>()
    const push = (raw: string): void => {
      const url = absoluteUrl(raw, base)
      if (!url || seen.has(url)) return
      seen.add(url)
      urls.push(url)
    }
    for (const img of root.querySelectorAll('.scramble-page img[data-original]')) {
      push(attr(img, 'data-original'))
    }
    if (!urls.length) {
      for (const img of root.querySelectorAll('img[id^="album_photo_"]')) {
        push(attr(img, 'data-original') || attr(img, 'src'))
      }
    }
    if (!urls.length) throw new Error('章节页没有解析到图片')
    return { ok: true, urls }
  } catch (err) {
    return { ok: false, urls: [], error: errorText(err) }
  }
}

/** 供片源管理的「测试」按钮使用：能返回第一页漫画即可 */
export async function jmcomicTest(baseUrl?: string): Promise<YumanhuaListResponse> {
  return jmcomicRecent(baseUrl, JMCOMIC_SOURCE_ID, 1)
}

/** 列表页固定 80 条，翻页按钮用得上 */
export const JMCOMIC_LIST_PAGE_SIZE = JMCOMIC_PAGE_SIZE
