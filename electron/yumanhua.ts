import { parse } from 'node-html-parser'
import { session } from 'electron'
import { evaluateRenderedPage } from './browserPage'
import {
  YUMANHUA_PAGE_SIZE,
  yumanhuaId,
  yumanhuaSlug,
  yumanhuaSourceId,
  type YumanhuaChapter,
  type YumanhuaChaptersResponse,
  type YumanhuaComic,
  type YumanhuaDetailResponse,
  type YumanhuaImagesResponse,
  type YumanhuaListResponse
} from '../src/shared/yumanhua'

/**
 * 漫画客（yumanhua.com）客户端。
 *
 * 列表 / 搜索 / 详情用 Chromium 的 session.fetch 取 HTML（站点会拦 Node fetch，
 * 但桌面版页面在 Electron 里可正常返回）；章节图由前端 JS 生成，必须用隐藏
 * 浏览器渲染后再读 .main_img img 的 data-src。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const DEFAULT_BASE = 'http://www.yumanhua.com'
const TIMEOUT_MS = 20_000

function basesFor(baseUrl?: string): { desktop: string; mobile: string } {
  const raw = (baseUrl || DEFAULT_BASE).trim().replace(/\/+$/, '')
  try {
    const url = new URL(raw)
    const host = url.hostname.replace(/^m\./i, '').replace(/^www\./i, '')
    return {
      desktop: `${url.protocol}//www.${host}`,
      mobile: `${url.protocol}//m.${host}`
    }
  } catch {
    return { desktop: DEFAULT_BASE, mobile: 'http://m.yumanhua.com' }
  }
}
const imageCache = new Map<string, { urls: string[]; at: number }>()
const IMAGE_TTL = 10 * 60 * 1000

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
  return decodeEntities(String(value ?? '').replace(/<[^>]+>/g, '')).trim()
}

function attr(node: { getAttribute: (name: string) => string | undefined } | null, name: string): string {
  return node?.getAttribute(name)?.trim() ?? ''
}

async function fetchHtml(url: string, init: RequestInit = {}, referer?: string): Promise<{ html: string; status: number }> {
  const res = await session.defaultSession.fetch(url, {
    ...init,
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: referer ?? `${basesFor().mobile}/`,
      ...(init.headers as Record<string, string> | undefined)
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  return { html: await res.text(), status: res.status }
}

function slugFromHref(href: string): string {
  const match = /^\/([A-Za-z0-9]+)\/?$/.exec(href.trim())
  return match ? match[1] : ''
}

/** 兼容「第12话」「12回 标题」「01」「第107.2话」几种写法 */
function chapterNumber(name: string): number | null {
  const value = name.trim()
  let index = value.startsWith('第') ? 1 : 0
  while (index < value.length && (value[index] === ' ' || value[index] === '\u3000')) index += 1
  let digits = ''
  while (index < value.length && value[index] >= '0' && value[index] <= '9') {
    digits += value[index]
    index += 1
  }
  // 107.2 这类小数章节
  if (
    digits &&
    value[index] === '.' &&
    value[index + 1] >= '0' &&
    value[index + 1] <= '9'
  ) {
    digits += '.'
    index += 1
    while (index < value.length && value[index] >= '0' && value[index] <= '9') {
      digits += value[index]
      index += 1
    }
  }
  if (!digits) return null
  while (index < value.length && (value[index] === ' ' || value[index] === '\u3000')) index += 1
  const unit = value[index]
  if (unit && unit !== '话' && unit !== '回' && unit !== '集' && unit !== '章') return null
  return Number(digits)
}

function coverFrom(node: ReturnType<typeof parse> | null, selector: string): string {
  const img = node?.querySelector(selector) ?? null
  const raw = attr(img, 'data-src') || attr(img, 'src')
  return /load\.gif|loaderr|static\/images/i.test(raw) ? '' : raw
}

