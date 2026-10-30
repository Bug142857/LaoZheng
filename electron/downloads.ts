import { app, BrowserWindow, shell } from 'electron'
import { existsSync, createReadStream, createWriteStream } from 'node:fs'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createDecipheriv } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import AdmZip from 'adm-zip'
import type {
  ComicBatchDownloadInput,
  ComicMetaInput,
  DownloadAddInput,
  DownloadAddResult,
  DownloadItem,
  DownloadKind,
  DownloadListResponse,
  DownloadRecord,
  DownloadTask
} from '../src/shared/downloads'
import { komiicImageAuth } from './komiic'
import { melonImageAuth, melonReferer } from './melon'
import { downloadRoot, setDownloadRoot } from './settings'

/**
 * 下载管理：视频（mp4 直链 / m3u8 切片合并）与音乐直链。
 * 所有类型统一放在设置里的下载总目录下：{视频,音乐,漫画,图书}。
 * 下载完成记录落 userData/downloads.json；播放走内置本地媒体服务（支持 Range / CORS）。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** P站 CDN 校验 Referer / 年龄 Cookie，吃瓜视频 CDN 校验镜像 Referer：下载与切片请求都要带上，否则 403 */
function downloadHeaders(url: string, referer?: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': UA, Accept: '*/*' }
  try {
    const parsed = new URL(url)
    const host = parsed.host.toLowerCase()
    if (/(^|\.)phncdn\.com$/.test(host)) {
      headers.Referer = 'https://www.pornhub.com/'
      headers.Origin = 'https://www.pornhub.com'
      headers.Cookie = 'accessAgeDisclaimerPH=1; age_verified=1; accessPH=1'
    } else {
      const melonAuth = melonImageAuth(parsed)
      if (melonAuth) {
        headers.Referer = melonAuth.referer
        headers['User-Agent'] = melonAuth.ua
      } else if (referer) {
        headers.Referer = referer
      }
    }
  } catch {
    // 非法 URL 用默认头
  }
  return headers
}

type StoredItem = DownloadRecord

let items: StoredItem[] = []
let libraryLoaded = false
const tasks = new Map<string, DownloadTask>()
const controllers = new Map<string, AbortController>()
/** 每个任务本次新写出的文件 / 目录：取消或失败时一并清理，不留半成品 */
const artifacts = new Map<string, { files: Set<string>; dirs: Set<string> }>()
let notifyTimer: NodeJS.Timeout | null = null
let lastNotifyAt = 0
let mediaPort = 0

function artifactsOf(taskId: string): { files: Set<string>; dirs: Set<string> } {
  let entry = artifacts.get(taskId)
  if (!entry) {
    entry = { files: new Set(), dirs: new Set() }
    artifacts.set(taskId, entry)
  }
  return entry
}

async function cleanupArtifacts(taskId: string): Promise<void> {
  const entry = artifacts.get(taskId)
  if (!entry) return
  artifacts.delete(taskId)
  for (const file of entry.files) {
    await rm(file, { force: true }).catch(() => undefined)
  }
  for (const dir of entry.dirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** 安装包内的 ffmpeg（依赖被 electron-builder 解包到 app.asar.unpacked），开发态用 node_modules 里的可执行文件 */
function ffmpegBinary(): string | null {
  const rel = join('node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe')
  // 不区分 isPackaged：开发态 / 安装包 / asar 解包路径都列出来，存在哪个用哪个
  const candidates = [
    join(process.resourcesPath, 'ffmpeg.exe'),
    join(process.resourcesPath, 'app.asar.unpacked', rel),
    join(app.getAppPath(), rel),
    join(app.getAppPath(), '..', rel),
    join(process.cwd(), rel),
    join(__dirname, '..', '..', rel)
  ]
  const found = candidates.find((p) => existsSync(p))
  if (!found) {
    console.error('[downloads] 找不到 ffmpeg，候选路径：', candidates)
  }
  return found ?? null
}

/**
 * HLS 下载完成后用 ffmpeg 无损合并成单个 mp4，并清掉切片；
 * ffmpeg 不可用或合并失败时保留原来的 m3u8 + 切片目录（仍可播放）。
 */
async function mergeHlsToMp4(folder: string): Promise<boolean> {
  const bin = ffmpegBinary()
  if (!bin) {
    console.error('[downloads] 找不到随包 ffmpeg，HLS 无法合并成 mp4')
    return false
  }
  const playlist = join(folder, 'index.m3u8')
  const output = join(folder, 'video.mp4')
  const baseArgs = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-allowed_extensions',
    'ALL',
    '-i',
    playlist,
    '-c',
    'copy'
  ]
  // fMP4 切片（#EXT-X-MAP + init.mp4）音频已经是 MP4 封装，不能套 aac_adtstoasc；
  // TS 切片才需要先转 ADTS→ASC，失败再退普通 copy，最后再试一次音频转码。
  const hasMap = existsSync(join(folder, 'init.mp4'))
  const attempts = hasMap
    ? [[...baseArgs, '-movflags', '+faststart', output]]
    : [
        [...baseArgs, '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', output],
        [...baseArgs, '-movflags', '+faststart', output],
        [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-allowed_extensions',
          'ALL',
          '-i',
          playlist,
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-movflags',
          '+faststart',
          output
        ]
      ]
  let lastError: unknown = null
  for (const args of attempts) {
    try {
      await promisify(execFile)(bin, args, {
        // 关键：ffmpeg 解析本地 m3u8 里的相对切片路径时以工作目录为基准，
        // 不设 cwd 会去应用根目录找 seg-00001.ts，永远合并失败。
        cwd: folder,
        timeout: 30 * 60 * 1000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      })
      const info = await stat(output)
      if (info.size) {
        // 合并成功：切片与本地播放列表都清理掉，只留单个 mp4
        const entries = await readdirSafe(folder)
        for (const entry of entries) {
          if (entry.name === 'video.mp4') continue
          await rm(join(folder, entry.name), { recursive: true, force: true }).catch(() => undefined)
        }
        return true
      }
    } catch (err) {
      lastError = err
      await rm(output, { force: true }).catch(() => undefined)
    }
  }
  console.error('[downloads] ffmpeg 合并失败：', folder, lastError)
  await rm(output, { force: true }).catch(() => undefined)
  return false
}

/**
 * 旧版本没识别无引号的 METHOD=AES-128，切片留着密文：按远端播放列表里的 key
 * 就地解密，再交给 mergeHlsToMp4 合并；播放列表 / key 失效时保持原样。
 */
function looksLikePlainSegment(buf: Buffer): boolean {
  if (buf.length > 376 && buf[0] === 0x47 && buf[188] === 0x47 && buf[376] === 0x47) return true
  if (buf.length >= 8) {
    const type = buf.subarray(4, 8).toString('ascii')
    if (['moof', 'styp', 'sidx', 'mdat', 'free', 'emsg'].includes(type)) return true
  }
  return false
}

async function decryptLegacySegments(
  folder: string,
  sourceUrl: string,
  referer?: string
): Promise<void> {
  if (!/^https?:\/\//i.test(sourceUrl)) return
  const names = (await readdirSafe(folder))
    .filter((entry) => entry.isFile() && /^seg-\d+\.(ts|m4s)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  if (!names.length) return
  const first = await readFile(join(folder, names[0])).catch(() => null)
  if (!first || looksLikePlainSegment(first)) return

  const signal = AbortSignal.timeout(30_000)
  try {
    let playlistUrl = sourceUrl
    let text = await fetchText(playlistUrl, signal, referer)
    if (text.includes('#EXT-X-STREAM-INF')) {
      const variant = parseMaster(text, playlistUrl)
      if (!variant) return
      playlistUrl = variant
      text = await fetchText(playlistUrl, signal, referer)
    }
    const playlist = parseMediaPlaylist(text, playlistUrl)
    if (playlist.segments.length !== names.length) return
    const keyCache = new Map<string, Buffer>()
    for (let i = 0; i < names.length; i++) {
      const segment = playlist.segments[i]
      if (!segment.key?.uri) continue
      const file = join(folder, names[i])
      const data = await readFile(file).catch(() => null)
      if (!data || looksLikePlainSegment(data)) continue
      let key = keyCache.get(segment.key.uri)
      if (!key) {
        key = await fetchBuffer(segment.key.uri, signal, referer)
        keyCache.set(segment.key.uri, key)
      }
      try {
        const iv = segment.key.iv
          ? Buffer.from(segment.key.iv.replace(/^0x/i, ''), 'hex')
          : (() => {
              const b = Buffer.alloc(16)
              b.writeBigUInt64BE(BigInt(segment.seq), 8)
              return b
            })()
        const decipher = createDecipheriv('aes-128-cbc', key, iv)
        const out = Buffer.concat([decipher.update(data), decipher.final()])
        if (looksLikePlainSegment(out)) await writeFile(file, out)
      } catch {
        // 单片解密失败时跳过，保留原文件
      }
    }
  } catch {
    // 播放列表 / key 已失效：保留原目录，等待用户重新下载
  }
}

export function downloadsRoot(): string {
  return downloadRoot()
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
  if (kind === 'video') return '视频'
  if (kind === 'music') return '音乐'
  if (kind === 'comic') return '漫画'
  if (kind === 'book') return '图书'
  return '其他'
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

/** 是否有下载任务在跑（清理 .part 缓存前判断，避免删掉正在写入的文件） */
export function hasRunningDownloads(): boolean {
  return tasks.size > 0
}

export async function listDownloads(): Promise<DownloadListResponse> {
  await loadLibrary()
  // 旧版本下载的 HLS 因为 ffmpeg 工作目录问题没有合并：后台补一次无损合成
  void repairLegacyHls()
  return {
    items: [...items].sort((a, b) => b.createdAt - a.createdAt).map(toPublicItem),
    tasks: [...tasks.values()].sort((a, b) => a.title.localeCompare(b.title)),
    dir: downloadsRoot()
  }
}

/** 备份导出：下载记录（相对路径，跨机器恢复后文件在对应目录即可继续用） */
export async function exportDownloadRecords(): Promise<DownloadRecord[]> {
  await loadLibrary()
  return items.map((item) => ({ ...item }))
}

function normalizeRecord(raw: unknown): DownloadRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : ''
  const playPath = typeof o.playPath === 'string' ? o.playPath : ''
  if (!id || !playPath) return null
  const kinds: DownloadKind[] = ['video', 'music', 'comic', 'book', 'file']
  const kind = kinds.includes(o.kind as DownloadKind) ? (o.kind as DownloadKind) : 'video'
  return {
    id,
    title: typeof o.title === 'string' ? o.title : playPath,
    kind,
    sourceUrl: typeof o.sourceUrl === 'string' ? o.sourceUrl : '',
    playPath,
    displayPath: typeof o.displayPath === 'string' ? o.displayPath : playPath,
    sizeBytes: typeof o.sizeBytes === 'number' ? o.sizeBytes : 0,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
    coverUrl: typeof o.coverUrl === 'string' ? o.coverUrl : '',
    sourceName: typeof o.sourceName === 'string' ? o.sourceName : '',
    hls: o.hls === true,
    folder: o.folder === true,
    durationSec: typeof o.durationSec === 'number' ? o.durationSec : undefined,
    referer: typeof o.referer === 'string' ? o.referer : undefined
  }
}

/** 备份导入：按相对路径去重合并，保留本机已有的下载记录（本机文件通常更新） */
export async function importDownloadRecords(raw: unknown): Promise<void> {
  await loadLibrary()
  if (!Array.isArray(raw)) return
  const seen = new Set(items.map((item) => item.playPath))
  let changed = false
  for (const row of raw.slice(0, 5000)) {
    const record = normalizeRecord(row)
    if (!record || seen.has(record.playPath)) continue
    items.push(record)
    seen.add(record.playPath)
    changed = true
  }
  if (changed) {
    await saveLibrary()
    notify()
  }
}

let legacyRepairStarted = false

/** 把目录里的 video.mp4 挪到「视频/<标题>.mp4」并删掉目录 */
async function flattenMergedVideo(
  folder: string,
  title: string,
  videoRoot: string
): Promise<{ rel: string; size: number } | null> {
  const source = join(folder, 'video.mp4')
  if (!existsSync(source)) return null
  const target = await uniqueTarget(videoRoot, safeName(title), '.mp4')
  try {
    await rename(source, target)
  } catch {
    await cp(source, target)
  }
  const size = (await stat(target)).size
  await rm(folder, { recursive: true, force: true }).catch(() => undefined)
  return { rel: `视频/${basename(target)}`, size }
}

/** 把历史上遗留的「m3u8 + 切片目录」尽量合并成单个 mp4，并更新下载记录 */
async function repairLegacyHls(): Promise<void> {
  if (legacyRepairStarted || tasks.size > 0) return
  legacyRepairStarted = true
  const root = downloadsRoot()
  const videoRoot = join(root, '视频')
  await mkdir(videoRoot, { recursive: true })

  // 1) 未合并的 HLS：解密 → 合并 → 平铺成「视频/<标题>.mp4」
  for (const item of items.filter((row) => row.hls)) {
    try {
      const abs = resolve(root, item.playPath)
      const folder = dirname(abs)
      if (!existsSync(join(folder, 'index.m3u8'))) continue
      // 旧版本把 AES-128 密文当明文存了：先按远端 key 就地解密
      const referer =
        item.referer || (item.sourceName === '吃瓜' ? melonReferer() : undefined)
      if (item.sourceUrl) await decryptLegacySegments(folder, item.sourceUrl, referer)
      if (!(await mergeHlsToMp4(folder))) continue
      const flat = await flattenMergedVideo(folder, item.title, videoRoot)
      if (!flat) continue
      item.playPath = flat.rel
      item.displayPath = flat.rel
      item.hls = false
      item.sizeBytes = flat.size
      await saveLibrary()
      notify()
    } catch {
      // 单个旧下载修复失败不影响其他记录
    }
  }

  // 2) 已合并但还留在「视频/<标题>/video.mp4」的旧布局：挪出来并删目录
  const videoRootAbs = resolve(videoRoot)
  for (const item of items) {
    if (item.kind !== 'video' || item.hls || item.folder) continue
    try {
      const abs = resolve(root, item.playPath)
      if (basename(abs).toLowerCase() !== 'video.mp4') continue
      if (resolve(dirname(dirname(abs))) !== videoRootAbs) continue
      const flat = await flattenMergedVideo(dirname(abs), item.title, videoRoot)
      if (!flat) continue
      item.playPath = flat.rel
      item.displayPath = flat.rel
      item.sizeBytes = flat.size
      await saveLibrary()
      notify()
    } catch {
      // 忽略单个文件
    }
  }

  // 3) 有些旧版本只留下了「视频」下的 HLS 目录（下载记录被移除）：
  // 一并合并 + 平铺并补登记，避免下载页里一直是散切片
  for (const entry of await readdirSafe(videoRoot)) {
    if (!entry.isDirectory() || entry.name.startsWith('.hls-')) continue
    const folder = join(videoRoot, entry.name)
    if (!existsSync(join(folder, 'index.m3u8'))) continue
    const relFolder = `视频/${entry.name}`
    if (items.some((i) => i.playPath === relFolder || i.playPath.startsWith(`${relFolder}/`))) {
      continue
    }
    try {
      if (!(await mergeHlsToMp4(folder))) continue
      const flat = await flattenMergedVideo(folder, entry.name, videoRoot)
      if (!flat) continue
      items.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: entry.name.slice(0, 160),
        kind: 'video',
        sourceUrl: '',
        playPath: flat.rel,
        displayPath: flat.rel,
        sizeBytes: flat.size,
        createdAt: Date.now(),
        coverUrl: '',
        sourceName: '视频',
        hls: false
      })
      await saveLibrary()
      notify()
    } catch {
      // 忽略单个目录
    }
  }
}

export async function addDownload(input: DownloadAddInput): Promise<DownloadAddResult> {
  await loadLibrary()
  const url = input.url.trim()
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: '下载地址无效' }
  // 已合并过的同地址不再重复下载；仍是散切片的旧记录允许重下一次（老密钥失效时无法修复）
  const duplicated = items.find((item) => item.sourceUrl === url)
  if (duplicated && !duplicated.hls) return { ok: false, error: '这个地址已经下载过了' }
  if ([...tasks.values()].some((t) => t.url === url)) return { ok: false, error: '正在下载中' }
  // 吃瓜视频 CDN 校验镜像 Referer：调起下载时补上并随记录保存，修复旧下载也能用
  const referer =
    input.referer?.trim() || (input.sourceName === '吃瓜' ? melonReferer() : '')
  const payload: DownloadAddInput = referer ? { ...input, referer } : input

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
        ? await downloadHls(payload, task, controller.signal)
        : await downloadDirect(payload, task, controller.signal)
      items.push(item)
      await saveLibrary()
      tasks.delete(task.id)
      controllers.delete(task.id)
      artifacts.delete(task.id)
    } catch (err) {
      controllers.delete(task.id)
      if (controller.signal.aborted) {
        tasks.delete(task.id)
      } else {
        task.state = 'failed'
        task.error = err instanceof Error ? err.message : '下载失败'
      }
      // 取消或失败都清掉半成品，避免留下 .part / 半个切片目录
      await cleanupArtifacts(task.id)
    }
    notify()
  })()

  notify()
  return { ok: true }
}

