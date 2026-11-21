import type { GlassEffect, ThemeMode, UiSettings } from '../shared/settings'

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

/** 毛玻璃开关（开启后由透明度滑杆控制通透度） */
export const GLASS_OPTIONS: { key: GlassEffect; label: string }[] = [
  { key: 'on', label: '开' },
  { key: 'off', label: '关' }
]

/** 兼容测试版本写入的 soft / standard：除 off 外一律按开启处理 */
function normalizeGlassEffect(value: unknown): GlassEffect {
  return value === 'off' ? 'off' : 'on'
}

/** 透明度滑杆默认值：数值越大越通透 */
export const DEFAULT_GLASS_TRANSPARENCY = 50

/** 把 0~100 的透明度换算成玻璃表面实际 alpha（0 → 实色，100 → 很通透） */
export function glassAlphaValue(transparency: number): number {
  const value = Number.isFinite(transparency)
    ? Math.min(100, Math.max(0, transparency))
    : DEFAULT_GLASS_TRANSPARENCY
  return Number((1 - (value / 100) * 0.72).toFixed(3))
}

/** 窗口底板 alpha：比面板更不透明一点，保证正文可读；100 时仍能明显透出桌面 */
export function windowAlphaValue(transparency: number): number {
  const value = Number.isFinite(transparency)
    ? Math.min(100, Math.max(0, transparency))
    : DEFAULT_GLASS_TRANSPARENCY
  return Number((1 - (value / 100) * 0.62).toFixed(3))
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  theme: 'system',
  accent: 'purple',
  glassEffect: 'on',
  glassTransparency: DEFAULT_GLASS_TRANSPARENCY
}

const CACHE_KEY = 'laozheng-ui-settings'

let mediaCleanup: (() => void) | null = null

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** 立即把主题写到 <html> 上（data-theme = light/dark，data-accent = 主题色，data-glass = 毛玻璃档位） */
export function applyUiSettings(settings: UiSettings): void {
  const root = document.documentElement
  root.dataset.accent = settings.accent
  root.dataset.theme = resolveTheme(settings.theme)
  // 主进程还是旧版本 / 旧缓存没有该字段时按开启处理，避免 data-glass="undefined" 让开关失效
  root.dataset.glass = normalizeGlassEffect(settings.glassEffect)
  const transparency = Number.isFinite(settings.glassTransparency)
    ? settings.glassTransparency
    : DEFAULT_GLASS_TRANSPARENCY
  root.style.setProperty('--glass-alpha', String(glassAlphaValue(transparency)))
  // 关闭毛玻璃时窗口底板保持实色，避免出现「能看到桌面但没有模糊」的割裂效果
  root.style.setProperty(
    '--window-alpha',
    String(root.dataset.glass === 'off' ? 1 : windowAlphaValue(transparency))
  )

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
      if (typeof parsed.glassEffect === 'string') {
        settings = { ...settings, glassEffect: normalizeGlassEffect(parsed.glassEffect) }
      }
      if (typeof parsed.glassTransparency === 'number' && Number.isFinite(parsed.glassTransparency)) {
        settings = { ...settings, glassTransparency: parsed.glassTransparency }
      }
    }
  } catch {
    // 缓存损坏时用默认值
  }
  applyUiSettings(settings)
  return settings
}

/** 兜底归一化：旧主进程 / 旧缓存缺少新字段时不让 UI 拿到 undefined */
function normalizeUiSettings(input: UiSettings): UiSettings {
  const transparency = Number.isFinite(input.glassTransparency)
    ? Math.min(100, Math.max(0, Math.round(input.glassTransparency)))
    : DEFAULT_GLASS_TRANSPARENCY
  return {
    ...input,
    glassEffect: normalizeGlassEffect(input.glassEffect),
    glassTransparency: transparency
  }
}

/** 从主进程读取本机设置并应用；失败时沿用缓存值 */
export async function syncUiSettings(): Promise<UiSettings> {
  try {
    const settings = normalizeUiSettings(await window.laozheng.getUiSettings())
    applyUiSettings(settings)
    return settings
  } catch {
    return applyCachedUiSettings()
  }
}

export async function saveUiSettings(input: Partial<UiSettings>): Promise<UiSettings> {
  const next = normalizeUiSettings(await window.laozheng.setUiSettings(input))
  applyUiSettings(next)
  return next
}
