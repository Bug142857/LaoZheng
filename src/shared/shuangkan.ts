/** 爽看（肉视频）模块：视频库 /v 与短剧库 /series 共用一套解析 */
export type SkContent = 'video' | 'series'

/** 爽看源的站点类型：不同站点的列表 / 详情 / 播放解析方式不同 */
export type SkAdapter = 'rou07' | 'pornhub' | 'xvid' | 'xhamster' | 'ppp'

/** 镜像源的信息流排序：推荐 / 最新 / 热门 */
export type SkSort = 'recommended' | 'latest' | 'hot'

export interface SkSortOption {
  key: SkSort
  label: string
}

/** 各镜像源支持的信息流；rou07 与亚洲素人精选沿用分类下拉，不显示排序 chip */
export const SK_SORT_OPTIONS: Record<SkAdapter, SkSortOption[]> = {
  rou07: [],
  pornhub: [
    { key: 'recommended', label: '推荐' },
    { key: 'latest', label: '最新' },
    { key: 'hot', label: '热门' }
  ],
  xvid: [
    { key: 'latest', label: '最新' },
    { key: 'hot', label: '热门' }
  ],
  xhamster: [
    { key: 'latest', label: '最新' },
    { key: 'hot', label: '热门' }
  ],
  ppp: []
}

export function isSkSort(value: unknown): value is SkSort {
  return value === 'recommended' || value === 'latest' || value === 'hot'
}

/** 每个镜像源的首选信息流 */
export function defaultSkSort(adapter: SkAdapter): SkSort {
  return SK_SORT_OPTIONS[adapter][0]?.key ?? 'latest'
}

/** 爽看源：站点地址可在片源管理里添加 / 修改，失效时仍会自动换址 */
export interface ShuangkanSource {
  id: string
  name: string
  baseUrl: string
  enabled: boolean
  /** 内置源：不能删除，地址可改 */
  builtin?: boolean
  /** 缺失时按站点域名推断 */
  adapter?: SkAdapter
  testStatus: 'ok' | 'bad' | null
  testMsg: string | null
  testAt: number
}

/** 渲染层传给主进程的最小爽看源信息 */
export interface ShuangkanSourceRef {
  id: string
  name: string
  baseUrl: string
  adapter?: SkAdapter
}

export interface SkCategory {
  /** 站点标签名（已解码） */
  slug: string
  label: string
  /** 二级分类 / 短剧标签带数量，一级分类没有 */
  count?: number
}

export interface SkItem {
  id: string
  title: string
  cover: string
  /** 视频时长或短剧集数，显示在封面右下角 */
  duration: string
  /** 卡片底部信息：标签 / 状态 / 播放量 / 更新时间 */
  meta: string[]
}

export interface SkCatalogResponse {
  ok: boolean
  items: SkItem[]
  page: number
  lastPage: number
  categories: SkCategory[]
  error?: string
}

export interface SkEpisode {
  id: string
  index: number
  name: string
  duration: string
}

export interface SkDetail {
  id: string
  source: SkContent
  title: string
  cover: string
  intro: string
  tags: string[]
  meta: string[]
  duration: string
  /** 短剧的剧集列表；单个视频为空数组 */
  episodes: SkEpisode[]
  /** 单个视频直接给出播放地址；短剧为 null，按集解析 */
  playUrl: string | null
}

export interface SkDetailResponse {
  ok: boolean
  detail?: SkDetail
  error?: string
}

export interface SkPlayResponse {
  ok: boolean
  url?: string
  error?: string
}

/** 收藏直接打开爽看详情时带的信息 */
export interface ShuangkanFocus {
  sourceId: string
  sourceName?: string
  baseUrl?: string
  content: SkContent
  id: string
  title: string
  at: number
}

export const SK_DEFAULT_BASE = 'https://rou07.net'
/** 站点失效时到导航站按「优选访问」换址 */
export const SK_GOHOME = 'https://x99dh.net/'

export const SK_BUILTIN_SOURCE_ID = 'rou07'
export const SK_PORNHUB_BASE = 'https://cn.pornhub06.com'
export const SK_XVID_BASE = 'https://www.xvideos1.icu'
export const SK_XHAMSTER_BASE = 'https://zh.xhamster02.com'
export const SK_PPP_BASE = 'https://591av.ws'

export const SK_ADAPTERS: SkAdapter[] = ['rou07', 'pornhub', 'xvid', 'xhamster', 'ppp']

