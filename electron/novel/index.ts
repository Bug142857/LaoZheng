import { parse } from 'node-html-parser'
import { saveNovelFile } from '../downloads'
import { bikahubNovelCategory, bikahubNovelChapter, bikahubNovelHome, bikahubNovelSearch } from '../bikahub'
import { normalizeNovelStatus, type NovelSourceInput, type NovelItem, type NovelDownloadInput, type NovelDownloadProgress, type NovelDownloadResult, type NovelListResponse, type NovelDetailResponse, type NovelChapterResponse, type NovelTestResult } from '../../src/shared/novel'
import { baseOf, gbkUrlEncode, canonicalBase, requestHomePage, errorText, escapeRe, requestPage, sectionOf, absoluteUrl, parseBookItems, chapterUrl, extractChapterText, fillHomeMeta, MAX_CHAPTER_PAGES, type Page } from './common'
import { parseMayiHomeItems, parseMayiSearchItems, enrichMayiStatuses, attrValue, parse95HomeItems, parse95SearchItems, fetch95Meta, parseXhHomeItems, parseXhSearchItems, fetchXhDetail, parse5waHomeItems, fetch5waMeta, parse5waSearchItems } from './sitesA'
import { parseXyHomeItems, parseXySearchItems, parseXhLikeHomeItems, parseXhLikeSearchItems, parseXhytdCategoryItems, fetchAjnnanFullCategory, parseBqItems, parseZzListItems, parseZzSearchItems, fillZzMeta, parseBsListItems, parseBsSearchItems, AJNNAN_FULL_PAGE_SIZE } from './sitesB'
import { rankSearchResult, fetchDetail, requestShenpinwuPage, parseShenpinwuItems, fetchShenpinwuChapter } from './detail'