/* ---------------- 漫画 / 本子整章图片下载 ---------------- */

function guessImageExt(url: string, contentType: string): string {
  const type = contentType.toLowerCase()
  if (type.includes('image/png')) return '.png'
  if (type.includes('image/webp')) return '.webp'
  if (type.includes('image/gif')) return '.gif'
  if (type.includes('image/jpeg')) return '.jpg'
  const path = (() => {
    try {
      return new URL(url).pathname
    } catch {
      return url
    }
  })()
  const ext = extname(path).toLowerCase()
  return /^\.(jpe?g|png|webp|gif)$/.test(ext) ? ext : '.jpg'
}

interface ComicMetaFile {
  v: 1
  source: string
  comicId: string
  title: string
  cover: string
  chapters: { key: string; name: string; count: number }[]
}

async function readComicMeta(dir: string): Promise<ComicMetaFile | null> {
  try {
    const raw = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as ComicMetaFile
    if (!raw || typeof raw.comicId !== 'string') return null
    return raw
  } catch {
    return null
  }
}

/** 同一本书固定一个目录；标题撞车时用 id 后缀区分，便于断点续传 */
async function resolveComicDir(comic: ComicMetaInput): Promise<string> {
  const parent = join(downloadsRoot(), '漫画')
  await mkdir(parent, { recursive: true })
  const base = safeName(comic.title) || '漫画'
  let dir = join(parent, base)
  const existing = await readComicMeta(dir)
  if (existing && (existing.comicId !== comic.id || existing.source !== comic.source)) {
    dir = join(parent, `${base} (${safeName(comic.id)})`)
  }
  await mkdir(dir, { recursive: true })
  return dir
}

