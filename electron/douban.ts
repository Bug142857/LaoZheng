import { BrowserWindow } from 'electron'
import { parse } from 'node-html-parser'
import type {
  PersonAward,
  PersonFullResponse,
  PersonWork,
  SearchCategory,
  SubjectComment,
  SubjectCommentsResponse,
  SubjectCredit,
  SubjectCreditsResponse,
  SubjectDetail,
  SubjectDetailResponse,
  SubjectFull,
  SubjectFullResponse,
  SubjectKind,
  SubjectSearchItem,
  SubjectSearchResponse,
  SubjectTrailer
} from '../src/shared/douban'
import { doubanCookie } from './doubanAuth'

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
  const headers: Record<string, string> = {
    'User-Agent': ua,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    Referer: referer,
    'Upgrade-Insecure-Requests': '1'
  }
  // 账号管理里登录过豆瓣就带上 Cookie（老片/冷门条目需要登录才搜得到）
  const cookie = doubanCookie()
  if (cookie) headers.Cookie = cookie
  const res = await fetch(url, {
    headers,
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

/* ---------------- 清单条目详情页（影视 / 图书 / 游戏） ---------------- */

function joinList(o: Json, key: string, limit = 12): string {
  return asArray(o[key])
    .slice(0, limit)
    .map((v) => asText(asObject(v)?.name) || asText(v))
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/')
}

/** 图书字段有的返回字符串、有的返回字符串数组（页数、装帧、出版社） */
function textOrList(o: Json, key: string): string {
  const value = o[key]
  if (Array.isArray(value)) {
    return value.map((v) => asText(v)).filter(Boolean).join(' / ')
  }
  return asText(value)
}

function imageOf(raw: unknown): string | null {
  const o = asObject(raw)
  if (!o) return null
  const image = asObject(o.image)
  return (
    asText(asObject(o.large)?.url) ||
    asText(asObject(o.normal)?.url) ||
    asText(image?.large && asObject(image.large)?.url) ||
    asText(o.cover_url) ||
    asText(o.url) ||
    null
  )
}

function parseCredits(raw: unknown): SubjectCredit[] {
  return asArray(raw)
    .map((v) => {
      const o = asObject(v)
      if (!o) return null
      const name =
        asText(o.name) ||
        asText(asObject(o.celebrity)?.name) ||
        asText(asObject(o.character)?.name) ||
        ''
      if (!name) return null
      const explicitRoles = asArray(o.roles)
        .map((r) => asText(asObject(r)?.name) || asText(r))
        .map((s) => s.trim())
        .filter(Boolean)
      const character =
        asText(asObject(o.character)?.name) || asText(o.character).trim()
      // 站点返回的 roles 比 character（形如「导演 Director」）更规整，优先用 roles
      const roles = explicitRoles.length ? explicitRoles : character ? [character] : []
      const id =
        asText(asObject(o.celebrity)?.id) ||
        asText(o.id) ||
        asText(asObject(asObject(o.celebrity)?.avatar)?.id) ||
        ''
      return {
        id: /^\d+$/.test(id) ? id : null,
        name,
        role: [...new Set(roles)].join(' / ') || asText(o.department) || '职员',
        avatar:
          asText(asObject(o.avatar)?.large) ||
          asText(asObject(o.avatar)?.normal) ||
          asText(o.avatar_url) ||
          asText(asObject(asObject(o.celebrity)?.avatar)?.large) ||
          null
      }
    })
    .filter((v): v is SubjectCredit => !!v)
}

/** 图书作者：站点返回 author 数组，带人物 id 与头像（没有头像时用名字占位） */
function parseAuthors(raw: unknown): SubjectCredit[] {
  return asArray(raw)
    .map((v) => {
      const o = asObject(v)
      if (!o) return null
      const name = asText(o.name)
      if (!name) return null
      const id = asText(o.id)
      return {
        id: /^\d+$/.test(id) ? id : null,
        name,
        role: '作者',
        avatar:
          asText(asObject(o.avatar)?.large) ||
          asText(asObject(o.avatar)?.normal) ||
          asText(o.avatar_url) ||
          null
      }
    })
    .filter((v): v is SubjectCredit => !!v)
}

function parsePhotos(raw: unknown): string[] {
  return asArray(raw)
    .map((v) => {
      const o = asObject(v)
      if (!o) return null
      return (
        asText(asObject(asObject(o.image)?.large)?.url) ||
        asText(asObject(asObject(o.image)?.normal)?.url) ||
        asText(asObject(o.large)?.url) ||
        asText(o.url) ||
        null
      )
    })
    .filter((v): v is string => !!v)
}

function parseTrailers(raw: unknown): SubjectTrailer[] {
  const out: SubjectTrailer[] = []
  for (const v of asArray(raw)) {
    const o = asObject(v)
    if (!o) continue
    const url = asText(o.video_url) || asText(o.url) || asText(o.play_url)
    if (!/^https?:\/\//i.test(url)) continue
    out.push({
      title: asText(o.title) || '预告片',
      url,
      cover: imageOf(o)
    })
  }
  return out
}

async function getJson(url: string, referer: string): Promise<Json | null> {
  try {
    const body = await getText(url, referer, MOBILE_UA)
    const parsed = JSON.parse(body) as unknown
    return asObject(parsed)
  } catch {
    return null
  }
}

/** 次要数据不要拖住详情页：最多等 6 秒，超时返回 undefined（标记为残缺结果，不落缓存） */
function withLimit<T>(task: Promise<T>, ms = 6000): Promise<T | undefined> {
  return Promise.race([task, delay(ms).then(() => undefined)])
}

/**
 * 完整详情：主接口 + 职员表 / 剧照 / 预告片（部分接口缺字段时不报错，
 * 前端按拿到的字段逐条展示）。
 */
export async function fetchSubjectFull(
  kind: SubjectKind,
  id: string
): Promise<SubjectFullResponse> {
  if (!/^\d+$/.test(id)) return { ok: false, error: '条目编号无效' }
  const referer =
    kind === 'game'
      ? `https://m.douban.com/game/${id}/`
      : `https://m.douban.com/${kind}/subject/${id}/`
  const base = `https://m.douban.com/rexxar/api/v2/${kind}/${id}`
  try {
    const root = await withRetry(() => getText(base, referer, MOBILE_UA), 2)
    const o = JSON.parse(root) as Json
    const [creditsRaw, photosRaw, trailersRaw, bookCredits] = await Promise.all([
      kind === 'book'
        ? Promise.resolve(null)
        : withLimit(o.credits ? Promise.resolve(o.credits) : getJson(`${base}/credits`, referer)),
      kind === 'book'
        ? Promise.resolve(null)
        : withLimit(o.photos ? Promise.resolve(o.photos) : getJson(`${base}/photos?count=24`, referer)),
      kind === 'book'
        ? Promise.resolve(null)
        : withLimit(o.trailers ? Promise.resolve(o.trailers) : getJson(`${base}/trailers`, referer)),
      // 图书的作者信息在 /book/{id}/credits 里，带人物 id 与头像；主接口的 author 只有字符串
      kind === 'book' ? withLimit(getJson(`${base}/credits`, referer)) : Promise.resolve(null)
    ])
    const credits =
      kind === 'book'
        ? parseAuthors(bookCredits?.items ?? o.author)
        : parseCredits(
            Array.isArray(creditsRaw)
              ? creditsRaw
              : asObject(creditsRaw)?.credits ??
                  asObject(creditsRaw)?.items ??
                  asObject(creditsRaw)?.credits_list
          )
    const creditsTotal =
      (kind === 'book'
        ? asNumber(bookCredits?.total)
        : asNumber(asObject(creditsRaw)?.total)) ?? credits.length
    const photos = parsePhotos(
      Array.isArray(photosRaw) ? photosRaw : asObject(photosRaw)?.photos
    )
    const trailers = parseTrailers(
      Array.isArray(trailersRaw) ? trailersRaw : asObject(trailersRaw)?.trailers
    )
    const writersFromCredits = credits
      .filter((c) => /编剧|writer/i.test(c.role))
      .map((c) => c.name)
      .join('/')
    const cover =
      asText(o.cover_url) ||
      asText(asObject(o.pic)?.large) ||
      asText(asObject(o.pic)?.normal) ||
      asText(asObject(o.images)?.large) ||
      photos[0] ||
      null
    const partial =
      creditsRaw === undefined ||
      photosRaw === undefined ||
      trailersRaw === undefined ||
      (kind === 'book' && bookCredits === undefined)
    const detail: SubjectFull = {
      title: asText(o.title) || null,
      rating: asNumber(asObject(o.rating)?.value),
      coverUrl: cover,
      summary: cleanText(o.intro),
      info: mergeDateIntoInfo(cleanText(o.card_subtitle), pickFullDate(o)),
      directors: names(o, 'directors') || names(o, 'author') || asText(o.developers),
      casts: names(o, 'actors') || names(o, 'translators') || joinList(o, 'platforms'),
      genres: joinList(o, 'genres') || asText(o.genre),
      writers: names(o, 'writers') || writersFromCredits,
      countries: joinList(o, 'countries'),
      dates:
        asArray(o.pubdate).map((v) => asText(v)).filter(Boolean).join(' / ') ||
        textOrList(o, 'release_date') ||
        asText(o.pubdate),
      durations:
        asArray(o.durations).map((v) => asText(v)).filter(Boolean).join(' / ') ||
        textOrList(o, 'duration'),
      aka:
        asArray(o.aka).map((v) => asText(v)).filter(Boolean).join(' / ') ||
        textOrList(o, 'subtitle') ||
        asText(o.aka),
      publisher: textOrList(o, 'publisher') || names(o, 'publishers') || asText(o.publishers),
      pages: textOrList(o, 'pages'),
      binding: textOrList(o, 'binding'),
      authorIntro: cleanText(o.author_intro),
      catalog: cleanText(o.catalog),
      developers: asText(o.developers) || names(o, 'developers'),
      publishers: names(o, 'publishers') || asText(o.publishers),
      platforms: joinList(o, 'platforms'),
      releaseDate:
        asArray(o.release_date).map((v) => asText(v)).filter(Boolean).join(' / ') ||
        asText(o.release_date),
      credits,
      creditsTotal,
      photos,
      trailers,
      partial
    }
    return { ok: true, detail }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

function parseComments(raw: Json | null): SubjectComment[] {
  if (!raw) return []
  const list = Array.isArray(raw.comments)
    ? raw.comments
    : Array.isArray(raw.interests)
      ? raw.interests
      : Array.isArray(raw.items)
        ? raw.items
        : []
  const out: SubjectComment[] = []
  for (const v of list) {
    const o = asObject(v)
    if (!o) continue
    const user = asObject(o.user) ?? asObject(o.author)
    const author = asText(user?.name) || asText(o.author_name) || '匿名'
    const content =
      cleanText(o.comment) || cleanText(o.content) || cleanText(o.text) || cleanText(o.summary)
    if (!content) continue
    out.push({
      author,
      avatar:
        asText(asObject(user?.avatar)?.large) ||
        asText(asObject(user?.avatar)?.normal) ||
        asText(user?.avatar) ||
        null,
      rating: asNumber(asObject(o.rating)?.value) ?? asNumber(o.rating),
      content,
      time: asText(o.create_time) || asText(o.time) || asText(o.date),
      votes: asNumber(o.useful_count) ?? asNumber(o.vote_count) ?? asNumber(o.votes) ?? 0
    })
  }
  return out
}

/** 短评：热门 / 最新（接口不可用时返回空列表，不阻塞详情页） */
export async function fetchSubjectComments(
  kind: SubjectKind,
  id: string,
  order: 'hot' | 'new'
): Promise<SubjectCommentsResponse> {
  if (!/^\d+$/.test(id)) return { ok: false, comments: [], error: '条目编号无效' }
  const referer =
    kind === 'game'
      ? `https://m.douban.com/game/${id}/`
      : `https://m.douban.com/${kind}/subject/${id}/`
  const base = `https://m.douban.com/rexxar/api/v2/${kind}/${id}`
  // 站点接口固定按「热门」返回，排序参数会被忽略：
  // 这里多取一些，再在本地按时间 / 有用数排序，保证「最新」和「热门」结果不同。
  const q = `?start=0&count=${order === 'new' ? 60 : 20}&status=P`
  for (const path of [`${base}/interests${q}`, `${base}/comments${q}`]) {
    const raw = await getJson(path, referer)
    const comments = parseComments(raw)
    if (!comments.length) continue
    const sorted =
      order === 'new'
        ? [...comments].sort((a, b) => b.time.localeCompare(a.time))
        : [...comments].sort((a, b) => b.votes - a.votes)
    return { ok: true, comments: sorted.slice(0, 20) }
  }
  return { ok: true, comments: [] }
}

/* ---------------- 人物详情页 ---------------- */

function personAvatar(o: Json): string | null {
  return (
    asText(asObject(asObject(o.cover)?.large)?.url) ||
    asText(asObject(o.avatar)?.large) ||
    asText(asObject(o.avatar)?.normal) ||
    asText(asObject(o.avatar)?.url) ||
    asText(o.avatar) ||
    asText(o.avatar_url) ||
    null
  )
}

/** 人物资料在 extra.info 里是 [「性别」,「男」] 这样的数组 */
function personInfoMap(o: Json): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of asArray(asObject(o.extra)?.info)) {
    if (!Array.isArray(row) || row.length < 2) continue
    const key = asText(row[0]).trim()
    const value = asText(row[1]).trim()
    if (key && value) map.set(key, value)
  }
  return map
}

/** 作品列表：影视是 { roles, work }，图书作者是直接返回书目对象 */
function personWorks(raw: Json | null): PersonWork[] {
  if (!raw) return []
  const list = asArray(raw.works).length
    ? asArray(raw.works)
    : asArray(raw.subjects).length
      ? asArray(raw.subjects)
      : asArray(raw.items)
  const out: PersonWork[] = []
  const seen = new Set<string>()
  for (const value of list) {
    const o = asObject(value)
    if (!o) continue
    const subject = asObject(o.work) ?? asObject(o.subject) ?? o
    const id = asText(subject.id)
    const title = asText(subject.title)
    if (!/^\d+$/.test(id) || !title) continue
    const key = `${id}|${title}`
    if (seen.has(key)) continue
    seen.add(key)
    const roles = asArray(o.roles)
      .map((r) => asText(asObject(r)?.name) || asText(r))
      .filter(Boolean)
    const rating = asObject(subject.rating)
    const rawKind = (asText(subject.type) || asText(subject.subtype)).toLowerCase()
    const kind: PersonWork['kind'] =
      rawKind.includes('book') || 'book_subtitle' in subject
        ? 'book'
        : rawKind.includes('tv')
          ? 'tv'
          : 'movie'
    out.push({
      id,
      title,
      kind,
      year: asText(subject.year) || asText(subject.release_date).slice(0, 4),
      role: roles.join(' / ') || asText(o.role_type) || asText(o.character) || '',
      cover:
        asText(subject.cover_url) ||
        asText(asObject(subject.pic)?.large) ||
        asText(asObject(subject.pic)?.normal) ||
        asText(asObject(asObject(subject.cover)?.large)?.url) ||
        null,
      rating: asNumber(rating?.value),
      ratingCount: asNumber(rating?.count) ?? 0,
      isReleased: subject.is_released === false ? false : true
    })
  }
  return out
}

/** 获奖情况：celebrity/awards 里 type = celebrity_award 的模块 */
function personAwards(raw: Json | null): PersonAward[] {
  const out: PersonAward[] = []
  for (const yearValue of asArray(raw?.awards)) {
    const yearBlock = asObject(yearValue)
    if (!yearBlock) continue
    const year = asNumber(yearBlock.year) ?? 0
    for (const moduleValue of asArray(yearBlock.modules)) {
      const module = asObject(moduleValue)
      if (!module || asText(module.type) !== 'celebrity_award') continue
      const ceremony = asText(asObject(module.ceremony)?.title)
      const category = asText(asObject(module.category)?.title)
      if (!ceremony && !category) continue
      out.push({ year, ceremony, category, won: module.is_won === true })
    }
  }
  return out.sort((a, b) => b.year - a.year)
}

function personPhotos(raw: Json | null): string[] {
  return asArray(raw?.photos)
    .map((value) => {
      const o = asObject(value)
      if (!o) return null
      return (
        asText(asObject(asObject(o.image)?.large)?.url) ||
        asText(asObject(asObject(o.image)?.normal)?.url) ||
        asText(asObject(o.image)?.url) ||
        null
      )
    })
    .filter((url): url is string => !!url)
}

/** 人物简介不在接口里，移动版人物页的 meta description 带了完整简介 */
async function fetchPersonIntro(personageId: string): Promise<string> {
  if (!/^\d+$/.test(personageId)) return ''
  try {
    const url = `https://m.douban.com/personage/${personageId}/`
    const html = await getText(url, url, MOBILE_UA)
    const raw =
      html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] ??
      html.match(/<meta\s+itemprop="description"\s+content="([^"]*)"/i)?.[1] ??
      ''
    if (!raw) return ''
    const decoded = raw
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
    return decoded.replace(/^[^：:]{0,24}简介[：:]\s*/, '').trim()
  } catch {
    return ''
  }
}

function sortWorks(works: PersonWork[]): { recentWorks: PersonWork[]; topWorks: PersonWork[] } {
  const recentWorks = [...works].sort(
    (a, b) => (Number.parseInt(b.year, 10) || 0) - (Number.parseInt(a.year, 10) || 0)
  )
  const topWorks = [...works].sort(
    (a, b) => b.ratingCount - a.ratingCount || (b.rating ?? 0) - (a.rating ?? 0)
  )
  return { recentWorks, topWorks }
}

/** 只保留已上映作品（豆瓣 creations 页不区分演员 / 导演 / 编剧，统一展示） */
function releasedWorks(works: PersonWork[]): PersonWork[] {
  return works.filter((work) => work.isReleased !== false)
}

async function fetchCelebrityPerson(
  celebrityId: string,
  personageId: string | null,
  preset?: Json | null
): Promise<PersonFullResponse> {
  const referer = personageId
    ? `https://m.douban.com/personage/${personageId}/`
    : `https://m.douban.com/celebrity/${celebrityId}/`
  const celebrity =
    preset ?? (await getJson(`https://m.douban.com/rexxar/api/v2/celebrity/${celebrityId}`, referer))
  const name = asText(celebrity?.title) || asText(celebrity?.name)
  if (!celebrity || !name) return { ok: false, error: '人物详情暂时不可用，请稍后重试' }

  const base = `https://m.douban.com/rexxar/api/v2/celebrity/${celebrityId}`
  const [worksRaw, photosRaw, awardsRaw, intro] = await Promise.all([
    getJson(`${base}/works?start=0&count=200`, referer),
    getJson(`${base}/photos?start=0&count=500`, referer),
    getJson(`${base}/awards`, referer),
    personageId ? fetchPersonIntro(personageId) : Promise.resolve('')
  ])
  const info = personInfoMap(celebrity)
  const works = sortWorks(releasedWorks(personWorks(worksRaw)))
  const aka = [info.get('更多中文名'), info.get('更多外文名'), asText(celebrity.latin_title)]
    .filter(Boolean)
    .join(' / ')
  return {
    ok: true,
    person: {
      id: personageId ?? celebrityId,
      name,
      avatar: personAvatar(celebrity),
      gender: info.get('性别') ?? '',
      birthday: info.get('出生日期') ?? '',
      birthplace: info.get('出生地') ?? '',
      professions: (asText(asObject(celebrity.extra)?.short_info).split(' / ')[0] ?? '').trim(),
      aka: aka || asArray(celebrity.aka).map((v) => asText(v)).filter(Boolean).join(' / '),
      intro,
      awards: personAwards(awardsRaw),
      photos: personPhotos(photosRaw),
      recentWorks: works.recentWorks,
      topWorks: works.topWorks,
      worksLabel: '',
      partial: !worksRaw || !photosRaw || !awardsRaw
    }
  }
}

async function fetchAuthorPerson(
  authorId: string,
  preset?: Json | null,
  personageId?: string | null,
  celebrityId?: string | null
): Promise<PersonFullResponse> {
  const referer = personageId
    ? `https://m.douban.com/personage/${personageId}/`
    : 'https://m.douban.com/'
  const author =
    preset ?? (await getJson(`https://m.douban.com/rexxar/api/v2/author/${authorId}`, referer))
  const name = asText(author?.name) || asText(author?.title)
  if (!author || !name) return { ok: false, error: '人物详情暂时不可用，请稍后重试' }

  // 作者可能同时有 celebrity 档案：照片 / 获奖 / 性别等从那边补，页面才不会空着
  const celebBase = celebrityId
    ? `https://m.douban.com/rexxar/api/v2/celebrity/${celebrityId}`
    : ''
  const [worksRaw, celebrity, photosRaw, awardsRaw] = await Promise.all([
    getJson(
      `https://m.douban.com/rexxar/api/v2/author/${authorId}/works?start=0&count=200&sortby=time`,
      referer
    ),
    celebBase ? getJson(celebBase, referer) : Promise.resolve(null),
    celebBase ? getJson(`${celebBase}/photos?start=0&count=500`, referer) : Promise.resolve(null),
    celebBase ? getJson(`${celebBase}/awards`, referer) : Promise.resolve(null)
  ])
  const works = sortWorks(releasedWorks(personWorks(worksRaw)))
  const info = celebrity ? personInfoMap(celebrity) : new Map<string, string>()
  const intro =
    cleanText(author.intro) ||
    cleanText(author.abstract) ||
    (personageId ? await fetchPersonIntro(personageId) : '')
  return {
    ok: true,
    person: {
      id: personageId ?? authorId,
      name,
      avatar: personAvatar(author) || (celebrity ? personAvatar(celebrity) : null),
      gender: info.get('性别') ?? '',
      birthday: info.get('出生日期') || asText(author.birthday),
      birthplace: info.get('出生地') || asText(author.nationality),
      professions: '作者',
      aka:
        [asText(author.latin_name), info.get('更多中文名'), info.get('更多外文名')]
          .filter(Boolean)
          .join(' / ') || '',
      intro,
      awards: personAwards(awardsRaw),
      photos: personPhotos(photosRaw),
      recentWorks: works.recentWorks,
      topWorks: works.topWorks,
      worksLabel: '',
      partial:
        !worksRaw || (!!celebrityId && (!celebrity || !photosRaw || !awardsRaw))
    }
  }
}

/**
 * 人物详情：演职员 / 图书作者点进去时展示资料、简介、获奖、照片与作品。
 * 豆瓣页面与演职员表给出的都是 personage 编号，需要先解析出内部 celebrity_id / author_id；
 * 简介从移动版人物页 meta 里取，图书作者走 author 接口。
 */
export async function fetchPersonFull(id: string): Promise<PersonFullResponse> {
  if (!/^\d+$/.test(id)) return { ok: false, error: '人物编号无效' }
  const referer = `https://m.douban.com/personage/${id}/`

  const personage = await getJson(`https://m.douban.com/rexxar/api/v2/personage/${id}`, referer)
  if (personage) {
    const celebrityId = asText(personage.celebrity_id)
    const authorId = asText(personage.author_id)
    // 有 author_id 时按作者取书（豆瓣 creations?type=writer），照片 / 获奖从 celebrity 档案补
    if (authorId) {
      const asAuthor = await fetchAuthorPerson(authorId, null, id, celebrityId || null)
      if (asAuthor.ok) return asAuthor
    }
    if (celebrityId) return fetchCelebrityPerson(celebrityId, id)
  }

  // 传进来的已经是内部 id（图书作者条目里的 id 就是 author id）
  const author = await getJson(`https://m.douban.com/rexxar/api/v2/author/${id}`, referer)
  if (asText(author?.name) || asText(author?.title)) return fetchAuthorPerson(id, author)
  const celebrity = await getJson(`https://m.douban.com/rexxar/api/v2/celebrity/${id}`, referer)
  if (asText(celebrity?.title) || asText(celebrity?.name)) {
    return fetchCelebrityPerson(id, null, celebrity)
  }
  return { ok: false, error: '人物详情暂时不可用，请稍后重试' }
}

/* ---------------- 演职员表「查看全部」（豆瓣 celebrities 页） ---------------- */

let creditsQueue: Promise<unknown> = Promise.resolve()

interface RawCelebrityRow {
  id?: string
  name?: string
  role?: string
  avatar?: string
  department?: string
}

const CREDITS_SCRIPT = `(() => {
  const items = Array.from(document.querySelectorAll('#celebrities li.celebrity'))
  if (!items.length) return []
  return items.map((li) => {
    const link = li.querySelector('.info span.name a.name') || li.querySelector('.info span.name a')
    const href = link ? (link.getAttribute('href') || '') : ''
    const idMatch = href.match(/personage\\/(\\d+)/)
    const avatarEl = li.querySelector('.avatar')
    let avatar = ''
    if (avatarEl) {
      const bg = getComputedStyle(avatarEl).backgroundImage || ''
      const m = bg.match(/url\\(["']?(.*?)["']?\\)/)
      if (m) avatar = m[1]
    }
    const deptEl = li.closest('.list-wrapper')
    const h2 = deptEl ? deptEl.querySelector('h2') : null
    return {
      id: idMatch ? idMatch[1] : '',
      name: link ? link.textContent.trim() : '',
      role: (li.querySelector('.info span.role') || {}).textContent || '',
      avatar,
      department: h2 ? h2.textContent.trim() : ''
    }
  }).filter((x) => !!x.name)
})()`

/** 角色文本精简：「演员 Actor (饰 某人)」→「演员」，「动作特技 - 替身」→「动作特技」 */
function cleanCreditRole(raw: string): string {
  return normalizeSpace(raw)
    .replace(/\s*\(.*\)\s*$/, '')
    .replace(/\s*-\s*.*$/, '')
    .replace(/\s+[A-Za-z][A-Za-z\s&/]*$/, '')
    .trim()
}

/** 姓名精简：「查德·斯塔赫斯基 Chad Stahelski」→「查德·斯塔赫斯基」，纯英文名保持完整 */
function cleanCreditName(raw: string): string {
  const text = normalizeSpace(raw)
  const match = text.match(/^([\u3400-\u9fff·•\-.\s]+)\s+([A-Za-z].*)$/)
  return match ? match[1].trim() : text
}

/** 用隐藏窗口打开豆瓣演职员页（会先过 sec.douban.com 的 JS 校验），再读取整页名单 */
async function loadCelebritiesPage(subjectId: string): Promise<SubjectCredit[]> {
  const run = async (): Promise<SubjectCredit[]> => {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      skipTaskbar: true,
      webPreferences: {
        partition: 'persist:douban',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    try {
      await win.loadURL(`https://movie.douban.com/subject/${subjectId}/celebrities`)
      const deadline = Date.now() + 25_000
      while (Date.now() < deadline) {
        const rows = (await win.webContents
          .executeJavaScript(CREDITS_SCRIPT, true)
          .catch(() => [])) as RawCelebrityRow[]
        if (Array.isArray(rows) && rows.length) {
          const seen = new Set<string>()
          const credits: SubjectCredit[] = []
          for (const row of rows) {
            const name = cleanCreditName(String(row.name ?? ''))
            if (!name) continue
            const role = cleanCreditRole(String(row.role ?? ''))
            const department = cleanCreditRole(String(row.department ?? ''))
            const key = `${row.id ?? ''}|${name}|${role}`
            if (seen.has(key)) continue
            seen.add(key)
            credits.push({
              id: /^\d+$/.test(String(row.id ?? '')) ? String(row.id) : null,
              name,
              role: role || department || '职员',
              avatar: String(row.avatar ?? '') || null,
              department: department || role || '职员'
            })
          }
          if (credits.length) return credits
        }
        await delay(800)
      }
      return []
    } finally {
      if (!win.isDestroyed()) win.destroy()
    }
  }
  // 同时点多个「查看全部」时排队执行，避免开多个隐藏窗口
  const task = creditsQueue.then(run, run)
  creditsQueue = task.catch(() => undefined)
  return task
}

/** 演职员表查看全部：只有影视条目有，失败时前端回退到接口返回的主要演职员 */
export async function fetchSubjectCredits(
  kind: SubjectKind,
  id: string
): Promise<SubjectCreditsResponse> {
  if (kind !== 'movie' && kind !== 'tv') {
    return { ok: false, credits: [], error: '该条目没有演职员表' }
  }
  if (!/^\d+$/.test(id)) return { ok: false, credits: [], error: '条目编号无效' }
  try {
    const credits = await loadCelebritiesPage(id)
    if (credits.length) return { ok: true, credits }
    return { ok: false, credits: [], error: '演职员表暂时取不到，请稍后重试' }
  } catch {
    return { ok: false, credits: [], error: '演职员表暂时取不到，请稍后重试' }
  }
}
