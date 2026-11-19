import { app } from 'electron'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { normalizeMusicQueue } from '../src/shared/music'
import type { MusicPlayMode, ThemeMode, UiSettings } from '../src/shared/settings'
import type { BackupSettings } from '../src/shared/types'

/**
 * 本机设置：单独存 settings.json，导出 / 云同步时作为 PC 扩展字段附带一份快照。
 * 下载总目录：视频 / 音乐 / 漫画 / 图书 都放在这个目录下。
 * 主题：显示模式（跟随系统 / 浅色 / 深色）与主题色，启动时由渲染进程读取后立即应用。
 */
interface AppSettings {
  downloadRoot: string
  /** 图片 / 接口缓存根目录；默认 userData，可在「清理缓存」旁更改 */
  cacheRoot: string
  theme: ThemeMode
  accent: string
  /** 音乐播放器音量（0~1）与静音状态，记住上次值 */
  musicVolume?: number
  musicMuted?: boolean
  /** 音乐播放队列 / 当前条目 / 播放模式 / 续播位置 */
  musicQueue?: ReturnType<typeof normalizeMusicQueue>
  musicQueueIndex?: number
  musicMode?: MusicPlayMode
  musicQueueTime?: number
  /**
   * 各类文件对话框上次选择的目录：
   * data / vod / live / magnet / image / downloadRoot
   */
  lastDirs?: Record<string, string>
  /** 旧字段：上次保存图片的目录，读取时迁移到 lastDirs.image */
  lastImageDir?: string
}

const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark']
const ACCENT_KEYS = ['purple', 'green', 'blue', 'cyan', 'orange', 'pink']
const PLAY_MODES: MusicPlayMode[] = ['single', 'order', 'shuffle']

function isPlayMode(value: unknown): value is MusicPlayMode {
  return typeof value === 'string' && PLAY_MODES.includes(value as MusicPlayMode)
}

function clampQueueIndex(value: unknown, length: number): number {
  if (!length) return -1
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(length - 1, Math.max(0, Math.floor(value)))
}

