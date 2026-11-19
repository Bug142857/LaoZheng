import { parse } from 'node-html-parser'
import type { TrainerDetail, TrainerDownloadFile, TrainerListItem } from '../../../src/shared/trainers'
import { absUrl, decodeThunder, fetchText, isNetdiskUrl, runWithLimit, sourceCategory, type NormalizedSource } from '../common'

/** 3DM 列表页没有封面，按详情页 og:image 补齐；成功缓存 6 小时，失败 10 分钟后重试 */
const COVER_TTL = 6 * 60 * 60 * 1000
const COVER_FAIL_TTL = 10 * 60 * 1000
const trainerCoverCache = new Map<string, { at: number; cover: string | null }>()
export async function fetch3dmCover(url: string): Promise<string | null> {
  const cached = trainerCoverCache.get(url)
  if (cached && Date.now() - cached.at < (cached.cover ? COVER_TTL : COVER_FAIL_TTL)) {
    return cached.cover
  }
  try {
    const html = await fetchText(url, 'https://dl.3dmgame.com/')
    const cover =
      /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1]?.trim() ??
      ''
    const value = /^https?:\/\//i.test(cover) ? cover : null
    trainerCoverCache.set(url, { at: Date.now(), cover: value })
    return value
  } catch {
    trainerCoverCache.set(url, { at: Date.now(), cover: null })
    return null
  }
}

export async function enrich3dmCovers(items: TrainerListItem[]): Promise<void> {
  await runWithLimit(
    items.filter((item) => !item.cover),
    4,
    async (item) => {
      const cover = await fetch3dmCover(item.url)
      if (cover) item.cover = cover
    }
  )
}

export function parse3dmList(html: string, source: NormalizedSource, page: number) {
  const doc = parse(html)
  const items: TrainerListItem[] = []
  const seen = new Set<string>()
  for (const link of doc.querySelectorAll('.dj_patch_list a[href*="/patch/"]')) {
    const url = absUrl(link.getAttribute('href') ?? '', 'https://dl.3dmgame.com')
    if (!/\/patch\/[^/]+\.html$/i.test(url) || seen.has(url)) continue
    const titleEl = link.querySelector('p.p1 span')
    if (!titleEl) continue
    const size = titleEl.querySelector('i')?.text.trim() ?? ''
    const rawTitle = titleEl.text.replace(/\s+/g, ' ').trim()
    const title =
      size && rawTitle.endsWith(size) ? rawTitle.slice(0, -size.length).trim() : rawTitle
    if (!title) continue
    seen.add(url)
    items.push({
      id: url.replace(/\/+$/, '').split('/').pop()?.replace(/\.html$/i, '') ?? url,
      title,
      url,
      cover: null,
      date: link.querySelector('p.p2')?.text.replace(/\s+/g, ' ').trim() ?? '',
      sourceId: source.id,
      sourceName: source.name
    })
  }
  // 分页条带「末页」链接：patch_26_1323 → 共 1323 页
  const lastHref = doc.querySelector('.pagination li.last a')?.getAttribute('href') ?? ''
  const pageCount = Number(/patch_\d+_(\d+)\/?$/.exec(lastHref)?.[1] ?? 0) || page
  return { items, hasMore: Boolean(doc.querySelector('.pagination .next a')), page, pageCount }
}

export async function threeDMBrowse(source: NormalizedSource, page: number) {
  let url = `${source.baseUrl}/`
  if (page > 1) {
    if (!/_1\/?$/.test(source.baseUrl)) return { items: [], hasMore: false, page, pageCount: 0 }
    url = `${source.baseUrl.replace(/_1\/?$/, `_${page}`)}/`
  }
  const html = await fetchText(url, `${source.baseUrl}/`)
  const parsed = parse3dmList(html, source, page)
  await enrich3dmCovers(parsed.items)
  return parsed
}

