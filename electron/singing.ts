import {
  BILI_UA,
  absoluteUrl,
  asArray,
  asNumber,
  asRecord,
  asString,
  decodeHtml,
  fetchJson,
  fetchText
} from './livePlatform/common'
import { bilibiliRequestCookie } from './livePlatform/auth'
import {
  isBvid,
  type SingingDanmakuItem,
  type SingingDanmakuResult,
  type SingingPlayback,
  type SingingQuality,
  type SingingVideoInfo
} from '../src/shared/singing'

/**
 * 演唱模块：
 * - 条目只在「添加视频」里手动填写链接导入，不自动读取 B站收藏夹；
 * - 登录 Cookie 只用于提高播放清晰度，与「直播」共用同一个账号文件；
 * - 播放走 x/player/playurl 的 DASH（最高 4K），没有 DASH 时回退 durl mp4。
 */

const API = 'https://api.bilibili.com'

const QN_LABELS: Record<number, string> = {
  6: '240P',
  16: '360P',
  32: '480P',
  64: '720P',
  74: '720P60',
  80: '1080P',
  112: '1080P+',
  116: '1080P60',
  120: '4K',
  125: 'HDR',
  126: '杜比视界',
  127: '8K'
}

function baseHeaders(referer = 'https://www.bilibili.com/'): Record<string, string> {
  return {
    'User-Agent': BILI_UA,
    Referer: referer,
    Accept: 'application/json, text/plain, */*'
  }
}

async function apiHeaders(): Promise<Record<string, string>> {
  const cookie = await bilibiliRequestCookie()
  return cookie ? { ...baseHeaders(), Cookie: cookie } : baseHeaders()
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return '请求超时，请稍后重试'
    if (/JSON/i.test(err.message)) return 'B站接口被风控拦截，请稍后重试'
    return err.message
  }
  return '请求失败，请稍后重试'
}

function codeError(code: number, message: string, fallback: string): string {
  if (code === -101) return 'B站登录已失效，请重新扫码登录'
  if (code === -403) return '没有权限访问该内容（可能需要大会员）'
  if (code === -404) return '视频不存在或已删除'
  if (code === -10403) return '该视频在当前地区不可播放'
  return message || fallback
}

/** 播放直链的 CDN 域名登记：主进程按来源页补 Referer / UA（B站换 CDN 也不用改规则） */
const mediaHosts = new Map<string, number>()

export function noteBiliMediaUrl(rawUrl: string): void {
  try {
    const url = new URL(rawUrl)
    if (!/^https?:$/.test(url.protocol)) return
    const now = Date.now()
    for (const [host, at] of mediaHosts) {
      if (now - at > 2 * 60 * 60 * 1000) mediaHosts.delete(host)
    }
    mediaHosts.set(url.hostname, now)
  } catch {
    // 非法地址忽略
  }
}

export function bilibiliMediaAuth(url: URL): { referer: string; ua: string } | null {
  const at = mediaHosts.get(url.hostname)
  if (!at) return null
  // 读的时候也要校验过期：只在写入时清理会让旧 CDN 域名长期拦截直播流的请求头
  if (Date.now() - at > 2 * 60 * 60 * 1000) {
    mediaHosts.delete(url.hostname)
    return null
  }
  return { referer: 'https://www.bilibili.com/', ua: BILI_UA }
}

/** 从分享文本 / 链接 / BV 号里取视频标识 */
export interface BiliVideoRef {
  bvid?: string
  aid?: string
  page: number
  shortUrl?: string
}

