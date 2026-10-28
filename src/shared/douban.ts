/**
 * 搜索模块共用类型（主进程解析 → 渲染进程展示）。
 * 数据字段与手机端 `DoubanResult` 对齐，落库时写入 items。
 */

/** 搜索页分类：影视（电影 + 剧集）/ 图书 / 游戏 / 人物 */
export type SearchCategory = 'video' | 'book' | 'game' | 'person'

/** 可落库的条目类型 */
export type SubjectKind = 'movie' | 'tv' | 'book' | 'game'

export type ResultKind = SubjectKind | 'person'

/** 与手机端 Category.label 一致：电影 / 剧集 / 图书 / 游戏 */
export const KIND_LABELS: Record<ResultKind, string> = {
  movie: '电影',
  tv: '剧集',
  book: '图书',
  game: '游戏',
  person: '人物'
}

export const SEARCH_CATEGORIES: { key: SearchCategory; label: string }[] = [
  { key: 'video', label: '影视' },
  { key: 'book', label: '图书' },
  { key: 'game', label: '游戏' },
  { key: 'person', label: '人物' }
]

export interface SubjectSearchItem {
  kind: ResultKind
  id: string
  title: string
  subTitle: string
  year: string
  coverUrl: string | null
  rating: number | null
  intro: string
  url: string
}

export interface SubjectDetail {
  title: string | null
  rating: number | null
  coverUrl: string | null
  summary: string
  info: string
  directors: string
  casts: string
  genres: string
}

export interface SubjectSearchResponse {
  ok: boolean
  items: SubjectSearchItem[]
  /** 部分来源失败时的提示（主结果仍可用） */
  warning?: string
  error?: string
}

export interface SubjectDetailResponse {
  ok: boolean
  detail?: SubjectDetail
  error?: string
}
