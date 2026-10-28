import { app, BrowserWindow, shell } from 'electron'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createDecipheriv } from 'node:crypto'
import type {
  DownloadAddInput,
  DownloadAddResult,
  DownloadItem,
  DownloadKind,
  DownloadListResponse,
  DownloadTask
} from '../src/shared/downloads'

/**
 * 下载管理：视频（mp4 直链 / m3u8 切片合并）与音乐直链。
 * 目录对齐手机端：系统下载目录/老郑分享/{视频,音乐}。
 * 下载完成记录落 userData/downloads.json；播放走内置本地媒体服务（支持 Range / CORS）。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

interface StoredItem extends Omit<DownloadItem, 'playUrl'> {
  /** 相对下载根目录的路径 */
  playPath: string
}

let items: StoredItem[] = []
let libraryLoaded = false
const tasks = new Map<string, DownloadTask>()
const controllers = new Map<string, AbortController>()
let notifyTimer: NodeJS.Timeout | null = null
let lastNotifyAt = 0
let mediaPort = 0

export function downloadsRoot(): string {
  return join(app.getPath('downloads'), '老郑分享')
}

function libraryPath(): string {
  return join(app.getPath('userData'), 'downloads.json')
}

function safeName(raw: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return (cleaned || `下载-${Date.now()}`).slice(0, 80)
}

function kindDir(kind: DownloadKind): string {
  return kind === 'video' ? '视频' : kind === 'music' ? '音乐' : '其他'
}

function hashUrl(url: string): string {
  let h = 0
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0
  return `${Math.abs(h)}`
}

async function loadLibrary(): Promise<void> {
  if (libraryLoaded) return
  libraryLoaded = true
  try {
    const raw = JSON.parse(await readFile(libraryPath(), 'utf8')) as unknown
    if (Array.isArray(raw)) {
      items = raw.filter((r): r is StoredItem => {
        if (!r || typeof r !== 'object') return false
        const o = r as Record<string, unknown>
        return typeof o.id === 'string' && typeof o.playPath === 'string'
      })
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[downloads] 读取下载记录失败', err)
    }
  }
}

async function saveLibrary(): Promise<void> {
  const path = libraryPath()
  await mkdir(app.getPath('userData'), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(items, null, 2), 'utf8')
  await rename(tmp, path)
}

function notify(): void {
  const fire = () => {
    lastNotifyAt = Date.now()
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('downloads:changed')
    }
  }
  const wait = 400 - (Date.now() - lastNotifyAt)
  if (wait <= 0) {
    fire()
    return
  }
  if (notifyTimer) return
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    fire()
  }, wait)
}

function toPublicItem(item: StoredItem): DownloadItem {
  return {
    ...item,
    playUrl: mediaPort ? `http://127.0.0.1:${mediaPort}/media/${encodeURI(item.playPath)}` : ''
  }
}

export async function listDownloads(): Promise<DownloadListResponse> {
  await loadLibrary()
  return {
    items: [...items].sort((a, b) => b.createdAt - a.createdAt).map(toPublicItem),
    tasks: [...tasks.values()].sort((a, b) => a.title.localeCompare(b.title)),
    dir: downloadsRoot()
  }
}

export async function addDownload(input: DownloadAddInput): Promise<DownloadAddResult> {
  await loadLibrary()
  const url = input.url.trim()
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: '下载地址无效' }
  if (items.some((i) => i.sourceUrl === url)) return { ok: false, error: '这个地址已经下载过了' }
  if ([...tasks.values()].some((t) => t.url === url)) return { ok: false, error: '正在下载中' }

  const isHls = /\.m3u8(\?|$)/i.test(url)
  const task: DownloadTask = {
    id: hashUrl(url),
    title: input.title.trim() || '未命名下载',
    kind: input.kind,
    url,
    sourceName: input.sourceName ?? '',
    coverUrl: input.coverUrl ?? '',
    state: 'running',
    progress: isHls ? 0 : -1,
    bytes: 0,
    totalBytes: 0
  }
  const controller = new AbortController()
  controllers.set(task.id, controller)
  tasks.set(task.id, task)

  void (async () => {
    try {
      const item = isHls
        ? await downloadHls(input, task, controller.signal)
        : await downloadDirect(input, task, controller.signal)
      items.push(item)
      await saveLibrary()
      tasks.delete(task.id)
      controllers.delete(task.id)
    } catch (err) {
      controllers.delete(task.id)
      if (controller.signal.aborted) {
        tasks.delete(task.id)
      } else {
        task.state = 'failed'
        task.error = err instanceof Error ? err.message : '下载失败'
      }
    }
    notify()
  })()

  notify()
  return { ok: true }
}

