/**
 * PC 端与手机端（ShangYin）共用的备份格式（version 1）。
 * 基础字段与手机端 `ExportJson.kt` 一致，保证两端可以互相导入导出；
 * PC 端额外带上 liveSources / downloads / settings 三个可选字段，手机端会忽略。
 */

import type {
  SearchCategory,
  SubjectCommentsResponse,
  SubjectCreditsResponse,
  SubjectDetailResponse,
  SubjectFullResponse,
  SubjectKind,
  SubjectSearchResponse,
  DoubanAuthStatus,
  PersonFullResponse
} from './douban'
import type {
  VodCategoriesResponse,
  VodDetailResponse,
  VodListResponse,
  VodSearchResponse,
  VodSourceInput,
  VodTestResponse
} from './vod'
import type {
  LiveChannelResult,
  LiveImportResult,
  LiveSource,
  LiveTestResult
} from './live'
import type { MusicResolveResponse, MusicSearchResponse } from './music'
import type {
  ComicBatchDownloadInput,
  DownloadAddInput,
  DownloadAddResult,
  DownloadChangeRootResult,
  DownloadListResponse,
  DownloadReadResult,
  DownloadRecord
} from './downloads'
import type { CacheClearResult, CacheInfo, UiSettings } from './settings'
import type { XCategoriesResponse, XDetailResponse, XListResponse } from './xsite'
import type { PCategoryCountResponse, PListResponse, PMediaResponse } from './psite'
import type {
  MelonCategoryCountsResponse,
  MelonDetailResponse,
  MelonListResponse
} from './melon'
import type { SyncActionResult, SyncConfigInput, SyncConfigView } from './sync'
import type { UpdateCheckResult, UpdateDownloadResult, UpdateProgress } from './update'
import type { AccountActionResult, AccountsView, AccountSite } from './accounts'
import type {
  BikaCategoriesResponse,
  BikaCategoryCountsResponse,
  BikaChaptersResponse,
  BikaDetailResponse,
  BikaImagesResponse,
  BikaListResponse
} from './bika'
import type {
  KomiicCategoriesResponse,
  KomiicChaptersResponse,
  KomiicDetailResponse,
  KomiicImagesResponse,
  KomiicListResponse
} from './komiic'
import type {
  GameCategoriesResponse,
  GameDetailResponse,
  GameListResponse,
  GameResolveResponse
} from './wygamer'
import type {
  ZlibDetailResponse,
  ZlibDownloadResponse,
  ZlibLoginResult,
  ZlibSearchResponse,
  ZlibStatusResponse
} from './zlib'

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

