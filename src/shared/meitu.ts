/** 美图模块：美图源配置、分类与数据口径 */

/** 美图源的解析模板：两个站点结构固定 */
export type MeituSourceTemplate = 'jb9' | 'taoo'

export interface MeituCategory {
  id: string
  label: string
  count?: number
}

/** 美图源：存放在 data.meituSources，随备份与云同步走 */
export interface MeituSource {
  id: string
  name: string
  baseUrl: string
  template: MeituSourceTemplate
  enabled: boolean
  testStatus: 'ok' | 'bad' | null
  testMsg: string | null
  testAt: number
}

/** 渲染层传给主进程的最小美图源信息 */
export interface MeituSourceRef {
  id: string
  template: MeituSourceTemplate
  baseUrl: string
}

export interface MeituSourceInput {
  id?: string
  name: string
  baseUrl: string
  template: MeituSourceTemplate
  enabled?: boolean
}

export const MEITU_SOURCE_TEMPLATES: {
  id: MeituSourceTemplate
  label: string
  /** 添加源时的默认名称 */
  name: string
  homepage: string
}[] = [
  {
    id: 'jb9',
    label: '魅影画廊模板',
    name: '魅影画廊',
    homepage: 'https://www.jb9.es'
  },
  {
    id: 'taoo',
    label: '雪月映画模板',
    name: '雪月映画',
    homepage: 'https://taoo.xyz'
  }
]

/** 默认美图源：源本身可在片源管理里添加 / 修改 / 删除 */
export const DEFAULT_MEITU_SOURCES: MeituSource[] = [
  {
    id: 'jb9',
    name: '魅影画廊',
    baseUrl: 'https://www.jb9.es',
    template: 'jb9',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'taoo',
    name: '雪月映画',
    baseUrl: 'https://taoo.xyz',
    template: 'taoo',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  }
]

/** 魅影画廊兜底分类（真实分类从站点 /all 筛选条抓取） */
const JB9_CATEGORIES: MeituCategory[] = [
  { id: 'c14', label: '大尺度' },
  { id: 'c3', label: '人体套图' },
  { id: 'c5', label: '秀人网' },
  { id: 'c39', label: '工作室出品' },
  { id: '@stars', label: '热门明星' }
]

/** 雪月映画兜底分类 */
const TAOO_CATEGORIES: MeituCategory[] = [
  { id: 'r18', label: 'R18' },
  { id: 'r15', label: 'R15' }
]

/** 「全部」分类统一用空 id */
export function meituFallbackCategories(
  source: Pick<MeituSource, 'template'>
): MeituCategory[] {
  const base: MeituCategory = { id: '', label: '全部' }
  return source.template === 'jb9'
    ? [base, ...JB9_CATEGORIES]
    : [base, ...TAOO_CATEGORIES]
}

export interface MeituAlbum {
  source: string
  /** 源内稳定 id（由详情页地址生成或站点 data-id） */
  id: string
  title: string
  cover: string
  pageUrl: string
  imageCount: number
  tags: string[]
  timeText: string
}

/** 热门明星（魅影画廊作者榜） */
export interface MeituStar {
  source: string
  /** 作者页地址里的 slug，用于 /author/<slug>/ */
  slug: string
  name: string
  avatar: string
  authorUrl: string
  articles: number
  reads: number
  desc: string
}

export interface MeituPageData {
  source: string
  category: string
  keyword: string
  page: number
  lastPage: number
  total: number
  items: MeituAlbum[]
  /** 分类为热门明星时返回作者榜，此时 items 为空 */
  stars?: MeituStar[]
}

export interface MeituListResponse {
  ok: boolean
  page?: MeituPageData
  error?: string
}

export interface MeituCategoriesResponse {
  ok: boolean
  categories?: MeituCategory[]
  error?: string
}

export interface MeituImage {
  url: string
  thumb?: string
}

export interface MeituAlbumDetail {
  source: string
  id: string
  title: string
  pageUrl: string
  images: MeituImage[]
  tags: string[]
}

