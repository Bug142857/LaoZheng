import type { MagnetEncodeType, MagnetSource } from '../src/shared/magnet'

/**
 * 磁力资源库解析（移植自 BTSOU_Plus 的 ParseResults / ApiMapping 口径）。
 * 这里只做纯文本 → 结构化结果，不发请求，方便单独验证。
 */

export interface ParsedMagnetItem {
  title: string
  magnet: string
  hash: string
  size: string
  time: string
  detailUrl: string
}

export interface ParsedMagnetPage {
  items: ParsedMagnetItem[]
  hasNext: boolean
  error?: string
}

const EXCLUDED_TITLES = new Set([
  'XXX',
  'Video',
  'Hentai',
  'Pictures',
  'Doujinshi',
  'Games',
  'Lossless',
  'Audio'
])

/** 列表里的导航 / 排序按钮，没有磁力时直接跳过 */
const UI_TITLES = new Set([
  '相关度',
  '瀏覽',
  '浏览',
  'limetorrents',
  '首页',
  '主页',
  '更多',
  '下一页',
  '上一页',
  '尾页',
  '排序',
  '时间',
  '大小',
  '最新',
  '热门',
  '搜索',
  '全部',
  '分类',
  '登录',
  '注册',
  'home',
  'browse',
  'show unsafe',
  'show unsafe resources',
  'show dead',
  '顯示不安全的資源',
  '显示不安全的资源'
])

const NAVIGATION_PATHS = new Set([
  '/',
  '.',
  './',
  '/login',
  '/register',
  '/logout',
  '/signup',
  '/language/',
  '/theme-mode/',
  '/publish-url',
  '/search',
  '/trending/',
  '/top-100/',
  '/movie-library/',
  '/cat/',
  '/dmca',
  '/contact',
  '/about',
  '/rss',
  '/feed',
  '/sitemap'
])

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  raquo: '»',
  laquo: '«',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  middot: '·',
  times: '×',
  copy: '©'
}

const DOMAIN_SOURCE =
  '\\b[a-zA-Z0-9][a-zA-Z0-9.-]*\\.(com|net|org|cn|tv|cc|xyz|top|club|site|vip|wang|ren|shop|online|tech|live|video|fun|art|space|host|cloud|app|dev|io|me|co|uk|de|jp|fr|ru|au|ca|in|id|ph|sg|hk|tw|kr|nl|se|no|fi|dk|pl|it|es|pt|br|mx|ar|cl|nz|za|ng|eg|sa|ae|tr|il|my|th|vn)\\b'
const DOMAIN_PATTERN = new RegExp(DOMAIN_SOURCE, 'gi')

const BRACKET_PAIRS: [string, string][] = [
  ['\\(', '\\)'],
  ['\\[', '\\]'],
  ['\\{', '\\}'],
  ['<', '>'],
  ['（', '）'],
  ['【', '】'],
  ['《', '》']
]

export function decodeHtml(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, code: string) => {
    if (code.startsWith('#')) {
      const hex = code[1]?.toLowerCase() === 'x'
      const value = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(value) ? String.fromCodePoint(value) : all
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? all
  })
}

