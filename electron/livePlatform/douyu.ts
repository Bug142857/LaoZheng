import {
  DOUYU_UA,
  absoluteUrl,
  asArray,
  asNumber,
  asRecord,
  asString,
  cached,
  decodeHtml,
  fetchJson,
  formatWatching,
  md5
} from './common'
import { getDouyuDeviceId, getLiveCookie } from './auth'
import type {
  LiveCategoryArea,
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

const WWW = 'https://www.douyu.com'

function headers(rid?: string): Record<string, string> {
  const cookie = getLiveCookie('douyu')
  return {
    'User-Agent': DOUYU_UA,
    Referer: rid ? `${WWW}/${rid}` : `${WWW}/`,
    Origin: WWW,
    ...(cookie ? { Cookie: cookie } : {})
  }
}

function mapStatus(showStatus: unknown, videoLoop: unknown, title: string): LiveRoomStatus {
  if (asNumber(videoLoop) === 1) return 'replay'
  if (asNumber(showStatus) === 1 && !title.startsWith('【回放】')) return 'living'
  return 'offline'
}

function mapRoom(item: Record<string, unknown>): LiveRoom | null {
  const rid = asString(item.rid)
  if (!rid) return null
  const hot = asString(item.ol)
  return {
    platform: 'douyu',
    roomId: rid,
    title: decodeHtml(item.rn),
    anchor: decodeHtml(item.nn),
    cover: absoluteUrl(item.rs16, WWW),
    area: decodeHtml(item.c2name),
    watching: formatWatching(hot) || hot,
    status: 'living',
    avatar: absoluteUrl(item.av, WWW),
    link: `${WWW}/${rid}`
  }
}

function mapSearchRoom(item: Record<string, unknown>): LiveRoom | null {
  const rid = asString(item.rid)
  if (!rid) return null
  const status: LiveRoomStatus =
    asNumber(item.isLive) === 1
      ? asNumber(item.roomType) === 3
        ? 'replay'
        : 'living'
      : 'offline'
  const hot = asString(item.hot)
  return {
    platform: 'douyu',
    roomId: rid,
    title: decodeHtml(item.roomName),
    anchor: decodeHtml(item.nickName),
    cover: absoluteUrl(item.roomSrc, WWW),
    area: decodeHtml(item.cateName),
    watching: formatWatching(hot) || hot,
    status,
    statusText: status === 'replay' ? '轮播' : status === 'offline' ? '未开播' : undefined,
    avatar: absoluteUrl(item.avatar, WWW),
    link: `${WWW}/${rid}`
  }
}

function mapList(data: Record<string, unknown>): LiveListResult {
  const raw = asArray(data.rl)
  const items = raw
    .map((item) => {
      const room = asRecord(item)
      return asNumber(room.type) === 1 ? mapRoom(room) : null
    })
    .filter((room): room is LiveRoom => !!room)
  const pages = asNumber(data.pgcnt)
  const page = asNumber(data.page)
  return { items, hasMore: pages > 0 ? page < pages : items.length > 0 }
}

export async function douyuCategories(): Promise<LiveCategoriesResult> {
  try {
    const res = await cached('douyu:categories', 30 * 60 * 1000, () =>
      fetchJson<{ data?: Record<string, unknown> }>('https://m.douyu.com/api/cate/list', {
        headers: { 'User-Agent': DOUYU_UA, Referer: 'https://m.douyu.com/' }
      })
    )
    const data = asRecord(res.data)
    const groups = asArray(data.cate1Info)
      .map((raw): LiveCategoryGroup | null => {
        const group = asRecord(raw)
        const id = asString(group.cate1Id)
        if (!id) return null
        const areas = asArray(data.cate2Info)
          .map((entry): LiveCategoryArea | null => {
            const area = asRecord(entry)
            if (asString(area.cate1Id) !== id) return null
            const areaId = asString(area.cate2Id)
            if (!areaId) return null
            return {
              id: areaId,
              name: decodeHtml(area.cate2Name),
              parentId: id,
              icon: absoluteUrl(area.icon ?? area.smallIcon ?? area.pic, WWW)
            }
          })
          .filter((area): area is LiveCategoryArea => !!area)
        return { id, name: decodeHtml(group.cate1Name), areas }
      })
      .filter((group): group is LiveCategoryGroup => !!group && group.areas.length > 0)
    groups.sort((a, b) => Number(a.id) - Number(b.id))
    return { groups }
  } catch (err) {
    return { groups: [], error: errorText(err) }
  }
}

export async function douyuRecommend(page = 1): Promise<LiveListResult> {
  try {
    const res = await fetchJson<{ data?: Record<string, unknown> }>(
      `${WWW}/japi/weblist/apinc/allpage/6/${page}`,
      { headers: headers() }
    )
    return mapList(asRecord(res.data))
  } catch (err) {
    return { items: [], hasMore: false, error: errorText(err) }
  }
}

export async function douyuCategoryRooms(areaId: string, page = 1): Promise<LiveListResult> {
  try {
    const res = await fetchJson<{ data?: Record<string, unknown> }>(
      `${WWW}/gapi/rkc/directory/mixList/2_${encodeURIComponent(areaId)}/${page}`,
      { headers: headers() }
    )
    const data = asRecord(res.data)
    const result = mapList({ ...data, page })
    // mixList 用 pgcnt 表示总页数，mapList 已按 page/pgcnt 计算
    return result
  } catch (err) {
    return { items: [], hasMore: false, error: errorText(err) }
  }
}

export async function douyuSearch(keyword: string, page = 1): Promise<LiveListResult> {
  const text = keyword.trim()
  if (!text) return { items: [], hasMore: false }
  try {
    const res = await fetchJson<{ data?: Record<string, unknown> }>(
      `${WWW}/japi/search/api/searchShow?kw=${encodeURIComponent(text)}&page=${page}&pageSize=30`,
      { headers: headers() }
    )
    const data = asRecord(res.data)
    const items = asArray(data.relateShow)
      .map((item) => mapSearchRoom(asRecord(item)))
      .filter((room): room is LiveRoom => !!room)
    return { items, hasMore: items.length >= 30 }
  } catch (err) {
    return { items: [], hasMore: false, error: errorText(err) }
  }
}

export async function douyuRoom(roomId: string, qualityId?: string): Promise<LiveRoomPlayback> {
  const rid = roomId.trim()
  if (!/^\d{1,20}$/.test(rid)) {
    return emptyPlayback('请输入斗鱼房间号或直播间链接')
  }
  try {
    const detail = await douyuRoomDetail(rid)
    if (!detail) return emptyPlayback('未找到该直播间')
    if (detail.status === 'offline') {
      return {
        detail,
        qualities: [],
        lines: [],
        error: '主播未开播'
      }
    }
    const play = await douyuPlay(rid, qualityId)
    return { detail, qualities: play.qualities, lines: play.lines, error: play.error }
  } catch (err) {
    return emptyPlayback(errorText(err))
  }
}

async function douyuRoomDetail(rid: string): Promise<LiveRoomDetail | null> {
  const raw = await fetchJson<unknown>(`${WWW}/betard/${rid}`, { headers: headers(rid) })
  let body: unknown = raw
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      return null
    }
  }
  const room = asRecord(asRecord(body).room)
  if (!room.room_id) return null
  const title = decodeHtml(room.room_name)
  const status = mapStatus(room.show_status, room.videoLoop, title)
  const hot = asString(asRecord(room.room_biz_all).hot)
  return {
    platform: 'douyu',
    roomId: asString(room.room_id),
    title,
    anchor: decodeHtml(room.owner_name),
    cover: absoluteUrl(room.room_pic, WWW),
    area: decodeHtml(room.second_lvl_name),
    watching: formatWatching(hot) || hot,
    status,
    statusText: status === 'replay' ? '轮播' : status === 'offline' ? '未开播' : undefined,
    avatar: absoluteUrl(room.owner_avatar, WWW),
    link: `${WWW}/${rid}`,
    description: decodeHtml(room.show_details),
    startedAt: status === 'living' ? asNumber(room.show_time) * 1000 : undefined
  }
}