export async function fetchHome(source: NovelSourceInput): Promise<NovelListResponse> {
  const base = baseOf(source)
  // 哔咔小说：Nuxt payload 解析，站点挂了会自动走 /go-home 防失联换址
  if (source.template === 'bikahub') return bikahubNovelHome(base)
  if (source.template === 'shenpinwu') {
    const shenpinwu = await requestShenpinwuPage(`${base}/`)
    const items = parseShenpinwuItems(shenpinwu.html, base, 30)
    if (!items.length) throw new Error('站点没有返回可解析的推荐书目')
    return { ok: true, items }
  }
  const home = await requestHomePage(source)
  const page = home.page
  const canonical = home.base
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

export async function fetchSearch(source: NovelSourceInput, keyword: string): Promise<NovelListResponse> {
  const template = source.template
  if (template === 'bikahub') return bikahubNovelSearch(baseOf(source), keyword)
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


export async function fetchChapter(
  source: NovelSourceInput,
  bookId: string,
  chapterId: string
): Promise<NovelChapterResponse> {
  const template = source.template
  if (template === 'bikahub') return bikahubNovelChapter(baseOf(source), bookId, chapterId)
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

export function parse95CategoryItems(html: string, base: string, limit = 30): NovelItem[] {
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

export function parseQishuCategoryItems(html: string, limit = 30): NovelItem[] {
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

/** 从分页链接里取最大页码；站点不显示总页数时用它换算 hasMore / totalPages */
export function maxPageIn(html: string, pattern: RegExp): number {
  let max = 1
  for (const match of html.matchAll(pattern)) {
    const page = Number(match[1])
    if (Number.isFinite(page) && page > max) max = page
  }
  return max
}

export async function fetchCategory(
  source: NovelSourceInput,
  categoryId: string,
  page: number
): Promise<NovelListResponse> {
  const template = source.template
  if (template === 'bikahub') return bikahubNovelCategory(baseOf(source), categoryId, page)
  const base = template === 'shenpinwu' ? baseOf(source) : await canonicalBase(source)
  if (template === 'shenpinwu') {
    const result = await requestShenpinwuPage(`${base}/class/${categoryId}/${page}/`)
    const items = parseShenpinwuItems(result.html, base, 100)
    if (!items.length) throw new Error('该分类没有返回书目')
    const totalPages = maxPageIn(
      result.html,
      new RegExp(`/class/${escapeRe(categoryId)}/(\\d+)/`, 'g')
    )
    return { ok: true, items, hasMore: page < totalPages, totalPages }
  }
  if (template === 'mayi') {
    const result = await requestPage(`${base}/${categoryId}/`, {
      headers: { Referer: `${base}/` }
    })
    // 蚂蚁文学分类页没有分页，页面本身只有 60 多本推荐，全部展示
    const items = parseMayiHomeItems(result.html, base, 80)
    if (!items.length) throw new Error('该分类没有返回书目')
    return { ok: true, items, hasMore: false, totalPages: 1 }
  }
  if (template === 'xhytd') {
    const matched = /^xc([1-8])$/.exec(categoryId)
    if (!matched) throw new Error('分类参数无效')
    const url = `${base}/xclass/${matched[1]}/${page}.html`
    const result = await requestPage(url, { headers: { Referer: `${base}/` } })
    const items = parseXhytdCategoryItems(result.html, base)
    if (!items.length) throw new Error('该分类没有返回书目')
    const pageText =
      parse(result.html).querySelector('.page_txt')?.getAttribute('value') ?? ''
    const counted = Number(/(\d+)\s*\/\s*(\d+)/.exec(pageText)?.[2] ?? 0)
    const totalPages =
      counted > 0
        ? counted
        : maxPageIn(result.html, new RegExp(`/xclass/${matched[1]}/(\\d+)\\.html`, 'g'))
    return { ok: true, items, hasMore: page < totalPages, totalPages }
  }
  if (template === 'ajnnan') {
    const matched = /^du([1-7])$/.exec(categoryId)
    if (!matched) throw new Error('分类参数无效')
    const all = await fetchAjnnanFullCategory(base, matched[1])
    if (!all.length) throw new Error('该分类没有返回书目')
    const totalPages = Math.max(1, Math.ceil(all.length / AJNNAN_FULL_PAGE_SIZE))
    const start = (page - 1) * AJNNAN_FULL_PAGE_SIZE
    const items = all.slice(start, start + AJNNAN_FULL_PAGE_SIZE)
    if (!items.length) throw new Error('该分类没有更多书目')
    return { ok: true, items, hasMore: page < totalPages, totalPages }
  }
  if (template === '95dushu') {
    const mulu = /^mulu(\d{1,2})$/.exec(categoryId)
    const url = mulu
      ? `${base}/mulu/${mulu[1]}-${page}.html`
      : page > 1
        ? `${base}/modules/article/articlelist.php?fullflag=1&page=${page}`
        : `${base}/${categoryId}/`
    const result = await requestPage(url, { headers: { Referer: `${base}/` } })
    const items = parse95CategoryItems(result.html, base, 60)
    if (!items.length) throw new Error('该分类没有返回书目')
    const totalPages = mulu
      ? maxPageIn(result.html, new RegExp(`/mulu/${mulu[1]}-(\\d+)\\.html`, 'g'))
      : maxPageIn(result.html, /fullflag=1&page=(\d+)/g)
    return { ok: true, items, hasMore: page < totalPages, totalPages }
  }
  if (template === 'xuanhuange') {
    const url = `${base}/sort${categoryId}/${page}/`
    const result = await requestPage(url, { headers: { Referer: `${base}/` } })
    const items = parseXhSearchItems(result.html, base)
    if (!items.length) throw new Error('该分类没有返回书目')
    const totalPages = maxPageIn(
      result.html,
      new RegExp(`/sort${escapeRe(categoryId)}/(\\d+)/`, 'g')
    )
    return { ok: true, items, hasMore: page < totalPages, totalPages }
  }
  if (template === 'qishu5wa') {
    const url = `${base}/sort/${categoryId}_${page}/`
    const result = await requestPage(url, { headers: { Referer: `${base}/` } })
    const items = parseQishuCategoryItems(result.html, 60)
    if (!items.length) throw new Error('该分类没有返回书目')
    const totalPages = maxPageIn(
      result.html,
      new RegExp(`/sort/${escapeRe(categoryId)}_(\\d+)/`, 'g')
    )
    return { ok: true, items, hasMore: page < totalPages, totalPages }
  }
  if (template === 'bqquge') {
    const url = page > 1 ? `${base}/${categoryId}/${page}` : `${base}/${categoryId}`
    const result = await requestPage(url, { headers: { Referer: `${base}/` } })
    const items = parseBqItems(result.html, base)
    const pageText = parse(result.html).querySelector('.page')?.text ?? ''
    const totalPages = Math.max(1, Number(/(\d+)\s*\/\s*(\d+)/.exec(pageText)?.[2] ?? 0))
    if (!items.length) throw new Error('该分类没有返回书目')
    return { ok: true, items, hasMore: page < totalPages, totalPages }
  }
  if (template === 'zuizhong') {
    const url = `${base}/yuedu/${categoryId}/${page}.html`
    const result = await requestPage(url, { headers: { Referer: `${base}/` } })
    const items = parseZzListItems(result.html)
    if (!items.length) throw new Error('该分类没有返回书目')
    await fillZzMeta(base, items)
    const totalPages = maxPageIn(
      result.html,
      new RegExp(`/yuedu/${escapeRe(categoryId)}/(\\d+)\\.html`, 'g')
    )
    return { ok: true, items, hasMore: page < totalPages, totalPages }
  }
  if (template === 'banshanren') {
    const url = `${base}/all/0-${categoryId}-0-0-0-0-1-${page}/`
    const result = await requestPage(url, { headers: { Referer: `${base}/` } })
    const items = parseBsListItems(result.html, base)
    if (!items.length) throw new Error('该分类没有返回书目')
    const totalPages = maxPageIn(result.html, /-1-(\d+)\//g)
    return { ok: true, items, hasMore: page < totalPages, totalPages }
  }
  return { ok: false, items: [], error: '该源不支持分类浏览' }
}


export function normalizeInput(source: NovelSourceInput): NovelSourceInput {
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
    // 哔咔阅读页限流严格：只开 2 路（主进程还会串行排队），其它源保持 5 路
    const workerCount = source.template === 'bikahub' ? 2 : 5
    const workers = Array.from({ length: Math.min(workerCount, chapters.length) }, async () => {
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