export function stripTags(input: string): string {
  return decodeHtml(input.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

export function encodeKeyword(keyword: string, type: MagnetEncodeType): string {
  if (type === 'Raw') return keyword
  if (type === 'Base64UrlSafe') {
    return Buffer.from(keyword, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }
  if (type === 'Hex') return Buffer.from(keyword, 'utf8').toString('hex')
  return encodeURIComponent(keyword)
}

export function buildSearchUrl(source: MagnetSource, keyword: string, page: number): string {
  const encoded = encodeKeyword(keyword, source.encodeType)
  return source.searchUrl.replace(/\{keyword\}/g, encoded).replace(/\{page\}/g, String(page))
}

export function isNavigationalLink(href: string): boolean {
  if (!href) return true
  if (href === '#' || href.startsWith('#') || href.startsWith('javascript:')) return true
  if (href.startsWith('mailto:')) return true
  return NAVIGATION_PATHS.has(href)
}

function resolveUrl(href: string, baseUrl: string): string {
  try {
    if (href.startsWith('//')) return `https:${href}`
    return new URL(href, baseUrl).toString()
  } catch {
    return href
  }
}

const NAV_DETAIL_PATTERN =
  /(^|\/)(publish-url|tool|tools|instructions|language|login|register|signup|logout|about|contact|dmca|privacy|terms|desktop\.php|magnet-player)(\/|$|\.)/i

/** 过滤导航、排序、分页链接，避免把它们当详情页去抓磁链 */
function isLikelyDetailUrl(href: string, baseUrl: string): boolean {
  try {
    const url = new URL(href)
    if (!/^https?:$/.test(url.protocol)) return false
    const path = url.pathname.toLowerCase()
    if (path === '/' || path === '') return false
    if (NAV_DETAIL_PATTERN.test(path)) return false
    if (/active|rele/i.test(path)) return false
    if (url.searchParams.has('sort') || url.searchParams.has('next')) return false
    if (url.searchParams.has('p') || url.searchParams.has('page')) {
      const page = Number(url.searchParams.get('p') ?? url.searchParams.get('page') ?? 0)
      if (page > 1) return false
    }
    const base = new URL(baseUrl)
    if (url.origin === base.origin && url.pathname === base.pathname) return false
    return true
  } catch {
    return false
  }
}

function hashFromChunk(chunk: string): string {
  const magnet = chunk.match(/magnet:\?xt=urn:btih:([a-zA-Z0-9]+)/i)
  if (magnet) return magnet[1]
  for (const match of chunk.matchAll(/[a-fA-F0-9]{40}/g)) {
    const index = match.index ?? 0
    const before = index > 0 ? chunk[index - 1] : ''
    const after = index + 40 < chunk.length ? chunk[index + 40] : ''
    if ((before === ':' || before === '/') && (after === '&' || after === '"' || after === "'" || after === '.' || after === '>' || after === '')) {
      return match[0]
    }
  }
  return ''
}

function extractSize(chunk: string): string {
  const named = chunk.match(
    /(?:大小|文档大小|文件大小|length|size)\s*[:：]\s*(?:<[^>]+>)?([\d.,]+\s*(?:TB|T|GB|G|MB|M|KB|K))/i
  )
  if (named) return named[1].replace(/,/g, '').replace(/\s+/g, ' ').trim()
  const td = chunk.match(/<td[^>]*>\s*([\d.,]+)\s*(GB|MB|KB|TB)\s*<\/td>/i)
  if (td) return `${td[1].replace(/,/g, '')} ${td[2].toUpperCase()}`
  const center = chunk.match(/<td\s+class="text-center">([\d,]+(?:\.\d+)?)\s*(GB|MB|KB|TB)<\/td>/i)
  if (center) return `${center[1].replace(/,/g, '')} ${center[2].toUpperCase()}`
  return ''
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function relativeDate(value: string): string {
  const text = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  if (/^(刚刚|刚才)$/.test(text)) return formatDate(new Date())
  const match = text.match(/(\d+)\s*(秒钟?|分钟|分鐘|小时|小時|天|日|星期|周|礼拜|月|年)前/)
  if (!match) {
    const english = text.match(/(\d+)\s*(year|month|week|day|hour|minute|min|second|sec)s?\s*ago/i)
    if (english) {
      const amount = Number(english[1])
      const unit = english[2].toLowerCase()
      const date = new Date()
      if (unit === 'year') date.setFullYear(date.getFullYear() - amount)
      else if (unit === 'month') date.setMonth(date.getMonth() - amount)
      else if (unit === 'week') date.setDate(date.getDate() - amount * 7)
      else if (unit === 'day') date.setDate(date.getDate() - amount)
      else if (unit === 'hour') date.setHours(date.getHours() - amount)
      else if (unit === 'minute' || unit === 'min') date.setMinutes(date.getMinutes() - amount)
      else date.setSeconds(date.getSeconds() - amount)
      return formatDate(date)
    }
    return ''
  }
  const amount = Number(match[1])
  const unit = match[2]
  const date = new Date()
  if (unit.includes('年')) date.setFullYear(date.getFullYear() - amount)
  else if (unit.includes('月')) date.setMonth(date.getMonth() - amount)
  else if (unit.includes('星期') || unit.includes('周') || unit.includes('礼拜')) {
    date.setDate(date.getDate() - amount * 7)
  } else if (unit.includes('天') || unit.includes('日')) date.setDate(date.getDate() - amount)
  else if (unit.includes('小时') || unit.includes('小時')) date.setHours(date.getHours() - amount)
  else if (unit.includes('分钟') || unit.includes('分鐘')) date.setMinutes(date.getMinutes() - amount)
  else date.setSeconds(date.getSeconds() - amount)
  return formatDate(date)
}

function englishDate(value: string): string {
  const text = value.trim()
  const match = text.match(/([A-Za-z]+)\.?\s*(\d{1,2})(?:st|nd|rd|th)?\s*'?(\d{2,4})/)
  if (match) {
    const month = MONTHS[match[1].toLowerCase()]
    const day = Number(match[2])
    let year = Number(match[3])
    if (year < 100) year += 2000
    if (month && day >= 1 && day <= 31) return `${year}-${pad2(month)}-${pad2(day)}`
  }
  return ''
}

function extractTime(chunk: string): string {
  const named = chunk.match(
    /(?:添加时间|添加時間|收录时间|收錄時間|创建时间|創建時間|时间|date|发布日期)\s*[:：]\s*(?:<[^>]+>)?((?:\d+)\s*(?:个月前|月前|年前|星期前|周前|礼拜前|天前|日前|小时前|小時前|分钟前|分鐘前|秒前|刚刚|刚才|\d{4}-\d{2}-\d{2}))/i
  )
  if (named) return relativeDate(named[1])

  const english = chunk.match(/(\d+)\s*(year|month|week|day|hour|minute|min|second|sec)s?\s*ago/i)
  if (english) return relativeDate(english[0])
  if (/\b(just\s*now|moments?\s*ago|a\s*moment\s*ago)\b/i.test(chunk)) return formatDate(new Date())

  const coll = chunk.match(/<td[^>]*class="[^"]*coll-date[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/td>/i)
  if (coll) {
    const parsed = englishDate(stripTags(coll[1]))
    if (parsed) return parsed
  }
  const englishShort = chunk.match(/([A-Za-z]{3}\.\s*\d{1,2}(?:st|nd|rd|th)?\s*'\d{2})/)
  if (englishShort) {
    const parsed = englishDate(englishShort[1])
    if (parsed) return parsed
  }
  const ymd = chunk.match(/(\d{4}-\d{2}-\d{2})/)
  if (ymd) return ymd[1]
  return ''
}

export function parseHtmlPage(
  html: string,
  source: MagnetSource,
  baseUrl: string,
  page = 1
): ParsedMagnetPage {
  if (!source.separator) return { items: [], hasNext: false, error: '资源库缺少列表分割符' }
  const chunks = html.split(source.separator)
  const items: ParsedMagnetItem[] = []

  for (const rawChunk of chunks) {
    const chunk = rawChunk.trim()
    if (!chunk || chunk === '</tr>') continue

    const linkPattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
    let picked: { href: string; text: string; tag: string; score: number } | null = null
    for (const match of chunk.matchAll(linkPattern)) {
      const href = decodeHtml(match[1]?.trim() ?? '')
      const text = stripTags(match[2] ?? '')
      if (!text || EXCLUDED_TITLES.has(text) || isNavigationalLink(href)) continue
      const titleAttr = match[0].match(/\btitle\s*=\s*["']([^"']*)["']/i)?.[1]?.trim() ?? ''
      const score = text.length + (titleAttr ? 20 : 0)
      if (!picked || score > picked.score) {
        picked = { href, text, tag: match[0], score }
      }
    }
    if (!picked) continue

    const titleAttr = picked.tag.match(/\btitle\s*=\s*["']([^"']*)["']/i)?.[1]?.trim() ?? ''
    const title = stripTags(source.name === 'U3C3' ? picked.text : titleAttr || picked.text)
    const rawDetailUrl =
      picked.href && !picked.href.startsWith('magnet:')
        ? resolveUrl(picked.href, baseUrl)
        : ''
    const detailUrl =
      rawDetailUrl && isLikelyDetailUrl(rawDetailUrl, baseUrl) ? rawDetailUrl : ''
    const hash = hashFromChunk(chunk)
    const fullMagnet = decodeHtml(chunk.match(/magnet:\?[^"'\s<>]+/i)?.[0] ?? '')
    const magnet = fullMagnet || (hash ? `magnet:?xt=urn:btih:${hash}` : '')
    const size = extractSize(chunk)
    const time = extractTime(chunk)

    if (!magnet && UI_TITLES.has(title.toLowerCase())) continue
    if (!magnet && !detailUrl) continue

    if (title || magnet || detailUrl) {
      items.push({
        title,
        magnet,
        hash,
        size,
        time,
        detailUrl
      })
    }
  }

  const indicator = source.nextPageIndicator.trim()
  let hasNext = false
  if (indicator && indicator !== '只有一页') {
    const decoded = decodeHtml(indicator)
    hasNext = html.includes(indicator) || html.includes(decoded)
    if (!hasNext) {
      const next = page + 1
      hasNext = [`page=${next}`, `p=${next}`, `/${next}/`, `-${next}.html`].some((token) =>
        html.includes(token)
      )
    }
  }
  return { items, hasNext }
}

function getPath(value: unknown, path: string): unknown {
  if (!path) return value
  let current = value
  for (const key of path.split('.')) {
    if (!key) continue
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function asString(value: unknown): string {
  return value == null ? '' : String(value)
}

function apiSizeValue(value: unknown): { size: string; sizeBytes: number } {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { size: formatSize(value), sizeBytes: value }
  }
  const text = asString(value).trim()
  if (!text) return { size: '', sizeBytes: 0 }
  if (/^\d+$/.test(text)) {
    const bytes = Number(text)
    return { size: formatSize(bytes), sizeBytes: bytes }
  }
  return { size: text, sizeBytes: parseSizeToBytes(text) }
}

function apiDate(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000
    return formatDate(new Date(ms))
  }
  const text = asString(value).trim()
  if (!text) return ''
  if (/^\d{10,13}$/.test(text)) {
    const n = Number(text)
    return formatDate(new Date(n > 1e12 ? n : n * 1000))
  }
  const ymd = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (ymd) return `${ymd[1]}-${pad2(Number(ymd[2]))}-${pad2(Number(ymd[3]))}`
  return ''
}

export function parseApiPage(
  body: string,
  source: MagnetSource,
  page: number
): ParsedMagnetPage {
  const mapping = source.api
  if (!mapping) return { items: [], hasNext: false, error: '资源库缺少 API 映射' }

  let root: unknown
  try {
    root = JSON.parse(body) as unknown
  } catch {
    return { items: [], hasNext: false, error: 'API 返回的不是有效 JSON' }
  }

  const code = asString(getPath(root, mapping.codeField))
  if (mapping.successValue && code !== mapping.successValue) {
    return { items: [], hasNext: false, error: `API 返回状态码 ${code || '—'}` }
  }

  const list = getPath(root, mapping.listPath)
  if (!Array.isArray(list)) {
    return { items: [], hasNext: false, error: `API 未找到列表 ${mapping.listPath}` }
  }

  const items: ParsedMagnetItem[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const title = stripTags(asString(record[mapping.titleField]))
    const hash = asString(record[mapping.hashField]).trim()
    const sizeValue = apiSizeValue(record[mapping.sizeField])
    const time = apiDate(record[mapping.dateField])
    const id = asString(record[mapping.idField]).trim()
    const detailUrl =
      mapping.detailUrlTemplate && id
        ? mapping.detailUrlTemplate.replace(/\{id\}/g, encodeURIComponent(id))
        : ''
    if (!title && !hash && !detailUrl) continue
    items.push({
      title,
      magnet: hash ? `magnet:?xt=urn:btih:${hash}` : '',
      hash,
      size: sizeValue.size,
      time,
      detailUrl
    })
  }

  const total = Number(getPath(root, mapping.totalField)) || 0
  const pageSize = mapping.pageSize > 0 ? mapping.pageSize : 20
  const hasNext = total > 0 ? page * pageSize < total : list.length >= pageSize
  return { items, hasNext }
}

export function parseDetailMeta(html: string): { size: string; time: string } {
  return { size: extractSize(html), time: extractTime(html) }
}

export function extractMagnetFromHtml(html: string): string {
  const input = html.replace(/<!--[\s\S]*?-->/g, '')
  const patterns = [
    /<input[^>]*id="(?:input-magnet|magnet|m_link)"[^>]*value="([^"]+)"/i,
    /<a[^>]*href="(magnet:[^"]+)"/i,
    /(magnet:\?xt=urn:btih:[a-zA-Z0-9]+)/i,
    /\bHash\s*值?\s*[:：]\s*([A-Fa-f0-9]{40})/i
  ]
  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (!match) continue
    const value = decodeHtml(match[1]?.trim() ?? '')
    if (!value) continue
    if (value.startsWith('magnet:')) return value
    return `magnet:?xt=urn:btih:${value}`
  }
  return ''
}

export function magnetHash(magnet: string): string {
  return magnet.match(/btih:([a-zA-Z0-9]{32,40})/i)?.[1]?.toUpperCase() ?? ''
}

export function parseSizeToBytes(size: string): number {
  const text = size.trim().replace(/,/g, '')
  if (!text) return 0
  if (/^\d+$/.test(text)) return Number(text)
  const match = text.match(/([\d.]+)\s*(TB|T|GB|G|MB|M|KB|K|B)/i)
  if (!match) return 0
  const value = Number(match[1])
  if (!Number.isFinite(value)) return 0
  const unit = match[2].toUpperCase()
  const multiplier =
    unit === 'TB' || unit === 'T'
      ? 1024 ** 4
      : unit === 'GB' || unit === 'G'
        ? 1024 ** 3
        : unit === 'MB' || unit === 'M'
          ? 1024 ** 2
          : unit === 'KB' || unit === 'K'
            ? 1024
            : 1
  return Math.round(value * multiplier)
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[index]}`
}

export function parseDateToMs(date: string): number {
  const text = date.trim()
  if (!text) return 0
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return Date.parse(`${text}T00:00:00`)
  const time = Date.parse(text)
  return Number.isFinite(time) ? time : 0
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function cleanupTitle(title: string, adWords: string[]): string {
  let input = stripTags(title)
  if (!input) return ''

  for (const [open, close] of BRACKET_PAIRS) {
    const pattern = new RegExp(`${open}(.*?)${close}`, 'gi')
    let replaced = false
    do {
      replaced = false
      input = input.replace(pattern, (whole, inner: string) => {
        if (!inner.trim() || new RegExp(DOMAIN_SOURCE, 'i').test(inner)) {
          replaced = true
          return ''
        }
        return whole
      })
    } while (replaced)
  }

  input = input.replace(DOMAIN_PATTERN, '')
  for (const word of adWords) {
    if (!word) continue
    input = input.replace(new RegExp(escapeRegExp(word), 'gi'), '')
  }
  return input.replace(/\s+/g, ' ').trim()
}

export function hasAnyWord(title: string, words: string[]): boolean {
  if (!title || words.length === 0) return false
  const lower = title.toLowerCase()
  return words.some((word) => word && lower.includes(word.toLowerCase()))
}
