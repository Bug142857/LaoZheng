import { session } from 'electron'

/**
 * x99dh 导航站：爽看各站点（肉视频 / Pornhub / XVIDEOS / xhamster / 亚洲素人精选）共用。
 *
 * 导航站把站点列表 base64 + URI 编码后塞在脚本里，每条包含名称与多条线路。
 * 站点自身统一用 /status.html 探活（返回 ok），根路径会返回「继续访问」门页，
 * 因此所有请求都要带 Cookie x-index-auth=authed。
 */

export const GO_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
export const GO_MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
export const GO_COOKIE = 'x-index-auth=authed'
export const GO_PH_COOKIE =
  'x-index-auth=authed; accessAgeDisclaimerPH=1; age_verified=1; accessPH=1'
export const GO_HOME = 'https://x99dh.net/'

const TIMEOUT_MS = 20_000
const PROBE_TIMEOUT_MS = 8_000
const BASE_TTL = 10 * 60 * 1000
const SITES_TTL = 10 * 60 * 1000

export class GoNetworkError extends Error {}

export interface FetchOptions {
  timeout?: number
  allowErrorStatus?: boolean
  ua?: string
  cookie?: string
  accept?: string
  language?: string
  /** 走 Node 的网络栈而不是 Chromium：XVIDEOS 镜像会把 Chromium 的请求判成 404/500 */
  nodeFetch?: boolean
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
}

export function text(value: string | undefined | null): string {
  return decodeEntities(String(value ?? '').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

export function attr(
  node: { getAttribute: (name: string) => string | undefined } | null | undefined,
  name: string
): string {
  return node?.getAttribute(name)?.trim() ?? ''
}

export function originOf(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (!value) return ''
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).origin
  } catch {
    return ''
  }
}

export function absoluteUrl(raw: string, base: string): string {
  const value = raw.trim()
  if (!value) return ''
  if (/^https?:/i.test(value)) return value
  try {
    return new URL(value, base).href
  } catch {
    return ''
  }
}

/** 部分镜像节点会返回一段 JS 算术验证页（document.cookie=KEY=...），Electron 里无法执行 */
export function isChallengePage(html: string): boolean {
  return html.length < 30_000 && /leastFactor|document\.cookie\s*=\s*["']KEY=/.test(html)
}

function readResponseText(res: Response, options: FetchOptions): Promise<string> {
  if (!options.allowErrorStatus && res.status === 404) return Promise.reject(new Error('页面不存在（404）'))
  if (!options.allowErrorStatus && (res.status >= 500 || res.status === 429)) {
    return Promise.reject(new GoNetworkError(`站点返回 HTTP ${res.status}`))
  }
  if (!options.allowErrorStatus && !res.ok) {
    return Promise.reject(new GoNetworkError(`站点返回 HTTP ${res.status}`))
  }
  return res.text().then((body) => {
    if (!body) throw new Error('站点返回了空页面')
    if (isChallengePage(body)) throw new GoNetworkError('站点要求浏览器验证')
    return body
  })
}

export async function fetchText(
  url: string,
  referer?: string,
  options: FetchOptions = {}
): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent': options.ua || GO_UA,
    Accept:
      options.accept || 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': options.language || 'zh-CN,zh;q=0.9',
    ...(options.cookie ? { Cookie: options.cookie } : {}),
    ...(referer ? { Referer: referer } : {})
  }
  if (options.nodeFetch) {
    let nodeRes: Response
    try {
      nodeRes = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeout ?? TIMEOUT_MS)
      })
    } catch {
      throw new GoNetworkError('连不上站点')
    }
    return readResponseText(nodeRes, options)
  }
  let res: Response
  try {
    res = await session.defaultSession.fetch(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeout ?? TIMEOUT_MS)
    })
  } catch {
    throw new GoNetworkError('连不上站点')
  }
  return readResponseText(res, options)
}

/** status.html 固定返回 ok，体积最小，作为探活接口 */
export async function probeSite(base: string, cookie?: string): Promise<boolean> {
  try {
    const body = await fetchText(`${base}/status.html`, `${base}/`, {
      timeout: PROBE_TIMEOUT_MS,
      cookie
    })
    return body.trim().toLowerCase() === 'ok'
  } catch {
    return false
  }
}

