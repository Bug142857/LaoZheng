import { parse } from 'node-html-parser'
import iconv from 'iconv-lite'
import { session } from 'electron'
import { fetchRenderedHtml } from './browserPage'
import {
  normalizeNovelStatus,
  type NovelChapter,
  type NovelChapterResponse,
  type NovelDetail,
  type NovelDetailResponse,
  type NovelDownloadInput,
  type NovelDownloadProgress,
  type NovelDownloadResult,
  type NovelItem,
  type NovelListResponse,
  type NovelSourceInput,
  type NovelSourceTemplate,
  type NovelTestResult
} from '../src/shared/novel'
import { saveNovelFile } from './downloads'

/**
 * 小说书源解析（笔趣阁系模板）：
 * - bqg70：POST /search.html，书籍 /book/{id}/，目录 /book/{id}/index_N.html，正文 base64
 * - bqg52：POST /search.html，书籍 /book_{id}/，目录 /book_{id}/index_N.html，正文 base64
 * - biqugeco：POST /search/，书籍 /read/{id}.html，目录 /booklist/{id}/N/，正文 HTML
 * - mayi：GET /modules/article/search.php，书籍 /{id}/，目录在书籍页，正文 HTML
 *
 * 所有请求都在主进程完成，渲染进程只拿结构化结果。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const TIMEOUT_MS = 20_000
const MAX_CATALOG_PAGES = 30
const MAX_CHAPTER_PAGES = 8

interface Page {
  html: string
  finalUrl: string
}

function baseOf(source: NovelSourceInput): string {
  return source.baseUrl.trim().replace(/\/+$/, '')
}

/** 部分老站（奇书小说）搜索只认 GBK 编码的表单值 */
function gbkUrlEncode(value: string): string {
  return [...iconv.encode(value, 'gbk')]
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
    .join('')
}

/**
 * 站点可能 301 到新域名（例如 biquges.com → mayiwsk.info）。
 * fetch 跟随 301 时会把 POST 改成 GET 并丢掉搜索参数，所以先记住落地域名，
 * 后续搜索 / 详情 / 正文都直接请求真实域名。
 */
const canonicalBases = new Map<string, string>()

function rememberBase(base: string, finalUrl: string): string {
  try {
    const origin = new URL(finalUrl).origin
    if (/^https?:\/\//i.test(origin)) {
      canonicalBases.set(base, origin)
      return origin
    }
  } catch {
    // 非法 URL 用原地址
  }
  return base
}

async function canonicalBase(source: NovelSourceInput): Promise<string> {
  const base = baseOf(source)
  const cached = canonicalBases.get(base)
  if (cached) return cached
  try {
    const page = await requestPage(`${base}/`)
    return rememberBase(base, page.finalUrl)
  } catch {
    return base
  }
}

function errorText(err: unknown): string {
  return (err as Error).message || '加载失败'
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeEntities(value: string): string {
  const map: Record<string, string> = {
    quot: '"',
    apos: "'",
    amp: '&',
    lt: '<',
    gt: '>',
    nbsp: ' '
  }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
    if (key[0] !== '#') return map[key.toLowerCase()] ?? entity
    const code =
      key[1].toLowerCase() === 'x' ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  })
}

/** 部分笔趣阁镜像的 meta 写 gbk，实际返回 UTF-8：按可疑字符数挑最优解码 */
function decodeBuffer(buffer: Buffer, contentType: string): string {
  const headerCharset = /charset=([\w-]+)/i.exec(contentType)?.[1]
  const head = buffer.subarray(0, 4096).toString('latin1')
  const metaCharset = /charset=["']?([\w-]+)/i.exec(head)?.[1]
  const candidates = [headerCharset, metaCharset, 'utf-8', 'gbk'].filter(
    (value): value is string => !!value
  )
  let best = ''
  let bestScore = Number.POSITIVE_INFINITY
  for (const charset of candidates) {
    let text = ''
    try {
      text = new TextDecoder(charset.toLowerCase()).decode(buffer)
    } catch {
      continue
    }
    const score = textBadness(text)
    if (score < bestScore) {
      best = text
      bestScore = score
    }
    if (score === 0) break
  }
  return best || buffer.toString('utf8')
}

function textBadness(text: string): number {
  let score = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '\uFFFD') score += 10
    else if (ch >= '\u0080' && ch <= '\u009f') score += 2
  }
  if (/锟斤拷|鏂囩珷|å¤|ç«|é—|è¯/.test(text)) score += 40
  return score
}

async function requestPage(url: string, init: RequestInit = {}): Promise<Page> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      ...(init.headers as Record<string, string> | undefined)
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  return {
    html: decodeBuffer(buffer, res.headers.get('content-type') || ''),
    finalUrl: res.url
  }
}

function tagAttr(tag: string, name: string): string {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return match ? decodeEntities(match[1] ?? match[2] ?? '') : ''
}

function metaMap(html: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (tagAttr(tag, 'property') || tagAttr(tag, 'name')).toLowerCase()
    const content = tagAttr(tag, 'content')
    if (key && content && !(key in map)) map[key] = content
  }
  return map
}

function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const JUNK_LINE_PATTERNS = [
  /^最新网址[:：]/,
  /^随机推荐[:：]/,
  /^请记住本书首发域名/,
  /^手机版阅读网址/,
  /^本章未完/,
  /^章节错误/,
  /^加入书签$/,
  /^投推荐票$/,
  /^章节目录$/,
  /^保存书签$/,
  /^上一章$/,
  /^下一章$/,
  /^目录$/,
  /^笔趣阁$/,
  /^第?\d+页$/,
  /^（第\d+页）$/,
  /^\(第\d+页\)$/,
  /^www\./i,
  /^https?:\/\//i,
  /^(?:新?笔趣阁).*(?:www\.|\.com|\.info|\.cc|\.xyz)/i
]

function isJunkLine(line: string): boolean {
  return JUNK_LINE_PATTERNS.some((pattern) => pattern.test(line))
}

function htmlToText(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|dd|dt|li|h[1-6]|tr)>/gi, '\n')
  return decodeEntities(cleaned.replace(/<[^>]+>/g, ''))
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter((line) => !!line && !isJunkLine(line))
    .join('\n')
}

/** 取某个容器内的 HTML；顺手去掉脚本 / 样式 / 站点提示块 */
function sectionOf(html: string, selector: string): string {
  try {
    const root = parse(html)
    const element = root.querySelector(selector)
    if (!element) return ''
    element.querySelectorAll('script, style, #center_tip').forEach((node) => node.remove())
    return element.innerHTML
  } catch {
    return ''
  }
}

function absoluteUrl(base: string, href: string): string {
  const value = href.trim()
  if (!value) return ''
  try {
    const url = new URL(value, base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
}

function coverOf(html: string, metas: Record<string, string>, base: string): string {
  let cover = metas['og:image'] || metas['twitter:image'] || ''
  if (!cover) {
    const match = /id=["']fmimg["'][\s\S]{0,600}?<img[^>]+src=["']([^"']+)/i.exec(html)
    if (match) cover = match[1]
  }
  return absoluteUrl(base, cover)
}

function cleanIntro(text: string, template: NovelSourceTemplate): string {
  let value = text
    .replace(/^\s*(?:简介|内容简介|作品简介|小说简介)\s*[:：]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const cuts =
    template === 'bqg70'
      ? ['三秒记住本站', '请记住本书首发域名', '手机版阅读网址']
      : template === 'mayi'
        ? ['最新网址', '请记住本站']
        : ['作者：', '无弹窗免费全文阅读', '无弹窗推荐地址']
  for (const cut of cuts) {
    const index = value.indexOf(cut)
    if (index > 8) value = value.slice(0, index).trim()
  }
  return value.replace(/[，,、；;\s]+$/, '')
}

function introOf(
  html: string,
  metas: Record<string, string>,
  template: NovelSourceTemplate
): string {
  let raw = ''
  if (template === 'bqg52' || template === 'biqugeco') {
    raw = metas['og:description'] || metas['description'] || ''
  }
  if (!raw) {
    const match = /<div[^>]+id=["']intro["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)
    if (match) raw = htmlToText(match[1])
  }
  if (!raw) raw = htmlToText(metas['og:description'] || metas['description'] || '')
  return cleanIntro(raw, template)
}

/** 不用正则：神书网几千章的页面里正则会在 Electron 主进程触发栈溢出 */
function chapterNumber(name: string): number | null {
  const value = name.trim()
  let index = value.startsWith('第') ? 1 : 0
  while (index < value.length && (value[index] === ' ' || value[index] === '\u3000')) index += 1
  let digits = ''
  while (index < value.length && value[index] >= '0' && value[index] <= '9') {
    digits += value[index]
    index += 1
  }
  if (!digits) return null
  while (index < value.length && (value[index] === ' ' || value[index] === '\u3000')) index += 1
  const unit = value[index]
  if (unit !== '章' && unit !== '节' && unit !== '回' && index < value.length) return null
  const number = Number(digits)
  return Number.isFinite(number) ? number : null
}

/** 去重、按章节号排序；章节名里没有阿拉伯数字时保持站点顺序 */
function finalizeChapters(list: NovelChapter[]): NovelChapter[] {
  const seen = new Set<string>()
  const seenNames = new Set<string>()
  const unique: NovelChapter[] = []
  for (const chapter of list) {
    if (!chapter.id || !chapter.name || seen.has(chapter.id)) continue
    if (seenNames.has(chapter.name)) continue
    seen.add(chapter.id)
    seenNames.add(chapter.name)
    unique.push(chapter)
  }
  let numbered = 0
  const filtered: NovelChapter[] = []
  for (const chapter of unique) {
    if (chapterNumber(chapter.name) != null) {
      numbered += 1
      filtered.push(chapter)
    }
  }
  if (unique.length > 1 && numbered >= unique.length * 0.8) {
    // 卷名 / 上架通知等没有「第 N 章」前缀的条目直接丢掉，避免排到最前面
    const sorted = filtered.sort(
      (a, b) => (chapterNumber(a.name) ?? 0) - (chapterNumber(b.name) ?? 0)
    )
    return sorted.map((chapter, index) => ({ ...chapter, index: index + 1 }))
  }
  return unique.map((chapter, index) => ({ ...chapter, index: index + 1 }))
}

const CHAPTER_NAV_NAMES =
  /^(?:正文|立即阅读|开始阅读|继续阅读|上一页|下一页|上一章|下一章|加入书架|推荐本书|返回|首页|目录|章节目录|最新章节|查看全部|更多章节|手机阅读|电脑阅读)$/

function parseChapterAnchors(
  html: string,
  matchHref: (href: string) => string | null
): NovelChapter[] {
  const out: NovelChapter[] = []
  for (const match of html.matchAll(
    /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{1,240}?)<\/a>/gi
  )) {
    const id = matchHref(decodeEntities(match[1]))
    if (!id) continue
    const name = plainText(match[2])
    if (!name || name.length > 80 || CHAPTER_NAV_NAMES.test(name)) continue
    out.push({ id, name, index: 0 })
  }
  return finalizeChapters(out)
}

function bookLinkPattern(template: NovelSourceTemplate): RegExp {
  switch (template) {
    case 'bqg70':
      return /<a[^>]+href=["']([^"']*\/book\/(\d+)\/)["'][^>]*>([\s\S]{1,120}?)<\/a>/gi
    case 'bqg52':
      return /<a[^>]+href=["']([^"']*\/book_(\d+)\/)["'][^>]*>([\s\S]{1,120}?)<\/a>/gi
    case 'biqugeco':
      return /<a[^>]+href=["']([^"']*\/read\/(\d+)\.html)["'][^>]*>([\s\S]{1,120}?)<\/a>/gi
    case 'mayi':
      return /<a[^>]+href=["']([^"']*\/(\d+_\d+)\/(?:index\.html)?)["'][^>]*>([\s\S]{1,120}?)<\/a>/gi
    case '95dushu':
      return /<a[^>]+href=["']([^"']*\/bookbook\/(\d+)\.html)["'][^>]*>([\s\S]{1,120}?)<\/a>/gi
    case 'xuanhuange':
      return /<a[^>]+href=["']([^"']*\/files\/article\/html\/(?:\d+)\/(\d+)\/)["'][^>]*>([\s\S]{1,120}?)<\/a>/gi
    case 'qishu5wa':
    case 'xyuzhaiwu':
    case 'xhytd':
    case 'ajnnan':
    case 'bqquge':
    case 'zuizhong':
    case 'banshanren':
    case 'shenpinwu':
      // 这些模板使用各自的解析函数，不走通用书名链接匹配
      return /(?!)<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{1,120}?)<\/a>/gi
  }
}

function parseBookItems(
  html: string,
  template: NovelSourceTemplate,
  limit: number
): NovelItem[] {
  const items: NovelItem[] = []
  const seen = new Set<string>()
  for (const match of html.matchAll(bookLinkPattern(template))) {
    const bookId = match[2]
    const title = plainText(match[3])
    if (!bookId || !title || title.length > 80 || seen.has(bookId)) continue
    seen.add(bookId)
    items.push({ bookId, title, author: '', cover: '' })
    if (items.length >= limit) break
  }
  return items
}

/** 蚂蚁文学的书籍编号形如 142_142238（目录 /142_142238/ 或 /142_142238/index.html） */
function mayiBookId(link: string): string | null {
  const path = link.split('#')[0].split('?')[0]
  const match = /\/(\d+_\d+)\/(?:index\.html)?$/.exec(path)
  return match ? match[1] : null
}

/** 蚂蚁文学的封面地址可以从书籍编号直接拼出来（缺失时站点会返回 404，由前端兜底） */
function mayiCover(base: string, bookId: string): string {
  const parts = bookId.split('_')
  if (parts.length !== 2) return ''
  return `${base}/files/article/image/${parts[0]}/${parts[1]}/${parts[1]}s.jpg`
}

interface MayiMeta {
  bookId: string
  title: string
  author: string
  cover: string
}

/** 从首页 / 分类页收集书籍信息：封面、作者、书名（同一本书只保留信息最全的一条） */
function collectMayiMeta(html: string, base: string): MayiMeta[] {
  const map = new Map<string, MayiMeta>()
  const order: string[] = []
  const add = (bookId: string | null, title: string, author: string, cover: string): void => {
    const name = title.replace(/^《|》$/g, '').replace(/\s+/g, ' ').trim()
    if (!bookId || !name || name.length > 80) return
    const existing = map.get(bookId)
    if (existing) {
      if (!existing.title) existing.title = name
      if (!existing.author && author) existing.author = author
      if (!existing.cover && cover) existing.cover = cover
      return
    }
    map.set(bookId, { bookId, title: name, author, cover })
    order.push(bookId)
  }

  // 带封面的推荐块：<div class="image"><a href="..."><img src="..." alt="书名">
  for (const match of html.matchAll(
    /<div class="image">[\s\S]{0,400}?<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]{0,200}?<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']*)["']/gi
  )) {
    add(mayiBookId(match[1]), match[3], '', absoluteUrl(base, decodeEntities(match[2])))
  }

  // <dt><span>作者</span><a href="...">书名</a></dt>
  for (const match of html.matchAll(
    /<dt>\s*<span>([\s\S]{0,80}?)<\/span>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{1,120}?)<\/a>/gi
  )) {
    add(mayiBookId(match[2]), plainText(match[3]), plainText(match[1]), '')
  }

  // 最近更新 / 经典推荐：书名 + 作者
  for (const match of html.matchAll(
    /<span class="s2">\s*《?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{1,120}?)<\/a>》?\s*<\/span>[\s\S]{0,260}?<span class="s5">([\s\S]{1,80}?)<\/span>/gi
  )) {
    add(mayiBookId(match[1]), plainText(match[2]), plainText(match[3]), '')
  }

  // 分类列表：<li><a href="...">书名</a>/作者</li>
  for (const match of html.matchAll(
    /<li><a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{1,120}?)<\/a>\/([^<]{1,60})<\/li>/gi
  )) {
    add(mayiBookId(match[1]), plainText(match[2]), plainText(match[3]), '')
  }

  // 其余书籍链接兜底（只有书名）
  for (const match of html.matchAll(
    /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{1,120}?)<\/a>/gi
  )) {
    add(mayiBookId(match[1]), plainText(match[2]), '', '')
  }

  return order.map((id) => map.get(id)).filter((item): item is MayiMeta => !!item)
}

