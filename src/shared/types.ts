/**
 * PC 端与手机端（ShangYin）共用的备份格式（version 1）。
 * 基础字段与手机端 `ExportJson.kt` 一致，保证两端可以互相导入导出；
 * PC 端额外带上 liveSources / downloads / magnetSources / magnetSearch / settings，
 * 手机端会忽略这些可选字段。
 */

import type {
  DoubanHotKind,
  DoubanHotResponse,
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
  LiveCategoriesResult,
  LiveFavorite,
  LiveHistoryItem,
  LiveListKind,
  LiveListParams,
  LiveListResult,
  LiveLoginStatus,
  LiveLoginWindowResult,
  LivePlatformId,
  LiveQrPollResult,
  LiveQrStart,
  LiveRoomPlayback
} from './livePlatform'
import { normalizeLiveFavorites, normalizeLiveHistory } from './livePlatform'
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
import type {
  MusicLyricsSaveResult,
  MusicQuality,
  MusicResolveResponse,
  MusicSearchResponse,
  MusicSource,
  MusicSourceInput,
  MusicTestResult
} from './music'
import {
  ADDED_LX_MUSIC_SOURCES,
  DEFAULT_MUSIC_SOURCES,
  LX_MUSIC_SOURCES,
  normalizeMusicSources
} from './music'
import type {
  ComicBatchDownloadInput,
  DownloadAddInput,
  DownloadAddResult,
  DownloadChangeRootResult,
  DownloadKind,
  DownloadListResponse,
  DownloadReadResult,
  DownloadRecord,
  DownloadRemoveResult
} from './downloads'
import type { CacheClearResult, CacheDirResult, CacheInfo, UiSettings } from './settings'
import type { XCategoriesResponse, XDetailResponse, XListResponse } from './xsite'
import type { PCategoryCountResponse, PListResponse, PMediaResponse } from './psite'
import type {
  MelonCategoryCountsResponse,
  MelonDetailResponse,
  MelonListResponse
} from './melon'
import type {
  SkCatalogResponse,
  SkContent,
  SkDetailResponse,
  SkPlayResponse,
  SkSort,
  ShuangkanSource,
  ShuangkanSourceRef
} from './shuangkan'
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
  YumanhuaChaptersResponse,
  YumanhuaDetailResponse,
  YumanhuaImagesResponse,
  YumanhuaListResponse
} from './yumanhua'
import type { ComicSource, ComicSourceInput } from './comicSources'
import {
  ADDED_COMIC_SOURCES,
  DEFAULT_COMIC_SOURCES,
  JMCOMIC_COMIC_SOURCE,
  TPTOON_COMIC_SOURCE,
  normalizeComicSources
} from './comicSources'
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
import type { SystemInfoResult } from './sysinfo'
import type {
  InstalledTrainer,
  TrainerActionResult,
  TrainerDetailResponse,
  TrainerDownloadInput,
  TrainerDownloadResponse,
  TrainerLibraryResponse,
  TrainerSearchResponse,
  TrainerSource,
  TrainerSourceInput,
  TrainerSourceType,
  TrainerTestResult
} from './trainers'
import { DEFAULT_TRAINER_SOURCES, normalizeTrainerSources } from './trainers'
import type {
  NovelChapterResponse,
  NovelDetailResponse,
  NovelDownloadInput,
  NovelDownloadProgress,
  NovelDownloadResult,
  NovelListResponse,
  NovelSource,
  NovelSourceInput,
  NovelTestResult
} from './novel'
import {
  ADDED_NOVEL_SOURCES,
  BIKAHUB_NOVEL_SOURCE,
  DEFAULT_NOVEL_SOURCES,
  normalizeNovelSources
} from './novel'
import { DEFAULT_H1_SOURCES, normalizeH1Sources } from './h1'
import type { BikahubCategoryCountsResponse } from './bikahub'
import type { TptoonCategoryCountsResponse } from './tptoon'
import type { JmcomicCategoryCountsResponse } from './jmcomic'
import {
  DEFAULT_LIVE_PLATFORM_SOURCES,
  normalizeLivePlatformSources,
  type LivePlatformSource
} from './livePlatformSources'
import type {
  WallpaperCategoriesResponse,
  WallpaperDevice,
  WallpaperListResponse,
  WallpaperResolveResponse,
  WallpaperSource,
  WallpaperSourceRef,
  WallpaperSourceTemplate
} from './wallpaper'
import { DEFAULT_WALLPAPER_SOURCES, normalizeWallpaperSources } from './wallpaper'
import type {
  MeituCategoriesResponse,
  MeituDetailResponse,
  MeituListResponse,
  MeituSource,
  MeituSourceRef,
  MeituSourceTemplate
} from './meitu'
import { DEFAULT_MEITU_SOURCES, normalizeMeituSources } from './meitu'
import { DEFAULT_SHUANGKAN_SOURCES, normalizeShuangkanSources } from './shuangkan'

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
  /** 侧栏导航顺序（share / optimize 两套树各自保存模块 key） */
  navOrder?: Record<string, string[]>
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
  /** 平台直播（B站 / 斗鱼 / 抖音）的收藏与观看历史，随备份与云同步一起走 */
  liveFavorites: LiveFavorite[]
  liveHistory: LiveHistoryItem[]
  downloads?: DownloadRecord[]
  /** 磁力源（主进程 magnet-sources.json）与上次搜索结果缓存 */
  magnetSources?: MagnetSource[]
  magnetSearch?: MagnetSearchCache
  settings?: BackupSettings
  /** 短剧源（内置西饭 + 添加的苹果CMS 源），随备份与云同步一起走 */
  dramaSources: DramaSource[]
  /** 已安装的游戏修改器记录（PC 扩展；只记目录信息，文件本身不参与备份） */
  installedTrainers?: InstalledTrainer[]
  /** 修改器源（风灵月影 / MegaGames / 自定义镜像），随备份与云同步一起走 */
  trainerSources: TrainerSource[]
  /** 音乐源（无名音乐 / 33ve / 自定义镜像），随备份与云同步一起走 */
  musicSources: MusicSource[]
  /** 小说书源（笔趣阁系模板），随备份与云同步一起走 */
  novelSources: NovelSource[]
  /** 漫画源（漫画客 / Komiic），随备份与云同步一起走 */
  comicSources: ComicSource[]
  /** 番号源（默认四个外网采集站），随备份与云同步一起走 */
  h1Sources: VodSource[]
  /** 平台直播源（B站 / 斗鱼 / 抖音），随备份与云同步一起走 */
  livePlatformSources: LivePlatformSource[]
  /** 壁纸源（Wallspic / 壁纸迷站点模板），随备份与云同步一起走 */
  wallpaperSources: WallpaperSource[]
  /** 美图源（魅影画廊 / 雪月映画），随备份与云同步一起走 */
  meituSources: MeituSource[]
  /** 爽看源（肉视频站点），随备份与云同步一起走 */
  shuangkanSources: ShuangkanSource[]
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

