import type {
  KomiicCategoriesResponse,
  KomiicCategory,
  KomiicChapter,
  KomiicChaptersResponse,
  KomiicComic,
  KomiicDetailResponse,
  KomiicImagesResponse,
  KomiicListResponse
} from '../src/shared/komiic'
import { KOMIIC_PAGE_SIZE } from '../src/shared/komiic'
import { clearToken, getCredentials, getToken, getTokenAt, setAccountStatus, setToken } from './accounts'

/**
 * Komiic 漫画 API（komiic.com，GraphQL）。
 * - 登录 POST /api/login → token（24h），token 自动续期，用户无感；
 * - 列表/详情匿名可用，但章节图自 2026-10 起必须带 komiic-access-token Cookie（否则 402）；
 * - 章节图防盗链要求完整路径 Referer，图片 URL 追加 ?c=漫画ID&ch=章节ID，由主进程请求头注入；
 * - 双主机自动回退（komiic.com / komiic.cc）。
 */

const HOSTS = ['https://komiic.com', 'https://komiic.cc']
const UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const TIMEOUT_MS = 20_000
const TOKEN_TTL_MS = 20 * 60 * 60 * 1000

let activeHostIdx = 0

export class KomiicAuthError extends Error {}
export class KomiicNetworkError extends Error {}

type Json = Record<string, unknown>

const asObj = (v: unknown): Json | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string => {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return ''
}
const num = (v: unknown): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number.parseInt(v, 10) || 0
  return 0
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof KomiicNetworkError) return true
  const name = (err as Error)?.name ?? ''
  return name === 'TimeoutError' || name === 'AbortError' || name === 'TypeError'
}

export function komiicErrorMessage(err: unknown): string {
  if (err instanceof KomiicAuthError) return err.message
  if (err instanceof KomiicNetworkError) return err.message
  if (isNetworkError(err)) return '网络不通或超时，请稍后重试'
  return (err as Error)?.message || '请求失败'
}

const FIELDS =
  'id title status imageUrl authors { id name } categories { id name } dateUpdated lastChapterUpdate monthViews views favoriteCount'

const Q_RECENT = `query recentUpdate($pagination: Pagination!) { recentUpdate(pagination: $pagination) { ${FIELDS} } }`
const Q_HOT = `query hotComics($pagination: Pagination!) { hotComics(pagination: $pagination) { ${FIELDS} } }`
const Q_BY_CATEGORY = `query comicByCategories($categoryId: [ID!]!, $pagination: Pagination!) { comicByCategories(categoryId: $categoryId, pagination: $pagination) { ${FIELDS} } }`
const Q_SEARCH = `query searchComics($keyword: String!, $pagination: Pagination!) { searchComics(keyword: $keyword, pagination: $pagination) { ${FIELDS} } }`
const Q_ALL_CATEGORY = 'query allCategory { allCategory { id name } }'
const Q_COMIC_BY_ID = `query comicById($comicId: ID!) { comicById(comicId: $comicId) { ${FIELDS} } }`
const Q_CHAPTERS =
  'query chapterByComicId($comicId: ID!) { chaptersByComicId(comicId: $comicId) { id serial type size } }'
const Q_IMAGES =
  'query imagesByChapterId($chapterId: ID!) { imagesByChapterId(chapterId: $chapterId) { id kid height width } }'

function paginationVars(offset: number, orderBy: string, status = ''): Json {
  return {
    pagination: {
      limit: KOMIIC_PAGE_SIZE,
      offset: Math.max(0, offset),
      orderBy,
      status,
      asc: false
    }
  }
}

function isAuthMessage(message: string): boolean {
  const m = message.toLowerCase()
  return (
    (m.includes('token') &&
      (m.includes('expired') || m.includes('invalid') || m.includes('no token') || m.includes('not found'))) ||
    m.includes('unauthorized') ||
    message.includes('请登录') ||
    message.includes('未登录')
  )
}

