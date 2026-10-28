import { HTMLElement, parse } from 'node-html-parser'
import type {
  MelonBlock,
  MelonDetail,
  MelonDetailResponse,
  MelonListResponse,
  MelonPage,
  MelonPost
} from '../src/shared/melon'

/**
 * 吃瓜（51爆料）客户端：镜像线路发现 + Jsoup 式 HTML 解析。
 * 与手机端 MelonClient.kt 同口径：
 *  - 列表 article → div.post-card，封面在 loadBannerDirect('...')；
 *  - 翻页跟随站点 next 链接；
 *  - 详情正文取 [itemprop=articleBody]，视频在 .dplayer 的 data-config JSON；
 *  - 图片真实地址在 img 的任意属性里（src 是占位图）。
 */

const LANDING = 'https://www.ipqegzvg.cc/'
const FALLBACK_BASES = [
  'https://branch.ftnrqerm.cc',
  'https://branch.upsqllhj.cc',
  'https://abuse.upsqllhj.cc',
  'https://already.upsqllhj.cc',
  'https://d2hriolbecggrv.cloudfront.net'
]
const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

let cachedBase: string | null = null

async function httpGet(url: string): Promise<{ html: string; finalUrl: string }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return { html: await res.text(), finalUrl: res.url }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

async function probe(base: string): Promise<string | null> {
  try {
    const { html, finalUrl } = await httpGet(`${base.replace(/\/+$/, '')}/`)
    if (!html.includes('post-card')) return null
    return originOf(finalUrl) ?? originOf(base)
  } catch {
    return null
  }
}

function discoverFromLanding(html: string): string[] {
  const blob = html.match(/Base64\.decode\('([A-Za-z0-9+/=]+)'\)/)?.[1]
  if (!blob) return []
  let decoded = ''
  try {
    decoded = Buffer.from(blob, 'base64').toString('utf8')
  } catch {
    return []
  }
  const hosts = new Set<string>()
  for (const m of decoded.matchAll(/https?:\/\/[A-Za-z0-9.-]+/g)) {
    const host = m[0].replace(/\.+$/, '')
    const bare = host.replace(/^https?:\/\//, '')
    if (!bare) continue
    if (
      bare.includes('51bl') ||
      bare.includes('baoliao') ||
      bare.includes('szwfphzc') ||
      bare.includes('telegram') ||
      bare.includes('pm.me')
    ) {
      continue
    }
    hosts.add(host)
  }
  return [...hosts]
}

async function discoverBase(): Promise<string> {
  const candidates: string[] = []
  try {
    const landing = await httpGet(LANDING)
    candidates.push(...discoverFromLanding(landing.html))
  } catch {
    // 着陆页不可达时只用兜底线路
  }
  candidates.push(...FALLBACK_BASES)
  for (const base of [...new Set(candidates)]) {
    const alive = await probe(base)
    if (alive) return alive
  }
  return FALLBACK_BASES[0]
}

async function currentBase(): Promise<string> {
  if (cachedBase) return cachedBase
  cachedBase = await discoverBase()
  return cachedBase
}

async function getPage(rawPath: string): Promise<{ html: string; finalUrl: string }> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    const base = await currentBase()
    const url = /^https?:\/\//i.test(rawPath)
      ? rawPath
      : `${base}/${rawPath.replace(/^\/+/, '')}`
    try {
      const { html, finalUrl } = await httpGet(url)
      const finalOrigin = originOf(finalUrl)
      if (finalOrigin && finalOrigin !== base) cachedBase = finalOrigin
      if (!html.trim()) throw new Error('站点返回空内容')
      return { html, finalUrl }
    } catch (err) {
      lastError = err
      const status = (err as { status?: number }).status ?? 0
      const retryable = !status || status === 403 || (status >= 500 && status <= 599)
      if (!retryable || attempt === 1) break
      cachedBase = null
    }
  }
  throw lastError instanceof Error ? lastError : new Error('加载失败')
}

/* ---------------- 列表 ---------------- */

function normalizeNext(path: string): string {
  const m = path.match(/^\/(\d+)\/?$/)
  return m ? `/page/${m[1]}/` : path
}

function parseList(html: string, finalUrl: string): MelonPage {
  const doc = parse(html)
  const base = originOf(finalUrl)?.replace(/\/+$/, '') ?? ''
  const items: MelonPost[] = []
  for (const art of doc.querySelectorAll('article')) {
    if (art.classList.contains('ad-item')) continue
    const card = art.querySelector('div.post-card[id^=post-card-]')
    if (!card) continue
    const id = (card.getAttribute('id') ?? '').replace('post-card-', '')
    const title = (card.querySelector('h2.post-card-title')?.text ?? '').trim()
    if (!id || !title) continue
    const banner = card.innerHTML.match(/loadBannerDirect\('([^']+)'/)
    const cover = banner && banner[1].startsWith('http') ? banner[1] : null
    const info = card.querySelector('.post-card-info')
    const author = (info?.querySelector('span[itemprop=author]')?.text ?? '')
      .trim()
      .replace(/[•\s]+$/, '')
    const date = (info?.querySelector('span[itemprop=datePublished]')?.text ?? '')
      .trim()
      .replace(/[•\s]+$/, '')
    const categoryText = info
      ? [...info.querySelectorAll('span')]
          .filter((s) => !s.getAttribute('itemprop'))
          .pop()?.text ?? ''
      : ''
    const categories = categoryText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    items.push({ id, title, cover, author, date, categories })
  }

  const nextSelectors = [
    '.page-navigator li.next a[href]',
    '.page-navigator a.next[href]',
    '.pagination li.next a[href]',
    'a.next[href]'
  ]
  let nextRaw: string | null = null
  for (const sel of nextSelectors) {
    const a = doc.querySelector(sel)
    const href = a?.getAttribute('href')
    if (href) {
      nextRaw = href
      break
    }
  }
  let nextPath: string | null = null
  if (nextRaw) {
    if (nextRaw.startsWith('http')) {
      const idx = nextRaw.indexOf(base)
      nextPath = idx >= 0 ? nextRaw.slice(idx + base.length) || null : nextRaw
    } else {
      nextPath = nextRaw
    }
    if (nextPath) nextPath = normalizeNext(nextPath)
  }

  const nav = doc.querySelector('.page-navigator') ?? doc.querySelector('.pagination')
  let lastPage: number | null = null
  if (nav) {
    for (const a of nav.querySelectorAll('a[href]')) {
      const n = Number.parseInt((a.getAttribute('href') ?? '').match(/\/(\d+)\/?$/)?.[1] ?? '', 10)
      if (Number.isFinite(n) && (!lastPage || n > lastPage)) lastPage = n
    }
  }

  const seen = new Set<string>()
  return {
    items: items.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true))),
    nextPath,
    lastPage
  }
}