function parseMayiHomeItems(html: string, base: string, limit: number): NovelItem[] {
  return collectMayiMeta(html, base)
    .slice(0, limit)
    .map((meta) => ({
      bookId: meta.bookId,
      title: meta.title,
      author: meta.author,
      cover: meta.cover || mayiCover(base, meta.bookId),
      status: ''
    }))
}

/** 蚂蚁文学搜索结果表格：文章名称 / 最新章节 / 作者 / 字数 / 更新 / 状态 */
function parseMayiSearchItems(html: string, base: string): NovelItem[] {
  const items: NovelItem[] = []
  for (const row of html.matchAll(/<tr id="nr">([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1])
    if (cells.length < 3) continue
    const link = /<a[^>]+href=["']([^"']+)["']/i.exec(cells[0])
    const bookId = link ? mayiBookId(link[1]) : null
    const title = plainText(cells[0])
    if (!bookId || !title) continue
    items.push({
      bookId,
      title,
      author: plainText(cells[2] ?? ''),
      cover: mayiCover(base, bookId),
      latestChapter: plainText(cells[1] ?? ''),
      status: normalizeNovelStatus(plainText(cells[5] ?? ''))
    })
  }
  return items
}

/** 蚂蚁文学：按书名再搜一次拿「完结 / 连载」状态（搜索结果表里才有状态列） */
async function fetchMayiStatus(
  base: string,
  title: string,
  bookId: string
): Promise<string> {
  const page = await requestPage(`${base}/modules/article/search.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${base}/`
    },
    body: `searchkey=${encodeURIComponent(title)}`
  })
  for (const row of page.html.matchAll(/<tr id="nr">([\s\S]*?)<\/tr>/gi)) {
    if (!row[1].includes(`/${bookId}/`)) continue
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1])
    return normalizeNovelStatus(plainText(cells[5] ?? ''))
  }
  return ''
}

/** 首页推荐没有状态列：并发按书名补查，失败就留空，不阻塞列表 */
async function enrichMayiStatuses(base: string, items: NovelItem[]): Promise<void> {
  const queue = items.filter((item) => !item.status)
  if (!queue.length) return
  let cursor = 0
  const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= queue.length) return
      const item = queue[index]
      try {
        item.status = await fetchMayiStatus(base, item.title, item.bookId)
      } catch {
        item.status = ''
      }
    }
  })
  await Promise.all(workers)
}

/** 95dushu / 玄幻阁的书籍目录都按 floor(id/1000) 分目录 */
function novelBookDir(bookId: string): string {
  const numeric = Number(bookId)
  return Number.isFinite(numeric) && numeric > 0 ? String(Math.floor(numeric / 1000)) : ''
}

function novelCoverById(base: string, bookId: string): string {
  const dir = novelBookDir(bookId)
  return dir ? `${base}/files/article/image/${dir}/${bookId}/${bookId}s.jpg` : ''
}

function attrValue(element: { getAttribute: (name: string) => string | undefined } | null, name: string): string {
  return element?.getAttribute(name)?.trim() ?? ''
}

/** 只按章节 id 去重，保留站点原有顺序（卷名 / 番外不会被章节号排序打乱） */
function finalizeChaptersById(list: NovelChapter[]): NovelChapter[] {
  const seen = new Set<string>()
  const out: NovelChapter[] = []
  for (const chapter of list) {
    if (!chapter.id || !chapter.name || seen.has(chapter.id)) continue
    seen.add(chapter.id)
    out.push(chapter)
  }
  return out.map((chapter, index) => ({ ...chapter, index: index + 1 }))
}

/**
 * 奇书 / 新御宅屋 / 黄易 / 无极的章节 id 按发布顺序递增：
 * 直接按数字 id 排序，兼容倒序目录和置顶的「感谢 / 公告」章节。
 */
function sortChaptersById(list: NovelChapter[]): NovelChapter[] {
  const seen = new Set<string>()
  const out: NovelChapter[] = []
  for (const chapter of list) {
    if (!chapter.id || !chapter.name || seen.has(chapter.id)) continue
    seen.add(chapter.id)
    out.push(chapter)
  }
  out.sort((a, b) => Number(a.id) - Number(b.id))
  return out.map((chapter, index) => ({ ...chapter, index: index + 1 }))
}

// ---------- 九五小说（95dushu） ----------

function parse95HomeItems(html: string, base: string, limit: number): NovelItem[] {
  const root = parse(html)
  const items: NovelItem[] = []
  const seen = new Set<string>()
  for (const book of root.querySelectorAll('.book')) {
    const link = book.querySelector('h2 a')
    const href = attrValue(link, 'href')
    const bookbook = /\/bookbook\/(\d+)\.html/.exec(href)
    const dirPath = /\/(\d+)\/(\d+)\/?$/.exec(href)
    const bookId = bookbook?.[1] ?? dirPath?.[2] ?? ''
    const title = link?.text.trim() ?? ''
    if (!bookId || !title || seen.has(bookId)) continue
    seen.add(bookId)
    items.push({
      bookId,
      title,
      author: '',
      cover: absoluteUrl(base, attrValue(book.querySelector('img'), 'src')),
      status: ''
    })
    if (items.length >= limit) break
  }
  return items
}

function parse95SearchItems(html: string, base: string): NovelItem[] {
  const root = parse(html)
  const items: NovelItem[] = []
  for (const row of root.querySelectorAll('table.grid tr')) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 6) continue
    const link = cells[0].querySelector('a')
    const href = attrValue(link, 'href')
    const bookId = /\/bookbook\/(\d+)\.html/.exec(href)?.[1] ?? ''
    const title = link?.text.trim() ?? ''
    if (!bookId || !title) continue
    items.push({
      bookId,
      title,
      author: plainText(cells[2].innerHTML),
      cover: novelCoverById(base, bookId),
      latestChapter: plainText(cells[1].innerHTML),
      status: normalizeNovelStatus(plainText(cells[5].innerHTML))
    })
  }
  return items
}

interface DetailMeta extends Omit<NovelDetail, 'chapters'> {
  tocUrl: string
}