function parseRankItems(html: string, sourceId = 'yumanhua'): YumanhuaComic[] {
  const root = parse(html)
  const items: YumanhuaComic[] = []
  const seen = new Set<string>()
  for (const row of root.querySelectorAll('.rank-list li')) {
    const link = row.querySelector('.poster-box a') ?? row.querySelector('.simple-info a')
    const slug = slugFromHref(attr(link, 'href'))
    const title = text(row.querySelector('h2')?.text) || attr(link, 'title')
    if (!slug || !title || seen.has(slug)) continue
    seen.add(slug)
    const paragraphs = row.querySelectorAll('.simple-info p').map((node) => text(node.text))
    const author = paragraphs.find((value) => value && !value.startsWith('最新：')) ?? ''
    const latest = paragraphs.find((value) => value.startsWith('最新：'))?.replace(/^最新[:：]\s*/, '') ?? ''
    items.push({
      id: yumanhuaId(slug, sourceId),
      title,
      cover: coverFrom(row, '.cartoon-poster') || coverFrom(row, 'img'),
      author,
      tags: [],
      status: '',
      latest,
      intro: text(row.querySelector('.cartoon-introduction span')?.text)
    })
  }
  if (items.length) return items
  for (const row of root.querySelectorAll('.mult-body li')) {
    const link = row.querySelector('a')
    const slug = slugFromHref(attr(link, 'href'))
    const title = attr(link, 'title') || text(row.querySelector('.card-title')?.text)
    if (!slug || !title || seen.has(slug)) continue
    seen.add(slug)
    const paragraphs = row.querySelectorAll('p').map((node) => text(node.text))
    items.push({
      id: yumanhuaId(slug, sourceId),
      title,
      cover: coverFrom(row, 'img'),
      author: '',
      tags: [],
      status: '',
      latest: paragraphs.find((value) => value && value !== title) ?? '',
      intro: ''
    })
  }
  return items
}

function parseSearchItems(html: string, sourceId = 'yumanhua'): YumanhuaComic[] {
  const root = parse(html)
  const items: YumanhuaComic[] = []
  const seen = new Set<string>()
  for (const row of root.querySelectorAll('.col-auto')) {
    const link = row.querySelector('a')
    const slug = slugFromHref(attr(link, 'href'))
    const title = text(row.querySelector('.e-title')?.text) || attr(row.querySelector('img'), 'alt')
    if (!slug || !title || seen.has(slug)) continue
    seen.add(slug)
    items.push({
      id: yumanhuaId(slug, sourceId),
      title,
      cover: coverFrom(row, 'img'),
      author: text(row.querySelector('.tip')?.text),
      tags: [],
      status: '',
      latest: '',
      intro: ''
    })
  }
  return items
}

export async function yumanhuaRecent(
  baseUrl?: string,
  sourceId = 'yumanhua'
): Promise<YumanhuaListResponse> {
  try {
    const { mobile } = basesFor(baseUrl)
    const { html, status } = await fetchHtml(`${mobile}/rank/5`, {}, `${mobile}/`)
    if (status !== 200) throw new Error(`HTTP ${status}`)
    const items = parseRankItems(html, sourceId)
    if (!items.length) throw new Error('站点没有返回可解析的漫画')
    return { ok: true, items, hasMore: false }
  } catch (err) {
    return { ok: false, items: [], error: err instanceof Error ? err.message : '加载失败' }
  }
}

export async function yumanhuaHot(
  baseUrl?: string,
  sourceId = 'yumanhua'
): Promise<YumanhuaListResponse> {
  try {
    const { mobile } = basesFor(baseUrl)
    const { html, status } = await fetchHtml(`${mobile}/rank/1`, {}, `${mobile}/`)
    if (status !== 200) throw new Error(`HTTP ${status}`)
    const items = parseRankItems(html, sourceId)
    if (!items.length) throw new Error('站点没有返回可解析的漫画')
    return { ok: true, items, hasMore: false }
  } catch (err) {
    return { ok: false, items: [], error: err instanceof Error ? err.message : '加载失败' }
  }
}

