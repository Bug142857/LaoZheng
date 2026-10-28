import { BrowserWindow, session } from 'electron'
import { getCredentials, setAccountStatus } from './accounts'

/**
 * 无忧游戏（wygamer.com，WordPress + Zibll 主题）自动登录。
 *
 * 该站登录按钮会弹出「滑动拼图」验证：
 * - 拼图偏移量在前端实例 `x` 上，校验仅比对滑动距离，验证通过后前端自动重新提交；
 * - 因此用隐藏窗口填表 + 合成 pointer 事件拖动滑块，即可全自动完成；
 * - 登录成功后 Cookie 存在 persist:wygamer 分区，应用重启自动恢复，无需再次登录。
 */

const BASE = 'https://www.wygamer.com'
const PARTITION = 'persist:wygamer'
const LOGIN_URL = `${BASE}/user-sign-2?tab=signin`
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

let loginWindow: BrowserWindow | null = null
let running = false

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function wygamerSession() {
  return session.fromPartition(PARTITION)
}

async function hasLoginCookie(): Promise<boolean> {
  try {
    const cookies = await wygamerSession().cookies.get({ url: `${BASE}/` })
    return cookies.some((c) => c.name.startsWith('wordpress_logged_in_'))
  } catch {
    return false
  }
}

/** true=已登录；false=确认未登录；null=网络异常无法判断 */
export async function wygamerSessionOk(): Promise<boolean | null> {
  if (!(await hasLoginCookie())) return false
  try {
    const res = await wygamerSession().fetch(`${BASE}/`, { headers: { 'User-Agent': UA } })
    if (!res.ok) return null
    const html = await res.text()
    if (/<body[^>]*class="[^"]*\blogged-in\b/.test(html) || html.includes('action=logout')) {
      return true
    }
    if (html.includes('wp-theme-')) return false
    return null
  } catch {
    return null
  }
}

/** 启动时调用：会话有效直接复用，失效则自动登录（全程无感） */
export async function wygamerEnsureLogin(force = false): Promise<boolean> {
  if (!force) {
    const state = await wygamerSessionOk()
    if (state === true) {
      setAccountStatus('wygamer', 'ok', '已登录（会话已恢复）')
      return true
    }
    if (state === null) {
      setAccountStatus('wygamer', 'unknown', '网络不通，用到时会自动重试')
      return false
    }
  }
  return autoLogin(false)
}

/**
 * 自动登录。visible=true 时窗口可见（自动失败可用于手动兜底），否则隐藏窗口静默完成。
 */
export async function autoLogin(visible: boolean): Promise<boolean> {
  if (running) return hasLoginCookie()
  running = true
  setAccountStatus('wygamer', 'pending', '正在自动登录…')
  try {
    const creds = getCredentials('wygamer')
    if (!creds) {
      setAccountStatus('wygamer', 'failed', '未内置无忧账号')
      return false
    }

    if (await hasLoginCookie()) {
      setAccountStatus('wygamer', 'ok', '已登录（会话已恢复）')
      return true
    }

    if (!loginWindow || loginWindow.isDestroyed()) {
      loginWindow = new BrowserWindow({
        width: 1080,
        height: 780,
        show: visible,
        title: '无忧游戏 · 登录',
        backgroundColor: '#ffffff',
        webPreferences: {
          partition: PARTITION,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      })
      loginWindow.on('closed', () => {
        loginWindow = null
      })
    } else if (visible) {
      loginWindow.show()
    }

    const win = loginWindow
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await win.loadURL(LOGIN_URL)
      } catch {
        await sleep(800)
        continue
      }
      await sleep(2200)
      if (win.isDestroyed()) return false

      const filled = await fillAndSubmit(win, creds.username, creds.password)
      if (!filled) {
        await sleep(1200)
        continue
      }

      const solved = await solveSlider(win)
      if (solved && (await waitLoginCookie(12_000))) {
        setAccountStatus('wygamer', 'ok', `已自动登录（${creds.username}）`)
        if (!visible && !win.isDestroyed()) win.destroy()
        if (visible && !win.isDestroyed()) {
          setTimeout(() => {
            if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close()
          }, 1200)
        }
        return true
      }
      await sleep(600)
    }

    if (visible && !win.isDestroyed()) {
      setAccountStatus('wygamer', 'failed', '自动验证未通过，请在打开的窗口中手动滑动一次')
      win.show()
    } else {
      if (!win.isDestroyed()) win.destroy()
      setAccountStatus('wygamer', 'failed', '自动登录失败（可点「打开登录窗口」重试）')
    }
    return false
  } catch (err) {
    setAccountStatus('wygamer', 'failed', `自动登录失败：${(err as Error).message}`)
    return false
  } finally {
    running = false
  }
}

