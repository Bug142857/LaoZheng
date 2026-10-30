import { createDecipheriv, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HTMLElement, parse } from 'node-html-parser'
import { MELON_CATEGORIES } from '../src/shared/melon'
import { imageCacheDir, sniffImageMime } from './imageCache'
import type {
  MelonBlock,
  MelonCategoryCountsResponse,
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

/** 解析过程中出现过的图床域名：请求层据此补移动 UA 与镜像 Referer（站点有防盗链） */
const imageHosts = new Set<string>()

function trackImage(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol === 'http:' || u.protocol === 'https:') imageHosts.add(u.hostname)
  } catch {
    // 非法地址忽略
  }
  return url
}

/** 渲染进程用缓存列表直接渲染封面时，把这些图床域名补登记一次 */
export function trackMelonImages(urls: string[]): void {
  for (const url of urls.slice(0, 200)) trackImage(url)
}

/** 吃瓜图片需要与站点一致的移动 UA + 镜像 Referer，否则图床返回 403 */
export function melonImageAuth(url: URL): { referer: string; ua: string } | null {
  if (!imageHosts.has(url.hostname)) return null
  return { referer: `${cachedBase ?? originOf(url.href) ?? LANDING}/`, ua: UA }
}

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

/** 吃瓜镜像的 Referer（下载 / 修复旧切片时补防盗链头用） */
export function melonReferer(): string {
  return `${cachedBase ?? LANDING}/`
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
    const cover = banner && banner[1].startsWith('http') ? trackImage(banner[1]) : null
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
      return trackImage(v)
    }
  }
  return null
}

/** 正文尾部的站点文案（关键词 / 猜你喜欢 / 原文简介 / 版权声明等）不展示 */
const MELON_NOISE_PREFIX =
  /^(关键词|关键字|猜你喜欢|相关推荐|原文简介|版权声明|免责声明|免责|声明|上一篇|下一篇|返回列表|热门推荐|更多精彩|更多内容|最新域名|永久域名|可能你会感兴趣|热门吃瓜|AI\s*成人短剧|AI\s*短剧)/i

function isMelonNoise(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (MELON_NOISE_PREFIX.test(t)) return true
  // 站点常把版权声明 / 原文简介 / 猜你喜欢 / 域名等塞进正文最后一段，整段丢弃
  return /版权声明|免责声明|原文简介|猜你喜欢|相关推荐|关键词[:：]|关键字[:：]|本站仅提供|如有侵权|域名[:：]|可能你会感兴趣|热门吃瓜/.test(
    t
  )
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
    // 视频 CDN 与图床一样有防盗链：登记域名，播放 / 下载请求补镜像 Referer
    trackImage(url)
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
    const rawCover =
      doc.querySelector('meta[itemprop=image]')?.getAttribute('content')?.trim() || ''
    const cover = rawCover.startsWith('http') ? trackImage(rawCover) : null
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
        if (text && !isMelonNoise(text)) blocks.push({ type: 'text', text })
        continue
      }
      if (['h1', 'h2', 'h3', 'h4', 'h5'].includes(tag)) {
        const text = child.text.trim()
        if (text && !isMelonNoise(text)) blocks.push({ type: 'heading', text })
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

/* ---------------- 图片解密 + 取图 ----------------
 * 站点图床返回的是 AES-128-CBC 密文（不是 JPEG），站点前端用 zzz.js 里的
 * decryptImage 解密：key/iv 是两串「数字_数字…」按 charCode 还原出来的 16 位字符。
 * 这里内置一份实测值，同时从 zzz.js 动态提取一遍；两种 key/iv 顺序都会试。
 */

const IMAGE_KEY_FALLBACK = 'f5d965df75336270'
const IMAGE_IV_FALLBACK = '97b60394abc2fbe1'

interface ImageCrypt {
  key: string
  iv: string
}

let imageCrypt: ImageCrypt = { key: IMAGE_KEY_FALLBACK, iv: IMAGE_IV_FALLBACK }
let imageCryptTried = false

function codeStringToText(raw: string): string {
  return raw
    .split('_')
    .map((n) => String.fromCharCode(Number.parseInt(n, 10)))
    .join('')
}

async function discoverImageCrypt(): Promise<void> {
  if (imageCryptTried) return
  imageCryptTried = true
  try {
    const base = await currentBase()
    const { html } = await httpGet(`${base}/usr/plugins/tbxw/js/zzz.js`)
    const seqs = [...html.matchAll(/\d+(?:_\d+){15}/g)]
      .map((m) => codeStringToText(m[0]))
      .filter((s) => s.length === 16)
    if (seqs.length >= 2) {
      // 站点 decryptImage 里第二个字符串作 key、第一个作 iv（实测）
      imageCrypt = { key: seqs[1], iv: seqs[0] }
    }
  } catch {
    // 提取失败时保留内置 key
  }
}

function imageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png'
  if (buf.slice(0, 4).toString('ascii') === 'GIF8') return 'image/gif'
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  return null
}

function tryDecrypt(buf: Buffer, key: string, iv: string): Buffer | null {
  try {
    const decipher = createDecipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'))
    const out = Buffer.concat([decipher.update(buf), decipher.final()])
    return imageMime(out) ? out : null
  } catch {
    return null
  }
}