export async function yumanhuaCategory(
  categoryId: string,
  baseUrl?: string,
  sourceId = 'yumanhua'
): Promise<YumanhuaListResponse> {
  try {
    if (!/^\d{1,3}$/.test(categoryId)) throw new Error('分类参数无效')
    const { mobile } = basesFor(baseUrl)
    const { html, status } = await fetchHtml(`${mobile}/sort/${categoryId}`, {}, `${mobile}/`)
    if (status !== 200) throw new Error(`HTTP ${status}`)
    const items = parseRankItems(html, sourceId)
    if (!items.length) throw new Error('该分类没有返回漫画')
    return { ok: true, items, hasMore: false }
  } catch (err) {
    return { ok: false, items: [], error: err instanceof Error ? err.message : '加载失败' }
  }
}

export async function yumanhuaSearch(
  keyword: string,
  baseUrl?: string,
  sourceId = 'yumanhua'
): Promise<YumanhuaListResponse> {
  try {
    const query = keyword.trim()
    if (!query) return { ok: true, items: [], hasMore: false }
    const { desktop } = basesFor(baseUrl)
    const { html, status } = await fetchHtml(
      `${desktop}/s`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: `${desktop}/`
        },
        body: `k=${encodeURIComponent(query)}`
      },
      `${desktop}/`
    )
    if (status !== 200) throw new Error(`HTTP ${status}`)
    const items = parseSearchItems(html, sourceId)
    return { ok: true, items, hasMore: false }
  } catch (err) {
    return { ok: false, items: [], error: err instanceof Error ? err.message : '搜索失败' }
  }
}

export async function yumanhuaDetail(
  id: string,
  baseUrl?: string
): Promise<YumanhuaDetailResponse> {
  try {
    const slug = yumanhuaSlug(id)
    if (!/^[A-Za-z0-9]{1,40}$/.test(slug)) throw new Error('漫画编号无效')
    const { mobile } = basesFor(baseUrl)
    const { html, status } = await fetchHtml(`${mobile}/${slug}/`, {}, `${mobile}/`)
    if (status !== 200) throw new Error(`HTTP ${status}`)
    const root = parse(html)
    const title = text(root.querySelector('h1.name')?.text) || `漫画 ${slug}`
    const tags = root.querySelectorAll('.comic-tags span').map((node) => text(node.text)).filter(Boolean)
    const infoLines = root.querySelectorAll('.comic-info-detail p').map((node) => text(node.text))
    const author =
      infoLines.find((value) => value.startsWith('作者：'))?.replace(/^作者[:：]\s*/, '') || ''
    const latest =
      infoLines.find((value) => value.startsWith('最新：'))?.replace(/^最新[:：]\s*/, '') || ''
    const statusText = tags.includes('完结') ? '已完结' : tags.includes('连载') ? '连载中' : ''
    return {
      ok: true,
      comic: {
        id: yumanhuaId(slug, yumanhuaSourceId(id) || 'yumanhua'),
        title,
        cover: coverFrom(root, '.book-cover img'),
        author,
        tags,
        status: statusText,
        latest,
        intro: text(root.querySelector('.cartoon-introduction p')?.text)
      }
    }
  } catch (err) {
    return { ok: false, comic: null, error: err instanceof Error ? err.message : '详情加载失败' }
  }
}