export async function melonList(path: string): Promise<MelonListResponse> {
  try {
    const { html, finalUrl } = await getPage(path || '/')
    return { ok: true, page: parseList(html, finalUrl) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '加载失败' }
  }
}

/* ---------------- 详情 ---------------- */

function realImage(img: HTMLElement): string | null {
  for (const [, value] of Object.entries(img.attributes)) {
    const v = String(value).trim()
    if (
      v.startsWith('http') &&
      /\.(jpe?g|png|gif|webp)([?#].*)?$/i.test(v) &&
      !v.includes('/usr/plugins/')
    ) {
      return v
    }
  }
  return null
}

function parseVideoConfig(el: HTMLElement): MelonBlock | null {
  const cfg = el.getAttribute('data-config')
  if (!cfg) return null
  try {
    const json = JSON.parse(cfg) as Record<string, unknown>
    const video = json.video as Record<string, unknown> | undefined
    const h265 = json.video_h265 as Record<string, unknown> | undefined
    const url =
      (typeof video?.url === 'string' && video.url.startsWith('http') ? video.url : '') ||
      (typeof h265?.url === 'string' && h265.url.startsWith('http') ? h265.url : '')
    if (!url) return null
    return {
      type: 'video',
      title: (el.getAttribute('data-video_title') ?? '').trim() || '视频',
      url
    }
  } catch {
    return null
  }
}

export async function melonDetail(rawId: string): Promise<MelonDetailResponse> {
  const id = rawId.trim()
  if (!/^\d+$/.test(id)) return { ok: false, error: '帖子编号无效' }
  try {
    const { html } = await getPage(`/archives/${id}/`)
    const doc = parse(html)
    const title = (doc.querySelector('h1.post-title')?.text ?? '').trim()
    if (!title) return { ok: false, error: '帖子不存在或已被删除' }
    const cover =
      doc.querySelector('meta[itemprop=image]')?.getAttribute('content')?.trim() || null
    const meta = doc.querySelector('ul.post-meta')
    const links = meta ? meta.querySelectorAll('li a') : []
    const author = (links[0]?.text ?? '').trim()
    const date = (meta?.querySelector('time')?.text ?? '').trim()
    const categories = links
      .slice(1)
      .map((a) => a.text.trim())
      .filter(Boolean)

    const body = doc.querySelector('[itemprop=articleBody]')
    if (!body) return { ok: false, error: '正文解析失败' }

    const blocks: MelonBlock[] = []
    for (const child of body.childNodes) {
      if (!(child instanceof HTMLElement)) continue
      if (
        child.classList.contains('txt-apps') ||
        child.classList.contains('horizontal-banner') ||
        ['table', 'script', 'blockquote'].includes(child.tagName.toLowerCase())
      ) {
        continue
      }
      if (child.classList.contains('dplayer')) {
        const video = parseVideoConfig(child)
        if (video) blocks.push(video)
        continue
      }
      const tag = child.tagName.toLowerCase()
      if (tag === 'p') {
        for (const img of child.querySelectorAll('img')) {
          const url = realImage(img)
          if (url) blocks.push({ type: 'image', url })
        }
        const text = child.text.trim()
        if (text) blocks.push({ type: 'text', text })
        continue
      }
      if (['h1', 'h2', 'h3', 'h4', 'h5'].includes(tag)) {
        const text = child.text.trim()
        if (text) blocks.push({ type: 'heading', text })
      }
    }

    const related = body
      .querySelectorAll('a[href*=archives]')
      .map((a) => {
        const href = a.getAttribute('href') ?? ''
        const rid = href.match(/archives\/(\d+)/)?.[1] ?? ''
        const rtitle = a.text.trim()
        return rid && rtitle && rid !== id ? { rid, rtitle } : null
      })
      .filter((r): r is { rid: string; rtitle: string } => !!r)
      .filter((r, i, arr) => arr.findIndex((x) => x.rid === r.rid) === i)
      .slice(0, 6)
      .map((r) => ({
        id: r.rid,
        title: r.rtitle,
        cover: null,
        author: '',
        date: '',
        categories: []
      }))

    const detail: MelonDetail = {
      id,
      title,
      cover,
      author,
      date,
      categories,
      blocks,
      related
    }
    return { ok: true, detail }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '加载失败' }
  }
}
