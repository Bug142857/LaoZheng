/**
 * PC 端与手机端（ShangYin）共用的备份格式（version 1）。
 * 字段名与手机端 `ExportJson.kt` 完全一致，保证两端可以互相导入导出。
 */

export interface CollectionItem {
  id: number
  category: string
  doubanId: string
  title: string
  subTitle: string
  year: string
  doubanRating: number | null
  coverUrl: string | null
  summary: string
  info: string
  directors: string
  casts: string
  genres: string
  doubanUrl: string | null
  status: string
  myRating: number
  note: string
  createdAt: number
  updatedAt: number
}

export interface ItemList {
  id: number
  name: string
  description: string
  coverUrl: string | null
  parentId: number | null
  sortIndex: number
  /** 0 = 表世界（旧字段，保留兼容）；PC 端只有清单模块 */
  world: number
  musicList: boolean
  createdAt: number
}

export interface ListItem {
  listId: number
  itemId: number
  orderIndex: number
}

export interface VodSource {
  id: string
  name: string
  baseUrl: string
  enabled: boolean
  /** cn = 国内可访问；proxy = 需要外网 */
  region: string
  regionManual: boolean
  testStatus: string | null
  testMsg: string | null
  testAt: number
}

export interface InnerFav {
  module: string
  id: string
  title: string
  subtitle: string
  cover: string | null
  savedAt: number
  videoUrl: string | null
  mediaId: number
  durationSec: number
  tweetUrl: string | null
  payload: string | null
}

export interface AppData {
  version: number
  exportAt?: string
  items: CollectionItem[]
  lists: ItemList[]
  listItems: ListItem[]
  vodSources: VodSource[]
  innerFavs: InnerFav[]
  readProgress: Record<string, string>
  config: Record<string, string>
}

export interface ImportResult {
  canceled: boolean
  data?: AppData
  error?: string
}

export interface ExportResult {
  canceled: boolean
  path?: string
  error?: string
}

export interface LaozhengApi {
  loadData: () => Promise<AppData>
  saveData: (data: AppData) => Promise<void>
  importData: () => Promise<ImportResult>
  exportData: (data: AppData) => Promise<ExportResult>
  openDataDir: () => Promise<void>
  dataDir: () => Promise<string>
  appVersion: () => Promise<string>
}

export const EMPTY_DATA: AppData = {
  version: 1,
  items: [],
  lists: [],
  listItems: [],
  vodSources: [],
  innerFavs: [],
  readProgress: {},
  config: {}
}

export function normalizeData(raw: unknown): AppData {
  const o = (raw ?? {}) as Partial<AppData>
  return {
    version: typeof o.version === 'number' ? o.version : 1,
    exportAt: o.exportAt,
    items: Array.isArray(o.items) ? o.items : [],
    lists: Array.isArray(o.lists) ? o.lists : [],
    listItems: Array.isArray(o.listItems) ? o.listItems : [],
    vodSources: Array.isArray(o.vodSources) ? o.vodSources : [],
    innerFavs: Array.isArray(o.innerFavs) ? o.innerFavs : [],
    readProgress: o.readProgress && typeof o.readProgress === 'object' ? o.readProgress : {},
    config: o.config && typeof o.config === 'object' ? o.config : {}
  }
}
