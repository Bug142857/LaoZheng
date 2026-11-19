import { parse } from 'node-html-parser'
import iconv from 'iconv-lite'
import { type NovelSourceInput, type NovelItem, type NovelChapter, type NovelSourceTemplate } from '../../src/shared/novel'

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
export const TIMEOUT_MS = 20_000
export const MAX_CATALOG_PAGES = 30
export const MAX_CHAPTER_PAGES = 8

export interface Page {
  html: string
  finalUrl: string
}

export function baseOf(source: NovelSourceInput): string {
  return source.baseUrl.trim().replace(/\/+$/, '')
}

/** 部分老站（奇书小说）搜索只认 GBK 编码的表单值 */
export function gbkUrlEncode(value: string): string {
  return [...iconv.encode(value, 'gbk')]
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
    .join('')
}

/**
 * 站点可能 301 到新域名（例如 biquges.com → mayiwsk.info）。
 * fetch 跟随 301 时会把 POST 改成 GET 并丢掉搜索参数，所以先记住落地域名，
 * 后续搜索 / 详情 / 正文都直接请求真实域名。
 */
export const canonicalBases = new Map<string, string>()

export function rememberBase(base: string, finalUrl: string): string {
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

export async function canonicalBase(source: NovelSourceInput): Promise<string> {
  const base = baseOf(source)
  const cached = canonicalBases.get(base)
  if (cached) return cached
  try {
    const page = await requestPage(`${base}/`)
    return rememberBase(base, page.finalUrl)
  } catch {
    // 有的网络只放行 http 或 https：首站失败时换协议再探一次
    const alt = alternateBase(base)
    if (alt) {
      try {
        const page = await requestPage(`${alt}/`)
        return rememberBase(base, page.finalUrl)
      } catch {
        // 两种协议都不通，回原地址让调用方报错
      }
    }
    return base
  }
}

export function alternateBase(base: string): string {
  try {
    const url = new URL(base)
    if (url.protocol === 'http:') url.protocol = 'https:'
    else if (url.protocol === 'https:') url.protocol = 'http:'
    else return ''
    return url.origin
  } catch {
    return ''
  }
}

/** 首页请求：主地址失败时换协议重试，并把能用的落地域名记住 */
export async function requestHomePage(source: NovelSourceInput): Promise<{ page: Page; base: string }> {
  const base = baseOf(source)
  try {
    const page = await requestPage(`${base}/`, { headers: { Referer: `${base}/` } })
    return { page, base: rememberBase(base, page.finalUrl) }
  } catch (err) {
    const alt = alternateBase(base)
    if (!alt) throw err
    const page = await requestPage(`${alt}/`, { headers: { Referer: `${alt}/` } })
    return { page, base: rememberBase(base, page.finalUrl) }
  }
}

export function errorText(err: unknown): string {
  return (err as Error).message || '加载失败'
}

export function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function decodeEntities(value: string): string {
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
export function decodeBuffer(buffer: Buffer, contentType: string): string {
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

export function textBadness(text: string): number {
  let score = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '\uFFFD') score += 10
    else if (ch >= '\u0080' && ch <= '\u009f') score += 2
  }
  if (/锟斤拷|鏂囩珷|å¤|ç«|é—|è¯/.test(text)) score += 40
  return score
}

/**
 * 最终小说网等站点首次访问会回 503 + JS WAF 挑战页：
 * 页面里带 `var token='…'`，浏览器只是把它写成 waf_challenge Cookie 后重载。
 * 这里直接取 token 带上 Cookie 重试，并按域名缓存 4 分钟，避免每个请求都多打一次。
 */
export const WAF_COOKIE_TTL = 4 * 60 * 1000
export const wafCookies = new Map<string, { cookie: string; at: number }>()

export function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

export function wafTokenOf(html: string): string {
  return /var\s+token\s*=\s*'([A-Za-z0-9_-]{16,})'/.exec(html)?.[1] ?? ''
}

export function mergedCookie(base: string, extra: string): string {
  if (!base) return extra
  if (!extra) return base
  return `${base}; ${extra}`
}

export async function requestPage(url: string, init: RequestInit = {}): Promise<Page> {
  const origin = originOf(url)
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    ...(init.headers as Record<string, string> | undefined)
  }
  const cached = wafCookies.get(origin)
  if (cached && Date.now() - cached.at < WAF_COOKIE_TTL) {
    headers.Cookie = mergedCookie(headers.Cookie ?? '', cached.cookie)
  }
  const request = (withHeaders: Record<string, string>): Promise<Response> =>
    fetch(url, {
      ...init,
      headers: withHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  let res = await request(headers)
  if (res.status === 503) {
    const challenge = await res.text()
    const token = wafTokenOf(challenge)
    if (!token) throw new Error('HTTP 503')
    const cookie = `waf_challenge=${token}`
    wafCookies.set(origin, { cookie, at: Date.now() })
    res = await request({ ...headers, Cookie: mergedCookie(headers.Cookie ?? '', cookie) })
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  return {
    html: decodeBuffer(buffer, res.headers.get('content-type') || ''),
    finalUrl: res.url
  }
}

export function tagAttr(tag: string, name: string): string {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return match ? decodeEntities(match[1] ?? match[2] ?? '') : ''
}

export function metaMap(html: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (tagAttr(tag, 'property') || tagAttr(tag, 'name')).toLowerCase()
    const content = tagAttr(tag, 'content')
    if (key && content && !(key in map)) map[key] = content
  }
  return map
}

export function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const JUNK_LINE_PATTERNS = [
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

export function isJunkLine(line: string): boolean {
  return JUNK_LINE_PATTERNS.some((pattern) => pattern.test(line))
}

export function htmlToText(html: string): string {
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
export function sectionOf(html: string, selector: string): string {
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

export function absoluteUrl(base: string, href: string): string {
  const value = href.trim()
  if (!value) return ''
  try {
    const url = new URL(value, base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
}

export function coverOf(html: string, metas: Record<string, string>, base: string): string {
  let cover = metas['og:image'] || metas['twitter:image'] || ''
  if (!cover) {
    const match = /id=["']fmimg["'][\s\S]{0,600}?<img[^>]+src=["']([^"']+)/i.exec(html)
    if (match) cover = match[1]
  }
  return absoluteUrl(base, cover)
}

export function cleanIntro(text: string, template: NovelSourceTemplate): string {
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

export function introOf(
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
export function chapterNumber(name: string): number | null {
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
export function finalizeChapters(list: NovelChapter[]): NovelChapter[] {
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

export const CHAPTER_NAV_NAMES =
  /^(?:正文|立即阅读|开始阅读|继续阅读|上一页|下一页|上一章|下一章|加入书架|推荐本书|返回|首页|目录|章节目录|最新章节|查看全部|更多章节|手机阅读|电脑阅读)$/

export function parseChapterAnchors(
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

export function bookLinkPattern(template: NovelSourceTemplate): RegExp {
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
    case 'bikahub':
      // 这些模板使用各自的解析函数，不走通用书名链接匹配
      return /(?!)<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{1,120}?)<\/a>/gi
  }
}

export function parseBookItems(
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

export function chapterUrl(
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
    case 'bikahub':
      return `${base}/novel/read/${bookId}/${chapterId}`
  }
}

export function decodeWritelnBlocks(html: string): string {
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

export function extractChapterText(template: NovelSourceTemplate, html: string): string {
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
  if (template === 'xhytd') {
    // 黄易新站（wap.aihytd.com）正文在 #chaptercontent，老镜像仍是 #content
    return (
      htmlToText(sectionOf(html, '#chaptercontent')) || htmlToText(sectionOf(html, '#content'))
    )
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

/** 95dushu / 玄幻阁的书籍目录都按 floor(id/1000) 分目录 */
export function novelBookDir(bookId: string): string {
  const numeric = Number(bookId)
  return Number.isFinite(numeric) && numeric > 0 ? String(Math.floor(numeric / 1000)) : ''
}

export function novelCoverById(base: string, bookId: string): string {
  const dir = novelBookDir(bookId)
  return dir ? `${base}/files/article/image/${dir}/${bookId}/${bookId}s.jpg` : ''
}

/** 并发补全首页条目缺失字段（标题 / 作者 / 封面 / 状态 / 分类 / 最新章节） */
export async function fillHomeMeta(
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

