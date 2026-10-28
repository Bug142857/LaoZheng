import { BrowserWindow, session } from 'electron'
import { mkdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { downloadsRoot, registerLocalFile } from './downloads'
import type {
  ZlibBook,
  ZlibDetailResponse,
  ZlibDownloadResponse,
  ZlibLoginResult,
  ZlibSearchResponse,
  ZlibStatusResponse
} from '../src/shared/zlib'

/**
 * Z-Library 客户端（eapi 协议）。
 *
 * 站点全站 DiamWall 反爬：纯 HTTP 请求会被 307 + 5 分钟期票据拦到挑战页，
 * 只有真浏览器引擎完成页面内 JS 证明后才能访问接口。因此：
 * - 常驻一个隐藏 BrowserWindow（persist:zlib 分区），接口通过页面内 fetch 请求；
 * - 登录打开可见窗口，用户登录后 Cookie 落在同一分区，后续搜索 / 下载自动复用；
 * - 书籍下载走站点自己的 /dl/{token} 入口，由 Electron 下载器保存到「老郑分享/图书」。
 */

const PARTITION = 'persist:zlib'
const DAILY_PAGE = 'https://getzlib.com/zh'
const FALLBACK_HOSTS = ['z-lib.sk', 'zh.z-lib.sk']
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

let hidden: BrowserWindow | null = null
let loginWindow: BrowserWindow | null = null
let loadedHost = ''
let hostsCache: { hosts: string[]; at: number } | null = null

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function zlibSession() {
  const ses = session.fromPartition(PARTITION)
  ses.setUserAgent(UA)
  return ses
}

function isZlibHost(host: string): boolean {
  const h = host.toLowerCase()
  return h.includes('z-lib') || h.startsWith('zlib.') || h.includes('.zlib.')
}

/** 站点每日换域名：优先用 getzlib.com 当日列表，失败时回退内置地址 */
async function candidateHosts(): Promise<string[]> {
  if (hostsCache && Date.now() - hostsCache.at < 10 * 60 * 1000) return hostsCache.hosts
  const fallback = [...FALLBACK_HOSTS]
  try {
    const res = await zlibSession().fetch(DAILY_PAGE, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: AbortSignal.timeout(10_000)
    })
    if (res.ok) {
      const html = await res.text()
      const hosts: string[] = []
      for (const m of html.matchAll(/https:\/\/([a-z0-9.-]+)\//gi)) {
        const host = m[1].toLowerCase().replace(/\.$/, '')
        if (!isZlibHost(host)) continue
        if (!hosts.includes(host)) hosts.push(host)
      }
      const expanded: string[] = []
      for (const host of hosts.slice(0, 3)) {
        const bare = host.replace(/^zh\./, '')
        for (const item of [host, `zh.${bare}`, bare]) {
          if (isZlibHost(item) && !expanded.includes(item)) expanded.push(item)
        }
      }
      if (expanded.length) {
        hostsCache = { hosts: expanded, at: Date.now() }
        return expanded
      }
    }
  } catch {
    // 解析失败时用内置线路
  }
  hostsCache = { hosts: fallback, at: Date.now() + 5 * 60 * 1000 }
  return fallback
}

async function hasSession(host: string): Promise<boolean> {
  try {
    const cookies = await zlibSession().cookies.get({ url: `https://${host}/` })
    return cookies.some((c) => c.name === 'remix_userkey' && !!c.value)
  } catch {
    return false
  }
}

async function preferredHost(): Promise<string> {
  const hosts = await candidateHosts()
  for (const host of hosts) {
    if (await hasSession(host)) return host
  }
  return hosts[0]
}

/** 常驻隐藏窗口：打开站点首页，等页面可用后再在页面里发请求 */
async function ensureWindow(host: string): Promise<BrowserWindow> {
  if (!hidden || hidden.isDestroyed()) {
    hidden = new BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    hidden.on('closed', () => {
      hidden = null
      loadedHost = ''
    })
  }
  const win = hidden
  if (loadedHost === host) return win
  try {
    await win.loadURL(`https://${host}/`)
  } catch {
    // 站点可能先重定向到挑战页，后面按 readyState 轮询
  }
  loadedHost = host
  await waitUsable(win)
  return win
}

/** 等文档提交且 readyState 脱离 loading（首页本身较慢，最多等 20s） */
async function waitUsable(win: BrowserWindow, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (win.isDestroyed()) return false
    try {
      const state = (await win.webContents.executeJavaScript(
        "(document.readyState||'')+'|'+(location.host||'')"
      )) as string
      const [ready, host] = state.split('|')
      if (ready && ready !== 'loading' && host) return true
    } catch {
      // 导航中执行脚本可能失败，稍后重试
    }
    await sleep(250)
  }
  return false
}

