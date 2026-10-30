import { normalizeBaseUrl, parsePlayGroups } from '../src/shared/vod'
import type {
  VodCategoriesResponse,
  VodCategory,
  VodDetailResponse,
  VodItem,
  VodListResponse,
  VodSearchItem,
  VodSearchResponse,
  VodSourceInput,
  VodTestResponse
} from '../src/shared/vod'

/**
 * 苹果CMS V10 采集站客户端（与手机端 VodClient.kt 同口径）。
 * 搜索：{base}?ac=videolist&wd=关键词
 * 详情：{base}?ac=videolist&ids=vod_id
 * 播放：vod_play_url 按 $$$ 分组、# 分集、「第一个 $」切名称与地址。
 */

const UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'

function buildUrl(baseUrl: string, params: string): string {
  const base = normalizeBaseUrl(baseUrl)
  return base + (base.includes('?') ? '&' : '?') + params
}

async function getText(url: string, timeoutMs = 10_000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function errorIsNetwork(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true
  return /fetch failed|connect|refused|unreachable|network|timed? ?out/i.test(err.message)
}

interface VodRawResponse {
  code: number
  msg: string
  page: number
  pagecount: number
  total: number
  categories: VodCategory[]
  list: unknown[]
}

function mapCategory(raw: unknown): VodCategory | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const typeId = num(o.type_id)
  if (!typeId) return null
  return {
    type_id: typeId,
    type_pid: num(o.type_pid),
    type_name: str(o.type_name)
  }
}

function parseResponse(body: string): VodRawResponse | null {
  if (!body.trimStart().startsWith('{')) return null
  try {
    const raw = JSON.parse(body) as Record<string, unknown>
    return {
      code: Number(raw.code ?? 0),
      msg: typeof raw.msg === 'string' ? raw.msg : '',
      page: Number(raw.page ?? 1),
      pagecount: Number(raw.pagecount ?? 1),
      total: Number(raw.total ?? 0),
      categories: Array.isArray(raw.class)
        ? raw.class.map(mapCategory).filter((c): c is VodCategory => !!c)
        : [],
      list: Array.isArray(raw.list) ? raw.list : []
    }
  } catch {
    return null
  }
}

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function mapItem(raw: unknown): VodItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = num(o.vod_id)
  if (!id) return null
  return {
    vod_id: id,
    vod_name: str(o.vod_name),
    vod_pic: str(o.vod_pic),
    type_name: str(o.type_name),
    vod_year: str(o.vod_year),
    vod_area: str(o.vod_area),
    vod_remarks: str(o.vod_remarks),
    vod_duration: str(o.vod_duration),
    vod_douban_id: num(o.vod_douban_id),
    vod_play_from: str(o.vod_play_from),
    vod_play_url: str(o.vod_play_url)
  }
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** 精确=3，互相包含=2，同年份 +1；低于 2 分不展示，避免搜出无关片 */
function matchScore(name: string, keyword: string, itemYear: string, keywordYear: string): number {
  const a = normalizeTitle(name)
  const b = normalizeTitle(keyword)
  if (!a || !b) return 0
  let score = a === b ? 3 : a.includes(b) || b.includes(a) ? 2 : 0
  if (
    score > 0 &&
    itemYear.trim() &&
    keywordYear.trim() &&
    itemYear.slice(0, 4) === keywordYear.slice(0, 4)
  ) {
    score += 1
  }
  return score
}

export async function searchVodSource(
  source: VodSourceInput,
  rawKeyword: string,
  keywordYear = ''
): Promise<VodSearchResponse> {
  const keyword = rawKeyword.trim()
  if (!keyword) return { ok: true, items: [] }
  if (!/^https?:\/\//i.test(source.baseUrl)) {
    return { ok: false, items: [], error: '片源地址无效' }
  }
  try {
    const body = await getText(
      buildUrl(source.baseUrl, `ac=videolist&wd=${encodeURIComponent(keyword)}`)
    )
    const resp = parseResponse(body)
    if (!resp) return { ok: false, items: [], error: '返回内容不是有效接口数据' }
    if (resp.code !== 1) {
      return { ok: false, items: [], error: resp.msg || `接口返回 code=${resp.code}` }
    }
    const items: VodSearchItem[] = resp.list
      .map(mapItem)
      .filter((item): item is VodItem => !!item)
      .map((item) => ({
        ...item,
        score: matchScore(item.vod_name, keyword, item.vod_year, keywordYear)
      }))
      .filter((item) => item.score >= 2)
      .sort((a, b) => b.score - a.score)
    return { ok: true, items, total: resp.total }
  } catch (err) {
    return { ok: false, items: [], error: errorIsNetwork(err) ? '连接超时或被拒绝' : '请求失败' }
  }
}

