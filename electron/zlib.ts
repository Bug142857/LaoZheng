import { app, BrowserWindow, safeStorage, session } from 'electron'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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
/** 最近一次被 DiamWall 反爬拦下的时间：用于把「有 Cookie」与「真能用」区分开 */
let challengeFailedAt = 0

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
 * 直接走 Electron 网络栈（带分区 Cookie）。挑战已通过时这条路最快，
 * 只有被 DiamWall 拦下时才回退隐藏窗口。
 */
async function directFetch(host: string, path: string, form: string | null): Promise<string | null> {
  try {
    const res = await zlibSession().fetch(`https://${host}${path}`, {
      method: form ? 'POST' : 'GET',
      headers: form
        ? {
            'User-Agent': UA,
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest'
          }
        : {
            'User-Agent': UA,
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'X-Requested-With': 'XMLHttpRequest'
          },
      body: form ?? undefined,
      credentials: 'include',
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) return null
    const text = await res.text()
    return text && !isChallenge(text) ? text : null
  } catch {
    return null
  }
}

async function fetchText(path: string, form: string | null = null): Promise<string> {
  const hosts = await candidateHosts()
  const withSession: string[] = []
  for (const host of hosts) {
    if (await hasSession(host)) withSession.push(host)
  }
  const tryHosts = [...withSession, ...hosts.filter((h) => !withSession.includes(h))]
  let lastChallenge = false
  let notLoggedIn = ''
  // 逐条线路尝试太慢：有会话的优先，最多试 5 条
  for (const host of tryHosts.slice(0, 5)) {
    // 先试直连（秒级返回），失败再走隐藏窗口
    const direct = await directFetch(host, path, form)
    if (direct) {
      if (isNotLoggedIn(direct)) {
        notLoggedIn = direct
        challengeFailedAt = 0
        break
      }
      loadedHost = host
      challengeFailedAt = 0
      return direct
    }
    let win: BrowserWindow
    try {
      win = await ensureWindow(host)
    } catch {
      continue
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await inPageFetch(win, path, form)
        if (isNotLoggedIn(text)) {
          notLoggedIn = text
          challengeFailedAt = 0
          break
        }
        if (!isChallenge(text)) {
          loadedHost = host
          challengeFailedAt = 0
          return text
        }
        lastChallenge = true
      } catch {
        lastChallenge = true
      }
      // 挑战页需要重新走一遍站点自己的 JS 验证：强制重载首页并等它可用
      challengeFailedAt = Date.now()
      try {
        await win.loadURL(`https://${host}/`)
      } catch {
        // 挑战页导航报错不算失败，下面继续等
      }
      await waitUsable(win, 10_000)
      await sleep(800)
    }
  }
  if (notLoggedIn) return notLoggedIn
  throw new Error(
    lastChallenge
      ? 'Z-Library 反爬验证未通过：请到 设置 → 账号管理 → Z-Library 点「打开登录窗口」，在窗口里完成一次验证（窗口会预填账号密码）'
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

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`
}

function toBook(raw: unknown): ZlibBook | null {
  if (!raw || typeof raw !== 'object') return null
  const outer = raw as Record<string, unknown>
  const nested = outer.book && typeof outer.book === 'object' ? outer.book : null
  const o = (nested ?? outer) as Record<string, unknown>
  // 站点有时把 id / hash 返回成数字，统一转成字符串
  const id =
    typeof o.id === 'number'
      ? String(o.id)
      : typeof o.id === 'string'
        ? o.id.trim()
        : ''
  if (!id) return null
  return {
    id,
    hash: typeof o.hash === 'number' ? String(o.hash) : asString(o.hash),
    title: asString(o.title) || '（无标题）',
    author: asString(o.author) || null,
    cover: asString(o.cover) || null,
    year: typeof o.year === 'number' ? String(o.year) : asString(o.year) || null,
    language: asString(o.language) || null,
    extension: asString(o.extension) || null,
    filesize:
      asString(o.filesizeString) ||
      (typeof o.filesize === 'number' ? formatSize(o.filesize) : asString(o.filesize)) ||
      null,
    publisher: asString(o.publisher) || null,
    description: cleanHtml(asString(o.description)) || null,
    rating: asString(o.rating) || null,
    dl: asString(o.dl) || null,
    readOnlineUrl: asString(o.readOnlineUrl) || null
  }
}

interface ZlibCredentials {
  username: string
  password: string
}

function credentialsPath(): string {
  return join(app.getPath('userData'), 'zlib-account.json')
}

function encryptValue(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(value).toString('base64')}`
  }
  return `raw:${Buffer.from(value, 'utf8').toString('base64')}`
}

