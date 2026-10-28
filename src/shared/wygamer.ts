/** 无忧游戏库（wygamer.com）共享类型，字段对齐手机端 WygamerClient.kt */

export interface GameItem {
  id: string
  title: string
  url: string
  cover: string | null
  categories: string[]
  badge: string | null
}

export interface GameCategory {
  name: string
  url: string
  count: number
}

export interface GameAttr {
  key: string
  value: string
}

/** 下载按钮：url 为站内 pay-download 中转链接，需要再解析成网盘分享页 */
export interface GameDownload {
  label: string
  url: string
}

export interface GameBlock {
  isHeading: boolean
  text: string
}

export interface GameDetail {
  id: string
  title: string
  cover: string | null
  categories: string[]
  attrs: GameAttr[]
  downloads: GameDownload[]
  screenshots: string[]
  blocks: GameBlock[]
  unzipPassword: string | null
}

export interface GameListResponse {
  ok: boolean
  items: GameItem[]
  page: number
  lastPage: number
  error?: string
}

export interface GameCategoriesResponse {
  ok: boolean
  items: GameCategory[]
  error?: string
}

export interface GameDetailResponse {
  ok: boolean
  game: GameDetail | null
  error?: string
}

export interface GameResolveResponse {
  ok: boolean
  url?: string
  error?: string
}