async function writeComicMeta(
  dir: string,
  comic: ComicMetaInput,
  chapter: { key: string; name: string; count: number }
): Promise<void> {
  const meta: ComicMetaFile = (await readComicMeta(dir)) ?? {
    v: 1,
    source: comic.source,
    comicId: comic.id,
    title: comic.title,
    cover: comic.cover ?? '',
    chapters: []
  }
  meta.title = comic.title || meta.title
  meta.cover = comic.cover || meta.cover
  meta.chapters = [...meta.chapters.filter((c) => c.key !== chapter.key), chapter]
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
}

interface ImageProgress {
  total: number
  done: number
}

/** 下载一章图片到指定目录；同序号已存在则跳过（断点续传） */
async function downloadChapterImages(
  folder: string,
  urls: string[],
  task: DownloadTask,
  signal: AbortSignal,
  referer: string | undefined,
  progress: ImageProgress
): Promise<void> {
  await mkdir(folder, { recursive: true })
  const prefixes = new Set(
    (await readdirSafe(folder)).filter((e) => e.isFile()).map((e) => e.name.split('.')[0])
  )
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++
      const url = urls[index]
      if (!url) return
      const prefix = String(index + 1).padStart(4, '0')
      if (prefixes.has(prefix)) {
        progress.done += 1
        task.progress = progress.total > 0 ? progress.done / progress.total : 0
        continue
      }
      const headers: Record<string, string> = {
        'User-Agent': UA,
        Accept: 'image/avif,image/webp,image/*,*/*;q=0.8'
      }
      if (referer) headers.Referer = referer
      // Komiic 章节图需要登录 Cookie 与完整路径 Referer（与渲染进程请求层同一套规则）
      try {
        const auth = komiicImageAuth(new URL(url))
        if (auth) {
          headers.Cookie = auth.cookie
          headers.Referer = auth.referer
        }
      } catch {
        // 非 Komiic 图片走默认头
      }
      const res = await fetch(url, { headers, signal })
      if (!res.ok) throw new Error(`第 ${index + 1} 张图片下载失败 HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const ext = guessImageExt(url, res.headers.get('content-type') ?? '')
      const filePath = join(folder, `${prefix}${ext}`)
      await writeFile(filePath, buf)
      artifactsOf(task.id).files.add(filePath)
      task.bytes += buf.length
      progress.done += 1
      task.progress = progress.total > 0 ? progress.done / progress.total : 0
      notify()
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, urls.length) }, worker))
}

/** 整本 / 单章批量下载：按章串行、章内 5 并发，完成后写 meta.json 供离线识别 */
export async function addComicBatchDownload(
  input: ComicBatchDownloadInput
): Promise<DownloadAddResult> {
  await loadLibrary()
  const comic = input.comic
  if (
    !comic ||
    (comic.source !== 'komiic' && comic.source !== 'bika') ||
    typeof comic.id !== 'string' ||
    !comic.id ||
    typeof comic.title !== 'string' ||
    !comic.title.trim()
  ) {
    return { ok: false, error: '漫画参数无效' }
  }

  const chapters = (Array.isArray(input.chapters) ? input.chapters : [])
    .map((chapter) => ({
      key: typeof chapter?.key === 'string' ? chapter.key.slice(0, 80) : '',
      name: typeof chapter?.name === 'string' ? chapter.name.slice(0, 120) : '',
      urls: (Array.isArray(chapter?.urls) ? chapter.urls : [])
        .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
        .slice(0, 300)
    }))
    .filter((chapter) => chapter.key && chapter.urls.length > 0)
    .slice(0, 500)

  if (!chapters.length) return { ok: false, error: '没有可下载的章节图片' }
  const totalImages = chapters.reduce((sum, c) => sum + c.urls.length, 0)
  if (totalImages > 5000) return { ok: false, error: '一次最多下载 5000 张，请分批' }
  if (
    [...tasks.values()].some(
      (t) => t.kind === 'comic' && t.title === comic.title && t.state === 'running'
    )
  ) {
    return { ok: false, error: '这本书正在下载中' }
  }

  const task: DownloadTask = {
    id: `comic_${comic.source}_${hashUrl(`${comic.id}|${Date.now()}`)}`,
    title: comic.title.trim().slice(0, 120),
    kind: 'comic',
    url: chapters[0].urls[0],
    sourceName: input.sourceName ?? '',
    coverUrl: comic.cover ?? '',
    state: 'running',
    progress: 0,
    bytes: 0,
    totalBytes: 0
  }
  const controller = new AbortController()
  controllers.set(task.id, controller)
  tasks.set(task.id, task)

  void (async () => {
    try {
      const dir = await resolveComicDir(comic)
      const progress: ImageProgress = { total: totalImages, done: 0 }
      for (const chapter of chapters) {
        const chapterDir = join(dir, safeName(chapter.name) || chapter.key)
        const existed = await stat(chapterDir).then(
          () => true,
          () => false
        )
        if (!existed) artifactsOf(task.id).dirs.add(chapterDir)
        await downloadChapterImages(
          chapterDir,
          chapter.urls,
          task,
          controller.signal,
          input.referer,
          progress
        )
        await writeComicMeta(dir, comic, {
          key: chapter.key,
          name: chapter.name || chapter.key,
          count: chapter.urls.length
        })
        artifactsOf(task.id).files.add(join(dir, 'meta.json'))
      }

      const rel = relative(downloadsRoot(), dir).replace(/\\/g, '/')
      const existing = items.find((i) => i.playPath === rel)
      if (existing) {
        existing.sizeBytes = await dirSize(dir)
        existing.createdAt = Date.now()
        existing.coverUrl = comic.cover ?? existing.coverUrl
      } else {
        items.push({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          title: task.title,
          kind: 'comic',
          sourceUrl: '',
          playPath: rel,
          displayPath: rel,
          sizeBytes: await dirSize(dir),
          createdAt: Date.now(),
          coverUrl: comic.cover ?? '',
          sourceName: input.sourceName ?? '',
          hls: false,
          folder: true
        })
      }
      await saveLibrary()
      tasks.delete(task.id)
      controllers.delete(task.id)
      artifacts.delete(task.id)
    } catch (err) {
      controllers.delete(task.id)
      if (controller.signal.aborted) {
        tasks.delete(task.id)
      } else {
        task.state = 'failed'
        task.error = err instanceof Error ? err.message : '下载失败'
      }
      await cleanupArtifacts(task.id)
    }
    notify()
  })()

  notify()
  return { ok: true }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0
  const files = await readdirSafe(dir)
  for (const entry of files) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) total += await dirSize(abs)
    else total += (await stat(abs).catch(() => ({ size: 0 }))).size
  }
  return total
}

async function readdirSafe(
  dir: string
): Promise<{ name: string; isDirectory: () => boolean; isFile: () => boolean }[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** 登记外部模块（如 Z-Library）已经写入下载目录的文件 */
export async function registerLocalFile(input: {
  title: string
  kind: DownloadKind
  absPath: string
  sourceName?: string
  coverUrl?: string
  folder?: boolean
}): Promise<void> {
  await loadLibrary()
  const root = resolve(downloadsRoot())
  const abs = resolve(input.absPath)
  if (!abs.startsWith(root + sep)) throw new Error('文件不在下载目录内')
  const rel = relative(root, abs).replace(/\\/g, '/')
  if (items.some((i) => i.playPath === rel)) return
  const size = input.folder ? await dirSize(abs) : (await stat(abs)).size
  items.push({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: input.title.slice(0, 160) || '未命名下载',
    kind: input.kind,
    sourceUrl: '',
    playPath: rel,
    displayPath: rel,
    sizeBytes: size,
    createdAt: Date.now(),
    coverUrl: input.coverUrl ?? '',
    sourceName: input.sourceName ?? '',
    hls: false,
    folder: !!input.folder
  })
  await saveLibrary()
  notify()
}

/** 在系统里打开下载项（文件或目录） */
export async function openDownloadItem(id: string): Promise<void> {
  await loadLibrary()
  const item = items.find((i) => i.id === id)
  if (!item) throw new Error('下载记录不存在')
  const root = resolve(downloadsRoot())
  const abs = resolve(root, item.playPath)
  if (!abs.startsWith(root + sep)) throw new Error('路径无效')
  const target = item.hls ? resolve(abs, '..') : abs
  const err = await shell.openPath(target)
  if (err) throw new Error(err)
}

/** 用系统默认播放器播放下载项（视频不再走应用内播放页） */
export async function playDownloadItem(id: string): Promise<void> {
  await loadLibrary()
  const item = items.find((i) => i.id === id)
  if (!item) throw new Error('下载记录不存在')
  const root = resolve(downloadsRoot())
  const abs = resolve(root, item.playPath)
  if (!abs.startsWith(root + sep)) throw new Error('路径无效')
  if (item.folder) throw new Error('目录型下载没有可播放的文件')
  const err = await shell.openPath(abs)
  if (err) throw new Error(err)
}

function mediaUrl(rel: string): string {
  return mediaPort ? `http://127.0.0.1:${mediaPort}/media/${encodeURI(rel)}` : ''
}

async function walkFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 6) return []
  const out: string[] = []
  for (const entry of await readdirSafe(dir)) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walkFiles(abs, depth + 1)))
    else if (entry.isFile()) out.push(abs)
  }
  return out
}

