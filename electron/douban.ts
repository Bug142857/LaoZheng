import { parse } from 'node-html-parser'
import type {
  SearchCategory,
  SubjectDetail,
  SubjectDetailResponse,
  SubjectKind,
  SubjectSearchItem,
  SubjectSearchResponse
} from '../src/shared/douban'

/**
 * 主进程里的条目搜索与详情抓取。
 * 全部请求都在主进程发起：渲染进程不直接跨域，也避免 CSP 干扰。
 * 解析口径与手机端 DoubanClient 对齐（subject_search 的 window.__DATA__ + 网页搜索兜底）。
 */

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

const TIMEOUT_MS = 15_000

type Json = Record<string, unknown>

function asObject(v: unknown): Json | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

function asNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : NaN
  return Number.isFinite(n) ? n : null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return '请求超时，请稍后重试'
    if (err.message.includes('fetch failed')) return '网络不可用，请检查网络后重试'
    return err.message
  }
  return '网络请求失败'
}

async function getText(url: string, referer: string, ua = DESKTOP_UA): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': ua,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      Referer: referer,
      'Upgrade-Insecure-Requests': '1'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`数据源返回 HTTP ${res.status}`)
  return res.text()
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      if (i < attempts - 1) await delay(700 * (i + 1))
    }
  }
  throw last instanceof Error ? last : new Error('网络请求失败')
}

const BLOCK_MARKERS = [
  'sec.douban.com',
  '异常请求',
  '访问过于频繁',
  '请输入验证码',
  '机器人验证',
  '安全验证'
]

/** 反爬 / 空壳页面要显式报错，不能静默返回空结果让用户误以为「没搜到」 */
function assertUsablePage(html: string): void {
  if (!html.trim()) throw new Error('数据源返回空内容，请稍后重试')
  const lower = html.toLowerCase()
  if (BLOCK_MARKERS.some((m) => lower.includes(m.toLowerCase()))) {
    throw new Error('数据源触发了访问限制，请稍后重试')
  }
  if (
    html.length < 3000 &&
    lower.includes('all rights reserved') &&
    !html.includes('window.__DATA__') &&
    !html.includes('class="result"')
  ) {
    throw new Error('数据源触发了访问限制，请稍后重试')
  }
}