export function isSkAdapter(value: unknown): value is SkAdapter {
  return typeof value === 'string' && (SK_ADAPTERS as string[]).includes(value)
}

/** 按站点域名推断适配器；自定义镜像域名默认按肉视频解析 */
export function inferSkAdapter(baseUrl: string): SkAdapter {
  let host = ''
  try {
    host = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return 'rou07'
  }
  if (/pornhub/.test(host)) return 'pornhub'
  if (/xvideos/.test(host)) return 'xvid'
  if (/xhamster/.test(host)) return 'xhamster'
  if (/(^|\.)(591av|91-av)\./.test(host)) return 'ppp'
  return 'rou07'
}

export const DEFAULT_SHUANGKAN_SOURCES: ShuangkanSource[] = [
  {
    id: SK_BUILTIN_SOURCE_ID,
    name: '肉视频',
    baseUrl: SK_DEFAULT_BASE,
    enabled: true,
    builtin: true,
    adapter: 'rou07',
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'pornhub',
    name: 'P站',
    baseUrl: SK_PORNHUB_BASE,
    enabled: true,
    builtin: true,
    adapter: 'pornhub',
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'xvid',
    name: 'X站',
    baseUrl: SK_XVID_BASE,
    enabled: true,
    builtin: true,
    adapter: 'xvid',
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'xhamster',
    name: 'xhamster',
    baseUrl: SK_XHAMSTER_BASE,
    enabled: true,
    builtin: true,
    adapter: 'xhamster',
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'ppp',
    name: '亚洲素人精选',
    baseUrl: SK_PPP_BASE,
    enabled: true,
    builtin: true,
    adapter: 'ppp',
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  }
]

export function toShuangkanSourceRef(source: ShuangkanSource): ShuangkanSourceRef {
  return {
    id: source.id,
    name: source.name,
    baseUrl: source.baseUrl,
    adapter: source.adapter ?? inferSkAdapter(source.baseUrl)
  }
}

/**
 * 缺失时补内置源；用户改过的地址与开关保留。
 * 内置源不能删除（可停用），所以这里会把缺失的内置源补回来。
 */
export function normalizeShuangkanSources(raw: unknown): ShuangkanSource[] {
  if (!Array.isArray(raw)) return DEFAULT_SHUANGKAN_SOURCES.map((source) => ({ ...source }))
  const rows: ShuangkanSource[] = []
  const ids = new Set<string>()
  const urls = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Partial<ShuangkanSource>
    const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : ''
    if (!/^https?:\/\//i.test(baseUrl) || urls.has(baseUrl)) continue
    const preset = DEFAULT_SHUANGKAN_SOURCES.find((source) => source.id === record.id)
    let id =
      typeof record.id === 'string' && record.id.trim()
        ? record.id.trim().slice(0, 80)
        : `sk_${rows.length + 1}`
    let n = 2
    while (ids.has(id)) id = `sk_${n++}`
    ids.add(id)
    urls.add(baseUrl)
    let host = baseUrl
    try {
      host = new URL(baseUrl).hostname
    } catch {
      // 非法地址已在上面过滤，这里只做兜底
    }
    // 内置源从未手动测试过时继承预设的「可用」，避免升级后仍显示未测/无效
    const inheritedStatus =
      record.testStatus === 'bad' || record.testStatus === 'ok'
        ? record.testStatus
        : preset?.testStatus ?? null
    // v0.122：状态与预设一致但没有测试文案时也借用预设文案，
    // 否则片源管理的状态点是绿的、文字却还是「未测试」
    const inheritedMsg =
      typeof record.testMsg === 'string' && record.testMsg
        ? record.testMsg
        : preset && inheritedStatus === preset.testStatus
          ? preset.testMsg
          : null
    rows.push({
      id,
      name:
        (typeof record.name === 'string' && record.name.trim()) ||
        preset?.name ||
        host,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      enabled: record.enabled !== false,
      builtin: record.builtin === true || !!preset,
      adapter: isSkAdapter(record.adapter) ? record.adapter : inferSkAdapter(baseUrl),
      testStatus: inheritedStatus,
      testMsg: inheritedMsg,
      testAt: typeof record.testAt === 'number' ? record.testAt : 0
    })
  }
  for (const preset of DEFAULT_SHUANGKAN_SOURCES) {
    if (ids.has(preset.id) || urls.has(preset.baseUrl)) continue
    rows.push({ ...preset })
    ids.add(preset.id)
    urls.add(preset.baseUrl)
  }
  return rows
}
