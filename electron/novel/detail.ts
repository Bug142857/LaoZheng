import { parse } from 'node-html-parser'
import { session } from 'electron'
import { fetchRenderedHtml } from '../browserPage'
import { bikahubNovelDetail } from '../bikahub'
import { normalizeNovelStatus, type NovelSourceInput, type NovelItem, type NovelChapter, type NovelDetail, type NovelChapterResponse, type NovelSourceTemplate } from '../../src/shared/novel'
import { baseOf, canonicalBase, escapeRe, requestPage, metaMap, plainText, absoluteUrl, coverOf, cleanIntro, introOf, finalizeChapters, parseChapterAnchors, chapterUrl, extractChapterText, UA, TIMEOUT_MS, MAX_CATALOG_PAGES, MAX_CHAPTER_PAGES, type Page } from './common'
import { attrValue, fetch95Meta, parse95Chapters, fetchXhDetail, fetch5waDetail } from './sitesA'
import { fetchXyDetail, fetchXhLikeDetail, fetchBqDetail, fetchZzDetail, fetchBsDetail } from './sitesB'

export function rankSearchResult(item: NovelItem, keyword: string): number {
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

export async function fetchCatalogPages(
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

export function detailMeta(
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

export async function fetchDetail(source: NovelSourceInput, bookId: string): Promise<NovelDetail> {
  const template = source.template
  if (template === 'bikahub') {
    const result = await bikahubNovelDetail(baseOf(source), bookId)
    if (!result.ok || !result.detail) throw new Error(result.error ?? '详情加载失败')
    return result.detail
  }
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
export async function requestShenpinwuPage(url: string, forceBrowser = false): Promise<Page> {
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

export function shenpinwuBookId(href: string): string | null {
  const match = /^\/(\d+_\d+)\/?$/.exec(href.trim())
  return match ? match[1] : null
}

export function parseShenpinwuItems(html: string, base: string, limit = 100): NovelItem[] {
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

export async function fetchShenpinwuDetail(
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

export async function fetchShenpinwuChapter(
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

