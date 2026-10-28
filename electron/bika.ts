import { createHmac } from 'node:crypto'
import type {
  BikaCategoriesResponse,
  BikaCategory,
  BikaChapter,
  BikaChaptersResponse,
  BikaComic,
  BikaDetailResponse,
  BikaImagesResponse,
  BikaListResponse
} from '../src/shared/bika'
import { clearToken, getCredentials, getToken, setAccountStatus, setToken } from './accounts'

/**
 * 哔咔漫画 API（picaapi.picacomic.com）。
 * - 签名：HmacSHA256(SECRET, lowercase(path+query+time+nonce+METHOD+api-key))，签名不含域名；
 * - 双域名自动回退（官方 → go2778 中转），成功域名会话内记忆；
 * - 401 自动用内置账密静默重登，用户无感；
 * - 图片由 fileServer + path 拼接，只需 UA，不需要 token。
 */

const API_KEY = 'C69BAF41DA5ABD1FFEDC6D2FEA56B'
const SECRET = '~d}$Q7$eIni=V)9\\RK/P.RM4;9[7|@/CA}b~OW!3?EV`:<>M7pddUBL5n|0/*Cn'
const NONCE = '4ce7a7aa759b40f794d189a88b84aba8'
const HOSTS = ['https://picaapi.picacomic.com/', 'https://picaapi.go2778.com/']
const TIMEOUT_MS = 18_000

let activeHost = HOSTS[0]

export class BikaAuthError extends Error {}
export class BikaNetworkError extends Error {}

type Json = Record<string, unknown>

const asObj = (v: unknown): Json | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number.parseInt(v, 10) || 0
  return 0
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof BikaNetworkError) return true
  const name = (err as Error)?.name ?? ''
  return name === 'TimeoutError' || name === 'AbortError' || name === 'TypeError'
}

export function bikaErrorMessage(err: unknown): string {
  if (err instanceof BikaAuthError) return err.message
  if (err instanceof BikaNetworkError) return err.message
  if (isNetworkError(err)) return '网络不通或超时（本子需要外网环境，换节点重试）'
  return (err as Error)?.message || '请求失败'
}

function sign(pathWithQuery: string, method: string): { time: string; signature: string } {
  const time = String(Math.floor(Date.now() / 1000))
  const msg = (pathWithQuery + time + NONCE + method + API_KEY).toLowerCase()
  const signature = createHmac('sha256', SECRET).update(msg).digest('hex')
  return { time, signature }
}

function headers(pathWithQuery: string, method: string, token: string): Record<string, string> {
  const { time, signature } = sign(pathWithQuery, method)
  const out: Record<string, string> = {
    accept: 'application/vnd.picacomic.com.v1+json',
    'User-Agent': 'okhttp/3.8.1',
    'Content-Type': 'application/json; charset=UTF-8',
    'api-key': API_KEY,
    'app-build-version': '45',
    'app-platform': 'android',
    'app-uuid': 'defaultUuid',
    'app-version': '2.2.1.3.3.4',
    nonce: NONCE,
    'app-channel': '1',
    time,
    signature,
    'image-quality': 'original'
  }
  if (token) out.authorization = token
  return out
}

