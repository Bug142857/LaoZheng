import { shell } from 'electron'
import AdmZip from 'adm-zip'
import { parse } from 'node-html-parser'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { downloadRoot } from './settings'
import { runElevatedProcess } from './powershell'
import { registerLocalFile } from './downloads'
import { fetchSubjectDetail, searchSubjects } from './douban'
import {
  TRAINER_SOURCE_TYPE_LABEL,
  type InstalledTrainer,
  type TrainerActionResult,
  type TrainerDetail,
  type TrainerDetailResponse,
  type TrainerDownloadFile,
  type TrainerDownloadInput,
  type TrainerDownloadResponse,
  type TrainerLibraryResponse,
  type TrainerListItem,
  type TrainerSearchResponse,
  type TrainerSourceInput,
  type TrainerSourceType,
  type TrainerTestResult
} from '../src/shared/trainers'

/**
 * 游戏修改：参考 dyang886/Game-Cheats-Manager 的多源训练器管理器。
 *
 * 在线源（可在片源管理里启停 / 测试 / 增删改）：
 * - fling：flingtrainer.com，WordPress。无关键词取最新列表，有关键词走 /page/N/?s=；
 * - megagames：megagames.com，聚合 FLiNG / PLAYMAGiC / RazorDOX 等（暂时停用）；
 * - 3dm：dl.3dmgame.com 的 patch_26（修改器）/ patch_20（存档）列表，搜索走 so.3dmgame.com；
 * - gamersky：down.gamersky.com 的工具 / 存档列表，分页走 LabelJsonpAjax + 站内搜索；
 * - ali213：patch.ali213.net 的 class1（修改器）/ class5（存档）列表与站内搜索。
 *
 * 下载统一落到「下载目录/修改器/<标题>/」，并登记到下载管理的「修改器」分区；
 * 同时写一条 InstalledTrainer（data.installedTrainers，随备份与云同步走）。
 * 网盘地址不直接下载，详情里提供「打开网盘」交给系统浏览器。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const MAX_DOWNLOAD = 300 * 1024 * 1024

const MONTHS: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12'
}

interface NormalizedSource {
  id: string
  type: TrainerSourceType
  baseUrl: string
  name: string
}

function normalizeSource(input: TrainerSourceInput): NormalizedSource | null {
  if (!input || typeof input !== 'object') return null
  if (
    input.type !== 'fling' &&
    input.type !== 'megagames' &&
    input.type !== '3dm' &&
    input.type !== 'gamersky' &&
    input.type !== 'ali213'
  ) {
    return null
  }
  if (typeof input.baseUrl !== 'string' || !/^https?:\/\//i.test(input.baseUrl.trim())) return null
  return {
    id: typeof input.id === 'string' ? input.id : input.type,
    type: input.type,
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
    name:
      typeof input.name === 'string' && input.name.trim()
        ? input.name.trim()
        : TRAINER_SOURCE_TYPE_LABEL[input.type].split('（')[0]
  }
}

function sameHost(url: string, baseUrl: string): boolean {
  try {
    const target = new URL(url)
    const base = new URL(baseUrl)
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return false
    return target.hostname === base.hostname || target.hostname.endsWith(`.${base.hostname}`)
  } catch {
    return false
  }
}

export function trainerRootDir(): string {
  return join(downloadRoot(), '修改器')
}

async function ensureRoot(): Promise<string> {
  const root = trainerRootDir()
  await mkdir(root, { recursive: true })
  return root
}

function absUrl(raw: string, base: string): string {
  try {
    return new URL(raw, base).toString()
  } catch {
    return ''
  }
}

function safeName(raw: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return (cleaned || `修改器-${Date.now()}`).slice(0, 80)
}

async function fetchText(url: string, referer?: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: referer ?? url
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000)
  })
  if (!res.ok) throw new Error(`站点返回 HTTP ${res.status}`)
  const html = await res.text()
  if (!html.trim()) throw new Error('站点返回空内容')
  return html
}

function linesOf(el: { innerHTML: string; text: string }): string[] {
  const withBreaks = el.innerHTML
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
  const text = parse(`<div>${withBreaks}</div>`, { comment: false }).querySelector('div')?.text
  return (text ?? el.text)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** 跨源去重用：去掉版本号 / +N Trainer / 来源后缀，只保留游戏名 */
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/v?\d+(?:\.\d+)*(?:\.\*)?\+?/g, '')
    .replace(/plus\s*\.?\s*\d+/g, '')
    .replace(/trainer|修改器|多功能|update|更新/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
}