/** 打开可见登录窗口（自动尝试一次，失败则留给用户手动滑动） */
export async function openWygamerLogin(): Promise<void> {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.show()
    loginWindow.focus()
    return
  }
  await autoLogin(true)
}

async function fillAndSubmit(win: BrowserWindow, username: string, password: string): Promise<boolean> {
  if (win.isDestroyed()) return false
  const user = JSON.stringify(username)
  const pass = JSON.stringify(password)
  try {
    const result = (await win.webContents.executeJavaScript(`(() => {
      const pane = document.querySelector('#tab-signin-pas')
      if (!pane) return 'no-pane'
      const u = pane.querySelector('input[name="username"]')
      const p = pane.querySelector('input[name="password"]')
      if (!u || !p) return 'no-input'
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(u, ${user}); u.dispatchEvent(new Event('input', { bubbles: true }))
      setter.call(p, ${pass}); p.dispatchEvent(new Event('input', { bubbles: true }))
      const btn = pane.querySelector('.signsubmit-loader')
      if (!btn) return 'no-button'
      btn.click()
      return 'ok'
    })()`)) as string
    return result === 'ok'
  } catch {
    return false
  }
}

/** 等拼图就绪后，按缺口偏移量合成拖动，触发站点自身的前端校验 */
async function solveSlider(win: BrowserWindow): Promise<boolean> {
  if (win.isDestroyed()) return false
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    if (win.isDestroyed()) return false
    try {
      const state = (await win.webContents.executeJavaScript(`(() => {
        const $ = window.jQuery
        if (!$) return null
        const inst = $('.slidercaptcha').data('lgb.SliderCaptcha')
        if (!inst || typeof inst.x !== 'number') return null
        if (!window.captcha || !window.captcha.token) return null
        return { x: inst.x, width: inst.options.width }
      })()`)) as { x: number; width: number } | null
      if (!state) {
        await sleep(400)
        continue
      }
      const dragged = (await win.webContents.executeJavaScript(`(() => {
        const $ = window.jQuery
        const inst = $('.slidercaptcha').data('lgb.SliderCaptcha')
        const box = document.querySelector('.slidercaptcha')
        const slider = document.querySelector('.captcha-slider')
        if (!inst || !box || !slider) return false
        const rect = slider.getBoundingClientRect()
        const startX = rect.left + rect.width / 2
        const startY = rect.top + rect.height / 2
        const ratio = (inst.options.width - 60) / (inst.options.width - 40)
        const distance = Math.round(inst.x / ratio)
        const fire = (type, x, y, target) => {
          const ev = new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1
          })
          ;(target || box).dispatchEvent(ev)
        }
        fire('pointerdown', startX, startY, slider)
        const steps = 26
        for (let i = 1; i <= steps; i++) {
          const p = i / steps
          fire('pointermove', startX + distance * p, startY + (i % 2 ? 1 : -1) * (i % 3))
        }
        fire('pointerup', startX + distance, startY)
        return document.querySelector('.sliderContainer').className.includes('success')
      })()`)) as boolean
      if (dragged) return true
      await sleep(800)
    } catch {
      await sleep(500)
    }
  }
  return false
}

async function waitLoginCookie(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await hasLoginCookie()) return true
    await sleep(600)
  }
  return false
}