async function requestOnce(
  host: string,
  method: string,
  pathWithQuery: string,
  token: string,
  body?: unknown
): Promise<Json> {
  let res: Response
  try {
    res = await fetch(host + pathWithQuery, {
      method,
      headers: headers(pathWithQuery, method, token),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    throw isNetworkError(err) ? new BikaNetworkError('连不上哔咔接口') : err
  }

  const text = await res.text()
  if (res.status === 401) throw new BikaAuthError('哔咔登录已失效')
  if (!res.ok) throw new BikaNetworkError(`哔咔接口 HTTP ${res.status}`)

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BikaNetworkError('哔咔接口返回了非 JSON 内容')
  }
  const root = asObj(parsed) ?? {}
  const code = num(root.code)
  if (code === 401) throw new BikaAuthError('哔咔登录已失效')
  if (code !== 200 && code !== 1) {
    const message = str(root.message) || `哔咔接口错误（${code}）`
    if (/登录|token|auth|unauthor/i.test(message)) throw new BikaAuthError(message)
    throw new BikaNetworkError(message)
  }
  return asObj(root.data) ?? {}
}

async function request(
  method: string,
  pathWithQuery: string,
  token: string,
  body?: unknown
): Promise<Json> {
  const ordered = [activeHost, ...HOSTS.filter((h) => h !== activeHost)]
  let lastErr: unknown = null
  for (const host of ordered) {
    try {
      const data = await requestOnce(host, method, pathWithQuery, token, body)
      activeHost = host
      return data
    } catch (err) {
      if (err instanceof BikaAuthError) throw err
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new BikaNetworkError('哔咔接口不可用')
}

export async function bikaSignIn(): Promise<string> {
  const creds = getCredentials('bika')
  if (!creds) {
    setAccountStatus('bika', 'failed', '未内置哔咔账号')
    throw new BikaAuthError('未内置哔咔账号')
  }
  try {
    const data = await request('POST', 'auth/sign-in', '', {
      email: creds.username,
      password: creds.password
    })
    const token = str(data.token)
    if (!token) throw new BikaAuthError('登录响应缺少 token')
    setToken('bika', token)
    setAccountStatus('bika', 'ok', `已自动登录（${creds.username}）`)
    return token
  } catch (err) {
    if (err instanceof BikaAuthError) {
      setAccountStatus('bika', 'failed', `登录失败：${err.message}`)
    } else {
      setAccountStatus('bika', 'unknown', `登录失败：${bikaErrorMessage(err)}`)
    }
    throw err
  }
}

async function withAuth<T>(fn: (token: string) => Promise<T>): Promise<T> {
  let token = getToken('bika')
  if (!token) token = await bikaSignIn()
  try {
    return await fn(token)
  } catch (err) {
    if (!(err instanceof BikaAuthError)) throw err
    clearToken('bika')
    const fresh = await bikaSignIn()
    return fn(fresh)
  }
}

/** 启动时校验登录态：用最小请求 categories，失效会自动重登 */
export async function bikaEnsureLogin(): Promise<boolean> {
  try {
    await withAuth((token) => request('GET', 'categories', token))
    setAccountStatus('bika', 'ok', '已登录（内置账号）')
    return true
  } catch (err) {
    if (isNetworkError(err)) {
      setAccountStatus('bika', 'unknown', '网络不通（本子需要外网环境），用到时会自动重试')
    } else {
      setAccountStatus('bika', 'failed', bikaErrorMessage(err))
    }
    return false
  }
}

function imageUrl(fileServer: string, path: string): string {
  if (!fileServer || !path) return ''
  let raw = fileServer.includes('static') ? `${fileServer}/${path}` : `${fileServer}/static/${path}`
  raw = raw.replace(/([^:])\/{2,}/g, '$1/')
  if (activeHost.includes('go2778')) raw = raw.replace('picacomic', 'go2778')
  return raw
}

function parseComic(value: unknown): BikaComic | null {
  const o = asObj(value)
  if (!o) return null
  const id = str(o._id)
  if (!id) return null
  return {
    id,
    title: str(o.title) || '无标题',
    author: str(o.author),
    thumb: thumbOf(o.thumb),
    likes: num(o.totalLikes) || num(o.likesCount),
    views: num(o.totalViews),
    finished: o.finished === true || str(o.finished) === 'true',
    categories: asArr(o.categories).map(str).filter(Boolean),
    tags: asArr(o.tags).map(str).filter(Boolean),
    epsCount: num(o.epsCount),
    pagesCount: num(o.pagesCount),
    description: stripHtml(str(o.description)),
    chineseTeam: str(o.chineseTeam),
    updatedAt: str(o.updated_at)
  }
}

function thumbOf(value: unknown): string {
  const o = asObj(value)
  if (!o) return ''
  return imageUrl(str(o.fileServer), str(o.path))
}

function parsePage(value: unknown): BikaListResponse {
  const o = asObj(value)
  if (!o) return { ok: true, items: [], page: 1, pages: 1, total: 0 }
  const items = asArr(o.docs).map(parseComic).filter((c): c is BikaComic => !!c)
  return {
    ok: true,
    items,
    page: num(o.page) || 1,
    pages: num(o.pages) || 1,
    total: num(o.total) || items.length
  }
}

export async function bikaCategories(): Promise<BikaCategoriesResponse> {
  try {
    const data = await withAuth((token) => request('GET', 'categories', token))
    const items: BikaCategory[] = []
    for (const el of asArr(data.categories)) {
      const o = asObj(el)
      if (!o) continue
      if (o.isWeb === true || str(o.isWeb) === 'true') continue
      const title = str(o.title).trim()
      if (!title) continue
      const id = str(o._id) || title
      items.push({ id, title, thumb: thumbOf(o.thumb) })
    }
    return { ok: true, items }
  } catch (err) {
    return { ok: false, items: [], error: bikaErrorMessage(err) }
  }
}

export async function bikaList(
  page: number,
  category: string,
  sort: string
): Promise<BikaListResponse> {
  try {
    const query = new URLSearchParams()
    query.set('page', String(Math.max(1, page)))
    if (category) query.set('c', category)
    query.set('s', sort || 'dd')
    const data = await withAuth((token) => request('GET', `comics?${query.toString()}`, token))
    return parsePage(data.comics)
  } catch (err) {
    return { ok: false, items: [], page, pages: 1, total: 0, error: bikaErrorMessage(err) }
  }
}

export async function bikaSearch(
  keyword: string,
  page: number,
  sort: string
): Promise<BikaListResponse> {
  try {
    const p = Math.max(1, page)
    const data = await withAuth((token) =>
      request('POST', `comics/advanced-search?page=${p}`, token, {
        keyword,
        categories: [],
        sort: sort || 'dd'
      })
    )
    return parsePage(data.comics)
  } catch (err) {
    return { ok: false, items: [], page, pages: 1, total: 0, error: bikaErrorMessage(err) }
  }
}

export async function bikaDetail(id: string): Promise<BikaDetailResponse> {
  try {
    const data = await withAuth((token) => request('GET', `comics/${id}`, token))
    const comic = parseComic(data.comic)
    if (!comic) return { ok: false, comic: null, error: '详情解析失败' }
    return { ok: true, comic }
  } catch (err) {
    return { ok: false, comic: null, error: bikaErrorMessage(err) }
  }
}

async function fetchEpsPage(id: string, page: number): Promise<{ docs: unknown[]; pages: number }> {
  const data = await withAuth((token) => request('GET', `comics/${id}/eps?page=${page}`, token))
  const eps = asObj(data.eps)
  if (!eps) return { docs: [], pages: 1 }
  return { docs: asArr(eps.docs), pages: Math.max(1, num(eps.pages)) }
}

export async function bikaChapters(id: string): Promise<BikaChaptersResponse> {
  try {
    const first = await fetchEpsPage(id, 1)
    const docs = [...first.docs]
    const totalPages = Math.min(first.pages, 30)
    if (totalPages > 1) {
      const rest = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, i) => fetchEpsPage(id, i + 2).catch(() => null))
      )
      for (const page of rest) if (page) docs.push(...page.docs)
    }
    const items: BikaChapter[] = []
    for (const el of docs) {
      const o = asObj(el)
      if (!o) continue
      const cid = str(o._id)
      if (!cid) continue
      items.push({ id: cid, title: str(o.title) || `第 ${num(o.order)} 话`, order: num(o.order) })
    }
    items.sort((a, b) => a.order - b.order)
    return { ok: true, items }
  } catch (err) {
    return { ok: false, items: [], error: bikaErrorMessage(err) }
  }
}

