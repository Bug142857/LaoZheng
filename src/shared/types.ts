/**
 * PC 端与手机端（ShangYin）共用的备份格式（version 1）。
 * 字段名与手机端 `ExportJson.kt` 完全一致，保证两端可以互相导入导出。
 */

import type {
  SearchCategory,
  SubjectDetailResponse,
  SubjectKind,
  SubjectSearchResponse
} from './douban'
import type {
  VodDetailResponse,
  VodSearchResponse,
  VodSourceInput,
  VodTestResponse
} from './vod'
import type { LiveChannelResult, LiveImportResult, LiveSource } from './live'
import type { MusicResolveResponse, MusicSearchResponse } from './music'
import type {
  DownloadAddInput,
  DownloadAddResult,
  DownloadListResponse
} from './downloads'
import type { XCategoriesResponse, XDetailResponse, XListResponse } from './xsite'
import type { PListResponse, PMediaResponse } from './psite'
import type { MelonDetailResponse, MelonListResponse } from './melon'
import type { SyncActionResult, SyncConfigInput, SyncConfigView } from './sync'
import type { UpdateCheckResult } from './update'

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
  searchSubjects: (category: SearchCategory, query: string) => Promise<SubjectSearchResponse>
  fetchSubjectDetail: (kind: SubjectKind, id: string) => Promise<SubjectDetailResponse>
  searchVod: (source: VodSourceInput, keyword: string, year?: string) => Promise<VodSearchResponse>
  fetchVodDetail: (source: VodSourceInput, vodId: number) => Promise<VodDetailResponse>
  testVodSource: (source: VodSourceInput) => Promise<VodTestResponse>
  loadLiveSources: () => Promise<LiveSource[]>
  saveLiveSources: (sources: LiveSource[]) => Promise<void>
  loadLiveChannels: (source: LiveSource) => Promise<LiveChannelResult>
  importLiveFile: () => Promise<LiveImportResult>
  searchMusic: (keyword: string, page?: number) => Promise<MusicSearchResponse>
  resolveMusic: (songId: string) => Promise<MusicResolveResponse>
  listDownloads: () => Promise<DownloadListResponse>
  addDownload: (input: DownloadAddInput) => Promise<DownloadAddResult>
  removeDownload: (id: string, deleteFile: boolean) => Promise<void>
  cancelDownload: (id: string) => Promise<void>
  openDownloadsDir: () => Promise<void>
  onDownloadsChanged: (callback: () => void) => () => void
  xCategories: () => Promise<XCategoriesResponse>
  xList: (range: string, page: number, category: string) => Promise<XListResponse>
  xDetail: (urlCd: string) => Promise<XDetailResponse>
  pList: (sort: string, catId: number, query: string, page: number) => Promise<PListResponse>
  pResolve: (vkey: string) => Promise<PMediaResponse>
  melonList: (path: string) => Promise<MelonListResponse>
  melonDetail: (id: string) => Promise<MelonDetailResponse>
  getSyncConfig: () => Promise<SyncConfigView>
  saveSyncConfig: (input: SyncConfigInput) => Promise<SyncConfigView>
  testSync: () => Promise<SyncActionResult>
  uploadSync: (data: AppData) => Promise<SyncActionResult>
  downloadSync: () => Promise<SyncActionResult>
  checkUpdate: () => Promise<UpdateCheckResult>
  openExternal: (url: string) => Promise<void>
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
