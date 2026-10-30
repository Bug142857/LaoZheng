import type { ThemeMode, UiSettings } from '../shared/settings'

/** 主题色（与手机端一致的一组强调色，默认紫） */
export const ACCENT_OPTIONS: { key: string; label: string; color: string }[] = [
  { key: 'purple', label: '紫', color: '#8b7cff' },
  { key: 'green', label: '墨绿', color: '#4fd1a5' },
  { key: 'blue', label: '蓝', color: '#5aa9ff' },
  { key: 'cyan', label: '青', color: '#4fd6d9' },
  { key: 'orange', label: '橙', color: '#f2a65a' },
  { key: 'pink', label: '粉', color: '#f07aa8' }
]

export const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
  { key: 'system', label: '跟随系统' },
  { key: 'light', label: '浅色' },
  { key: 'dark', label: '深色' }
]

export const DEFAULT_UI_SETTINGS: UiSettings = { theme: 'system', accent: 'purple' }

const CACHE_KEY = 'laozheng-ui-settings'

let mediaCleanup: (() => void) | null = null

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** 立即把主题写到 <html> 上（data-theme = light/dark，data-accent = 主题色） */
export function applyUiSettings(settings: UiSettings): void {
  const root = document.documentElement
  root.dataset.accent = settings.accent
  root.dataset.theme = resolveTheme(settings.theme)

  mediaCleanup?.()
  mediaCleanup = null
  if (settings.theme === 'system') {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const handler = (): void => {
      root.dataset.theme = resolveTheme('system')
    }
    media.addEventListener('change', handler)
    mediaCleanup = () => media.removeEventListener('change', handler)
  }

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(settings))
  } catch {
    // 本地缓存失败不影响主题生效
  }
}

/** 启动时先读本地缓存同步应用，避免深色闪一下再变浅色 */
export function applyCachedUiSettings(): UiSettings {
  let settings = DEFAULT_UI_SETTINGS
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UiSettings>
      if (parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system') {
        settings = { ...settings, theme: parsed.theme }
      }
      if (typeof parsed.accent === 'string' && ACCENT_OPTIONS.some((a) => a.key === parsed.accent)) {
        settings = { ...settings, accent: parsed.accent }
      }
    }
  } catch {
    // 缓存损坏时用默认值
  }
  applyUiSettings(settings)
  return settings
}

/** 从主进程读取本机设置并应用；失败时沿用缓存值 */
export async function syncUiSettings(): Promise<UiSettings> {
  try {
    const settings = await window.laozheng.getUiSettings()
    applyUiSettings(settings)
    return settings
  } catch {
    return applyCachedUiSettings()
  }
}

export async function saveUiSettings(input: Partial<UiSettings>): Promise<UiSettings> {
  const next = await window.laozheng.setUiSettings(input)
  applyUiSettings(next)
  return next
}