/** 找出 EPUB 的正文入口（按 OPF spine 顺序，失败时退第一个 HTML） */
async function findEpubEntry(folder: string): Promise<string | null> {
  const files = await walkFiles(folder)
  const opf = files.find((f) => f.toLowerCase().endsWith('.opf'))
  if (!opf) return files.find((f) => /\.x?html?$/i.test(f)) ?? null
  try {
    const xml = await readFile(opf, 'utf8')
    const items = new Map<string, string>()
    for (const m of xml.matchAll(/<item\b[^>]*>/gi)) {
      const tag = m[0]
      const id = /id\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
      if (id && href) items.set(id, href)
    }
    const opfDir = dirname(opf)
    for (const m of xml.matchAll(/<itemref\b[^>]*idref\s*=\s*["']([^"']+)["']/gi)) {
      const href = items.get(m[1])
      if (!href) continue
      const abs = resolve(opfDir, decodeURIComponent(href))
      if (existsSync(abs)) return abs
    }
  } catch {
    // 解析失败时退第一个 HTML
  }
  return files.find((f) => /\.x?html?$/i.test(f)) ?? null
}

/**
 * 应用内阅读：漫画目录按章节返回图片地址；图书返回可直接放进 iframe 的地址
 * （PDF 直接走本地媒体服务，EPUB 解包后定位到 OPF spine 的第一章）。
 */