async function fetchPagesOnce(
  id: string,
  order: number,
  page: number
): Promise<{ docs: unknown[]; pages: number }> {
  const data = await withAuth((token) =>
    request('GET', `comics/${id}/order/${order}/pages?page=${page}`, token)
  )
  const pages = asObj(data.pages)
  if (!pages) return { docs: [], pages: 1 }
  return { docs: asArr(pages.docs), pages: Math.max(1, num(pages.pages)) }
}

export async function bikaImages(id: string, order: number): Promise<BikaImagesResponse> {
  try {
    const first = await fetchPagesOnce(id, order, 1)
    const docs = [...first.docs]
    const totalPages = Math.min(first.pages, 40)
    if (totalPages > 1) {
      const rest = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, i) =>
          fetchPagesOnce(id, order, i + 2).catch(() => null)
        )
      )
      for (const page of rest) if (page) docs.push(...page.docs)
    }
    const urls: string[] = []
    for (const el of docs) {
      const o = asObj(el)
      const media = asObj(o?.media)
      if (!media) continue
      const url = imageUrl(str(media.fileServer), str(media.path))
      if (url) urls.push(url)
    }
    return { ok: true, urls }
  } catch (err) {
    return { ok: false, urls: [], error: bikaErrorMessage(err) }
  }
}