interface DouyuDescriptor {
  key: string
  randStr: string
  encData: string
  encTime: number
  expireAt: number
  special: boolean
}

let descriptorCache: { descriptor: DouyuDescriptor; at: number } | null = null

function douyuDeviceId(): string {
  const cookie = getLiveCookie('douyu')
  const match = cookie.match(/(?:^|;\s*)(?:dy_did|acf_did)=([^;]+)/)
  return match?.[1]?.trim() || getDouyuDeviceId()
}

async function douyuDescriptor(rid: string): Promise<DouyuDescriptor> {
  const did = douyuDeviceId()
  if (descriptorCache && Date.now() - descriptorCache.at < 5 * 60 * 1000) {
    return descriptorCache.descriptor
  }
  const res = await fetchJson<{ data?: Record<string, unknown> }>(
    `${WWW}/wgapi/livenc/liveweb/websec/getEncryption?did=${did}`,
    { headers: headers(rid) }
  )
  const data = asRecord(res.data)
  const descriptor: DouyuDescriptor = {
    key: asString(data.key),
    randStr: asString(data.rand_str),
    encData: asString(data.enc_data),
    encTime: asNumber(data.enc_time),
    expireAt: asNumber(data.expire_at) * 1000,
    special: asNumber(data.is_special) === 1
  }
  if (!descriptor.key || !descriptor.randStr || !descriptor.encData || descriptor.encTime < 1) {
    throw new Error('斗鱼播放签名获取失败，可能被风控')
  }
  descriptorCache = { descriptor, at: Date.now() }
  return descriptor
}