export interface GoSite {
  name: string
  origins: string[]
}

let sitesCache: { at: number; list: GoSite[] } | null = null
let sitesTask: Promise<GoSite[]> | null = null

/** 导航站发布的全部站点与线路，缓存 10 分钟 */
export async function goSites(force = false): Promise<GoSite[]> {
  if (!force && sitesCache && Date.now() - sitesCache.at < SITES_TTL) return sitesCache.list
  if (!force && sitesTask) return sitesTask
  let task: Promise<GoSite[]>
  task = (async () => {
    try {
      const html = await fetchText(GO_HOME, GO_HOME, {
        timeout: PROBE_TIMEOUT_MS,
        allowErrorStatus: true
      })
      const matched = /["'](JTVC[A-Za-z0-9+/=]{80,})["']/.exec(html)
      if (!matched) return []
      const json = decodeURIComponent(Buffer.from(matched[1], 'base64').toString('utf8'))
      const list = JSON.parse(json) as Array<{
        name?: string
        url?: string
        urls?: Array<{ url?: string; testUrl?: string }>
      }>
      const out: GoSite[] = []
      for (const entry of list) {
        const origins: string[] = []
        const push = (raw?: string): void => {
          const origin = originOf(raw)
          if (origin && !origins.includes(origin)) origins.push(origin)
        }
        push(entry?.url)
        for (const item of entry?.urls ?? []) push(item?.url || item?.testUrl)
        if (!origins.length) continue
        out.push({ name: String(entry?.name ?? ''), origins })
      }
      return out
    } catch {
      return []
    }
  })()
    .then((list) => {
      // 导航站偶发打不开时不要缓存空列表，否则接下来 10 分钟所有爽看源都会被判成不可用
      if (list.length) sitesCache = { at: Date.now(), list }
      return list
    })
    .finally(() => {
      if (sitesTask === task) sitesTask = null
    })
  sitesTask = task
  return task
}

export async function routesFor(match: RegExp): Promise<string[]> {
  const sites = await goSites()
  return sites.find((site) => match.test(site.name))?.origins ?? []
}

/** 优选访问里的线路按顺序并发探活，取第一个可用的 */
export async function pickMirror(
  candidates: string[],
  skip: string,
  cookie?: string
): Promise<string | null> {
  const routes = candidates.filter((route) => route !== skip).slice(0, 30)
  if (!routes.length) return null
  const results = await Promise.all(
    routes.map(async (route) => ({ route, ok: await probeSite(route, cookie) }))
  )
  return results.find((item) => item.ok)?.route ?? null
}

/** 一个站点地址的解析与缓存：先试默认地址，失败再到导航站找同名站点的其他线路 */
export class SiteResolver {
  /** 最近一次实际使用的地址（封面 Referer 用） */
  base = ''

  private readonly defaultBase: string
  private readonly match: RegExp
  private readonly label: string
  private readonly cookie?: string
  /**
   * v0.122：是否为该站点的媒体请求注入站点鉴权。
   * 肉视频的 /api/hls 网关按 UA 分流到随机边缘节点（部分 502 / 401），
   * 注入桌面 UA 反而放大失败率，所以肉视频关闭，其余站点保持开启。
   */
  readonly mediaAuth: boolean
  private cachedBase = ''
  private baseAt = 0
  private resolving: Promise<string> | null = null

  constructor(options: {
    defaultBase: string
    match: RegExp
    label: string
    cookie?: string
    mediaAuth?: boolean
  }) {
    this.defaultBase = options.defaultBase
    this.match = options.match
    this.label = options.label
    this.cookie = options.cookie
    this.mediaAuth = options.mediaAuth !== false
  }

  note(base: string): void {
    if (base) this.base = base
  }

  /** 换线兜底时用它从导航站找同站其它线路 */
  get siteMatch(): RegExp {
    return this.match
  }

  async resolve(force = false): Promise<string> {
    if (!force && this.cachedBase && Date.now() - this.baseAt < BASE_TTL) {
      this.base = this.cachedBase
      return this.cachedBase
    }
    if (!force && this.resolving) return this.resolving
    let task: Promise<string>
    task = (async () => {
      if (await probeSite(this.defaultBase, this.cookie)) {
        this.cachedBase = this.defaultBase
        this.baseAt = Date.now()
        this.base = this.defaultBase
        return this.defaultBase
      }
      const mirror = await pickMirror(
        await routesFor(this.match),
        this.defaultBase,
        this.cookie
      )
      if (!mirror) throw new Error(`${this.label} 的所有镜像线路当前都打不开（站点侧故障），请稍后再试或先换其他源`)
      this.cachedBase = mirror
      this.baseAt = Date.now()
      this.base = mirror
      return mirror
    })().finally(() => {
      if (this.resolving === task) this.resolving = null
    })
    this.resolving = task
    return task
  }
}

/**
 * 片源管理里配置的地址优先；连不上或遇到验证页时走自动换址。
 * 非网络错误（404 / 参数错误）直接抛出，避免无意义换址。
 * 探活只测 /status.html，防不住「探活 ok 但内容页 500 / 只发提示片」的节点，
 * 所以最后会把导航站的其它线路用真实路径逐个试一遍。
 */
export async function requestSite(
  resolver: SiteResolver,
  path: string,
  baseUrl: string | undefined,
  options: FetchOptions = {}
): Promise<{ html: string; base: string }> {
  const tried = new Set<string>()
  let lastError: unknown = null
  const tryFetch = async (base: string): Promise<{ html: string; base: string } | null> => {
    tried.add(base)
    try {
      const html = await fetchText(`${base}${path}`, `${base}/`, options)
      resolver.note(base)
      if (resolver.mediaAuth) noteShuangkanMediaBase(base)
      return { html, base }
    } catch (err) {
      lastError = err
      if (!(err instanceof GoNetworkError)) throw err
      return null
    }
  }
  const preferred = originOf(baseUrl)
  if (preferred) {
    const ok = await tryFetch(preferred)
    if (ok) return ok
  }
  try {
    const base = await resolver.resolve()
    if (!tried.has(base)) {
      const ok = await tryFetch(base)
      if (ok) return ok
    }
  } catch (err) {
    if (!(err instanceof GoNetworkError)) throw err
    lastError = err
  }
  try {
    const fresh = await resolver.resolve(true)
    if (!tried.has(fresh)) {
      const ok = await tryFetch(fresh)
      if (ok) return ok
    }
  } catch (err) {
    if (!(err instanceof GoNetworkError)) throw err
    lastError = err
  }
  const routes = (await routesFor(resolver.siteMatch)).filter((route) => !tried.has(route))
  for (const route of routes.slice(0, 8)) {
    const ok = await tryFetch(route)
    if (ok) return ok
  }
  throw lastError instanceof Error ? lastError : new GoNetworkError('站点无法访问')
}

/* ---------------- 播放请求鉴权 ---------------- */

/** 媒体请求鉴权：站点 Referer + Cookie + UA。缺 Cookie / Referer 只返回几秒提示片 */
export interface SkMediaAuth {
  referer?: string
  cookie?: string
  ua?: string
}

/**
 * 域名 → 鉴权。两个来源：
 * 1. requestSite / psite getHtml 成功后登记站点主域；
 * 2. 站点主域的播放请求重定向到 CDN 网关（jre*.vc*.top 等）时，
 *    onBeforeRedirect 把新域名也登记上——实测 CDN 对每个请求（master / variant / 分片 / AES key）
 *    都做鉴权检查，漏了就只回提示片。
 */
const skMediaHosts = new Map<string, SkMediaAuth>()

/** 按域名挑 Cookie / Referer：P 站镜像用 P 站登录态，其余用肉视频登录态 */
function skMediaAuthFor(hostname: string): SkMediaAuth {
  return {
    referer: `https://${hostname}/`,
    cookie: /pornhub/.test(hostname) ? GO_PH_COOKIE : GO_COOKIE,
    ua: GO_UA
  }
}

/** 每次成功请求站点后登记域名，渲染层播放请求按此补 Cookie / Referer */
export function noteShuangkanMediaBase(base: string): void {
  try {
    const url = new URL(base)
    if (/^https?:$/.test(url.protocol)) skMediaHosts.set(url.hostname, skMediaAuthFor(url.hostname))
  } catch {
    // 忽略非法地址
  }
}

/** 直接登记一份鉴权（肉视频 UA 探测用：只登记可用 UA，不注入 Cookie / Referer；重复探测以最新为准） */
export function noteShuangkanMediaAuth(host: string, auth: SkMediaAuth): void {
  if (host) skMediaHosts.set(host, auth)
}

/** 播放请求重定向到 CDN 网关时，把新域名继承同一份鉴权登记上 */
export function noteShuangkanMediaRedirect(fromUrl: string, redirectUrl: string): void {
  try {
    const auth = skMediaHosts.get(new URL(fromUrl).hostname)
    if (!auth) return
    const to = new URL(redirectUrl)
    if (/^https?:$/.test(to.protocol)) skMediaHosts.set(to.hostname, auth)
  } catch {
    // 忽略非法地址
  }
}

export function shuangkanMediaAuth(url: URL): SkMediaAuth | null {
  return skMediaHosts.get(url.hostname) ?? null
}

/** 媒体探测候选 UA：移动 UA（默认） / 站点同款桌面 UA / 新版桌面 Chrome */
export const SK_MEDIA_UA_CANDIDATES: string[] = [
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  GO_UA,
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
]

/**
 * 串行探测播放地址在哪个 UA 下能拿到正常清单（200 + #EXTM3U）。
 * 肉视频网关按 UA 分流到不同边缘节点，部分节点会整段时间 502：
 * 实测同一视频「移动 UA → 正常 200 / 桌面 UA → 一直 502」。
 * 必须串行——并发发多个不同 UA 会互相干扰会话粘性，反而全部失败。
 *
 * 注意：网关每次请求都会重新分流到随机节点，所以**不要把探测命中的节点地址锁死**
 * 给播放器（那个节点随时可能变坏），只取「哪个 UA 能用」，播放地址仍交给渲染层走
 * 原始 /api/hls 入口，让每次请求（含 hls.js 重试）都能重新抽一次节点。
 */
export async function resolveSkMediaPlay(
  playUrl: string,
  candidates: string[] = SK_MEDIA_UA_CANDIDATES,
  timeoutMs = 8_000
): Promise<{ url: string; ua: string } | null> {
  if (!/^https?:\/\//i.test(playUrl) || !candidates.length) return null
  for (const ua of candidates) {
    try {
      const res = await fetch(playUrl, {
        headers: { 'User-Agent': ua, Accept: '*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs)
      })
      const body = await res.text()
      if (res.status !== 200 || !body.includes('#EXTM3U')) continue
      const hit = { url: res.url || playUrl, ua }
      // UA 登记到入口域名与最终节点域名：直接给最终地址时不会再有重定向事件继承鉴权
      try {
        skMediaHosts.set(new URL(playUrl).hostname, { ua })
        skMediaHosts.set(new URL(hit.url).hostname, { ua })
      } catch {
        // 忽略非法地址
      }
      return hit
    } catch {
      // 换下一个候选 UA
    }
  }
  return null
}

/* ---------------- 封面图鉴权 ---------------- */

const imageHosts = new Set<string>()
/** 封面域名 → 抓取它时用的站点地址（封面 Referer 要跟源地址一致） */
const imageBases = new Map<string, string>()

export function trackImages(urls: string[], baseUrl?: string): void {
  const base = originOf(baseUrl)
  for (const raw of urls) {
    try {
      const url = new URL(raw)
      if (!/^https?:$/.test(url.protocol)) continue
      imageHosts.add(url.hostname)
      if (base) imageBases.set(url.hostname, base)
    } catch {
      // 相对地址没有独立 CDN 域名，不需要额外请求头
    }
  }
}

/** 封面 CDN 需要站点 Referer 与浏览器 UA，否则可能 403 */
export function imageAuth(url: URL): { referer: string; ua: string } | null {
  if (!imageHosts.has(url.hostname)) return null
  const base = imageBases.get(url.hostname) || 'https://rou07.net'
  return { referer: `${base}/`, ua: GO_UA }
}

export function clampPage(page: number): number {
  return Math.max(1, Math.min(20_000, Math.floor(page) || 1))
}
