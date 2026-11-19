import { parse } from 'node-html-parser'
import type { TrainerDetail, TrainerDownloadFile, TrainerListItem } from '../../../src/shared/trainers'
import { UA, absUrl, fetchText, isNetdiskUrl, runWithLimit, sourceCategory, type NormalizedSource } from '../common'

const gamerskyNodes = new Map<string, { nodeId: string; isNodeId: string }>()
export function parseGamerskyList(html: string, source: NormalizedSource) {
  const doc = parse(html)
  const holder = doc.querySelector('.downlist[data-nodeid]')
  if (holder) {
    gamerskyNodes.set(source.baseUrl, {
      nodeId: holder.getAttribute('data-nodeid') ?? '',
      isNodeId: holder.getAttribute('data-isnodeid') ?? 'true'
    })
  }
  const items: TrainerListItem[] = []
  const seen = new Set<string>()
  const rows = doc.querySelectorAll('.downlist li').length
    ? doc.querySelectorAll('.downlist li')
    : doc.querySelectorAll('li.li3')
  for (const li of rows) {
    const link = li.querySelector('.txt a[href]') ?? li.querySelector('a[href]')
    if (!link) continue
    const url = absUrl(link.getAttribute('href') ?? '', 'https://down.gamersky.com')
    if (!/\/pc\/\d{6}\/\d+\.shtml/i.test(url) || seen.has(url)) continue
    const title = (link.getAttribute('title') ?? link.text)
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!title) continue
    seen.add(url)
    items.push({
      id: url.replace(/\.shtml$/i, '').split('/').pop() ?? url,
      title,
      url,
      cover: null,
      date: li.querySelector('.time')?.text.trim() ?? '',
      sourceId: source.id,
      sourceName: source.name
    })
  }
  const previous = doc.querySelector('.Page .previous')
  return {
    items,
    count: Number(previous?.getAttribute('data-count') ?? 0),
    pageSize: Number(previous?.getAttribute('data-pagesize') ?? 0)
  }
}

export const gamerskyCoverCache = new Map<string, { at: number; cover: string | null }>()
export const GAMERSKY_COVER_TTL = 6 * 60 * 60 * 1000

/** 列表页没有图片，只读取详情页封面所在的一小段 HTML，避免整页下载 */
export async function fetchGamerskyCover(pageUrl: string): Promise<string | null> {
  const cached = gamerskyCoverCache.get(pageUrl)
  if (cached && Date.now() - cached.at < GAMERSKY_COVER_TTL) return cached.cover
  const matchCover = (html: string): string | null => {
    const match =
      /<div class="Mid2L_actdl2">[\s\S]*?<div class="game">[\s\S]*?<img[^>]+src="([^"]+)"/i.exec(
        html
      )
    return match?.[1]?.trim() || null
  }
  try {
    const res = await fetch(pageUrl, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: 'https://down.gamersky.com/'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000)
    })
    if (!res.ok) {
      gamerskyCoverCache.set(pageUrl, { at: Date.now(), cover: null })
      return null
    }
    const reader = res.body?.getReader()
    let html = ''
    if (reader) {
      const decoder = new TextDecoder('utf-8')
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        html += decoder.decode(value, { stream: true })
        const cover = matchCover(html)
        if (cover) {
          void reader.cancel().catch(() => undefined)
          gamerskyCoverCache.set(pageUrl, { at: Date.now(), cover })
          return cover
        }
        if (html.length > 160_000) break
      }
    }
    const cover = matchCover(html)
    gamerskyCoverCache.set(pageUrl, { at: Date.now(), cover })
    return cover
  } catch {
    return null
  }
}

/** 同一游戏的多条修改器共用一张游戏封面，按游戏名去重后再并发抓取 */
export async function enrichGamerskyCovers(items: TrainerListItem[]): Promise<void> {
  const pending = new Map<string, string>()
  for (const item of items) {
    if (item.cover) continue
    const game = (/《([^》]+)》/.exec(item.title)?.[1] ?? item.url).trim()
    if (!pending.has(game)) pending.set(game, item.url)
  }
  if (!pending.size) return
  const covers = new Map<string, string | null>()
  await runWithLimit([...pending.entries()], 4, async ([game, url]) => {
    covers.set(game, await fetchGamerskyCover(url))
  })
  for (const item of items) {
    if (item.cover) continue
    const game = (/《([^》]+)》/.exec(item.title)?.[1] ?? item.url).trim()
    const cover = covers.get(game)
    if (cover) item.cover = cover
  }
}

export async function gamerskyList(source: NormalizedSource, page: number) {
  if (page <= 1) {
    const html = await fetchText(`${source.baseUrl}/`, `${source.baseUrl}/`)
    const parsed = parseGamerskyList(html, source)
    const hasMore =
      parsed.count > 0 && parsed.pageSize > 0
        ? page * parsed.pageSize < parsed.count
        : Boolean(parse(html).querySelector('.Page .nexe'))
    const pageCount =
      parsed.count > 0 && parsed.pageSize > 0 ? Math.ceil(parsed.count / parsed.pageSize) : 0
    await enrichGamerskyCovers(parsed.items)
    return { items: parsed.items, hasMore, page, pageCount }
  }
  const node = gamerskyNodes.get(source.baseUrl)
  if (!node?.nodeId) {
    // 还没打开过第一页时先取一次列表，拿到 data-nodeId
    await gamerskyList(source, 1)
  }
  const ready = gamerskyNodes.get(source.baseUrl)
  if (!ready?.nodeId) return { items: [], hasMore: false, page, pageCount: 0 }
  const jsondata = JSON.stringify({
    type: 'updatenodelabel',
    isCache: true,
    cacheTime: 60,
    nodeId: ready.nodeId,
    isNodeId: ready.isNodeId,
    page
  })
  const text = await fetchText(
    `https://db2.gamersky.com/LabelJsonpAjax.aspx?jsondata=${encodeURIComponent(jsondata)}`,
    `${source.baseUrl}/`
  )
  const body = /^\s*\(([\s\S]*)\)\s*;?\s*$/.exec(text)?.[1]
  if (!body) throw new Error('游民星空分页接口返回异常')
  const data = JSON.parse(body) as { totalPages?: number; body?: string }
  const parsed = parseGamerskyList(String(data.body ?? ''), source)
  const pageCount = Number(data.totalPages ?? 0)
  await enrichGamerskyCovers(parsed.items)
  return {
    items: parsed.items,
    hasMore: pageCount > page,
    page,
    pageCount
  }
}