function douyuAuth(descriptor: DouyuDescriptor, rid: string, tt: number): string {
  let secret = descriptor.randStr
  for (let i = 0; i < descriptor.encTime; i += 1) {
    secret = md5(`${secret}${descriptor.key}`)
  }
  const salt = descriptor.special ? '' : `${rid}${tt}`
  return md5(`${secret}${descriptor.key}${salt}`)
}

async function douyuPlay(
  rid: string,
  qualityId?: string
): Promise<{ qualities: LiveQuality[]; lines: LivePlayLine[]; error?: string }> {
  const descriptor = await douyuDescriptor(rid)
  const did = douyuDeviceId()
  const tt = Math.floor(Date.now() / 1000)
  const rate = qualityId && /^-?\d+$/.test(qualityId) ? qualityId : '-1'
  const form = new URLSearchParams({
    enc_data: descriptor.encData,
    tt: String(tt),
    did,
    auth: douyuAuth(descriptor, rid, tt),
    cdn: '',
    rate,
    hevc: '0',
    fa: '0',
    ive: '0',
    ver: 'Douyu_new',
    iar: '0'
  })
  const res = await fetchJson<Record<string, unknown>>(`${WWW}/lapi/live/getH5PlayV1/${rid}`, {
    method: 'POST',
    headers: {
      ...headers(rid),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form.toString()
  })
  const code = asNumber(res.error ?? res.code)
  if (code !== 0) {
    return { qualities: [], lines: [], error: asString(res.msg) || '斗鱼播放地址获取失败' }
  }
  const data = asRecord(res.data)
  const rtmpUrl = asString(data.rtmp_url)
  const rtmpLive = asString(data.rtmp_live).replace(/&amp;/g, '&')
  if (!rtmpUrl || !rtmpLive) {
    return { qualities: [], lines: [], error: '斗鱼没有返回播放地址，可能未开播或需要登录' }
  }
  const url = `${rtmpUrl}/${rtmpLive}`.replace(/^http:\/\//i, 'https://')
  const qualities: LiveQuality[] = asArray(data.multirates)
    .map((raw) => {
      const item = asRecord(raw)
      const value = asString(item.rate)
      if (!value) return null
      return { id: value, label: decodeHtml(item.name) || `清晰度 ${value}` }
    })
    .filter((quality): quality is LiveQuality => !!quality)
  const qualityIdOfLine =
    qualityId && qualities.some((quality) => quality.id === qualityId) ? qualityId : ''
  const qualityLabel =
    qualities.find((quality) => quality.id === qualityIdOfLine)?.label ?? '默认'
  return {
    qualities,
    lines: [
      {
        id: `douyu|${new URL(url).host}|${qualityIdOfLine || 'default'}`,
        qualityId: qualityIdOfLine,
        qualityLabel,
        format: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'flv',
        url
      }
    ]
  }
}

function emptyPlayback(error: string): LiveRoomPlayback {
  return {
    detail: {
      platform: 'douyu',
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

export function parseDouyuRoomId(input: string): string {
  const text = input.trim()
  if (!text) return ''
  if (/^\d{1,20}$/.test(text)) return text
  const match = text.match(/douyu\.com\/(?:topic\/)?(\d{1,20})/i)
  return match?.[1] ?? ''
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return '请求超时，请重试'
    return err.message
  }
  return '请求失败，请重试'
}