function decryptValue(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  try {
    if (value.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
    }
    if (value.startsWith('raw:')) return Buffer.from(value.slice(4), 'base64').toString('utf8')
  } catch {
    // 解密失败按未保存处理
  }
  return ''
}

async function readCredentials(): Promise<ZlibCredentials | null> {
  try {
    const raw = JSON.parse(await readFile(credentialsPath(), 'utf8')) as {
      username?: unknown
      password?: unknown
    }
    const username = typeof raw.username === 'string' ? raw.username.trim() : ''
    const password = decryptValue(raw.password)
    return username && password ? { username, password } : null
  } catch {
    return null
  }
}

async function writeCredentials(creds: ZlibCredentials): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  const target = credentialsPath()
  const tmp = `${target}.tmp`
  await writeFile(
    tmp,
    JSON.stringify({ username: creds.username, password: encryptValue(creds.password) }, null, 2),
    'utf8'
  )
  await rename(tmp, target)
}

async function clearZlibSession(): Promise<void> {
  const ses = zlibSession()
  for (const host of await candidateHosts()) {
    for (const name of ['remix_userid', 'remix_userkey']) {
      await ses.cookies.remove(`https://${host}/`, name).catch(() => undefined)
    }
  }
}

let quotaCache: { at: number; today: number | null; limit: number | null } | null = null

/** 从用户资料接口里扫「今日下载 / 每日额度」，字段名各线路略有差异 */
function scanQuota(text: string): { today: number | null; limit: number | null } {
  let today: number | null = null
  let limit: number | null = null
  for (const m of text.matchAll(/"([a-z0-9_]*download[a-z0-9_]*)"\s*:\s*"?(\d+)"?/gi)) {
    const key = m[1].toLowerCase()
    const value = Number(m[2])
    if (!Number.isFinite(value)) continue
    if (/limit|max/.test(key)) limit = value
    else if (/today|used|count|daily/.test(key)) today = value
  }
  return { today, limit }
}

async function fetchQuota(): Promise<{ today: number | null; limit: number | null }> {
  if (quotaCache && Date.now() - quotaCache.at < 60_000) {
    return { today: quotaCache.today, limit: quotaCache.limit }
  }
  try {
    const text = await fetchText('/eapi/user/profile')
    const quota = scanQuota(text)
    quotaCache = { at: Date.now(), ...quota }
    return quota
  } catch {
    return { today: null, limit: null }
  }
}

export async function zlibStatus(): Promise<ZlibStatusResponse> {
  try {
    const host = await preferredHost()
    const loggedIn = await hasSession(host)
    const creds = await readCredentials()
    const blocked = Date.now() - challengeFailedAt < 10 * 60 * 1000
    const quota = loggedIn ? await fetchQuota() : { today: null, limit: null }
    return {
      ok: true,
      loggedIn,
      host,
      username: creds?.username ?? '',
      downloadsToday: quota.today,
      downloadsLimit: quota.limit,
      message: blocked
        ? '反爬验证未通过：请点「打开登录窗口」完成一次验证'
        : loggedIn
          ? `已登录（线路 ${host}）`
          : creds
            ? `未登录（已保存账号 ${creds.username}）`
            : '未登录'
    }
  } catch (err) {
    return {
      ok: false,
      loggedIn: false,
      host: '',
      username: '',
      downloadsToday: null,
      downloadsLimit: null,
      message: (err as Error).message
    }
  }
}