/**
 * 番号浏览：拉某个源的整站列表（kw 为空 = 全库；typeId 非 0 = 按分类过滤）。
 * 对应手机端 VodClient.fetchList：ac=videolist&pg=N[&wd=][&t=]。
 */
export async function listVodSource(
  source: VodSourceInput,
  page: number,
  typeId: number,
  keyword: string
): Promise<VodListResponse> {
  if (!/^https?:\/\//i.test(source.baseUrl)) return { ok: false, error: '片源地址无效' }
  const params = [`ac=videolist`, `pg=${Math.max(1, Math.floor(page) || 1)}`]
  if (typeId > 0) params.push(`t=${typeId}`)
  const kw = keyword.trim()
  if (kw) params.push(`wd=${encodeURIComponent(kw)}`)
  try {
    const body = await getText(buildUrl(source.baseUrl, params.join('&')), 15_000)
    const resp = parseResponse(body)
    if (!resp) return { ok: false, error: '返回内容不是有效接口数据' }
    if (resp.code !== 1) {
      return { ok: false, error: resp.msg || `接口返回 code=${resp.code}` }
    }
    return {
      ok: true,
      items: resp.list.map(mapItem).filter((item): item is VodItem => !!item),
      total: resp.total,
      page: resp.page,
      pageCount: resp.pagecount,
      categories: resp.categories
    }
  } catch (err) {
    return { ok: false, error: errorIsNetwork(err) ? '连接超时或被拒绝' : '请求失败' }
  }
}

/** 分类列表：ac=list 才会带 class（ac=videolist 在多数采集站返回空 class） */
export async function fetchVodCategories(source: VodSourceInput): Promise<VodCategoriesResponse> {
  if (!/^https?:\/\//i.test(source.baseUrl)) return { ok: false, error: '片源地址无效' }
  try {
    const body = await getText(buildUrl(source.baseUrl, 'ac=list&pg=1'), 15_000)
    const resp = parseResponse(body)
    if (!resp) return { ok: false, error: '返回内容不是有效接口数据' }
    if (resp.code !== 1) return { ok: false, error: resp.msg || `接口返回 code=${resp.code}` }
    return { ok: true, categories: resp.categories, total: resp.total }
  } catch (err) {
    return { ok: false, error: errorIsNetwork(err) ? '连接超时或被拒绝' : '请求失败' }
  }
}

export async function fetchVodDetail(
  source: VodSourceInput,
  vodId: number
): Promise<VodDetailResponse> {
  if (!Number.isInteger(vodId) || vodId <= 0) return { ok: false, error: '条目编号无效' }
  if (!/^https?:\/\//i.test(source.baseUrl)) return { ok: false, error: '片源地址无效' }
  try {
    const body = await getText(buildUrl(source.baseUrl, `ac=videolist&ids=${vodId}`), 12_000)
    const resp = parseResponse(body)
    if (!resp) return { ok: false, error: '返回内容不是有效接口数据' }
    const item = resp.list.map(mapItem).find((i): i is VodItem => !!i)
    if (!item) return { ok: false, error: '该片源没有返回这个条目' }
    return {
      ok: true,
      item,
      groups: parsePlayGroups(item.vod_play_from, item.vod_play_url)
    }
  } catch (err) {
    return { ok: false, error: errorIsNetwork(err) ? '连接超时或被拒绝' : '请求失败' }
  }
}

export async function testVodSource(source: VodSourceInput): Promise<VodTestResponse> {
  const testAt = Date.now()
  if (!/^https?:\/\//i.test(source.baseUrl)) {
    return { ok: true, status: 'dead', message: '已失效 · 地址无效', testAt, region: 'cn' }
  }
  try {
    const body = await getText(buildUrl(source.baseUrl, 'ac=videolist&pg=1'), 12_000)
    if (!body.trimStart().startsWith('{')) {
      return {
        ok: true,
        status: 'proxy',
        message: '需外网 · 返回异常（疑似被墙）',
        testAt,
        region: 'proxy'
      }
    }
    const resp = parseResponse(body)
    if (!resp) {
      return { ok: true, status: 'dead', message: '已失效 · 数据解析失败', testAt, region: 'cn' }
    }
    if (resp.code !== 1) {
      return {
        ok: true,
        status: 'dead',
        message: `接口错误：${resp.msg.slice(0, 40) || `code=${resp.code}`}`,
        testAt,
        region: 'cn'
      }
    }
    return {
      ok: true,
      status: 'ok',
      message: `可用 · 共 ${resp.total} 部`,
      testAt,
      region: 'cn'
    }
  } catch (err) {
    if (errorIsNetwork(err)) {
      return { ok: true, status: 'proxy', message: '需外网 · 直连超时/被拒', testAt, region: 'proxy' }
    }
    return { ok: true, status: 'dead', message: '已失效 · 连接失败', testAt, region: 'cn' }
  }
}