function isChallenge(text: string): boolean {
  const t = text.trimStart()
  return (
    t.startsWith('<') ||
    text.includes('DiamWall') ||
    text.includes('Verifying your browser')
  )
}

/** 页面内 fetch：相对路径自动同源，站点换域也不会跨域失败 */
async function inPageFetch(win: BrowserWindow, path: string, form: string | null): Promise<string> {
  const init = form
    ? {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: form
      }
    : {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      }
  const js = `(async () => {
    try {
      const res = await fetch(${JSON.stringify(path)}, ${JSON.stringify(init)})
      return await res.text()
    } catch (err) {
      return '__ERR__' + (err && err.message ? err.message : err)
    }
  })()`
  const out = (await win.webContents.executeJavaScript(js)) as unknown
  const text = typeof out === 'string' ? out : ''
  if (text.startsWith('__ERR__')) throw new Error(`请求失败：${text.slice(7).slice(0, 80)}`)
  return text
}

function isNotLoggedIn(text: string): boolean {
  return (
    text.includes('登录到您的账户') ||
    text.includes('log in to your account') ||
    (text.includes('"success":0') && text.includes('未找到请求的书'))
  )
}

/**
 * 取接口文本：逐条线路尝试（有登录 Cookie 的优先），
 * 挑战页则等站点 JS 完成证明后重试。
 */
async function fetchText(path: string, form: string | null = null): Promise<string> {
  const hosts = await candidateHosts()
  const withSession: string[] = []
  for (const host of hosts) {
    if (await hasSession(host)) withSession.push(host)
  }
  const tryHosts = [...withSession, ...hosts.filter((h) => !withSession.includes(h))]
  let lastChallenge = false
  let notLoggedIn = ''
  for (const host of tryHosts) {
    let win: BrowserWindow
    try {
      win = await ensureWindow(host)
    } catch {
      continue
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const text = await inPageFetch(win, path, form)
        if (isNotLoggedIn(text)) {
          notLoggedIn = text
          break
        }
        if (!isChallenge(text)) {
          loadedHost = host
          return text
        }
        lastChallenge = true
      } catch {
        lastChallenge = true
      }
      await sleep(2000)
      await waitUsable(win, 10_000)
    }
  }
  if (notLoggedIn) return notLoggedIn
  throw new Error(
    lastChallenge
      ? 'Z-Library 反爬验证未通过，请在 设置 → 账号管理 → Z-Library 登录 里打开登录窗口完成一次验证'
      : 'Z-Library 请求失败，请稍后重试'
  )
}

const NOT_LOGGED_IN_HINT = 'Z-Library 未登录或登录已失效，请到 设置 → 账号管理 → Z-Library 登录'

