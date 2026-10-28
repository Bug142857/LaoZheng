/** X站（pektino.com）共用类型 */

export interface XPost {
  urlCd: string
  mediaId: number
  videoUrl: string
  thumbnail: string | null
  durationSec: number
  favorite: number
  pv: number
  comments: number
  account: string
  tweetUrl: string | null
}

export interface XCategory {
  id: number
  name: string
  code: string
}

export interface XPage {
  items: XPost[]
  page: number
  lastPage: number
  total: number
}

export interface XDetail {
  post: XPost
  tags: string[]
  postedAt: string
}

export interface XListResponse {
  ok: boolean
  page?: XPage
  error?: string
}

export interface XCategoriesResponse {
  ok: boolean
  items: XCategory[]
  error?: string
}

export interface XDetailResponse {
  ok: boolean
  detail?: XDetail
  error?: string
}

export const X_RANGES: { label: string; code: string }[] = [
  { label: '每周', code: 'weekly' },
  { label: '每月', code: 'monthly' },
  { label: '总榜', code: 'all' }
]

export function formatCount(n: number): string {
  if (n >= 10000) {
    const w = n / 10000
    return `${w >= 100 ? w.toFixed(0) : w.toFixed(1)}万`.replace('.0万', '万')
  }
  return String(n || 0)
}

export function formatDuration(sec: number): string {
  if (sec <= 0) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
