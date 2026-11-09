import {
  BILI_UA,
  absoluteUrl,
  asArray,
  asNumber,
  asRecord,
  asString,
  cached,
  decodeHtml,
  fetchJson,
  formatWatching
} from './common'
import { bilibiliRequestCookie } from './auth'
import type {
  LiveCategoryGroup,
  LiveCategoriesResult,
  LiveListResult,
  LivePlayLine,
  LiveQuality,
  LiveRoom,
  LiveRoomDetail,
  LiveRoomPlayback,
  LiveRoomStatus
} from '../../src/shared/livePlatform'

const API = 'https://api.live.bilibili.com'

async function headers(referer = 'https://live.bilibili.com/'): Promise<Record<string, string>> {
  const cookie = await bilibiliRequestCookie()
  return {
    'User-Agent': BILI_UA,
    Referer: referer,
    Origin: 'https://live.bilibili.com',
    ...(cookie ? { Cookie: cookie } : {})
  }
}

function statusOf(value: unknown): LiveRoomStatus {
  if (value === undefined || value === null || value === '') return 'unknown'
  const code = asNumber(value)
  if (code === 1) return 'living'
  if (code === 2) return 'replay'
  if (code === 0) return 'offline'
  return 'unknown'
}

function statusTextOf(status: LiveRoomStatus, raw?: unknown): string | undefined {
  if (status === 'living') return undefined
  if (status === 'replay') return '轮播'
  if (status === 'offline') return '未开播'
  return asString(raw) || undefined
}

function coverOf(value: unknown): string {
  const url = absoluteUrl(value, 'https://live.bilibili.com/')
  if (!url) return ''
  return /@\d+w\.jpg$/i.test(url) ? url : `${url}@400w.jpg`
}

function mapRoom(item: Record<string, unknown>): LiveRoom | null {
  const roomId = asString(item.roomid ?? item.room_id)
  if (!roomId) return null
  const status = statusOf(item.live_status)
  const online = asString(item.online)
  return {
    platform: 'bilibili',
    roomId,
    title: decodeHtml(item.title),
    anchor: decodeHtml(item.uname),
    cover: coverOf(item.user_cover ?? item.cover),
    area: decodeHtml(item.area_v2_name ?? item.area_name ?? item.cate_name),
    watching: formatWatching(online) || online,
    status,
    statusText: statusTextOf(status, item.live_status_text),
    avatar: absoluteUrl(item.uface ?? item.face, 'https://live.bilibili.com/'),
    link: `https://live.bilibili.com/${roomId}`
  }
}

function mapList(data: unknown, pageSize = 30): LiveListResult {
  const record = asRecord(data)
  const raw = Array.isArray(data) ? data : record.list ?? record.recommend_room_list
  const items = asArray(raw)
    .map((item) => {
      const room = mapRoom(asRecord(item))
      if (room && room.status === 'unknown') room.status = 'living'
      return room
    })
    .filter((room): room is LiveRoom => !!room)
  return { items, hasMore: items.length >= pageSize }
}

export async function bilibiliCategories(): Promise<LiveCategoriesResult> {
  try {
    const res = await cached('bili:categories', 30 * 60 * 1000, async () =>
      fetchJson<{ code: number; message?: string; data?: unknown }>(
        `${API}/room/v1/Area/getList?need_entrance=1&parent_id=0`,
        { headers: await headers() }
      )
    )
    if (res.code !== 0) throw new Error(res.message || 'B站分区加载失败')
    const groups: LiveCategoryGroup[] = []
    for (const raw of asArray(res.data)) {
      const group = asRecord(raw)
      const id = asString(group.id)
      if (!id) continue
      const areas = asArray(group.list)
        .map((entry) => {
          const area = asRecord(entry)
          const areaId = asString(area.id)
          if (!areaId) return null
          return {
            id: areaId,
            name: decodeHtml(area.name),
            parentId: id,
            icon: absoluteUrl(area.pic, 'https://live.bilibili.com/')
          }
        })
        .filter((area): area is NonNullable<typeof area> => !!area)
      groups.push({ id, name: decodeHtml(group.name), areas })
    }
    return { groups: groups.filter((group) => group.areas.length > 0) }
  } catch (err) {
    return { groups: [], error: errorText(err) }
  }
}

export async function bilibiliRecommend(page = 1): Promise<LiveListResult> {
  try {
    const res = await fetchJson<{ code: number; message?: string; data?: unknown }>(
      `${API}/room/v1/Area/getListByAreaID?areaId=0&parent_area_id=0&sort=online&pageSize=30&page=${page}`,
      { headers: await headers() }
    )
    if (res.code !== 0) throw new Error(res.message || 'B站热门加载失败')
    return mapList(res.data)
  } catch (err) {
    return { items: [], hasMore: false, error: errorText(err) }
  }
}