export function parseBiliVideoInput(input: string): BiliVideoRef {
  const text = (input || '').trim()
  if (!text) return { page: 1 }
  const urlText = text.match(/https?:\/\/[^\s"'<>]+/i)?.[0] ?? ''
  const bvidMatch = (urlText || text).match(/BV[0-9A-Za-z]{10}/)
  if (bvidMatch) {
    let page = 1
    if (urlText) {
      try {
        page = Math.max(1, Math.floor(Number(new URL(urlText).searchParams.get('p')) || 1))
      } catch {
        page = 1
      }
    }
    return { bvid: bvidMatch[0], page }
  }
  const aidMatch = (urlText || text).match(/\/av(\d{1,15})/i) ?? text.match(/^av(\d{1,15})$/i)
  if (aidMatch) return { aid: aidMatch[1], page: 1 }
  if (urlText) {
    try {
      const host = new URL(urlText).hostname.toLowerCase()
      if (host === 'b23.tv' || host.endsWith('.b23.tv')) return { page: 1, shortUrl: urlText }
    } catch {
      // 忽略非法 URL
    }
  }
  return { page: 1 }
}

/** b23.tv 短链解析成真实视频地址 */
async function resolveShortUrl(shortUrl: string): Promise<string> {
  try {
    const res = await fetch(shortUrl, {
      headers: { 'User-Agent': BILI_UA, Referer: 'https://www.bilibili.com/' },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000)
    })
    const location = res.headers.get('location') ?? ''
    if (location) return location
  } catch {
    // 手动重定向失败时再走一次跟随
  }
  try {
    const res = await fetch(shortUrl, {
      headers: { 'User-Agent': BILI_UA, Referer: 'https://www.bilibili.com/' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000)
    })
    return res.url || ''
  } catch {
    return ''
  }
}

interface BiliViewData {
  bvid?: unknown
  aid?: unknown
  cid?: unknown
  title?: unknown
  pic?: unknown
  duration?: unknown
  owner?: unknown
  pages?: unknown
}

async function fetchView(ref: { bvid?: string; aid?: string }): Promise<{
  data?: BiliViewData
  code: number
  message: string
}> {
  const query = ref.bvid ? `bvid=${encodeURIComponent(ref.bvid)}` : `aid=${encodeURIComponent(ref.aid ?? '')}`
  const res = await fetchJson<{ code: number; message?: string; data?: BiliViewData }>(
    `${API}/x/web-interface/view?${query}`,
    { headers: await apiHeaders() }
  )
  return { data: res.data, code: res.code, message: res.message ?? '' }
}

function coverUrl(raw: unknown): string {
  const url = absoluteUrl(raw, 'https://www.bilibili.com/')
  return url.replace(/^http:\/\//i, 'https://')
}

function ownerName(raw: unknown): string {
  return decodeHtml(asRecord(raw).name)
}

function pageCid(data: BiliViewData, page: number): { cid: string; duration: number } {
  const parts = asArray(data.pages)
  if (parts.length && page >= 1 && page <= parts.length) {
    const part = asRecord(parts[page - 1])
    const cid = asString(part.cid)
    if (cid) return { cid, duration: asNumber(part.duration) }
  }
  return { cid: asString(data.cid), duration: asNumber(data.duration) }
}

/** 手动添加：解析链接 → 取视频信息（标题 / 封面 / UP主 / 时长） */
export async function singingVideoInfo(input: string): Promise<SingingVideoInfo> {
  const empty: SingingVideoInfo = {
    bvid: '',
    page: 1,
    title: '',
    cover: '',
    durationSec: 0,
    owner: ''
  }
  try {
    let ref = parseBiliVideoInput(input)
    if (ref.shortUrl) {
      const resolved = await resolveShortUrl(ref.shortUrl)
      ref = resolved ? parseBiliVideoInput(resolved) : ref
      if (ref.shortUrl) return { ...empty, error: '短链解析失败，请改用视频完整链接' }
    }
    if (!ref.bvid && !ref.aid) return { ...empty, error: '请粘贴 B站视频链接、BV 号或 av 号' }
    const view = await fetchView(ref)
    if (view.code !== 0 || !view.data) {
      return { ...empty, error: codeError(view.code, view.message, '视频信息加载失败') }
    }
    const data = view.data
    const bvid = asString(data.bvid)
    if (!isBvid(bvid)) return { ...empty, error: '没有识别到有效的 BV 号' }
    const page = Math.max(1, Math.floor(ref.page))
    const part = pageCid(data, page)
    return {
      bvid,
      page,
      title: decodeHtml(data.title) || bvid,
      cover: coverUrl(data.pic),
      durationSec: part.duration,
      owner: ownerName(data.owner)
    }
  } catch (err) {
    return { ...empty, error: errorText(err) }
  }
}

interface DashStream {
  id?: unknown
  baseUrl?: unknown
  backupUrl?: unknown
  codecs?: unknown
  bandwidth?: unknown
}

/** B站弹幕：list.so 返回 XML，按 <d p="时间,模式,字号,颜色,...">内容</d> 解析；每次打开视频都重新拉取 */
export async function singingDanmaku(bvid: string, page = 1): Promise<SingingDanmakuResult> {
  if (!isBvid(bvid)) return { items: [], error: '视频号无效' }
  try {
    const view = await fetchView({ bvid })
    if (view.code !== 0 || !view.data) {
      return { items: [], error: codeError(view.code, view.message, '弹幕加载失败') }
    }
    const cid = pageCid(view.data, Math.max(1, Math.floor(page))).cid
    if (!cid) return { items: [], error: '没有取到弹幕信息' }

    const headers = await apiHeaders()
    const text = await fetchText(`${API}/x/v1/dm/list.so?oid=${encodeURIComponent(cid)}`, {
      headers: {
        ...headers,
        Accept: '*/*',
        Referer: `https://www.bilibili.com/video/${bvid}/`
      },
      timeoutMs: 20_000
    })
    const items: SingingDanmakuItem[] = []
    const re = /<d p="([^"]+)"[^>]*>([\s\S]*?)<\/d>/g
    let match: RegExpExecArray | null = null
    while ((match = re.exec(text)) && items.length < 6000) {
      const parts = match[1].split(',')
      const time = asNumber(parts[0])
      const content = decodeHtml(match[2]).trim()
      if (!content || !Number.isFinite(time)) continue
      items.push({
        time,
        mode: asNumber(parts[1]) || 1,
        size: asNumber(parts[2]) || 25,
        color: asNumber(parts[3]) || 0xffffff,
        text: content.slice(0, 120)
      })
    }
    items.sort((a, b) => a.time - b.time)
    return { items }
  } catch (err) {
    return { items: [], error: errorText(err) }
  }
}

