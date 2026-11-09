import { app } from 'electron'
import { createHash, createCipheriv, createDecipheriv, publicEncrypt, privateDecrypt, constants as cryptoConstants, randomBytes } from 'crypto'
import { deflateSync, inflateSync } from 'zlib'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import vm from 'vm'
import type { MusicQuality } from '../src/shared/music'

/**
 * 洛雪音乐（LX Music）自定义音源运行时。
 *
 * 自定义音源脚本本身不提供搜索，只负责把各平台的歌曲 ID 解析成播放地址
 * （musicUrl）。搜索由 electron/musicPlatforms.ts 的酷我 / 酷狗 / QQ / 网易云
 * 公开接口完成，本文件只做脚本沙箱与 musicUrl 调用。
 *
 * 脚本从用户填写的地址下载，缓存在 userData/lx-sources 下（6 小时），
 * 在 vm 沙箱里执行，只暴露 lx.request / lx.utils 等洛雪公开 API。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const SCRIPT_TTL = 6 * 60 * 60 * 1000
const READY_TIMEOUT = 8_000
const CALL_TIMEOUT = 25_000

export interface LxPlatformInfo {
  name?: string
  type?: string
  actions?: string[]
  qualitys?: string[]
}

export interface LxScriptMeta {
  status?: boolean
  sources: Record<string, LxPlatformInfo>
}

interface LxRuntime {
  meta: LxScriptMeta
  call: (platform: string, musicInfo: Record<string, unknown>, type: string) => Promise<string>
}

const runtimes = new Map<string, Promise<LxRuntime>>()
const platformCache = new Map<string, Promise<LxScriptMeta>>()

export function isLxScriptUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const url = new URL(value.trim())
    return /\.js$/i.test(url.pathname)
  } catch {
    return /\.js(?:[?#]|$)/i.test(value.trim())
  }
}

function scriptCachePath(url: string): string {
  const hash = createHash('sha1').update(url).digest('hex')
  return join(app.getPath('userData'), 'lx-sources', `${hash}.js`)
}

async function loadScriptText(url: string): Promise<string> {
  const file = scriptCachePath(url)
  let cached = ''
  try {
    cached = await readFile(file, 'utf8')
  } catch {
    cached = ''
  }
  try {
    let statOk = false
    try {
      const info = await stat(file)
      statOk = Date.now() - info.mtimeMs < SCRIPT_TTL
    } catch {
      statOk = false
    }
    if (cached && statOk) return cached

    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/javascript,application/javascript,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (text.length < 500) throw new Error('返回内容不是有效的洛雪音源脚本')
    await mkdir(join(app.getPath('userData'), 'lx-sources'), { recursive: true })
    await writeFile(file, text, 'utf8')
    return text
  } catch (err) {
    if (cached) return cached
    throw new Error(`音源脚本下载失败：${err instanceof Error ? err.message : '网络错误'}`)
  }
}

function parseScriptInfo(text: string): { name: string; version: string } {
  const name = /@name\s+([^\r\n*]+)/.exec(text)?.[1]?.trim() ?? '洛雪音源'
  const version = /@version\s+([^\r\n*]+)/.exec(text)?.[1]?.trim() ?? '1.0.0'
  return { name, version }
}

function bufferFrom(value: unknown, encoding: BufferEncoding = 'utf8'): Buffer {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  return Buffer.from(String(value ?? ''), encoding)
}

function normalizeAesKey(key: Buffer, mode: string): Buffer {
  const bits = Number(/aes-(\d+)-/i.exec(mode)?.[1] ?? 128)
  const size = Math.max(16, Math.min(32, Math.round(bits / 8)))
  if (key.length === size) return key
  if (key.length > size) return key.subarray(0, size)
  const out = Buffer.alloc(size)
  key.copy(out)
  return out
}

function aesEncrypt(input: unknown, mode = 'aes-128-cbc', key: unknown, iv?: unknown): Buffer {
  const algorithm = String(mode || 'aes-128-cbc').toLowerCase()
  const keyBuf = normalizeAesKey(bufferFrom(key), algorithm)
  const ivBuf = algorithm.includes('ecb') ? null : bufferFrom(iv ?? keyBuf).subarray(0, 16)
  const cipher = createCipheriv(algorithm, keyBuf, ivBuf)
  return Buffer.concat([cipher.update(bufferFrom(input)), cipher.final()])
}

function aesDecrypt(input: unknown, mode = 'aes-128-cbc', key: unknown, iv?: unknown): Buffer {
  const algorithm = String(mode || 'aes-128-cbc').toLowerCase()
  const keyBuf = normalizeAesKey(bufferFrom(key), algorithm)
  const ivBuf = algorithm.includes('ecb') ? null : bufferFrom(iv ?? keyBuf).subarray(0, 16)
  const decipher = createDecipheriv(algorithm, keyBuf, ivBuf)
  return Buffer.concat([decipher.update(bufferFrom(input)), decipher.final()])
}

function makeUtils() {
  return {
    crypto: {
      md5: (value: unknown) => createHash('md5').update(bufferFrom(value)).digest('hex'),
      sha1: (value: unknown) => createHash('sha1').update(bufferFrom(value)).digest('hex'),
      randomBytes: (size: number) => randomBytes(Math.max(1, Math.min(1024, Number(size) || 16))),
      aesEncrypt,
      aesDecrypt,
      rsaEncrypt: (input: unknown, key: unknown) =>
        publicEncrypt(
          { key: String(key ?? ''), padding: cryptoConstants.RSA_PKCS1_PADDING },
          bufferFrom(input)
        ),
      rsaDecrypt: (input: unknown, key: unknown) =>
        privateDecrypt(
          { key: String(key ?? ''), padding: cryptoConstants.RSA_PKCS1_PADDING },
          bufferFrom(input)
        )
    },
    buffer: {
      from: (value: unknown, encoding?: BufferEncoding) => bufferFrom(value, encoding),
      concat: (list: unknown[]) => Buffer.concat((list ?? []).map((item) => bufferFrom(item))),
      isBuffer: (value: unknown) => Buffer.isBuffer(value),
      buf2str: (value: unknown, encoding: BufferEncoding = 'utf8') => bufferFrom(value).toString(encoding),
      str2buf: (value: unknown, encoding: BufferEncoding = 'utf8') => bufferFrom(value, encoding)
    },
    str2b64: (value: unknown) => bufferFrom(value).toString('base64'),
    b64DecodeUnicode: (value: unknown) => bufferFrom(value, 'base64').toString('utf8'),
    utf8ToB64: (value: unknown) => bufferFrom(value).toString('base64'),
    b64ToUtf8: (value: unknown) => bufferFrom(value, 'base64').toString('utf8'),
    zlib: {
      inflate: (value: unknown) => inflateSync(bufferFrom(value)),
      deflate: (value: unknown) => deflateSync(bufferFrom(value))
    },
    sizeFormate: (bytes: number) => {
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let value = Number(bytes) || 0
      let index = 0
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024
        index += 1
      }
      return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
    }
  }
}

interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  form?: Record<string, string>
  formData?: Record<string, string>
  binary?: boolean
  timeout?: number
  follow_max?: number
  retry?: number
}

function makeRequest(cookieJar: Map<string, string>) {
  return (rawUrl: string, options?: RequestOptions | ((...args: unknown[]) => void), callback?: (...args: unknown[]) => void) => {
    let opts: RequestOptions = {}
    if (typeof options === 'function') {
      callback = options as (...args: unknown[]) => void
    } else {
      opts = options ?? {}
    }
    const url = String(rawUrl ?? '')
    const headers: Record<string, string> = { ...(opts.headers ?? {}) }
    if (cookieJar.size) {
      headers.Cookie = [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
    }
    let body: BodyInit | undefined
    if (opts.form) {
      body = new URLSearchParams(opts.form).toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    } else if (opts.formData) {
      body = new URLSearchParams(opts.formData).toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    } else if (opts.body != null) {
      body = Buffer.isBuffer(opts.body) || typeof opts.body === 'string' ? (opts.body as BodyInit) : String(opts.body)
    }
    const promise = fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body,
      redirect: 'follow',
      signal: AbortSignal.timeout(Math.max(1_000, Number(opts.timeout) || 20_000))
    })
      .then(async (res) => {
        const rawCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
        for (const item of rawCookies) {
          const pair = item.split(';')[0] ?? ''
          const index = pair.indexOf('=')
          if (index > 0) cookieJar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
        }
        const buffer = Buffer.from(await res.arrayBuffer())
        const text = opts.binary ? buffer : buffer.toString('utf8')
        const response = {
          statusCode: res.status,
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          body: text
        }
        callback?.(null, response, text)
        return response
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error('网络请求失败')
        callback?.(error)
        return { statusCode: 0, headers: {}, body: '' }
      })
    return promise
  }
}

async function createRuntime(scriptUrl: string): Promise<LxRuntime> {
  const code = await loadScriptText(scriptUrl)
  const info = parseScriptInfo(code)
  const cookieJar = new Map<string, string>()
  type RequestHandler = (payload: {
    source: string
    action: string
    info: Record<string, unknown>
  }) => Promise<unknown>
  let meta: LxScriptMeta | null = null
  let handler: RequestHandler | null = null
  let readyResolve: (() => void) | null = null
  let readyReject: ((err: Error) => void) | null = null
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const maybeReady = (): void => {
    if (meta && handler) readyResolve?.()
  }

  const lx = {
    EVENT_NAMES: {
      request: 'request',
      inited: 'inited',
      updateAlert: 'updateAlert',
      log: 'log',
      downloadInfo: 'downloadInfo'
    },
    env: 'desktop',
    version: '2.0.0',
    currentScriptInfo: { name: info.name, version: info.version, description: '', author: '' },
    request: makeRequest(cookieJar),
    on: (name: string, fn: (...args: never[]) => unknown) => {
      if (name === 'request' && typeof fn === 'function') {
        handler = fn as unknown as RequestHandler
        maybeReady()
      }
    },
    send: (name: string, data?: unknown) => {
      if (name === 'inited' && data && typeof data === 'object') {
        const payload = data as { sources?: Record<string, LxPlatformInfo> }
        meta = { sources: payload.sources && typeof payload.sources === 'object' ? payload.sources : {} }
        maybeReady()
      }
    },
    utils: makeUtils()
  }

  const sandbox: Record<string, unknown> = {
    lx,
    console: {
      log: (...args: unknown[]) => console.log('[lx]', ...args),
      warn: (...args: unknown[]) => console.warn('[lx]', ...args),
      error: (...args: unknown[]) => console.error('[lx]', ...args)
    },
    navigator: { userAgent: 'lx-music-desktop/2.0.0' },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    atob: (value: string) => Buffer.from(String(value), 'base64').toString('binary'),
    btoa: (value: string) => Buffer.from(String(value), 'binary').toString('base64')
  }
  sandbox.globalThis = sandbox
  sandbox.window = sandbox
  vm.createContext(sandbox)
  try {
    vm.runInContext(code, sandbox, { filename: scriptUrl, timeout: 20_000 })
  } catch (err) {
    throw new Error(`音源脚本执行失败：${err instanceof Error ? err.message : '未知错误'}`)
  }

  await Promise.race([
    ready,
    new Promise<void>((_resolve, reject) =>
      setTimeout(() => reject(new Error('音源脚本初始化超时（没有返回 sources）')), READY_TIMEOUT)
    )
  ]).catch((err) => {
    readyReject?.(err instanceof Error ? err : new Error('初始化失败'))
    throw err
  })

  if (!meta || !handler) throw new Error('音源脚本没有提供可用的播放解析接口')
  const resolvedMeta = meta
  const resolvedHandler = handler as RequestHandler

  return {
    meta: resolvedMeta,
    call: async (platform, musicInfo, type) => {
      const result = await Promise.race([
        resolvedHandler({
          source: platform,
          action: 'musicUrl',
          info: { type, musicInfo }
        }),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('解析超时')), CALL_TIMEOUT)
        )
      ])
      if (typeof result === 'string' && /^https?:\/\//i.test(result)) return result
      if (result && typeof result === 'object') {
        const url = (result as { url?: unknown }).url
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url
      }
      throw new Error('音源没有返回可播放地址')
    }
  }
}

function getRuntime(scriptUrl: string): Promise<LxRuntime> {
  const url = scriptUrl.trim()
  const cached = runtimes.get(url)
  if (cached) return cached
  const task = createRuntime(url)
  runtimes.set(url, task)
  task.catch(() => runtimes.delete(url))
  return task
}

export async function lxSourceMeta(scriptUrl: string): Promise<LxScriptMeta> {
  const url = scriptUrl.trim()
  const cached = platformCache.get(url)
  if (cached) return cached
  const task = getRuntime(url).then((runtime) => runtime.meta)
  platformCache.set(url, task)
  task.catch(() => platformCache.delete(url))
  return task
}

export function lxQualityFromType(type: string): MusicQuality | null {
  const key = String(type ?? '').trim().toLowerCase()
  if (!key) return null
  if (key === '128k') return { format: 'mp3', bitrate: '128' }
  if (key === '320k') return { format: 'mp3', bitrate: '320' }
  if (key === 'flac') return { format: 'flac', bitrate: '1000' }
  if (key === 'flac24bit') return { format: 'flac', bitrate: '2000' }
  if (key === 'hires') return { format: 'flac', bitrate: '2400' }
  if (key === 'master') return { format: 'flac', bitrate: '3000' }
  if (key === 'atmos' || key === 'atmos_plus') return { format: 'flac', bitrate: '4000' }
  return null
}

export function lxTypeFromQuality(quality?: MusicQuality): string {
  if (!quality?.format) return '320k'
  const format = quality.format.toLowerCase()
  const bitrate = Number(quality.bitrate) || 0
  if (format === 'mp3') return bitrate >= 320 ? '320k' : '128k'
  if (format === 'flac') {
    if (bitrate >= 4000) return 'atmos'
    if (bitrate >= 3000) return 'master'
    if (bitrate >= 2400) return 'hires'
    if (bitrate >= 2000) return 'flac24bit'
    return 'flac'
  }
  return '320k'
}

function qualityTypesFor(meta: LxScriptMeta, platform: string): string[] {
  const info = meta.sources[platform]
  const list = Array.isArray(info?.qualitys) ? info.qualitys : []
  return list.map((item) => String(item).trim()).filter(Boolean)
}

export async function resolveLxMusicUrl(
  scriptUrl: string,
  platform: string,
  musicInfo: Record<string, unknown>,
  quality?: MusicQuality
): Promise<string> {
  const runtime = await getRuntime(scriptUrl)
  if (!runtime.meta.sources[platform]) {
    throw new Error(`这个音源不支持 ${platform} 平台`)
  }
  const supported = qualityTypesFor(runtime.meta, platform)
  const preferred = lxTypeFromQuality(quality)
  const qualityRank: Record<string, number> = {
    '128k': 1,
    '320k': 2,
    flac: 3,
    flac24bit: 4,
    hires: 5,
    master: 6,
    atmos: 7,
    atmos_plus: 7
  }
  // 用户选了低音质时只往下退，不要偷偷换成更大的文件
  const limit = quality ? qualityRank[preferred] ?? 2 : 2
  const fallback = ['320k', '128k', 'flac']
  const order = quality
    ? [preferred, ...supported.filter((item) => (qualityRank[item] ?? 99) <= limit)]
    : [...fallback, ...supported]
  const steps = supported.length
    ? order.filter((item, index) => !!item && order.indexOf(item) === index && supported.includes(item))
    : order.filter((item, index) => !!item && order.indexOf(item) === index)
  const finalSteps = steps.length ? steps : [preferred]
  let lastError = '解析失败'
  for (const type of finalSteps) {
    try {
      return await runtime.call(platform, musicInfo, type)
    } catch (err) {
      lastError = err instanceof Error ? err.message : '解析失败'
    }
  }
  throw new Error(lastError)
}