async function fetch95Meta(base: string, bookId: string): Promise<DetailMeta> {
  const url = `${base}/bookbook/${bookId}.html`
  const page = await requestPage(url, { headers: { Referer: `${base}/` } })
  const root = parse(page.html)
  const title = root.querySelector('.info h1 a')?.text.trim() || root.querySelector('h1')?.text.trim() || ''
  const author = root.querySelector('.author a')?.text.trim() ?? ''
  const cover = absoluteUrl(base, attrValue(root.querySelector('.con_limg img'), 'src'))
  const intro = htmlToText(root.querySelector('.r_cons')?.innerHTML ?? '')
  const status = normalizeNovelStatus(
    /fullflag\(["']([^"']+)["']\)/i.exec(page.html)?.[1] ?? ''
  )
  const category =
    /提供([^，。]+?)类小说/.exec(
      root.querySelector('meta[name="description"]')?.getAttribute('content') ?? ''
    )?.[1] ??
    /写的([^，。]+?)类小说/.exec(
      root.querySelector('meta[name="description"]')?.getAttribute('content') ?? ''
    )?.[1] ??
    ''
  const latestChapter = root.querySelector('#newchapter')?.text.trim() ?? ''
  const tocUrl =
    absoluteUrl(base, attrValue(root.querySelector('#diralinks'), 'href')) ||
    `${base}/${novelBookDir(bookId)}/${bookId}/`
  return { bookId, title, author, cover, intro, category, status, latestChapter, tocUrl }
}

function parse95Chapters(html: string): NovelChapter[] {
  const root = parse(html)
  const chapters: NovelChapter[] = []
  for (const link of root.querySelectorAll('.novel_list dd a')) {
    const href = attrValue(link, 'href')
    const chapterId = /(\d+)\.html$/.exec(href)?.[1] ?? ''
    const name = link.text.trim()
    if (chapterId && name) chapters.push({ id: chapterId, name, index: 0 })
  }
  return finalizeChaptersById(chapters)
}

// ---------- 玄幻阁（xuanhuange） ----------

function parseXhHomeItems(html: string, base: string, limit: number): NovelItem[] {
  const root = parse(html)
  const items: NovelItem[] = []
  const seen = new Set<string>()
  for (const block of root.querySelectorAll('dl')) {
    const link = block.querySelector('dd a')
    const href = attrValue(link, 'href')
    const bookId = /\/files\/article\/html\/(?:\d+)\/(\d+)\//.exec(href)?.[1] ?? ''
    const title = link?.text.trim() ?? ''
    if (!bookId || !title || seen.has(bookId)) continue
    seen.add(bookId)
    const author = (block.querySelector('dd.tit')?.text ?? '')
      .replace(/^\s*作者[:：]\s*/, '')
      .trim()
    items.push({
      bookId,
      title,
      author,
      cover: absoluteUrl(base, attrValue(block.querySelector('dt img'), 'src')),
      status: ''
    })
    if (items.length >= limit) break
  }
  return items
}

function parseXhSearchItems(html: string, base: string): NovelItem[] {
  const root = parse(html)
  const items: NovelItem[] = []
  for (const block of root.querySelectorAll('#sitebox dl')) {
    const link = block.querySelector('dd h3 a') ?? block.querySelector('dd a')
    const href = attrValue(link, 'href')
    const bookId = /\/files\/article\/html\/(?:\d+)\/(\d+)\//.exec(href)?.[1] ?? ''
    const title = link?.text.trim() ?? ''
    if (!bookId || !title) continue
    const info = block.querySelectorAll('dd.book_other')[0]
    const spans = info?.querySelectorAll('span') ?? []
    items.push({
      bookId,
      title,
      author: spans[0]?.text.trim() ?? '',
      cover: absoluteUrl(base, attrValue(block.querySelector('dt img'), 'src')),
      latestChapter: block.querySelectorAll('dd.book_other')[1]?.querySelector('a')?.text.trim() ?? '',
      status: normalizeNovelStatus(spans[1]?.text.trim() ?? '')
    })
  }
  return items
}

async function fetchXhDetail(base: string, bookId: string): Promise<NovelDetail> {
  const dir = novelBookDir(bookId)
  const url = `${base}/files/article/html/${dir}/${bookId}/`
  const page = await requestPage(url, { headers: { Referer: `${base}/` } })
  const root = parse(page.html)
  const title = root.querySelector('h1')?.text.trim() ?? ''
  const counts = root.querySelectorAll('#count .pd_r')
  const author = counts[0]?.text.trim() ?? ''
  const category = counts[1]?.text.trim() ?? ''
  const status = normalizeNovelStatus(counts[2]?.text.trim() ?? '')
  const cover = absoluteUrl(base, attrValue(root.querySelector('#bookimg img'), 'src'))
  let intro = htmlToText(root.querySelector('#bookintro .introtxt')?.innerHTML ?? '')
  const aboutIndex = intro.indexOf('关于')
  if (aboutIndex >= 0) {
    const colonIndex = intro.indexOf('：', aboutIndex)
    if (colonIndex >= 0) intro = intro.slice(colonIndex + 1)
  }
  intro = intro.replace(/\s+/g, ' ').replace(/\.{3}$/, '').trim()
  const latestChapter = root.querySelector('.new_l a')?.text.trim() ?? ''
  const chapters: NovelChapter[] = []
  for (const link of root.querySelectorAll('#chapterlist li a')) {
    const chapterId = /(\d+)\.html$/.exec(attrValue(link, 'href'))?.[1] ?? ''
    const name = link.text.trim()
    if (chapterId && name) chapters.push({ id: chapterId, name, index: 0 })
  }
  return {
    bookId,
    title,
    author,
    cover,
    intro,
    category,
    status,
    latestChapter,
    chapters: finalizeChaptersById(chapters)
  }
}

// ---------- 奇书小说（5wa） ----------

/** 首页链接 /220/220292/ 只取编号，标题和作者交给详情页补全 */
function parse5waHomeItems(html: string, limit: number): NovelItem[] {
  const root = parse(html)
  const seen = new Set<string>()
  const items: NovelItem[] = []
  for (const link of root.querySelectorAll('a')) {
    const match = /^\/(\d+)\/(\d+)\/?$/.exec(attrValue(link, 'href'))
    if (!match) continue
    const bookId = `${match[1]}_${match[2]}`
    if (seen.has(bookId)) continue
    seen.add(bookId)
    items.push({ bookId, title: '', author: '', cover: '', status: '' })
    if (items.length >= limit) break
  }
  return items
}

function parse5waMeta(
  html: string,
  base: string,
  bookId: string
): Omit<NovelDetail, 'chapters'> {
  const metas = metaMap(html)
  const rawCover = metas['og:image'] || ''
  return {
    bookId,
    title: metas['og:novel:book_name'] || metas['og:title'] || `书籍 ${bookId}`,
    author: metas['og:novel:author'] || '',
    // 站点缺封面时统一返回 novel.gif 占位图
    cover: /novel\.gif$/i.test(rawCover) ? '' : absoluteUrl(base, rawCover),
    intro: cleanIntro(htmlToText(metas['og:description'] || ''), 'qishu5wa'),
    category: metas['og:novel:category'] || '',
    status: normalizeNovelStatus(metas['og:novel:status'] || ''),
    latestChapter: metas['og:novel:latest_chapter_name'] || ''
  }
}

async function fetch5waMeta(base: string, bookId: string): Promise<Omit<NovelDetail, 'chapters'>> {
  const [dir, id] = bookId.split('_')
  if (!dir || !id) throw new Error('书籍编号无效')
  const page = await requestPage(`${base}/${dir}/${id}/`, { headers: { Referer: `${base}/` } })
  return parse5waMeta(page.html, base, bookId)
}

async function fetch5waDetail(base: string, bookId: string): Promise<NovelDetail> {
  const [dir, id] = bookId.split('_')
  if (!dir || !id) throw new Error('书籍编号无效')
  const firstUrl = `${base}/${dir}/${id}/`
  const first = await requestPage(firstUrl, { headers: { Referer: `${base}/` } })
  const meta = parse5waMeta(first.html, base, bookId)

  // 目录每 20 章一页：/220/220292_2/、/220/220292_3/ ...
  let maxPage = 1
  for (const match of first.html.matchAll(new RegExp(`${escapeRe(id)}_(\\d+)/`, 'g'))) {
    const page = Number(match[1])
    if (Number.isFinite(page) && page > maxPage) maxPage = page
  }
  const rest = Array.from(
    { length: Math.max(0, Math.min(maxPage, MAX_CATALOG_PAGES) - 1) },
    (_, index) => index + 2
  )
  const htmls = [
    first.html,
    ...(await Promise.all(
      rest.map((page) =>
        requestPage(`${base}/${dir}/${id}_${page}/`, { headers: { Referer: firstUrl } })
          .then((result) => result.html)
          .catch(() => '')
      )
    ))
  ]
  const chapters = sortChaptersById(
    htmls.flatMap((html) =>
      parseChapterAnchors(html, (href) => {
        const match = new RegExp(
          `/${escapeRe(dir)}/${escapeRe(id)}/(\\d+)\\.html$`
        ).exec(href)
        return match ? match[1] : null
      })
    )
  )
  return { ...meta, chapters }
}

function parse5waSearchItems(html: string): NovelItem[] {
  const root = parse(html)
  const items: NovelItem[] = []
  for (const block of root.querySelectorAll('.search_list')) {
    const links = block.querySelectorAll('a')
    const href = attrValue(links[0], 'href')
    const match = /^\/(\d+)\/(\d+)\//.exec(href)
    const title = links[0]?.text.trim() ?? ''
    if (!match || !title) continue
    items.push({
      bookId: `${match[1]}_${match[2]}`,
      title,
      author: links[2]?.text.trim() ?? '',
      cover: '',
      category: links[1]?.text.trim() ?? '',
      status: ''
    })
  }
  return items
}

// ---------- 新御宅屋（xyuzhaiwu） ----------

function parseXyHomeItems(html: string, limit: number): NovelItem[] {
  const root = parse(html)
  const seen = new Set<string>()
  const items: NovelItem[] = []
  for (const link of root.querySelectorAll('a')) {
    const match = /^\/novel\/(\d+)\.html$/.exec(attrValue(link, 'href'))
    if (!match) continue
    const title = link.text.trim()
    if (!title || title.length > 80 || seen.has(match[1])) continue
    seen.add(match[1])
    items.push({ bookId: match[1], title, author: '', cover: '', status: '' })
    if (items.length >= limit) break
  }
  return items
}

function parseXySearchItems(html: string): NovelItem[] {
  const root = parse(html)
  const items: NovelItem[] = []
  for (const block of root.querySelectorAll('.common-bookele')) {
    const link = block.querySelector('a.articlename') ?? block.querySelector('a')
    const match = /\/novel\/(\d+)\.html/.exec(attrValue(link, 'href'))
    const title = link?.text.trim() ?? ''
    if (!match || !title) continue
    const category = (block.querySelector('p.lastupdate')?.text ?? '')
      .replace(/^\s*栏目[:：]\s*/, '')
      .trim()
    items.push({
      bookId: match[1],
      title,
      author: block.querySelector('p strong')?.text.trim() ?? '',
      cover: '',
      category,
      status: ''
    })
  }
  return items
}

async function fetchXyChapters(
  base: string,
  bookId: string,
  fallbackHtml: string
): Promise<NovelChapter[]> {
  let firstHtml = ''
  try {
    const page = await requestPage(`${base}/novel/list/${bookId}/1.html`, {
      headers: { Referer: `${base}/novel/${bookId}.html` }
    })
    firstHtml = page.html
  } catch {
    firstHtml = ''
  }
  if (!firstHtml) firstHtml = fallbackHtml

  let maxPage = 1
  for (const html of [firstHtml, fallbackHtml]) {
    for (const match of html.matchAll(new RegExp(`novel/list/${escapeRe(bookId)}/(\\d+)\\.html`, 'g'))) {
      const page = Number(match[1])
      if (Number.isFinite(page) && page > maxPage) maxPage = page
    }
  }
  const rest = Array.from(
    { length: Math.max(0, Math.min(maxPage, MAX_CATALOG_PAGES) - 1) },
    (_, index) => index + 2
  )
  const htmls = [
    firstHtml,
    ...(await Promise.all(
      rest.map((page) =>
        requestPage(`${base}/novel/list/${bookId}/${page}.html`, {
          headers: { Referer: `${base}/novel/${bookId}.html` }
        })
          .then((result) => result.html)
          .catch(() => '')
      )
    ))
  ]
  const anchors = htmls.flatMap((html) =>
    parseChapterAnchors(html, (href) => {
      const match = new RegExp(`/novel/${escapeRe(bookId)}/(\\d+)\\.html$`).exec(href)
      return match ? match[1] : null
    })
  )
  return sortChaptersById(anchors)
}

