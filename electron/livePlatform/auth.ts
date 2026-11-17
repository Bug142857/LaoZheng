import { app, BrowserWindow, safeStorage } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import QRCode from 'qrcode'
import {
  BILI_UA,
  DESKTOP_UA,
  DOUYIN_UA,
  asNumber,
  asRecord,
  asString,
  fetchJson,
  randomDeviceId,
  type FetchOptions
} from './common'
import { LIVE_PARTITION, clearCookies, liveSession, openLoginWindow, readCookieString } from './session'
import type {
  LiveLoginStatus,
  LiveLoginWindowResult,
  LivePlatformId,
  LiveQrPollResult,
  LiveQrStart
} from '../../src/shared/livePlatform'

interface StoredAccount {
  cookie: string
  name?: string
  avatar?: string
  uid?: string
  expireAt?: number
  savedAt: number
}

interface StoredFile {
  v: 1
  accounts: Partial<Record<LivePlatformId, StoredAccount>>
  douyuDeviceId?: string
}

const filePath = (): string => join(app.getPath('userData'), 'live-accounts.json')

let store: StoredFile = { v: 1, accounts: {} }
let loaded = false
let writeChain: Promise<void> = Promise.resolve()

function encrypt(value: string): string {
  if (!value) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(value).toString('base64')}`
  }
  return `raw:${Buffer.from(value, 'utf8').toString('base64')}`
}

function decrypt(value: string | undefined): string {
  if (!value) return ''
  try {
    if (value.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
    }
    if (value.startsWith('raw:')) return Buffer.from(value.slice(4), 'base64').toString('utf8')
  } catch (err) {
    console.error('[liveAuth] 解密失败', err)
  }
  return ''
}

function readStore(): StoredFile {
  if (!existsSync(filePath())) return { v: 1, accounts: {} }
  try {
    const raw = JSON.parse(readFileSync(filePath(), 'utf8')) as Record<string, unknown>
    const accounts: StoredFile['accounts'] = {}
    const source = asRecord(raw.accounts)
    for (const platform of ['bilibili', 'douyu', 'douyin'] as LivePlatformId[]) {
      const entry = asRecord(source[platform])
      const cookie = decrypt(asString(entry.cookie))
      if (!cookie) continue
      accounts[platform] = {
        cookie,
        name: asString(entry.name) || undefined,
        avatar: asString(entry.avatar) || undefined,
        uid: asString(entry.uid) || undefined,
        expireAt: asNumber(entry.expireAt) || undefined,
        savedAt: asNumber(entry.savedAt) || Date.now()
      }
    }
    return {
      v: 1,
      accounts,
      douyuDeviceId: asString(raw.douyuDeviceId) || undefined
    }
  } catch (err) {
    console.error('[liveAuth] 读取账号文件失败', err)
    return { v: 1, accounts: {} }
  }
}

function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  store = readStore()
}

function persist(): Promise<void> {
  const snapshot: Record<string, unknown> = { v: 1, accounts: {}, douyuDeviceId: store.douyuDeviceId }
  const accounts: Record<string, unknown> = {}
  for (const [platform, account] of Object.entries(store.accounts)) {
    if (!account) continue
    accounts[platform] = {
      cookie: encrypt(account.cookie),
      name: account.name,
      avatar: account.avatar,
      uid: account.uid,
      expireAt: account.expireAt,
      savedAt: account.savedAt
    }
  }
  snapshot.accounts = accounts
  writeChain = writeChain
    .catch(() => undefined)
    .then(async () => {
      await mkdir(app.getPath('userData'), { recursive: true })
      const tmp = `${filePath()}.${process.pid}.${Date.now()}.tmp`
      await writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8')
      await rename(tmp, filePath())
    })
  return writeChain
}

export function initLiveAuth(): void {
  ensureLoaded()
}

export function getDouyuDeviceId(): string {
  ensureLoaded()
  if (!store.douyuDeviceId) {
    store.douyuDeviceId = randomDeviceId()
    void persist()
  }
  return store.douyuDeviceId
}

export function getLiveCookie(platform: LivePlatformId): string {
  ensureLoaded()
  return store.accounts[platform]?.cookie ?? ''
}

export async function saveLiveCookie(
  platform: LivePlatformId,
  cookie: string,
  meta: { name?: string; avatar?: string; uid?: string; expireAt?: number } = {}
): Promise<void> {
  ensureLoaded()
  store.accounts[platform] = {
    cookie,
    name: meta.name ?? store.accounts[platform]?.name,
    avatar: meta.avatar ?? store.accounts[platform]?.avatar,
    uid: meta.uid ?? store.accounts[platform]?.uid,
    expireAt: meta.expireAt ?? store.accounts[platform]?.expireAt,
    savedAt: Date.now()
  }
  await persist()
}

export async function clearLiveCookie(platform: LivePlatformId): Promise<void> {
  ensureLoaded()
  delete store.accounts[platform]
  await persist()
}

function statusOf(platform: LivePlatformId): LiveLoginStatus {
  ensureLoaded()
  const account = store.accounts[platform]
  if (!account) return { platform, loggedIn: false }
  // 已明确过期的会话（抖音按 sid_guard 的登录时间 + 有效期推算）不再显示已登录
  if (typeof account.expireAt === 'number' && account.expireAt > 0 && Date.now() > account.expireAt) {
    return { platform, loggedIn: false }
  }
  return {
    platform,
    loggedIn: true,
    name: account.name,
    avatar: account.avatar,
    uid: account.uid,
    expireAt: account.expireAt
  }
}

function parseBilibiliCookie(setCookies: string[]): string {
  const names = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid', 'buvid3', 'buvid4']
  const joined = setCookies.join('; ')
  const out: string[] = []
  for (const name of names) {
    const match = joined.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
    if (match?.[1]) out.push(`${name}=${match[1].trim()}`)
  }
  return out.join('; ')
}

/** 登录名只在登录后取一次；取不到就保持「已登录」，下次启动再试 */
const nameAttempts = new Set<LivePlatformId>()
/** 本次运行里主动退出过的平台：分区 Cookie 没清净时也不要自动收编回账号文件 */
const loggedOut = new Set<LivePlatformId>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 抖音 / 斗鱼没有稳定的用户信息接口：用登录后的会话打开站点页面，
 * 抖音从个人主页标题取昵称，斗鱼从顶部用户区取昵称。
 */
async function nameFromPage(platform: 'douyu' | 'douyin'): Promise<string> {
  const win = new BrowserWindow({
    show: false,
    x: -10_000,
    y: -10_000,
    skipTaskbar: true,
    width: 1180,
    height: 780,
    webPreferences: {
      partition: LIVE_PARTITION,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const script =
    platform === 'douyu'
      ? `(() => {
          const inHeader = (el) => {
            const rect = el.getBoundingClientRect();
            return rect.top < 220 && rect.width > 0;
          };
          const selectors = [
            '[class*="nickName"]',
            '[class*="nickname"]',
            '[class*="Nickname"]',
            '[class*="user-name"]',
            '[class*="userName"]',
            '[class*="UserName"]'
          ];
          for (const selector of selectors) {
            for (const el of document.querySelectorAll(selector)) {
              if (!inHeader(el)) continue;
              const text = (el.textContent || '').trim();
              if (text && text.length <= 24 && !text.includes('登录')) return text;
            }
          }
          return '';
        })()`
      : `(() => {
          const title = document.title || '';
          const match = title.match(/^(.+?)的(?:抖音|主页)/);
          if (match && match[1]) return match[1].trim();
          const avatar = [...document.querySelectorAll('img[alt$="头像"]')]
            .map((el) => (el.getAttribute('alt') || '').replace(/头像$/, '').trim())
            .find(Boolean);
          if (avatar) return avatar;
          const og = document.querySelector('meta[property="og:title"]');
          const text = og ? (og.getAttribute('content') || '').trim() : '';
          return text && text !== '抖音' && text.length <= 24 ? text : '';
        })()`
  try {
    const url = platform === 'douyu' ? 'https://www.douyu.com/' : 'https://www.douyin.com/user/self'
    await Promise.race([
      win.loadURL(url, { userAgent: platform === 'douyu' ? DESKTOP_UA : DOUYIN_UA }).catch(() => undefined),
      sleep(10_000)
    ])
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await sleep(attempt === 0 ? 2200 : 1200)
      const name = await Promise.race([
        win.webContents.executeJavaScript(script).catch(() => ''),
        sleep(3500).then(() => '')
      ])
      if (typeof name === 'string' && name) return name
    }
    return ''
  } catch {
    return ''
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

/** 斗鱼 Cookie 里的 acf_ccn 是 URL 编码的昵称，页面读不到时用它兜底 */
function douyuCookieName(cookie: string): string {
  const match = cookie.match(/(?:^|;\s*)acf_ccn=([^;]+)/)
  if (!match) return ''
  try {
    const value = decodeURIComponent(match[1]).trim()
    if (!value || value.length > 24 || /[\u0000-\u001f]/.test(value)) return ''
    return value
  } catch {
    return ''
  }
}

async function resolveAccountName(platform: LivePlatformId, cookie: string): Promise<string> {
  // 抖音自助资料接口被签名风控拦（返回「用户未登录」），只能从个人主页标题取昵称
  if (platform === 'douyin') return nameFromPage('douyin')
  if (platform === 'douyu') {
    const fromPage = await nameFromPage('douyu')
    return fromPage || douyuCookieName(cookie)
  }
  return ''
}

export async function liveLoginStatus(platform: LivePlatformId): Promise<LiveLoginStatus> {
  let cookie = getLiveCookie(platform)
  // 旧版本或异常退出可能只把登录 Cookie 留在直播分区里，账号文件没有记录：
  // 这里把分区里的登录 Cookie 收编回账号文件，界面才能显示已登录并提供退出入口
  if (!cookie && platform !== 'bilibili' && !loggedOut.has(platform)) {
    const restored = await readCookieString(
      liveSession(),
      platform === 'douyu' ? ['douyu.com'] : ['douyin.com'],
      platform === 'douyu'
        ? ['acf_uid', 'acf_stk', 'acf_ccn', 'acf_ltkid', 'dy_auth']
        : ['sessionid', 'sessionid_ss', 'sid_tt']
    ).catch(() => '')
    if (restored) {
      cookie = restored
      const restoredExpire = platform === 'douyin' ? parseDouyinExpire(restored) : 0
      await saveLiveCookie(platform, restored, restoredExpire > 0 ? { expireAt: restoredExpire } : {})
    }
  }
  if (!cookie) return { platform, loggedIn: false }

  if (platform === 'bilibili') {
    try {
      const res = await fetchJson<{ code: number; data?: Record<string, unknown> }>(
        'https://api.bilibili.com/x/web-interface/nav',
        {
          headers: {
            'User-Agent': BILI_UA,
            Referer: 'https://www.bilibili.com/',
            Cookie: cookie
          }
        }
      )
      const data = asRecord(res.data)
      if (res.code === 0 && data.isLogin === true) {
        await saveLiveCookie('bilibili', cookie, {
          name: asString(data.uname),
          avatar: asString(data.face),
          uid: asString(data.mid)
        })
        return statusOf('bilibili')
      }
      if (res.code === -101) {
        await clearLiveCookie('bilibili')
        return { platform, loggedIn: false }
      }
    } catch {
      // 网络问题不当作退出登录
    }
  }

  // 抖音 sid_guard 的第二个字段是登录时间、不是过期时间，不能据此判断登录态：
  // 过期旧会话由「打开登录窗口前先清 Cookie」和手动退出处理。

  const status = statusOf(platform)
  // 已有登录态里没存昵称（旧版本登录 / 首次读取）：后台补一次，界面稍后刷新就能显示账号名
  if (status.loggedIn && !status.name && platform !== 'bilibili' && !nameAttempts.has(platform)) {
    nameAttempts.add(platform)
    void resolveAccountName(platform, cookie)
      .then((name) => {
        if (!name) return undefined
        // 解析期间可能已经重新登录，Cookie 变了就不要写回旧账号的名字
        const current = store.accounts[platform]
        if (!current || current.cookie !== cookie) return undefined
        return saveLiveCookie(platform, cookie, { name })
      })
      .catch(() => undefined)
  }
  return status
}

/** sid_guard = <hash>|<登录时间戳>|<有效期秒数>|<到期日期>，过期时间 = 登录时间 + 有效期 */
function parseDouyinExpire(cookie: string): number {
  const match = cookie.match(/(?:^|;\s*)sid_guard=([^;]+)/)
  if (!match) return 0
  try {
    const parts = decodeURIComponent(match[1]).split('|')
    const issued = Number(parts[1])
    const maxAge = Number(parts[2])
    if (Number.isFinite(issued) && issued > 0 && Number.isFinite(maxAge) && maxAge > 0) {
      return (issued + maxAge) * 1000
    }
    // 缺少有效期字段时无法推算过期时间，返回 0（不按过期处理），避免误登出
    return 0
  } catch {
    return 0
  }
}

export async function bilibiliQrStart(): Promise<LiveQrStart> {
  const res = await fetchJson<{
    code: number
    message?: string
    data?: { url?: string; qrcode_key?: string }
  }>('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {
    headers: { 'User-Agent': BILI_UA, Referer: 'https://www.bilibili.com/' }
  })
  const data = asRecord(res.data)
  const key = asString(data.qrcode_key)
  const url = asString(data.url)
  if (res.code !== 0 || !key || !url) {
    throw new Error(res.message || 'B站二维码生成失败')
  }
  const image = await QRCode.toDataURL(url, { margin: 1, width: 240 })
  return { key, image, expireAt: Date.now() + 180_000 }
}

export async function bilibiliQrPoll(key: string): Promise<LiveQrPollResult> {
  const res = await fetch(
    `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}`,
    {
      headers: { 'User-Agent': BILI_UA, Referer: 'https://www.bilibili.com/' },
      signal: AbortSignal.timeout(15_000)
    }
  )
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('B站二维码状态解析失败')
  }
  const data = asRecord(body.data)
  const code = asNumber(data.code)
  if (code === 86101) return { state: 'waiting' }
  if (code === 86090) return { state: 'scanned' }
  if (code === 86038) return { state: 'expired' }
  if (code !== 0) {
    throw new Error(asString(data.message) || `B站二维码状态异常（${code}）`)
  }

  const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie
  const rawCookies =
    typeof getSetCookie === 'function' ? getSetCookie.call(res.headers) : [res.headers.get('set-cookie') ?? '']
  const cookie = parseBilibiliCookie(rawCookies.filter(Boolean))
  if (!cookie) throw new Error('B站登录成功但没有拿到 Cookie')

  const account = await liveLoginStatusFromCookie(cookie)
  await saveLiveCookie('bilibili', cookie, account)
  return { state: 'confirmed', login: statusOf('bilibili') }
}

async function liveLoginStatusFromCookie(
  cookie: string
): Promise<{ name?: string; avatar?: string; uid?: string }> {
  try {
    const res = await fetchJson<{ code: number; data?: Record<string, unknown> }>(
      'https://api.bilibili.com/x/web-interface/nav',
      {
        headers: {
          'User-Agent': BILI_UA,
          Referer: 'https://www.bilibili.com/',
          Cookie: cookie
        }
      }
    )
    const data = asRecord(res.data)
    if (res.code === 0 && data.isLogin === true) {
      return {
        name: asString(data.uname),
        avatar: asString(data.face),
        uid: asString(data.mid)
      }
    }
  } catch {
    // 忽略
  }
  return {}
}

export async function openPlatformLogin(platform: LivePlatformId): Promise<LiveLoginWindowResult> {
  if (platform === 'bilibili') {
    throw new Error('B站使用应用内二维码登录')
  }
  const douyu = platform === 'douyu'
  // 打开登录窗口前先清掉分区里的旧 Cookie：残留的过期登录态会让窗口一打开就秒关并提示成功
  await clearCookies(
    liveSession(),
    douyu ? ['douyu.com'] : ['douyin.com', 'douyinpic.com']
  ).catch(() => undefined)
  const result = await openLoginWindow({
    url: douyu ? 'https://passport.douyu.com/member/login' : 'https://www.douyin.com/',
    title: douyu ? '斗鱼扫码登录' : '抖音扫码登录',
    markers: douyu
      ? ['acf_uid', 'acf_stk', 'acf_ccn', 'acf_ltkid', 'dy_auth']
      : ['sessionid', 'sessionid_ss', 'sid_tt'],
    domains: douyu ? ['douyu.com'] : ['douyin.com'],
    cookieDomains: douyu ? ['douyu.com'] : ['douyin.com', 'douyinpic.com']
  })
  if (result.canceled || !result.cookie) {
    return { canceled: true }
  }
  const cookie = result.cookie
  const expireAt = platform === 'douyin' ? parseDouyinExpire(cookie) || undefined : undefined
  loggedOut.delete(platform)
  await saveLiveCookie(platform, cookie, { expireAt })
  // 昵称后台补取（抖音 / 斗鱼要开一次页面），界面过几秒刷新就能看到账号名
  if (!nameAttempts.has(platform)) {
    nameAttempts.add(platform)
    void resolveAccountName(platform, cookie)
      .then((name) => {
        if (!name) return undefined
        // 解析期间可能已经退出 / 重新登录：Cookie 变了就不要把旧账号写回去
        const current = store.accounts[platform]
        if (!current || current.cookie !== cookie) return undefined
        return saveLiveCookie(platform, cookie, { name })
      })
      .catch(() => undefined)
  }
  return { canceled: false, login: await liveLoginStatus(platform) }
}

export async function logoutPlatform(platform: LivePlatformId): Promise<LiveLoginStatus> {
  loggedOut.add(platform)
  await clearLiveCookie(platform)
  nameAttempts.delete(platform)
  const ses = liveSession()
  try {
    await clearCookies(
      ses,
      platform === 'douyu'
        ? ['douyu.com']
        : platform === 'douyin'
          ? ['douyin.com', 'douyinpic.com']
          : ['bilibili.com']
    )
  } catch {
    // 忽略
  }
  return { platform, loggedIn: false }
}

/** B站请求用的 Cookie：优先登录 Cookie，其次匿名 buvid */
export async function bilibiliRequestCookie(): Promise<string> {
  const login = getLiveCookie('bilibili')
  if (login) return login
  return getAnonymousBuvid()
}

let buvidCache: { cookie: string; at: number } | null = null

async function getAnonymousBuvid(): Promise<string> {
  if (buvidCache && Date.now() - buvidCache.at < 6 * 60 * 60 * 1000) return buvidCache.cookie
  try {
    const res = await fetchJson<{
      code: number
      data?: { b_3?: string; b_4?: string }
    }>('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: { 'User-Agent': BILI_UA, Referer: 'https://www.bilibili.com/' }
    })
    const data = asRecord(res.data)
    const b3 = asString(data.b_3)
    const b4 = asString(data.b_4)
    if (b3) {
      const cookie = `buvid3=${b3}${b4 ? `; buvid4=${b4}` : ''}`
      buvidCache = { cookie, at: Date.now() }
      return cookie
    }
  } catch {
    // 匿名 buvid 拿不到时仍可尝试直接请求
  }
  return ''
}

/** 隐藏浏览器抓流也走同一个分区；登录后 Cookie 已由官方页面写入 */
export async function liveSessionCookie(domains: string[]): Promise<string> {
  return readCookieString(liveSession(), domains)
}

export const LIVE_SESSION_PARTITION = LIVE_PARTITION
export type { FetchOptions }
