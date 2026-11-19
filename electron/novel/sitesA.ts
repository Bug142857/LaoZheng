import { parse } from 'node-html-parser'
import { normalizeNovelStatus, type NovelItem, type NovelChapter, type NovelDetail } from '../../src/shared/novel'
import { escapeRe, decodeEntities, requestPage, metaMap, plainText, htmlToText, absoluteUrl, cleanIntro, parseChapterAnchors, novelBookDir, novelCoverById, MAX_CATALOG_PAGES } from './common'

export function mayiBookId(link: string): string | null {
  const path = link.split('#')[0].split('?')[0]
  const match = /\/(\d+_\d+)\/(?:index\.html)?$/.exec(path)
  return match ? match[1] : null
}

/** 蚂蚁文学的封面地址可以从书籍编号直接拼出来（缺失时站点会返回 404，由前端兜底） */
export function mayiCover(base: string, bookId: string): string {
  const parts = bookId.split('_')
  if (parts.length !== 2) return ''
  return `${base}/files/article/image/${parts[0]}/${parts[1]}/${parts[1]}s.jpg`
}

export interface MayiMeta {
  bookId: string
  title: string
  author: string
  cover: string
}

/** 从首页 / 分类页收集书籍信息：封面、作者、书名（同一本书只保留信息最全的一条） */
export function collectMayiMeta(html: string, base: string): MayiMeta[] {
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

export function parseMayiHomeItems(html: string, base: string, limit: number): NovelItem[] {
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
export function parseMayiSearchItems(html: string, base: string): NovelItem[] {
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
export async function fetchMayiStatus(
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
export async function enrichMayiStatuses(base: string, items: NovelItem[]): Promise<void> {
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

export function attrValue(element: { getAttribute: (name: string) => string | undefined } | null, name: string): string {
  return element?.getAttribute(name)?.trim() ?? ''
}

/** 只按章节 id 去重，保留站点原有顺序（卷名 / 番外不会被章节号排序打乱） */
export function finalizeChaptersById(list: NovelChapter[]): NovelChapter[] {
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
export function sortChaptersById(list: NovelChapter[]): NovelChapter[] {
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

export function parse95HomeItems(html: string, base: string, limit: number): NovelItem[] {
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

export function parse95SearchItems(html: string, base: string): NovelItem[] {
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

export interface DetailMeta extends Omit<NovelDetail, 'chapters'> {
  tocUrl: string
}

export async function fetch95Meta(base: string, bookId: string): Promise<DetailMeta> {
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

export function parse95Chapters(html: string): NovelChapter[] {
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

export function parseXhHomeItems(html: string, base: string, limit: number): NovelItem[] {
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

export function parseXhSearchItems(html: string, base: string): NovelItem[] {
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

export async function fetchXhDetail(base: string, bookId: string): Promise<NovelDetail> {
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
export function parse5waHomeItems(html: string, limit: number): NovelItem[] {
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

export function parse5waMeta(
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

export async function fetch5waMeta(base: string, bookId: string): Promise<Omit<NovelDetail, 'chapters'>> {
  const [dir, id] = bookId.split('_')
  if (!dir || !id) throw new Error('书籍编号无效')
  const page = await requestPage(`${base}/${dir}/${id}/`, { headers: { Referer: `${base}/` } })
  return parse5waMeta(page.html, base, bookId)
}

export async function fetch5waDetail(base: string, bookId: string): Promise<NovelDetail> {
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

export function parse5waSearchItems(html: string): NovelItem[] {
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

