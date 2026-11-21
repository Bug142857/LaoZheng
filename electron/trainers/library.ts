import { shell } from 'electron'
import AdmZip from 'adm-zip'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { downloadRoot } from '../settings'
import { runElevatedProcess } from '../powershell'
import {
  beginExternalDownload,
  finishExternalDownload,
  registerLocalFile,
  setExternalDownloadCancel,
  updateExternalDownloadProgress
} from '../downloads'
import type { InstalledTrainer, TrainerActionResult, TrainerDownloadInput, TrainerDownloadResponse, TrainerLibraryResponse, TrainerSourceType } from '../../src/shared/trainers'
import { TRAINER_SOURCE_TYPE_LABEL } from '../../src/shared/trainers'
import { MAX_DOWNLOAD, UA, safeName, sameHost } from './common'
export function trainerRootDir(): string {
  return join(downloadRoot(), '修改器')
}

export async function ensureRoot(): Promise<string> {
  const root = trainerRootDir()
  await mkdir(root, { recursive: true })
  return root
}


/* ------------------------------ 文件处理 ------------------------------ */

export type ArchiveKind = 'zip' | 'exe' | 'rar' | '7z' | 'html' | 'unknown'

export function detectKind(buffer: Buffer): ArchiveKind {
  if (buffer.length < 8) return 'unknown'
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'zip'
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) return 'exe'
  if (buffer.toString('latin1', 0, 4) === 'Rar!') return 'rar'
  if (buffer[0] === 0x37 && buffer[1] === 0x7a && buffer[2] === 0xbc && buffer[3] === 0xaf) {
    return '7z'
  }
  const head = buffer.toString('utf8', 0, Math.min(buffer.length, 512)).trim().toLowerCase()
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return 'html'
  return 'unknown'
}

export interface FolderStats {
  files: number
  sizeBytes: number
  exes: { rel: string; size: number }[]
}

export async function scanFolder(dir: string, base = dir, out?: FolderStats): Promise<FolderStats> {
  const acc: FolderStats = out ?? { files: 0, sizeBytes: 0, exes: [] }
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await scanFolder(full, base, acc)
      continue
    }
    if (!entry.isFile()) continue
    try {
      const info = await stat(full)
      acc.files += 1
      acc.sizeBytes += info.size
      if (extname(entry.name).toLowerCase() === '.exe') {
        acc.exes.push({ rel: full.slice(base.length + 1), size: info.size })
      }
    } catch {
      // 单个文件读不到时跳过
    }
  }
  return acc
}

/** 解压 zip：逐条校验路径，防目录穿越 */
export async function extractZip(buffer: Buffer, dest: string): Promise<void> {
  const zip = new AdmZip(buffer)
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.replace(/\\/g, '/')
    if (!name || name.includes('..')) continue
    const target = resolve(dest, name)
    if (target !== resolve(dest) && !target.startsWith(resolve(dest) + sep)) continue
    if (entry.isDirectory) {
      await mkdir(target, { recursive: true })
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, entry.getData())
  }
}

/** 压缩包常见结构是只有一个顶层文件夹：把它里面的内容提到根目录 */
export async function flattenSingleFolder(dir: string): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    if (entries.length !== 1 || !entries[0].isDirectory()) return
    const inner = join(dir, entries[0].name)
    const innerEntries = await readdir(inner, { withFileTypes: true })
    for (const entry of innerEntries) {
      await rename(join(inner, entry.name), join(dir, entry.name))
    }
    await rm(inner, { recursive: true, force: true })
  } catch {
    // 结构不符合预期时保留原样
  }
}

export async function uniqueFolder(root: string, name: string): Promise<string> {
  const base = safeName(name)
  let candidate = base
  let index = 2
  while (existsSync(join(root, candidate))) {
    candidate = `${base} (${index})`
    index += 1
  }
  return candidate
}

export async function buildRecord(
  folder: string,
  meta: {
    title: string
    source: TrainerSourceType | 'local'
    sourceId: string
    pageUrl: string
    cover: string | null
    version: string
    installedAt?: number
  }
): Promise<InstalledTrainer> {
  const dir = join(trainerRootDir(), folder)
  const stats = await scanFolder(dir)
  stats.exes.sort((a, b) => b.size - a.size)
  return {
    folder,
    title: meta.title || folder,
    source: meta.source,
    sourceId: meta.sourceId,
    pageUrl: meta.pageUrl,
    cover: meta.cover,
    version: meta.version,
    exe: stats.exes[0]?.rel ?? '',
    files: stats.files,
    sizeBytes: stats.sizeBytes,
    installedAt: meta.installedAt ?? Date.now()
  }
}

/* ------------------------------ 下载 ------------------------------ */