function clampQueueTime(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(value, 24 * 60 * 60)
    : 0
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function defaultDownloadRoot(): string {
  return join(app.getPath('downloads'), '老郑分享')
}

/** 全新安装的默认根目录：下载 / 缓存都放 D:\laozheng 下（D 盘不可用时回退到原来的默认位置） */
const PORTABLE_ROOT = 'D:\\laozheng'

async function applyFirstRunRoots(): Promise<void> {
  const download = join(PORTABLE_ROOT, 'download')
  const cache = join(PORTABLE_ROOT, 'cache')
  try {
    await mkdir(download, { recursive: true })
    await mkdir(cache, { recursive: true })
  } catch (err) {
    console.warn('[settings] D:\\laozheng 不可写，下载 / 缓存目录继续用默认位置', err)
    return
  }
  current.downloadRoot = download
  current.cacheRoot = cache
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (err) {
    // 只有「确实不存在」才算不存在；EACCES / EPERM 等无法确认时按已存在处理，
    // 避免杀软 / 网盘占用时把老用户误判成全新安装并套用 D:\laozheng 路径
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    console.warn('[settings] 无法确认文件是否存在，按已存在处理', path, err)
    return true
  }
}

/** 首次安装判定：userData 里没有任何本应用留下的文件才算，老用户升级一律保持原路径 */
async function isFirstRun(): Promise<boolean> {
  const dir = app.getPath('userData')
  for (const name of ['settings.json', 'data.json', 'seed-state.json']) {
    if (await exists(join(dir, name))) return false
  }
  return true
}

let current: AppSettings = {
  downloadRoot: defaultDownloadRoot(),
  cacheRoot: app.getPath('userData'),
  theme: 'system',
  accent: 'purple'
}

export function downloadRoot(): string {
  return current.downloadRoot
}

export function cacheRoot(): string {
  return current.cacheRoot
}

export async function setCacheRoot(root: string): Promise<string> {
  const next = root.trim()
  if (!next) throw new Error('缓存目录不能为空')
  current.cacheRoot = next
  await saveSettings()
  return current.cacheRoot
}

export function uiSettings(): UiSettings {
  return {
    theme: current.theme,
    accent: current.accent,
    musicVolume: current.musicVolume,
    musicMuted: current.musicMuted,
    musicQueue: current.musicQueue ? [...current.musicQueue] : undefined,
    musicQueueIndex: current.musicQueueIndex,
    musicMode: current.musicMode,
    musicQueueTime: current.musicQueueTime
  }
}

/** 某个文件对话框上次使用的目录，没记过时返回 fallback */
export function lastDialogDir(key: string, fallback: string): string {
  return current.lastDirs?.[key]?.trim() || fallback
}

/**
 * 记住文件对话框这次选择的目录（导入 / 导出 / 保存图片共用）。
 * isDirectory = true 时把传入路径本身当目录（选择文件夹的对话框）。
 */
export async function rememberDialogDir(
  key: string,
  filePath: string,
  isDirectory = false
): Promise<void> {
  const dir = (isDirectory ? filePath : dirname(filePath)).trim()
  if (!dir) return
  if (!current.lastDirs) current.lastDirs = {}
  if (current.lastDirs[key] === dir) return
  current.lastDirs[key] = dir
  await saveSettings()
}

/** 备份用的本机设置快照（下载目录 / 主题 / 各对话框上次位置） */
export function settingsSnapshot(): BackupSettings {
  return {
    theme: current.theme,
    accent: current.accent,
    downloadRoot: current.downloadRoot,
    lastImageDir: current.lastDirs?.image,
    lastDirs: current.lastDirs ? { ...current.lastDirs } : undefined,
    musicVolume: current.musicVolume,
    musicMuted: current.musicMuted,
    musicQueue: current.musicQueue ? [...current.musicQueue] : undefined,
    musicQueueIndex: current.musicQueueIndex,
    musicMode: current.musicMode,
    musicQueueTime: current.musicQueueTime
  }
}

/** 从备份恢复本机设置；无效值直接跳过，不覆盖当前设置 */
export async function applySettingsSnapshot(input: BackupSettings): Promise<void> {
  let changed = false
  if (input.theme && THEME_MODES.includes(input.theme as ThemeMode)) {
    current.theme = input.theme as ThemeMode
    changed = true
  }
  if (typeof input.accent === 'string' && ACCENT_KEYS.includes(input.accent)) {
    current.accent = input.accent
    changed = true
  }
  if (typeof input.downloadRoot === 'string' && input.downloadRoot.trim()) {
    const next = input.downloadRoot.trim()
    // 备份可能来自另一台电脑：盘符 / 用户名目录在本机不存在时不要覆盖当前可用目录，
    // 否则之后所有下载都会因为目录建不出来而失败
    try {
      await mkdir(next, { recursive: true })
      current.downloadRoot = next
      changed = true
    } catch (err) {
      console.warn('[settings] 备份里的下载目录不可用，保留当前目录', next, err)
    }
  }
  if (input.lastDirs && typeof input.lastDirs === 'object') {
    if (!current.lastDirs) current.lastDirs = {}
    for (const [key, value] of Object.entries(input.lastDirs)) {
      if (typeof value !== 'string' || !value.trim()) continue
      current.lastDirs[key] = value.trim()
      changed = true
    }
  }
  if (typeof input.musicVolume === 'number' && Number.isFinite(input.musicVolume)) {
    current.musicVolume = Math.min(1, Math.max(0, input.musicVolume))
    changed = true
  }
  if (typeof input.musicMuted === 'boolean') {
    current.musicMuted = input.musicMuted
    changed = true
  }
  if (input.musicQueue !== undefined) {
    const queue = normalizeMusicQueue(input.musicQueue)
    current.musicQueue = queue.length ? queue : undefined
    current.musicQueueIndex = queue.length
      ? clampQueueIndex(input.musicQueueIndex, queue.length)
      : undefined
    current.musicQueueTime = queue.length ? clampQueueTime(input.musicQueueTime) : 0
    changed = true
  }
  if (isPlayMode(input.musicMode)) {
    current.musicMode = input.musicMode
    changed = true
  }
  // 旧备份只有 lastImageDir
  if (typeof input.lastImageDir === 'string' && input.lastImageDir.trim()) {
    if (!current.lastDirs) current.lastDirs = {}
    current.lastDirs.image = input.lastImageDir.trim()
    changed = true
  }
  if (changed) await saveSettings()
}

export async function initSettings(): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(settingsPath(), 'utf8')) as Partial<AppSettings>
    if (typeof raw.downloadRoot === 'string' && raw.downloadRoot.trim()) {
      current.downloadRoot = raw.downloadRoot.trim()
    }
    if (typeof raw.cacheRoot === 'string' && raw.cacheRoot.trim()) {
      current.cacheRoot = raw.cacheRoot.trim()
    }
    if (raw.theme && THEME_MODES.includes(raw.theme)) current.theme = raw.theme
    if (typeof raw.accent === 'string' && ACCENT_KEYS.includes(raw.accent)) {
      current.accent = raw.accent
    }
    if (typeof raw.musicVolume === 'number' && Number.isFinite(raw.musicVolume)) {
      current.musicVolume = Math.min(1, Math.max(0, raw.musicVolume))
    }
    if (typeof raw.musicMuted === 'boolean') current.musicMuted = raw.musicMuted
    if (raw.musicQueue !== undefined) {
      const queue = normalizeMusicQueue(raw.musicQueue)
      current.musicQueue = queue.length ? queue : undefined
      current.musicQueueIndex = queue.length ? clampQueueIndex(raw.musicQueueIndex, queue.length) : undefined
      current.musicQueueTime = queue.length ? clampQueueTime(raw.musicQueueTime) : 0
    }
    if (isPlayMode(raw.musicMode)) current.musicMode = raw.musicMode
    if (raw.lastDirs && typeof raw.lastDirs === 'object') {
      const dirs: Record<string, string> = {}
      for (const [key, value] of Object.entries(raw.lastDirs)) {
        if (typeof value === 'string' && value.trim()) dirs[key] = value.trim()
      }
      current.lastDirs = dirs
    }
    // 旧版本只存过图片保存目录
    if (typeof raw.lastImageDir === 'string' && raw.lastImageDir.trim()) {
      if (!current.lastDirs) current.lastDirs = {}
      if (!current.lastDirs.image) current.lastDirs.image = raw.lastImageDir.trim()
    }
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT'
    if (!missing) {
      console.error('[settings] 读取本机设置失败，已备份损坏文件并使用默认设置', err)
      // 文件损坏时先另存一份，避免默认值直接覆盖用户的下载目录 / 缓存目录
      await rename(settingsPath(), `${settingsPath()}.broken-${Date.now()}`).catch(() => undefined)
    } else if (await isFirstRun()) {
      // 全新安装：下载 / 缓存默认放到 D:\laozheng，老用户（已有 data.json 等）不受影响
      await applyFirstRunRoots()
    }
    await saveSettings()
    return
  }
}

