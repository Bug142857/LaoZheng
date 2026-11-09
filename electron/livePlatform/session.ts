import { BrowserWindow, session, type Session } from 'electron'
import { DESKTOP_UA } from './common'

/** 平台直播专用持久化分区：扫码登录、抖音抓流、播放共用一个 Cookie 空间 */
export const LIVE_PARTITION = 'persist:laozheng-live'

let prepared = false

export function liveSession(): Session {
  const ses = session.fromPartition(LIVE_PARTITION)
  if (!prepared) {
    prepared = true
    ses.setUserAgent(DESKTOP_UA)
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  }
  return ses
}

function domainMatches(cookieDomain: string, domains: string[]): boolean {
  const host = cookieDomain.replace(/^\./, '').toLowerCase()
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

export async function readCookieString(
  ses: Session,
  domains: string[],
  markers?: string[]
): Promise<string> {
  const cookies = await ses.cookies.get({})
  const selected = cookies.filter((cookie) => domainMatches(cookie.domain ?? '', domains))
  if (markers?.length) {
    const names = new Set(selected.map((cookie) => cookie.name))
    if (!markers.some((marker) => names.has(marker))) return ''
  }
  return selected.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

export async function hasCookie(ses: Session, domains: string[], markers: string[]): Promise<boolean> {
  return (await readCookieString(ses, domains, markers)) !== ''
}

export async function clearCookies(ses: Session, domains: string[]): Promise<void> {
  const cookies = await ses.cookies.get({})
  await Promise.all(
    cookies
      .filter((cookie) => domainMatches(cookie.domain ?? '', domains))
      .map((cookie) =>
        ses.cookies.remove(
          `http${cookie.secure ? 's' : ''}://${(cookie.domain ?? '').replace(/^\./, '')}${
            cookie.path ?? '/'
          }`,
          cookie.name
        )
      )
  )
}

export interface LoginWindowOptions {
  url: string
  title: string
  /** 出现任意一个 Cookie 名即视为登录成功 */
  markers: string[]
  domains: string[]
  /** 登录成功后要保存的 Cookie 范围（默认与 domains 相同） */
  cookieDomains?: string[]
  timeoutMs?: number
}

export interface LoginWindowResult {
  canceled: boolean
  cookie?: string
}

/**
 * 打开平台官方登录页（扫码 / 短信 / 密码都由页面自己完成），
 * 只负责在登录成功后把 Cookie 读出来并关闭窗口。
 */
export function openLoginWindow(options: LoginWindowOptions): Promise<LoginWindowResult> {
  const ses = liveSession()
  const win = new BrowserWindow({
    width: 460,
    height: 680,
    title: options.title,
    autoHideMenuBar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      partition: LIVE_PARTITION,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  return new Promise<LoginWindowResult>((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout | null = null
    let timeout: NodeJS.Timeout | null = null

    const finish = (result: LoginWindowResult): void => {
      if (settled) return
      settled = true
      if (timer) clearInterval(timer)
      if (timeout) clearTimeout(timeout)
      timer = null
      timeout = null
      if (!win.isDestroyed()) win.close()
      resolve(result)
    }

    timer = setInterval(() => {
      void readCookieString(ses, options.domains, options.markers)
        .then((cookie) => {
          if (cookie) {
            return readCookieString(ses, options.cookieDomains ?? options.domains).then((all) =>
              finish({ canceled: false, cookie: all || cookie })
            )
          }
          return undefined
        })
        .catch(() => undefined)
    }, 1200)

    timeout = setTimeout(() => finish({ canceled: true }), options.timeoutMs ?? 5 * 60 * 1000)

    win.on('closed', () => finish({ canceled: true }))
    win.loadURL(options.url, { userAgent: DESKTOP_UA }).catch(() => undefined)
    win.webContents.on('did-fail-load', (_event, _code, _desc, _url, isMainFrame) => {
      if (isMainFrame) finish({ canceled: true })
    })
  })
}
