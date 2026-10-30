import { app, protocol, type Session } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 图片磁盘缓存：所有 http(s) 图片请求在请求层重定向到 lzimg://，
 * 主进程按 URL 哈希存到 userData/image-cache，命中则直接返回本地字节。
 * 这样重开应用时封面 / 剧照 / 头像都能立刻显示，不再等网络。
 */

const SCHEME = 'lzimg'
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

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
  return join(app.getPath('userData'), 'image-cache')
}

function keyOf(url: string): string {
  return createHash('sha1').update(url).digest('hex')
}

/** 按文件头判断图片类型（豆瓣图床多数地址没有扩展名）；不是已知图片格式时返回 null */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png'
  if (buf.length >= 6 && buf.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif'
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (buf.length >= 12 && buf.subarray(4, 12).toString('ascii') === 'ftypavif') return 'image/avif'
  if (buf.length >= 12 && buf.subarray(4, 12).toString('ascii') === 'ftypavis') return 'image/avif'
  const head = buf.subarray(0, 200).toString('utf8').trimStart().toLowerCase()
  if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'image/svg+xml'
  return null
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
 * 注册 lzimg:// 处理器。headerFor 由主进程提供（Referer / UA / Cookie 规则），
 * 缓存未命中时按同一套头去源站取图，成功后落盘。
 */
export function setupImageCacheHandler(headerFor: (url: string) => Record<string, string>): void {
  const dir = imageCacheDir()

  const respond = async (target: string): Promise<Response> => {
    const file = join(dir, keyOf(target))
    try {
      const buf = await readFile(file)
      return new Response(new Uint8Array(buf), {
        headers: { 'content-type': sniffImageMime(buf) ?? 'image/jpeg', 'cache-control': CACHE_CONTROL }
      })
    } catch {
      // 未缓存，走网络
    }
    try {
      const res = await fetch(target, {
        headers: headerFor(target),
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000)
      })
      // 源站可能返回 4xx 自定义状态（如 472），统一折成 404/502，避免 Chromium 报未知状态
      if (!res.ok) return new Response(null, { status: res.status >= 500 ? 502 : 404 })
      const buf = Buffer.from(await res.arrayBuffer())
      if (!buf.length) return new Response(null, { status: 502 })
      const sniffed = sniffImageMime(buf)
      const header = res.headers.get('content-type')?.split(';')[0]?.trim()
      const mime = sniffed ?? (header && header.startsWith('image/') ? header : null)
      // 拿到的不是图片（常见于防盗链返回的 HTML）：不落盘，避免以后一直显示坏图
      if (!mime) return new Response(null, { status: 404 })
      await mkdir(dir, { recursive: true })
      const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
      await writeFile(tmp, buf)
      await rename(tmp, file).catch(async () => {
        await rm(tmp).catch(() => undefined)
      })
      return new Response(new Uint8Array(buf), {
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
    return respond(target)
  })
}