export async function removeDownload(id: string, deleteFile: boolean): Promise<void> {
  await loadLibrary()
  const item = items.find((i) => i.id === id)
  if (!item) return
  items = items.filter((i) => i.id !== id)
  await saveLibrary()
  if (deleteFile) {
    const abs = resolve(downloadsRoot(), item.playPath)
    const root = resolve(downloadsRoot())
    if (abs.startsWith(root + sep)) {
      // HLS 下载是目录（index.m3u8 的父目录），整目录删除
      const target = item.hls ? resolve(abs, '..') : abs
      await rm(target, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

export function cancelTask(id: string): void {
  controllers.get(id)?.abort()
  controllers.delete(id)
  tasks.delete(id)
}

export async function openDownloadsDir(): Promise<void> {
  await mkdir(downloadsRoot(), { recursive: true })
  const err = await shell.openPath(downloadsRoot())
  if (err) throw new Error(err)
}

/* ---------------- 直链下载 ---------------- */

function guessExt(url: string, kind: DownloadKind): string {
  const path = (() => {
    try {
      return new URL(url).pathname
    } catch {
      return url
    }
  })()
  const ext = extname(path).toLowerCase()
  if (/^\.(mp4|mkv|webm|mov|m4v|flv|ts|mp3|m4a|flac|wav|aac|ogg|jpg|jpeg|png|webp|zip|epub|pdf)$/.test(ext)) {
    return ext
  }
  return kind === 'music' ? '.mp3' : kind === 'video' ? '.mp4' : ''
}

async function uniqueTarget(dir: string, base: string, ext: string): Promise<string> {
  let name = `${base}${ext}`
  let n = 2
  for (;;) {
    try {
      await stat(join(dir, name))
      name = `${base} (${n++})${ext}`
    } catch {
      return join(dir, name)
    }
  }
}

async function downloadDirect(
  input: DownloadAddInput,
  task: DownloadTask,
  signal: AbortSignal
): Promise<StoredItem> {
  const dirName = kindDir(input.kind)
  const dir = join(downloadsRoot(), dirName)
  await mkdir(dir, { recursive: true })
  const target = await uniqueTarget(dir, safeName(input.title), guessExt(input.url, input.kind))
  const tmp = `${target}.part`

  const res = await fetch(input.url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    redirect: 'follow',
    signal
  })
  if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  task.totalBytes = Number.isFinite(total) ? total : 0

  const meter = new Transform({
    transform(chunk, _enc, cb) {
      task.bytes += chunk.length
      if (task.totalBytes > 0) task.progress = task.bytes / task.totalBytes
      notify()
      cb(null, chunk)
    }
  })
  await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(tmp))
  await rename(tmp, target)

  const info = await stat(target)
  const size = info.size
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: input.title.trim() || '未命名下载',
    kind: input.kind,
    sourceUrl: input.url,
    playPath: join(dirName, target.slice(dir.length + 1)).replace(/\\/g, '/'),
    displayPath: join(dirName, target.slice(dir.length + 1)).replace(/\\/g, '/'),
    sizeBytes: size,
    createdAt: Date.now(),
    coverUrl: input.coverUrl ?? '',
    sourceName: input.sourceName ?? '',
    hls: false
  }
}

/* ---------------- HLS 下载 ---------------- */

interface HlsKey {
  uri: string
  iv: string | null
}

interface HlsSegment {
  url: string
  duration: number
  key: HlsKey | null
  seq: number
}

interface MediaPlaylist {
  segments: HlsSegment[]
  mapUri: string | null
  targetDuration: number
}

function attr(line: string, name: string): string | null {
  const m = line.match(new RegExp(`${name}="([^"]*)"`, 'i'))
  return m ? m[1] : null
}

function resolveUrl(base: string, rel: string): string {
  try {
    return new URL(rel, base).toString()
  } catch {
    return rel
  }
}

function parseMaster(text: string, baseUrl: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  let bestBandwidth = -1
  let bestUrl: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue
    const bw = Number(attr(line, 'BANDWIDTH') ?? 0)
    const next = lines.slice(i + 1).find((l) => l && !l.startsWith('#'))
    if (!next) continue
    if (bw >= bestBandwidth) {
      bestBandwidth = bw
      bestUrl = resolveUrl(baseUrl, next)
    }
  }
  return bestUrl
}