async function fetchXyDetail(base: string, bookId: string): Promise<NovelDetail> {
  const page = await requestPage(`${base}/novel/${bookId}.html`, {
    headers: { Referer: `${base}/` }
  })
  const root = parse(page.html)
  const metas = metaMap(page.html)
  const heading = root.querySelector('.lb_mulu h3')?.text ?? ''
  const title =
    /《([^》]+)》/.exec(heading)?.[1] ||
    metas['og:title'] ||
    root.querySelector('.lb_fm h1')?.text.trim() ||
    `书籍 ${bookId}`
  const infoText = root.querySelector('.lb_fm')?.text ?? ''
  const statusMatch = /(完结|连载中?)/.exec(infoText)
  const chapters = await fetchXyChapters(base, bookId, page.html)
  return {
    bookId,
    title: title.trim(),
    author: root.querySelector('.lb_fm .article_info_td h2')?.text.trim() ?? '',
    cover: '',
    intro: cleanIntro(htmlToText(metas['description'] || ''), 'xyuzhaiwu'),
    category: root.querySelector('.lb_fm a[href*="/wapsort/"]')?.text.trim() ?? '',
    status: normalizeNovelStatus(statusMatch?.[1] ?? ''),
    latestChapter:
      root.querySelector('.lb_fm a[href*="/novel/"]')?.text.trim() ||
      metas['og:novel:latest_chapter_name'] ||
      '',
    chapters
  }
}

// ---------- 黄易小说 / 无极小说（同一套笔趣阁模板） ----------

type XhLikeMode = 'xhytd' | 'ajnnan'

function xhLikeBookId(href: string, mode: XhLikeMode): string | null {
  if (mode === 'xhytd') {
    const match = /^\/(\d+)\/(\d+)\/?$/.exec(href)
    return match ? `${match[1]}_${match[2]}` : null
  }
  const match = /^\/(\d+_\d+)\/?$/.exec(href)
  return match ? match[1] : null
}

/** 黄易 / 无极的封面地址可以直接由书籍编号拼出 */
function xhLikeCover(base: string, bookId: string): string {
  const parts = bookId.split('_')
  if (parts.length !== 2) return ''
  return `${base}/files/article/image/${parts[0]}/${parts[1]}/${parts[1]}s.jpg`
}

function parseXhLikeHomeItems(
  html: string,
  base: string,
  mode: XhLikeMode,
  limit: number
): NovelItem[] {
  const root = parse(html)
  const seen = new Set<string>()
  const items: NovelItem[] = []
  for (const link of root.querySelectorAll('a')) {
    const bookId = xhLikeBookId(attrValue(link, 'href'), mode)
    if (!bookId || seen.has(bookId)) continue
    const title = link.text.trim()
    if (!title || title.length > 80) continue
    const authorLink = [...(link.parentNode?.parentNode?.querySelectorAll('a') ?? [])].find(
      (node) => /\/author\//.test(attrValue(node, 'href'))
    )
    seen.add(bookId)
    items.push({
      bookId,
      title,
      author: authorLink?.text.trim() ?? '',
      cover: xhLikeCover(base, bookId),
      status: ''
    })
    if (items.length >= limit) break
  }
  return items
}

function parseXhLikeSearchItems(html: string, base: string, mode: XhLikeMode): NovelItem[] {
  const root = parse(html)
  const items: NovelItem[] = []
  for (const row of root.querySelectorAll('.novelslist2 li')) {
    const titleLink = row.querySelector('.s2 a')
    const bookId = titleLink ? xhLikeBookId(attrValue(titleLink, 'href'), mode) : null
    const title = titleLink?.text.trim() ?? ''
    if (!bookId || !title) continue
    items.push({
      bookId,
      title,
      author: row.querySelector('.s4 a')?.text.trim() ?? '',
      cover: xhLikeCover(base, bookId),
      latestChapter: row.querySelector('.s3 a')?.text.trim() ?? '',
      status: ''
    })
  }
  return items
}

async function fetchXhLikeDetail(
  base: string,
  bookId: string,
  mode: XhLikeMode
): Promise<NovelDetail> {
  const path = mode === 'xhytd' ? bookId.replace('_', '/') : bookId
  const page = await requestPage(`${base}/${path}/`, { headers: { Referer: `${base}/` } })
  const root = parse(page.html)
  const metas = metaMap(page.html)
  const info = root.querySelectorAll('#info p')
  let category = ''
  let status = ''
  for (const paragraph of info) {
    const text = paragraph.text.replace(/\s+/g, ' ').trim()
    const statusMatch = /状态[:：]\s*(\S+)/.exec(text)
    if (statusMatch) status = normalizeNovelStatus(statusMatch[1])
    const categoryMatch = /(?:类别|分类)[:：]\s*(\S+)/.exec(text)
    if (categoryMatch) category = categoryMatch[1]
  }
  // #list 里通常有两段：置顶的「最新章节」和完整的「正文」目录，取章节最多的一段
  const groups = root.querySelectorAll('#list dl')
  let chapterLinks = root.querySelectorAll('#list dd a')
  if (groups.length) {
    let best = groups[0]
    for (const group of groups) {
      if (group.querySelectorAll('dd a').length > best.querySelectorAll('dd a').length) best = group
    }
    chapterLinks = best.querySelectorAll('dd a')
  }
  const chapters: NovelChapter[] = []
  for (const link of chapterLinks) {
    const chapterId = /(\d+)\.html$/.exec(attrValue(link, 'href'))?.[1] ?? ''
    const name = link.text.trim()
    if (chapterId && name && !CHAPTER_NAV_NAMES.test(name)) {
      chapters.push({ id: chapterId, name, index: 0 })
    }
  }
  return {
    bookId,
    title:
      root.querySelector('#info h1')?.text.trim() ||
      metas['og:title'] ||
      `书籍 ${bookId}`,
    author: root.querySelector('#info p a')?.text.trim() ?? '',
    cover:
      absoluteUrl(base, attrValue(root.querySelector('#fmimg img'), 'src')) ||
      xhLikeCover(base, bookId),
    intro: htmlToText(root.querySelector('#intro')?.innerHTML ?? ''),
    category,
    status,
    latestChapter:
      info[info.length - 1]?.querySelector('a')?.text.trim() ||
      metas['og:novel:latest_chapter_name'] ||
      '',
    chapters: sortChaptersById(chapters)
  }
}

// ---------- 笔趣阁（bqquge） ----------

function parseBqItems(html: string, base: string, limit = 60): NovelItem[] {
  const root = parse(html)
  const items: NovelItem[] = []
  const seen = new Set<string>()
  for (const block of root.querySelectorAll('.item')) {
    const link =
      block.querySelector('.itemtxt h3 a') ?? block.querySelector('h3 a') ?? block.querySelector('a')
    const bookId = /^\/(\d+)$/.exec(attrValue(link, 'href'))?.[1] ?? ''
    const title =
      link?.text.trim() || (block.querySelector('img')?.getAttribute('alt') ?? '').trim()
    if (!bookId || !title || seen.has(bookId)) continue
    seen.add(bookId)
    const spans = block.querySelectorAll('.itemtxt p span')
    const author = (block.querySelector('.itemtxt p a')?.text ?? '')
      .replace(/^\s*作者[:：]\s*/, '')
      .trim()
    items.push({
      bookId,
      title,
      author,
      cover: absoluteUrl(base, attrValue(block.querySelector('img'), 'src')),
      category: spans[1]?.text.trim() ?? '',
      status: normalizeNovelStatus(spans[0]?.text.trim() ?? '')
    })
    if (items.length >= limit) break
  }
  return items
}

async function fetchBqDetail(base: string, bookId: string): Promise<NovelDetail> {
  const page = await requestPage(`${base}/${bookId}`, { headers: { Referer: `${base}/` } })
  const root = parse(page.html)
  const metas = metaMap(page.html)
  const info = root.querySelectorAll('.booktxt p').map((node) => node.text.trim())
  const field = (name: string): string => {
    const line = info.find((text) => text.startsWith(name))
    return line ? line.slice(name.length).replace(/^[:：]\s*/, '').trim() : ''
  }
  const chapters: NovelChapter[] = []
  for (const link of root.querySelectorAll('#list ul li a')) {
    const chapterId = /(\d+)$/.exec(attrValue(link, 'href'))?.[1] ?? ''
    const name = link.text.trim()
    if (chapterId && name) chapters.push({ id: chapterId, name, index: 0 })
  }
  return {
    bookId,
    title:
      root.querySelector('.bookdetail h1')?.text.trim() ||
      metas['og:title'] ||
      `书籍 ${bookId}`,
    author:
      (root.querySelector('.booktxt p a')?.text ?? '')
        .replace(/^\s*作者[:：]\s*/, '')
        .trim() || field('作者'),
    cover: absoluteUrl(base, attrValue(root.querySelector('.bookdetail img'), 'src')),
    intro: htmlToText(root.querySelector('.des')?.innerHTML ?? ''),
    category: field('类别'),
    status: normalizeNovelStatus(field('状态')),
    latestChapter: root.querySelector('.newest h3 a')?.text.trim() ?? '',
    chapters: finalizeChaptersById(chapters)
  }
}

// ---------- 最终小说网（zuizhong） ----------

function parseZzListItems(html: string, limit = 60): NovelItem[] {
  const root = parse(html)
  const items: NovelItem[] = []
  const seen = new Set<string>()
  for (const row of root.querySelectorAll('.list_l2 li')) {
    const link = row.querySelector('.s2 a') ?? row.querySelector('a')
    const bookId = /novel\/(\d+)/.exec(attrValue(link, 'href'))?.[1] ?? ''
    const title = link?.text.trim() ?? ''
    if (!bookId || !title || seen.has(bookId)) continue
    seen.add(bookId)
    items.push({
      bookId,
      title,
      author: row.querySelector('.s4')?.text.trim() ?? '',
      cover: '',
      category: (row.querySelector('.s1')?.text ?? '').replace(/[\[\]]/g, '').trim(),
      status: ''
    })
    if (items.length >= limit) break
  }
  return items
}

function parseZzSearchItems(html: string): NovelItem[] {
  const root = parse(html)
  const items: NovelItem[] = []
  for (const row of root.querySelectorAll('.txt-list li')) {
    const links = row.querySelectorAll('a')
    const link = links[0]
    const bookId = /novel\/(\d+)/.exec(attrValue(link, 'href'))?.[1] ?? ''
    const title = link?.text.trim() ?? ''
    if (!bookId || !title) continue
    items.push({
      bookId,
      title,
      author: links[1]?.text.trim() ?? '',
      cover: '',
      category: (row.querySelector('.s1')?.text ?? '').replace(/[\[\]]/g, '').trim(),
      latestChapter: links[2]?.text.trim() ?? '',
      status: ''
    })
  }
  return items
}

