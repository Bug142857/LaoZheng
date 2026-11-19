import { screen, type Rectangle } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * 窗口位置 / 尺寸记忆：关闭或调整后防抖保存，启动时校验显示器区域，
 * 拔掉外接显示器后不会把窗口恢复到屏幕外；最大化状态单独保存。
 */

export interface WindowState {
  bounds?: Rectangle
  maximized?: boolean
}

const MIN_VISIBLE = 120

function intersects(a: Rectangle, b: Rectangle): boolean {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width >= MIN_VISIBLE && height >= MIN_VISIBLE
}

/** 校验 bounds 是否落在任一显示器的工作区内；无效时返回 undefined 用默认尺寸 */
export function clampWindowBounds(bounds: Rectangle | undefined): Rectangle | undefined {
  if (!bounds) return undefined
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height)
  ) {
    return undefined
  }
  if (bounds.width < 800 || bounds.height < 500) return undefined
  const displays = screen.getAllDisplays()
  if (!displays.some((display) => intersects(bounds, display.workArea))) return undefined
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  }
}

export async function loadWindowState(file: string): Promise<WindowState> {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as WindowState
    const bounds = raw.bounds
    return {
      bounds: bounds
        ? clampWindowBounds({
            x: Number(bounds.x),
            y: Number(bounds.y),
            width: Number(bounds.width),
            height: Number(bounds.height)
          })
        : undefined,
      maximized: raw.maximized === true
    }
  } catch {
    return {}
  }
}

export async function saveWindowState(file: string, state: WindowState): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
  await rename(tmp, file)
}
