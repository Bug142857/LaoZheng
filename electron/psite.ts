import { parse } from 'node-html-parser'
import type {
  PCategoryCountResponse,
  PListResponse,
  PMediaResponse,
  PVideo
} from '../src/shared/psite'
import { noteShuangkanMediaBase, text as plainText } from './gohome'

/** P站（pornhub.com）客户端：网页解析，与手机端 PsiteClient.kt 同口径 */

const BASE = 'https://www.pornhub.com'
const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const COOKIE = 'accessAgeDisclaimerPH=1; age_verified=1; accessPH=1'

/** 站点配置：爽看里的 Pornhub 镜像复用同一套解析，只是地址与 Cookie 不同 */
export interface PSite {
  base: string
  cookie: string
}

const DEFAULT_SITE: PSite = { base: BASE, cookie: COOKIE }

function siteOf(site?: Partial<PSite>): PSite {
  const base = (site?.base ?? '').trim().replace(/\/+$/, '') || BASE
  return { base, cookie: site?.cookie ?? COOKIE }
}

/** 媒体请求（m3u8 / 分片 / 直链）统一带站内 Referer 与年龄 Cookie，部分节点会校验 */
function mediaHeaders(site: PSite): Record<string, string> {
  return {
    'User-Agent': UA,
    Accept: '*/*',
    Referer: `${site.base}/`,
    Cookie: site.cookie
  }
}

async function getHtml(url: string, site: PSite): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: site.cookie
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.text()
  if (!body) throw new Error('站点返回了空页面')
  // v0.122：登记站点主域，渲染层播放 jmpres 时补 Cookie / Referer（缺了只回几秒提示片）
  noteShuangkanMediaBase(site.base)
  if (res.url) noteShuangkanMediaBase(res.url)
  return body
}

function parseDuration(text: string): number {
  const parts = text
    .trim()
    .split(':')
    .map((p) => Number.parseInt(p.trim(), 10) || 0)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return 0
}

