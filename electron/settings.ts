import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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
  /** 上次保存图片选择的位置（再次保存时默认打开这里） */
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

export function lastImageDir(): string {
  return current.lastImageDir ?? ''
}

/** 备份用的本机设置快照（下载目录 / 主题 / 上次保存图片位置） */
export function settingsSnapshot(): BackupSettings {
  return {
    theme: current.theme,
    accent: current.accent,
    downloadRoot: current.downloadRoot,
    lastImageDir: current.lastImageDir
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
  if (typeof input.lastImageDir === 'string') {
    current.lastImageDir = input.lastImageDir.trim()
    changed = true
  }
  if (changed) await saveSettings()
}

export async function setLastImageDir(dir: string): Promise<void> {
  const next = dir.trim()
  if (!next || next === current.lastImageDir) return
  current.lastImageDir = next
  await saveSettings()
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
    if (typeof raw.lastImageDir === 'string' && raw.lastImageDir.trim()) {
      current.lastImageDir = raw.lastImageDir.trim()
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
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(current, null, 2), 'utf8')
  await rename(tmp, path)
}