export interface MeituDetailResponse {
  ok: boolean
  album?: MeituAlbumDetail
  error?: string
}

/** 收藏 payload：从收藏直接打开图集所需的信息 */
export interface MeituFavPayload {
  source: string
  pageUrl: string
  cover: string
  title: string
  imageCount: number
  tags: string[]
}

/** 从收藏进入美图页时的预览参数 */
export interface MeituFocus {
  album: MeituAlbum
  at: number
}

export function isMeituTemplate(value: unknown): value is MeituSourceTemplate {
  return value === 'jb9' || value === 'taoo'
}

export function isMeituSourceId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80
}

export function meituTemplateLabel(template: MeituSourceTemplate): string {
  return (
    MEITU_SOURCE_TEMPLATES.find((entry) => entry.id === template)?.label ??
    MEITU_SOURCE_TEMPLATES[0].label
  )
}

/** 按站点地址猜美图源模板；认不出来时返回 null */
export function inferMeituTemplate(baseUrl: string): MeituSourceTemplate | null {
  const text = baseUrl.trim().toLowerCase()
  if (!text) return null
  if (text.includes('jb9.es') || /myhl\d*\.(sbs|top|cc|com)/.test(text)) return 'jb9'
  if (text.includes('taoo.xyz')) return 'taoo'
  return null
}

export function toMeituSourceRef(source: MeituSource): MeituSourceRef {
  return { id: source.id, template: source.template, baseUrl: source.baseUrl }
}

/** 缺失时补默认源；已有配置（包括用户删空）以用户为准 */
export function normalizeMeituSources(raw: unknown): MeituSource[] {
  if (!Array.isArray(raw)) return DEFAULT_MEITU_SOURCES.map((source) => ({ ...source }))
  const rows: MeituSource[] = []
  const ids = new Set<string>()
  const urls = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Partial<MeituSource>
    const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : ''
    if (!/^https?:\/\//i.test(baseUrl) || urls.has(baseUrl)) continue
    const template = isMeituTemplate(record.template)
      ? record.template
      : inferMeituTemplate(baseUrl)
    if (!template) continue
    let id =
      typeof record.id === 'string' && record.id.trim() ? record.id.trim().slice(0, 80) : template
    let n = 2
    while (ids.has(id)) id = `${template}_${n++}`
    ids.add(id)
    urls.add(baseUrl)
    let host = baseUrl
    try {
      host = new URL(baseUrl).hostname
    } catch {
      // 非法地址已在上面过滤
    }
    rows.push({
      id,
      name: (typeof record.name === 'string' && record.name.trim()) || host,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      template,
      enabled: record.enabled !== false,
      testStatus: record.testStatus === 'bad' ? 'bad' : record.testStatus === 'ok' ? 'ok' : null,
      testMsg: typeof record.testMsg === 'string' ? record.testMsg : null,
      testAt: typeof record.testAt === 'number' ? record.testAt : 0
    })
  }
  return rows
}

/** 收藏 id 形如「源 id|图集 id」 */
export function parseMeituFavId(raw: string): { source: string | null; albumId: string } {
  const [idSource, ...rest] = raw.split('|')
  return {
    source: isMeituSourceId(idSource) ? idSource : null,
    albumId: rest.join('|')
  }
}

export function parseMeituFavPayload(raw: string | null): MeituFavPayload | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return null
    const parsed = value as Partial<MeituFavPayload>
    if (!isMeituSourceId(parsed.source)) return null
    if (typeof parsed.pageUrl !== 'string' || !parsed.pageUrl) return null
    return {
      source: parsed.source,
      pageUrl: parsed.pageUrl,
      cover: typeof parsed.cover === 'string' ? parsed.cover : '',
      title: typeof parsed.title === 'string' ? parsed.title : '',
      imageCount: typeof parsed.imageCount === 'number' ? parsed.imageCount : 0,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag): tag is string => typeof tag === 'string')
        : []
    }
  } catch {
    return null
  }
}