function lastPageOf(html: string): number {
  let max = 0
  // 页面里的分页链接是 &amp;page=N，不解实体的话只认得 ?page=N，
  // 搜索结果就会被锁在第二页
  const normalized = html.replace(/&amp;/gi, '&').replace(/&#0*38;|&#x0*26;/gi, '&')
  for (const m of normalized.matchAll(/[?&]page=(\d+)/g)) {
    const n = Number.parseInt(m[1], 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

/** 移动版列表每页条数（第 2 页起实测 42 条） */
const LIST_PAGE_SIZE = 42
/** 搜索最多只能翻到第 100 页，再往后镜像直接 404 */
const SEARCH_MAX_PAGE = 100
/** 分类深翻实测到 ~451 页仍可用，再往后镜像 404 */
const CATEGORY_MAX_PAGE = 451

/**
 * 页面里内嵌的结果总数：移动版没有「Showing 1-30 of N」，
 * 但 VIDEOS_FILTER 的 JSON 与部分模板的 VIDEO_FILTER_resultsCount 都带总数。
 * 分页条只渲染当前页附近几页，只有这个总数能算出真实末页。
 */
function resultsCountOf(html: string): number {
  const matched =
    /["']resultsCount["']\s*:\s*(\d+)/.exec(html) ??
    /VIDEO_FILTER_resultsCount\s*[=:]\s*["']?(\d+)/i.exec(html)
  const n = matched ? Number.parseInt(matched[1], 10) : 0
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 用结果总数估算总页数；算不出来时返回 0，调用方退回分页条口径 */
function totalPagesOf(html: string, query: string): number {
  const count = resultsCountOf(html)
  if (!count) return 0
  // 第 1 页实测 30 条（有推广位），第 2 页起每页 42 条
  const pages = 1 + Math.ceil(Math.max(0, count - 30) / LIST_PAGE_SIZE)
  return Math.min(pages, query ? SEARCH_MAX_PAGE : CATEGORY_MAX_PAGE)
}

function parseList(html: string): PVideo[] {
  const doc = parse(html)
  const out: PVideo[] = []
  const seen = new Set<string>()
  for (const li of doc.querySelectorAll('li[data-video-vkey]')) {
    const vkey = (li.getAttribute('data-video-vkey') ?? '').trim()
    if (!vkey || seen.has(vkey)) continue
    const img =
      li.querySelector('img.js-videoThumb') ??
      li.querySelector('img.videoThumb') ??
      li.querySelector('img')
    if (!img) continue
    const src = (img.getAttribute('src') ?? '').trim()
    const dataPath = (img.getAttribute('data-path') ?? '').trim()
    const thumb = src.startsWith('http') ? src : dataPath.startsWith('http') ? dataPath : null
    if (!thumb) continue
    const title =
      (li.querySelector('.underThumb .title')?.text ?? '').trim() ||
      (img.getAttribute('alt') ?? '').trim()
    if (!title) continue
    const duration = (li.querySelector('.duration .time')?.text ?? '').trim()
    const views =
      (li.querySelector('.views')?.text ?? '').trim() ||
      (li.querySelector('.videoViews')?.text ?? '').trim()
    const uploader = (li.querySelector('.uploaderLink')?.text ?? '').trim()
    seen.add(vkey)
    out.push({
      vkey,
      title,
      thumbnail: thumb,
      durationSec: parseDuration(duration),
      views,
      uploader
    })
  }
  return out
}

export async function pList(
  sortCode: string,
  catId: number,
  query: string,
  page: number,
  siteInput?: Partial<PSite>
): Promise<PListResponse> {
  try {
    const site = siteOf(siteInput)
    const p = Math.max(1, page)
    const kw = query.trim()
    let url: string
    if (kw) {
      url = `${site.base}/video/search?search=${encodeURIComponent(kw)}&page=${p}`
    } else if (catId > 0) {
      // 推荐页带 c 参数不会真正过滤分类，分类统一走 /video?c=
      url = `${site.base}/video?c=${catId}&page=${p}`
    } else if (sortCode === 'recommended') {
      url = `${site.base}/recommended?page=${p}`
    } else {
      const q: string[] = []
      if (sortCode) q.push(`o=${sortCode}`)
      if (catId > 0) q.push(`c=${catId}`)
      q.push(`page=${p}`)
      url = `${site.base}/video?${q.join('&')}`
    }
    const html = await getHtml(url, site)
    const items = parseList(html)
    const lastPage = lastPageOf(html)
    // 分页条只渲染当前页附近几页（常见只到 9）；页面内嵌的结果总数才算得出真实末页
    const totalPages = totalPagesOf(html, kw)
    const hasMore =
      items.length > 0 &&
      (totalPages > 0 ? p < totalPages : items.length >= 16 || (lastPage > 0 && p < lastPage))
    return { ok: true, items, lastPage: Math.max(lastPage, totalPages), totalPages, hasMore }
  } catch (err) {
    return {
      ok: false,
      items: [],
      lastPage: 0,
      hasMore: false,
      error:
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
          ? '请求超时（需外网，可换节点重试）'
          : '加载失败（需外网，可换节点重试）'
    }
  }
}

/** 在 marker 之后找第一个 '['，再按括号配对截取完整 JSON 数组 */
function extractArrayAfter(text: string, marker: string): string | null {
  const at = text.indexOf(marker)
  if (at < 0) return null
  let start = -1
  for (let i = at + marker.length; i < Math.min(at + marker.length + 40, text.length); i++) {
    if (text[i] === '[') {
      start = i
      break
    }
  }
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (c === '\\' && inString) {
      escaped = true
      continue
    }
    if (c === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

interface RawDef {
  format: string
  quality: string
  url: string
}

/** 媒体地址可能是 //host/path、相对路径或带转义斜杠，统一补全为 https 直链 */
function normalizeMediaUrl(raw: string, base: string): string {
  let url = raw.trim().replace(/\\\//g, '/')
  if (url.startsWith('//')) url = `https:${url}`
  if (url.startsWith('/')) url = `${base}${url}`
  return url
}

function byQuality(a: RawDef, b: RawDef): number {
  return (Number.parseInt(b.quality, 10) || -1) - (Number.parseInt(a.quality, 10) || -1)
}

/** 站点返回的 format=mp4 里混着 /video/get_media（JSON 接口），不能直接当视频地址 */
function isPlayableDirect(url: string): boolean {
  if (/\/video\/get_media/i.test(url)) return false
  return /\.(mp4|m4v|webm|flv|mov)(\?|$)/i.test(url)
}

/** 真正请求一次 m3u8：部分节点的签名地址会返回 403/410，必须挑一个能用的 */
async function probeHls(url: string, site: PSite): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: mediaHeaders(site),
      redirect: 'follow',
      signal: AbortSignal.timeout(8_000)
    })
    if (!res.ok) return false
    const text = (await res.text()).trimStart()
    return text.startsWith('#EXTM3U')
  } catch {
    return false
  }
}

/** 按清晰度从高到低探测 HLS，最多保留两条可用线路（第二条用于播放失败回退） */
async function pickWorkingHls(defs: RawDef[], site: PSite): Promise<RawDef[]> {
  const hls = defs.filter((d) => d.format.toLowerCase() === 'hls').sort(byQuality)
  if (!hls.length) return []
  const results = await Promise.all(
    hls.map(async (def) => ({ def, ok: await probeHls(def.url, site) }))
  )
  return results.filter((r) => r.ok).map((r) => r.def)
}

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const categoryCountCache = new Map<number, { count: number; at: number }>()

/**
 * 分类数量：站点没有数字接口，桌面版列表页会输出
 * 「Showing 1-32 of 20000」，移动版没有这段，所以这里单独用桌面 UA 抓。
 */
export async function pCategoryCount(catId: number): Promise<PCategoryCountResponse> {
  const cached = categoryCountCache.get(catId)
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) {
    return { ok: true, count: cached.count }
  }
  try {
    const res = await fetch(`${DEFAULT_SITE.base}/video?c=${catId}`, {
      headers: {
        'User-Agent': DESKTOP_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: DEFAULT_SITE.cookie
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000)
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const html = await res.text()
    const showing = html.match(/Showing\s+[\d,]+\s*-\s*[\d,]+\s+of\s+([\d,]+)/i)
    const numeric = showing ? Number.parseInt(showing[1].replace(/,/g, ''), 10) : 0
    if (numeric > 0) {
      categoryCountCache.set(catId, { count: numeric, at: Date.now() })
      return { ok: true, count: numeric }
    }
    // 兜底：末页 × 每页条数（站点有分页链接时可用）
    const pages = lastPageOf(html)
    const perPage = parseList(html).length
    const estimate = pages > 0 && perPage > 0 ? pages * perPage : 0
    if (estimate > 0) {
      categoryCountCache.set(catId, { count: estimate, at: Date.now() })
      return { ok: true, count: estimate }
    }
    return { ok: false, error: '站点没有给出数量' }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
          ? '请求超时'
          : '请求失败'
    }
  }
}

export async function pResolve(
  vkey: string,
  retried = false,
  siteInput?: Partial<PSite>
): Promise<PMediaResponse> {
  const site = siteOf(siteInput)
  try {
    const html = await getHtml(
      `${site.base}/view_video.php?viewkey=${encodeURIComponent(vkey)}`,
      site
    )
    return await resolveFromHtml(html, site, vkey, retried)
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
          ? '视频页请求超时（需外网）'
          : '视频页请求失败（需外网）'
    }
  }
}

/** 详情页一次抓取同时给出标题 / 封面 / 标签与播放地址，供爽看使用 */
export interface PDetailResponse {
  ok: boolean
  title?: string
  cover?: string
  durationSec?: number
  views?: string
  uploader?: string
  tags?: string[]
  intro?: string
  url?: string
  quality?: string
  isHls?: boolean
  error?: string
}

export async function pDetail(
  vkey: string,
  siteInput?: Partial<PSite>
): Promise<PDetailResponse> {
  const site = siteOf(siteInput)
  try {
    const html = await getHtml(
      `${site.base}/view_video.php?viewkey=${encodeURIComponent(vkey)}`,
      site
    )
    const doc = parse(html)
    const title =
      plainText(doc.querySelector('h1')?.text) ||
      html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.split('<')[0]?.trim() ||
      ''
    const cover =
      doc.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim() ?? ''
    const durationText = plainText(doc.querySelector('.duration')?.text)
    const durationSec = /^\d+(:\d+)+$/.test(durationText) ? parseDuration(durationText) : 0
    const views = plainText(doc.querySelector('.views')?.text)
    const uploader = plainText(doc.querySelector('.uploaderLink')?.text)
    const intro =
      doc.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ?? ''
    const tags: string[] = []
    for (const anchor of doc.querySelectorAll('a[href^="/video?c="]')) {
      const label = plainText(anchor.text)
      if (label && !tags.includes(label)) tags.push(label)
      if (tags.length >= 12) break
    }
    const media = await resolveFromHtml(html, site, vkey, false)
    if (!media.ok || !media.url) {
      return { ok: false, error: media.error || '没有解析到播放地址', title, cover, tags, intro }
    }
    return {
      ok: true,
      title,
      cover,
      durationSec,
      views,
      uploader,
      tags,
      intro,
      url: media.url,
      quality: media.quality,
      isHls: media.isHls
    }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
          ? '视频页请求超时（需外网）'
          : '视频页请求失败（需外网）'
    }
  }
}

async function resolveFromHtml(
  html: string,
  site: PSite,
  vkey: string,
  retried: boolean
): Promise<PMediaResponse> {
  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.split('<')[0]?.trim() ?? ''
  let sawMedia = false
  let allHls: RawDef[] = []

  const json = extractArrayAfter(html, 'mediaDefinitions')
  if (json) {
    try {
      const arr = JSON.parse(json) as unknown[]
      const defs: RawDef[] = []
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue
        const o = item as Record<string, unknown>
        const rawUrl =
          typeof o.videoUrl === 'string'
            ? o.videoUrl
            : typeof o.url === 'string'
              ? o.url
              : typeof o.src === 'string'
                ? o.src
                : ''
        if (!rawUrl.trim()) continue
        const url = normalizeMediaUrl(rawUrl, site.base)
        if (!/^https?:\/\//i.test(url)) continue
        defs.push({
          format: typeof o.format === 'string' ? o.format : '',
          quality:
            typeof o.quality === 'string'
              ? o.quality
              : typeof o.quality === 'number'
                ? String(o.quality)
                : '',
          url
        })
      }
      // 站点按清晰度给出多条 HLS，但部分签名地址会 403/410：
      // 逐个实测，取最高且可用的线路；第二条作为播放失败时的回退。
      allHls = defs.filter((d) => d.format.toLowerCase() === 'hls').sort(byQuality)
      const working = await pickWorkingHls(defs, site)
      sawMedia = sawMedia || defs.length > 0
      const direct = defs
        .filter((d) => d.format.toLowerCase() !== 'hls' && isPlayableDirect(d.url))
        .sort(byQuality)[0]
      if (working.length) {
        return {
          ok: true,
          url: working[0].url,
          quality: working[0].quality,
          isHls: true,
          // HLS 优先，备用线路优先另一条 HLS，再退 mp4 直链
          fallbackUrl: working[1]?.url ?? direct?.url
        }
      }
      if (direct) {
        return { ok: true, url: direct.url, quality: direct.quality || '直链', isHls: false }
      }
    } catch {
      // 继续走正则兜底
    }
  }

  const unescaped = html.replace(/\\\//g, '/')
  const m3u8 =
    unescaped.match(/https:\/\/[a-z0-9.-]*phncdn\.com\/[^"'\s<>]+?\.m3u8[^"'\s<>]*/)?.[0] ??
    unescaped.match(/https:\/\/[^"'\s<>]+?\.m3u8[^"'\s<>]*/)?.[0]
  if (m3u8) {
    const url = normalizeMediaUrl(m3u8, site.base)
    if (await probeHls(url, site)) return { ok: true, url, quality: '720', isHls: true }
  }

  if (title.toLowerCase().includes('age verification')) {
    return { ok: false, error: '该地区需年龄验证，换个节点重试' }
  }
  if (title.toLowerCase().includes('page not found')) {
    return { ok: false, error: '视频不存在（404）' }
  }
  if (title.toLowerCase().includes('unavailable') || /unavailable in your country/i.test(html)) {
    return { ok: false, error: '视频在当前节点地区被屏蔽，换个节点重试' }
  }
  if (sawMedia) {
    // 首次全部探测失败时重新打开一次视频页（签名/加速节点偶尔会瞬时 410）
    if (!retried) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 600))
      return pResolve(vkey, true, site)
    }
    // 重试后仍探测失败：把最高清晰度交给播放器再试一次，总比直接报错强
    if (allHls.length) {
      return {
        ok: true,
        url: allHls[0].url,
        quality: allHls[0].quality,
        isHls: true,
        fallbackUrl: allHls[1]?.url
      }
    }
    return { ok: false, error: '播放线路签名已失效或当前节点被拦截，请重试或换个视频' }
  }
  return { ok: false, error: `页面没有播放数据（可能被地区屏蔽，title=${title}）` }
}