/** 本机设置快照（PC 端备份扩展；手机端会忽略） */
export interface BackupSettings {
  theme?: string
  accent?: string
  downloadRoot?: string
  lastImageDir?: string
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
  /** PC 端备份扩展：电视源 / 下载记录 / 本机设置（字段存在才导入，手机端忽略） */
  liveSources?: LiveSource[]
  downloads?: DownloadRecord[]
  settings?: BackupSettings
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

/** 片源 / 电视源导出结果 */
export interface SourcesExportResult {
  canceled: boolean
  path?: string
  count?: number
  error?: string
}

export interface DownloadRootResult {
  canceled: boolean
  root?: string
  error?: string
}

export interface SaveImageResult {
  canceled: boolean
  path?: string
  error?: string
}

export interface LaozhengApi {
  loadData: () => Promise<AppData>
  saveData: (data: AppData) => Promise<void>
  /** 退出前同步落盘（避免防抖内的最后一次修改丢失） */
  saveDataSync: (data: AppData) => void
  /** 导入 / 云恢复后，把电视源、下载记录、本机设置一起写回 */
  applyBackupExtras: (data: AppData) => Promise<void>
  importData: () => Promise<ImportResult>
  exportData: (data: AppData) => Promise<ExportResult>
  openDataDir: () => Promise<void>
  dataDir: () => Promise<string>
  appVersion: () => Promise<string>
  searchSubjects: (category: SearchCategory, query: string) => Promise<SubjectSearchResponse>
  fetchSubjectDetail: (kind: SubjectKind, id: string) => Promise<SubjectDetailResponse>
  fetchSubjectFull: (kind: SubjectKind, id: string) => Promise<SubjectFullResponse>
  fetchSubjectComments: (
    kind: SubjectKind,
    id: string,
    order: 'hot' | 'new'
  ) => Promise<SubjectCommentsResponse>
  fetchPersonFull: (id: string) => Promise<PersonFullResponse>
  fetchSubjectCredits: (kind: SubjectKind, id: string) => Promise<SubjectCreditsResponse>
  saveImage: (url: string) => Promise<SaveImageResult>
  searchVod: (source: VodSourceInput, keyword: string, year?: string) => Promise<VodSearchResponse>
  listVod: (
    source: VodSourceInput,
    page: number,
    typeId: number,
    keyword: string
  ) => Promise<VodListResponse>
  fetchVodDetail: (source: VodSourceInput, vodId: number) => Promise<VodDetailResponse>
  testVodSource: (source: VodSourceInput) => Promise<VodTestResponse>
  vodCategories: (source: VodSourceInput) => Promise<VodCategoriesResponse>
  exportVodSources: (sources: { name: string; baseUrl: string; enabled?: boolean }[]) => Promise<SourcesExportResult>
  loadLiveSources: () => Promise<LiveSource[]>
  saveLiveSources: (sources: LiveSource[]) => Promise<void>
  loadLiveChannels: (source: LiveSource) => Promise<LiveChannelResult>
  testLiveSource: (source: LiveSource) => Promise<LiveTestResult>
  exportLiveSources: (sources: LiveSource[]) => Promise<SourcesExportResult>
  importLiveFile: () => Promise<LiveImportResult>
  searchMusic: (keyword: string, page?: number) => Promise<MusicSearchResponse>
  resolveMusic: (songId: string, platform?: string) => Promise<MusicResolveResponse>
  listDownloads: () => Promise<DownloadListResponse>
  addDownload: (input: DownloadAddInput) => Promise<DownloadAddResult>
  removeDownload: (id: string, deleteFile: boolean) => Promise<void>
  cancelDownload: (id: string) => Promise<void>
  openDownloadsDir: () => Promise<void>
  downloadRoot: () => Promise<string>
  chooseDownloadRoot: () => Promise<DownloadRootResult>
  changeDownloadRoot: (root: string, move: boolean) => Promise<DownloadChangeRootResult>
  cacheInfo: () => Promise<CacheInfo>
  clearCache: () => Promise<CacheClearResult>
  getUiSettings: () => Promise<UiSettings>
  setUiSettings: (input: Partial<UiSettings>) => Promise<UiSettings>
  doubanStatus: () => Promise<DoubanAuthStatus>
  doubanLogin: () => Promise<DoubanAuthStatus>
  doubanLogout: () => Promise<DoubanAuthStatus>
  onDownloadsChanged: (callback: () => void) => () => void
  xCategories: () => Promise<XCategoriesResponse>
  xList: (range: string, page: number, category: string) => Promise<XListResponse>
  xDetail: (urlCd: string) => Promise<XDetailResponse>
  pList: (sort: string, catId: number, query: string, page: number) => Promise<PListResponse>
  pResolve: (vkey: string) => Promise<PMediaResponse>
  pCategoryCount: (catId: number) => Promise<PCategoryCountResponse>
  melonList: (path: string) => Promise<MelonListResponse>
  melonDetail: (id: string) => Promise<MelonDetailResponse>
  melonCategoryCounts: () => Promise<MelonCategoryCountsResponse>
  trackMelonImages: (urls: string[]) => Promise<void>
  melonImage: (url: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>
  melonDuration: (url: string) => Promise<{ ok: boolean; seconds?: number; error?: string }>
  getSyncConfig: () => Promise<SyncConfigView>
  saveSyncConfig: (input: SyncConfigInput) => Promise<SyncConfigView>
  testSync: () => Promise<SyncActionResult>
  uploadSync: (data: AppData) => Promise<SyncActionResult>
  downloadSync: () => Promise<SyncActionResult>
  checkUpdate: () => Promise<UpdateCheckResult>
  downloadUpdate: (url: string) => Promise<UpdateDownloadResult>
  installUpdate: (path: string) => Promise<void>
  onUpdateProgress: (callback: (progress: UpdateProgress) => void) => () => void
  openExternal: (url: string) => Promise<void>
  listAccounts: () => Promise<AccountsView>
  loginAccount: (site: AccountSite) => Promise<AccountActionResult>
  openAccountLogin: (site: AccountSite) => Promise<void>
  onAccountsChanged: (callback: () => void) => () => void
  bikaCategories: () => Promise<BikaCategoriesResponse>
  bikaCategoryCounts: () => Promise<BikaCategoryCountsResponse>
  bikaList: (page: number, category: string, sort: string) => Promise<BikaListResponse>
  bikaSearch: (keyword: string, page: number, sort: string) => Promise<BikaListResponse>
  bikaDetail: (id: string) => Promise<BikaDetailResponse>
  bikaChapters: (id: string) => Promise<BikaChaptersResponse>
  bikaImages: (id: string, order: number) => Promise<BikaImagesResponse>
  komiicRecent: (offset: number, status?: string) => Promise<KomiicListResponse>
  komiicHot: (offset: number) => Promise<KomiicListResponse>
  komiicByCategory: (categoryId: string, offset: number) => Promise<KomiicListResponse>
  komiicSearch: (keyword: string, offset: number) => Promise<KomiicListResponse>
  komiicCategories: () => Promise<KomiicCategoriesResponse>
  komiicDetail: (id: string) => Promise<KomiicDetailResponse>
  komiicChapters: (comicId: string) => Promise<KomiicChaptersResponse>
  komiicImages: (comicId: string, chapterId: string) => Promise<KomiicImagesResponse>
  wygamerHome: (page: number) => Promise<GameListResponse>
  wygamerSearch: (keyword: string, page: number) => Promise<GameListResponse>
  wygamerByCategory: (categoryUrl: string, page: number) => Promise<GameListResponse>
  wygamerCategories: () => Promise<GameCategoriesResponse>
  wygamerDetail: (id: string) => Promise<GameDetailResponse>
  wygamerResolveDownload: (payUrl: string) => Promise<GameResolveResponse>
  zlibStatus: () => Promise<ZlibStatusResponse>
  zlibLogin: () => Promise<ZlibLoginResult>
  zlibLogout: () => Promise<ZlibStatusResponse>
  saveZlibCredentials: (username: string, password: string) => Promise<ZlibLoginResult>
  zlibSearch: (keyword: string, page: number) => Promise<ZlibSearchResponse>
  zlibDetail: (id: string, hash: string) => Promise<ZlibDetailResponse>
  zlibDownload: (id: string, hash: string, title: string) => Promise<ZlibDownloadResponse>
  addComicBatchDownload: (input: ComicBatchDownloadInput) => Promise<DownloadAddResult>
  openDownloadItem: (id: string) => Promise<void>
  playDownloadItem: (id: string) => Promise<void>
  readDownloadItem: (id: string) => Promise<DownloadReadResult>
  resolveLegacyMusic: (name: string, artists: string) => Promise<MusicResolveResponse>
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
  const out: AppData = {
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
  // PC 端扩展字段：只有备份里真的存在才带上，缺失时保持 undefined（导入时保留本机原值）
  if (Array.isArray(o.liveSources)) out.liveSources = o.liveSources as LiveSource[]
  if (Array.isArray(o.downloads)) out.downloads = o.downloads as DownloadRecord[]
  if (o.settings && typeof o.settings === 'object') {
    out.settings = o.settings as BackupSettings
  }
  return out
}