export async function readDownloadItem(
  id: string
): Promise<{
  ok: boolean
  kind?: 'comic' | 'book'
  chapters?: { name: string; urls: string[] }[]
  url?: string
  error?: string
}> {
  await loadLibrary()
  const item = items.find((i) => i.id === id)
  if (!item) return { ok: false, error: '下载记录不存在' }
  const root = resolve(downloadsRoot())
  const abs = resolve(root, item.playPath)
  if (!abs.startsWith(root + sep)) return { ok: false, error: '路径无效' }
  const relOf = (target: string): string => relative(root, target).replace(/\\/g, '/')

  if (item.folder) {
    const meta = await readComicMeta(abs)
    const dirs = (await readdirSafe(abs))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    const ordered = (meta?.chapters ?? []).map((c) => safeName(c.name) || c.key)
    const names = [
      ...ordered.filter((name) => dirs.includes(name)),
      ...dirs.filter((name) => !ordered.includes(name))
    ]
    const chapters: { name: string; urls: string[] }[] = []
    for (const name of names) {
      const dir = join(abs, name)
      const files = (await readdirSafe(dir))
        .filter((entry) => entry.isFile() && /\.(jpe?g|png|webp|gif)$/i.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      if (!files.length) continue
      chapters.push({ name, urls: files.map((file) => mediaUrl(relOf(join(dir, file)))) })
    }
    if (!chapters.length) return { ok: false, error: '这个目录里没有可阅读的图片' }
    return { ok: true, kind: 'comic', chapters }
  }

  const ext = extname(abs).toLowerCase()
  if (ext === '.epub') {
    const unpacked = join(dirname(abs), `${basename(abs, ext)}.unpacked`)
    if (!existsSync(unpacked)) {
      try {
        await mkdir(unpacked, { recursive: true })
        new AdmZip(abs).extractAllTo(unpacked, true)
      } catch (err) {
        return { ok: false, error: `EPUB 解包失败：${(err as Error).message}` }
      }
    }
    const entry = await findEpubEntry(unpacked)
    if (!entry) return { ok: false, error: 'EPUB 里没有找到可阅读的正文' }
    return { ok: true, kind: 'book', url: mediaUrl(relOf(entry)) }
  }

  return { ok: true, kind: 'book', url: mediaUrl(item.playPath) }
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
      // 删到系统回收站，误删可从回收站恢复；回收站不可用时才彻底删除
      await shell.trashItem(target).catch(async () => {
        await rm(target, { recursive: true, force: true }).catch(() => undefined)
      })
      // EPUB 应用内阅读会把书解包到同名 .unpacked 目录，删除时一起清掉
      if (extname(abs).toLowerCase() === '.epub') {
        const unpacked = join(dirname(abs), `${basename(abs, '.epub')}.unpacked`)
        await rm(unpacked, { recursive: true, force: true }).catch(() => undefined)
      }
    }
  }
}

