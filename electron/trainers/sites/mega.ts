import { parse } from 'node-html-parser'
import type { TrainerDetail, TrainerDetailResponse, TrainerDownloadFile, TrainerListItem } from '../../../src/shared/trainers'
import { absUrl, fetchText, linesOf, type NormalizedSource } from '../common'
export function isPlitch(title: string): boolean {
  return /^plitch\b/i.test(title.trim())
}

export function parseMegaSearch(html: string, base: string, source: NormalizedSource) {
  const doc = parse(html)
  const items: TrainerListItem[] = []
  const seen = new Set<string>()
  for (const block of doc.querySelectorAll('.search-category')) {
    const heading = block.querySelector('.category-title')?.text.trim().toLowerCase() ?? ''
    if (heading !== 'trainer' && heading !== 'trainers') continue
    for (const link of block.querySelectorAll('a[href]')) {
      const url = absUrl(link.getAttribute('href') ?? '', base)
      if (!url.includes('/trainers/')) continue
      if (seen.has(url)) continue
      const title = link.text.replace(/\s+/g, ' ').trim()
      if (!title || isPlitch(title)) continue
      seen.add(url)
      items.push({
        id: url.replace(/\/+$/, '').split('/').pop() ?? url,
        title,
        url,
        cover: null,
        date: '',
        sourceId: source.id,
        sourceName: source.name
      })
    }
  }
  return { items, hasMore: false }
}

export function parseMegaList(html: string, base: string, source: NormalizedSource) {
  const doc = parse(html)
  const items: TrainerListItem[] = []
  const seen = new Set<string>()
  const block = doc.querySelector('.recent-trainers')
  const scope = block?.parentNode ?? doc
  for (const card of scope.querySelectorAll('.card-home')) {
    const link = card.querySelector('a[href]')
    if (!link) continue
    const url = absUrl(link.getAttribute('href') ?? '', base)
    if (!url.includes('/trainers/')) continue
    if (seen.has(url)) continue
    const img = card.querySelector('img')
    const cover =
      img?.getAttribute('data-lazy-src') ?? img?.getAttribute('src') ?? ''
    const title =
      card.querySelector('.card-home-title')?.text.replace(/\s+/g, ' ').trim() ||
      img?.getAttribute('alt')?.replace(/\s+/g, ' ').trim() ||
      ''
    if (!title || isPlitch(title)) continue
    seen.add(url)
    items.push({
      id: url.replace(/\/+$/, '').split('/').pop() ?? url,
      title,
      url,
      cover: cover && /^https?:/i.test(cover) ? cover : null,
      date: '',
      sourceId: source.id,
      sourceName: source.name
    })
  }
  return { items: items.slice(0, 30), hasMore: false }
}

export async function megagamesSearch(
  source: NormalizedSource,
  keyword: string,
  page: number
): Promise<{ items: TrainerListItem[]; hasMore: boolean; pageCount: number }> {
  // MegaGames 搜索结果只有一页，翻页直接用空结果
  if (page > 1) return { items: [], hasMore: false, pageCount: 0 }
  if (keyword) {
    const html = await fetchText(
      `${source.baseUrl}/results?query=${encodeURIComponent(keyword)}`,
      `${source.baseUrl}/`
    )
    return { ...parseMegaSearch(html, source.baseUrl, source), pageCount: 0 }
  }
  const html = await fetchText(`${source.baseUrl}/trainers`, `${source.baseUrl}/`)
  return { ...parseMegaList(html, source.baseUrl, source), pageCount: 0 }
}

export function megaVersion(title: string): string {
  const match = /(v\d[\d.]*(?:\s*-\s*v?[\d.*]+)?\+?)/i.exec(title)
  return match?.[1]?.replace(/\s+/g, '') ?? ''
}