interface PlayUrlData {
  quality?: unknown
  accept_quality?: unknown
  durl?: unknown
  format?: unknown
  dash?: unknown
}

interface DashPick {
  url: string
  backup: string
  codecs: string
  bandwidth: number
}

/** 播放地址：登录后优先 DASH（最高 4K，视频/音轨分离），失败再退回 durl 单文件 mp4 */
export async function singingPlay(
  bvid: string,
  page = 1,
  qualityId?: string
): Promise<SingingPlayback> {
  const empty = (error: string): SingingPlayback => ({
    bvid,
    src: '',
    qualities: [],
    qualityId: '',
    error
  })
  if (!isBvid(bvid)) return empty('视频号无效')
  try {
    const view = await fetchView({ bvid })
    if (view.code !== 0 || !view.data) {
      return empty(codeError(view.code, view.message, '视频信息加载失败'))
    }
    const targetPage = Math.max(1, Math.floor(page))
    const { cid } = pageCid(view.data, targetPage)
    if (!cid) return empty('没有取到视频分P信息')

    const headers = await apiHeaders()
    const qn = qualityId && /^\d{1,6}$/.test(qualityId) ? qualityId : '120'
    const playUrl = (extra: string): Promise<{ code: number; message?: string; data?: PlayUrlData }> =>
      fetchJson(
        `${API}/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(
          cid
        )}&qn=${qn}&fourk=1${extra}`,
        { headers }
      )

    // 1) DASH：一次取回全部清晰度的视频 / 音轨地址
    let fallbackError = ''
    try {
      const dashRes = await playUrl('&fnval=16')
      if (dashRes.code === 0 && dashRes.data) {
        const dash = asRecord(dashRes.data.dash)
        const byQn = new Map<number, DashPick>()
        for (const raw of asArray(dash.video)) {
          const stream = asRecord(raw) as DashStream
          const id = asNumber(stream.id)
          const url = asString(stream.baseUrl)
          if (!id || !url) continue
          const codecs = asString(stream.codecs).toLowerCase()
          const bandwidth = asNumber(stream.bandwidth)
          const current = byQn.get(id)
          const isAvc = codecs.startsWith('avc1')
          const currentAvc = current?.codecs.startsWith('avc1') ?? false
          // 同清晰度优先 AVC（Chromium 兼容性最好），其次码率高的
          const better =
            !current ||
            (isAvc && !currentAvc) ||
            (isAvc === currentAvc && bandwidth > current.bandwidth)
          if (better) {
            byQn.set(id, {
              url,
              backup: asString(asArray(stream.backupUrl)[0]),
              codecs,
              bandwidth
            })
          }
        }
        const audio = asArray(dash.audio)
          .map((raw) => {
            const stream = asRecord(raw) as DashStream
            return {
              url: asString(stream.baseUrl),
              backup: asString(asArray(stream.backupUrl)[0]),
              bandwidth: asNumber(stream.bandwidth)
            }
          })
          .filter((entry) => entry.url)
          .sort((a, b) => b.bandwidth - a.bandwidth)[0]
        const accept = asArray(dashRes.data.accept_quality)
          .map((value) => asNumber(value))
          .filter((value) => value > 0)
        const ids = [...byQn.keys()]
          .filter((id) => !accept.length || accept.includes(id))
          .sort((a, b) => b - a)
        if (ids.length && audio) {
          const qualities: SingingQuality[] = ids.map((id) => {
            const pick = byQn.get(id)!
            noteBiliMediaUrl(pick.url)
            if (pick.backup) noteBiliMediaUrl(pick.backup)
            return {
              id: String(id),
              label: QN_LABELS[id] ?? `${id}`,
              src: pick.url,
              backupSrc: pick.backup || undefined
            }
          })
          noteBiliMediaUrl(audio.url)
          if (audio.backup) noteBiliMediaUrl(audio.backup)
          const requested = asNumber(dashRes.data.quality)
          const current = qualities.find((entry) => entry.id === String(requested)) ?? qualities[0]
          return {
            bvid,
            src: current.src ?? '',
            audioSrc: audio.url,
            audioBackupSrc: audio.backup || undefined,
            qualities,
            qualityId: current.id
          }
        }
      } else {
        fallbackError = codeError(dashRes.code, dashRes.message ?? '', '')
      }
    } catch (err) {
      fallbackError = errorText(err)
    }

    // 2) durl 回退：老视频 / 特殊视频的单文件 mp4
    const res = await playUrl('&fnval=1')
    if (res.code !== 0 || !res.data) {
      return empty(codeError(res.code, res.message ?? '', fallbackError || '播放地址获取失败'))
    }
    let data = res.data
    // 老视频 / 特殊视频只给 FLV 分段：换 html5 平台再要一次单文件 mp4
    const needsFallback = (value: PlayUrlData): boolean => {
      const durl = asArray(value.durl).map((raw) => asRecord(raw))
      return !asString(durl[0]?.url) || durl.length > 1 || asString(value.format).toLowerCase().startsWith('flv')
    }
    if (needsFallback(data)) {
      const retry = await playUrl('&fnval=1&platform=html5&high_quality=1')
      if (retry.code === 0 && retry.data && !needsFallback(retry.data)) {
        data = retry.data
      }
    }
    const durl = asArray(data.durl).map((raw) => asRecord(raw))
    const src = asString(durl[0]?.url)
    if (!src) return empty(fallbackError || '这个视频暂时没有可用的播放地址')
    if (durl.length > 1 || asString(data.format).toLowerCase().startsWith('flv')) {
      return empty('这个视频只有分段 / FLV 格式，暂不支持应用内播放')
    }
    noteBiliMediaUrl(src)

    const codes = asArray(data.accept_quality)
      .map((value) => asNumber(value))
      .filter((value) => value > 0)
    const current = asNumber(data.quality) || codes[0] || 0
    const list = [...new Set([...codes, current])].sort((a, b) => b - a)
    const qualities: SingingQuality[] = list.map((code) => ({
      id: String(code),
      label: QN_LABELS[code] ?? `${code}`
    }))
    return {
      bvid,
      src: src.replace(/^http:\/\//i, 'https://'),
      qualities,
      qualityId: String(current)
    }
  } catch (err) {
    return empty(errorText(err))
  }
}
