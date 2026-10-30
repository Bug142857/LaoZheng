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

export interface SubjectCredit {
  /** 人物编号（用于跳到人物详情页） */
  id: string | null
  name: string
  role: string
  avatar: string | null
  /** 演职员表的部门分组（导演 / 演员 / 编剧…），来自豆瓣 celebrities 页 */
  department?: string
}

export interface SubjectCreditsResponse {
  ok: boolean
  credits: SubjectCredit[]
  error?: string
}

export interface SubjectComment {
  author: string
  avatar: string | null
  rating: number | null
  content: string
  time: string
  votes: number
}

export interface SubjectTrailer {
  title: string
  url: string
  cover: string | null
}

/** 条目详情页用的完整字段（影视 / 图书 / 游戏共用，按类型取用） */
export interface SubjectFull extends SubjectDetail {
  /** 编剧（影视） */
  writers: string
  /** 国家 / 地区（影视） */
  countries: string
  /** 上映 / 出版日期 */
  dates: string
  /** 片长 */
  durations: string
  /** 别名 / 副标题 */
  aka: string
  /** 图书：出版社、页数、装帧、作者简介、目录 */
  publisher: string
  pages: string
  binding: string
  authorIntro: string
  catalog: string
  /** 游戏：开发商 / 发行 / 平台 / 发售时间 */
  developers: string
  publishers: string
  platforms: string
  releaseDate: string
  /** 职员表 / 剧照 / 预告片 */
  credits: SubjectCredit[]
  /** 演职员总数（站点只返回主要演职员时用来说明「共 N 人」） */
  creditsTotal: number
  photos: string[]
  trailers: SubjectTrailer[]
  /** 次要数据超时导致的残缺结果：不写入磁盘缓存，下次重试 */
  partial?: boolean
}

export interface SubjectFullResponse {
  ok: boolean
  detail?: SubjectFull
  error?: string
}

/** 人物详情（演职员 / 图书作者点进去的页面） */
export interface PersonWork {
  id: string
  title: string
  /** 作品类型：用于点开后进入对应的条目详情页 */
  kind: 'movie' | 'tv' | 'book'
  year: string
  role: string
  cover: string | null
  rating: number | null
  /** 评价人数，用作「收藏最多的作品」排序 */
  ratingCount: number
  /** 豆瓣 is_released：未上映的作品不展示 */
  isReleased?: boolean
}

export interface PersonAward {
  year: number
  ceremony: string
  category: string
  won: boolean
}

export interface PersonFull {
  id: string
  name: string
  avatar: string | null
  gender: string
  birthday: string
  birthplace: string
  professions: string
  aka: string
  intro: string
  awards: PersonAward[]
  photos: string[]
  /** 最近的作品（按年份倒序） */
  recentWorks: PersonWork[]
  /** 收藏最多的作品（按评价人数倒序） */
  topWorks: PersonWork[]
  /** 作品区标题用的身份：导演 / 编剧 / 演员 / 作者 */
  worksLabel: string
  /** 作品列表没取到时的残缺结果：不写入磁盘缓存 */
  partial?: boolean
}

export interface PersonFullResponse {
  ok: boolean
  person?: PersonFull
  error?: string
}

export interface SubjectCommentsResponse {
  ok: boolean
  comments: SubjectComment[]
  error?: string
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

/** 豆瓣登录态（登录窗口写入 Cookie 后由主进程读取） */
export interface DoubanAuthStatus {
  loggedIn: boolean
  message: string
  updatedAt: number
}