/** 片源管理：全部源整体导入导出（影视 / 短剧 / 电视 / 磁力 / 修改器 / 音乐） */
export interface AllSourcesBundle {
  vodSources: { name: string; baseUrl: string; enabled?: boolean }[]
  dramaSources: { id?: string; name: string; baseUrl: string; enabled?: boolean }[]
  liveSources: LiveSource[]
  magnetSources: MagnetSource[]
  trainerSources: {
    id?: string
    name: string
    type: TrainerSourceType
    baseUrl: string
    enabled?: boolean
  }[]
  musicSources?: {
    id?: string
    name: string
    baseUrl: string
    enabled?: boolean
  }[]
  novelSources?: {
    id?: string
    name: string
    baseUrl: string
    template: string
    enabled?: boolean
  }[]
  comicSources?: {
    id?: string
    name: string
    baseUrl: string
    template?: string
    enabled?: boolean
  }[]
  h1Sources?: {
    id?: string
    name: string
    baseUrl: string
    enabled?: boolean
  }[]
  livePlatformSources?: {
    id?: string
    name: string
    baseUrl: string
    enabled?: boolean
  }[]
  wallpaperSources?: {
    id?: string
    name: string
    baseUrl: string
    template: WallpaperSourceTemplate
    enabled?: boolean
  }[]
  meituSources?: {
    id?: string
    name: string
    baseUrl: string
    template: MeituSourceTemplate
    enabled?: boolean
  }[]
  shuangkanSources?: {
    id?: string
    name: string
    baseUrl: string
    enabled?: boolean
  }[]
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
  /** 老郑优化：本机型号 / 系统 / 硬件信息；force = true 时忽略缓存重新采集 */
  systemInfo: (force?: boolean) => Promise<SystemInfoResult>
  /** 游戏修改：多源在线列表 / 详情 / 下载并解压 */
  searchTrainers: (
    sources: TrainerSourceInput[],
    keyword: string,
    page: number
  ) => Promise<TrainerSearchResponse>
  trainerDetail: (source: TrainerSourceInput, url: string) => Promise<TrainerDetailResponse>
  downloadTrainer: (input: TrainerDownloadInput) => Promise<TrainerDownloadResponse>
  testTrainerSource: (source: TrainerSourceInput) => Promise<TrainerTestResult>
  /** 游戏修改：扫描目录、启动、打开目录、删除 */
  scanTrainerLibrary: () => Promise<TrainerLibraryResponse>
  runTrainer: (folder: string, exe: string) => Promise<TrainerActionResult>
  openTrainerFolder: (folder?: string) => Promise<TrainerActionResult>
  deleteTrainer: (folder: string) => Promise<TrainerActionResult>
  searchSubjects: (category: SearchCategory, query: string) => Promise<SubjectSearchResponse>
  doubanHot: (
    kind: DoubanHotKind,
    tag: string,
    pageStart: number,
    pageLimit: number
  ) => Promise<DoubanHotResponse>
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
  /** 壁纸模块：壁纸源列表 / 分类 / 原图解析 */
  wallpaperList: (
    source: WallpaperSourceRef,
    category: string,
    page: number,
    keyword: string
  ) => Promise<WallpaperListResponse>
  wallpaperCategories: (
    source: WallpaperSourceRef,
    device: WallpaperDevice
  ) => Promise<WallpaperCategoriesResponse>
  wallpaperResolve: (
    source: WallpaperSourceRef,
    pageUrl: string,
    width: number,
    height: number
  ) => Promise<WallpaperResolveResponse>
  exportWallpaperSources: (sources: {
    id?: string
    name: string
    baseUrl: string
    template: WallpaperSourceTemplate
    enabled?: boolean
  }[]) => Promise<SourcesExportResult>
  /** 美图模块：列表 / 分类 / 图集详情 */
  meituList: (
    source: MeituSourceRef,
    category: string,
    page: number,
    keyword: string
  ) => Promise<MeituListResponse>
  meituCategories: (source: MeituSourceRef) => Promise<MeituCategoriesResponse>
  meituDetail: (source: MeituSourceRef, pageUrl: string) => Promise<MeituDetailResponse>
  exportMeituSources: (sources: {
    id?: string
    name: string
    baseUrl: string
    template: MeituSourceTemplate
    enabled?: boolean
  }[]) => Promise<SourcesExportResult>
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
  exportH1Sources: (sources: {
    id?: string
    name: string
    baseUrl: string
    enabled?: boolean
  }[]) => Promise<SourcesExportResult>
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
  /** 平台直播（B站 / 斗鱼 / 抖音） */
  livePlatformCategories: (platform: LivePlatformId) => Promise<LiveCategoriesResult>
  livePlatformList: (
    platform: LivePlatformId,
    kind: LiveListKind,
    params?: LiveListParams
  ) => Promise<LiveListResult>
  livePlatformRoom: (
    platform: LivePlatformId,
    input: string,
    qualityId?: string
  ) => Promise<LiveRoomPlayback>
  livePlatformLoginStatus: (platform: LivePlatformId) => Promise<LiveLoginStatus>
  livePlatformQrStart: () => Promise<LiveQrStart>
  livePlatformQrPoll: (key: string) => Promise<LiveQrPollResult>
  livePlatformOpenLogin: (platform: LivePlatformId) => Promise<LiveLoginWindowResult>
  livePlatformLogout: (platform: LivePlatformId) => Promise<LiveLoginStatus>
  livePlatformTestSource: (source: { name?: string; baseUrl: string }) => Promise<VodTestResponse>
  livePlatformExportSources: (sources: {
    id?: string
    name: string
    baseUrl: string
    enabled?: boolean
  }[]) => Promise<SourcesExportResult>
  searchMusic: (
    sources: MusicSourceInput[],
    keyword: string,
    page?: number
  ) => Promise<MusicSearchResponse>
  resolveMusic: (
    songId: string,
    platform?: string,
    baseUrl?: string,
    title?: string,
    artists?: string,
    quality?: MusicQuality
  ) => Promise<MusicResolveResponse>
  testMusicSource: (source: MusicSourceInput) => Promise<MusicTestResult>
  saveMusicLyrics: (input: {
    title: string
    artists?: string
    lrc: string
  }) => Promise<MusicLyricsSaveResult>
  listDownloads: () => Promise<DownloadListResponse>
  /** 刷新下载列表：清理本地已被手动删除的失效记录 */
  refreshDownloads: () => Promise<{ removed: number; total: number }>
  addDownload: (input: DownloadAddInput) => Promise<DownloadAddResult>
  removeDownload: (id: string, deleteFile: boolean) => Promise<DownloadRemoveResult>
  cancelDownload: (id: string) => Promise<void>
  /** 暂停下载：保留已下载内容 */
  pauseDownload: (id: string) => Promise<void>
  /** 继续已暂停的下载 */
  resumeDownload: (id: string) => Promise<void>
  openDownloadsDir: (kind?: DownloadKind) => Promise<void>
  downloadRoot: () => Promise<string>
  chooseDownloadRoot: () => Promise<DownloadRootResult>
  changeDownloadRoot: (root: string, move: boolean) => Promise<DownloadChangeRootResult>
  cacheInfo: () => Promise<CacheInfo>
  clearCache: () => Promise<CacheClearResult>
  /** 点标题 / 刷新按钮时让该模块的接口缓存短时间失效，直接取最新数据 */
  forceRefresh: (scope: string) => Promise<{ ok: boolean }>
  /** 选择缓存目录；切换后旧目录的图片 / 接口缓存会被清空 */
  chooseCacheDir: () => Promise<CacheDirResult>
  getUiSettings: () => Promise<UiSettings>
  setUiSettings: (input: Partial<UiSettings>) => Promise<UiSettings>
  /** 侧栏导航顺序（随本机设置一起备份 / 云同步） */
  getNavOrder: () => Promise<Record<string, string[]>>
  setNavOrder: (order: Record<string, string[]>) => Promise<void>
  exportTrainerSources: (sources: {
    id?: string
    name: string
    type: string
    baseUrl: string
    enabled?: boolean
  }[]) => Promise<SourcesExportResult>
  exportMusicSources: (sources: {
    id?: string
    name: string
    baseUrl: string
    enabled?: boolean
  }[]) => Promise<SourcesExportResult>
  novelHome: (source: NovelSourceInput) => Promise<NovelListResponse>
  novelSearch: (source: NovelSourceInput, keyword: string) => Promise<NovelListResponse>
  novelCategory: (
    source: NovelSourceInput,
    categoryId: string,
    page: number
  ) => Promise<NovelListResponse>
  novelCategoryCounts: (
    source: NovelSourceInput
  ) => Promise<BikahubCategoryCountsResponse>
  novelDetail: (source: NovelSourceInput, bookId: string) => Promise<NovelDetailResponse>
  novelChapter: (
    source: NovelSourceInput,
    bookId: string,
    chapterId: string
  ) => Promise<NovelChapterResponse>
  novelDownload: (input: NovelDownloadInput) => Promise<NovelDownloadResult>
  onNovelDownloadProgress: (
    callback: (progress: NovelDownloadProgress) => void
  ) => () => void
  testNovelSource: (source: NovelSourceInput) => Promise<NovelTestResult>
  testComicSource: (source: ComicSourceInput) => Promise<NovelTestResult>
  exportComicSources: (sources: {
    id?: string
    name: string
    baseUrl: string
    template: string
    enabled?: boolean
  }[]) => Promise<SourcesExportResult>
  exportNovelSources: (sources: {
    id?: string
    name: string
    baseUrl: string
    template: string
    enabled?: boolean
  }[]) => Promise<SourcesExportResult>
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
  shuangkanCatalog: (
    source: ShuangkanSourceRef,
    content: SkContent,
    category: string,
    page: number,
    sort?: SkSort
  ) => Promise<SkCatalogResponse>
  shuangkanSearch: (
    source: ShuangkanSourceRef,
    content: SkContent,
    keyword: string,
    page: number
  ) => Promise<SkCatalogResponse>
  shuangkanDetail: (
    source: ShuangkanSourceRef,
    content: SkContent,
    id: string
  ) => Promise<SkDetailResponse>
  shuangkanPlay: (source: ShuangkanSourceRef, id: string) => Promise<SkPlayResponse>
  trackShuangkanImages: (urls: string[], baseUrl?: string) => Promise<void>
  exportShuangkanSources: (sources: {
    id?: string
    name: string
    baseUrl: string
    enabled?: boolean
  }[]) => Promise<SourcesExportResult>
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
  yumanhuaRecent: (baseUrl?: string, sourceId?: string) => Promise<YumanhuaListResponse>
  yumanhuaHot: (baseUrl?: string, sourceId?: string) => Promise<YumanhuaListResponse>
  yumanhuaCategory: (
    categoryId: string,
    baseUrl?: string,
    sourceId?: string
  ) => Promise<YumanhuaListResponse>
  yumanhuaSearch: (
    keyword: string,
    baseUrl?: string,
    sourceId?: string
  ) => Promise<YumanhuaListResponse>
  yumanhuaDetail: (id: string, baseUrl?: string) => Promise<YumanhuaDetailResponse>
  yumanhuaChapters: (id: string, baseUrl?: string) => Promise<YumanhuaChaptersResponse>
  yumanhuaImages: (
    comicId: string,
    chapterId: string,
    baseUrl?: string
  ) => Promise<YumanhuaImagesResponse>
  bikahubComicRecent: (
    baseUrl?: string,
    sourceId?: string,
    page?: number
  ) => Promise<YumanhuaListResponse>
  bikahubComicHot: (
    baseUrl?: string,
    sourceId?: string,
    page?: number
  ) => Promise<YumanhuaListResponse>
  bikahubComicCategory: (
    categoryId: string,
    baseUrl?: string,
    sourceId?: string,
    page?: number
  ) => Promise<YumanhuaListResponse>
  bikahubComicCategoryCounts: (
    baseUrl?: string
  ) => Promise<BikahubCategoryCountsResponse>
  bikahubComicSearch: (
    keyword: string,
    baseUrl?: string,
    sourceId?: string
  ) => Promise<YumanhuaListResponse>
  bikahubComicDetail: (id: string, baseUrl?: string) => Promise<YumanhuaDetailResponse>
  bikahubComicChapters: (id: string, baseUrl?: string) => Promise<YumanhuaChaptersResponse>
  bikahubComicImages: (
    comicId: string,
    chapterId: string,
    baseUrl?: string
  ) => Promise<YumanhuaImagesResponse>
  tptoonComicRecent: (
    baseUrl?: string,
    sourceId?: string,
    page?: number
  ) => Promise<YumanhuaListResponse>
  tptoonComicHot: (
    baseUrl?: string,
    sourceId?: string,
    page?: number
  ) => Promise<YumanhuaListResponse>
  tptoonComicCategory: (
    categoryId: string,
    baseUrl?: string,
    sourceId?: string,
    page?: number
  ) => Promise<YumanhuaListResponse>
  tptoonComicCategoryCounts: (baseUrl?: string) => Promise<TptoonCategoryCountsResponse>
  tptoonComicSearch: (
    keyword: string,
    baseUrl?: string,
    sourceId?: string
  ) => Promise<YumanhuaListResponse>
  tptoonComicDetail: (id: string, baseUrl?: string) => Promise<YumanhuaDetailResponse>
  tptoonComicChapters: (id: string, baseUrl?: string) => Promise<YumanhuaChaptersResponse>
  tptoonComicImages: (
    comicId: string,
    chapterId: string,
    baseUrl?: string
  ) => Promise<YumanhuaImagesResponse>
  jmcomicRecent: (
    baseUrl?: string,
    sourceId?: string,
    page?: number
  ) => Promise<YumanhuaListResponse>
  jmcomicHot: (
    baseUrl?: string,
    sourceId?: string,
    page?: number
  ) => Promise<YumanhuaListResponse>
  jmcomicCategory: (
    categoryId: string,
    baseUrl?: string,
    sourceId?: string,
    page?: number
  ) => Promise<YumanhuaListResponse>
  jmcomicCategoryCounts: (baseUrl?: string) => Promise<JmcomicCategoryCountsResponse>
  jmcomicSearch: (
    keyword: string,
    baseUrl?: string,
    sourceId?: string,
    page?: number
  ) => Promise<YumanhuaListResponse>
  jmcomicDetail: (id: string, baseUrl?: string) => Promise<YumanhuaDetailResponse>
  jmcomicChapters: (id: string, baseUrl?: string) => Promise<YumanhuaChaptersResponse>
  jmcomicImages: (
    comicId: string,
    chapterId: string,
    baseUrl?: string
  ) => Promise<YumanhuaImagesResponse>
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
  openDownloadFolder: (id: string) => Promise<void>
  /** 把下载的壁纸设为 Windows 桌面壁纸 */
  setWallpaper: (id: string) => Promise<void>
  runDownloadTrainer: (id: string) => Promise<void>
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
  liveFavorites: [],
  liveHistory: [],
  dramaSources: DEFAULT_DRAMA_SOURCES,
  trainerSources: DEFAULT_TRAINER_SOURCES,
  musicSources: [...DEFAULT_MUSIC_SOURCES, ...LX_MUSIC_SOURCES],
  novelSources: DEFAULT_NOVEL_SOURCES,
  comicSources: DEFAULT_COMIC_SOURCES,
  h1Sources: DEFAULT_H1_SOURCES,
  livePlatformSources: DEFAULT_LIVE_PLATFORM_SOURCES,
  wallpaperSources: DEFAULT_WALLPAPER_SOURCES,
  meituSources: DEFAULT_MEITU_SOURCES,
  shuangkanSources: DEFAULT_SHUANGKAN_SOURCES
}