/** 有 Cookie 的线路（登录成功后返回该 host） */
async function sessionHost(): Promise<string> {
  for (const host of await candidateHosts()) {
    if (await hasSession(host)) return host
  }
  return ''
}

function ensureLoginWindow(visible: boolean): BrowserWindow {
  if (!loginWindow || loginWindow.isDestroyed()) {
    loginWindow = new BrowserWindow({
      width: 1080,
      height: 820,
      show: visible,
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
  } else if (visible) {
    loginWindow.show()
    loginWindow.focus()
  }
  return loginWindow
}

/** 在登录页自动填写账号密码；返回 none / filled / submitted */
async function fillLoginForm(win: BrowserWindow, creds: ZlibCredentials): Promise<string> {
  try {
    const user = JSON.stringify(creds.username)
    const pass = JSON.stringify(creds.password)
    const script = `(() => {
      const q = (s) => document.querySelector(s)
      const email = q('input[type="email"],input[name="email"],input[name="username"],#email,#username')
      const password = q('input[type="password"],input[name="password"],#password')
      if (!email && !password) return 'none'
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      const fill = (el, v) => {
        if (!el || el.value === v) return false
        setter.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }
      let changed = false
      if (email) changed = fill(email, __USER__) || changed
      if (password) changed = fill(password, __PASS__) || changed
      const both = !!(email && password && email.value && password.value)
      if (both) {
        const form = password.closest('form')
        const button = (form && form.querySelector('button[type="submit"],input[type="submit"],button')) ||
          document.querySelector('button[type="submit"],input[type="submit"]')
        if (button) { button.click(); return 'submitted' }
        if (form && form.requestSubmit) { form.requestSubmit(); return 'submitted' }
      }
      if (changed && email && !password) {
        const next = [...document.querySelectorAll('button')].find((b) =>
          /继续|下一步|next|continue/i.test(b.innerText || '')
        )
        if (next) { next.click(); return 'submitted' }
      }
      return changed ? 'filled' : 'none'
    })()`
    const result = (await win.webContents.executeJavaScript(
      script.replace('__USER__', user).replace('__PASS__', pass)
    )) as string
    return result
  } catch {
    return 'none'
  }
}

/** 页面是否还停在 DiamWall 验证页（用来避免「有 Cookie 但其实过不去验证」） */
async function stillChallenged(win: BrowserWindow): Promise<boolean> {
  if (win.isDestroyed()) return false
  try {
    const text = (await win.webContents.executeJavaScript(
      "((document.title||'')+'|'+((document.body&&document.body.innerText)||'').slice(0,300))"
    )) as string
    return /diamwall|verifying your browser|just a moment|checking your browser|验证/i.test(text)
  } catch {
    return false
  }
}

async function attemptLogin(
  host: string,
  creds: ZlibCredentials | null,
  visible: boolean
): Promise<ZlibLoginResult> {
  const win = ensureLoginWindow(visible)
  const target = `https://${host}/login?redirectUrl=${encodeURIComponent(`https://${host}/`)}`
  try {
    await win.loadURL(target)
  } catch {
    // 挑战页导航报错不阻断，下面轮询 Cookie
  }

  const deadline = Date.now() + (visible ? 5 * 60 * 1000 : 45 * 1000)
  let submitted = false
  while (Date.now() < deadline) {
    if (win.isDestroyed()) return { ok: false, message: '登录窗口已关闭' }
    // 每轮都看一次 Cookie：已有有效会话时立即返回，避免「一直提示已登录」卡住窗口
    const hostWithSession = await sessionHost()
    const blockedRecently = Date.now() - challengeFailedAt < 10 * 60 * 1000
    if (hostWithSession && (!blockedRecently || !(await stillChallenged(win)))) {
      if (!win.isDestroyed()) win.close()
      loginWindow = null
      loadedHost = ''
      challengeFailedAt = 0
      if (hidden && !hidden.isDestroyed()) hidden.destroy()
      hidden = null
      return { ok: true, message: `已登录（线路 ${hostWithSession}）`, host: hostWithSession }
    }
    if (creds && !submitted) {
      const state = await fillLoginForm(win, creds)
      if (state === 'submitted') submitted = true
    }
    await sleep(1500)
  }

  if (!win.isDestroyed()) {
    if (visible) {
      win.show()
      win.focus()
      return {
        ok: false,
        message: creds
          ? '自动登录未通过，窗口已预填账号密码，请手动完成一次'
          : '请在窗口中完成登录，登录成功后会自动生效'
      }
    }
    win.destroy()
    loginWindow = null
  }
  return {
    ok: false,
    message: creds
      ? '自动登录未通过，请到设置里点「登录」重试（窗口会预填账号密码）'
      : '登录超时，请重试'
  }
}

let loginRunning: Promise<ZlibLoginResult> | null = null

async function doLogin(manualFallback: boolean): Promise<ZlibLoginResult> {
  const hosts = await candidateHosts()
  if (!hosts.length) return { ok: false, message: '无法解析 Z-Library 线路，请检查网络' }
  const host = (await preferredHost()) || hosts[0]
  const creds = await readCredentials()

  if (!manualFallback) {
    if (await hasSession(host)) return { ok: true, message: `已登录（线路 ${host}）`, host }
    if (creds) {
      const auto = await attemptLogin(host, creds, false)
      if (auto.ok) return auto
    }
    return {
      ok: false,
      message: creds ? '自动登录未通过，请到设置里重新登录一次' : '未保存账号，请先到设置里填写'
    }
  }

  // 手动入口：不管 Cookie 在不在都打开窗口，让用户自己完成登录 / 反爬验证
  return attemptLogin(host, creds, true)
}

/** 打开登录窗口（窗口会预填已保存的账号密码；已有有效会话会立即自动关闭） */
export async function zlibLogin(): Promise<ZlibLoginResult> {
  if (loginRunning) return loginRunning
  loginRunning = doLogin(true)
  try {
    return await loginRunning
  } finally {
    loginRunning = null
  }
}

export const openZlibLogin = zlibLogin

/** 退出登录：清掉站点 Cookie / 本地网页存储与已保存账号密码 */
export async function zlibLogout(): Promise<ZlibStatusResponse> {
  challengeFailedAt = 0
  hostsCache = null
  loadedHost = ''
  if (hidden && !hidden.isDestroyed()) hidden.destroy()
  hidden = null
  if (loginWindow && !loginWindow.isDestroyed()) loginWindow.destroy()
  loginWindow = null
  try {
    await zlibSession().clearStorageData()
  } catch {
    // 清理失败时仍继续移除本地账号文件
  }
  try {
    await clearZlibSession()
  } catch {
    // 上面已整体清理，这里只是兜底
  }
  await rm(credentialsPath(), { force: true }).catch(() => undefined)
  return {
    ok: true,
    loggedIn: false,
    host: '',
    username: '',
    message: '已退出登录，并清除本机保存的账号密码'
  }
}

/** 保存账号密码并立即尝试登录（密码用系统 DPAPI 加密，只存本机） */
export async function zlibSaveCredentials(
  username: string,
  password: string
): Promise<ZlibLoginResult> {
  const user = username.trim()
  if (!user || !password) return { ok: false, message: '请输入账号和密码' }
  await writeCredentials({ username: user, password })
  await clearZlibSession()
  if (loginRunning) return loginRunning
  loginRunning = doLogin(true)
  try {
    return await loginRunning
  } finally {
    loginRunning = null
  }
}

/** 启动时静默自动登录：有保存账密且会话失效才尝试，失败不弹窗 */
export async function autoZlibLogin(): Promise<boolean> {
  const creds = await readCredentials()
  if (!creds) return false
  const status = await zlibStatus()
  if (status.loggedIn) return true
  const host = (await preferredHost()) || (await candidateHosts())[0]
  if (!host) return false
  const result = await attemptLogin(host, creds, false)
  return result.ok
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
          // 失败 / 取消时清掉写了一半的文件，避免留下打不开的残缺图书
          await rm(target, { force: true }).catch(() => undefined)
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
