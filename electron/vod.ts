import { spawn } from 'node:child_process'
import { ffmpegBinary } from './downloads'
import { normalizeBaseUrl, parsePlayGroups } from '../src/shared/vod'
import type {
  VodCategoriesResponse,
  VodCategory,
  VodDetailResponse,
  VodItem,
  VodListResponse,
  VodQualityProbeResponse,
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

/** 按画面宽度映射成 B 站式档位（宽银幕裁切如 1280x506 仍归 720P；竖屏按高度算） */
function qualityLabelOf(width: number, height: number): string {
  const base = Math.max(width, height)
  if (base >= 3600) return '4K'
  if (base >= 2400) return '2K'
  if (base >= 1800) return '1080P'
  if (base >= 1200) return '720P'
  if (base >= 800) return '480P'
  if (width > 0) return `${width}×${height}`
  return ''
}

/** 解析 m3u8 主清单里的清晰度档位；不是 m3u8 返回 null（单码率清单返回空数组） */
function parseHlsQualities(text: string): string[] | null {
  if (!text.trimStart().startsWith('#EXTM3U')) return null
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue
    const resolution = /RESOLUTION=(\d+)x(\d+)/i.exec(line)
    if (!resolution) continue
    const label = qualityLabelOf(Number(resolution[1]), Number(resolution[2]))
    if (label) seen.add(label)
  }
  const order = ['4K', '2K', '1080P', '720P', '480P']
  return [...seen].sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
}

/** 从分享页 HTML 里找真实 m3u8（可能是相对路径） */
function extractM3u8(html: string, base: string): string | null {
  const absolute = /https?:\\?\/\\?\/[^"'\s\\]+?\.m3u8[^"'\s\\]*/i.exec(html)
  if (absolute) return absolute[0].replace(/\\\//g, '/')
  const relative = /["'](\/[^"'\s]*?\.m3u8[^"'\s]*)["']/i.exec(html)
  if (!relative) return null
  try {
    return new URL(relative[1], base).toString()
  } catch {
    return null
  }
}

/** 判断是否属于内网 / 回环 / 链路本地 / 组播等不该由主进程访问的地址 */
function isPrivateV4(parts: number[]): boolean {
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a >= 224) return true
  return false
}

/** 内网主机名判断：localhost / .local、点分 IPv4、纯数字或十六进制整数写法、IPv6 回环与本地段 */
function isPrivateHostname(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) return isPrivateV4(v4.slice(1).map(Number))
  // http://2130706433/ / http://0x7f000001/ 这类整数写法
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    const value = /^\d+$/.test(host) ? Number(host) : Number.parseInt(host.slice(2), 16)
    if (Number.isFinite(value)) {
      return isPrivateV4([
        (value >>> 24) & 255,
        (value >>> 16) & 255,
        (value >>> 8) & 255,
        value & 255
      ])
    }
  }
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host)
    if (mapped) return isPrivateV4(mapped[1].split('.').map(Number))
  }
  return false
}

/** 探测只允许访问公网 http(s) 地址，避免被采集源引到本机 / 内网服务 */
function isPublicHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return !isPrivateHostname(url.hostname)
  } catch {
    return false
  }
}

/** 单码率清单拿不到档位时，用随包 ffmpeg 读流头里的真实分辨率 */
function probeStreamResolution(url: string): Promise<string[]> {
  if (!isPublicHttpUrl(url)) return Promise.resolve([])
  const bin = ffmpegBinary()
  if (!bin) {
    console.error('[vod-probe] 找不到 ffmpeg')
    return Promise.resolve([])
  }
  return new Promise((resolve) => {
    const proc = spawn(
      bin,
      [
        '-hide_banner',
        '-nostdin',
        // 只允许 http(s) 相关协议，禁止 file / ftp 等本地或非预期通道
        '-protocol_whitelist',
        'http,https,tcp,tls,crypto',
        '-analyzeduration',
        '1500000',
        '-probesize',
        '800000',
        '-i',
        url,
        '-frames:v',
        '1',
        '-f',
        'null',
        '-'
      ],
      { windowsHide: true }
    )
    let stderr = ''
    let settled = false
    const finish = (result: string[]): void => {
      if (settled) return
      settled = true
      try {
        proc.kill('SIGKILL')
      } catch {
        // 进程可能已经退出
      }
      resolve(result)
    }
    const timer = setTimeout(() => finish([]), 12_000)
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      const match = /,\s*(\d{2,5})x(\d{3,5})[\s,]/.exec(stderr)
      if (!match) return
      clearTimeout(timer)
      const label = qualityLabelOf(Number(match[1]), Number(match[2]))
      finish(label ? [label] : [])
    })
    proc.on('error', (err) => {
      console.error('[vod-probe] ffmpeg 启动失败', err)
      clearTimeout(timer)
      finish([])
    })
    proc.on('exit', (code) => {
      if (!settled) console.error('[vod-probe] ffmpeg 退出', code, stderr.slice(-300))
      clearTimeout(timer)
      finish([])
    })
  })
}

/**
 * 探测条目清晰度：优先解析第一条 3u8 线路的主清单，多码率会把所有档位列全；
 * 单码率清单 / 分享页则先找到真实 m3u8，再用 ffmpeg 读流头拿分辨率。
 */
export async function probeVodQualities(
  from: string,
  playUrl: string
): Promise<VodQualityProbeResponse> {
  const groups = parsePlayGroups(from, playUrl)
  const first = groups[0]?.episodes[0]
  if (!first || !isPublicHttpUrl(first.url)) return { ok: true, qualities: [] }
  let target = first.url
  try {
    const text = await getText(first.url, 6000)
    let qualities = parseHlsQualities(text)
    if (!qualities) {
      const inner = extractM3u8(text, first.url)
      if (inner && isPublicHttpUrl(inner)) {
        target = inner
        const body = await getText(inner, 6000).catch(() => '')
        qualities = body ? parseHlsQualities(body) : null
      }
    }
    if (qualities && qualities.length) return { ok: true, qualities: qualities.slice(0, 5) }
    return { ok: true, qualities: await probeStreamResolution(target) }
  } catch (err) {
    console.error('[vod-probe] 探测失败', target, err)
    return { ok: true, qualities: [] }
  }
}