export async function downloadTrainer(input: TrainerDownloadInput): Promise<TrainerDownloadResponse> {
  if (
    !input ||
    typeof input.url !== 'string' ||
    typeof input.title !== 'string' ||
    (input.sourceType !== 'fling' &&
      input.sourceType !== 'megagames' &&
      input.sourceType !== '3dm' &&
      input.sourceType !== 'gamersky' &&
      input.sourceType !== 'ali213')
  ) {
    return { ok: false, error: '下载参数无效' }
  }
  const baseUrl =
    typeof input.sourceBaseUrl === 'string' ? input.sourceBaseUrl.trim().replace(/\/+$/, '') : ''
  if (!/^https?:\/\//i.test(baseUrl)) return { ok: false, error: '修改器源地址无效' }
  try {
    const target = new URL(input.url)
    const base = new URL(baseUrl)
    const host = target.hostname
    const allowed =
      host === base.hostname ||
      host.endsWith(`.${base.hostname}`) ||
      (input.sourceType === 'megagames' && /\.rocketcdn\.me$/i.test(host)) ||
      (input.sourceType === '3dm' &&
        (host.endsWith('.3dmgame.com') ||
          host === 'shwswl.cn' ||
          host.endsWith('.shwswl.cn') ||
          host === 'wsyhn.com' ||
          host.endsWith('.wsyhn.com')))
    if (!allowed || (target.protocol !== 'https:' && target.protocol !== 'http:')) {
      return { ok: false, error: '下载地址不在该修改器源范围内' }
    }
  } catch {
    return { ok: false, error: '下载地址无效' }
  }

  const root = await ensureRoot()
  const taskId = beginExternalDownload({
    title: input.title,
    kind: 'trainer',
    sourceName: input.sourceName ?? '修改器',
    sourceUrl: input.url,
    coverUrl: typeof input.cover === 'string' ? input.cover : ''
  })
  // 取消 / 超时都走同一个 AbortController：下载中心点 X 能立刻中断流式请求
  const controller = new AbortController()
  let canceled = false
  let timedOut = false
  let timeoutTimer: NodeJS.Timeout | null = null
  const armTimeout = (): void => {
    if (timeoutTimer) clearTimeout(timeoutTimer)
    timeoutTimer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 180_000)
  }
  setExternalDownloadCancel(taskId, () => {
    canceled = true
    controller.abort()
    return true
  })

  let buffer: Buffer
  try {
    armTimeout()
    const res = await fetch(input.url, {
      headers: {
        'User-Agent': UA,
        Accept: '*/*',
        Referer:
          typeof input.pageUrl === 'string' && input.pageUrl ? input.pageUrl : `${baseUrl}/`,
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      redirect: 'follow',
      signal: controller.signal
    })
    if (!res.ok) {
      finishExternalDownload(taskId)
      return { ok: false, error: `站点返回 HTTP ${res.status}` }
    }
    const total = Number(res.headers.get('content-length') ?? 0)
    if (Number.isFinite(total) && total > MAX_DOWNLOAD) {
      finishExternalDownload(taskId)
      return { ok: false, error: '文件超过 300MB，已取消下载' }
    }
    const reader = res.body?.getReader()
    if (!reader) {
      finishExternalDownload(taskId)
      return { ok: false, error: '下载内容为空' }
    }
    const chunks: Buffer[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.length) continue
      received += value.length
      if (received > MAX_DOWNLOAD) {
        await reader.cancel().catch(() => undefined)
        finishExternalDownload(taskId)
        return { ok: false, error: '文件超过 300MB，已取消下载' }
      }
      chunks.push(Buffer.from(value))
      updateExternalDownloadProgress(taskId, received, total)
      // 有进度就重置超时：慢速但仍在下载的文件不会被 180 秒总时长误杀
      armTimeout()
    }
    buffer = Buffer.concat(chunks)
  } catch (err) {
    finishExternalDownload(taskId)
    if (canceled) return { ok: false, error: '下载已取消' }
    if (timedOut) return { ok: false, error: '下载超时（180 秒没有新进度）' }
    return { ok: false, error: `下载失败：${(err as Error).message}` }
  } finally {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
      timeoutTimer = null
    }
  }
  finishExternalDownload(taskId)
  if (canceled) return { ok: false, error: '下载已取消' }
  if (!buffer.length) return { ok: false, error: '下载内容为空' }
  if (buffer.length > MAX_DOWNLOAD) return { ok: false, error: '文件超过 300MB，已取消下载' }

  const kind = detectKind(buffer)
  if (kind === 'html') {
    return { ok: false, error: '站点返回了网页而不是文件，可能被 Cloudflare 拦截，请稍后重试' }
  }

  const folder = await uniqueFolder(root, input.title)
  const dir = join(root, folder)
  await mkdir(dir, { recursive: true })
  const base = safeName(input.title)
  let note: string | undefined

  try {
    if (kind === 'zip') {
      try {
        await extractZip(buffer, dir)
        await flattenSingleFolder(dir)
      } catch (err) {
        await writeFile(join(dir, `${base}.zip`), buffer)
        note = `自动解压失败（${(err as Error).message}），已保存压缩包，请手动解压`
      }
    } else if (kind === 'exe') {
      await writeFile(join(dir, `${base}.exe`), buffer)
    } else if (kind === 'rar' || kind === '7z') {
      await writeFile(join(dir, `${base}.${kind}`), buffer)
      note = `该文件是 ${kind.toUpperCase()} 压缩包，已保存到目录，请手动解压后再启动`
    } else {
      await writeFile(join(dir, `${base}.bin`), buffer)
      note = '无法识别文件类型，已原样保存到目录'
    }
  } catch (err) {
    return { ok: false, error: `写入文件失败：${(err as Error).message}` }
  }

  const record = await buildRecord(folder, {
    title: input.title.slice(0, 200),
    source: input.sourceType,
    sourceId: typeof input.sourceId === 'string' ? input.sourceId : '',
    pageUrl:
      typeof input.pageUrl === 'string' && sameHost(input.pageUrl, baseUrl) ? input.pageUrl : '',
    cover: typeof input.cover === 'string' ? input.cover : null,
    version: typeof input.version === 'string' ? input.version.slice(0, 80) : ''
  })

  // 同步进下载管理的「修改器」分区（失败不影响已经落盘的文件）
  try {
    await registerLocalFile({
      title: record.title,
      kind: 'trainer',
      absPath: record.exe ? join(dir, record.exe) : dir,
      folder: !record.exe,
      sourceName:
        typeof input.sourceName === 'string' && input.sourceName
          ? input.sourceName
          : TRAINER_SOURCE_TYPE_LABEL[input.sourceType].split('（')[0],
      coverUrl: record.cover ?? undefined
    })
  } catch (err) {
    console.error('[trainers] 写入下载记录失败', err)
  }

  return { ok: true, trainer: record, note }
}

