import { protocol, type Session } from 'electron'
import { createDecipheriv, createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cacheRoot } from './settings'
import { decryptBikahubImage } from './bikahubImage'
import { descrambleJmImage, jmImageNeedsDescramble } from './jmcomicImage'
import { sniffImageMime } from '../src/shared/imageSniff'

export { sniffImageMime } from '../src/shared/imageSniff'

/**
 * 图片磁盘缓存：所有 http(s) 图片请求在请求层重定向到 lzimg://，
 * 主进程按 URL 哈希存到 <cacheRoot>/image-cache（默认 userData，可更换），命中则直接返回本地字节。
 * 这样重开应用时封面 / 剧照 / 头像都能立刻显示，不再等网络。
 */

const SCHEME = 'lzimg'
const CACHE_CONTROL = 'public, max-age=31536000, immutable'
/** xhcdn 等图床在并发拉图时会偶发 ECONNRESET：失败后短暂等待重试一次即可恢复 */
const FETCH_ATTEMPTS = 2
const RETRY_DELAY_MS = 150
/**
 * 同一图床并发上限：一次列表刷新会同时请求几十张封面（xhamster 一页 46 张），
 * 全量并发时 xhcdn 会直接断开一部分连接，表现为「刷新后有几张封面一直不显示，
 * 切分类再回来才恢复」。按浏览器同款 6 并发限流后实测 0 失败。
 */
const HOST_CONCURRENCY = 6
/**
 * 图片缓存容量上限（10GB）+ LRU 淘汰：
 * 以前缓存只写不删，长期使用会无限增长；命中时更新 mtime 作为最近使用时间，
 * 超过上限后按 mtime 从旧到新删除，刚访问过的文件（10 分钟内）跳过，避免删掉正在读取的图。
 */
const IMAGE_CACHE_MAX_BYTES = 10 * 1024 * 1024 * 1024
const IMAGE_CACHE_TRIM_RATIO = 0.9
const MIN_EVICT_AGE_MS = 10 * 60_000
const TOUCH_INTERVAL_MS = 6 * 60 * 60_000
let cacheBytes: number | null = null
let scanning = false
let evictScheduled = false
const touchedAt = new Map<string, number>()

/** 图片缓存当前占用（供设置页与容量淘汰使用） */
export async function imageCacheBytes(): Promise<number> {
  if (cacheBytes != null) return cacheBytes
  return scanImageCache()
}

export function invalidateImageCacheSize(): void {
  cacheBytes = null
}

async function scanImageCache(): Promise<number> {
  if (scanning) return cacheBytes ?? 0
  scanning = true
  try {
    let total = 0
    let entries
    try {
      entries = await readdir(imageCacheDir(), { withFileTypes: true })
    } catch {
      cacheBytes = 0
      return 0
    }
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.endsWith('.tmp')) continue
      const info = await stat(join(imageCacheDir(), entry.name)).catch(() => null)
      if (info) total += info.size
    }
    cacheBytes = total
    return total
  } finally {
    scanning = false
  }
}

/** 命中缓存时更新 mtime（LRU 依据），同一文件 6 小时内只写一次 */
function touchCacheFile(file: string): void {
  const now = Date.now()
  if (now - (touchedAt.get(file) ?? 0) < TOUCH_INTERVAL_MS) return
  touchedAt.set(file, now)
  if (touchedAt.size > 4000) {
    for (const key of touchedAt.keys()) {
      touchedAt.delete(key)
      if (touchedAt.size <= 2000) break
    }
  }
  void utimes(file, new Date(), new Date()).catch(() => undefined)
}

function scheduleEviction(): void {
  if (evictScheduled) return
  evictScheduled = true
  const timer = setTimeout(() => {
    evictScheduled = false
    void evictImageCache()
  }, 800)
  timer.unref?.()
}

