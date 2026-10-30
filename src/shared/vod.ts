/**
 * 观影模块共用类型：苹果CMS V10 采集源 / 搜索条目 / 播放线路。
 * 与手机端 VodModels.kt 的字段保持一致，`vodSources` 随备份 JSON 与手机端互通。
 */

export interface VodItem {
  vod_id: number
  vod_name: string
  vod_pic: string
  type_name: string
  vod_year: string
  vod_area: string
  vod_remarks: string
  vod_duration: string
  vod_douban_id: number
  vod_play_from: string
  vod_play_url: string
}

export interface VodEpisode {
  name: string
  url: string
}

export interface VodPlayGroup {
  name: string
  episodes: VodEpisode[]
}

/** 搜索命中条目（带匹配分与所属片源 id，渲染进程用） */
export interface VodSearchItem extends VodItem {
  score: number
}

export interface VodSearchResponse {
  ok: boolean
  items: VodSearchItem[]
  total?: number
  error?: string
}

/** 苹果CMS 分类（?ac=videolist 全库列表返回 class 字段） */
export interface VodCategory {
  type_id: number
  type_pid: number
  type_name: string
}

/** 分类列表（ac=list）：部分采集站只在 ac=list 返回 class 字段 */
export interface VodCategoriesResponse {
  ok: boolean
  categories?: VodCategory[]
  total?: number
  error?: string
}

/** 番1~番4 的整站浏览结果（关键词 / 分类 / 页码） */
export interface VodListResponse {
  ok: boolean
  items?: VodItem[]
  total?: number
  page?: number
  pageCount?: number
  categories?: VodCategory[]
  error?: string
}

export interface VodDetailResponse {
  ok: boolean
  item?: VodItem
  groups?: VodPlayGroup[]
  error?: string
}

export interface VodTestResponse {
  ok: boolean
  status: 'ok' | 'dead' | 'proxy'
  message: string
  testAt: number
  /** 自动归目录结果（regionManual 为 true 时由渲染进程保留原值） */
  region: 'cn' | 'proxy'
}

export interface VodSourceInput {
  id: string
  name: string
  baseUrl: string
}

export function vodHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/at/xml')) {
    return `${trimmed.slice(0, -'/at/xml'.length)}/api.php/provide/vod`
  }
  return trimmed
}

/** 订阅文本导入：JSON 数组 / 单对象 / 一行一个 URL 或「名称|URL」 */
export function parseSourceImport(text: string): { sources: VodSourceInput[]; error?: string } {
  const trimmed = text.trim()
  if (!trimmed) return { sources: [], error: '内容为空' }

  const toInput = (raw: unknown): VodSourceInput | null => {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    const base = String(o.baseUrl ?? o.url ?? '').trim()
    if (!base.startsWith('http')) return null
    const name = String(o.name ?? '').trim() || vodHost(base)
    return { id: String(o.id ?? '').trim() || genSourceId(base), name, baseUrl: base }
  }

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      const list = Array.isArray(parsed) ? parsed : [parsed]
      const sources = list.map(toInput).filter((s): s is VodSourceInput => !!s)
      return sources.length
        ? { sources }
        : { sources: [], error: '未识别到有效源（缺少 baseUrl / url）' }
    } catch {
      return { sources: [], error: 'JSON 解析失败' }
    }
  }

  const sources: VodSourceInput[] = []
  for (const line of trimmed.split(/\r?\n/)) {
    const row = line.trim()
    if (!row) continue
    const parts = row.split(/[|,，]/)
    if (parts.length >= 2 && parts[1].trim().startsWith('http')) {
      const base = parts[1].trim()
      sources.push({ id: genSourceId(base), name: parts[0].trim() || vodHost(base), baseUrl: base })
    } else if (row.startsWith('http')) {
      sources.push({ id: genSourceId(row), name: vodHost(row), baseUrl: row })
    }
  }
  if (!sources.length) return { sources: [], error: '未识别到有效源，支持 JSON 或一行一个 URL' }
  return { sources }
}

/** 解析播放组；默认只留 3u8 线路（其他线路大多失效/防盗链），全无 3u8 时回退原列表 */
export function parsePlayGroups(from: string, playUrl: string): VodPlayGroup[] {
  if (!playUrl.trim()) return []
  const groupNames = from.split('$$$').map((s) => s.trim())
  const groups: VodPlayGroup[] = []
  playUrl.split('$$$').forEach((body, gi) => {
    const episodes = body
      .split('#')
      .map((raw) => raw.trim())
      .filter(Boolean)
      .map((ep) => {
        const idx = ep.indexOf('$')
        if (idx <= 0) return null
        const name = ep.slice(0, idx).trim()
        const url = ep.slice(idx + 1).trim()
        if (!url.startsWith('http')) return null
        return { name, url }
      })
      .filter((ep): ep is VodEpisode => !!ep)
    if (episodes.length) {
      groups.push({ name: groupNames[gi] || `线路${gi + 1}`, episodes })
    }
  })
  const only3u8 = groups.filter((g) => g.name.toLowerCase().includes('3u8'))
  return only3u8.length ? only3u8 : groups
}

/**
 * 番1~番4 固定绑定的片源（与手机端 v0.325 一致）。
 * 与「片源管理」里的配置完全解耦，片源怎么删改都不影响这四个入口。
 */
export const H1_FIXED_SOURCES: { name: string; baseUrl: string }[] = [
  { name: 'hsckzy.vip', baseUrl: 'https://hsckzy.vip/api.php/provide/vod' },
  { name: '91md.me', baseUrl: 'https://91md.me/api.php/provide/vod' },
  { name: 'naixxzy.com', baseUrl: 'https://Naixxzy.com/api.php/provide/vod' },
  { name: 'jingpinx.com', baseUrl: 'https://www.jingpinx.com/api.php/provide/vod' }
]

/** index 从 0 开始；超出 0~3 返回 null */
export function h1FixedSource(index: number): VodSourceInput | null {
  const raw = H1_FIXED_SOURCES[index]
  if (!raw) return null
  return { id: `h1_fixed_${index + 1}`, name: raw.name, baseUrl: raw.baseUrl }
}

export function genSourceId(url: string): string {
  let hash = 0
  for (let i = 0; i < url.length; i++) hash = (hash * 31 + url.charCodeAt(i)) | 0
  return `${vodHost(url).replace(/[^\w]/g, '_')}_${Math.abs(hash)}`
}
