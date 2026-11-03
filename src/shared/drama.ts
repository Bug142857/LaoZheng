/**
 * 短剧模块共用类型。
 * 内置源只保留西饭短剧；其余短剧源使用苹果CMS V10 接口，可在片源管理里添加 / 导入。
 * 短剧源配置随 data.json 备份与云同步一起走；手机端会忽略该字段。
 */

export type DramaTestStatus = 'ok' | 'failed'

export interface DramaSource {
  id: string
  name: string
  enabled: boolean
  /** 内置源（西饭）：协议固定，不能改地址 / 删除 */
  builtin?: boolean
  /** 非内置源：苹果CMS 接口地址 */
  baseUrl?: string
  testStatus?: DramaTestStatus | null
  testMsg?: string | null
  testAt?: number
}

export const XIFAN_DRAMA_SOURCE_ID = 'xifan'
export const XIFAN_DRAMA_BASE_URL = 'https://xifan-api-cn.youlishipin.com'

export const DEFAULT_DRAMA_SOURCES: DramaSource[] = [
  {
    id: XIFAN_DRAMA_SOURCE_ID,
    name: '西饭短剧',
    enabled: true,
    builtin: true,
    baseUrl: XIFAN_DRAMA_BASE_URL
  }
]

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function testFields(source: Partial<DramaSource>): Pick<DramaSource, 'testStatus' | 'testMsg' | 'testAt'> {
  return {
    testStatus:
      source.testStatus === 'ok' || source.testStatus === 'failed' ? source.testStatus : null,
    testMsg: typeof source.testMsg === 'string' ? source.testMsg : null,
    testAt: typeof source.testAt === 'number' ? source.testAt : 0
  }
}

/**
 * 备份 / 旧版本数据里可能还留着红果、河马、自定义源：
 * 只保留西饭和用户自己添加的苹果CMS 短剧源。
 * 没有 dramaSources 字段（旧数据 / 手机端备份）时补默认西饭；显式空列表表示用户删光了。
 */
export function normalizeDramaSources(raw: unknown): DramaSource[] {
  if (!Array.isArray(raw)) return DEFAULT_DRAMA_SOURCES.map((source) => ({ ...source }))
  const out: DramaSource[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const source = item as Partial<DramaSource>
    if (typeof source.id !== 'string' || !source.id) continue
    if (source.id === XIFAN_DRAMA_SOURCE_ID) {
      if (out.some((entry) => entry.id === XIFAN_DRAMA_SOURCE_ID)) continue
      const rawBaseUrl = typeof source.baseUrl === 'string' ? source.baseUrl.trim() : ''
      out.push({
        id: XIFAN_DRAMA_SOURCE_ID,
        name:
          typeof source.name === 'string' && source.name.trim()
            ? source.name.trim()
            : '西饭短剧',
        enabled: source.enabled !== false,
        builtin: true,
        baseUrl: /^https?:\/\//i.test(rawBaseUrl) ? rawBaseUrl : XIFAN_DRAMA_BASE_URL,
        ...testFields(source)
      })
      continue
    }
    // 旧红果 / 河马 / 自定义源没有苹果CMS 地址，直接丢弃
    const baseUrl = typeof source.baseUrl === 'string' ? source.baseUrl.trim() : ''
    if (!/^https?:\/\//i.test(baseUrl)) continue
    if (out.some((entry) => entry.id === source.id || entry.baseUrl === baseUrl)) continue
    out.push({
      id: source.id,
      name:
        typeof source.name === 'string' && source.name.trim()
          ? source.name.trim()
          : hostOf(baseUrl),
      enabled: source.enabled !== false,
      baseUrl,
      ...testFields(source)
    })
  }
  return out
}

/** 主进程只信任这些字段；非西饭源额外带苹果CMS 的 baseUrl */
export interface DramaSourceInput {
  id: string
  name: string
  baseUrl?: string
}

export interface DramaCategory {
  slug: string
  label: string
}

export interface DramaItem {
  seriesId: string
  title: string
  cover: string
  episodeCount: number
  tags: string[]
  remarks: string
  sourceId: string
  sourceName: string
}

export interface DramaCatalogResponse {
  ok: boolean
  items: DramaItem[]
  page: number
  pageCount: number
  hasMore: boolean
  categories: DramaCategory[]
  /** 苹果CMS 源能拿到总数；西饭只有 hasMore */
  total?: number
  error?: string
}

export interface DramaEpisode {
  /** 各来源自己的分集标识（西饭 episodeId / 苹果CMS g:e） */
  id: string
  index: number
  name: string
  locked: boolean
  lockedReason?: string
}

export interface DramaDetail {
  seriesId: string
  title: string
  cover: string
  intro: string
  tags: string[]
  episodes: DramaEpisode[]
  sourceId: string
  sourceName: string
  /** 红果网页只有前 N 集公开（旧数据兼容） */
  publicEpisodes?: number
}

export interface DramaDetailResponse {
  ok: boolean
  detail?: DramaDetail
  error?: string
}

export interface DramaPlayResponse {
  ok: boolean
  url?: string
  error?: string
}
