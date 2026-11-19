import { parse } from 'node-html-parser'
import { normalizeNovelStatus, type NovelItem, type NovelChapter, type NovelDetail } from '../../src/shared/novel'
import { escapeRe, originOf, requestPage, metaMap, plainText, htmlToText, absoluteUrl, cleanIntro, parseChapterAnchors, fillHomeMeta, MAX_CATALOG_PAGES, CHAPTER_NAV_NAMES } from './common'
import { attrValue, finalizeChaptersById, sortChaptersById } from './sitesA'

export function parseXyHomeItems(html: string, limit: number): NovelItem[] {
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

export function parseXySearchItems(html: string): NovelItem[] {
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

export async function fetchXyChapters(
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

export async function fetchXyDetail(base: string, bookId: string): Promise<NovelDetail> {
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

export type XhLikeMode = 'xhytd' | 'ajnnan'

export function xhLikeBookId(href: string, mode: XhLikeMode): string | null {
  if (mode === 'xhytd') {
    const match = /^\/(\d+)\/(\d+)\/?$/.exec(href)
    return match ? `${match[1]}_${match[2]}` : null
  }
  const match = /^\/(\d+_\d+)\/?$/.exec(href)
  return match ? match[1] : null
}

/** 黄易 / 无极的封面地址可以直接由书籍编号拼出 */
export function xhLikeCover(base: string, bookId: string): string {
  const parts = bookId.split('_')
  if (parts.length !== 2) return ''
  return `${base}/files/article/image/${parts[0]}/${parts[1]}/${parts[1]}s.jpg`
}

export function parseXhLikeHomeItems(
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

export function parseXhLikeSearchItems(html: string, base: string, mode: XhLikeMode): NovelItem[] {
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

/** 黄易新站分类页 /xclass/<n>/<page>.html：每页 20 本 */
export function parseXhytdCategoryItems(html: string, base: string): NovelItem[] {
  const root = parse(html)
  const items: NovelItem[] = []
  const seen = new Set<string>()
  for (const block of root.querySelectorAll('.hot_sale')) {
    const link = block.querySelector('.bookinfo a') ?? block.querySelector('a')
    const bookId = xhLikeBookId(attrValue(link, 'href'), 'xhytd')
    const title =
      block.querySelector('.title')?.text.trim() ||
      block.querySelector('.bookinfo a')?.text.trim() ||
      ''
    if (!bookId || !title || seen.has(bookId)) continue
    seen.add(bookId)
    items.push({
      bookId,
      title,
      author: block.querySelector('.author a')?.text.trim() ?? '',
      cover:
        absoluteUrl(
          base,
          attrValue(block.querySelector('.bookimg img'), 'data-original') ||
            attrValue(block.querySelector('.bookimg img'), 'src')
        ) || xhLikeCover(base, bookId),
      status: ''
    })
  }
  return items
}

/** 无极新站的小说大全列表：/xiaoshuodaquan/<n>.html 一次性列出整类书目 */
export const ajnnanFullCache = new Map<string, { items: NovelItem[]; at: number }>()
export const AJNNAN_FULL_TTL = 30 * 60 * 1000
export const AJNNAN_FULL_PAGE_SIZE = 60

export async function fetchAjnnanFullCategory(base: string, index: string): Promise<NovelItem[]> {
  const key = `${originOf(base)}|${index}`
  const cached = ajnnanFullCache.get(key)
  if (cached && Date.now() - cached.at < AJNNAN_FULL_TTL) return cached.items
  const page = await requestPage(`${base}/xiaoshuodaquan/${index}.html`, {
    headers: { Referer: `${base}/` }
  })
  const root = parse(page.html)
  const items: NovelItem[] = []
  const seen = new Set<string>()
  for (const row of root.querySelectorAll('.novellist li')) {
    const link = row.querySelector('a')
    const bookId = /^\/(\d+_\d+)\/?$/.exec(attrValue(link, 'href'))?.[1] ?? ''
    const title = link?.text.trim() ?? ''
    if (!bookId || !title || seen.has(bookId)) continue
    seen.add(bookId)
    items.push({
      bookId,
      title,
      author: '',
      cover: xhLikeCover(base, bookId),
      status: ''
    })
  }
  ajnnanFullCache.set(key, { items, at: Date.now() })
  return items
}

export async function fetchXhLikeDetail(
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
  let chapters: NovelChapter[] = []
  for (const link of chapterLinks) {
    const chapterId = /(\d+)\.html$/.exec(attrValue(link, 'href'))?.[1] ?? ''
    const name = link.text.trim()
    if (chapterId && name && !CHAPTER_NAV_NAMES.test(name)) {
      chapters.push({ id: chapterId, name, index: 0 })
    }
  }
  // 黄易新站是移动模板：详情页没有 #info / #list，完整目录在 /{dir}/{id}/all.html
  if (!chapters.length && mode === 'xhytd') {
    try {
      const all = await requestPage(`${base}/${path}/all.html`, { headers: { Referer: `${base}/` } })
      const allRoot = parse(all.html)
      const chapterPattern = new RegExp(`^/${escapeRe(path)}/(\\d+)\\.html$`)
      for (const link of allRoot.querySelectorAll('a')) {
        const chapterId = chapterPattern.exec(attrValue(link, 'href'))?.[1] ?? ''
        const name = link.text.trim()
        if (chapterId && name && !CHAPTER_NAV_NAMES.test(name)) {
          chapters.push({ id: chapterId, name, index: 0 })
        }
      }
    } catch {
      // 完整目录取不到时保留详情页已有的章节
    }
  }
  const metaTitle = metas['og:novel:book_name'] || metas['og:title'] || ''
  const rawCover = metas['og:image'] || ''
  const metaCover =
    rawCover && !/nocov|no-cover|default/i.test(rawCover) ? absoluteUrl(base, rawCover) : ''
  return {
    bookId,
    title:
      root.querySelector('#info h1')?.text.trim() || metaTitle || `书籍 ${bookId}`,
    author: root.querySelector('#info p a')?.text.trim() || metas['og:novel:author'] || '',
    cover:
      absoluteUrl(base, attrValue(root.querySelector('#fmimg img'), 'src')) ||
      metaCover ||
      xhLikeCover(base, bookId),
    intro:
      htmlToText(root.querySelector('#intro')?.innerHTML ?? '') ||
      cleanIntro(metas['og:description'] || metas['description'] || '', 'xhytd'),
    category: category || metas['og:novel:category'] || '',
    status,
    latestChapter:
      info[info.length - 1]?.querySelector('a')?.text.trim() ||
      metas['og:novel:latest_chapter_name'] ||
      '',
    chapters: sortChaptersById(chapters)
  }
}

// ---------- 笔趣阁（bqquge） ----------

export function parseBqItems(html: string, base: string, limit = 60): NovelItem[] {
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

export async function fetchBqDetail(base: string, bookId: string): Promise<NovelDetail> {
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

export function parseZzListItems(html: string, limit = 60): NovelItem[] {
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

export function parseZzSearchItems(html: string): NovelItem[] {
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

export async function fetchZzMeta(base: string, bookId: string): Promise<Partial<NovelItem>> {
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
export async function fillZzMeta(base: string, items: NovelItem[]): Promise<void> {
  await fillHomeMeta(items, (item) => fetchZzMeta(base, item.bookId))
}

export async function fetchZzDetail(base: string, bookId: string): Promise<NovelDetail> {
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

export function parseBsListItems(html: string, base: string, limit = 60): NovelItem[] {
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

export function parseBsSearchItems(text: string, base: string): NovelItem[] {
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

export async function fetchBsDetail(base: string, bookId: string): Promise<NovelDetail> {
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
