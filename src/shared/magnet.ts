/** 磁力搜索（第三方 BT 索引站）共用类型 */

export type MagnetEncodeType = 'UrlEncode' | 'Base64UrlSafe' | 'Hex' | 'Raw'

export type MagnetTestStatus = 'ok' | 'failed'

export interface MagnetApiMapping {
  listPath: string
  titleField: string
  sizeField: string
  hashField: string
  dateField: string
  totalField: string
  codeField: string
  successValue: string
  pageSize: number
  idField: string
  detailUrlTemplate: string
}

/** 一个资源库的搜索规则（字段口径与 BTSOU_Plus 的 ResPool.txt 一致） */
export interface MagnetSource {
  id: string
  name: string
  enabled: boolean
  /** 站点需要外网 / 代理，仅作提示，实际走系统代理 */
  needProxy: boolean
  /** 搜索地址模板，支持 {keyword} / {page} */
  searchUrl: string
  /** 列表结果的分割符，例如 <h2>、<tr class="default"> */
  separator: string
  /** 下一页关键词；空或「只有一页」表示单页 */
  nextPageIndicator: string
  /** 是否必须用隐藏浏览器渲染（JS 站点） */
  useWebView2: boolean
  /** 隐藏浏览器直接打开搜索页，而不是先打开导航页 */
  directNavigate: boolean
  encodeType: MagnetEncodeType
  /** 是否 JSON API 站点 */
  isApi: boolean
  navigationPage: string
  fixedRules: boolean
  api: MagnetApiMapping | null
  testStatus: MagnetTestStatus | null
  testMsg: string | null
  testAt: number
}

export interface MagnetOptions {
  /** 屏蔽广告：清理标题里的域名、广告词与空括号 */
  blockAds: boolean
  /** 智能搜索：过滤成人 / 敏感词条，减少「社死」结果 */
  smartSearch: boolean
  /** 磁链去重 */
  dedupe: boolean
}

export interface MagnetState {
  sources: MagnetSource[]
  options: MagnetOptions
  /** 资源库配置版本，用于一次性迁移失效源 */
  configVersion?: number
}

export interface MagnetItem {
  id: string
  title: string
  magnet: string
  hash: string
  size: string
  /** 用于排序，未知为 0 */
  sizeBytes: number
  time: string
  /** 用于排序，未知为 0 */
  timeMs: number
  sourceId: string
  sourceName: string
  detailUrl: string
}

export interface MagnetSearchResponse {
  ok: boolean
  items: MagnetItem[]
  hasNext: boolean
  page: number
  /** null 表示「全部资源库」 */
  sourceId: string | null
  /** 部分资源库失败时的提示，不影响其他结果 */
  errors: string[]
  error?: string
}

export interface MagnetTestResult {
  ok: boolean
  count: number
  message: string
  testAt: number
}

export interface MagnetSourcesImportResult {
  canceled: boolean
  sources?: MagnetSource[]
  error?: string
}

export type MagnetSortField = 'size' | 'time' | 'name'
export type MagnetSortOrder = 'asc' | 'desc'

/** 磁力搜索结果的本地缓存：切模块 / 重开应用后回来仍能看到上次结果 */
export interface MagnetSearchCache {
  keyword: string
  /** 空字符串 = 全部源 */
  sourceId: string
  items: MagnetItem[]
  page: number
  hasNext: boolean
  searched: boolean
  errors: string[]
  sortField: MagnetSortField
  sortOrder: MagnetSortOrder
  updatedAt: number
}

export const DEFAULT_MAGNET_OPTIONS: MagnetOptions = {
  blockAds: true,
  smartSearch: true,
  dedupe: true
}

export const DEFAULT_MAGNET_SORT: { field: MagnetSortField; order: MagnetSortOrder } = {
  field: 'size',
  order: 'desc'
}

function normalizeCachedItem(raw: unknown): MagnetItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<MagnetItem>
  const magnet = typeof o.magnet === 'string' ? o.magnet.trim() : ''
  const detailUrl = typeof o.detailUrl === 'string' ? o.detailUrl.trim() : ''
  if (!magnet && !detailUrl) return null
  const title =
    typeof o.title === 'string' && o.title.trim() ? o.title.trim() : magnet || detailUrl
  return {
    id: typeof o.id === 'string' && o.id ? o.id : magnet || detailUrl,
    title,
    magnet,
    hash: typeof o.hash === 'string' ? o.hash : '',
    size: typeof o.size === 'string' ? o.size : '',
    sizeBytes:
      typeof o.sizeBytes === 'number' && Number.isFinite(o.sizeBytes) ? o.sizeBytes : 0,
    time: typeof o.time === 'string' ? o.time : '',
    timeMs: typeof o.timeMs === 'number' && Number.isFinite(o.timeMs) ? o.timeMs : 0,
    sourceId: typeof o.sourceId === 'string' ? o.sourceId : '',
    sourceName: typeof o.sourceName === 'string' ? o.sourceName : '',
    detailUrl
  }
}

/**
 * 备份 / 云端恢复里的磁力搜索缓存可能来自旧版本或被手工改坏：
 * 这里逐字段校验，items 不是数组或整体不可用时直接丢掉，避免 MagnetPage 渲染时崩溃。
 */
export function normalizeMagnetSearchCache(raw: unknown): MagnetSearchCache | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Partial<MagnetSearchCache>
  if (!Array.isArray(o.items)) return undefined
  const items = o.items
    .map((item) => normalizeCachedItem(item))
    .filter((item): item is MagnetItem => !!item)
  return {
    keyword: typeof o.keyword === 'string' ? o.keyword : '',
    sourceId: typeof o.sourceId === 'string' ? o.sourceId : '',
    items,
    page: Number.isInteger(o.page) && (o.page as number) > 0 ? (o.page as number) : 1,
    hasNext: o.hasNext === true,
    searched: o.searched === true,
    errors: Array.isArray(o.errors)
      ? o.errors.filter((error): error is string => typeof error === 'string')
      : [],
    sortField:
      o.sortField === 'time' || o.sortField === 'name' || o.sortField === 'size'
        ? o.sortField
        : DEFAULT_MAGNET_SORT.field,
    sortOrder: o.sortOrder === 'asc' || o.sortOrder === 'desc' ? o.sortOrder : DEFAULT_MAGNET_SORT.order,
    updatedAt:
      typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : Date.now()
  }
}