async function readJson(path: string, form: string | null): Promise<Record<string, unknown>> {
  const text = await fetchText(path, form)
  if (isNotLoggedIn(text)) throw new Error(NOT_LOGGED_IN_HINT)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(NOT_LOGGED_IN_HINT)
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('站点返回结构异常')
  return parsed as Record<string, unknown>
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanHtml(raw: string): string {
  if (!raw) return ''
  return raw
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<(p|div|li|h[1-6])[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function toBook(raw: unknown): ZlibBook | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = asString(o.id)
  if (!id) return null
  return {
    id,
    hash: asString(o.hash),
    title: asString(o.title) || '（无标题）',
    author: asString(o.author) || null,
    cover: asString(o.cover) || null,
    year: asString(o.year) || null,
    language: asString(o.language) || null,
    extension: asString(o.extension) || null,
    filesize: asString(o.filesize) || null,
    publisher: asString(o.publisher) || null,
    description: cleanHtml(asString(o.description)) || null,
    rating: asString(o.rating) || null,
    dl: asString(o.dl) || null,
    readOnlineUrl: asString(o.readOnlineUrl) || null
  }
}

export async function zlibStatus(): Promise<ZlibStatusResponse> {
  try {
    const host = await preferredHost()
    const loggedIn = await hasSession(host)
    return {
      ok: true,
      loggedIn,
      host,
      message: loggedIn ? `已登录（线路 ${host}）` : '未登录'
    }
  } catch (err) {
    return { ok: false, loggedIn: false, host: '', message: (err as Error).message }
  }
}

/** 打开可见登录窗口；登录成功后关闭并返回 */
export async function openZlibLogin(): Promise<ZlibLoginResult> {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.show()
    loginWindow.focus()
  }
  const hosts = await candidateHosts()
  const host = hosts[0]
  if (!host) return { ok: false, message: '无法解析 Z-Library 线路，请检查网络' }
  const target = `https://${host}/login?redirectUrl=${encodeURIComponent(`https://${host}/`)}`

  if (!loginWindow || loginWindow.isDestroyed()) {
    loginWindow = new BrowserWindow({
      width: 1080,
      height: 820,
      title: 'Z-Library · 登录',
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
  }
  const win = loginWindow
  win.show()
  try {
    await win.loadURL(target)
  } catch {
    // 挑战页导航报错不阻断，下面轮询 Cookie
  }

  const deadline = Date.now() + 5 * 60 * 1000
  while (Date.now() < deadline) {
    if (win.isDestroyed()) break
    for (const item of await candidateHosts()) {
      if (await hasSession(item)) {
        if (!win.isDestroyed()) win.close()
        loginWindow = null
        // 登录后强制重载页面，保证后续接口用新会话
        loadedHost = ''
        if (hidden && !hidden.isDestroyed()) hidden.destroy()
        hidden = null
        return { ok: true, message: `已登录（线路 ${item}）`, host: item }
      }
    }
    await sleep(1500)
  }
  return { ok: false, message: '登录未完成（窗口已关闭或超时），可重新打开登录窗口' }
}

export async function zlibSearch(keyword: string, page: number): Promise<ZlibSearchResponse> {
  const kw = keyword.trim()
  const p = Math.max(1, page)
  if (!kw) return { ok: false, books: [], page: p, totalPages: 0, error: '请输入关键词' }
  try {
    const form = `message=${encodeURIComponent(kw)}&page=${p}&limit=20`
    // 必须 POST（表单体）：GET 会恒返回 400「未找到请求的书」
    const root = await readJson(`/eapi/book/search?${form}`, form)
    const arr = Array.isArray(root.books) ? root.books : Array.isArray(root.exactMatch) ? root.exactMatch : null
    if (!arr) {
      const msg = asString(root.error) || asString(root.message)
      throw new Error(msg ? (isNotLoggedIn(msg) ? NOT_LOGGED_IN_HINT : msg) : '搜索接口返回结构异常')
    }
    const books = arr.map(toBook).filter((b): b is ZlibBook => !!b)
    const pag = (root.pagination ?? {}) as Record<string, unknown>
    const totalPages = typeof pag.total_pages === 'number' ? pag.total_pages : 0
    const current = typeof pag.current_page === 'number' ? pag.current_page : p
    return { ok: true, books, page: current, totalPages }
  } catch (err) {
    return { ok: false, books: [], page: p, totalPages: 0, error: (err as Error).message }
  }
}

export async function zlibDetail(id: string, hash: string): Promise<ZlibDetailResponse> {
  if (!/^\d+$/.test(id)) return { ok: false, book: null, error: '图书编号无效' }
  const safeHash = /^[a-z0-9]+$/i.test(hash) && hash !== '-' ? hash : ''
  try {
    const root = await readJson(
      safeHash ? `/eapi/book/${id}/${safeHash}` : `/eapi/book/${id}`,
      null
    )
    const book =
      toBook(root.book) ||
      toBook(Array.isArray(root.books) ? root.books[0] : null) ||
      toBook(root)
    if (!book) {
      const msg = asString(root.error) || asString(root.message) || '未获取到图书信息'
      throw new Error(isNotLoggedIn(msg) ? NOT_LOGGED_IN_HINT : msg)
    }
    return { ok: true, book }
  } catch (err) {
    return { ok: false, book: null, error: (err as Error).message }
  }
}

function safeName(raw: string): string {
  return (
    raw
      .replace(/[\\/:*?"<>|\r\n]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'book'
  )
}

async function uniquePath(dir: string, name: string): Promise<string> {
  const ext = extname(name)
  const base = name.slice(0, name.length - ext.length) || 'book'
  let candidate = join(dir, `${base}${ext}`)
  let n = 2
  for (;;) {
    try {
      await stat(candidate)
      candidate = join(dir, `${base} (${n++})${ext}`)
    } catch {
      return candidate
    }
  }
}

/** 下载书籍：走站点 /dl/{token}，由 Electron 下载器写入「图书」目录 */
export async function zlibDownloadBook(id: string, hash: string, title: string): Promise<ZlibDownloadResponse> {
  const detail = await zlibDetail(id, hash)
  if (!detail.ok || !detail.book) return { ok: false, error: detail.error ?? '获取图书信息失败' }
  const book = detail.book
  if (!book.dl) return { ok: false, error: '站点未给出下载入口（该书可能仅支持在线阅读）' }

  const host = await preferredHost()
  if (!(await hasSession(host))) return { ok: false, error: NOT_LOGGED_IN_HINT }
  const win = await ensureWindow(host)
  const dir = join(downloadsRoot(), '图书')
  await mkdir(dir, { recursive: true })

  const ext = book.extension ? `.${book.extension.replace(/^\./, '')}` : '.epub'
  const fallback = `${safeName(title || book.title)}${ext}`
  const target = await uniquePath(dir, fallback)
  const ses = zlibSession()

  return new Promise<ZlibDownloadResponse>((resolve) => {
    let settled = false
    let started = false
    const finish = (result: ZlibDownloadResponse): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ses.removeListener('will-download', onWillDownload)
      resolve(result)
    }

    // setSavePath 必须在 will-download 里同步调用，否则下载器会用默认目录
    const onWillDownload = (_event: Electron.Event, item: Electron.DownloadItem): void => {
      started = true
      try {
        item.setSavePath(target)
      } catch (err) {
        finish({ ok: false, error: (err as Error).message })
        return
      }
      item.once('done', async (_e, state) => {
        if (state === 'completed') {
          try {
            await registerLocalFile({
              title: title || book.title,
              kind: 'book',
              absPath: target,
              sourceName: 'Z-Library',
              coverUrl: book.cover ?? ''
            })
            finish({ ok: true, path: target, name: basename(target) })
          } catch (err) {
            finish({ ok: false, error: `已下载但登记失败：${(err as Error).message}` })
          }
        } else {
          finish({ ok: false, error: state === 'cancelled' ? '下载已取消' : '下载失败' })
        }
      })
    }

    const timer = setTimeout(() => {
      finish({ ok: false, error: '下载超时（站点未返回文件，可能额度已用完或被反爬拦截）' })
    }, 180_000)

    ses.on('will-download', onWillDownload)

    void (async () => {
      try {
        await win.loadURL(`https://${host}${book.dl}`)
      } catch {
        // 下载页可能直接触发下载并中断导航，忽略
      }
      // 有些线路需要点一下站点下载按钮
      await sleep(3000)
      if (!settled && !started) {
        try {
          await win.webContents.executeJavaScript(`(() => {
            const a = document.querySelector('a.addDownloadedBook,a.dlButton,a[href*="/dl/"],button.dlDropdownBtn')
            if (a) { a.click(); return true }
            return false
          })()`)
        } catch {
          // 忽略
        }
        await sleep(3000)
        if (!settled && !started) {
          try {
            const body = (await win.webContents.executeJavaScript(
              "(document.body && document.body.innerText || '').slice(0, 600)"
            )) as string
            const text = (body || '').replace(/\s+/g, ' ').trim()
            if (text.includes('限额') || /limit/i.test(text)) {
              finish({ ok: false, error: 'Z-Library 提示：每日下载额度已用完，额度恢复后再试' })
            } else if (text.includes('登录') || /log in/i.test(text)) {
              finish({ ok: false, error: NOT_LOGGED_IN_HINT })
            } else {
              finish({ ok: false, error: `站点没有给出文件地址：${text.slice(0, 120) || '请稍后重试'}` })
            }
          } catch {
            finish({ ok: false, error: '站点没有给出文件地址，请稍后重试' })
          }
        }
      }
    })()
  })
}