/* ------------------------------ 风灵月影 FLiNG ------------------------------ */

function parseFlingList(html: string, base: string, source: NormalizedSource, page: number) {
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

async function flingSearch(
  source: NormalizedSource,
  keyword: string,
  page: number
): Promise<{ items: TrainerListItem[]; hasMore: boolean }> {
  const url = keyword
    ? `${source.baseUrl}/page/${page}/?s=${encodeURIComponent(keyword)}`
    : `${source.baseUrl}/category/trainer/page/${page}/`
  const html = await fetchText(url, `${source.baseUrl}/`)
  return parseFlingList(html, source.baseUrl, source, page)
}

function parseFlingDetail(
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

async function flingDetail(
  source: NormalizedSource,
  url: string
): Promise<TrainerDetailResponse> {
  const html = await fetchText(url, `${source.baseUrl}/`)
  return { ok: true, trainer: parseFlingDetail(html, url, source) }
}

/* ------------------------------ MegaGames ------------------------------ */

function isPlitch(title: string): boolean {
  return /^plitch\b/i.test(title.trim())
}

function parseMegaSearch(html: string, base: string, source: NormalizedSource) {
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

function parseMegaList(html: string, base: string, source: NormalizedSource) {
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

async function megagamesSearch(
  source: NormalizedSource,
  keyword: string,
  page: number
): Promise<{ items: TrainerListItem[]; hasMore: boolean }> {
  // MegaGames 搜索结果只有一页，翻页直接用空结果
  if (page > 1) return { items: [], hasMore: false }
  if (keyword) {
    const html = await fetchText(
      `${source.baseUrl}/results?query=${encodeURIComponent(keyword)}`,
      `${source.baseUrl}/`
    )
    return parseMegaSearch(html, source.baseUrl, source)
  }
  const html = await fetchText(`${source.baseUrl}/trainers`, `${source.baseUrl}/`)
  return parseMegaList(html, source.baseUrl, source)
}

function megaVersion(title: string): string {
  const match = /(v\d[\d.]*(?:\s*-\s*v?[\d.*]+)?\+?)/i.exec(title)
  return match?.[1]?.replace(/\s+/g, '') ?? ''
}

function megaOptionsCount(title: string): number {
  const match = /(?:\+|plus[.\s]?)\s*(\d+)\s*trainer/i.exec(title) ?? /\((\d+)\s*trainer/i.exec(title)
  return match ? Number(match[1]) : 0
}

function parseMegaDetail(html: string, url: string, source: NormalizedSource): TrainerDetail {
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

async function megagamesDetail(
  source: NormalizedSource,
  url: string
): Promise<TrainerDetailResponse> {
  const html = await fetchText(url, `${source.baseUrl}/`)
  return { ok: true, trainer: parseMegaDetail(html, url, source) }
}

/* ------------------------------ 3DM / 游民星空 / 游侠网 ------------------------------ */

type TrainerCategory = 'trainer' | 'save'

/** 从源地址判断是修改器分区还是存档分区 */
function sourceCategory(source: NormalizedSource): TrainerCategory {
  if (source.type === '3dm') return /\/patch_20_/.test(source.baseUrl) ? 'save' : 'trainer'
  if (source.type === 'gamersky') return /\/sav\/?$/.test(source.baseUrl) ? 'save' : 'trainer'
  if (source.type === 'ali213') return /\/class5_/.test(source.baseUrl) ? 'save' : 'trainer'
  return 'trainer'
}

const NETDISK_HOSTS = [
  'pan.baidu.com',
  'pan.quark.cn',
  'pan.xunlei.com',
  'aliyundrive.com',
  'alipan.com',
  '123pan.com',
  '123684.com',
  'cloud.189.cn',
  'db4.gamersky.com',
  'db5.gamersky.com'
]

/** 网盘 / 网页地址：详情里只提供「打开网页」，不当作文件下载 */
function isNetdiskUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase()
    return NETDISK_HOSTS.some((entry) => host === entry || host.endsWith(`.${entry}`))
  } catch {
    return false
  }
}

/** 迅雷专用链接：thunder://base64("AA"+url+"ZZ") */
function decodeThunder(raw: string): string {
  try {
    const text = Buffer.from(raw.replace(/^thunder:\/\//i, ''), 'base64').toString('utf8')
    return text.replace(/^AA/, '').replace(/ZZ$/, '')
  } catch {
    return ''
  }
}

/* ---------- 3DM ---------- */

function parse3dmList(html: string, source: NormalizedSource, page: number) {
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
  return { items, hasMore: Boolean(doc.querySelector('.pagination .next a')), page }
}

async function threeDMBrowse(source: NormalizedSource, page: number) {
  let url = `${source.baseUrl}/`
  if (page > 1) {
    if (!/_1\/?$/.test(source.baseUrl)) return { items: [], hasMore: false, page }
    url = `${source.baseUrl.replace(/_1\/?$/, `_${page}`)}/`
  }
  const html = await fetchText(url, `${source.baseUrl}/`)
  return parse3dmList(html, source, page)
}

async function threeDMSearch(
  source: NormalizedSource,
  keyword: string,
  page: number
): Promise<{ items: TrainerListItem[]; hasMore: boolean; page: number }> {
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
    return { items, hasMore: total > page, page }
  }
  const combined = keyword.includes(want === '修改器' ? '修改器' : '存档')
    ? keyword
    : `${keyword} ${want === '存档解锁' ? '存档' : '修改器'}`
  const result = await run(combined)
  if (result.items.length || combined === keyword) return result
  // 英文名 / 特殊关键词加上中文分区词可能搜不到，退回原关键词再试一次
  return run(keyword)
}

function parse3dmDetail(html: string, url: string, source: NormalizedSource): TrainerDetail {
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

const gamerskyNodes = new Map<string, { nodeId: string; isNodeId: string }>()

function parseGamerskyList(html: string, source: NormalizedSource) {
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

const gamerskyCoverCache = new Map<string, { at: number; cover: string | null }>()
const GAMERSKY_COVER_TTL = 6 * 60 * 60 * 1000

/** 列表页没有图片，只读取详情页封面所在的一小段 HTML，避免整页下载 */
async function fetchGamerskyCover(pageUrl: string): Promise<string | null> {
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

async function runWithLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const current = items[index]
      index += 1
      if (current === undefined) return
      await worker(current)
    }
  })
  await Promise.all(runners)
}

/** 同一游戏的多条修改器共用一张游戏封面，按游戏名去重后再并发抓取 */
async function enrichGamerskyCovers(items: TrainerListItem[]): Promise<void> {
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

async function gamerskyList(source: NormalizedSource, page: number) {
  if (page <= 1) {
    const html = await fetchText(`${source.baseUrl}/`, `${source.baseUrl}/`)
    const parsed = parseGamerskyList(html, source)
    const hasMore =
      parsed.count > 0 && parsed.pageSize > 0
        ? page * parsed.pageSize < parsed.count
        : Boolean(parse(html).querySelector('.Page .nexe'))
    await enrichGamerskyCovers(parsed.items)
    return { items: parsed.items, hasMore, page }
  }
  const node = gamerskyNodes.get(source.baseUrl)
  if (!node?.nodeId) {
    // 还没打开过第一页时先取一次列表，拿到 data-nodeId
    await gamerskyList(source, 1)
  }
  const ready = gamerskyNodes.get(source.baseUrl)
  if (!ready?.nodeId) return { items: [], hasMore: false, page }
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
  await enrichGamerskyCovers(parsed.items)
  return {
    items: parsed.items,
    hasMore: Number(data.totalPages ?? 0) > page,
    page
  }
}

async function gamerskySearch(
  source: NormalizedSource,
  keyword: string,
  page: number
): Promise<{ items: TrainerListItem[]; hasMore: boolean; page: number }> {
  if (!keyword) return gamerskyList(source, page)
  if (page > 1) return { items: [], hasMore: false, page }
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
  return { items, hasMore: false, page }
}

function parseGamerskyDetail(
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

function ali213ClassId(source: NormalizedSource): string {
  return /\/class(\d+)_/.exec(source.baseUrl)?.[1] ?? ''
}

function parseAli213List(html: string, source: NormalizedSource, page: number) {
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
  return { items, hasMore: Boolean(doc.querySelector('.fenye .nextpage')), page }
}

async function ali213Search(
  source: NormalizedSource,
  keyword: string,
  page: number
): Promise<{ items: TrainerListItem[]; hasMore: boolean; page: number }> {
  let url = source.baseUrl
  if (keyword) {
    url = `https://patch.ali213.net/list_search.php?sword=${encodeURIComponent(keyword)}&classid=${ali213ClassId(source)}&page=${page}`
  } else if (page > 1) {
    if (!/_1\.html$/i.test(source.baseUrl)) return { items: [], hasMore: false, page }
    url = source.baseUrl.replace(/_1\.html$/i, `_${page}.html`)
  }
  const html = await fetchText(url, 'https://patch.ali213.net/')
  return parseAli213List(html, source, page)
}

/** 游侠网桌面详情页不直接给下载地址，移动版页面里有网盘变量 */
async function ali213Downloads(url: string, pageUrl: string): Promise<TrainerDownloadFile[]> {
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

function parseAli213Detail(html: string, url: string, source: NormalizedSource): TrainerDetail {
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
const translationCache = new Map<string, string>()

function englishNamesFromInfo(info: string): string[] {
  const out: string[] = []
  for (const line of info.split(/\n|　+/)) {
    const match = /(?:又名|原名|英文名|外文名)\s*[:：]\s*(.+)/.exec(line)
    if (!match) continue
    for (const raw of match[1].split('/')) {
      const name = raw.replace(/\s+/g, ' ').trim()
      if (name.length >= 3 && /[a-zA-Z]{3}/.test(name)) out.push(name)
    }
  }
  return out
}

/** 豆瓣标题常见「中文 English Name」：取其中最长的一段拉丁字母作为英文名 */
function englishFromTitle(title: string): string {
  const matches = title.match(/[A-Za-z][A-Za-z0-9:'’.\-& ]{3,}/g) ?? []
  const names = matches
    .map((raw) => raw.replace(/\s+/g, ' ').replace(/[.:'’\-& ]+$/g, '').trim())
    .filter((name) => /[A-Za-z]{3}/.test(name))
    .sort((a, b) => b.length - a.length)
  return names[0] ?? ''
}

async function translateGameName(keyword: string): Promise<string> {
  if (!/[\u4e00-\u9fa5]/.test(keyword) || /[a-zA-Z]{3}/.test(keyword)) return ''
  const cached = translationCache.get(keyword)
  if (cached !== undefined) return cached
  try {
    const search = await searchSubjects('game', keyword)
    if (!search.ok) return ''
    for (const item of search.items.slice(0, 3)) {
      const fromTitle = englishFromTitle(item.title)
      if (fromTitle) {
        translationCache.set(keyword, fromTitle)
        return fromTitle
      }
      const detail = await fetchSubjectDetail('game', item.id)
      const info = detail.ok ? detail.detail?.info ?? '' : ''
      const names = englishNamesFromInfo(info)
      if (names.length) {
        translationCache.set(keyword, names[0])
        return names[0]
      }
    }
  } catch {
    // 豆瓣不可用时按原关键词搜索
  }
  return ''
}

/* ------------------------------ 多源聚合 ------------------------------ */

export async function searchTrainers(
  sources: TrainerSourceInput[],
  keyword: string,
  page: number
): Promise<TrainerSearchResponse> {
  const safePage = Math.max(1, Math.min(500, Math.floor(page) || 1))
  const list = (Array.isArray(sources) ? sources : [])
    .map(normalizeSource)
    .filter((source): source is NormalizedSource => Boolean(source))
    .slice(0, 8)
  if (!list.length) {
    return { ok: false, items: [], page: safePage, hasMore: false, error: '没有启用的补丁源' }
  }
  const query = keyword.trim()
  // 中文关键词先尝试换成英文名（8 秒内没结果就按原关键词搜）
  const translated = query
    ? await Promise.race([
        translateGameName(query),
        new Promise<string>((resolve) => setTimeout(() => resolve(''), 8000))
      ])
    : ''
  const terms =
    translated && translated.toLowerCase() !== query.toLowerCase() ? [query, translated] : [query]
  const results = await Promise.allSettled(
    list.flatMap((source) =>
      terms.map((term) => {
        if (source.type === 'fling') return flingSearch(source, term, safePage)
        if (source.type === 'megagames') return megagamesSearch(source, term, safePage)
        if (source.type === '3dm') return threeDMSearch(source, term, safePage)
        if (source.type === 'gamersky') return gamerskySearch(source, term, safePage)
        return ali213Search(source, term, safePage)
      })
    )
  )

  const items: TrainerListItem[] = []
  const seen = new Set<string>()
  let hasMore = false
  const errors: string[] = []
  for (const result of results) {
    if (result.status === 'rejected') {
      errors.push((result.reason as Error).message)
      continue
    }
    hasMore = hasMore || result.value.hasMore
    for (const item of result.value.items) {
      const key = titleKey(item.title) || item.url
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }
  const translatedInfo = translated ? { translatedFrom: query, translatedTo: translated } : {}

  if (!items.length) {
    if (errors.length === results.length) {
      return {
        ok: false,
        items: [],
        page: safePage,
        hasMore: false,
        ...translatedInfo,
        error: errors[0] || '所有修改器源都不可用'
      }
    }
    return {
      ok: true,
      items: [],
      page: safePage,
      hasMore: false,
      ...translatedInfo,
      error: query ? '没有找到匹配的补丁' : undefined
    }
  }
  return { ok: true, items, page: safePage, hasMore, ...translatedInfo }
}

export async function trainerDetail(
  sourceInput: TrainerSourceInput,
  url: string
): Promise<TrainerDetailResponse> {
  const source = normalizeSource(sourceInput)
  if (!source) return { ok: false, trainer: null, error: '修改器源无效' }
  if (typeof url !== 'string' || !sameHost(url, source.baseUrl)) {
    return { ok: false, trainer: null, error: '链接无效' }
  }
  try {
    if (source.type === 'fling') return await flingDetail(source, url)
    if (source.type === 'megagames') return await megagamesDetail(source, url)
    if (source.type === '3dm') {
      const html = await fetchText(url, `${source.baseUrl}/`)
      return { ok: true, trainer: parse3dmDetail(html, url, source) }
    }
    if (source.type === 'gamersky') {
      const html = await fetchText(url, `${source.baseUrl}/`)
      return { ok: true, trainer: parseGamerskyDetail(html, url, source) }
    }
    const html = await fetchText(url, 'https://patch.ali213.net/')
    const trainer = parseAli213Detail(html, url, source)
    try {
      trainer.downloads = await ali213Downloads(url, url)
    } catch {
      // 移动版页面拿不到时至少保留详情
    }
    if (!trainer.downloads.length) {
      trainer.downloads = [
        { name: '打开原网页下载', url, date: trainer.updatedAt, size: '', external: true }
      ]
    }
    return { ok: true, trainer }
  } catch (err) {
    return { ok: false, trainer: null, error: (err as Error).message }
  }
}

export async function testTrainerSource(
  sourceInput: TrainerSourceInput
): Promise<TrainerTestResult> {
  const source = normalizeSource(sourceInput)
  if (!source) return { ok: false, error: '修改器源无效' }
  try {
    const result =
      source.type === 'fling'
        ? await flingSearch(source, '', 1)
        : source.type === 'megagames'
          ? await megagamesSearch(source, '', 1)
          : source.type === '3dm'
            ? await threeDMSearch(source, '', 1)
            : source.type === 'gamersky'
              ? await gamerskySearch(source, '', 1)
              : await ali213Search(source, '', 1)
    if (!result.items.length) return { ok: false, error: '页面能打开，但没有解析到修改器' }
    return {
      ok: true,
      count: result.items.length,
      message: `首页 ${result.items.length} 个修改器`
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/* ------------------------------ 文件处理 ------------------------------ */

type ArchiveKind = 'zip' | 'exe' | 'rar' | '7z' | 'html' | 'unknown'

function detectKind(buffer: Buffer): ArchiveKind {
  if (buffer.length < 8) return 'unknown'
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'zip'
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) return 'exe'
  if (buffer.toString('latin1', 0, 4) === 'Rar!') return 'rar'
  if (buffer[0] === 0x37 && buffer[1] === 0x7a && buffer[2] === 0xbc && buffer[3] === 0xaf) {
    return '7z'
  }
  const head = buffer.toString('utf8', 0, Math.min(buffer.length, 512)).trim().toLowerCase()
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return 'html'
  return 'unknown'
}

interface FolderStats {
  files: number
  sizeBytes: number
  exes: { rel: string; size: number }[]
}

async function scanFolder(dir: string, base = dir, out?: FolderStats): Promise<FolderStats> {
  const acc: FolderStats = out ?? { files: 0, sizeBytes: 0, exes: [] }
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await scanFolder(full, base, acc)
      continue
    }
    if (!entry.isFile()) continue
    try {
      const info = await stat(full)
      acc.files += 1
      acc.sizeBytes += info.size
      if (extname(entry.name).toLowerCase() === '.exe') {
        acc.exes.push({ rel: full.slice(base.length + 1), size: info.size })
      }
    } catch {
      // 单个文件读不到时跳过
    }
  }
  return acc
}

/** 解压 zip：逐条校验路径，防目录穿越 */
async function extractZip(buffer: Buffer, dest: string): Promise<void> {
  const zip = new AdmZip(buffer)
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.replace(/\\/g, '/')
    if (!name || name.includes('..')) continue
    const target = resolve(dest, name)
    if (target !== resolve(dest) && !target.startsWith(resolve(dest) + sep)) continue
    if (entry.isDirectory) {
      await mkdir(target, { recursive: true })
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, entry.getData())
  }
}

/** 压缩包常见结构是只有一个顶层文件夹：把它里面的内容提到根目录 */
async function flattenSingleFolder(dir: string): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    if (entries.length !== 1 || !entries[0].isDirectory()) return
    const inner = join(dir, entries[0].name)
    const innerEntries = await readdir(inner, { withFileTypes: true })
    for (const entry of innerEntries) {
      await rename(join(inner, entry.name), join(dir, entry.name))
    }
    await rm(inner, { recursive: true, force: true })
  } catch {
    // 结构不符合预期时保留原样
  }
}

async function uniqueFolder(root: string, name: string): Promise<string> {
  const base = safeName(name)
  let candidate = base
  let index = 2
  while (existsSync(join(root, candidate))) {
    candidate = `${base} (${index})`
    index += 1
  }
  return candidate
}

async function buildRecord(
  folder: string,
  meta: {
    title: string
    source: TrainerSourceType | 'local'
    sourceId: string
    pageUrl: string
    cover: string | null
    version: string
    installedAt?: number
  }
): Promise<InstalledTrainer> {
  const dir = join(trainerRootDir(), folder)
  const stats = await scanFolder(dir)
  stats.exes.sort((a, b) => b.size - a.size)
  return {
    folder,
    title: meta.title || folder,
    source: meta.source,
    sourceId: meta.sourceId,
    pageUrl: meta.pageUrl,
    cover: meta.cover,
    version: meta.version,
    exe: stats.exes[0]?.rel ?? '',
    files: stats.files,
    sizeBytes: stats.sizeBytes,
    installedAt: meta.installedAt ?? Date.now()
  }
}

/* ------------------------------ 下载 ------------------------------ */

export async function downloadTrainer(input: TrainerDownloadInput): Promise<TrainerDownloadResponse> {
  if (
    !input ||
    typeof input.url !== 'string' ||
    typeof input.title !== 'string' ||
    (input.sourceType !== 'fling' &&
      input.sourceType !== 'megagames' &&
      input.sourceType !== '3dm' &&
      input.sourceType !== 'gamersky' &&
      input.sourceType !== 'ali213')
  ) {
    return { ok: false, error: '下载参数无效' }
  }
  const baseUrl =
    typeof input.sourceBaseUrl === 'string' ? input.sourceBaseUrl.trim().replace(/\/+$/, '') : ''
  if (!/^https?:\/\//i.test(baseUrl)) return { ok: false, error: '修改器源地址无效' }
  try {
    const target = new URL(input.url)
    const base = new URL(baseUrl)
    const host = target.hostname
    const allowed =
      host === base.hostname ||
      host.endsWith(`.${base.hostname}`) ||
      (input.sourceType === 'megagames' && /\.rocketcdn\.me$/i.test(host)) ||
      (input.sourceType === '3dm' &&
        (host.endsWith('.3dmgame.com') ||
          host === 'shwswl.cn' ||
          host.endsWith('.shwswl.cn') ||
          host === 'wsyhn.com' ||
          host.endsWith('.wsyhn.com')))
    if (!allowed || (target.protocol !== 'https:' && target.protocol !== 'http:')) {
      return { ok: false, error: '下载地址不在该修改器源范围内' }
    }
  } catch {
    return { ok: false, error: '下载地址无效' }
  }

  const root = await ensureRoot()
  let buffer: Buffer
  try {
    const res = await fetch(input.url, {
      headers: {
        'User-Agent': UA,
        Accept: '*/*',
        Referer:
          typeof input.pageUrl === 'string' && input.pageUrl ? input.pageUrl : `${baseUrl}/`,
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(180_000)
    })
    if (!res.ok) return { ok: false, error: `站点返回 HTTP ${res.status}` }
    buffer = Buffer.from(await res.arrayBuffer())
  } catch (err) {
    return { ok: false, error: `下载失败：${(err as Error).message}` }
  }
  if (!buffer.length) return { ok: false, error: '下载内容为空' }
  if (buffer.length > MAX_DOWNLOAD) return { ok: false, error: '文件超过 300MB，已取消下载' }

  const kind = detectKind(buffer)
  if (kind === 'html') {
    return { ok: false, error: '站点返回了网页而不是文件，可能被 Cloudflare 拦截，请稍后重试' }
  }

  const folder = await uniqueFolder(root, input.title)
  const dir = join(root, folder)
  await mkdir(dir, { recursive: true })
  const base = safeName(input.title)
  let note: string | undefined

  try {
    if (kind === 'zip') {
      try {
        await extractZip(buffer, dir)
        await flattenSingleFolder(dir)
      } catch (err) {
        await writeFile(join(dir, `${base}.zip`), buffer)
        note = `自动解压失败（${(err as Error).message}），已保存压缩包，请手动解压`
      }
    } else if (kind === 'exe') {
      await writeFile(join(dir, `${base}.exe`), buffer)
    } else if (kind === 'rar' || kind === '7z') {
      await writeFile(join(dir, `${base}.${kind}`), buffer)
      note = `该文件是 ${kind.toUpperCase()} 压缩包，已保存到目录，请手动解压后再启动`
    } else {
      await writeFile(join(dir, `${base}.bin`), buffer)
      note = '无法识别文件类型，已原样保存到目录'
    }
  } catch (err) {
    return { ok: false, error: `写入文件失败：${(err as Error).message}` }
  }

  const record = await buildRecord(folder, {
    title: input.title.slice(0, 200),
    source: input.sourceType,
    sourceId: typeof input.sourceId === 'string' ? input.sourceId : '',
    pageUrl:
      typeof input.pageUrl === 'string' && sameHost(input.pageUrl, baseUrl) ? input.pageUrl : '',
    cover: typeof input.cover === 'string' ? input.cover : null,
    version: typeof input.version === 'string' ? input.version.slice(0, 80) : ''
  })

  // 同步进下载管理的「修改器」分区（失败不影响已经落盘的文件）
  try {
    await registerLocalFile({
      title: record.title,
      kind: 'trainer',
      absPath: record.exe ? join(dir, record.exe) : dir,
      folder: !record.exe,
      sourceName:
        typeof input.sourceName === 'string' && input.sourceName
          ? input.sourceName
          : TRAINER_SOURCE_TYPE_LABEL[input.sourceType].split('（')[0],
      coverUrl: record.cover ?? undefined
    })
  } catch (err) {
    console.error('[trainers] 写入下载记录失败', err)
  }

  return { ok: true, trainer: record, note }
}

/* ------------------------------ 已安装管理 ------------------------------ */

export async function scanTrainerLibrary(): Promise<TrainerLibraryResponse> {
  const root = await ensureRoot()
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (err) {
    return { ok: false, root, items: [], error: (err as Error).message }
  }
  const items: InstalledTrainer[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = join(root, entry.name)
    let installedAt = Date.now()
    try {
      installedAt = (await stat(dir)).mtimeMs
    } catch {
      // 读不到时间时用当前时间
    }
    items.push(
      await buildRecord(entry.name, {
        title: entry.name,
        source: 'local',
        sourceId: '',
        pageUrl: '',
        cover: null,
        version: '',
        installedAt
      })
    )
  }
  items.sort((a, b) => b.installedAt - a.installedAt)
  return { ok: true, root, items }
}

/** 校验传入目录必须位于「修改器」根目录内，返回绝对路径 */
function resolveInsideRoot(folder: string): string | null {
  if (typeof folder !== 'string' || !folder.trim()) return null
  const root = resolve(trainerRootDir())
  const target = resolve(root, folder)
  if (target === root || !target.startsWith(root + sep)) return null
  return target
}

export async function runTrainer(folder: string, exe: string): Promise<TrainerActionResult> {
  const dir = resolveInsideRoot(folder)
  if (!dir) return { ok: false, error: '路径无效' }
  const target = resolve(dir, exe)
  if (!target.startsWith(dir + sep) || !existsSync(target)) {
    return { ok: false, error: '没有找到修改器主程序，请打开目录手动启动' }
  }
  // 只允许启动 exe：解压出来的 bat / cmd / lnk 不参与，避免提权执行任意脚本
  if (extname(target).toLowerCase() !== '.exe') {
    return { ok: false, error: '修改器主程序不是 exe，请打开目录手动启动' }
  }
  try {
    await runElevatedProcess(target, dir)
    return { ok: true, message: '已请求管理员权限启动修改器' }
  } catch (err) {
    const message = (err as Error).message
    if (/canceled|cancelled|取消/i.test(message)) {
      return { ok: false, error: '已取消管理员权限请求' }
    }
    return { ok: false, error: `启动失败：${message}` }
  }
}

export async function openTrainerFolder(folder?: string): Promise<TrainerActionResult> {
  const root = await ensureRoot()
  let target = root
  if (folder) {
    const dir = resolveInsideRoot(folder)
    if (!dir) return { ok: false, error: '路径无效' }
    if (!existsSync(dir)) return { ok: false, error: '目录不存在，可能已被删除' }
    target = dir
  }
  const err = await shell.openPath(target)
  return err ? { ok: false, error: err } : { ok: true }
}

export async function deleteTrainer(folder: string): Promise<TrainerActionResult> {
  const dir = resolveInsideRoot(folder)
  if (!dir) return { ok: false, error: '路径无效' }
  if (!existsSync(dir)) return { ok: true }
  try {
    // 删到系统回收站，误删可还原
    await shell.trashItem(dir)
    return { ok: true, message: '已移到回收站' }
  } catch (err) {
    return { ok: false, error: `删除失败：${(err as Error).message}` }
  }
}