async function fetchZzMeta(base: string, bookId: string): Promise<Partial<NovelItem>> {
  const page = await requestPage(`${base}/novel/${bookId}/`, {
    headers: { Referer: `${base}/` }
  })
  const metas = metaMap(page.html)
  return {
    title: metas['og:novel:book_name'] || '',
    author: metas['og:novel:author'] || '',
    cover: absoluteUrl(base, metas['og:image'] || ''),
    category: metas['og:novel:category'] || '',
    status: normalizeNovelStatus(metas['og:novel:status'] || ''),
    latestChapter: metas['og:novel:latest_chapter_name'] || ''
  }
}

/** 列表页没有封面，按书籍编号并发补详情页头图（单条失败不影响列表） */
async function fillZzMeta(base: string, items: NovelItem[]): Promise<void> {
  await fillHomeMeta(items, (item) => fetchZzMeta(base, item.bookId))
}

async function fetchZzDetail(base: string, bookId: string): Promise<NovelDetail> {
  const page = await requestPage(`${base}/novel/${bookId}/`, {
    headers: { Referer: `${base}/` }
  })
  const root = parse(page.html)
  const metas = metaMap(page.html)
  let chapters: NovelChapter[] = []
  for (const group of root.querySelectorAll('.info_dv3')) {
    const list: NovelChapter[] = []
    for (const link of group.querySelectorAll('ul li a')) {
      const href = attrValue(link, 'href')
      const chapterId = /yuedu-(\d+)\.html/.exec(href)?.[1] ?? /(\d+)\.html$/.exec(href)?.[1] ?? ''
      const name = link.text.trim()
      if (chapterId && name) list.push({ id: chapterId, name, index: 0 })
    }
    if (list.length > chapters.length) chapters = list
  }
  // 详情页只列前 100 章，完整目录在 /book/{id}/1.html ~ N.html，
  // 章节链接写成 onclick="read_tz(123456)"，需要额外抓取。
  const firstCatalog = await requestPage(`${base}/book/${bookId}/1.html`, {
    headers: { Referer: `${base}/novel/${bookId}/` }
  }).catch(() => null)
  if (firstCatalog) {
    const catalogRoot = parse(firstCatalog.html)
    let maxPage = 1
    for (const option of catalogRoot.querySelectorAll('.page_num option')) {
      const matched = /\/(\d+)\.html/.exec(attrValue(option, 'value'))
      if (matched) maxPage = Math.max(maxPage, Number(matched[1]))
    }
    const restPages = Array.from(
      { length: Math.max(0, Math.min(maxPage, MAX_CATALOG_PAGES) - 1) },
      (_, index) => index + 2
    )
    const restHtmls = await Promise.all(
      restPages.map((pageNum) =>
        requestPage(`${base}/book/${bookId}/${pageNum}.html`, {
          headers: { Referer: `${base}/book/${bookId}/1.html` }
        })
          .then((result) => result.html)
          .catch(() => '')
      )
    )
    for (const html of [firstCatalog.html, ...restHtmls]) {
      for (const match of html.matchAll(/read_tz\((\d+)\)[^>]*>([\s\S]{1,120}?)<\/a>/gi)) {
        const name = plainText(match[2])
        if (match[1] && name) chapters.push({ id: match[1], name, index: 0 })
      }
    }
  }
  return {
    bookId,
    title: metas['og:novel:book_name'] || metas['og:title'] || `书籍 ${bookId}`,
    author: metas['og:novel:author'] || '',
    cover: absoluteUrl(base, metas['og:image'] || ''),
    intro: cleanIntro(metas['og:description'] || htmlToText(root.querySelector('.intro')?.innerHTML ?? ''), 'zuizhong'),
    category: metas['og:novel:category'] || '',
    status: normalizeNovelStatus(metas['og:novel:status'] || ''),
    latestChapter: metas['og:novel:latest_chapter_name'] || '',
    chapters: finalizeChaptersById(chapters)
  }
}

// ---------- 搬山人小说网（banshanren） ----------

function parseBsListItems(html: string, base: string, limit = 60): NovelItem[] {
  const root = parse(html)
  const items: NovelItem[] = []
  const seen = new Set<string>()
  for (const row of root.querySelectorAll('ul.novel_list li.novel_li, ul.novel_list li')) {
    const link = row.querySelector('a.cover_box') ?? row.querySelector('a')
    const bookId = /novel\/([^/?#]+)/.exec(attrValue(link, 'href'))?.[1] ?? ''
    const title =
      (link?.getAttribute('title') ?? '').trim() ||
      row.querySelector('.title_box .title')?.text.trim() ||
      link?.text.trim() ||
      ''
    if (!bookId || !title || seen.has(bookId)) continue
    seen.add(bookId)
    const infos = row.querySelectorAll('.info_box')
    const statusText = infos[1]?.text.trim() ?? ''
    items.push({
      bookId,
      title,
      author: infos[0]?.text.trim() ?? '',
      cover: absoluteUrl(
        base,
        attrValue(row.querySelector('img'), 'data-src') || attrValue(row.querySelector('img'), 'src')
      ),
      status: normalizeNovelStatus(statusText.split('·')[0]?.trim() ?? '')
    })
    if (items.length >= limit) break
  }
  return items
}

function parseBsSearchItems(text: string, base: string): NovelItem[] {
  let data: Record<string, unknown>[] = []
  try {
    const json = JSON.parse(text) as { model?: { data?: Record<string, unknown>[] } }
    data = Array.isArray(json.model?.data) ? json.model.data : []
  } catch {
    return []
  }
  const items: NovelItem[] = []
  for (const row of data) {
    const bookId = String(row.slug ?? '').trim()
    const title = String(row.title ?? '').trim()
    if (!bookId || !title) continue
    const tags = String(row.tags ?? '')
      .split(',')
      .map((tag) => tag.split(':')[0]?.trim())
      .filter(Boolean)
    const rawCover = String(row.cover ?? '')
    items.push({
      bookId,
      title,
      author: String(row.authors ?? '').trim(),
      cover: rawCover.startsWith('/image/')
        ? `https://cdn.banshanren.com/file/s-media${rawCover}`
        : absoluteUrl(base, rawCover),
      category: tags.slice(0, 2).join(' / '),
      status: Number(row.finished) === 1 ? '完结' : '连载'
    })
  }
  return items
}

async function fetchBsDetail(base: string, bookId: string): Promise<NovelDetail> {
  const page = await requestPage(`${base}/novel/${bookId}`, {
    headers: { Referer: `${base}/` }
  })
  const root = parse(page.html)
  const metas = metaMap(page.html)
  const desc = metas['description'] || ''
  const chapters: NovelChapter[] = []
  for (const link of root.querySelectorAll('ul.chapter_list li a')) {
    const chapterId = (attrValue(link, 'href').split('?')[0].split('/').pop() ?? '').trim()
    const name = (link.getAttribute('title') ?? link.text).trim()
    if (/^\d{1,20}$/.test(chapterId) && name) chapters.push({ id: chapterId, name, index: 0 })
  }
  return {
    bookId,
    title: root.querySelector('.novel_title_box h1')?.text.trim() || metas['og:title'] || `书籍 ${bookId}`,
    author: root.querySelector('.novel_title_box .info_box span.hl')?.text.trim() ?? '',
    cover: absoluteUrl(
      base,
      metas['og:image'] ||
        attrValue(root.querySelector('.cover_box img'), 'data-src') ||
        attrValue(root.querySelector('.cover_box img'), 'src')
    ),
    intro: cleanIntro(
      metas['og:description'] || htmlToText(root.querySelector('.novel_intro_box p')?.innerHTML ?? ''),
      'banshanren'
    ),
    category: root
      .querySelectorAll('.category_list a')
      .map((node) => node.text.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' / '),
    status: normalizeNovelStatus(/(连载中|完结)/.exec(desc)?.[1] ?? ''),
    latestChapter: root.querySelector('.catalog_top_box span.hl')?.text.trim() ?? '',
    chapters: finalizeChaptersById(chapters)
  }
}

/** 首页卡片没有作者 / 状态：并发抓详情页补齐，单条失败不影响整页 */
async function fillHomeMeta(
  items: NovelItem[],
  load: (item: NovelItem) => Promise<Partial<NovelItem>>
): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(6, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      const item = items[index]
      try {
        const meta = await load(item)
        if (!item.title) item.title = meta.title ?? ''
        if (!item.author) item.author = meta.author ?? ''
        if (!item.cover) item.cover = meta.cover ?? ''
        if (!item.status) item.status = meta.status ?? ''
        if (!item.category) item.category = meta.category ?? ''
        if (!item.latestChapter) item.latestChapter = meta.latestChapter ?? ''
      } catch {
        // 单条失败保留首页已有信息
      }
    }
  })
  await Promise.all(workers)
}

function rankSearchResult(item: NovelItem, keyword: string): number {
  const title = item.title.trim()
  if (title === keyword) return 0
  if (title.startsWith(keyword)) return 1
  if (title.includes(keyword)) return 2
  const author = (item.author ?? '').trim()
  if (author === keyword) return 3
  if (author.startsWith(keyword)) return 4
  if (author.includes(keyword)) return 5
  return 6
}

async function fetchCatalogPages(
  firstUrl: string,
  pagePattern: RegExp,
  urlOf: (page: number) => string
): Promise<string[]> {
  const first = await requestPage(firstUrl)
  let max = 1
  for (const match of first.html.matchAll(pagePattern)) {
    const page = Number(match[1])
    if (Number.isFinite(page) && page > max) max = page
  }
  const rest: number[] = []
  for (let page = 2; page <= Math.min(max, MAX_CATALOG_PAGES); page += 1) rest.push(page)
  const htmls = await Promise.all(
    rest.map((page) =>
      requestPage(urlOf(page))
        .then((pageResult) => pageResult.html)
        .catch(() => '')
    )
  )
  return [first.html, ...htmls]
}

function detailMeta(
  html: string,
  metas: Record<string, string>,
  base: string,
  template: NovelSourceTemplate,
  bookId: string
): Omit<NovelDetail, 'chapters'> {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? ''
  const title =
    metas['og:novel:book_name'] || metas['og:title'] || plainText(h1) || `书籍 ${bookId}`
  return {
    bookId,
    title: title.replace(/[_|].*(?:笔趣阁|小说|全文阅读).*$/i, '').trim() || title,
    author: metas['og:novel:author'] || '',
    cover: coverOf(html, metas, base),
    intro: introOf(html, metas, template),
    category: metas['og:novel:category'] || '',
    status: metas['og:novel:status'] || '',
    latestChapter: metas['og:novel:latest_chapter_name'] || ''
  }
}