export async function bilibiliCategoryRooms(
  parentId: string,
  areaId: string,
  page = 1
): Promise<LiveListResult> {
  try {
    const res = await fetchJson<{ code: number; message?: string; data?: unknown }>(
      `${API}/room/v1/Area/getListByAreaID?areaId=${encodeURIComponent(
        areaId
      )}&parent_area_id=${encodeURIComponent(parentId)}&sort=online&pageSize=30&page=${page}`,
      { headers: await headers() }
    )
    if (res.code !== 0) throw new Error(res.message || 'B站分区列表加载失败')
    return mapList(res.data)
  } catch (err) {
    return { items: [], hasMore: false, error: errorText(err) }
  }
}

export async function bilibiliSearch(keyword: string, page = 1): Promise<LiveListResult> {
  const text = keyword.trim()
  if (!text) return { items: [], hasMore: false }
  try {
    const res = await fetchJson<{
      code: number
      message?: string
      data?: { result?: Record<string, unknown> }
    }>(
      `https://api.bilibili.com/x/web-interface/search/type?search_type=live&keyword=${encodeURIComponent(
        text
      )}&page=${page}&page_size=30&cover_type=user_cover`,
      { headers: await headers('https://search.bilibili.com/') }
    )
    if (res.code !== 0) throw new Error(res.message || 'B站搜索失败')
    const result = asRecord(res.data?.result)
    const rooms = asArray(result.live_room)
      .map((item) => mapRoom(asRecord(item)))
      .filter((room): room is LiveRoom => !!room)
    return { items: rooms, hasMore: rooms.length >= 30 }
  } catch (err) {
    return { items: [], hasMore: false, error: errorText(err) }
  }
}

interface BiliCodec {
  codec_name?: unknown
  current_qn?: unknown
  accept_qn?: unknown
  base_url?: unknown
  url_info?: unknown
}

interface BiliFormat {
  format_name?: unknown
  codec?: unknown
}

interface BiliStream {
  protocol_name?: unknown
  format?: unknown
}

interface PlayCandidate {
  url: string
  qn: number
  hls: boolean
  codec: string
}

const QN_LABELS: Record<number, string> = {
  30000: '杜比',
  20000: '4K',
  15000: '2K',
  10000: '原画',
  400: '蓝光',
  250: '超清',
  150: '高清',
  80: '流畅'
}

export async function bilibiliRoom(roomId: string, qualityId?: string): Promise<LiveRoomPlayback> {
  const id = roomId.trim()
  if (!/^\d{1,20}$/.test(id)) {
    return emptyPlayback('请输入 B站房间号或直播间链接')
  }
  try {
    const [detail, play] = await Promise.all([
      bilibiliRoomDetail(id),
      fetchPlayInfo(id, qualityId)
    ])
    if (!detail) return emptyPlayback('未找到该直播间')
    if (play.error) {
      return { detail, qualities: play.qualities, lines: [], error: play.error }
    }
    return { detail, qualities: play.qualities, lines: play.lines }
  } catch (err) {
    return emptyPlayback(errorText(err))
  }
}

async function bilibiliRoomDetail(roomId: string): Promise<LiveRoomDetail | null> {
  const res = await fetchJson<{ code: number; message?: string; data?: Record<string, unknown> }>(
    `${API}/room/v1/Room/get_info?room_id=${roomId}`,
    { headers: await headers() }
  )
  if (res.code !== 0) {
    if (res.code === -404 || res.code === 1) return null
    throw new Error(res.message || 'B站直播间信息加载失败')
  }
  const info = asRecord(res.data)
  const status = statusOf(info.live_status)
  const online = asString(info.online)
  let anchor = ''
  let avatar = ''
  if (asString(info.uid)) {
    try {
      const anchorRes = await fetchJson<{ code: number; data?: Record<string, unknown> }>(
        `${API}/live_user/v1/UserInfo/get_anchor_in_room?roomid=${roomId}`,
        { headers: await headers() }
      )
      const anchorInfo = asRecord(asRecord(anchorRes.data).info)
      anchor = decodeHtml(anchorInfo.uname)
      avatar = absoluteUrl(anchorInfo.face, 'https://live.bilibili.com/')
    } catch {
      // 主播信息失败不影响播放
    }
  }
  return {
    platform: 'bilibili',
    roomId: asString(info.room_id) || roomId,
    title: decodeHtml(info.title),
    anchor,
    cover: coverOf(info.user_cover ?? info.keyframe),
    area: decodeHtml(info.area_name ?? info.parent_area_name),
    watching: formatWatching(online) || online,
    status,
    statusText: statusTextOf(status),
    avatar,
    link: `https://live.bilibili.com/${roomId}`,
    description: decodeHtml(info.description),
    startedAt: status === 'living' ? asNumber(info.live_start_time) * 1000 || undefined : undefined
  }
}

