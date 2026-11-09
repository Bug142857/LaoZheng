import { BrowserWindow, session } from 'electron'

/**
 * 隐藏浏览器取页：部分站点（神书网搜索 / 正文、漫画客章节图）会拦 Node 请求，
 * 但允许 Chromium 正常加载。这里复用一个隐藏窗口串行导航，避免频繁开关窗口
 * 触发站点风控，也避免上一次加载没结束时新页面互相打断。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const PARTITION = 'persist:laozheng-hidden'
const LOAD_TIMEOUT = 12_000

export interface HiddenPageOptions {
  /** 页面加载完成后再等多久（毫秒） */
  waitMs?: number
}

let sharedWindow: BrowserWindow | null = null
let queue: Promise<unknown> = Promise.resolve()

function ensureWindow(): BrowserWindow {
  if (sharedWindow && !sharedWindow.isDestroyed()) return sharedWindow
  const ses = session.fromPartition(PARTITION)
  ses.setUserAgent(UA)
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { partition: PARTITION, sandbox: false, backgroundThrottling: false }
  })
  win.on('closed', () => {
    if (sharedWindow === win) sharedWindow = null
  })
  sharedWindow = win
  return win
}

async function navigate(url: string, waitMs = 600): Promise<BrowserWindow> {
  const task = queue.then(async () => {
    const win = ensureWindow()
    try {
      win.webContents.stop()
      await Promise.race([
        win.loadURL(url, { userAgent: UA }).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, LOAD_TIMEOUT))
      ])
    } catch {
      // 加载失败也让调用方自己判断页面内容
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, waitMs)))
    return win
  })
  queue = task.catch(() => undefined)
  return task
}

export async function fetchRenderedHtml(
  url: string,
  options: HiddenPageOptions = {}
): Promise<string> {
  const win = await navigate(url, options.waitMs ?? 600)
  return win.webContents.executeJavaScript('document.documentElement.outerHTML')
}

/** 在隐藏窗口里执行一段读取脚本（用于需要等 JS 渲染出节点后再取数据） */
export async function evaluateRenderedPage<T>(
  url: string,
  script: string,
  options: HiddenPageOptions = {}
): Promise<T> {
  const win = await navigate(url, options.waitMs ?? 600)
  return (await win.webContents.executeJavaScript(script)) as T
}