async function fetchDetail(source: NovelSourceInput, bookId: string): Promise<NovelDetail> {
  const template = source.template
  if (template === 'shenpinwu') return fetchShenpinwuDetail(source, bookId)
  const base = await canonicalBase(source)

  if (template === 'bqquge') {
    return fetchBqDetail(base, bookId)
  }

  if (template === 'zuizhong') {
    return fetchZzDetail(base, bookId)
  }

  if (template === 'banshanren') {
    return fetchBsDetail(base, bookId)
  }

  if (template === '95dushu') {
    const meta = await fetch95Meta(base, bookId)
    const tocPage = await requestPage(meta.tocUrl, {
      headers: { Referer: `${base}/bookbook/${bookId}.html` }
    })
    const chapters = parse95Chapters(tocPage.html)
    return {
      bookId: meta.bookId,
      title: meta.title,
      author: meta.author,
      cover: meta.cover,
      intro: meta.intro,
      category: meta.category,
      status: meta.status,
      latestChapter: meta.latestChapter,
      chapters
    }
  }

  if (template === 'xuanhuange') {
    return fetchXhDetail(base, bookId)
  }

  if (template === 'qishu5wa') {
    return fetch5waDetail(base, bookId)
  }

  if (template === 'xyuzhaiwu') {
    return fetchXyDetail(base, bookId)
  }

  if (template === 'xhytd' || template === 'ajnnan') {
    return fetchXhLikeDetail(base, bookId, template)
  }

  if (template === 'bqg70') {
    const page = await requestPage(`${base}/book/${bookId}/`, { headers: { Referer: `${base}/` } })
    const metas = metaMap(page.html)
    const htmls = await fetchCatalogPages(
      `${base}/book/${bookId}/index_1.html`,
      /index_(\d+)\.html/gi,
      (index) => `${base}/book/${bookId}/index_${index}.html`
    )
    const chapters = finalizeChapters(
      htmls.flatMap((html) =>
        parseChapterAnchors(html, (href) => {
          const match = new RegExp(`/book/${escapeRe(bookId)}/(\\d+)\\.html$`).exec(href)
          return match ? match[1] : null
        })
      )
    )
    return { ...detailMeta(page.html, metas, base, template, bookId), chapters }
  }

  if (template === 'bqg52') {
    const page = await requestPage(`${base}/book_${bookId}/`, {
      headers: { Referer: `${base}/` }
    })
    const metas = metaMap(page.html)
    const htmls = await fetchCatalogPages(
      `${base}/book_${bookId}/index_1.html`,
      /index_(\d+)\.html/gi,
      (index) => `${base}/book_${bookId}/index_${index}.html`
    )
    const chapters: NovelChapter[] = []
    for (const html of htmls) {
      for (const match of html.matchAll(/read_tz\((\d+)\)[^>]*>([\s\S]{1,120}?)<\/a>/gi)) {
        chapters.push({ id: match[1], name: plainText(match[2]), index: 0 })
      }
    }
    return { ...detailMeta(page.html, metas, base, template, bookId), chapters: finalizeChapters(chapters) }
  }

  if (template === 'biqugeco') {
    const page = await requestPage(`${base}/read/${bookId}.html`, {
      headers: { Referer: `${base}/` }
    })
    const metas = metaMap(page.html)
    const htmls = await fetchCatalogPages(
      `${base}/booklist/${bookId}/`,
      new RegExp(`booklist/${escapeRe(bookId)}/(\\d+)/`, 'gi'),
      (index) => (index === 1 ? `${base}/booklist/${bookId}/` : `${base}/booklist/${bookId}/${index}/`)
    )
    const chapters = finalizeChapters(
      htmls.flatMap((html) =>
        parseChapterAnchors(html, (href) => {
          const match = new RegExp(`/read/${escapeRe(bookId)}/(\\d+)\\.html$`).exec(href)
          return match ? match[1] : null
        })
      )
    )
    return { ...detailMeta(page.html, metas, base, template, bookId), chapters }
  }

  const page = await requestPage(`${base}/${bookId}/`, { headers: { Referer: `${base}/` } })
  const metas = metaMap(page.html)
  const listIndex = page.html.search(/id=["']list["']/i)
  let block = listIndex >= 0 ? page.html.slice(listIndex) : page.html
  const bodyStart = /<dt[^>]*>[^<]*正文[^<]*<\/dt>/i.exec(block)
  if (bodyStart?.index != null) block = block.slice(bodyStart.index + bodyStart[0].length)
  const chapters = finalizeChapters(
    parseChapterAnchors(block, (href) => {
      const match = new RegExp(`/${escapeRe(bookId)}/(\\d+)\\.html$`).exec(href)
      return match ? match[1] : null
    })
  )
  return { ...detailMeta(page.html, metas, base, template, bookId), chapters }
}

/** 神书网（shenpinwu）的普通请求会被 Node / Chromium fetch 拦，走隐藏浏览器最稳 */
async function requestShenpinwuPage(url: string, forceBrowser = false): Promise<Page> {
  if (!forceBrowser) {
    try {
      const res = await session.defaultSession.fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Referer: 'http://www.shenpinwu.co/'
        },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      if (res.ok) {
        const html = await res.text()
        if (html.length > 400) return { html, finalUrl: res.url || url }
      }
    } catch {
      // 落到隐藏浏览器
    }
  }
  const html = await fetchRenderedHtml(url, { waitMs: 700 })
  if (!html || html.length < 200) throw new Error('站点没有返回内容')
  return { html, finalUrl: url }
}

function shenpinwuBookId(href: string): string | null {
  const match = /^\/(\d+_\d+)\/?$/.exec(href.trim())
  return match ? match[1] : null
}

function parseShenpinwuItems(html: string, base: string, limit = 100): NovelItem[] {
  const root = parse(html)
  const items: NovelItem[] = []
  const seen = new Set<string>()
  for (const block of root.querySelectorAll('.item')) {
    const link = block.querySelector('dt a') ?? block.querySelector('.image a') ?? block.querySelector('a')
    const bookId = shenpinwuBookId(attrValue(link, 'href'))
    const title = (link?.getAttribute('title') || link?.text || '').trim()
    if (!bookId || !title || seen.has(bookId)) continue
    seen.add(bookId)
    const img = block.querySelector('img')
    const rawCover = img?.getAttribute('data-original') || img?.getAttribute('src') || ''
    const cover = /nocover/i.test(rawCover) ? '' : absoluteUrl(base, rawCover)
    const author =
      block.querySelector('.btm a')?.text.trim() ||
      (block.querySelector('.btm')?.text ?? '')
        .replace(/\d+(?:\.\d+)?万字/g, '')
        .replace(/作者[:：]?/g, '')
        .trim()
    items.push({
      bookId,
      title,
      author,
      cover,
      status: ''
    })
    if (items.length >= limit) break
  }
  return items
}

async function fetchShenpinwuDetail(
  source: NovelSourceInput,
  bookId: string
): Promise<NovelDetail> {
  const base = baseOf(source)
  const page = await requestShenpinwuPage(`${base}/${bookId}/`)
  const html = page.html
  const metas = metaMap(html)
  // 详情页有 40 万 + 字符和几千个章节链接，node-html-parser 在 Electron 主进程里会栈溢出，
  // 这里全部用正则取值。
  const h1 = plainText(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '')
  const author =
    plainText(/<p[^>]*>\s*作者[:：]\s*<a[^>]*>([\s\S]*?)<\/a>/i.exec(html)?.[1] ?? '') ||
    plainText(/作者[:：]\s*([^<\s]+)/i.exec(html)?.[1] ?? '')
  const category = plainText(/类别[:：]\s*([^<\s]+)/i.exec(html)?.[1] ?? '')
  const status = plainText(/状态[:：]\s*([^<\s]+)/i.exec(html)?.[1] ?? '')
  const intro = plainText(
    /<div[^>]+id=["']intro["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ??
      metas['og:description'] ??
      ''
  )
  const latestChapter = plainText(
    /<a[^>]+href=["'][^"']+\/\d+\.html["'][^>]*title=["']([^"']+)["']/i.exec(html)?.[1] ?? ''
  )
  const listIndex = html.search(/id=["']list["']/i)
  const block = listIndex >= 0 ? html.slice(listIndex) : html
  // 这里不能复用 parseChapterAnchors：它的正则带跨标签懒匹配，在几千个章节的
  // 大页面上会让 V8 栈溢出；逐标签扫描更稳。
  const chapters: NovelChapter[] = []
  const linkPattern = new RegExp(`/${escapeRe(bookId)}/(\\d{1,20})\\.html$`)
  for (const tag of block.matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = tag[1] ?? ''
    const href = /href=["']([^"']+)["']/i.exec(attrs)?.[1] ?? ''
    const id = linkPattern.exec(href)?.[1]
    if (!id) continue
    const title = /title=["']([^"']*)["']/i.exec(attrs)?.[1] ?? ''
    const end = block.indexOf('</a>', (tag.index ?? 0) + tag[0].length)
    const inner =
      end > 0 && end - (tag.index ?? 0) < 400
        ? block.slice((tag.index ?? 0) + tag[0].length, end)
        : ''
    const name = plainText(title || inner)
    if (!name || name.length > 80) continue
    chapters.push({ id, name, index: 0 })
  }
  const finalChapters = finalizeChapters(chapters)
  return {
    bookId,
    title: h1 || metas['og:title'] || `书籍 ${bookId}`,
    author,
    cover: coverOf(html, metas, base),
    intro: intro ? cleanIntro(intro, 'shenpinwu') : '',
    category,
    status: normalizeNovelStatus(status),
    latestChapter,
    chapters: finalChapters
  }
}

async function fetchShenpinwuChapter(
  source: NovelSourceInput,
  bookId: string,
  chapterId: string
): Promise<NovelChapterResponse> {
  const base = baseOf(source)
  const pages: string[] = []
  let duplicates = 0
  for (let pageIndex = 0; pageIndex < MAX_CHAPTER_PAGES; pageIndex += 1) {
    const page = await requestShenpinwuPage(
      chapterUrl('shenpinwu', base, bookId, chapterId, pageIndex),
      true
    )
    const text = extractChapterText('shenpinwu', page.html)
    if (!text) {
      if (pageIndex === 0) return { ok: false, error: '站点没有返回章节正文' }
      break
    }
    if (pages.includes(text)) {
      duplicates += 1
      if (duplicates >= 2) break
      continue
    }
    duplicates = 0
    pages.push(text)
  }
  const content = pages.join('\n\n').trim()
  if (!content) return { ok: false, error: '站点没有返回章节正文' }
  return { ok: true, chapter: { id: chapterId, content } }
}

async function fetchHome(source: NovelSourceInput): Promise<NovelListResponse> {
  const base = baseOf(source)
  if (source.template === 'shenpinwu') {
    const shenpinwu = await requestShenpinwuPage(`${base}/`)
    const items = parseShenpinwuItems(shenpinwu.html, base, 30)
    if (!items.length) throw new Error('站点没有返回可解析的推荐书目')
    return { ok: true, items }
  }
  const page = await requestPage(`${base}/`, { headers: { Referer: `${base}/` } })
  const canonical = rememberBase(base, page.finalUrl)
  if (source.template === 'bqquge') {
    const items = parseBqItems(page.html, canonical, 30)
    if (!items.length) throw new Error('站点没有返回可解析的推荐书目')
    return { ok: true, items }
  }
  if (source.template === 'zuizhong') {
    const items = parseZzListItems(page.html, 30)
    await fillZzMeta(canonical, items)
    if (!items.length) throw new Error('站点没有返回可解析的推荐书目')
    return { ok: true, items }
  }
  if (source.template === 'banshanren') {
    const items = parseBsListItems(page.html, canonical, 30)
    if (!items.length) throw new Error('站点没有返回可解析的推荐书目')
    return { ok: true, items }
  }
  if (source.template === '95dushu') {
    const items = parse95HomeItems(page.html, canonical, 20)
    await fillHomeMeta(items, (item) => fetch95Meta(canonical, item.bookId))
    if (!items.length) throw new Error('站点没有返回可解析的推荐书目')
    return { ok: true, items }
  }
  if (source.template === 'xuanhuange') {
    const items = parseXhHomeItems(page.html, canonical, 12)
    await fillHomeMeta(items, (item) => fetchXhDetail(canonical, item.bookId))
    if (!items.length) throw new Error('站点没有返回可解析的推荐书目')
    return { ok: true, items }
  }
  if (source.template === 'qishu5wa') {
    const items = parse5waHomeItems(page.html, 12)
    await fillHomeMeta(items, (item) => fetch5waMeta(canonical, item.bookId))
    const valid = items.filter((item) => !!item.title)
    if (!valid.length) throw new Error('站点没有返回可解析的推荐书目')
    return { ok: true, items: valid }
  }
  if (source.template === 'xyuzhaiwu') {
    const items = parseXyHomeItems(page.html, 20)
    if (!items.length) throw new Error('站点没有返回可解析的推荐书目')
    return { ok: true, items }
  }
  if (source.template === 'xhytd' || source.template === 'ajnnan') {
    const items = parseXhLikeHomeItems(page.html, canonical, source.template, 16)
    if (!items.length) throw new Error('站点没有返回可解析的推荐书目')
    return { ok: true, items }
  }
  let items = parseBookItems(page.html, source.template, 30)
  if (source.template === 'mayi') {
    const rich = parseMayiHomeItems(page.html, canonical, 30)
    if (rich.length) items = rich
    // 首页没有状态列，按书名并发补查；单条失败不影响整页
    await enrichMayiStatuses(canonical, items)
  }
  if (!items.length) throw new Error('站点没有返回可解析的推荐书目')
  return { ok: true, items }
}

async function fetchSearch(source: NovelSourceInput, keyword: string): Promise<NovelListResponse> {
  const template = source.template
  const base = template === 'shenpinwu' ? baseOf(source) : await canonicalBase(source)
  if (template === 'shenpinwu') {
    const page = await requestShenpinwuPage(
      `${base}/soso6815f.html?searchkey=${encodeURIComponent(keyword)}`,
      true
    )
    const items = parseShenpinwuItems(page.html, base, 100)
    items.sort(
      (a, b) =>
        rankSearchResult(a, keyword) - rankSearchResult(b, keyword) ||
        a.title.length - b.title.length
    )
    return { ok: true, items }
  }
  let page: Page
  if (template === 'bqquge') {
    page = await requestPage(`${base}/so/${encodeURIComponent(keyword)}`, {
      headers: { Referer: `${base}/` }
    })
    const items = parseBqItems(page.html, base)
    items.sort(
      (a, b) =>
        rankSearchResult(a, keyword) - rankSearchResult(b, keyword) ||
        a.title.length - b.title.length
    )
    return { ok: true, items }
  }
  if (template === 'zuizhong') {
    page = await requestPage(`${base}/search.html`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `${base}/`
      },
      body: `s=${encodeURIComponent(keyword)}`
    })
    const items = parseZzSearchItems(page.html)
    items.sort(
      (a, b) =>
        rankSearchResult(a, keyword) - rankSearchResult(b, keyword) ||
        a.title.length - b.title.length
    )
    await fillZzMeta(base, items)
    return { ok: true, items }
  }
  if (template === 'banshanren') {
    page = await requestPage(
      `${base}/api/search?keyword=${encodeURIComponent(keyword)}&page=1`,
      {
        headers: {
          Accept: 'application/json, text/plain, */*',
          Referer: `${base}/`
        }
      }
    )
    const items = parseBsSearchItems(page.html, base)
    items.sort(
      (a, b) =>
        rankSearchResult(a, keyword) - rankSearchResult(b, keyword) ||
        a.title.length - b.title.length
    )
    return { ok: true, items }
  }
  if (template === '95dushu') {
    page = await requestPage(
      `${base}/modules/article/search.php?ie=gbk&searchkey=${encodeURIComponent(keyword)}`,
      { headers: { Referer: `${base}/` } }
    )
    const items = parse95SearchItems(page.html, base)
    items.sort(
      (a, b) =>
        rankSearchResult(a, keyword) - rankSearchResult(b, keyword) ||
        a.title.length - b.title.length
    )
    return { ok: true, items }
  }
  if (template === 'xuanhuange') {
    page = await requestPage(
      `${base}/modules/article/search.php?s=7673184438602983814&s=${encodeURIComponent(keyword)}&searchtype=articlename`,
      { headers: { Referer: `${base}/` } }
    )
    const items = parseXhSearchItems(page.html, base)
    items.sort(
      (a, b) =>
        rankSearchResult(a, keyword) - rankSearchResult(b, keyword) ||
        a.title.length - b.title.length
    )
    return { ok: true, items }
  }
  if (template === 'qishu5wa') {
    page = await requestPage(`${base}/s.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `${base}/`
      },
      // 站点按 GBK 解析搜索词，UTF-8 会变成乱码查不到结果
      body: `s=${gbkUrlEncode(keyword)}&type=articlename`
    })
    const items = parse5waSearchItems(page.html)
    items.sort(
      (a, b) =>
        rankSearchResult(a, keyword) - rankSearchResult(b, keyword) ||
        a.title.length - b.title.length
    )
    return { ok: true, items }
  }
  if (template === 'xyuzhaiwu') {
    page = await requestPage(`${base}/s.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `${base}/`
      },
      body: `type=articlename&s=${encodeURIComponent(keyword)}`
    })
    const items = parseXySearchItems(page.html)
    items.sort(
      (a, b) =>
        rankSearchResult(a, keyword) - rankSearchResult(b, keyword) ||
        a.title.length - b.title.length
    )
    return { ok: true, items }
  }
  if (template === 'xhytd' || template === 'ajnnan') {
    page = await requestPage(`${base}/search.html?name=${encodeURIComponent(keyword)}`, {
      headers: { Referer: `${base}/` }
    })
    const items = parseXhLikeSearchItems(page.html, base, template)
    items.sort(
      (a, b) =>
        rankSearchResult(a, keyword) - rankSearchResult(b, keyword) ||
        a.title.length - b.title.length
    )
    return { ok: true, items }
  }
  if (template === 'bqg70' || template === 'bqg52') {
    page = await requestPage(`${base}/search.html`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `${base}/`
      },
      body: `s=${encodeURIComponent(keyword)}`
    })
  } else if (template === 'biqugeco') {
    page = await requestPage(`${base}/search/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `${base}/search/`
      },
      body: `searchkey=${encodeURIComponent(keyword)}&searchtype=all&submit=`
    })
  } else {
    page = await requestPage(`${base}/modules/article/search.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `${base}/`
      },
      body: `searchkey=${encodeURIComponent(keyword)}`
    })
  }

  if (template === 'mayi') {
    const items = parseMayiSearchItems(page.html, base)
    items.sort(
      (a, b) =>
        rankSearchResult(a, keyword) - rankSearchResult(b, keyword) ||
        a.title.length - b.title.length
    )
    return { ok: true, items }
  }

  let scope = page.html
  if (template === 'bqg52') scope = sectionOf(page.html, 'ul.txt-list') || page.html
  if (template === 'biqugeco') scope = sectionOf(page.html, 'section.SHsectionThree') || page.html

  const items = parseBookItems(scope, template, 40)
  items.sort(
    (a, b) =>
      rankSearchResult(a, keyword) - rankSearchResult(b, keyword) ||
      a.title.length - b.title.length
  )
  return { ok: true, items }
}

