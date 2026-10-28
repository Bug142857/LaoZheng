import { BrowserWindow, session } from 'electron'
import { parse } from 'node-html-parser'
import { getCredentials, setAccountStatus } from './accounts'
import type {
  GameAttr,
  GameBlock,
  GameCategoriesResponse,
  GameCategory,
  GameDetail,
  GameDetailResponse,
  GameDownload,
  GameItem,
  GameListResponse,
  GameResolveResponse
} from '../src/shared/wygamer'

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

/* ==================== 游戏库（列表 / 搜索 / 分类 / 详情 / 网盘链接） ==================== */

/** 封面占位图文件名，出现即代表该 img 没有真实图 */
const PLACEHOLDER = 'thumbnail-lg.svg'

function absUrl(raw: string, base = `${BASE}/`): string {
  const value = raw.trim()
  if (!value) return ''
  try {
    return new URL(value, base).toString()
  } catch {
    return ''
  }
}

/** 走 persist:wygamer 分区的请求（自动带登录 Cookie） */
async function fetchText(url: string): Promise<string> {
  const res = await wygamerSession().fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: `${BASE}/`
    },
    signal: AbortSignal.timeout(25_000)
  })
  if (!res.ok) throw new Error(`站点返回 HTTP ${res.status}`)
  const html = await res.text()
  if (!html.trim()) throw new Error('站点返回空内容')
  return html
}

/** 取 img 真实地址：data-src 优先（懒加载），src 是占位图时忽略 */
function realImgSrc(img: { getAttribute: (name: string) => string | null | undefined } | null): string | null {
  if (!img) return null
  const dataSrc = (img.getAttribute('data-src') ?? '').trim()
  if (dataSrc && !dataSrc.includes(PLACEHOLDER)) return absUrl(dataSrc)
  const src = (img.getAttribute('src') ?? '').trim()
  if (src && !src.includes(PLACEHOLDER)) return absUrl(src)
  return null
}

function parseList(html: string): { items: GameItem[]; lastPage: number } {
  const doc = parse(html)
  const items: GameItem[] = []
  for (const card of doc.querySelectorAll('posts.posts-item')) {
    const heading = card.querySelector('h2.item-heading a')
    const thumbLink = card.querySelector('.item-thumbnail a')
    const link = heading ?? thumbLink
    if (!link) continue
    const url = absUrl(link.getAttribute('href') ?? '')
    if (!url) continue
    const id = url.replace(/\/+$/, '').split('/').pop() ?? ''
    if (!id) continue
    const title =
      (heading?.text ?? '').trim() ||
      (card.querySelector('.item-thumbnail img')?.getAttribute('alt') ?? '').trim()
    const cover = realImgSrc(card.querySelector('.item-thumbnail img'))
    const categories = [
      ...card.querySelectorAll('.item-tags a.but.c-blue'),
      ...card.querySelectorAll('.item-tags a.but.c-green'),
      ...card.querySelectorAll('.item-tags a.but.c-yellow')
    ]
      .map((a) => a.text.trim())
      .filter((t) => t && t !== '免费资源')
    const badge =
      (card.querySelector('.item-tags a.meta-pay')?.text ?? '').trim() ||
      (card.querySelector('badge.img-badge')?.text ?? '').trim()
    items.push({
      id,
      title,
      url,
      cover,
      categories: [...new Set(categories)].slice(0, 3),
      badge: badge || null
    })
  }

  let lastPage = 0
  for (const a of doc.querySelectorAll('a[href*="/page/"]')) {
    const m = (a.getAttribute('href') ?? '').match(/\/page\/(\d+)/)
    if (m) lastPage = Math.max(lastPage, Number(m[1]) || 0)
  }
  return { items, lastPage }
}

async function listPage(url: string, page: number): Promise<GameListResponse> {
  try {
    const html = await fetchText(url)
    const parsed = parseList(html)
    const lastPage = parsed.lastPage || page
    return { ok: true, items: parsed.items, page, lastPage }
  } catch (err) {
    return { ok: false, items: [], page, lastPage: 0, error: (err as Error).message }
  }
}

/** 首页最新（page 从 1 开始） */
export async function wygamerHome(page: number): Promise<GameListResponse> {
  const p = Math.max(1, page)
  return listPage(p <= 1 ? `${BASE}/` : `${BASE}/page/${p}`, p)
}

/** 关键词搜索 */
export async function wygamerSearch(keyword: string, page: number): Promise<GameListResponse> {
  const p = Math.max(1, page)
  const q = encodeURIComponent(keyword.trim())
  return listPage(p <= 1 ? `${BASE}/?s=${q}` : `${BASE}/page/${p}?s=${q}`, p)
}

/** 分类列表（categoryUrl 为分类首页地址） */
export async function wygamerByCategory(categoryUrl: string, page: number): Promise<GameListResponse> {
  const p = Math.max(1, page)
  const base = categoryUrl.replace(/\/+$/, '')
  if (!/^https?:\/\/(www\.)?wygamer\.com\//i.test(base)) {
    return { ok: false, items: [], page: p, lastPage: 0, error: '分类地址无效' }
  }
  return listPage(p <= 1 ? `${base}/` : `${base}/page/${p}`, p)
}

