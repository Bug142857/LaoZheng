export interface BikaCategory {
  id: string
  title: string
  thumb: string
}

export interface BikaComic {
  id: string
  title: string
  author: string
  thumb: string
  likes: number
  views: number
  finished: boolean
  categories: string[]
  tags: string[]
  epsCount: number
  pagesCount: number
  description: string
  chineseTeam: string
  updatedAt: string
}

export interface BikaChapter {
  id: string
  title: string
  order: number
}

export interface BikaListResponse {
  ok: boolean
  items: BikaComic[]
  page: number
  pages: number
  total: number
  error?: string
}

export interface BikaCategoriesResponse {
  ok: boolean
  items: BikaCategory[]
  error?: string
}

export interface BikaDetailResponse {
  ok: boolean
  comic: BikaComic | null
  error?: string
}

export interface BikaChaptersResponse {
  ok: boolean
  items: BikaChapter[]
  error?: string
}

export interface BikaImagesResponse {
  ok: boolean
  urls: string[]
  error?: string
}

/** 与手机端一致：dd 新到旧 / da 旧到新 / ld 最多喜欢 / vd 最多观看 */
export const BIKA_SORTS = [
  { code: 'dd', label: '新到旧' },
  { code: 'da', label: '旧到新' },
  { code: 'ld', label: '最多喜欢' },
  { code: 'vd', label: '最多观看' }
]

export const EMPTY_BIKA_LIST: BikaListResponse = {
  ok: true,
  items: [],
  page: 1,
  pages: 1,
  total: 0
}