function chapterUrl(
  template: NovelSourceTemplate,
  base: string,
  bookId: string,
  chapterId: string,
  pageIndex: number
): string {
  const suffix = pageIndex > 0 ? `_${pageIndex}` : ''
  switch (template) {
    case 'bqg70':
      return `${base}/book/${bookId}/${chapterId}${suffix}.html`
    case 'bqg52':
      return `${base}/book_${bookId}/${chapterId}${suffix}.html`
    case 'biqugeco':
      return `${base}/read/${bookId}/${chapterId}${suffix}.html`
    case 'mayi':
      return `${base}/${bookId}/${chapterId}.html`
    case '95dushu':
      return `${base}/${novelBookDir(bookId)}/${bookId}/${chapterId}.html`
    case 'xuanhuange':
      return `${base}/files/article/html/${novelBookDir(bookId)}/${bookId}/${chapterId}.html`
    case 'qishu5wa': {
      const [dir, id] = bookId.split('_')
      return `${base}/${dir}/${id}/${chapterId}.html`
    }
    case 'xyuzhaiwu':
      return `${base}/novel/${bookId}/${chapterId}.html`
    case 'xhytd':
      return `${base}/${bookId.replace('_', '/')}/${chapterId}.html`
    case 'ajnnan':
      return `${base}/${bookId}/${chapterId}.html`
    case 'bqquge':
      return `${base}/${bookId}/${chapterId}`
    case 'zuizhong':
      return `${base}/book/${bookId}/yuedu-${chapterId}.html`
    case 'banshanren':
      return `${base}/novel/${bookId}/${chapterId}`
    case 'shenpinwu':
      return `${base}/${bookId}/${chapterId}${suffix}.html`
  }
}