export async function yumanhuaChapters(
  id: string,
  baseUrl?: string
): Promise<YumanhuaChaptersResponse> {
  const slug = yumanhuaSlug(id)
  if (!/^[A-Za-z0-9]{1,40}$/.test(slug)) return { ok: false, items: [], error: '漫画编号无效' }
  const { desktop, mobile } = basesFor(baseUrl)
  const items: YumanhuaChapter[] = []
  const seen = new Set<string>()
  // 详情页上的 20 条是最新章节，先放进来；/morechapter 有时比网站页面慢半拍
  try {
    const { html } = await fetchHtml(`${mobile}/${slug}/`, {}, `${mobile}/`)
    const root = parse(html)
    for (const link of root.querySelectorAll('.chaplist-box a')) {
      const href = attr(link, 'href')
      const chapterId = /\/([A-Za-z0-9]+)\.html$/.exec(href)?.[1] ?? ''
      const name = text(link.text)
      if (!chapterId || !name || seen.has(chapterId)) continue
      seen.add(chapterId)
      items.push({ id: chapterId, name, index: 0, size: 0 })
    }
  } catch {
    // 详情页取不到时继续用 /morechapter
  }
  try {
    const { html, status } = await fetchHtml(
      `${desktop}/morechapter`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: `${desktop}/${slug}/`
        },
        body: `id=${encodeURIComponent(slug)}`
      },
      `${desktop}/${slug}/`
    )
    if (status === 200) {
      const data = JSON.parse(html) as {
        code?: string | number
        data?: { chapterid?: string; chaptername?: string }[]
      }
      for (const row of data.data ?? []) {
        const chapterId = String(row.chapterid ?? '').trim()
        const name = text(row.chaptername)
        if (!chapterId || !name || seen.has(chapterId)) continue
        seen.add(chapterId)
        items.push({ id: chapterId, name, index: 0, size: 0 })
      }
    }
  } catch {
    // 接口异常时回落到详情页里的 20 个章节
  }

  // 接口按“最新在前”返回；带「第 N 回」的章节按话数升序排到前面，番外等保持原顺序
  const sorted = [...items].sort((a, b) => {
    const na = chapterNumber(a.name)
    const nb = chapterNumber(b.name)
    if (na != null && nb != null) return na - nb
    if (na != null) return -1
    if (nb != null) return 1
    return 0
  })
  return {
    ok: sorted.length > 0,
    items: sorted.map((item, index) => ({ ...item, index: index + 1 })),
    error: sorted.length ? undefined : '站点没有返回章节'
  }
}

export async function yumanhuaImages(
  comicId: string,
  chapterId: string,
  baseUrl?: string
): Promise<YumanhuaImagesResponse> {
  const slug = yumanhuaSlug(comicId)
  if (!/^[A-Za-z0-9]{1,40}$/.test(slug) || !/^[A-Za-z0-9]{1,40}$/.test(chapterId)) {
    return { ok: false, urls: [], error: '章节参数无效' }
  }
  const { mobile } = basesFor(baseUrl)
  const key = `${mobile}/${slug}/${chapterId}`
  const cached = imageCache.get(key)
  if (cached && Date.now() - cached.at < IMAGE_TTL) return { ok: true, urls: cached.urls }
  try {
    const urls = await evaluateRenderedPage<string[]>(
      `${mobile}/${slug}/${chapterId}.html`,
      `(async () => {
        for (let i = 0; i < 40; i++) {
          const nodes = Array.from(document.querySelectorAll('.main_img img'))
          const list = nodes.map((img) => img.getAttribute('data-src') || img.getAttribute('src') || '').filter(Boolean)
          if (list.length) return list
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
        return []
      })()`,
      { waitMs: 500 }
    )
    const clean = urls
      .map((url) => String(url ?? '').trim())
      .filter((url) => /^https?:\/\//i.test(url) && !/load\.gif|loaderr\.gif/i.test(url))
      .filter((url, index, list) => list.indexOf(url) === index)
    if (!clean.length) return { ok: false, urls: [], error: '本章没有解析到图片' }
    imageCache.set(key, { urls: clean, at: Date.now() })
    return { ok: true, urls: clean }
  } catch (err) {
    return { ok: false, urls: [], error: err instanceof Error ? err.message : '图片加载失败' }
  }
}

export { YUMANHUA_PAGE_SIZE }
