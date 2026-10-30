import { app, BrowserWindow, safeStorage, session, shell } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DoubanAuthStatus } from '../src/shared/douban'

/**
 * 豆瓣登录：弹出独立窗口（persist:douban 分区）让用户完成登录，
 * 检测到登录 Cookie（dbcl2 / dbcl）后立即加密保存到 userData/douban-auth.json。
 * 主进程的豆瓣搜索请求会自动带上这份 Cookie，登录后老片也能搜到。
 * Cookie 用 Electron safeStorage（Windows DPAPI）加密，不写日志、不进备份。
 */

const PARTITION = 'persist:douban'
const LOGIN_URL = 'https://accounts.douban.com/passport/login?source=movie'

interface StoredAuth {
  cookie: string
  updatedAt: number
}

let cookieString = ''
let updatedAt = 0
let loaded = false

function authPath(): string {
  return join(app.getPath('userData'), 'douban-auth.json')
}

function encryptValue(value: string): string {
  if (!value) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(value).toString('base64')}`
  }
  return `raw:${Buffer.from(value, 'utf8').toString('base64')}`
}

function decryptValue(value: string | undefined): string {
  if (!value) return ''
  try {
    if (value.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
    }
    if (value.startsWith('raw:')) return Buffer.from(value.slice(4), 'base64').toString('utf8')
  } catch (err) {
    console.error('[douban] 解密登录 Cookie 失败', err)
  }
  return ''
}

export function initDoubanAuth(): void {
  if (loaded) return
  loaded = true
  const file = authPath()
  if (!existsSync(file)) return
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredAuth>
    cookieString = decryptValue(typeof raw.cookie === 'string' ? raw.cookie : '')
    updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : 0
  } catch (err) {
    console.error('[douban] 读取登录 Cookie 失败', err)
  }
}

async function persist(): Promise<void> {
  try {
    await mkdir(app.getPath('userData'), { recursive: true })
    const target = authPath()
    const tmp = `${target}.tmp`
    const payload: StoredAuth = { cookie: encryptValue(cookieString), updatedAt }
    await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
    await rename(tmp, target)
  } catch (err) {
    console.error('[douban] 保存登录 Cookie 失败', err)
  }
}

function isLoggedInCookie(cookie: string): boolean {
  return /(^|;\s*)(dbcl2|dbcl)=/.test(cookie)
}

/** 主进程发豆瓣请求时统一取这份 Cookie */
export function doubanCookie(): string {
  return cookieString
}

export function doubanAuthStatus(): DoubanAuthStatus {
  const loggedIn = isLoggedInCookie(cookieString)
  return {
    loggedIn,
    message: loggedIn ? '已登录，搜索结果更全' : '未登录，登录后搜索结果更全（老片需要登录才搜得到）',
    updatedAt
  }
}

async function captureCookies(): Promise<{ cookie: string; loggedIn: boolean }> {
  const ses = session.fromPartition(PARTITION)
  const all = await ses.cookies.get({})
  const map = new Map<string, string>()
  for (const c of all) {
    if (!/(^|\.)douban\.com$/i.test(c.domain ?? '')) continue
    map.set(c.name, c.value)
  }
  const cookie = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  return { cookie, loggedIn: isLoggedInCookie(cookie) }
}

async function saveCookie(cookie: string): Promise<void> {
  if (!cookie) return
  cookieString = cookie
  updatedAt = Date.now()
  await persist()
}

/** 打开登录窗口；窗口关闭或检测到登录 Cookie 后返回最新状态 */
export async function openDoubanLogin(parent: BrowserWindow | null): Promise<DoubanAuthStatus> {
  const win = new BrowserWindow({
    width: 480,
    height: 760,
    parent: parent ?? undefined,
    title: '豆瓣登录',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  await win.loadURL(LOGIN_URL)

  return await new Promise<DoubanAuthStatus>((resolve) => {
    let finished = false
    const finish = async () => {
      if (finished) return
      finished = true
      clearInterval(timer)
      const captured = await captureCookies().catch(() => null)
      if (captured?.loggedIn) await saveCookie(captured.cookie)
      resolve(doubanAuthStatus())
    }
    const timer = setInterval(async () => {
      if (finished) return
      const captured = await captureCookies().catch(() => null)
      if (!captured?.loggedIn) return
      await saveCookie(captured.cookie)
      finished = true
      clearInterval(timer)
      if (!win.isDestroyed()) win.close()
      resolve(doubanAuthStatus())
    }, 1500)
    win.on('closed', () => void finish())
  })
}

export async function logoutDouban(): Promise<DoubanAuthStatus> {
  cookieString = ''
  updatedAt = Date.now()
  await persist()
  try {
    await session.fromPartition(PARTITION).clearStorageData({ storages: ['cookies'] })
  } catch (err) {
    console.error('[douban] 清除登录 Cookie 失败', err)
  }
  return doubanAuthStatus()
}
