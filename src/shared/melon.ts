/** 吃瓜（51爆料）共用类型与分类表 */

export interface MelonCategory {
  label: string
  path: string
}

export const MELON_CATEGORIES: MelonCategory[] = [
  { label: '最新', path: '/' },
  { label: '学生校园', path: 'category/xsxy/' },
  { label: '明星黑料', path: 'category/mxhl/' },
  { label: '反差吃瓜', path: 'category/fccg/' },
  { label: '必撸精品', path: 'category/bljp/' },
  { label: '每日大赛', path: 'category/mrds/' },
  { label: '网黄专区', path: 'category/whzq/' },
  { label: '吃瓜猎奇', path: 'category/cgxw/' },
  { label: '热门混剪', path: 'category/dyfjx/' },
  { label: '寸止挑战', path: 'category/cztz/' },
  { label: '无码AV', path: 'category/wmav/' },
  { label: '探花精选', path: 'category/thjp/' }
]

export interface MelonPost {
  id: string
  title: string
  cover: string | null
  author: string
  date: string
  categories: string[]
}

export interface MelonPage {
  items: MelonPost[]
  nextPath: string | null
  lastPage: number | null
}

export type MelonBlock =
  | { type: 'text'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'image'; url: string }
  | { type: 'video'; title: string; url: string }

export interface MelonDetail {
  id: string
  title: string
  cover: string | null
  author: string
  date: string
  categories: string[]
  blocks: MelonBlock[]
  related: MelonPost[]
}

export interface MelonListResponse {
  ok: boolean
  page?: MelonPage
  error?: string
}

export interface MelonDetailResponse {
  ok: boolean
  detail?: MelonDetail
  error?: string
}

/** 分类 path → 条目数量；-1 表示暂时取不到 */
export interface MelonCategoryCountsResponse {
  ok: boolean
  counts: Record<string, number>
  error?: string
}