export async function setDownloadRoot(root: string): Promise<string> {
  const next = root.trim()
  if (!next) throw new Error('下载目录不能为空')
  current.downloadRoot = next
  await saveSettings()
  return current.downloadRoot
}

export async function setUiSettings(input: Partial<UiSettings>): Promise<UiSettings> {
  if (input.theme && THEME_MODES.includes(input.theme)) current.theme = input.theme
  if (typeof input.accent === 'string' && ACCENT_KEYS.includes(input.accent)) {
    current.accent = input.accent
  }
  if (typeof input.musicVolume === 'number' && Number.isFinite(input.musicVolume)) {
    current.musicVolume = Math.min(1, Math.max(0, input.musicVolume))
  }
  if (typeof input.musicMuted === 'boolean') current.musicMuted = input.musicMuted
  if (input.musicQueue !== undefined) {
    const queue = normalizeMusicQueue(input.musicQueue)
    current.musicQueue = queue.length ? queue : undefined
    current.musicQueueIndex = queue.length
      ? clampQueueIndex(input.musicQueueIndex, queue.length)
      : undefined
    current.musicQueueTime = queue.length ? clampQueueTime(input.musicQueueTime) : 0
  }
  if (isPlayMode(input.musicMode)) current.musicMode = input.musicMode
  await saveSettings()
  return uiSettings()
}

async function saveSettings(): Promise<void> {
  const path = settingsPath()
  await mkdir(app.getPath('userData'), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(current, null, 2), 'utf8')
  await rename(tmp, path)
}
