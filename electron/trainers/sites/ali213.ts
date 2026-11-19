import { parse } from 'node-html-parser'
import type { TrainerDetail, TrainerDownloadFile, TrainerListItem } from '../../../src/shared/trainers'
import { absUrl, fetchText, sourceCategory, type NormalizedSource } from '../common'
export function ali213ClassId(source: NormalizedSource): string {
  return /\/class(\d+)_/.exec(source.baseUrl)?.[1] ?? ''
}

export function parseAli213List(html: string, source: NormalizedSource, page: number) {
  const doc = parse(html)
  const items: TrainerListItem[] = []
  const seen = new Set<string>()
  for (const block of doc.querySelectorAll('.c-list')) {
    const link = block.querySelector('a.title') ?? block.querySelector('a[href*="/showpatch/"]')
    if (!link) continue
    const url = absUrl(link.getAttribute('href') ?? '', 'https://patch.ali213.net')
    if (!/\/showpatch\/\d+\.html$/i.test(url) || seen.has(url)) continue
    const title = (link.getAttribute('title') ?? link.text)
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!title) continue
    seen.add(url)
    const info = block
      .querySelectorAll('.info span')
      .map((span) => span.text.replace(/\s+/g, ' ').trim())
    const date =
      info.map((text) => /更新时间[：:]\s*(.+)/.exec(text)?.[1]).find(Boolean) ?? ''
    const img = block.querySelector('a.pic img')
    const cover = img?.getAttribute('src')?.trim() ?? ''
    items.push({
      id: url.replace(/\.html$/i, '').split('/').pop() ?? url,
      title,
      url,
      cover: cover ? absUrl(cover, 'https://patch.ali213.net') : null,
      date,
      sourceId: source.id,
      sourceName: source.name
    })
  }
  // 分页条带「尾页」：class1_1105.html / list_search.php?...&page=6
  const lastHref = doc.querySelector('.fenye a.endpage')?.getAttribute('href') ?? ''
  const pageCount =
    Number(/_(\d+)\.html/.exec(lastHref)?.[1] ?? /page=(\d+)/.exec(lastHref)?.[1] ?? 0) || page
  return { items, hasMore: Boolean(doc.querySelector('.fenye .nextpage')), page, pageCount }
}

export async function ali213Search(
  source: NormalizedSource,
  keyword: string,
  page: number
): Promise<{ items: TrainerListItem[]; hasMore: boolean; page: number; pageCount: number }> {
  let url = source.baseUrl
  if (keyword) {
    url = `https://patch.ali213.net/list_search.php?sword=${encodeURIComponent(keyword)}&classid=${ali213ClassId(source)}&page=${page}`
  } else if (page > 1) {
    if (!/_1\.html$/i.test(source.baseUrl)) return { items: [], hasMore: false, page, pageCount: 0 }
    url = source.baseUrl.replace(/_1\.html$/i, `_${page}.html`)
  }
  const html = await fetchText(url, 'https://patch.ali213.net/')
  return parseAli213List(html, source, page)
}

/** 游侠网桌面详情页不直接给下载地址，移动版页面里有网盘变量 */
export async function ali213Downloads(url: string, pageUrl: string): Promise<TrainerDownloadFile[]> {
  const id = /\/showpatch\/(\d+)/.exec(url)?.[1]
  if (!id) return []
  const html = await fetchText(`https://3g.ali213.net/patch/${id}.html`, pageUrl)
  const labels: Record<string, string> = {
    quark: '夸克网盘',
    xunlei: '迅雷网盘',
    '123': '123网盘'
  }
  const out: TrainerDownloadFile[] = []
  const seen = new Set<string>()
  for (const match of html.matchAll(/var\s+DownUrl_(\w+)\s*=\s*"([^"]*)"/g)) {
    const href = match[2].trim()
    if (!/^https?:\/\//i.test(href) || seen.has(href)) continue
    seen.add(href)
    out.push({
      name: labels[match[1]] ?? `${match[1]} 网盘`,
      url: href,
      date: '',
      size: '',
      external: true
    })
  }
  return out
}

export function parseAli213Detail(html: string, url: string, source: NormalizedSource): TrainerDetail {
  const doc = parse(html)
  const title =
    doc.querySelector('.contentMain h1')?.text.replace(/\s+/g, ' ').trim() ||
    doc.querySelector('h1')?.text.replace(/\s+/g, ' ').trim() ||
    '修改器详情'
  const cover = doc.querySelector('.contentLeft .gamePic img')?.getAttribute('src')?.trim() || null
  const info = doc
    .querySelectorAll('.pluginDetail li')
    .map((li) => li.text.replace(/\s+/g, ' ').trim())
  const updatedAt =
    info
      .map((line) => /更新时间[：:]\s*(.+)/.exec(line)?.[1])
      .find(Boolean)
      ?.trim() ?? ''
  const isSave = sourceCategory(source) === 'save'
  const content = doc.querySelector('.pluginContent')
  const options: string[] = []
  const notes: string[] = []
  let summary = ''
  if (content) {
    for (const p of content.querySelectorAll('p')) {
      const line = p.text.replace(/\s+/g, ' ').trim()
      if (!line) continue
      if (!summary) {
        summary = line.slice(0, 600)
        continue
      }
      const list = isSave ? notes : options
      if (!list.includes(line)) list.push(line)
    }
  }
  return {
    id: url.replace(/\.html$/i, '').split('/').pop() ?? url,
    title,
    url,
    cover: cover ? absUrl(cover, 'https://patch.ali213.net') : null,
    sourceId: source.id,
    sourceName: source.name,
    version: /v[\d.]+(?:\s*-\s*v?[\d.*]+)?\+?/i.exec(title)?.[0]?.replace(/\s+/g, '') ?? '',
    optionsCount: options.length,
    updatedAt,
    summary,
    options: options.slice(0, 200),
    notes: notes.slice(0, 60),
    screenshots: [],
    downloads: []
  }
}

/* ------------------------------ 中文名 → 英文名 ------------------------------ */

/** 风灵月影只有英文站，中文关键词先用豆瓣游戏条目的「又名 / 原名」换成英文名 */
export const translationCache = new Map<string, string>()

