import { BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { JMCOMIC_SCRAMBLE_ID } from '../src/shared/jmcomic'

/**
 * 禁漫天堂（18comic）章节图打乱还原。
 *
 * 站点把 id 大于 scramble_id（当前 220980）的章节图按纵向切成 N 段后倒序存储，
 * 前端用 canvas 重排后再显示（逻辑来自站点 jquery.photo / get_num）：
 *   N 由 md5(章节 id + 页码) 的末位字符决定，2~20 段；
 *   每段高度 floor(H/N)，余数并入最下面一段，重排后该段落到最上面。
 *
 * 主进程没有 canvas，nativeImage 也不支持 webp，所以复用一个隐藏窗口做解码：
 * 把原图 base64 传进去，canvas 重排后导出 JPEG。图片缓存与下载都走这里。
 */

const MAX_CONCURRENT = 3
const DECODE_TIMEOUT_MS = 25_000

let decoderWindow: BrowserWindow | null = null
let decoderLoading: Promise<BrowserWindow> | null = null
let running = 0
const waiters: Array<() => void> = []

function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running += 1
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => waiters.push(resolve))
}

function releaseSlot(): void {
  const next = waiters.shift()
  // 直接把名额交给排队者，running 保持不变
  if (next) next()
  else running = Math.max(0, running - 1)
}

function ensureWindow(): Promise<BrowserWindow> {
  if (decoderWindow && !decoderWindow.isDestroyed()) return Promise.resolve(decoderWindow)
  if (!decoderLoading) {
    decoderLoading = (async () => {
      const win = new BrowserWindow({
        show: false,
        width: 120,
        height: 120,
        webPreferences: {
          offscreen: true,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      })
      await win.loadURL('data:text/html,<meta charset="utf-8"><body></body>')
      win.on('closed', () => {
        if (decoderWindow === win) decoderWindow = null
      })
      decoderWindow = win
      return win
    })().finally(() => {
      decoderLoading = null
    })
  }
  return decoderLoading
}

interface JmPhotoUrl {
  id: number
  page: string
}

/** 从 /media/photos/<章节id>/<页码>.webp 里取章节 id 与页码 */
function parseJmPhotoUrl(url: string): JmPhotoUrl | null {
  let pathname = ''
  try {
    pathname = new URL(url).pathname
  } catch {
    return null
  }
  const matched = /\/media\/photos\/(\d+)\/([^/?#]+)$/i.exec(pathname)
  if (!matched) return null
  const id = Number(matched[1])
  if (!Number.isFinite(id) || id <= 0) return null
  let name = matched[2]
  try {
    name = decodeURIComponent(name)
  } catch {
    // 保留原始文件名
  }
  if (/\.gif$/i.test(name)) return null
  let page = name.replace(/\.[^.]+$/, '')
  if (page.includes('next')) page = page.split('_').pop() ?? page
  if (!page) return null
  return { id, page }
}

/** 是否是禁漫需要重排的章节图（封面 / 老章节不处理） */
export function jmImageNeedsDescramble(url: string): boolean {
  const parsed = parseJmPhotoUrl(url)
  return !!parsed && parsed.id >= JMCOMIC_SCRAMBLE_ID
}

/** 与站点 get_num 一致：按 md5 末位字符决定切多少段 */
function bandCount(id: number, page: string): number {
  const last = createHash('md5').update(`${id}${page}`).digest('hex').slice(-1)
  let code = last.charCodeAt(0)
  if (id >= 268850 && id <= 421925) code %= 10
  else if (id >= 421926) code %= 8
  const table = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
  return table[code] ?? 10
}

/** 还原一张禁漫章节图；失败返回 null（调用方保留原字节） */
export async function descrambleJmImage(url: string, data: Buffer): Promise<Buffer | null> {
  const parsed = parseJmPhotoUrl(url)
  if (!parsed || parsed.id < JMCOMIC_SCRAMBLE_ID || !data.length) return null
  const bands = bandCount(parsed.id, parsed.page)
  if (bands <= 1) return null
  await acquireSlot()
  try {
    const win = await ensureWindow()
    if (win.isDestroyed()) return null
    const base64 = data.toString('base64')
    const script = `(async () => {
      const img = new Image()
      img.src = 'data:image/webp;base64,${base64}'
      await img.decode()
      const w = img.naturalWidth, h = img.naturalHeight, n = ${bands}
      if (!w || !h || h < n) return null
      const base = Math.floor(h / n), extra = h % n
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      for (let g = 0; g < n; g++) {
        let bandHeight = base
        let destY = base * g
        const srcY = h - base * (g + 1) - extra
        if (g === 0) bandHeight += extra
        else destY += extra
        ctx.drawImage(img, 0, srcY, w, bandHeight, 0, destY, w, bandHeight)
      }
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      return dataUrl.startsWith('data:image/jpeg;base64,') ? dataUrl : null
    })()`
    const result = (await Promise.race([
      win.webContents.executeJavaScript(script),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), DECODE_TIMEOUT_MS))
    ])) as string | null
    if (!result) return null
    return Buffer.from(result.split(',')[1] ?? '', 'base64')
  } catch {
    return null
  } finally {
    releaseSlot()
  }
}