/** 用括号配对截取 marker 之后的完整 JSON（正则非贪婪会截断嵌套对象） */
function extractJsonObjectAfter(text: string, marker: string): string | null {
  const at = text.indexOf(marker)
  if (at < 0) return null
  const start = text.indexOf('{', at)
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function defaultUrl(kind: SubjectKind, id: string): string {
  if (kind === 'book') return `https://book.douban.com/subject/${id}/`
  if (kind === 'game') return `https://www.douban.com/game/${id}/`
  return `https://movie.douban.com/subject/${id}/`
}

function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function decodeHref(href: string): string {
  const withEntity = href.replace(/&amp;/g, '&')
  try {
    return decodeURIComponent(withEntity)
  } catch {
    return withEntity
  }
}

/** 电影 / 剧集 / 图书：解析 subject_search 页面里的 window.__DATA__ */
function parseSubjectPage(html: string, want: 'movie' | 'tv' | 'book'): SubjectSearchItem[] {
  const jsonStr = extractJsonObjectAfter(html, 'window.__DATA__')
  if (!jsonStr) {
    assertUsablePage(html)
    throw new Error('搜索结果解析失败，请稍后重试')
  }
  let root: Json
  try {
    root = JSON.parse(jsonStr) as Json
  } catch {
    throw new Error('搜索结果解析失败，请稍后重试')
  }
  const rawItems = asArray(root.items)
  if (rawItems.length === 0) {
    // 有 __DATA__ 但没有 items：可能是反爬的变体，交给重试
    if (!('items' in root)) throw new Error('搜索结果为空或触发了访问限制，请稍后重试')
    return []
  }

  const out: SubjectSearchItem[] = []
  for (const raw of rawItems) {
    const it = asObject(raw)
    if (!it) continue
    const id = asText(it.id)
    if (!/^\d+$/.test(id)) continue
    const rawTitle = asText(it.title)
    if (!rawTitle) continue
    const url = asText(it.url)
    // 图书搜索里混有「丛书」条目（/series/），没有详情接口，过滤掉
    if (want === 'book' && !url.includes('/subject/')) continue

    const labels = asArray(it.labels)
      .map((l) => asText(asObject(l)?.text))
      .filter(Boolean)
    const isTv = labels.some((t) => t.includes('剧集') || t.includes('电视')) || url.includes('/tv/')
    if (want === 'movie' && isTv) continue
    if (want === 'tv' && !isTv) continue

    const year =
      rawTitle.match(/\((\d{4})\)/)?.[1] ??
      [...asText(it.abstract).matchAll(/\b(19\d{2}|20\d{2})\b/g)].pop()?.[1] ??
      ''
    const title = normalizeSpace(rawTitle.replace(/\s*\(\d{4}\)\s*$/, '')) || rawTitle
    const kind: SubjectKind = want === 'book' ? 'book' : isTv ? 'tv' : 'movie'
    const rating = asNumber(asObject(it.rating)?.value)
    out.push({
      kind,
      id,
      title,
      subTitle: normalizeSpace(asText(it.abstract)),
      year,
      coverUrl: asText(it.cover_url) || null,
      rating: rating && rating > 0 ? rating : null,
      intro: '',
      url: url || defaultUrl(kind, id)
    })
  }
  return out
}

/** 影视补充来源：www.douban.com/search?cat=1002（标题带 [电影] / [电视剧] 标记） */
function parseVideoWebSearch(html: string): SubjectSearchItem[] {
  assertUsablePage(html)
  const doc = parse(html)
  const out: SubjectSearchItem[] = []
  for (const el of doc.querySelectorAll('div.result')) {
    const link = el.querySelector('h3 a') ?? el.querySelector('a[title]')
    if (!link) continue
    const href = decodeHref(link.getAttribute('href') ?? '')
    const id =
      href.match(/subject\/(\d+)/)?.[1] ??
      el.innerHTML.match(/sid:\s*'?(\d+)/)?.[1] ??
      ''
    if (!id) continue
    const headText = normalizeSpace(el.querySelector('h3')?.text ?? '')
    const isTv = headText.includes('[电视剧]') || href.includes('/tv/')
    const title = normalizeSpace(link.text) || headText.replace(/^\[[^\]]*\]\s*/, '')
    if (!title) continue
    const year = [...headText.matchAll(/\b(19\d{2}|20\d{2})\b/g)].pop()?.[1] ?? ''
    const kind: SubjectKind = isTv ? 'tv' : 'movie'
    out.push({
      kind,
      id,
      title,
      subTitle: headText,
      year,
      coverUrl: el.querySelector('.pic img')?.getAttribute('src')?.trim() || null,
      rating:
        asNumber(el.querySelector('span.rating_nums')?.text.trim()) ??
        asNumber(headText.match(/(\d\.\d)\s*\(\d+人评价\)/)?.[1]),
      intro: '',
      url: defaultUrl(kind, id)
    })
  }
  return out
}

/** 游戏：www.douban.com/search?cat=3114 */
function parseGameSearch(html: string): SubjectSearchItem[] {
  assertUsablePage(html)
  const doc = parse(html)
  const out: SubjectSearchItem[] = []
  for (const el of doc.querySelectorAll('div.result')) {
    const link = el.querySelector('a[title]')
    if (!link) continue
    const href = decodeHref(link.getAttribute('href') ?? '')
    const onclick = link.getAttribute('onclick') ?? ''
    const id =
      href.match(/game\/(\d+)/)?.[1] ??
      `${href} ${onclick}`.match(/sid[:\s]+'?(\d+)/)?.[1] ??
      ''
    if (!id) continue
    const title = normalizeSpace(link.getAttribute('title') ?? link.text)
    if (!title) continue
    const info = normalizeSpace(el.querySelector('span.subject-cast')?.text ?? '')
    const years = [...info.matchAll(/\b(\d{4})\b/g)]
    out.push({
      kind: 'game',
      id,
      title,
      subTitle: info,
      year: years.pop()?.[1] ?? '',
      coverUrl: el.querySelector('img[src]')?.getAttribute('src')?.trim() || null,
      rating: asNumber(el.querySelector('span.rating_nums')?.text.trim()),
      intro: normalizeSpace(el.querySelector('p')?.text ?? ''),
      url: defaultUrl('game', id)
    })
  }
  return out
}

/** 人物：www.douban.com/search?cat=1065（只展示资料，不提供收藏） */
function parsePersonSearch(html: string): SubjectSearchItem[] {
  assertUsablePage(html)
  const doc = parse(html)
  const out: SubjectSearchItem[] = []
  for (const el of doc.querySelectorAll('div.result')) {
    const link = el.querySelector('h3 a[href]')
    if (!link) continue
    const href = decodeHref(link.getAttribute('href') ?? '')
    const onclick = decodeHref(link.getAttribute('onclick') ?? '')
    const combined = `${href} ${onclick}`
    const id =
      combined.match(/(?:personage|celebrity)\/(\d+)/)?.[1] ??
      combined.match(/sid[:\s]+'?(\d+)/)?.[1] ??
      ''
    if (!id) continue
    const name = normalizeSpace(link.text)
    if (!name) continue
    const sub = el
      .querySelectorAll('div.content > p')
      .map((p) => normalizeSpace(p.text))
      .filter(Boolean)
      .join(' / ')
    out.push({
      kind: 'person',
      id,
      title: name,
      subTitle: sub,
      year: '',
      coverUrl: el.querySelector('div.pic img[src]')?.getAttribute('src')?.trim() || null,
      rating: null,
      intro: '',
      url: `https://www.douban.com/personage/${id}/`
    })
  }
  return out
}

async function searchSubjectPage(
  want: 'movie' | 'tv' | 'book',
  query: string
): Promise<SubjectSearchItem[]> {
  const encoded = encodeURIComponent(query)
  const url =
    want === 'book'
      ? `https://book.douban.com/subject_search?search_text=${encoded}&cat=1001`
      : `https://movie.douban.com/subject_search?search_text=${encoded}&cat=1002`
  const referer = want === 'book' ? 'https://book.douban.com/' : 'https://movie.douban.com/'
  const html = await getText(url, referer)
  assertUsablePage(html)
  return parseSubjectPage(html, want)
}

function dedupe(items: SubjectSearchItem[]): SubjectSearchItem[] {
  const seen = new Set<string>()
  const out: SubjectSearchItem[] = []
  for (const item of items) {
    const key = `${item.kind}|${item.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** 搜索入口：影视会同时查电影 / 剧集 / 网页搜索并合并去重 */
export async function searchSubjects(
  category: SearchCategory,
  rawQuery: string
): Promise<SubjectSearchResponse> {
  const query = rawQuery.trim()
  if (!query) return { ok: true, items: [] }

  try {
    if (category === 'video') {
      const results: SubjectSearchItem[] = []
      const errors: string[] = []
      for (const want of ['movie', 'tv'] as const) {
        try {
          results.push(...(await withRetry(() => searchSubjectPage(want, query))))
        } catch (err) {
          errors.push(errorText(err))
        }
        await delay(350)
      }
      try {
        const html = await getText(
          `https://www.douban.com/search?cat=1002&q=${encodeURIComponent(query)}`,
          'https://www.douban.com/'
        )
        results.push(...parseVideoWebSearch(html))
      } catch (err) {
        errors.push(errorText(err))
      }
      const items = dedupe(results)
      if (items.length === 0 && errors.length > 0) {
        return { ok: false, items: [], error: errors[0] }
      }
      return {
        ok: true,
        items,
        warning: errors.length > 0 ? '部分来源暂时不可用，结果可能偏少' : undefined
      }
    }

    if (category === 'book') {
      const items = await withRetry(() => searchSubjectPage('book', query))
      return { ok: true, items }
    }

    if (category === 'game') {
      const items = await withRetry(async () => {
        const html = await getText(
          `https://www.douban.com/search?cat=3114&q=${encodeURIComponent(query)}`,
          'https://www.douban.com/'
        )
        return parseGameSearch(html)
      })
      return { ok: true, items }
    }

    const items = await withRetry(async () => {
      const html = await getText(
        `https://www.douban.com/search?cat=1065&q=${encodeURIComponent(query)}`,
        'https://www.douban.com/'
      )
      return parsePersonSearch(html)
    })
    return { ok: true, items }
  } catch (err) {
    return { ok: false, items: [], error: errorText(err) }
  }
}

