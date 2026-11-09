import { createHash, randomBytes } from 'node:crypto'

/** 平台直播公共工具：请求、UA、缓存与类型转换 */

export const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export const BILI_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
export const DOUYU_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
export const DOUYIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface FetchOptions {
  headers?: Record<string, string>
  method?: string
  body?: string
  timeoutMs?: number
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    body: options.body,
    headers: {
      Accept: 'application/json, text/plain, */*',
      ...(options.headers ?? {})
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000)
  })
  return res.text()
}

export async function fetchJson<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
  const text = await fetchText(url, options)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('接口返回的不是 JSON，可能被平台风控或接口已变更')
  }
}

export function md5(value: string): string {
  return createHash('md5').update(value, 'utf8').digest('hex')
}

/** 斗鱼匿名设备号：32 位十六进制 */
export function randomDeviceId(): string {
  return randomBytes(16).toString('hex')
}

export function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

export function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return 0
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' '
}

export function decodeHtml(value: unknown): string {
  return asString(value)
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .trim()
}

/** 图片地址补全：协议相对 / 相对路径 */
export function absoluteUrl(value: unknown, base: string): string {
  const raw = asString(value).trim()
  if (!raw) return ''
  if (raw.startsWith('//')) return `https:${raw}`
  if (/^https?:\/\//i.test(raw)) return raw
  try {
    return new URL(raw, base).toString()
  } catch {
    return raw
  }
}

export function formatWatching(value: unknown): string {
  const n = asNumber(value)
  if (n <= 0) return ''
  if (n >= 100_000_000) {
    const yi = n / 100_000_000
    return `${yi >= 10 ? Math.round(yi) : yi.toFixed(1).replace(/\.0$/, '')}亿`
  }
  if (n >= 10_000) {
    const w = n / 10_000
    return `${w >= 10 ? Math.round(w) : w.toFixed(1).replace(/\.0$/, '')}万`
  }
  return String(n)
}

interface CacheEntry<T> {
  value: T
  at: number
}

const cache = new Map<string, CacheEntry<unknown>>()

export function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value as T)
  return loader().then((value) => {
    cache.set(key, { value, at: Date.now() })
    return value
  })
}

export function clearLiveCache(): void {
  cache.clear()
}

/** 从输入里取房间号：纯数字、直播间链接或分享文本 */
export function extractRoomId(input: string, hosts: RegExp): string {
  const text = input.trim()
  if (!text) return ''
  if (/^\d{1,20}$/.test(text)) return text
  const match = text.match(/https?:\/\/[^\s"'<>]+/i)?.[0]
  if (!match) {
    const loose = text.match(/\d{3,20}/)
    return loose ? loose[0] : ''
  }
  try {
    const url = new URL(match)
    if (!hosts.test(url.hostname)) return ''
    const segments = url.pathname.split('/').filter(Boolean)
    for (const segment of segments) {
      if (/^\d{1,20}$/.test(segment)) return segment
    }
    return ''
  } catch {
    return ''
  }
}
