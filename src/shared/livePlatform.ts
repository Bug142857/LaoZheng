/**
 * 平台直播（B站 / 斗鱼 / 抖音）。
 * 与「电视」模块的 M3U 直播源（shared/live.ts）是两套数据，互不影响。
 */

export type LivePlatformId = 'bilibili' | 'douyu' | 'douyin'

export interface LivePlatformMeta {
  id: LivePlatformId
  name: string
}

export const LIVE_PLATFORMS: LivePlatformMeta[] = [
  { id: 'bilibili', name: 'B站' },
  { id: 'douyu', name: '斗鱼' },
  { id: 'douyin', name: '抖音' }
]

export function isLivePlatformId(value: unknown): value is LivePlatformId {
  return value === 'bilibili' || value === 'douyu' || value === 'douyin'
}

export type LiveRoomStatus = 'living' | 'offline' | 'replay' | 'unknown'

export interface LiveRoom {
  platform: LivePlatformId
  roomId: string
  title: string
  anchor: string
  cover: string
  area: string
  watching: string
  status: LiveRoomStatus
  statusText?: string
  avatar?: string
  link?: string
}

export interface LiveRoomDetail extends LiveRoom {
  description?: string
  notice?: string
  startedAt?: number
}

export interface LiveCategoryArea {
  id: string
  name: string
  parentId: string
  icon?: string
}

export interface LiveCategoryGroup {
  id: string
  name: string
  areas: LiveCategoryArea[]
}

export interface LiveQuality {
  id: string
  label: string
}

export type LiveStreamFormat = 'hls' | 'flv'

export interface LivePlayLine {
  id: string
  qualityId: string
  qualityLabel: string
  format: LiveStreamFormat
  url: string
}

export interface LiveRoomPlayback {
  detail: LiveRoomDetail
  qualities: LiveQuality[]
  lines: LivePlayLine[]
  error?: string
}

export interface LiveListResult {
  items: LiveRoom[]
  hasMore: boolean
  error?: string
}

export interface LiveCategoriesResult {
  groups: LiveCategoryGroup[]
  error?: string
}

export type LiveListKind = 'recommend' | 'category' | 'search'

export interface LiveListParams {
  page?: number
  parentId?: string
  areaId?: string
  keyword?: string
}

export interface LiveLoginStatus {
  platform: LivePlatformId
  loggedIn: boolean
  name?: string
  avatar?: string
  uid?: string
  expireAt?: number
}

/** B站扫码：二维码图片由主进程生成 data URL，渲染层直接显示 */
export interface LiveQrStart {
  key: string
  image: string
  expireAt: number
}

export type LiveQrState = 'waiting' | 'scanned' | 'expired' | 'confirmed'

export interface LiveQrPollResult {
  state: LiveQrState
  login?: LiveLoginStatus
}

/** 斗鱼 / 抖音走官方登录窗；返回 true 表示已拿到登录 Cookie */
export interface LiveLoginWindowResult {
  canceled: boolean
  login?: LiveLoginStatus
  error?: string
}

export interface LiveFavorite {
  platform: LivePlatformId
  roomId: string
  title: string
  anchor: string
  cover: string
  area: string
  savedAt: number
}

export interface LiveHistoryItem {
  platform: LivePlatformId
  roomId: string
  title: string
  anchor: string
  cover: string
  watchedAt: number
}

/** 从收藏管理 / 外部入口直接打开直播间时携带的信息 */
export interface LiveRoomFocus {
  platform: LivePlatformId
  roomId: string
  title?: string
  anchor?: string
  cover?: string
  /** 同一房间重复点击时用来触发重新打开 */
  at?: number
}

export function liveRoomKey(platform: LivePlatformId, roomId: string): string {
  return `${platform}:${roomId}`
}

export function normalizeLiveFavorites(raw: unknown): LiveFavorite[] {
  if (!Array.isArray(raw)) return []
  const out: LiveFavorite[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (!isLivePlatformId(o.platform)) continue
    const roomId = typeof o.roomId === 'string' ? o.roomId.trim() : ''
    if (!roomId) continue
    const key = liveRoomKey(o.platform, roomId)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      platform: o.platform,
      roomId,
      title: typeof o.title === 'string' ? o.title : '',
      anchor: typeof o.anchor === 'string' ? o.anchor : '',
      cover: typeof o.cover === 'string' ? o.cover : '',
      area: typeof o.area === 'string' ? o.area : '',
      savedAt: typeof o.savedAt === 'number' && Number.isFinite(o.savedAt) ? o.savedAt : Date.now()
    })
  }
  return out
}

export function normalizeLiveHistory(raw: unknown, limit = 100): LiveHistoryItem[] {
  if (!Array.isArray(raw)) return []
  const out: LiveHistoryItem[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (!isLivePlatformId(o.platform)) continue
    const roomId = typeof o.roomId === 'string' ? o.roomId.trim() : ''
    if (!roomId) continue
    const key = liveRoomKey(o.platform, roomId)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      platform: o.platform,
      roomId,
      title: typeof o.title === 'string' ? o.title : '',
      anchor: typeof o.anchor === 'string' ? o.anchor : '',
      cover: typeof o.cover === 'string' ? o.cover : '',
      watchedAt:
        typeof o.watchedAt === 'number' && Number.isFinite(o.watchedAt) ? o.watchedAt : Date.now()
    })
    if (out.length >= limit) break
  }
  return out
}