/** 用内置账密登录，返回 token */
export async function komiicSignIn(): Promise<string> {
  const creds = getCredentials('komiic')
  if (!creds) {
    setAccountStatus('komiic', 'failed', '未内置 Komiic 账号')
    throw new KomiicAuthError('未内置 Komiic 账号')
  }
  let lastErr: unknown = null
  for (const base of HOSTS) {
    try {
      const res = await fetch(`${base}/api/login`, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Origin: base,
          Referer: `${base}/login`
        },
        body: JSON.stringify({ email: creds.username, password: creds.password }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      const text = await res.text()
      if (!res.ok) throw new KomiicNetworkError(`登录失败 HTTP ${res.status}`)
      let root: Json | null = null
      try {
        root = asObj(JSON.parse(text))
      } catch {
        throw new KomiicNetworkError('登录响应不是 JSON')
      }
      const token = str(root?.token)
      if (!token) {
        throw new KomiicAuthError(str(root?.message) || '登录失败：未返回 token')
      }
      activeHostIdx = HOSTS.indexOf(base)
      setToken('komiic', token)
      setAccountStatus('komiic', 'ok', `已自动登录（${creds.username}）`)
      return token
    } catch (err) {
      lastErr = err
      if (err instanceof KomiicAuthError) break
    }
  }
  const message = komiicErrorMessage(lastErr)
  setAccountStatus('komiic', lastErr instanceof KomiicAuthError ? 'failed' : 'unknown', `登录失败：${message}`)
  throw lastErr instanceof Error ? lastErr : new KomiicAuthError(message)
}

function cachedToken(): string {
  const token = getToken('komiic')
  if (!token) return ''
  if (Date.now() - getTokenAt('komiic') > TOKEN_TTL_MS) return ''
  return token
}

async function ensureToken(force = false): Promise<string> {
  const token = force ? '' : cachedToken()
  if (token) return token
  return komiicSignIn()
}

async function postOnce(
  base: string,
  token: string,
  operation: string,
  query: string,
  variables: Json
): Promise<Json> {
  let res: Response
  try {
    res = await fetch(`${base}/api/query`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json',
        Accept: '*/*',
        Origin: base,
        Referer: `${base}/`,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ operationName: operation, query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    throw isNetworkError(err) ? new KomiicNetworkError('连不上 Komiic') : err
  }
  const text = await res.text()
  if (res.status === 401) throw new KomiicAuthError('Komiic 登录已失效')
  if (!res.ok) throw new KomiicNetworkError(`Komiic 接口 HTTP ${res.status}`)
  let root: Json | null = null
  try {
    root = asObj(JSON.parse(text))
  } catch {
    throw new KomiicNetworkError('Komiic 接口返回了非 JSON 内容')
  }
  const errors = asArr(root?.errors)
  if (errors.length) {
    const message = str(asObj(errors[0])?.message) || 'Komiic 接口错误'
    if (isAuthMessage(message)) throw new KomiicAuthError(message)
    throw new KomiicNetworkError(message)
  }
  const data = asObj(root?.data)
  if (!data) throw new KomiicNetworkError('Komiic 响应数据为空')
  return data
}

async function post(operation: string, query: string, variables: Json): Promise<Json> {
  let token = await ensureToken()
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    for (let i = 0; i < HOSTS.length; i++) {
      const idx = (activeHostIdx + i) % HOSTS.length
      try {
        const data = await postOnce(HOSTS[idx], token, operation, query, variables)
        activeHostIdx = idx
        return data
      } catch (err) {
        lastErr = err
        if (err instanceof KomiicAuthError) break
      }
    }
    if (lastErr instanceof KomiicAuthError && attempt === 0) {
      clearToken('komiic')
      token = await komiicSignIn()
      continue
    }
    break
  }
  throw lastErr instanceof Error ? lastErr : new KomiicNetworkError('Komiic 接口不可用')
}

function parseComic(value: unknown): KomiicComic | null {
  const o = asObj(value)
  if (!o) return null
  const id = str(o.id)
  if (!id) return null
  return {
    id,
    title: str(o.title) || '无标题',
    status: str(o.status),
    imageUrl: str(o.imageUrl),
    authors: asArr(o.authors)
      .map((a) => asObj(a))
      .filter((a): a is Json => !!a)
      .map((a) => ({ id: str(a.id), name: str(a.name) })),
    categories: asArr(o.categories)
      .map((c) => asObj(c))
      .filter((c): c is Json => !!c)
      .map((c) => ({ id: str(c.id), name: str(c.name) })),
    dateUpdated: str(o.dateUpdated),
    lastChapterUpdate: str(o.lastChapterUpdate),
    monthViews: num(o.monthViews),
    views: num(o.views),
    favoriteCount: num(o.favoriteCount)
  }
}

function parseComicList(data: Json, key: string): KomiicListResponse {
  const items = asArr(data[key]).map(parseComic).filter((c): c is KomiicComic => !!c)
  return { ok: true, items }
}

function listResult(fn: () => Promise<KomiicListResponse>): Promise<KomiicListResponse> {
  return fn().catch((err) => ({ ok: false, items: [], error: komiicErrorMessage(err) }))
}

export function komiicRecent(offset: number): Promise<KomiicListResponse> {
  return listResult(async () => {
    const data = await post('recentUpdate', Q_RECENT, paginationVars(offset, 'DATE_UPDATED'))
    return parseComicList(data, 'recentUpdate')
  })
}

export function komiicHot(offset: number): Promise<KomiicListResponse> {
  return listResult(async () => {
    const data = await post('hotComics', Q_HOT, paginationVars(offset, 'MONTH_VIEWS'))
    return parseComicList(data, 'hotComics')
  })
}

export function komiicByCategory(categoryId: string, offset: number): Promise<KomiicListResponse> {
  return listResult(async () => {
    const data = await post('comicByCategories', Q_BY_CATEGORY, {
      categoryId: [categoryId],
      ...paginationVars(offset, 'DATE_UPDATED')
    })
    return parseComicList(data, 'comicByCategories')
  })
}

export function komiicSearch(keyword: string, offset: number): Promise<KomiicListResponse> {
  return listResult(async () => {
    const data = await post('searchComics', Q_SEARCH, {
      keyword,
      ...paginationVars(offset, 'DATE_UPDATED')
    })
    return parseComicList(data, 'searchComics')
  })
}

export async function komiicCategories(): Promise<KomiicCategoriesResponse> {
  try {
    const data = await post('allCategory', Q_ALL_CATEGORY, {})
    const items: KomiicCategory[] = asArr(data.allCategory)
      .map((c) => asObj(c))
      .filter((c): c is Json => !!c)
      .map((c) => ({ id: str(c.id), name: str(c.name) }))
      .filter((c) => !!c.id && !!c.name)
    return { ok: true, items }
  } catch (err) {
    return { ok: false, items: [], error: komiicErrorMessage(err) }
  }
}

export async function komiicDetail(id: string): Promise<KomiicDetailResponse> {
  try {
    const data = await post('comicById', Q_COMIC_BY_ID, { comicId: id })
    const comic = parseComic(data.comicById)
    if (!comic) return { ok: false, comic: null, error: '站点返回空数据' }
    return { ok: true, comic }
  } catch (err) {
    return { ok: false, comic: null, error: komiicErrorMessage(err) }
  }
}

export async function komiicChapters(comicId: string): Promise<KomiicChaptersResponse> {
  try {
    const data = await post('chapterByComicId', Q_CHAPTERS, { comicId })
    const items: KomiicChapter[] = asArr(data.chaptersByComicId)
      .map((c) => asObj(c))
      .filter((c): c is Json => !!c)
      .map((c) => ({
        id: str(c.id),
        serial: str(c.serial),
        type: str(c.type),
        size: num(c.size)
      }))
      .filter((c) => !!c.id)
    return { ok: true, items }
  } catch (err) {
    return { ok: false, items: [], error: komiicErrorMessage(err) }
  }
}

export async function komiicImages(
  comicId: string,
  chapterId: string
): Promise<KomiicImagesResponse> {
  try {
    const data = await post('imagesByChapterId', Q_IMAGES, { chapterId })
    const host = HOSTS[activeHostIdx]
    const urls: string[] = []
    for (const el of asArr(data.imagesByChapterId)) {
      const kid = str(asObj(el)?.kid)
      if (!kid) continue
      urls.push(
        `${host}/api/image/${encodeURIComponent(kid)}?c=${encodeURIComponent(comicId)}&ch=${encodeURIComponent(chapterId)}`
      )
    }
    return { ok: true, urls }
  } catch (err) {
    return { ok: false, urls: [], error: komiicErrorMessage(err) }
  }
}

/** 启动时校验登录态（登录接口 + 一个轻量查询） */
export async function komiicEnsureLogin(): Promise<boolean> {
  try {
    if (!cachedToken()) await komiicSignIn()
    await post('allCategory', Q_ALL_CATEGORY, {})
    setAccountStatus('komiic', 'ok', '已登录（内置账号）')
    return true
  } catch (err) {
    if (isNetworkError(err)) {
      setAccountStatus('komiic', 'unknown', '网络不通，用到时会自动重试')
    } else {
      setAccountStatus('komiic', 'failed', komiicErrorMessage(err))
    }
    return false
  }
}

/** 给章节图请求注入登录 Cookie 与防盗链 Referer */
export function komiicImageAuth(url: URL): { cookie: string; referer: string } | null {
  if (!/(^|\.)komiic\.(com|cc)$/.test(url.hostname)) return null
  if (!url.pathname.startsWith('/api/image/')) return null
  const token = getToken('komiic')
  if (!token) return null
  const comicId = url.searchParams.get('c') ?? ''
  const chapterId = url.searchParams.get('ch') ?? ''
  const referer =
    comicId && chapterId
      ? `${url.origin}/comic/${encodeURIComponent(comicId)}/chapter/${encodeURIComponent(chapterId)}`
      : `${url.origin}/`
  return { cookie: `komiic-access-token=${token}`, referer }
}
