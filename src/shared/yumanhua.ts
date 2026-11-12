/** 漫画客（yumanhua.com）：漫画模块的第二个源，默认排在 Komiic 前面 */

export interface YumanhuaCategory {
  id: string
  name: string
}

export const YUMANHUA_CATEGORIES: YumanhuaCategory[] = [
  { id: '1', name: '冒险' },
  { id: '2', name: '热血' },
  { id: '3', name: '都市' },
  { id: '4', name: '玄幻' },
  { id: '5', name: '悬疑' },
  { id: '6', name: '耽美' },
  { id: '7', name: '恋爱' },
  { id: '8', name: '生活' },
  { id: '9', name: '搞笑' },
  { id: '10', name: '穿越' },
  { id: '11', name: '修真' },
  { id: '12', name: '后宫' },
  { id: '13', name: '女主' },
  { id: '14', name: '古风' },
  { id: '15', name: '连载' },
  { id: '16', name: '完结' }
]

export interface YumanhuaComic {
  /** 统一加 ymh: 前缀，避免与 Komiic 数字 ID 冲突 */
  id: string
  title: string
  cover: string
  author: string
  tags: string[]
  status: string
  latest: string
  intro: string
}

export interface YumanhuaChapter {
  id: string
  name: string
  index: number
  size: number
}

export interface YumanhuaListResponse {
  ok: boolean
  items: YumanhuaComic[]
  error?: string
  hasMore?: boolean
  /** 站点能算出的总页数（哔咔等分页源），没有时省略 */
  totalPages?: number
}

export interface YumanhuaDetailResponse {
  ok: boolean
  comic: YumanhuaComic | null
  error?: string
}

export interface YumanhuaChaptersResponse {
  ok: boolean
  items: YumanhuaChapter[]
  error?: string
}

export interface YumanhuaImagesResponse {
  ok: boolean
  urls: string[]
  error?: string
}

export const YUMANHUA_PAGE_SIZE = 20
export const YUMANHUA_ID_PREFIX = 'ymh:'

export function yumanhuaId(slug: string, sourceId = 'yumanhua'): string {
  const value = slug.trim().replace(/^\/+|\/+$/g, '')
  if (/^ymh[_a-zA-Z0-9]*:/.test(value)) return value
  const prefix = sourceId === 'yumanhua' ? YUMANHUA_ID_PREFIX : `ymh_${sourceId}:`
  return `${prefix}${value}`
}

export function yumanhuaSlug(id: string): string {
  const index = id.lastIndexOf(':')
  return index >= 0 ? id.slice(index + 1) : id
}

export function yumanhuaSourceId(id: string): string {
  if (!id.startsWith('ymh')) return ''
  const index = id.indexOf(':')
  if (index < 0) return 'yumanhua'
  const prefix = id.slice(0, index)
  return prefix === 'ymh' ? 'yumanhua' : prefix.replace(/^ymh_/, '')
}