function parseMediaPlaylist(text: string, baseUrl: string): MediaPlaylist {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const segments: HlsSegment[] = []
  let key: HlsKey | null = null
  let duration = 0
  let mediaSeq = 0
  let mapUri: string | null = null
  let targetDuration = 0

  for (const line of lines) {
    if (!line) continue
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSeq = Number(line.split(':')[1]) || 0
      continue
    }
    if (line.startsWith('#EXT-X-KEY:')) {
      const method = (attr(line, 'METHOD') ?? 'NONE').toUpperCase()
      if (method === 'NONE') {
        key = null
      } else {
        const uri = attr(line, 'URI')
        if (uri) key = { uri: resolveUrl(baseUrl, uri), iv: attr(line, 'IV') }
      }
      continue
    }
    if (line.startsWith('#EXT-X-MAP:')) {
      const uri = attr(line, 'URI')
      if (uri) mapUri = resolveUrl(baseUrl, uri)
      continue
    }
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = Number(line.split(':')[1]) || 0
      continue
    }
    if (line.startsWith('#EXTINF:')) {
      duration = Number.parseFloat(line.slice(8)) || 0
      continue
    }
    if (line.startsWith('#')) continue
    segments.push({
      url: resolveUrl(baseUrl, line),
      duration,
      key,
      seq: mediaSeq + segments.length
    })
    duration = 0
  }
  return { segments, mapUri, targetDuration }
}

async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function fetchBuffer(url: string, signal: AbortSignal): Promise<Buffer> {
  let last: unknown
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      last = err
      if (signal.aborted) throw err
      await new Promise((r) => setTimeout(r, 500 * (i + 1)))
    }
  }
  throw last instanceof Error ? last : new Error('下载失败')
}