export async function cancelTask(id: string): Promise<void> {
  controllers.get(id)?.abort()
  controllers.delete(id)
  tasks.delete(id)
  // 等一小会儿让写文件的流退出，再清掉本次产生的半成品
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 120))
  await cleanupArtifacts(id)
}

export async function openDownloadsDir(): Promise<void> {
  await mkdir(downloadsRoot(), { recursive: true })
  const err = await shell.openPath(downloadsRoot())
  if (err) throw new Error(err)
}

/** 迁移单个文件/目录：同盘用 rename，跨盘或目标已存在时退回复制后删除 */
async function moveEntry(from: string, to: string): Promise<void> {
  const exists = await stat(to).then(
    () => true,
    () => false
  )
  if (!exists) {
    try {
      await rename(from, to)
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    }
  }
  await cp(from, to, { recursive: true, force: true })
  await rm(from, { recursive: true, force: true })
}

/**
 * 更改下载总目录。
 * move = true 时把旧目录里的全部内容迁移到新目录，迁移完成后删除旧目录残余；
 * 迁移期间不允许有正在下载的任务，避免半个文件被搬走。
 */
export async function changeDownloadRoot(
  nextRootRaw: string,
  move: boolean
): Promise<{ ok: boolean; root?: string; moved?: number; error?: string }> {
  await loadLibrary()
  const next = nextRootRaw.trim()
  if (!next) return { ok: false, error: '下载目录不能为空' }
  const oldAbs = resolve(downloadsRoot())
  const nextAbs = resolve(next)
  if (oldAbs === nextAbs) return { ok: true, root: nextAbs, moved: 0 }
  if (nextAbs.startsWith(oldAbs + sep) || oldAbs.startsWith(nextAbs + sep)) {
    return { ok: false, error: '新旧目录不能互相包含' }
  }
  if (move && tasks.size > 0) {
    return { ok: false, error: '还有下载任务进行中，等下载完成后再迁移' }
  }

  let moved = 0
  if (move) {
    try {
      await mkdir(nextAbs, { recursive: true })
      const names = await readdir(oldAbs).catch(() => [] as string[])
      for (const name of names) {
        await moveEntry(join(oldAbs, name), join(nextAbs, name))
        moved += 1
      }
      // 迁移完成后清理旧目录残余（空壳、跨盘复制留下的空目录）
      if (oldAbs !== resolve(app.getPath('downloads'))) {
        await rm(oldAbs, { recursive: true, force: true }).catch(() => undefined)
      }
    } catch (err) {
      return { ok: false, error: `迁移失败：${(err as Error).message}` }
    }
  }

  const root = await setDownloadRoot(nextAbs)
  notify()
  return { ok: true, root, moved }
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

async function uniqueDir(dir: string, base: string): Promise<string> {
  let target = join(dir, base)
  let n = 2
  for (;;) {
    try {
      await stat(target)
      target = join(dir, `${base} (${n++})`)
    } catch {
      return target
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
  artifactsOf(task.id).files.add(tmp)

  const res = await fetch(input.url, {
    headers: downloadHeaders(input.url, input.referer),
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
    hls: false,
    durationSec: input.durationSec,
    referer: input.referer
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

/** HLS 属性既可能是带引号的 URI="..."，也可能是无引号的 METHOD=AES-128 */
function attr(line: string, name: string): string | null {
  const m = line.match(new RegExp(`${name}=(?:"([^"]*)"|([^,]*))`, 'i'))
  if (!m) return null
  const value = (m[1] ?? m[2] ?? '').trim()
  return value || null
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

async function fetchText(url: string, signal: AbortSignal, referer?: string): Promise<string> {
  const res = await fetch(url, { headers: downloadHeaders(url, referer), signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function fetchBuffer(url: string, signal: AbortSignal, referer?: string): Promise<Buffer> {
  let last: unknown
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: downloadHeaders(url, referer), signal })
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
  let text = await fetchText(playlistUrl, signal, input.referer)
  if (text.includes('#EXT-X-STREAM-INF')) {
    const variant = parseMaster(text, playlistUrl)
    if (!variant) throw new Error('无法解析清晰度列表')
    playlistUrl = variant
    text = await fetchText(playlistUrl, signal, input.referer)
  }
  const playlist = parseMediaPlaylist(text, playlistUrl)
  if (!playlist.segments.length) throw new Error('播放列表里没有切片')

  const videoDir = join(downloadsRoot(), '视频')
  const base = safeName(input.title)
  await mkdir(videoDir, { recursive: true })
  // 切片先进临时目录；合并成功后只留「视频/<标题>.mp4」，不再额外建文件夹
  const folder = join(videoDir, `.hls-${task.id}`)
  const segmentExt = playlist.mapUri ? '.m4s' : '.ts'
  await mkdir(folder, { recursive: true })
  artifactsOf(task.id).dirs.add(folder)
  const keyCache = new Map<string, Buffer>()
  let done = 0
  task.progress = 0
  task.totalBytes = 0

  const getKey = async (uri: string): Promise<Buffer> => {
    const cached = keyCache.get(uri)
    if (cached) return cached
    const buf = await fetchBuffer(uri, signal, input.referer)
    keyCache.set(uri, buf)
    return buf
  }

  if (playlist.mapUri) {
    const init = await fetchBuffer(playlist.mapUri, signal, input.referer)
    await writeFile(join(folder, 'init.mp4'), init)
    task.bytes += init.length
  }

  const concurrency = 5
  let cursor = 0
  /** 长视频下载到后段时签名 / token 可能过期，整条线路 403：重新拉一次播放列表换新地址 */
  let segments = playlist.segments
  let refreshing: Promise<void> | null = null
  const refreshPlaylist = async (): Promise<void> => {
    if (refreshing) return refreshing
    refreshing = (async () => {
      try {
        let nextUrl = playlistUrl
        let nextText = await fetchText(nextUrl, signal, input.referer)
        if (nextText.includes('#EXT-X-STREAM-INF')) {
          const variant = parseMaster(nextText, nextUrl)
          if (!variant) return
          nextUrl = variant
          nextText = await fetchText(nextUrl, signal, input.referer)
        }
        const parsed = parseMediaPlaylist(nextText, nextUrl)
        if (parsed.segments.length === segments.length) segments = parsed.segments
      } catch {
        // 刷新失败时保持原地址，由上层报错
      }
    })()
    try {
      await refreshing
    } finally {
      refreshing = null
    }
  }
  const worker = async () => {
    for (;;) {
      const index = cursor++
      if (!segments[index]) return
      let segment = segments[index]
      let data: Buffer
      try {
        data = await fetchBuffer(segment.url, signal, input.referer)
      } catch (err) {
        if (signal.aborted) throw err
        // 地址过期：刷新播放列表后用新签名重试一次
        await refreshPlaylist()
        segment = segments[index] ?? segment
        data = await fetchBuffer(segment.url, signal, input.referer)
      }
      if (segment.key && segment.key.uri) {
        const key = await getKey(segment.key.uri)
        const iv = segment.key.iv
          ? Buffer.from(segment.key.iv.replace(/^0x/i, ''), 'hex')
          : (() => {
              const b = Buffer.alloc(16)
              b.writeBigUInt64BE(BigInt(segment.seq), 8)
              return b
            })()
        const decipher = createDecipheriv('aes-128-cbc', key, iv)
        data = Buffer.concat([decipher.update(data), decipher.final()])
      }
      const name = `seg-${String(index + 1).padStart(5, '0')}${segmentExt}`
      await writeFile(join(folder, name), data)
      task.bytes += data.length
      done += 1
      task.progress = done / segments.length
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

  const merged = await mergeHlsToMp4(folder)
  let playRel: string
  let playSize = task.bytes
  if (merged) {
    // 合并成功：临时目录里的 video.mp4 改名成「视频/<标题>.mp4」，目录整个删掉
    const target = await uniqueTarget(videoDir, base, '.mp4')
    const source = join(folder, 'video.mp4')
    try {
      await rename(source, target)
    } catch {
      await cp(source, target)
    }
    playSize = (await stat(target)).size
    await rm(folder, { recursive: true, force: true }).catch(() => undefined)
    playRel = `视频/${basename(target)}`
  } else {
    // 合并失败：保留切片目录（用标题命名），等下次启动再修
    let fallbackDir = await uniqueDir(videoDir, base)
    try {
      await rename(folder, fallbackDir)
    } catch {
      fallbackDir = folder
    }
    playRel = `视频/${basename(fallbackDir)}/index.m3u8`
  }
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: input.title.trim() || '未命名视频',
    kind: input.kind,
    sourceUrl: input.url,
    playPath: playRel,
    displayPath: playRel,
    sizeBytes: playSize,
    createdAt: Date.now(),
    coverUrl: input.coverUrl ?? '',
    sourceName: input.sourceName ?? '',
    hls: !merged,
    durationSec: input.durationSec,
    referer: input.referer
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
  '.webp': 'image/webp',
  '.epub': 'application/epub+zip',
  '.pdf': 'application/pdf',
  '.mobi': 'application/x-mobipocket-ebook',
  '.azw3': 'application/vnd.amazon.ebook',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
  '.xhtml': 'application/xhtml+xml',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
}

export async function startMediaServer(): Promise<void> {
  if (mediaPort) return
  // 每次请求时再取根目录，设置里改了下载目录后无需重启应用
  const server = createServer(async (req, res) => {
    try {
      const root = resolve(downloadsRoot())
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