/** 超过 10GB 时按 mtime 从旧到新淘汰到 9GB；删除失败（正被占用）直接跳过 */
export async function evictImageCache(): Promise<void> {
  if (scanning) return
  const total = await imageCacheBytes()
  if (total <= IMAGE_CACHE_MAX_BYTES) return
  scanning = true
  try {
    const dir = imageCacheDir()
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      cacheBytes = 0
      return
    }
    const files: { path: string; size: number; mtime: number }[] = []
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.endsWith('.tmp')) continue
      const path = join(dir, entry.name)
      const info = await stat(path).catch(() => null)
      if (info) files.push({ path, size: info.size, mtime: info.mtimeMs })
    }
    files.sort((a, b) => a.mtime - b.mtime)
    const target = IMAGE_CACHE_MAX_BYTES * IMAGE_CACHE_TRIM_RATIO
    const now = Date.now()
    let current = total
    for (const file of files) {
      if (current <= target) break
      if (now - file.mtime < MIN_EVICT_AGE_MS) continue
      await rm(file.path, { force: true }).catch(() => undefined)
      touchedAt.delete(file.path)
      current -= file.size
    }
    cacheBytes = current
    console.log(
      `[imageCache] 缓存超限已淘汰：${(total / 1024 ** 3).toFixed(2)}GB → ${(
        current / 1024 ** 3
      ).toFixed(2)}GB`
    )
  } finally {
    scanning = false
  }
}

/** 各图床的并发信号量；waiter 被唤醒时名额直接转交，active 不变 */
const hostSlots = new Map<string, { active: number; waiters: Array<() => void> }>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function hostOf(target: string): string {
  try {
    return new URL(target).hostname.toLowerCase()
  } catch {
    return ''
  }
}

async function withHostSlot<T>(host: string, task: () => Promise<T>): Promise<T> {
  if (!host) return task()
  let slot = hostSlots.get(host)
  if (!slot) {
    slot = { active: 0, waiters: [] }
    hostSlots.set(host, slot)
  }
  if (slot.active >= HOST_CONCURRENCY) {
    await new Promise<void>((resolve) => slot!.waiters.push(resolve))
  } else {
    slot.active += 1
  }
  try {
    return await task()
  } finally {
    const next = slot.waiters.shift()
    if (next) next()
    else slot.active -= 1
    // 空闲图床不保留信号量，避免长期积累
    if (slot.active === 0 && slot.waiters.length === 0) hostSlots.delete(host)
  }
}

async function fetchImage(target: string, headerFor: (url: string) => Record<string, string>): Promise<Response> {
  let lastError: unknown = null
  const host = hostOf(target)
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const res = await withHostSlot(host, () =>
        fetch(target, {
          headers: headerFor(target),
          redirect: 'follow',
          signal: AbortSignal.timeout(20_000)
        })
      )
      // 5xx / 429 是图床临时故障，可以重试；4xx 重试没有意义
      const retryable = res.status >= 500 || res.status === 429
      if (res.ok || !retryable || attempt === FETCH_ATTEMPTS) return res
    } catch (err) {
      lastError = err
      if (attempt === FETCH_ATTEMPTS) throw err
    }
    await sleep(RETRY_DELAY_MS)
  }
  throw lastError ?? new Error('图片请求失败')
}

export function registerImageCacheScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ])
}

export function imageCacheDir(): string {
  return join(cacheRoot(), 'image-cache')
}

function keyOf(url: string): string {
  return createHash('sha1').update(url).digest('hex')
}

/** 本机 / 回环地址：图片缓存不代理，避免被构造 lzimg 地址探测本机端口 */
function isLoopbackHost(host: string): boolean {
  const value = host.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    value === 'localhost' ||
    value === '::1' ||
    value === '0.0.0.0' ||
    /^127\./.test(value)
  )
}

/** 把图片请求重定向到缓存协议；本地媒体服务与 data/blob 不处理 */
export function setupImageRequestRedirect(ses: Session): void {
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (details.resourceType !== 'image' || !/^https?:\/\//i.test(details.url)) {
      callback({})
      return
    }
    try {
      const url = new URL(details.url)
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
        callback({})
        return
      }
      // 旧图床域名先重写再进缓存，保证同一张图只存一份
      if (/^qnmob\d*\.doubanio\.com$/.test(url.hostname)) {
        url.hostname = 'img2.doubanio.com'
      }
      callback({ redirectURL: `${SCHEME}://cache/${encodeURIComponent(url.toString())}` })
    } catch {
      callback({})
    }
  })
}

/**
 * 搬山人小说网的封面 / 插图是 AES-128-CBC 密文（前 16 字节是 IV），
 * 站点脚本 decrypt.worker.js 用固定密钥在前端还原；这里按同样算法解开。
 */
const BANSHANREN_IMAGE_KEY = Buffer.from('V4@.Tx+uXZn)AiH>', 'utf8')

