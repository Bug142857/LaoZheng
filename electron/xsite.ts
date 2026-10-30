import type {
  XCategoriesResponse,
  XCategory,
  XDetail,
  XDetailResponse,
  XListResponse,
  XPost
} from '../src/shared/xsite'

/** X站（pektino.com）客户端：Next.js 官方 JSON API，与手机端 XSiteClient.kt 同口径 */

const BASE = 'https://pektino.com'
const API = `${BASE}/api`
const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const PER_PAGE = 50

let cachedCategories: XCategory[] | null = null
let cachedTagNames: Map<number, string> | null = null

const FALLBACK_CATEGORIES: XCategory[] = [
  { id: -1, name: '业余', code: 'shirouto' },
  { id: -1, name: '丰胸', code: 'kyonyu' },
  { id: -1, name: '自我表达', code: 'masturbation' },
  { id: -1, name: '美少女', code: 'beautiful-girl' },
  { id: -1, name: '女高中生', code: 'jk' },
  { id: -1, name: '角色扮演', code: 'cosplay' },
  { id: -1, name: '姐姐', code: 'big-sister' },
  { id: -1, name: '自摄', code: 'hamedori' },
  { id: -1, name: '私人拍摄', code: 'personal-filming' },
  { id: -1, name: '户外场景', code: 'outdoor' },
  { id: -1, name: '群体场景', code: 'orgy' },
  { id: -1, name: '动漫 / 二次元', code: 'anime' },
  { id: -1, name: '男同性恋・男娘', code: 'gay' },
  { id: -1, name: 'SM 题材', code: 'sm' },
  { id: -1, name: '家庭主题', code: 'incest' },
  { id: -1, name: '口部艺术', code: 'fellatio' }
]

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json,text/plain,*/*',
      Referer: `${BASE}/zh-CN`
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function numberOrString(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? '0'), 10)
  return Number.isFinite(n) ? n : 0
}

function normalizeMediaUrl(raw: string): string {
  let url = raw.trim().replace(/\\\//g, '/')
  if (url.startsWith('//')) url = `https:${url}`
  return url
}

function mapPost(o: Record<string, unknown>): XPost | null {
  const url = normalizeMediaUrl(
    typeof o.url === 'string'
      ? o.url
      : typeof o.video_url === 'string'
        ? o.video_url
        : typeof o.play_url === 'string'
          ? o.play_url
          : ''
  )
  const urlCd = typeof o.url_cd === 'string' ? o.url_cd : ''
  if (!url.startsWith('http') || !urlCd) return null
  const thumb = typeof o.thumbnail === 'string' && o.thumbnail.startsWith('http') ? o.thumbnail : null
  const tweet = typeof o.tweet_url === 'string' && o.tweet_url.startsWith('http') ? o.tweet_url : null
  return {
    urlCd,
    mediaId: numberOrString(o.id),
    videoUrl: url,
    thumbnail: thumb,
    durationSec: numberOrString(o.time),
    favorite: numberOrString(o.favorite),
    pv: numberOrString(o.pv),
    comments: numberOrString(o.commentCount),
    account: typeof o.tweet_account === 'string' ? o.tweet_account.replace(/^@/, '') : '',
    tweetUrl: tweet
  }
}

async function ensureTags(): Promise<void> {
  if (cachedCategories) return
  try {
    const raw = JSON.parse(await getText(`${API}/tags`)) as unknown
    if (!Array.isArray(raw)) return
    const categories: XCategory[] = []
    const names = new Map<number, string>()
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const code = typeof o.code === 'string' ? o.code : ''
      if (!code) continue
      const id = numberOrString(o.id)
      const name =
        (typeof o.name_zh_cn === 'string' && o.name_zh_cn) ||
        (typeof o.name === 'string' && o.name) ||
        code
      if (id >= 0) names.set(id, name)
      if (!o.is_language) categories.push({ id, name, code })
    }
    if (categories.length) {
      cachedCategories = categories
      cachedTagNames = names
    }
  } catch {
    // 保留兜底分类
  }
}

export async function xCategories(): Promise<XCategoriesResponse> {
  await ensureTags()
  return { ok: true, items: cachedCategories ?? FALLBACK_CATEGORIES }
}

export async function xList(
  range: string,
  page: number,
  category: string
): Promise<XListResponse> {
  try {
    const params = new URLSearchParams({
      range: range || 'weekly',
      page: String(Math.max(1, page)),
      per_page: String(PER_PAGE),
      sort: 'favorite',
      lang: 'zh-CN'
    })
    if (category) params.set('category', category)
    const raw = JSON.parse(await getText(`${API}/media?${params.toString()}`)) as Record<
      string,
      unknown
    >
    const list = Array.isArray(raw.items) ? raw.items : []
    const items = list
      .map((v) => (v && typeof v === 'object' ? mapPost(v as Record<string, unknown>) : null))
      .filter((v): v is XPost => !!v)
    return {
      ok: true,
      page: {
        items,
        page: numberOrString(raw.currentPage) || page,
        lastPage: numberOrString(raw.lastPage),
        total: numberOrString(raw.total)
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '加载失败' }
  }
}

export async function xDetail(urlCd: string): Promise<XDetailResponse> {
  try {
    await ensureTags()
    const raw = JSON.parse(
      await getText(`${API}/media/${encodeURIComponent(urlCd)}`)
    ) as Record<string, unknown>
    const url = typeof raw.url === 'string' ? raw.url : ''
    if (!url.startsWith('http')) return { ok: false, error: '视频不存在或已被删除' }
    const tagIds = Array.isArray(raw.tags)
      ? raw.tags
          .map((t) => (t && typeof t === 'object' ? numberOrString((t as Record<string, unknown>).tag_id) : -1))
          .filter((id) => id >= 0)
      : []
    const tags = tagIds.map((id) => cachedTagNames?.get(id)).filter((n): n is string => !!n)
    const post = mapPost({ ...raw, url_cd: raw.url_cd ?? urlCd })
    if (!post) return { ok: false, error: '视频数据不完整' }
    const detail: XDetail = {
      post,
      tags,
      postedAt: typeof raw.posted_at === 'string' ? raw.posted_at : ''
    }
    return { ok: true, detail }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '加载失败' }
  }
}