export function megaOptionsCount(title: string): number {
  const match = /(?:\+|plus[.\s]?)\s*(\d+)\s*trainer/i.exec(title) ?? /\((\d+)\s*trainer/i.exec(title)
  return match ? Number(match[1]) : 0
}

export function parseMegaDetail(html: string, url: string, source: NormalizedSource): TrainerDetail {
  const doc = parse(html)
  const title =
    (doc.querySelector('.trainer-title')?.text ?? '').replace(/\s+/g, ' ').trim() ||
    (doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? '').trim()
  const trainerImage = doc.querySelector('.trainer-image')
  const cover =
    trainerImage?.getAttribute('data-lazy-src')?.trim() ||
    trainerImage?.getAttribute('src')?.trim() ||
    doc.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim() ||
    null
  const updatedAt =
    /"(?:dateModified|datePublished)":"(\d{4}-\d{2}-\d{2})/.exec(html)?.[1] ?? ''

  const desc = doc.querySelector('.trainer-desc')
  // 正文被包在 <pre> 里，直接查 p / li 拿不到，先把 pre 的内容重新解析一次
  const pre = desc?.querySelector('pre')
  const content = pre
    ? parse(`<div>${pre.innerHTML}</div>`, { comment: false }).querySelector('div')
    : desc
  const summaryParts: string[] = []
  const options: string[] = []
  const notes: string[] = []
  const screenshots: string[] = []
  if (content) {
    for (const p of content.querySelectorAll('p')) {
      const text = p.text.replace(/\s+/g, ' ').trim()
      if (!text || /^(num|crtl|ctrl|alt|shift|f\d)/i.test(text)) continue
      if (summaryParts.length >= 3) break
      summaryParts.push(text)
    }
    // 修改项：Num 1 / Ctrl+Num 1 / Alt+Num 1 开头的条目
    for (const li of content.querySelectorAll('li')) {
      const text = li.text.replace(/\s+/g, ' ').trim()
      if (!/^(num|crtl|ctrl|alt|shift|f\d)/i.test(text)) continue
      if (text && !options.includes(text)) options.push(text)
    }
    // 使用说明：Launch Notes 之后的段落
    const headings = content.querySelectorAll('h2,h3')
    const notesHeading = headings.find((h) => /launch notes|notes|使用说明/i.test(h.text))
    let sibling = notesHeading?.nextElementSibling ?? null
    while (sibling && !/^H2$/i.test(sibling.rawTagName ?? '')) {
      for (const line of linesOf(sibling)) {
        if (line && !notes.includes(line)) notes.push(line)
      }
      sibling = sibling.nextElementSibling
    }
    for (const img of content.querySelectorAll('img')) {
      const src = img.getAttribute('data-lazy-src') ?? img.getAttribute('src') ?? ''
      if (!src || !/^https?:/i.test(src)) continue
      if (/themes\/|assets\/|\.svg($|\?)|logo|plitch/i.test(src)) continue
      if (screenshots.includes(src)) continue
      screenshots.push(src)
    }
  }

  const downloads: TrainerDownloadFile[] = []
  const seenDownloads = new Set<string>()
  for (const link of doc.querySelectorAll('.single-trainer-line a[href], .download-plitch-trainer a[href]')) {
    const href = absUrl(link.getAttribute('href') ?? '', source.baseUrl)
    if (!href || seenDownloads.has(href)) continue
    if (!/\.(zip|rar|7z|exe)(\?|$)/i.test(href)) continue
    seenDownloads.add(href)
    const nameAttr =
      (link.getAttribute('title') ?? '')
        .replace(/^Download\s+/i, '')
        .replace(/\s+now$/i, '')
        .trim() || link.text.replace(/\s+/g, ' ').trim()
    downloads.push({
      name: nameAttr || '下载',
      url: href,
      date: updatedAt,
      size: ''
    })
  }

  return {
    id: url.replace(/\/+$/, '').split('/').pop() ?? url,
    title: title || '修改器详情',
    url,
    cover: cover ? absUrl(cover, source.baseUrl) : null,
    sourceId: source.id,
    sourceName: source.name,
    version: megaVersion(title),
    optionsCount: megaOptionsCount(title) || options.length,
    updatedAt,
    summary: summaryParts.join(' ').slice(0, 600),
    options: options.slice(0, 200),
    notes: notes.slice(0, 40),
    screenshots: screenshots.slice(0, 12),
    downloads
  }
}

export async function megagamesDetail(
  source: NormalizedSource,
  url: string
): Promise<TrainerDetailResponse> {
  const html = await fetchText(url, `${source.baseUrl}/`)
  return { ok: true, trainer: parseMegaDetail(html, url, source) }
}

/* ------------------------------ 3DM / 游民星空 / 游侠网 ------------------------------ */

export type TrainerCategory = 'trainer' | 'save'

/** 从源地址判断是修改器分区还是存档分区 */