function decodeWritelnBlocks(html: string): string {
  const out: string[] = []
  for (const match of html.matchAll(
    /document\.writeln\([^)]*?\(\s*['"]([A-Za-z0-9+/=]{20,})['"]\s*\)\s*\)/gi
  )) {
    try {
      out.push(Buffer.from(match[1], 'base64').toString('utf8'))
    } catch {
      // 忽略单段解码失败
    }
  }
  return out.join('\n')
}

function extractChapterText(template: NovelSourceTemplate, html: string): string {
  if (template === 'bqquge') {
    return htmlToText(
      sectionOf(html, '.con').replace(/<h1[\s\S]*?<\/h1>/i, '')
    )
  }
  if (template === 'zuizhong') {
    return parse(html)
      .querySelectorAll('.info_dv1 p')
      .slice(1, -2)
      .map((node) => node.text.trim())
      .filter((line) => !!line && !isJunkLine(line))
      .join('\n')
  }
  if (template === 'banshanren') {
    return htmlToText(
      sectionOf(html, '.chapter_content_box').replace(/<h2[\s\S]*?<\/h2>/gi, '')
    )
      .split('\n')
      .filter((line) => !/^\d+$/.test(line.trim()))
      .join('\n')
  }
  if (template === 'bqg70' || template === 'bqg52') {
    const decoded = decodeWritelnBlocks(html)
    if (decoded) {
      const text = htmlToText(decoded)
      if (text) return text
    }
  }
  const selector =
    template === 'biqugeco'
      ? '.RBGsectionThree-content'
      : template === 'bqg52'
        ? '.word_read'
        : template === '95dushu'
          ? '.yuedu_zhengwen'
          : template === 'qishu5wa'
            ? '#novelcontent'
            : template === 'xyuzhaiwu'
              ? '#nr1'
              : template === 'shenpinwu'
                ? '#chaptercontent'
                : '#content'
  return htmlToText(sectionOf(html, selector))
}

async function fetchChapter(
  source: NovelSourceInput,
  bookId: string,
  chapterId: string
): Promise<NovelChapterResponse> {
  const template = source.template
  if (template === 'shenpinwu') {
    return fetchShenpinwuChapter(source, bookId, chapterId)
  }
  const base = await canonicalBase(source)
  const pages: string[] = []
  let duplicates = 0
  const singlePage =
    template === 'mayi' ||
    template === '95dushu' ||
    template === 'xuanhuange' ||
    template === 'qishu5wa' ||
    template === 'xyuzhaiwu' ||
    template === 'xhytd' ||
    template === 'ajnnan' ||
    template === 'bqquge' ||
    template === 'zuizhong' ||
    template === 'banshanren'
  const maxPages = singlePage ? 1 : MAX_CHAPTER_PAGES
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await requestPage(
      chapterUrl(template, base, bookId, chapterId, pageIndex),
      { headers: { Referer: `${base}/` } }
    )
    const text = extractChapterText(template, page.html)
    if (!text) {
      if (pageIndex === 0) return { ok: false, error: '站点没有返回章节正文' }
      break
    }
    if (pages.includes(text)) {
      duplicates += 1
      if (duplicates >= 2) break
      continue
    }
    duplicates = 0
    pages.push(text)
  }
  const content = pages.join('\n\n').trim()
  if (!content) return { ok: false, error: '站点没有返回章节正文' }
  return { ok: true, chapter: { id: chapterId, content } }
}

function parse95CategoryItems(html: string, base: string, limit = 30): NovelItem[] {
  const root = parse(html)
  const items: NovelItem[] = []
  const seen = new Set<string>()
  for (const block of root.querySelectorAll('#alistbox')) {
    const link = block.querySelector('.title h2 a') ?? block.querySelector('.pic a')
    const bookId = /\/bookbook\/(\d+)\.html/.exec(attrValue(link, 'href'))?.[1] ?? ''
    const rawTitle = link?.text.trim() ?? ''
    const title = (/《([^》]+)》/.exec(rawTitle)?.[1] ?? rawTitle).trim()
    if (!bookId || !title || seen.has(bookId)) continue
    seen.add(bookId)
    items.push({
      bookId,
      title,
      author: block.querySelector('.title span a')?.text.trim() ?? '',
      cover: absoluteUrl(base, attrValue(block.querySelector('.pic img'), 'src')),
      status: '完结'
    })
    if (items.length >= limit) break
  }
  return items
}

function parseQishuCategoryItems(html: string, limit = 30): NovelItem[] {
  const root = parse(html)
  const items: NovelItem[] = []
  const seen = new Set<string>()
  for (const row of root.querySelectorAll('.list_xm li')) {
    const link = row.querySelector('.pp2 a') ?? row.querySelector('a')
    const matched = /^\/(\d+)\/(\d+)\/?$/.exec(attrValue(link, 'href'))
    const bookId = matched ? `${matched[1]}_${matched[2]}` : ''
    const title = link?.text.trim() ?? ''
    if (!bookId || !title || seen.has(bookId)) continue
    seen.add(bookId)
    items.push({
      bookId,
      title,
      author: row.querySelector('.pp4 a')?.text.trim() ?? '',
      cover: '',
      status: ''
    })
    if (items.length >= limit) break
  }
  return items
}

async function fetchCategory(
  source: NovelSourceInput,
  categoryId: string,
  page: number
): Promise<NovelListResponse> {
  const template = source.template
  const base = template === 'shenpinwu' ? baseOf(source) : await canonicalBase(source)
  if (template === 'shenpinwu') {
    const result = await requestShenpinwuPage(`${base}/class/${categoryId}/${page}/`)
    const items = parseShenpinwuItems(result.html, base, 100)
    if (!items.length) throw new Error('该分类没有返回书目')
    return {
      ok: true,
      items,
      hasMore:
        items.length >= 30 ||
        result.html.includes(`/class/${categoryId}/${page + 1}/`)
    }
  }
  if (template === 'mayi') {
    const result = await requestPage(`${base}/${categoryId}/`, {
      headers: { Referer: `${base}/` }
    })
    const items = parseMayiHomeItems(result.html, base, 30)
    if (!items.length) throw new Error('该分类没有返回书目')
    return { ok: true, items, hasMore: false }
  }
  if (template === '95dushu') {
    const url =
      page > 1
        ? `${base}/modules/article/articlelist.php?fullflag=1&page=${page}`
        : `${base}/${categoryId}/`
    const result = await requestPage(url, { headers: { Referer: `${base}/` } })
    const items = parse95CategoryItems(result.html, base)
    if (!items.length) throw new Error('该分类没有返回书目')
    return {
      ok: true,
      items,
      hasMore: result.html.includes(`fullflag=1&page=${page + 1}`)
    }
  }
  if (template === 'xuanhuange') {
    const url = `${base}/sort${categoryId}/${page}/`
    const result = await requestPage(url, { headers: { Referer: `${base}/` } })
    const items = parseXhSearchItems(result.html, base)
    if (!items.length) throw new Error('该分类没有返回书目')
    return { ok: true, items, hasMore: result.html.includes(`/sort${categoryId}/${page + 1}/`) }
  }
  if (template === 'qishu5wa') {
    const url = `${base}/sort/${categoryId}_${page}/`
    const result = await requestPage(url, { headers: { Referer: `${base}/` } })
    const items = parseQishuCategoryItems(result.html)
    if (!items.length) throw new Error('该分类没有返回书目')
    return { ok: true, items, hasMore: result.html.includes(`/sort/${categoryId}_${page + 1}/`) }
  }
  if (template === 'bqquge') {
    const url = page > 1 ? `${base}/${categoryId}/${page}` : `${base}/${categoryId}`
    const result = await requestPage(url, { headers: { Referer: `${base}/` } })
    const items = parseBqItems(result.html, base)
    const pageText = parse(result.html).querySelector('.page')?.text ?? ''
    const total = Number(/(\d+)\s*\/\s*(\d+)/.exec(pageText)?.[2] ?? 0)
    if (!items.length) throw new Error('该分类没有返回书目')
    return { ok: true, items, hasMore: total > page }
  }
  if (template === 'zuizhong') {
    const url = `${base}/yuedu/${categoryId}/${page}.html`
    const result = await requestPage(url, { headers: { Referer: `${base}/` } })
    const items = parseZzListItems(result.html)
    if (!items.length) throw new Error('该分类没有返回书目')
    await fillZzMeta(base, items)
    return {
      ok: true,
      items,
      hasMore: result.html.includes(`/yuedu/${categoryId}/${page + 1}.html`)
    }
  }
  if (template === 'banshanren') {
    const url = `${base}/all/0-${categoryId}-0-0-0-0-1-${page}/`
    const result = await requestPage(url, { headers: { Referer: `${base}/` } })
    const items = parseBsListItems(result.html, base)
    if (!items.length) throw new Error('该分类没有返回书目')
    return { ok: true, items, hasMore: result.html.includes(`-1-${page + 1}/`) }
  }
  return { ok: false, items: [], error: '该源不支持分类浏览' }
}

function normalizeInput(source: NovelSourceInput): NovelSourceInput {
  const baseUrl = source.baseUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('书源地址无效')
  return { ...source, baseUrl }
}

export async function novelHome(rawSource: NovelSourceInput): Promise<NovelListResponse> {
  try {
    return await fetchHome(normalizeInput(rawSource))
  } catch (err) {
    return { ok: false, items: [], error: errorText(err) }
  }
}

export async function novelSearch(
  rawSource: NovelSourceInput,
  keyword: string
): Promise<NovelListResponse> {
  const query = keyword.trim()
  if (!query) return { ok: false, items: [], error: '请输入书名或作者' }
  try {
    return await fetchSearch(normalizeInput(rawSource), query)
  } catch (err) {
    return { ok: false, items: [], error: errorText(err) }
  }
}

export async function novelCategory(
  rawSource: NovelSourceInput,
  categoryId: string,
  page: number
): Promise<NovelListResponse> {
  if (!/^[a-zA-Z0-9_-]{1,20}$/.test(categoryId)) {
    return { ok: false, items: [], error: '分类参数无效' }
  }
  const current = Number.isFinite(page) ? Math.max(1, Math.min(999, Math.floor(page))) : 1
  try {
    return await fetchCategory(normalizeInput(rawSource), categoryId, current)
  } catch (err) {
    return { ok: false, items: [], error: errorText(err) }
  }
}

export async function novelDetail(
  rawSource: NovelSourceInput,
  bookId: string
): Promise<NovelDetailResponse> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(bookId)) return { ok: false, error: '书籍编号无效' }
  try {
    const detail = await fetchDetail(normalizeInput(rawSource), bookId)
    if (!detail.chapters.length) return { ok: false, error: '站点没有返回可用章节' }
    return { ok: true, detail }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

export async function novelChapter(
  rawSource: NovelSourceInput,
  bookId: string,
  chapterId: string
): Promise<NovelChapterResponse> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(bookId) || !/^\d{1,20}$/.test(chapterId)) {
    return { ok: false, error: '章节编号无效' }
  }
  try {
    return await fetchChapter(normalizeInput(rawSource), bookId, chapterId)
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

export async function testNovelSource(rawSource: NovelSourceInput): Promise<NovelTestResult> {
  try {
    const result = await fetchHome(normalizeInput(rawSource))
    if (!result.items.length) return { ok: false, error: '站点没有返回可解析的推荐书目' }
    return {
      ok: true,
      count: result.items.length,
      message: `可用 · 推荐 ${result.items.length} 本`
    }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

/**
 * 整本下载：按详情页已拿到的章节列表并发抓正文，合并成一个 UTF-8 TXT，
 * 落到「下载目录/小说/<书名>.txt」，并登记到下载管理。
 */
export async function novelDownload(
  input: NovelDownloadInput,
  onProgress?: (progress: NovelDownloadProgress) => void
): Promise<NovelDownloadResult> {
  try {
    if (!input || typeof input !== 'object') return { ok: false, error: '下载参数无效' }
    const source = normalizeInput(input.source)
    if (!/^[a-zA-Z0-9_]{1,60}$/.test(input.bookId)) return { ok: false, error: '书籍编号无效' }
    const title = (input.title ?? '').trim()
    if (!title) return { ok: false, error: '书名不能为空' }
    const chapters = Array.isArray(input.chapters)
      ? input.chapters.filter(
          (chapter) =>
            chapter &&
            typeof chapter.id === 'string' &&
            /^\d{1,20}$/.test(chapter.id) &&
            typeof chapter.name === 'string'
        )
      : []
    if (!chapters.length) return { ok: false, error: '没有可下载的章节' }
    if (chapters.length > 20000) return { ok: false, error: '章节数量超出限制' }

    const contents: string[] = new Array(chapters.length).fill('')
    let done = 0
    let failed = 0
    let sentAt = 0
    const report = (force: boolean): void => {
      if (!onProgress) return
      const now = Date.now()
      if (!force && now - sentAt < 300) return
      sentAt = now
      onProgress({
        sourceId: source.id,
        bookId: input.bookId,
        done,
        total: chapters.length
      })
    }

    let cursor = 0
    const workers = Array.from({ length: Math.min(5, chapters.length) }, async () => {
      for (;;) {
        const index = cursor++
        if (index >= chapters.length) return
        const chapter = chapters[index]
        try {
          const res = await fetchChapter(source, input.bookId, chapter.id)
          if (!res.ok || !res.chapter?.content) throw new Error(res.error ?? '正文为空')
          contents[index] = res.chapter.content
        } catch {
          failed += 1
          contents[index] = '（本章下载失败，可稍后重新下载）'
        }
        done += 1
        report(done === chapters.length)
      }
    })
    await Promise.all(workers)
    if (failed >= chapters.length) return { ok: false, error: '所有章节都下载失败' }

    const head = [
      `《${title}》`,
      input.author ? `作者：${input.author}` : '',
      input.status ? `状态：${normalizeNovelStatus(input.status)}` : '',
      source.name ? `来源：${source.name}` : '',
      input.intro ? `简介：${input.intro.replace(/\s+/g, ' ').trim()}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    const body = chapters
      .map((chapter, index) => `${chapter.name}\n\n${contents[index] || '（本章暂无内容）'}`)
      .join('\n\n\n')
    const content = `\ufeff${head}\n\n${'='.repeat(48)}\n\n${body}\n`
    const saved = await saveNovelFile({
      title,
      content,
      coverUrl: input.cover,
      sourceName: source.name
    })
    return {
      ok: true,
      path: saved.path,
      chapters: chapters.length - failed,
      failed,
      sizeBytes: saved.sizeBytes
    }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}