/* ------------------------------ 已安装管理 ------------------------------ */

export async function scanTrainerLibrary(): Promise<TrainerLibraryResponse> {
  const root = await ensureRoot()
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (err) {
    return { ok: false, root, items: [], error: (err as Error).message }
  }
  const items: InstalledTrainer[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = join(root, entry.name)
    let installedAt = Date.now()
    try {
      installedAt = (await stat(dir)).mtimeMs
    } catch {
      // 读不到时间时用当前时间
    }
    items.push(
      await buildRecord(entry.name, {
        title: entry.name,
        source: 'local',
        sourceId: '',
        pageUrl: '',
        cover: null,
        version: '',
        installedAt
      })
    )
  }
  items.sort((a, b) => b.installedAt - a.installedAt)
  return { ok: true, root, items }
}

/** 校验传入目录必须位于「修改器」根目录内，返回绝对路径 */
export function resolveInsideRoot(folder: string): string | null {
  if (typeof folder !== 'string' || !folder.trim()) return null
  const root = resolve(trainerRootDir())
  const target = resolve(root, folder)
  if (target === root || !target.startsWith(root + sep)) return null
  return target
}

export async function runTrainer(folder: string, exe: string): Promise<TrainerActionResult> {
  const dir = resolveInsideRoot(folder)
  if (!dir) return { ok: false, error: '路径无效' }
  const target = resolve(dir, exe)
  if (!target.startsWith(dir + sep) || !existsSync(target)) {
    return { ok: false, error: '没有找到修改器主程序，请打开目录手动启动' }
  }
  // 只允许启动 exe：解压出来的 bat / cmd / lnk 不参与，避免提权执行任意脚本
  if (extname(target).toLowerCase() !== '.exe') {
    return { ok: false, error: '修改器主程序不是 exe，请打开目录手动启动' }
  }
  try {
    await runElevatedProcess(target, dir)
    return { ok: true, message: '已请求管理员权限启动修改器' }
  } catch (err) {
    const message = (err as Error).message
    if (/canceled|cancelled|取消/i.test(message)) {
      return { ok: false, error: '已取消管理员权限请求' }
    }
    return { ok: false, error: `启动失败：${message}` }
  }
}

export async function openTrainerFolder(folder?: string): Promise<TrainerActionResult> {
  const root = await ensureRoot()
  let target = root
  if (folder) {
    const dir = resolveInsideRoot(folder)
    if (!dir) return { ok: false, error: '路径无效' }
    if (!existsSync(dir)) return { ok: false, error: '目录不存在，可能已被删除' }
    target = dir
  }
  const err = await shell.openPath(target)
  return err ? { ok: false, error: err } : { ok: true }
}

export async function deleteTrainer(folder: string): Promise<TrainerActionResult> {
  const dir = resolveInsideRoot(folder)
  if (!dir) return { ok: false, error: '路径无效' }
  if (!existsSync(dir)) return { ok: true }
  try {
    // 删到系统回收站，误删可还原
    await shell.trashItem(dir)
    return { ok: true, message: '已移到回收站' }
  } catch (err) {
    return { ok: false, error: `删除失败：${(err as Error).message}` }
  }
}