async function decodeImageBuffer(buf: Buffer): Promise<Buffer> {
  if (imageMime(buf)) return buf
  await discoverImageCrypt()
  const candidates: ImageCrypt[] = [
    imageCrypt,
    { key: IMAGE_KEY_FALLBACK, iv: IMAGE_IV_FALLBACK },
    { key: IMAGE_IV_FALLBACK, iv: IMAGE_KEY_FALLBACK }
  ]
  for (const candidate of candidates) {
    const out = tryDecrypt(buf, candidate.key, candidate.iv)
    if (out) {
      imageCrypt = candidate
      return out
    }
  }
  return buf
}

export interface MelonImageResponse {
  ok: boolean
  dataUrl?: string
  error?: string
}

/** 取吃瓜图片并解密成 data URL（渲染进程直接给 <img> 用）；解密结果落盘，重开应用不再重新取图 */
export async function melonFetchImage(url: string): Promise<MelonImageResponse> {
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: '图片地址无效' }
  const file = join(
    imageCacheDir(),
    `melon-${createHash('sha1').update(url).digest('hex')}`
  )
  try {
    const cached = await readFile(file)
    if (cached.length) {
      return {
        ok: true,
        dataUrl: `data:${sniffImageMime(cached) ?? 'image/jpeg'};base64,${cached.toString('base64')}`
      }
    }
  } catch {
    // 未缓存，走网络
  }
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Referer: `${cachedBase ?? LANDING}/`,
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const raw = Buffer.from(await res.arrayBuffer())
    const decoded = await decodeImageBuffer(raw)
    const mime = imageMime(decoded) ?? 'image/jpeg'
    void mkdir(imageCacheDir(), { recursive: true })
      .then(() => writeFile(file, decoded))
      .catch(() => undefined)
    return { ok: true, dataUrl: `data:${mime};base64,${decoded.toString('base64')}` }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
          ? '图片请求超时'
          : '图片加载失败'
    }
  }
}

/* ---------------- 正文视频时长 ----------------
 * 站点不返回时长：HLS 直接读播放列表里的 #EXTINF 累加；直链 mp4 由渲染进程用 video 元数据补。
 */

export interface MelonDurationResponse {
  ok: boolean
  seconds?: number
  error?: string
}

function sumExtinf(text: string): number {
  let total = 0
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('#EXTINF:')) continue
    const value = Number.parseFloat(line.slice(8))
    if (Number.isFinite(value)) total += value
  }
  return total
}

/** master 播放列表里第一条清晰度地址 */
function firstVariant(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue
    const next = lines.slice(i + 1).find((line) => line && !line.startsWith('#'))
    if (next) return next
  }
  return ''
}

export async function melonVideoDuration(rawUrl: string): Promise<MelonDurationResponse> {
  if (!/^https?:\/\//i.test(rawUrl)) return { ok: false, error: '地址无效' }
  const headers = { 'User-Agent': UA, Referer: melonReferer(), Accept: '*/*' }
  try {
    let url = rawUrl
    let res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    let text = await res.text()
    if (text.includes('#EXT-X-STREAM-INF')) {
      const variant = firstVariant(text)
      if (!variant) return { ok: false, error: '播放列表为空' }
      url = new URL(variant, url).toString()
      res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      text = await res.text()
    }
    const seconds = Math.round(sumExtinf(text))
    if (seconds > 0) return { ok: true, seconds }
    return { ok: false, error: '没有解析到时长' }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
          ? '请求超时'
          : '解析失败'
    }
  }
}

/* ---------------- 分类数量 ---------------- */
interface CountCacheEntry {
  counts: Record<string, number>
  at: number
}

let countsCache: CountCacheEntry | null = null

/** 分类页翻页形如 /page/1337/ 或 /category/xsxy/107/，据此拼末页地址 */
function lastPagePath(path: string, lastPage: number): string {
  const clean = path.replace(/^\/+/, '').replace(/\/+$/, '')
  return clean ? `/${clean}/${lastPage}/` : `/page/${lastPage}/`
}

async function countForCategory(path: string): Promise<number> {
  const { html, finalUrl } = await getPage(path || '/')
  const first = parseList(html, finalUrl)
  const perPage = first.items.length
  if (!perPage) return 0
  const lastPage = first.lastPage ?? 1
  if (lastPage <= 1) return perPage
  const { html: lastHtml, finalUrl: lastUrl } = await getPage(lastPagePath(path, lastPage))
  const last = parseList(lastHtml, lastUrl)
  return Math.max(0, (lastPage - 1) * perPage + (last.items.length || perPage))
}

/** 各分类条目数量（按分页末页推算，10 分钟内缓存） */
export async function melonCategoryCounts(): Promise<MelonCategoryCountsResponse> {
  if (countsCache && Date.now() - countsCache.at < 10 * 60 * 1000) {
    return { ok: true, counts: countsCache.counts }
  }
  const counts: Record<string, number> = {}
  const queue = [...MELON_CATEGORIES]
  let failed = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const category = queue.shift()
      if (!category) return
      try {
        counts[category.path] = await countForCategory(category.path)
      } catch {
        failed += 1
        counts[category.path] = -1
      }
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker))
  if (Object.keys(counts).length) countsCache = { counts, at: Date.now() }
  return {
    ok: true,
    counts,
    error: failed ? `${failed} 个分类暂时取不到数量` : undefined
  }
}
