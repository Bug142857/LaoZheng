/**
 * PC 端与手机端（ShangYin）共用的备份格式（version 1）。
 * 基础字段与手机端 `ExportJson.kt` 一致，保证两端可以互相导入导出；
 * PC 端额外带上 liveSources / downloads / magnetSources / magnetSearch / settings，
 * 手机端会忽略这些可选字段。
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
import type {
  MagnetOptions,
  MagnetSearchCache,
  MagnetSearchResponse,
  MagnetSource,
  MagnetSourcesImportResult,
  MagnetState,
  MagnetTestResult
} from './magnet'
import { normalizeMagnetSearchCache } from './magnet'
import type { MusicResolveResponse, MusicSearchResponse } from './music'
import type {
  ComicBatchDownloadInput,
  DownloadAddInput,
  DownloadAddResult,
  DownloadChangeRootResult,
  DownloadListResponse,
  DownloadReadResult,
  DownloadRecord,
  DownloadRemoveResult
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
import type {
  DramaCatalogResponse,
  DramaDetailResponse,
  DramaPlayResponse,
  DramaSource,
  DramaSourceInput
} from './drama'
import { DEFAULT_DRAMA_SOURCES, normalizeDramaSources } from './drama'

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
  /** 各类导入 / 导出对话框上次选择的目录 */
  lastDirs?: Record<string, string>
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
  /** 磁力源（主进程 magnet-sources.json）与上次搜索结果缓存 */
  magnetSources?: MagnetSource[]
  magnetSearch?: MagnetSearchCache
  settings?: BackupSettings
  /** 短剧源（内置西饭 + 添加的苹果CMS 源），随备份与云同步一起走 */
  dramaSources: DramaSource[]
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

/** 片源管理：全部源整体导入导出（影视 / 短剧 / 电视 / 磁力） */
export interface AllSourcesBundle {
  vodSources: { name: string; baseUrl: string; enabled?: boolean }[]
  dramaSources: { id?: string; name: string; baseUrl: string; enabled?: boolean }[]
  liveSources: LiveSource[]
  magnetSources: MagnetSource[]
}

export interface AllSourcesImportResult {
  canceled: boolean
  data?: AllSourcesBundle
  error?: string
}

/** 清单管理：清单 / 条目关联 / 条目一起导入导出 */
export interface ListBundle {
  lists: ItemList[]
  listItems: ListItem[]
  items: CollectionItem[]
}

export interface ListBundleImportResult {
  canceled: boolean
  data?: ListBundle
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
  /** 清单管理：清单（含条目）单独导出 / 导入 */
  exportLists: (bundle: ListBundle) => Promise<SourcesExportResult>
  importLists: () => Promise<ListBundleImportResult>
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
  magnetState: () => Promise<MagnetState>
  saveMagnetSources: (sources: MagnetSource[]) => Promise<MagnetState>
  resetMagnetSources: () => Promise<MagnetState>
  exportMagnetSources: (sources: MagnetSource[]) => Promise<SourcesExportResult>
  importMagnetSources: () => Promise<MagnetSourcesImportResult>
  openMagnetLog: () => Promise<void>
  testMagnetSource: (source: MagnetSource) => Promise<MagnetTestResult>
  searchMagnet: (
    source: MagnetSource,
    keyword: string,
    page: number,
    options: MagnetOptions
  ) => Promise<MagnetSearchResponse>
  searchMagnetAll: (
    sources: MagnetSource[],
    keyword: string,
    options: MagnetOptions
  ) => Promise<MagnetSearchResponse>
  openMagnet: (magnet: string) => Promise<void>
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
  removeDownload: (id: string, deleteFile: boolean) => Promise<DownloadRemoveResult>
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
  dramaCatalog: (
    source: DramaSourceInput,
    genre: string,
    page: number,
    keyword: string
  ) => Promise<DramaCatalogResponse>
  dramaDetail: (source: DramaSourceInput, seriesId: string) => Promise<DramaDetailResponse>
  dramaPlay: (
    source: DramaSourceInput,
    seriesId: string,
    episodeId: string
  ) => Promise<DramaPlayResponse>
  exportDramaSources: (sources: { id?: string; name: string; baseUrl: string; enabled?: boolean }[]) => Promise<SourcesExportResult>
  /** 片源管理：全部源一起导出 / 导入 */
  exportAllSources: (bundle: AllSourcesBundle) => Promise<SourcesExportResult>
  importAllSources: () => Promise<AllSourcesImportResult>
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
  config: {},
  dramaSources: DEFAULT_DRAMA_SOURCES
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
    config: o.config && typeof o.config === 'object' ? o.config : {},
    // 短剧源始终补全四个内置条目，旧备份 / 手机端备份导入后也能直接用
    dramaSources: normalizeDramaSources(o.dramaSources)
  }
  // PC 端扩展字段：只有备份里真的存在才带上，缺失时保持 undefined（导入时保留本机原值）
  if (Array.isArray(o.liveSources)) out.liveSources = o.liveSources as LiveSource[]
  if (Array.isArray(o.downloads)) out.downloads = o.downloads as DownloadRecord[]
  if (Array.isArray(o.magnetSources)) out.magnetSources = o.magnetSources as MagnetSource[]
  if (o.magnetSearch && typeof o.magnetSearch === 'object') {
    const cache = normalizeMagnetSearchCache(o.magnetSearch)
    if (cache) out.magnetSearch = cache
  }
  if (o.settings && typeof o.settings === 'object') {
    out.settings = o.settings as BackupSettings
  }
  return out
}

/**
 * 导出给手机端前去掉所有 null 字段。
 * Android org.json 的 optString 会把 JSON null 读成字符串 "null"（不是空串），
 * 手机端再用 ifBlank { null } 判断就会把 "null" 当成真实封面 / 链接 / payload。
 */
export function stripNullFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripNullFields(entry)) as T
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (entry === null) continue
      out[key] = stripNullFields(entry)
    }
    return out as T
  }
  return value
}
