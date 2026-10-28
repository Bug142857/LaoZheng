import { parse } from 'node-html-parser'
import type { PListResponse, PMediaResponse, PVideo } from '../src/shared/psite'

/** P站（pornhub.com）客户端：网页解析，与手机端 PsiteClient.kt 同口径 */

const BASE = 'https://www.pornhub.com'
const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const COOKIE = 'accessAgeDisclaimerPH=1; age_verified=1; accessPH=1'

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
    } else if (sortCode === 'recommended') {
      url = `${BASE}/recommended?${catId > 0 ? `c=${catId}&` : ''}page=${p}`
    } else {
      const q: string[] = []
      if (sortCode) q.push(`o=${sortCode}`)
      if (catId > 0) q.push(`c=${catId}`)
      q.push(`page=${p}`)
      url = `${BASE}/video?${q.join('&')}`
    }
    const html = await getHtml(url)
    const items = parseList(html)
    return { ok: true, items, lastPage: lastPageOf(html) }
  } catch (err) {
    return {
      ok: false,
      items: [],
      lastPage: 0,
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

function selectMedia(defs: RawDef[]): PMediaResponse | null {
  const hls = defs
    .filter((d) => d.format.toLowerCase() === 'hls')
    .sort((a, b) => (Number.parseInt(b.quality, 10) || -1) - (Number.parseInt(a.quality, 10) || -1))
  if (hls.length) return { ok: true, url: hls[0].url, quality: hls[0].quality, isHls: true }
  const other = defs.find((d) => d.format.toLowerCase() !== 'hls')
  if (other) return { ok: true, url: other.url, quality: '直链', isHls: false }
  return null
}

export async function pResolve(vkey: string): Promise<PMediaResponse> {
  try {
    const html = await getHtml(`${BASE}/view_video.php?viewkey=${encodeURIComponent(vkey)}`)
    const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.split('<')[0]?.trim() ?? ''

    const json = extractArrayAfter(html, 'mediaDefinitions')
    if (json) {
      try {
        const arr = JSON.parse(json) as unknown[]
        const defs: RawDef[] = []
        for (const item of arr) {
          if (!item || typeof item !== 'object') continue
          const o = item as Record<string, unknown>
          const url = typeof o.videoUrl === 'string' ? o.videoUrl : ''
          if (!url.startsWith('http')) continue
          defs.push({
            format: typeof o.format === 'string' ? o.format : '',
            quality: typeof o.quality === 'string' ? o.quality : '',
            url
          })
        }
        const chosen = selectMedia(defs)
        if (chosen) return chosen
      } catch {
        // 继续走正则兜底
      }
    }

    const unescaped = html.replace(/\\\//g, '/')
    const m3u8 = unescaped.match(
      /https:\/\/[a-z0-9-]+\.phncdn\.com\/[^"'\s<>]+?master\.m3u8[^"'\s<>]*/
    )?.[0]
    if (m3u8) return { ok: true, url: m3u8, quality: '720', isHls: true }

    if (title.toLowerCase().includes('age verification')) {
      return { ok: false, error: '该地区需年龄验证，换个节点重试' }
    }
    if (title.toLowerCase().includes('page not found')) {
      return { ok: false, error: '视频不存在（404）' }
    }
    if (title.toLowerCase().includes('unavailable') || /unavailable in your country/i.test(html)) {
      return { ok: false, error: '视频在当前节点地区被屏蔽，换个节点重试' }
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