/**
 * 清单字段兜底：导出给手机端时会去掉 null 字段（兼容 org.json），
 * 根清单的 parentId 因此丢失；重新导入后 strict 比较 parentId === null 的地方会看不到它们。
 * 这里统一补回 null，并把明显不是对象的坏条目丢掉。
 */
function normalizeLists(raw: unknown): ItemList[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((entry): entry is ItemList => !!entry && typeof entry === 'object')
    .map((list) => (typeof list.parentId === 'number' ? list : { ...list, parentId: null }))
}

/**
 * 数组字段兜底：备份 / data.json 可能被手工改坏，
 * 数组里混入 null 时界面读取 id / name 会直接崩溃，这里统一丢掉非对象条目。
 */
function objectRows<T>(raw: unknown): T[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is T => !!entry && typeof entry === 'object')
}

export function normalizeData(raw: unknown): AppData {
  const o = (raw ?? {}) as Partial<AppData>
  const out: AppData = {
    version: typeof o.version === 'number' ? o.version : 1,
    exportAt: o.exportAt,
    items: objectRows<CollectionItem>(o.items),
    lists: normalizeLists(o.lists),
    listItems: objectRows<ListItem>(o.listItems),
    vodSources: objectRows<VodSource>(o.vodSources),
    innerFavs: objectRows<InnerFav>(o.innerFavs),
    readProgress: o.readProgress && typeof o.readProgress === 'object' ? o.readProgress : {},
    config: o.config && typeof o.config === 'object' ? o.config : {},
    liveFavorites: normalizeLiveFavorites(o.liveFavorites),
    liveHistory: normalizeLiveHistory(o.liveHistory),
    // 短剧源始终补全四个内置条目，旧备份 / 手机端备份导入后也能直接用
    dramaSources: normalizeDramaSources(o.dramaSources),
    // 修改器源始终补全两个内置源
    trainerSources: normalizeTrainerSources(o.trainerSources),
    // 音乐源缺失时补默认源；已有配置以用户为准
    musicSources: normalizeMusicSources(o.musicSources),
    // 小说书源缺失时补内置书源；已有配置以用户为准
    novelSources: normalizeNovelSources(o.novelSources),
    // 漫画源缺失时补漫画客 + Komiic；已有配置以用户为准
    comicSources: normalizeComicSources(o.comicSources),
    // 番号源缺失时补四个默认源；已有配置以用户为准
    h1Sources: normalizeH1Sources(o.h1Sources),
    // 平台直播源缺失时补 B站 / 斗鱼 / 抖音；已有配置以用户为准
    livePlatformSources: normalizeLivePlatformSources(o.livePlatformSources),
    // 壁纸源缺失时补 Wallspic / 壁纸迷；删空不补回
    wallpaperSources: normalizeWallpaperSources(o.wallpaperSources),
    // 美图源缺失时补魅影画廊 / 雪月映画；删空不补回
    meituSources: normalizeMeituSources(o.meituSources),
    // 爽看源缺失时补内置肉视频；删空不补回
    shuangkanSources: normalizeShuangkanSources(o.shuangkanSources)
  }
  // 2026-11-04 v0.85：按用户要求暂时下线「无损音乐」默认源，
  // 老数据里由 v0.83 自动补进来的内置 hi 源在这里移除（手动添加的同地址源 id 不同，不受影响）
  if (Array.isArray(o.musicSources)) {
    out.musicSources = out.musicSources.filter(
      (source) => !(source.id === 'hi' && source.baseUrl.toLowerCase().includes('music.hi.cn'))
    )
  }
  // 2026-11-06 v0.96：洛雪音源只保留 fish；玉宁熙 / 独家音源先下线
  if (Array.isArray(o.musicSources)) {
    out.musicSources = out.musicSources.filter(
      (source) =>
        source.id !== 'lx_yuningxi' &&
        source.id !== 'lx_lx' &&
        !/\/yuningxi\/latest\.js|\/lx\/latest\.js/i.test(source.baseUrl)
    )
    if (o.musicSources.length > 0 && out.config.lxFishSeeded !== '1') {
      const ids = new Set(out.musicSources.map((source) => source.id))
      const urls = new Set(out.musicSources.map((source) => source.baseUrl))
      for (const extra of ADDED_LX_MUSIC_SOURCES) {
        if (ids.has(extra.id) || urls.has(extra.baseUrl)) continue
        out.musicSources.push({ ...extra })
      }
      out.config = { ...out.config, lxFishSeeded: '1' }
    }
  }
  // 2026-11-04 v0.85：九五小说 / 玄幻阁首次随老数据补进小说源；删除后不再自动加回
  if (Array.isArray(o.novelSources) && out.config.novelExtraSeeded !== '1') {
    if (o.novelSources.length > 0) {
      const ids = new Set(out.novelSources.map((source) => source.id))
      const urls = new Set(out.novelSources.map((source) => source.baseUrl))
      for (const extra of ADDED_NOVEL_SOURCES) {
        if (ids.has(extra.id) || urls.has(extra.baseUrl)) continue
        out.novelSources.push({ ...extra })
      }
    }
    out.config = { ...out.config, novelExtraSeeded: '1' }
  }
  // 2026-11-05 v0.86：奇书小说 / 新御宅屋 / 黄易小说 / 无极小说首次随老数据补进小说源；删除后不再自动加回
  if (Array.isArray(o.novelSources) && out.config.novelFreeSeeded !== '1') {
    if (o.novelSources.length > 0) {
      const ids = new Set(out.novelSources.map((source) => source.id))
      const urls = new Set(out.novelSources.map((source) => source.baseUrl))
      for (const extra of ADDED_NOVEL_SOURCES) {
        if (ids.has(extra.id) || urls.has(extra.baseUrl)) continue
        out.novelSources.push({ ...extra })
      }
    }
    out.config = { ...out.config, novelFreeSeeded: '1' }
  }
  // 2026-11-05 v0.94：笔趣阁 / 最终小说网 / 搬山人小说网首次随老数据补进小说源；删除后不再自动加回
  if (Array.isArray(o.novelSources) && out.config.novelThirdSeeded !== '1') {
    if (o.novelSources.length > 0) {
      const ids = new Set(out.novelSources.map((source) => source.id))
      const urls = new Set(out.novelSources.map((source) => source.baseUrl))
      for (const extra of DEFAULT_NOVEL_SOURCES.filter((source) =>
        ['bqquge', 'zuizhong', 'banshanren'].includes(source.id)
      )) {
        if (ids.has(extra.id) || urls.has(extra.baseUrl)) continue
        out.novelSources.push({ ...extra })
      }
    }
    out.config = { ...out.config, novelThirdSeeded: '1' }
  }
  // 2026-11-10：哔咔小说首次随老数据补进小说源；删除后不再自动加回
  if (Array.isArray(o.novelSources) && out.config.bikahubNovelSeeded !== '1') {
    if (o.novelSources.length > 0) {
      const ids = new Set(o.novelSources.map((source) => source.id))
      const urls = new Set(o.novelSources.map((source) => source.baseUrl))
      if (!ids.has(BIKAHUB_NOVEL_SOURCE.id) && !urls.has(BIKAHUB_NOVEL_SOURCE.baseUrl)) {
        out.novelSources.push({ ...BIKAHUB_NOVEL_SOURCE })
      }
    }
    out.config = { ...out.config, bikahubNovelSeeded: '1' }
  }
  // 2026-11-10：哔咔漫画首次随老数据补进漫画源；删除后不再自动加回
  if (Array.isArray(o.comicSources) && out.config.bikahubComicSeeded !== '1') {
    if (o.comicSources.length > 0) {
      const ids = new Set(o.comicSources.map((source) => source.id))
      const urls = new Set(o.comicSources.map((source) => source.baseUrl))
      for (const extra of ADDED_COMIC_SOURCES) {
        if (ids.has(extra.id) || urls.has(extra.baseUrl)) continue
        out.comicSources.push({ ...extra })
      }
    }
    out.config = { ...out.config, bikahubComicSeeded: '1' }
  }
  // 2026-11-10 v0.113：头牌漫画首次随老数据补进漫画源；删除后不再自动加回
  if (Array.isArray(o.comicSources) && out.config.tptoonComicSeeded !== '1') {
    if (o.comicSources.length > 0) {
      const ids = new Set(o.comicSources.map((source) => source.id))
      const urls = new Set(o.comicSources.map((source) => source.baseUrl))
      if (!ids.has(TPTOON_COMIC_SOURCE.id) && !urls.has(TPTOON_COMIC_SOURCE.baseUrl)) {
        out.comicSources.push({ ...TPTOON_COMIC_SOURCE })
      }
    }
    out.config = { ...out.config, tptoonComicSeeded: '1' }
  }
  // 2026-11-10 v0.115：禁漫天堂首次随老数据补进漫画源；删除后不再自动加回
  if (Array.isArray(o.comicSources) && out.config.jmcomicComicSeeded !== '1') {
    if (o.comicSources.length > 0) {
      const ids = new Set(o.comicSources.map((source) => source.id))
      const urls = new Set(o.comicSources.map((source) => source.baseUrl))
      if (!ids.has(JMCOMIC_COMIC_SOURCE.id) && !urls.has(JMCOMIC_COMIC_SOURCE.baseUrl)) {
        out.comicSources.push({ ...JMCOMIC_COMIC_SOURCE })
      }
    }
    out.config = { ...out.config, jmcomicComicSeeded: '1' }
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
  if (Array.isArray(o.installedTrainers)) {
    out.installedTrainers = o.installedTrainers
      .filter((entry): entry is InstalledTrainer => {
        if (!entry || typeof entry !== 'object') return false
        const t = entry as Partial<InstalledTrainer>
        return typeof t.folder === 'string' && !!t.folder && typeof t.title === 'string'
      })
      .map((entry) => ({
        ...entry,
        source:
          entry.source === 'fling' ||
          entry.source === '3dm' ||
          entry.source === 'gamersky' ||
          entry.source === 'ali213'
            ? entry.source
            : 'local',
        sourceId: typeof entry.sourceId === 'string' ? entry.sourceId : '',
        pageUrl: typeof entry.pageUrl === 'string' ? entry.pageUrl : '',
        cover: typeof entry.cover === 'string' ? entry.cover : null,
        version: typeof entry.version === 'string' ? entry.version : '',
        exe: typeof entry.exe === 'string' ? entry.exe : '',
        files:
          typeof entry.files === 'number' && Number.isFinite(entry.files) ? entry.files : 0,
        sizeBytes:
          typeof entry.sizeBytes === 'number' && Number.isFinite(entry.sizeBytes)
            ? entry.sizeBytes
            : 0,
        installedAt:
          typeof entry.installedAt === 'number' && Number.isFinite(entry.installedAt)
            ? entry.installedAt
            : Date.now()
      }))
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