function decryptBanshanrenImage(url: string, data: Buffer): Buffer | null {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  if (!/(^|\.)banshanren\.com$/.test(host) || data.length <= 32) return null
  try {
    const decipher = createDecipheriv('aes-128-cbc', BANSHANREN_IMAGE_KEY, data.subarray(0, 16))
    return Buffer.concat([decipher.update(data.subarray(16)), decipher.final()])
  } catch {
    return null
  }
}

/**
 * 注册 lzimg:// 处理器。headerFor 由主进程提供（Referer / UA / Cookie 规则），
 * 缓存未命中时按同一套头去源站取图，成功后落盘。
 */
export function setupImageCacheHandler(headerFor: (url: string) => Record<string, string>): void {
  const respond = async (target: string): Promise<Response> => {
    // 缓存目录可以在设置里更换，这里每次请求都重新取
    const dir = imageCacheDir()
    const file = join(dir, keyOf(target))
    try {
      const buf = await readFile(file)
      const mime = sniffImageMime(buf)
      // 缓存文件损坏 / 不是可识别图片：删掉后重新走网络，避免一直显示坏图
      if (mime) {
        touchCacheFile(file)
        return new Response(new Uint8Array(buf), {
          headers: { 'content-type': mime, 'cache-control': CACHE_CONTROL }
        })
      }
      await rm(file, { force: true }).catch(() => undefined)
    } catch {
      // 未缓存，走网络
    }
    try {
      const res = await fetchImage(target, headerFor)
      // 源站可能返回 4xx 自定义状态（如 472），统一折成 404/502，避免 Chromium 报未知状态
      if (!res.ok) return new Response(null, { status: res.status >= 500 ? 502 : 404 })
      let data: Buffer = Buffer.from(await res.arrayBuffer())
      if (!data.length) return new Response(null, { status: 502 })
      let sniffed = sniffImageMime(data)
      // 哔咔图床返回的是加密字节：先按站点同款算法还原，再判断是不是图片
      if (!sniffed) {
        const plain = decryptBikahubImage(data)
        if (plain) {
          const plainMime = sniffImageMime(plain)
          if (plainMime) {
            data = plain
            sniffed = plainMime
          }
        }
      }
      // 搬山人小说网的图片同样是加密字节（AES-CBC，IV 在开头）
      if (!sniffed) {
        const plain = decryptBanshanrenImage(target, data)
        if (plain) {
          const plainMime = sniffImageMime(plain)
          if (plainMime) {
            data = plain
            sniffed = plainMime
          }
        }
      }
      // 禁漫天堂的章节图纵向分段倒序存储，不还原的话阅读器里是错位图
      if (jmImageNeedsDescramble(target)) {
        const plain = await descrambleJmImage(target, data)
        if (plain) {
          data = plain
          sniffed = sniffImageMime(plain)
        }
      }
      const header = res.headers.get('content-type')?.split(';')[0]?.trim()
      const mime = sniffed ?? (header && header.startsWith('image/') ? header : null)
      // 拿到的不是图片（常见于防盗链返回的 HTML）：不落盘，避免以后一直显示坏图
      if (!mime) return new Response(null, { status: 404 })
      // 缓存写入失败（目录只读 / 磁盘满）不能影响本次图片返回，下次再试写缓存
      try {
        await mkdir(dir, { recursive: true })
        const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
        await writeFile(tmp, data)
        await rename(tmp, file).catch(async () => {
          await rm(tmp).catch(() => undefined)
        })
        touchCacheFile(file)
        if (cacheBytes != null) cacheBytes += data.length
        if (cacheBytes == null || cacheBytes > IMAGE_CACHE_MAX_BYTES) scheduleEviction()
      } catch {
        // 忽略落盘失败
      }
      return new Response(new Uint8Array(data), {
        headers: { 'content-type': mime, 'cache-control': CACHE_CONTROL }
      })
    } catch {
      return new Response(null, { status: 502 })
    }
  }

  protocol.handle(SCHEME, (request) => {
    let target = ''
    try {
      target = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''))
    } catch {
      // 非法地址按错误处理
    }
    if (!/^https?:\/\//i.test(target)) {
      return new Response(null, { status: 400 })
    }
    try {
      if (isLoopbackHost(new URL(target).hostname)) {
        return new Response(null, { status: 400 })
      }
    } catch {
      return new Response(null, { status: 400 })
    }
    return respond(target)
  })
}
