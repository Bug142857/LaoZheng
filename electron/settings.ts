import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ThemeMode, UiSettings } from '../src/shared/settings'
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
  /**
   * 各类文件对话框上次选择的目录：
   * data / vod / live / magnet / image / downloadRoot
   */
  lastDirs?: Record<string, string>
  /** 旧字段：上次保存图片的目录，读取时迁移到 lastDirs.image */
  lastImageDir?: string
  /** 侧栏导航顺序（share / optimize 两套树各自保存模块 key） */
  navOrder?: Record<string, string[]>
  /** 导航顺序迁移版本：旧版本把「图书」排在「漫画 / 本子」上面，升级后一次性纠正 */
  navOrderVersion?: number
}

const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark']
const ACCENT_KEYS = ['purple', 'green', 'blue', 'cyan', 'orange', 'pink']
const NAV_ORDER_VERSION = 1

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function defaultDownloadRoot(): string {
  return join(app.getPath('downloads'), '老郑分享')
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
  return { theme: current.theme, accent: current.accent }
}

export function navOrderSettings(): Record<string, string[]> {
  return current.navOrder ? { ...current.navOrder } : {}
}

/** 旧版保存的顺序把「图书」排在「漫画 / 本子」上面：一次性把漫画、本子挪到图书前面 */
function upgradeNavOrder(order: Record<string, string[]>): Record<string, string[]> {
  const share = order.share
  if (!share?.length) return order
  const bookAt = share.indexOf('book')
  const comics = ['comic', 'bika'].filter((key) => share.includes(key))
  if (bookAt < 0 || !comics.length || comics.every((key) => share.indexOf(key) < bookAt)) {
    return order
  }
  const rest = share.filter((key) => key !== 'comic' && key !== 'bika')
  const insertAt = rest.indexOf('book')
  return {
    ...order,
    share: [...rest.slice(0, insertAt), ...comics, ...rest.slice(insertAt)]
  }
}

/** 保存某个导航树的顺序；只接受字符串数组，避免把坏数据写进设置 */
export async function setNavOrder(input: Record<string, string[]>): Promise<void> {
  const next: Record<string, string[]> = {}
  for (const [tree, keys] of Object.entries(input ?? {})) {
    if (!Array.isArray(keys)) continue
    next[tree] = keys.filter((key): key is string => typeof key === 'string').slice(0, 100)
  }
  current.navOrder = next
  await saveSettings()
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
    navOrder: current.navOrder ? { ...current.navOrder } : undefined
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
    current.downloadRoot = input.downloadRoot.trim()
    changed = true
  }
  if (input.lastDirs && typeof input.lastDirs === 'object') {
    if (!current.lastDirs) current.lastDirs = {}
    for (const [key, value] of Object.entries(input.lastDirs)) {
      if (typeof value !== 'string' || !value.trim()) continue
      current.lastDirs[key] = value.trim()
      changed = true
    }
  }
  // 旧备份只有 lastImageDir
  if (typeof input.lastImageDir === 'string' && input.lastImageDir.trim()) {
    if (!current.lastDirs) current.lastDirs = {}
    current.lastDirs.image = input.lastImageDir.trim()
    changed = true
  }
  if (input.navOrder && typeof input.navOrder === 'object') {
    const next: Record<string, string[]> = {}
    for (const [tree, keys] of Object.entries(input.navOrder)) {
      if (!Array.isArray(keys)) continue
      next[tree] = keys.filter((key): key is string => typeof key === 'string').slice(0, 100)
    }
    if (Object.keys(next).length) {
      current.navOrder = upgradeNavOrder(next)
      changed = true
    }
  }
  if (changed) await saveSettings()
}

export async function initSettings(): Promise<void> {
  let migrated = false
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
    if (raw.navOrder && typeof raw.navOrder === 'object') {
      const order: Record<string, string[]> = {}
      for (const [tree, keys] of Object.entries(raw.navOrder)) {
        if (!Array.isArray(keys)) continue
        const list = keys.filter((key): key is string => typeof key === 'string')
        if (list.length) order[tree] = list.slice(0, 100)
      }
      current.navOrder = order
    }
    if ((raw.navOrderVersion ?? 0) < NAV_ORDER_VERSION) {
      if (current.navOrder) current.navOrder = upgradeNavOrder(current.navOrder)
      current.navOrderVersion = NAV_ORDER_VERSION
      migrated = true
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[settings] 读取本机设置失败，使用默认下载目录', err)
    }
    await saveSettings()
    return
  }
  if (migrated) await saveSettings()
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
