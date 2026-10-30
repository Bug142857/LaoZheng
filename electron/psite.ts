import { parse } from 'node-html-parser'
import type {
  PCategoryCountResponse,
  PListResponse,
  PMediaResponse,
  PVideo
} from '../src/shared/psite'

/** P站（pornhub.com）客户端：网页解析，与手机端 PsiteClient.kt 同口径 */

const BASE = 'https://www.pornhub.com'
const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const COOKIE = 'accessAgeDisclaimerPH=1; age_verified=1; accessPH=1'

/** 媒体请求（m3u8 / 分片 / 直链）统一带站内 Referer 与年龄 Cookie，部分节点会校验 */
const MEDIA_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: '*/*',
  Referer: `${BASE}/`,
  Cookie: COOKIE
}

async function getHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: COOKIE
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
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
  for (const m of html.matchAll(/[?&]page=(\d+)/g)) {
    const n = Number.parseInt(m[1], 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
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
  page: number
): Promise<PListResponse> {
  try {
    const p = Math.max(1, page)
    const kw = query.trim()
    let url: string
    if (kw) {
      url = `${BASE}/video/search?search=${encodeURIComponent(kw)}&page=${p}`
    } else if (catId > 0) {
      // 推荐页带 c 参数不会真正过滤分类，分类统一走 /video?c=
      url = `${BASE}/video?c=${catId}&page=${p}`
    } else if (sortCode === 'recommended') {
      url = `${BASE}/recommended?page=${p}`
    } else {
      const q: string[] = []
      if (sortCode) q.push(`o=${sortCode}`)
      if (catId > 0) q.push(`c=${catId}`)
      q.push(`page=${p}`)
      url = `${BASE}/video?${q.join('&')}`
    }
    const html = await getHtml(url)
    const items = parseList(html)
    const lastPage = lastPageOf(html)
    // 站点分页条只渲染当前页附近几页（常见只到 5），不能据此判断到底：
    // 本页有足够条目就认为还有下一页，翻到空页才停。
    const hasMore = items.length >= 16 || (lastPage > 0 && p < lastPage)
    return { ok: true, items, lastPage, hasMore }
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
function normalizeMediaUrl(raw: string): string {
  let url = raw.trim().replace(/\\\//g, '/')
  if (url.startsWith('//')) url = `https:${url}`
  if (url.startsWith('/')) url = `${BASE}${url}`
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
async function probeHls(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: MEDIA_HEADERS,
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
async function pickWorkingHls(defs: RawDef[]): Promise<RawDef[]> {
  const hls = defs.filter((d) => d.format.toLowerCase() === 'hls').sort(byQuality)
  if (!hls.length) return []
  const results = await Promise.all(
    hls.map(async (def) => ({ def, ok: await probeHls(def.url) }))
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
    const res = await fetch(`${BASE}/video?c=${catId}`, {
      headers: {
        'User-Agent': DESKTOP_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: COOKIE
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

export async function pResolve(vkey: string, retried = false): Promise<PMediaResponse> {
  try {
    const html = await getHtml(`${BASE}/view_video.php?viewkey=${encodeURIComponent(vkey)}`)
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
          const url = normalizeMediaUrl(rawUrl)
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
        const working = await pickWorkingHls(defs)
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
      unescaped.match(/"https:\/\/[^"]+?\.m3u8[^"]*"/)?.[0]?.replace(/^"|"$/g, '')
    if (m3u8) {
      const url = normalizeMediaUrl(m3u8)
      if (await probeHls(url)) return { ok: true, url, quality: '720', isHls: true }
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
        return pResolve(vkey, true)
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