async function fetchPlayInfo(
  roomId: string,
  qualityId?: string
): Promise<{ qualities: LiveQuality[]; lines: LivePlayLine[]; error?: string }> {
  const qn = qualityId && /^\d+$/.test(qualityId) ? qualityId : '10000'
  const url =
    `${API}/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${roomId}` +
    `&protocol=0,1&format=0,1,2&codec=0,1&qn=${qn}&platform=web&ptype=8&dolby=5&panorama=1`
  const res = await fetchJson<{ code: number; message?: string; data?: Record<string, unknown> }>(url, {
    headers: await headers()
  })
  if (res.code !== 0) {
    const message = res.message || ''
    if (/未开播|not live/i.test(message)) return { qualities: [], lines: [], error: '主播未开播' }
    if (res.code === -400 || res.code === -404) return { qualities: [], lines: [], error: '直播间不存在' }
    throw new Error(message || 'B站播放地址获取失败')
  }
  const data = asRecord(res.data)
  const playurl = asRecord(asRecord(data.playurl_info).playurl)
  const streams = asArray(playurl.stream) as BiliStream[]
  const qualities = qualitiesOf(playurl, streams)
  const candidates: PlayCandidate[] = []

  for (const stream of streams) {
    for (const rawFormat of asArray(stream.format)) {
      const format = rawFormat as BiliFormat
      const formatName = asString(format.format_name)
      const hls = formatName === 'ts' || formatName === 'fmp4'
      const flv = formatName === 'flv'
      if (!hls && !flv) continue
      for (const rawCodec of asArray(format.codec)) {
        const codec = rawCodec as BiliCodec
        const base = asString(codec.base_url)
        const currentQn = asNumber(codec.current_qn)
        if (!base || currentQn <= 0) continue
        const codecName = asString(codec.codec_name)
        for (const rawInfo of asArray(codec.url_info)) {
          const info = asRecord(rawInfo)
          const host = asString(info.host)
          const extra = asString(info.extra)
          const full = `${host}${base}${extra}`
          if (!/^https?:\/\//i.test(full)) continue
          candidates.push({
            url: full.replace(/^http:\/\//i, 'https://'),
            qn: currentQn,
            hls,
            codec: codecName
          })
        }
      }
    }
  }

  if (!candidates.length) {
    const liveStatus = asNumber(data.live_status)
    if (liveStatus === 2) return { qualities, lines: [], error: '当前是轮播，暂无可播放的直播流' }
    if (liveStatus === 0) return { qualities, lines: [], error: '主播未开播' }
    return { qualities, lines: [], error: '没有取到播放线路，可能被平台风控，请稍后重试' }
  }

  candidates.sort((a, b) => {
    if (a.hls !== b.hls) return a.hls ? -1 : 1
    if (a.qn !== b.qn) return b.qn - a.qn
    const ac = a.codec.toLowerCase()
    const bc = b.codec.toLowerCase()
    if (ac !== bc) return ac === 'avc' ? -1 : bc === 'avc' ? 1 : 0
    return a.url.includes('mcdn') ? 1 : b.url.includes('mcdn') ? -1 : 0
  })

  const labelOf = (value: number): string =>
    qualities.find((quality) => quality.id === String(value))?.label ?? `${value}`
  const seen = new Set<string>()
  const lines: LivePlayLine[] = []
  for (const candidate of candidates) {
    if (seen.has(candidate.url)) continue
    seen.add(candidate.url)
    lines.push({
      id: `${candidate.hls ? 'hls' : 'flv'}|${new URL(candidate.url).host}|${candidate.qn}|${lines.length}`,
      qualityId: String(candidate.qn),
      qualityLabel: labelOf(candidate.qn),
      format: candidate.hls ? 'hls' : 'flv',
      url: candidate.url
    })
    if (lines.length >= 8) break
  }

  return { qualities, lines }
}

function qualitiesOf(
  playurl: Record<string, unknown>,
  streams: BiliStream[]
): LiveQuality[] {
  const labels = new Map<number, string>()
  for (const raw of asArray(playurl.g_qn_desc)) {
    const item = asRecord(raw)
    const qn = asNumber(item.qn)
    const desc = decodeHtml(item.desc)
    if (qn > 0 && desc) labels.set(qn, desc)
  }
  const codes = new Set<number>()
  for (const stream of streams) {
    for (const rawFormat of asArray(stream.format)) {
      for (const rawCodec of asArray((rawFormat as BiliFormat).codec)) {
        const codec = rawCodec as BiliCodec
        for (const raw of asArray(codec.accept_qn)) {
          const qn = asNumber(raw)
          if (qn > 0) codes.add(qn)
        }
        const current = asNumber(codec.current_qn)
        if (current > 0) codes.add(current)
      }
    }
  }
  return [...codes]
    .sort((a, b) => b - a)
    .map((qn) => ({ id: String(qn), label: labels.get(qn) || QN_LABELS[qn] || `${qn}` }))
}

function emptyPlayback(error: string): LiveRoomPlayback {
  return {
    detail: {
      platform: 'bilibili',
      roomId: '',
      title: '',
      anchor: '',
      cover: '',
      area: '',
      watching: '',
      status: 'unknown'
    },
    qualities: [],
    lines: [],
    error
  }
}

export function parseBilibiliRoomId(input: string): string {
  const text = input.trim()
  if (!text) return ''
  if (/^\d{1,20}$/.test(text)) return text
  const match = text.match(/live\.bilibili\.com\/(?:h5\/|blanc\/)?(\d{1,20})/i)
  return match?.[1] ?? ''
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return '请求超时，请重试'
    return err.message
  }
  return '请求失败，请重试'
}