export async function gamerskySearch(
  source: NormalizedSource,
  keyword: string,
  page: number
): Promise<{ items: TrainerListItem[]; hasMore: boolean; page: number; pageCount: number }> {
  if (!keyword) return gamerskyList(source, page)
  if (page > 1) return { items: [], hasMore: false, page, pageCount: 0 }
  const category = sourceCategory(source) === 'save' ? 'sav' : 'tools'
  const html = await fetchText(
    `https://so.gamersky.com/all/down/${category}?s=${encodeURIComponent(keyword)}`,
    'https://so.gamersky.com/'
  )
  const doc = parse(html)
  const items: TrainerListItem[] = []
  const seen = new Set<string>()
  for (const li of doc.querySelectorAll('.search-download-list li')) {
    const link =
      li.querySelector('.t2 a[href]') ?? li.querySelector('a[href*="down.gamersky.com"]')
    if (!link) continue
    const url = absUrl(link.getAttribute('href') ?? '', 'https://down.gamersky.com')
    if (!/\/pc\/\d{6}\/\d+\.shtml/i.test(url) || seen.has(url)) continue
    const title = link.text.replace(/\s+/g, ' ').trim()
    if (!title) continue
    seen.add(url)
    items.push({
      id: url.replace(/\.shtml$/i, '').split('/').pop() ?? url,
      title,
      url,
      cover: null,
      date: li.querySelector('.bot .time')?.text.trim() ?? '',
      sourceId: source.id,
      sourceName: source.name
    })
  }
  await enrichGamerskyCovers(items)
  return { items, hasMore: false, page, pageCount: 0 }
}

export function parseGamerskyDetail(
  html: string,
  url: string,
  source: NormalizedSource
): TrainerDetail {
  const doc = parse(html)
  const rawTitle = doc.querySelector('.Mid2L_actdl2 .tit')?.text.replace(/\s+/g, ' ').trim() ?? ''
  const title = rawTitle.replace(/下载$/, '') || '修改器详情'
  const cover =
    doc.querySelector('.Mid2L_actdl2 .game .img img')?.getAttribute('src')?.trim() || null
  const info: Record<string, string> = {}
  for (const li of doc.querySelectorAll('.Mid2L_actdl2 .YXXX li')) {
    const key = li.querySelector('.tt')?.text.replace(/[:：\s]/g, '').trim() ?? ''
    const value = li.querySelector('.txt')?.text.replace(/\s+/g, ' ').trim() ?? ''
    if (key) info[key] = value
  }
  const size = info['文件大小'] ?? ''
  const updatedAt =
    [info['更新日期'], info['发布日期']].find((value) => value && !/^[-—\s]+$/.test(value)) ?? ''
  const isSave = sourceCategory(source) === 'save'
  const content = doc.querySelector('.Mid2L_con .intr')
  const options: string[] = []
  const notes: string[] = []
  if (content) {
    for (const p of content.querySelectorAll('p')) {
      const line = p.text.replace(/\s+/g, ' ').trim()
      if (!line) continue
      const list = isSave ? notes : options
      if (!list.includes(line)) list.push(line)
    }
  }

  const downloads: TrainerDownloadFile[] = []
  const seen = new Set<string>()
  for (const link of doc.querySelectorAll('.Download .DownloadContent .dl_url a[href]')) {
    const parentClass = link.parentNode?.getAttribute('class') ?? ''
    // 推荐下载是 Steam / 风灵月影广告，跳过
    if (parentClass.includes('downLoadGame-2-Btn')) continue
    const href = absUrl(link.getAttribute('href') ?? '', 'https://down.gamersky.com')
    if (!/^https?:/i.test(href) || seen.has(href)) continue
    seen.add(href)
    downloads.push({
      name: link.text.replace(/\s+/g, ' ').trim() || '下载',
      url: href,
      date: updatedAt,
      size,
      external: isNetdiskUrl(href) || /ShowDownloadUrl/i.test(href)
    })
  }
  if (!downloads.length) {
    downloads.push({ name: '打开原网页下载', url, date: updatedAt, size, external: true })
  }

  return {
    id: url.replace(/\.shtml$/i, '').split('/').pop() ?? url,
    title,
    url,
    cover: cover ? absUrl(cover, 'https://down.gamersky.com') : null,
    sourceId: source.id,
    sourceName: source.name,
    version: /v[\d.]+(?:\s*-\s*v?[\d.*]+)?\+?/i.exec(title)?.[0]?.replace(/\s+/g, '') ?? '',
    optionsCount: options.length,
    updatedAt,
    summary: '',
    options: options.slice(0, 200),
    notes: notes.slice(0, 60),
    screenshots: [],
    downloads
  }
}

/* ---------- 游侠网 ---------- */