async function downloadHls(
  input: DownloadAddInput,
  task: DownloadTask,
  signal: AbortSignal
): Promise<StoredItem> {
  let playlistUrl = input.url
  let text = await fetchText(playlistUrl, signal)
  if (text.includes('#EXT-X-STREAM-INF')) {
    const variant = parseMaster(text, playlistUrl)
    if (!variant) throw new Error('无法解析清晰度列表')
    playlistUrl = variant
    text = await fetchText(playlistUrl, signal)
  }
  const playlist = parseMediaPlaylist(text, playlistUrl)
  if (!playlist.segments.length) throw new Error('播放列表里没有切片')

  const videoDir = join(downloadsRoot(), '视频')
  const base = safeName(input.title)
  await mkdir(videoDir, { recursive: true })
  let folder = join(videoDir, base)
  let n = 2
  for (;;) {
    try {
      await stat(folder)
      folder = join(videoDir, `${base} (${n++})`)
    } catch {
      break
    }
  }
  await mkdir(folder, { recursive: true })

  const segmentExt = playlist.mapUri ? '.m4s' : '.ts'
  const keyCache = new Map<string, Buffer>()
  let done = 0
  task.progress = 0
  task.totalBytes = 0

  const getKey = async (uri: string): Promise<Buffer> => {
    const cached = keyCache.get(uri)
    if (cached) return cached
    const buf = await fetchBuffer(uri, signal)
    keyCache.set(uri, buf)
    return buf
  }

  if (playlist.mapUri) {
    const init = await fetchBuffer(playlist.mapUri, signal)
    await writeFile(join(folder, 'init.mp4'), init)
    task.bytes += init.length
  }

  const concurrency = 5
  let cursor = 0
  const worker = async () => {
    for (;;) {
      const index = cursor++
      const seg = playlist.segments[index]
      if (!seg) return
      let data = await fetchBuffer(seg.url, signal)
      if (seg.key && seg.key.uri) {
        const key = await getKey(seg.key.uri)
        const iv = seg.key.iv
          ? Buffer.from(seg.key.iv.replace(/^0x/i, ''), 'hex')
          : (() => {
              const b = Buffer.alloc(16)
              b.writeBigUInt64BE(BigInt(seg.seq), 8)
              return b
            })()
        const decipher = createDecipheriv('aes-128-cbc', key, iv)
        data = Buffer.concat([decipher.update(data), decipher.final()])
      }
      const name = `seg-${String(index + 1).padStart(5, '0')}${segmentExt}`
      await writeFile(join(folder, name), data)
      task.bytes += data.length
      done += 1
      task.progress = done / playlist.segments.length
      notify()
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, playlist.segments.length) }, worker)
  )

  const maxDuration = Math.max(
    playlist.targetDuration,
    ...playlist.segments.map((s) => Math.ceil(s.duration))
  )
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${maxDuration}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD'
  ]
  if (playlist.mapUri) lines.push('#EXT-X-MAP:URI="init.mp4"')
  playlist.segments.forEach((seg, index) => {
    lines.push(`#EXTINF:${seg.duration > 0 ? seg.duration.toFixed(3) : '10'},`)
    lines.push(`seg-${String(index + 1).padStart(5, '0')}${segmentExt}`)
  })
  lines.push('#EXT-X-ENDLIST')
  const indexPath = join(folder, 'index.m3u8')
  await writeFile(indexPath, lines.join('\n'), 'utf8')

  const rel = `视频/${folder.slice(videoDir.length + 1)}/index.m3u8`
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: input.title.trim() || '未命名视频',
    kind: input.kind,
    sourceUrl: input.url,
    playPath: rel,
    displayPath: rel,
    sizeBytes: task.bytes,
    createdAt: Date.now(),
    coverUrl: input.coverUrl ?? '',
    sourceName: input.sourceName ?? '',
    hls: true
  }
}

/* ---------------- 本地媒体服务 ---------------- */

const MIME: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

export async function startMediaServer(): Promise<void> {
  if (mediaPort) return
  const root = resolve(downloadsRoot())
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (!url.pathname.startsWith('/media/')) {
        res.writeHead(404).end()
        return
      }
      const rel = decodeURIComponent(url.pathname.slice('/media/'.length))
      const abs = resolve(root, rel)
      if (!abs.startsWith(root + sep)) {
        res.writeHead(403).end()
        return
      }
      const info = await stat(abs)
      if (!info.isFile()) {
        res.writeHead(404).end()
        return
      }
      const headers: Record<string, string | number> = {
        'Content-Type': MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
      }
      const range = req.headers.range
      if (range) {
        const m = range.match(/bytes=(\d*)-(\d*)/)
        const start = m && m[1] ? Number(m[1]) : 0
        const end = m && m[2] ? Math.min(Number(m[2]), info.size - 1) : info.size - 1
        if (start > end || start >= info.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end()
          return
        }
        headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`
        headers['Content-Length'] = end - start + 1
        res.writeHead(206, headers)
        createReadStream(abs, { start, end }).pipe(res)
        return
      }
      headers['Content-Length'] = info.size
      res.writeHead(200, headers)
      createReadStream(abs).pipe(res)
    } catch {
      res.writeHead(404).end()
    }
  })

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      mediaPort = typeof addr === 'object' && addr ? addr.port : 0
      resolveListen()
    })
  })
}