function cleanText(raw: unknown): string {
  const text = asText(raw)
  if (!text) return ''
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function pickFullDate(o: Json): string {
  for (const key of ['release_date', 'pubdate', 'date', 'publish_date']) {
    const value = o[key]
    const list = Array.isArray(value) ? value : [value]
    const candidates = list.map(asText).map((s) => s.trim()).filter(Boolean)
    const formal = candidates.find((s) => !s.includes('电影节'))
    if (formal) return formal
  }
  return ''
}

/** 完整日期并入 card_subtitle，去掉原来只有年份的段，避免「2008 / 2008-1」重复 */
function mergeDateIntoInfo(base: string, fullDate: string): string {
  if (!base) return fullDate
  if (!fullDate) return base
  const datePart = fullDate.split(/[（(]/)[0].trim()
  if (!datePart) return base
  const segments = base
    .split(' / ')
    .map((s) => s.trim())
    .filter(Boolean)
  const yearOnly = /^\d{4}$/
  const fullDateRe = /^\d{4}[-/年.]\d{1,2}(?:[-/月.]\d{1,2})?日?/
  const kept = segments.filter((s) => !yearOnly.test(s) && !fullDateRe.test(s))
  const alreadyHas = segments.some((s) => s.includes(datePart.slice(0, 7)))
  const finalSegments = alreadyHas ? kept : [datePart, ...kept]
  return [...new Set(finalSegments)].join(' / ')
}

function names(o: Json, key: string, limit = 8): string {
  const list = asArray(o[key]).slice(0, limit)
  const out = list
    .map((v) => asText(asObject(v)?.name) || asText(v))
    .map((s) => s.trim())
    .filter(Boolean)
  return out.join('/')
}

/** 条目详情：优先 Rexxar API（含导演/演员/类型/评分/简介/封面） */
export async function fetchSubjectDetail(
  kind: SubjectKind,
  id: string
): Promise<SubjectDetailResponse> {
  if (!/^\d+$/.test(id)) return { ok: false, error: '条目编号无效' }
  try {
    const referer =
      kind === 'game'
        ? `https://m.douban.com/game/${id}/`
        : `https://m.douban.com/${kind}/subject/${id}/`
    const body = await withRetry(
      () => getText(`https://m.douban.com/rexxar/api/v2/${kind}/${id}`, referer, MOBILE_UA),
      2
    )
    const o = JSON.parse(body) as Json

    const cover =
      asText(o.cover_url) ||
      asText(asObject(o.pic)?.large) ||
      asText(asObject(o.pic)?.normal) ||
      asText(asObject(o.images)?.large) ||
      null

    const gameDevelopers = asText(o.developers)
    const gamePlatforms = asArray(o.platforms)
      .map((v) => asText(asObject(v)?.name))
      .filter(Boolean)
      .join('/')

    const detail: SubjectDetail = {
      title: asText(o.title) || null,
      rating: asNumber(asObject(o.rating)?.value),
      coverUrl: cover,
      summary: cleanText(o.intro),
      info: mergeDateIntoInfo(cleanText(o.card_subtitle), pickFullDate(o)),
      directors: names(o, 'directors') || names(o, 'author') || gameDevelopers,
      casts: names(o, 'actors') || names(o, 'translators') || gamePlatforms,
      genres: asArray(o.genres)
        .map((v) => asText(v))
        .filter(Boolean)
        .join('/')
    }
    return { ok: true, detail }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}
