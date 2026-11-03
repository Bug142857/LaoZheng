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
  theme: ThemeMode
  accent: string
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

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function defaultDownloadRoot(): string {
  return join(app.getPath('downloads'), '老郑分享')
}

let current: AppSettings = {
  downloadRoot: defaultDownloadRoot(),
  theme: 'system',
  accent: 'purple'
}

export function downloadRoot(): string {
  return current.downloadRoot
}

export function uiSettings(): UiSettings {
  return { theme: current.theme, accent: current.accent }
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
    lastDirs: current.lastDirs ? { ...current.lastDirs } : undefined
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
  if (changed) await saveSettings()
}

export async function initSettings(): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(settingsPath(), 'utf8')) as Partial<AppSettings>
    if (typeof raw.downloadRoot === 'string' && raw.downloadRoot.trim()) {
      current.downloadRoot = raw.downloadRoot.trim()
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
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[settings] 读取本机设置失败，使用默认下载目录', err)
    }
    await saveSettings()
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