/** 分类表：WP REST（带条数，按条数降序） */
export async function wygamerCategories(): Promise<GameCategoriesResponse> {
  try {
    const res = await wygamerSession().fetch(
      `${BASE}/wp-json/wp/v2/categories?per_page=40&orderby=count&order=desc`,
      {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000)
      }
    )
    if (!res.ok) return { ok: false, items: [], error: `HTTP ${res.status}` }
    const arr = (await res.json()) as unknown
    if (!Array.isArray(arr)) return { ok: false, items: [], error: '分类接口返回异常' }
    const items: GameCategory[] = []
    for (const row of arr as Record<string, unknown>[]) {
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      const slug = typeof row.slug === 'string' ? row.slug.trim() : ''
      if (!name || !slug) continue
      items.push({
        name,
        url: `${BASE}/category/${slug}/`,
        count: typeof row.count === 'number' ? row.count : 0
      })
    }
    return { ok: true, items }
  } catch (err) {
    return { ok: false, items: [], error: (err as Error).message }
  }
}

/** 详情页 */
export async function wygamerDetail(id: string): Promise<GameDetailResponse> {
  const clean = id.trim().replace(/^\/+/, '')
  if (!/^[A-Za-z0-9-_]+$/.test(clean)) return { ok: false, game: null, error: '条目编号无效' }
  try {
    const html = await fetchText(`${BASE}/${clean}`)
    const doc = parse(html)
    const title =
      (doc.querySelector('h1.article-title')?.text ?? '').trim() ||
      (doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? '').trim()
    if (!title) throw new Error('页面解析失败（可能已被删除）')

    const cover =
      realImgSrc(doc.querySelector('.single-cover img')) ||
      (doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '').trim() ||
      null

    const categories = [...new Set(
      doc
        .querySelectorAll('ul.breadcrumb li a')
        .map((a) => a.text.trim())
        .filter((t) => t && t !== '首页' && t !== '正文')
    )]

    const attrs: GameAttr[] = []
    for (const row of doc.querySelectorAll('.pay-attr div')) {
      const key = (row.querySelector('.attr-key')?.text ?? '').trim().replace(/[：:]$/, '')
      const value = (row.querySelector('.attr-value')?.text ?? '').trim()
      if (key && value) attrs.push({ key, value })
    }

    const downloads: GameDownload[] = []
    for (const a of doc.querySelectorAll('.pay-box a[href*="/pay-download/"]')) {
      const url = absUrl(a.getAttribute('href') ?? '')
      const label = a.text.trim() || '下载'
      if (url && !downloads.some((d) => d.url === url)) downloads.push({ label, url })
    }

    const screenshots: string[] = []
    for (const img of doc.querySelectorAll('.article-content .wp-block-image img')) {
      const src = realImgSrc(img)
      if (src && !screenshots.includes(src)) screenshots.push(src)
    }

    const blocks: GameBlock[] = []
    for (const el of doc.querySelectorAll('.article-content p, .article-content h1, .article-content h2, .article-content h3')) {
      const text = el.text.trim()
      if (!text) continue
      blocks.push({ isHeading: /^h[1-3]$/i.test(el.tagName), text })
    }

    let unzipPassword: string | null = null
    for (const el of doc.querySelectorAll('[data-clipboard-text]')) {
      if (!(el.getAttribute('data-clipboard-tag') ?? '').includes('密码')) continue
      const text = (el.getAttribute('data-clipboard-text') ?? '').trim()
      if (text) {
        unzipPassword = text
        break
      }
    }

    const game: GameDetail = {
      id: clean,
      title,
      cover,
      categories,
      attrs,
      downloads,
      screenshots,
      blocks,
      unzipPassword
    }
    return { ok: true, game }
  } catch (err) {
    return { ok: false, game: null, error: (err as Error).message }
  }
}

/**
 * 解析站内 pay-download 中转链接 → 网盘分享页地址（302 跳转）。
 * 若站点改成 HTML 中转，则兜底解析 meta refresh / 脚本跳转。
 */
export async function wygamerResolveDownload(payUrl: string): Promise<GameResolveResponse> {
  const ses = wygamerSession()
  // Electron 的 net.fetch 不暴露重定向后的最终地址，这里用 webRequest 捕获 302 目标
  let redirectTarget = ''
  const onRedirect = (details: Electron.OnBeforeRedirectListenerDetails): void => {
    if (!redirectTarget && details.url.includes('/pay-download/')) {
      redirectTarget = details.redirectURL
    }
  }
  ses.webRequest.onBeforeRedirect(onRedirect)
  try {
    const res = await ses.fetch(payUrl, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Referer: `${BASE}/`
      },
      signal: AbortSignal.timeout(25_000)
    })
    if (redirectTarget && !/wygamer\.com/i.test(redirectTarget)) {
      return { ok: true, url: redirectTarget }
    }
    const finalUrl = res.url
    if (finalUrl && !/wygamer\.com/i.test(finalUrl)) return { ok: true, url: finalUrl }
    const html = await res.text()
    const meta = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']([^"']+)["']/i)?.[1] ?? ''
    const fromMeta = meta.match(/url=(.+)$/i)?.[1]?.trim()
    const fromScript = html.match(/(?:location\.href|location\.replace\()\s*=?\s*["']([^"']+)["']/)?.[1]
    const target = fromMeta || fromScript
    if (target) return { ok: true, url: target }
    return { ok: false, error: '未能解析出网盘链接，请用浏览器打开' }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    ses.webRequest.onBeforeRedirect(null)
  }
}