export async function threeDMSearch(
  source: NormalizedSource,
  keyword: string,
  page: number
): Promise<{ items: TrainerListItem[]; hasMore: boolean; page: number; pageCount: number }> {
  if (!keyword) return threeDMBrowse(source, page)
  const want = sourceCategory(source) === 'save' ? '存档解锁' : '修改器'
  // 3DM 站内搜索按词匹配，带上分区关键词才能把同类补丁搜出来
  const run = async (term: string) => {
    const url = `https://so.3dmgame.com/?keyword=${encodeURIComponent(term)}&type=6&page=${page}`
    const html = await fetchText(url, 'https://so.3dmgame.com/')
    const doc = parse(html)
    const items: TrainerListItem[] = []
    const seen = new Set<string>()
    for (const block of doc.querySelectorAll('.search_lis')) {
      const link = block.querySelector('a.bt')
      if (!link) continue
      const typeText = block
        .querySelectorAll('.info li p')
        .map((p) => p.text.replace(/\s+/g, ' ').trim())
        .find((text) => text.startsWith('类型：'))
      if (typeText && !typeText.includes(want)) continue
      const itemUrl = absUrl(link.getAttribute('href') ?? '', 'https://dl.3dmgame.com')
      if (!/\/patch\//.test(itemUrl) || seen.has(itemUrl)) continue
      const title = link.text.replace(/\s+/g, ' ').trim()
      if (!title) continue
      seen.add(itemUrl)
      const cover = block.querySelector('a.img img')?.getAttribute('src')?.trim() ?? ''
      const text = block.text
      items.push({
        id: itemUrl.replace(/\/+$/, '').split('/').pop()?.replace(/\.html$/i, '') ?? itemUrl,
        title,
        url: itemUrl,
        cover: cover ? absUrl(cover, 'https://dl.3dmgame.com') : null,
        date: /更新：([\d-]+)/.exec(text)?.[1] ?? '',
        sourceId: source.id,
        sourceName: source.name
      })
    }
    const total = Number(/total\s*:\s*(\d+)/.exec(html)?.[1] ?? 0)
    await enrich3dmCovers(items)
    return { items, hasMore: total > page, page, pageCount: 0 }
  }
  const combined = keyword.includes(want === '修改器' ? '修改器' : '存档')
    ? keyword
    : `${keyword} ${want === '存档解锁' ? '存档' : '修改器'}`
  const result = await run(combined)
  if (result.items.length || combined === keyword) return result
  // 英文名 / 特殊关键词加上中文分区词可能搜不到，退回原关键词再试一次
  return run(keyword)
}

export function parse3dmDetail(html: string, url: string, source: NormalizedSource): TrainerDetail {
  const doc = parse(html)
  const title =
    doc.querySelector('h1')?.text.replace(/\s+/g, ' ').trim() ||
    (doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? '').trim() ||
    '修改器详情'
  const cover =
    doc.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim() || null
  const info = doc.querySelectorAll('.lis li').map((li) => li.text.replace(/\s+/g, ' ').trim())
  const infoOf = (label: string): string =>
    info
      .find((line) => line.startsWith(label))
      ?.slice(label.length)
      .replace(/^[:：\s]+/, '')
      .trim() ?? ''
  const updatedAt = infoOf('整理时间')
  const size = infoOf('大小')
  const version = infoOf('版本')

  const content = /<div class="GmL_1">([\s\S]*?)<div class="L_title/i.exec(html)?.[1] ?? ''
  const contentDoc = content ? parse(`<div>${content}</div>`).querySelector('div') : null
  const isSave = sourceCategory(source) === 'save'
  const options: string[] = []
  const notes: string[] = []
  if (contentDoc) {
    for (const p of contentDoc.querySelectorAll('p')) {
      const line = p.text.replace(/\s+/g, ' ').trim()
      if (!line || /^功能列表$/.test(line)) continue
      if (/^By\s/i.test(line)) continue
      if (line.length < 30 && /修改器|存档|trainer/i.test(line) && !/无限|解锁|修改[^器]/.test(line)) {
        continue
      }
      const list = isSave ? notes : options
      if (!list.includes(line)) list.push(line)
    }
  }

  const screenshots: string[] = []
  if (contentDoc) {
    for (const img of contentDoc.querySelectorAll('img')) {
      const src = absUrl(img.getAttribute('src') ?? '', source.baseUrl)
      if (!src || !/^https?:/i.test(src)) continue
      if (screenshots.includes(src)) continue
      screenshots.push(src)
    }
  }

  const downloads: TrainerDownloadFile[] = []
  const seen = new Set<string>()
  const addDownload = (href: string, name: string) => {
    if (!/^https?:/i.test(href) || seen.has(href)) return
    seen.add(href)
    downloads.push({
      name: name || '下载',
      url: href,
      date: updatedAt,
      size,
      external: isNetdiskUrl(href)
    })
  }
  // 先收普通 http 地址，再用迅雷专用链接兜底，避免直接下载项被标成「迅雷下载」
  for (const link of doc.querySelectorAll('.dllist a')) {
    const href = link.getAttribute('href') ?? ''
    if (!/^https?:/i.test(href)) continue
    addDownload(href, link.text.replace(/\s+/g, ' ').trim())
  }
  for (const link of doc.querySelectorAll('.dllist a[data-href]')) {
    const dataHref = link.getAttribute('data-href') ?? ''
    if (!/^thunder:\/\//i.test(dataHref)) continue
    addDownload(decodeThunder(dataHref), link.text.replace(/\s+/g, ' ').trim())
  }
  if (!downloads.length) {
    downloads.push({ name: '打开原网页下载', url, date: updatedAt, size, external: true })
  }

  return {
    id: url.replace(/\/+$/, '').split('/').pop()?.replace(/\.html$/i, '') ?? url,
    title,
    url,
    cover: cover ? absUrl(cover, source.baseUrl) : null,
    sourceId: source.id,
    sourceName: source.name,
    version,
    optionsCount: options.length,
    updatedAt,
    summary: isSave ? notes[0] ?? '' : '',
    options: options.slice(0, 200),
    notes: notes.slice(0, 60),
    screenshots: screenshots.slice(0, 12),
    downloads
  }
}

/* ---------- 游民星空 ---------- */

export const gamerskyNodes = new Map<string, { nodeId: string; isNodeId: string }>()

