import { parse } from 'node-html-parser'
import type { TrainerDetail, TrainerDetailResponse, TrainerDownloadFile, TrainerListItem } from '../../../src/shared/trainers'
import { MONTHS, UA, absUrl, fetchText, linesOf, type NormalizedSource } from '../common'
export function parseFlingList(html: string, base: string, source: NormalizedSource, page: number) {
  const doc = parse(html)
  const items: TrainerListItem[] = []
  const seen = new Set<string>()
  for (const card of doc.querySelectorAll('article')) {
    const link = card.querySelector('.post-title a')
    if (!link) continue
    const url = absUrl(link.getAttribute('href') ?? '', base)
    if (!url.includes('/trainer/')) continue
    if (seen.has(url)) continue
    seen.add(url)
    const title = link.text.replace(/\s+/g, ' ').trim()
    if (!title) continue
    const id = url.replace(/\/+$/, '').split('/').pop() ?? url
    const cover = card.querySelector('.post-details-thumb img')?.getAttribute('src') ?? ''
    const day = card.querySelector('.post-details-day')?.text.trim() ?? ''
    const month = card.querySelector('.post-details-month')?.text.trim() ?? ''
    const year = card.querySelector('.post-details-year')?.text.trim() ?? ''
    const date =
      year && MONTHS[month] && day ? `${year}-${MONTHS[month]}-${day.padStart(2, '0')}` : ''
    items.push({
      id,
      title,
      url,
      cover: cover ? absUrl(cover, base) : null,
      date,
      sourceId: source.id,
      sourceName: source.name
    })
  }
  return {
    items,
    hasMore: Boolean(doc.querySelector('.pagination .next a')),
    page
  }
}

/** 风灵月影列表每页 15 条；WordPress 分页条只有上一页/下一页，总数走 REST 头折算 */
export const FLING_PAGE_SIZE = 15
export const flingCountCache = new Map<string, { at: number; count: number }>()

export async function flingPostCount(source: NormalizedSource, keyword: string): Promise<number> {
  const key = `${source.baseUrl}|${keyword}`
  const cached = flingCountCache.get(key)
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.count
  try {
    let query = ''
    if (keyword) {
      query = `search=${encodeURIComponent(keyword)}`
    } else {
      const catRes = await fetch(`${source.baseUrl}/wp-json/wp/v2/categories?slug=trainer`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(15_000)
      })
      if (!catRes.ok) return 0
      const categories = (await catRes.json()) as { id?: number }[]
      const categoryId = categories[0]?.id
      if (!categoryId) return 0
      query = `categories=${categoryId}`
    }
    const res = await fetch(
      `${source.baseUrl}/wp-json/wp/v2/posts?${query}&per_page=1&_fields=id`,
      {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(15_000)
      }
    )
    if (!res.ok) return 0
    const total = Number(res.headers.get('x-wp-total') ?? 0)
    const count = Number.isFinite(total) && total > 0 ? total : 0
    flingCountCache.set(key, { at: Date.now(), count })
    return count
  } catch {
    return 0
  }
}

export async function flingSearch(
  source: NormalizedSource,
  keyword: string,
  page: number
): Promise<{ items: TrainerListItem[]; hasMore: boolean; page: number; pageCount: number }> {
  const url = keyword
    ? `${source.baseUrl}/page/${page}/?s=${encodeURIComponent(keyword)}`
    : `${source.baseUrl}/category/trainer/page/${page}/`
  const html = await fetchText(url, `${source.baseUrl}/`)
  const parsed = parseFlingList(html, source.baseUrl, source, page)
  const total = await flingPostCount(source, keyword)
  const pageCount = total > 0 ? Math.ceil(total / FLING_PAGE_SIZE) : 0
  return { ...parsed, pageCount }
}

export function parseFlingDetail(
  html: string,
  url: string,
  source: NormalizedSource
): TrainerDetail {
  const doc = parse(html)
  const title =
    (doc.querySelector('h1.post-title')?.text ?? '').replace(/\s+/g, ' ').trim() ||
    (doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? '').trim()
  const cover =
    doc.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim() || null
  const entry = doc.querySelector('.entry')
  const entryText = entry?.text ?? ''
  const optionsMatch = /(\d+)\s*Options/i.exec(entryText)
  const versionMatch = /Game Version:?\s*([^\u00b7\n]+)/i.exec(entryText)
  const updatedMatch = /Last Updated:?\s*([0-9.\-/]+)/i.exec(entryText)

  const options: string[] = []
  if (entry) {
    for (const p of entry.querySelectorAll('p')) {
      const style = p.getAttribute('style') ?? ''
      if (!/padding-left/i.test(style)) continue
      for (const line of linesOf(p)) {
        if (line && !options.includes(line)) options.push(line)
      }
    }
  }

  const notes: string[] = []
  if (entry) {
    const headings = entry.querySelectorAll('h1,h2,h3,h4,h5,h6')
    const notesHeading = headings.find((h) => /special notes|important notes|notes/i.test(h.text))
    let sibling = notesHeading?.nextElementSibling ?? null
    while (sibling && !sibling.classList.contains('download-attachments')) {
      if (/^(SCRIPT|STYLE)$/.test(sibling.rawTagName?.toUpperCase() ?? '')) {
        sibling = sibling.nextElementSibling
        continue
      }
      for (const line of linesOf(sibling)) {
        if (line && !notes.includes(line)) notes.push(line)
      }
      sibling = sibling.nextElementSibling
    }
  }

  const screenshots: string[] = []
  if (entry) {
    for (const img of entry.querySelectorAll('img')) {
      const src = absUrl(img.getAttribute('src') ?? '', source.baseUrl)
      if (!src.includes('/wp-content/uploads/')) continue
      if (/tooltip-icon|ext\/(zip|rar|7z)/i.test(src)) continue
      if (screenshots.includes(src)) continue
      screenshots.push(src)
    }
  }

  const downloads: TrainerDownloadFile[] = []
  for (const row of doc.querySelectorAll('.download-attachments tbody tr')) {
    const link = row.querySelector('a.attachment-link')
    if (!link) continue
    const href = absUrl(link.getAttribute('href') ?? '', source.baseUrl)
    if (!href) continue
    const name =
      (link.getAttribute('title') ?? '').trim() ||
      link.text.replace(/\s+/g, ' ').trim() ||
      '下载'
    downloads.push({
      name,
      url: href,
      date: row.querySelector('.attachment-date')?.text.trim() ?? '',
      size: row.querySelector('.attachment-size')?.text.trim() ?? ''
    })
  }

  return {
    id: url.replace(/\/+$/, '').split('/').pop() ?? url,
    title: title || '修改器详情',
    url,
    cover: cover ? absUrl(cover, source.baseUrl) : null,
    sourceId: source.id,
    sourceName: source.name,
    version: (versionMatch?.[1] ?? '').trim(),
    optionsCount: optionsMatch ? Number(optionsMatch[1]) : options.length,
    updatedAt: (updatedMatch?.[1] ?? '').trim(),
    summary: '',
    options: options.slice(0, 200),
    notes: notes.slice(0, 60),
    screenshots: screenshots.slice(0, 12),
    downloads
  }
}

export async function flingDetail(
  source: NormalizedSource,
  url: string
): Promise<TrainerDetailResponse> {
  const html = await fetchText(url, `${source.baseUrl}/`)
  return { ok: true, trainer: parseFlingDetail(html, url, source) }
}

/* ------------------------------ MegaGames ------------------------------ */

