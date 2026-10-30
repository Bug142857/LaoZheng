export interface KomiicAuthor {
  id: string
  name: string
}

export interface KomiicCategory {
  id: string
  name: string
  /** 该分类下的漫画数量（站点 allCategory 直接返回） */
  count: number
}

export interface KomiicComic {
  id: string
  title: string
  status: string
  imageUrl: string
  authors: KomiicAuthor[]
  categories: KomiicCategory[]
  dateUpdated: string
  lastChapterUpdate: string
  monthViews: number
  views: number
  favoriteCount: number
}

export interface KomiicChapter {
  id: string
  serial: string
  type: string
  size: number
}

export interface KomiicListResponse {
  ok: boolean
  items: KomiicComic[]
  error?: string
}

export interface KomiicCategoriesResponse {
  ok: boolean
  items: KomiicCategory[]
  error?: string
}

export interface KomiicDetailResponse {
  ok: boolean
  comic: KomiicComic | null
  error?: string
}

export interface KomiicChaptersResponse {
  ok: boolean
  items: KomiicChapter[]
  error?: string
}

export interface KomiicImagesResponse {
  ok: boolean
  urls: string[]
  error?: string
}

export const KOMIIC_PAGE_SIZE = 20

export function komiicStatusLabel(status: string): string {
  const s = status.toUpperCase()
  if (s === 'ONGOING') return '连载中'
  if (s === 'END') return '已完结'
  return status || '未知'
}
