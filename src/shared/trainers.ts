/**
 * 游戏修改（训练器 / 修改器）模块。
 *
 * 在线源：
 * - 风灵月影 FLiNG（flingtrainer.com）：搜索 / 详情 / 直接下载；
 * - MegaGames（megagames.com）：聚合 FLiNG / PLAYMAGiC / RazorDOX 等训练器（暂时停用）；
 * - 3DM（dl.3dmgame.com）：修改器 / 存档解锁分区 + 站内搜索；
 * - 游民星空（down.gamersky.com）：游戏工具 / 存档分区 + 站内搜索；
 * - 游侠网（patch.ali213.net）：修改器 / 存档分区 + 站内搜索。
 *
 * 「修改器源」与影视源一样存进 data.trainerSources，可在片源管理里启停、测试、增删改。
 * 下载统一落到「下载目录/修改器」，并登记到下载管理的「修改器」分区。
 */

export type TrainerSourceType = 'fling' | 'megagames' | '3dm' | 'gamersky' | 'ali213'

export interface TrainerSource {
  id: string
  name: string
  type: TrainerSourceType
  baseUrl: string
  enabled: boolean
  testStatus: 'ok' | 'bad' | null
  testMsg: string | null
  testAt: number
}

/** 主进程只需要源类型与地址，不关心启用状态与测试结果 */
export interface TrainerSourceInput {
  id: string
  type: TrainerSourceType
  baseUrl: string
  name?: string
}

export const TRAINER_SOURCE_TYPE_LABEL: Record<TrainerSourceType, string> = {
  fling: '风灵月影（flingtrainer.com）',
  megagames: 'MegaGames（megagames.com）',
  '3dm': '3DM（3dmgame.com）',
  gamersky: '游民星空（gamersky.com）',
  ali213: '游侠网（ali213.net）'
}

export const DEFAULT_TRAINER_SOURCES: TrainerSource[] = [
  {
    id: 'fling',
    name: '风灵月影',
    type: 'fling',
    baseUrl: 'https://flingtrainer.com',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: '3dm_trainer',
    name: '3DM 修改器',
    type: '3dm',
    baseUrl: 'https://dl.3dmgame.com/patch_26_1',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: '3dm_save',
    name: '3DM 存档',
    type: '3dm',
    baseUrl: 'https://dl.3dmgame.com/patch_20_1',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'gamersky_trainer',
    name: '游民星空 修改器',
    type: 'gamersky',
    baseUrl: 'http://down.gamersky.com/oth/tools',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'gamersky_save',
    name: '游民星空 存档',
    type: 'gamersky',
    baseUrl: 'http://down.gamersky.com/oth/sav',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'ali213_trainer',
    name: '游侠网 修改器',
    type: 'ali213',
    baseUrl: 'https://patch.ali213.net/showclass/class1_1.html',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'ali213_save',
    name: '游侠网 存档',
    type: 'ali213',
    baseUrl: 'https://patch.ali213.net/showclass/class5_1.html',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  }
]

/** 按站点地址推断源类型（批量导入 / 手动添加时用） */
export function inferTrainerSourceType(raw: string): TrainerSourceType {
  const url = raw.trim().toLowerCase()
  if (url.includes('3dmgame.com')) return '3dm'
  if (url.includes('gamersky.com')) return 'gamersky'
  if (url.includes('ali213.net')) return 'ali213'
  return 'fling'
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

/**
 * 修改器源配置：
 * - 旧数据没有 trainerSources 时补全部默认源；
 * - 已经存在数组时以用户配置为准，但旧版本数据里没有任何新站点源时自动补上
 *   3DM / 游民星空 / 游侠网 六个默认源（之后用户删掉不会再反复加回）；
 * - MegaGames 暂时停用，历史数据里的 megagames 源直接丢弃。
 */
export function normalizeTrainerSources(raw: unknown): TrainerSource[] {
  if (!Array.isArray(raw)) return DEFAULT_TRAINER_SOURCES.map((source) => ({ ...source }))
  const out: TrainerSource[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as Partial<TrainerSource>
    if (
      source.type !== 'fling' &&
      source.type !== 'megagames' &&
      source.type !== '3dm' &&
      source.type !== 'gamersky' &&
      source.type !== 'ali213'
    ) {
      continue
    }
    if (source.type === 'megagames' || source.id === 'megagames') continue
    if (typeof source.baseUrl !== 'string' || !/^https?:\/\//i.test(source.baseUrl.trim())) {
      continue
    }
    if (typeof source.id !== 'string' || !source.id) continue
    out.push({
      id: source.id,
      name:
        typeof source.name === 'string' && source.name.trim()
          ? source.name.trim()
          : TRAINER_SOURCE_TYPE_LABEL[source.type].split('（')[0],
      type: source.type,
      baseUrl: normalizeBaseUrl(source.baseUrl),
      enabled: source.enabled !== false,
      testStatus:
        source.testStatus === 'ok' || source.testStatus === 'bad' ? source.testStatus : null,
      testMsg: typeof source.testMsg === 'string' ? source.testMsg : null,
      testAt:
        typeof source.testAt === 'number' && Number.isFinite(source.testAt) ? source.testAt : 0
    })
  }
  const hasNewSource = out.some(
    (source) =>
      source.type === '3dm' || source.type === 'gamersky' || source.type === 'ali213'
  )
  if (out.length > 0 && !hasNewSource) {
    for (const def of DEFAULT_TRAINER_SOURCES) {
      if (def.type === 'megagames' || def.type === 'fling') continue
      if (out.some((source) => source.id === def.id || source.baseUrl === def.baseUrl)) continue
      out.push({ ...def })
    }
  }
  return out
}

export interface TrainerListItem {
  /** 站点链接末段 slug */
  id: string
  title: string
  url: string
  cover: string | null
  /** yyyy-MM-dd，取不到时为空串 */
  date: string
  sourceId: string
  sourceName: string
}

export interface TrainerSearchResponse {
  ok: boolean
  items: TrainerListItem[]
  page: number
  /** 是否还有下一页（任一源还有下一页） */
  hasMore: boolean
  /** 中文关键词自动翻译后的英文名，用于页面提示 */
  translatedFrom?: string
  translatedTo?: string
  error?: string
}

export interface TrainerDownloadFile {
  name: string
  url: string
  date: string
  size: string
  /** 网盘 / 网页地址：应用内打开浏览器，而不是直接下载文件 */
  external?: boolean
}

export interface TrainerDetail {
  id: string
  title: string
  url: string
  cover: string | null
  sourceId: string
  sourceName: string
  /** 支持的游戏版本，例如 v1.01-v1.03.1+ */
  version: string
  /** 修改项数量（站点标注） */
  optionsCount: number
  /** 最后更新时间（站点标注） */
  updatedAt: string
  /** 简介（MegaGames 有，FLiNG 为空） */
  summary: string
  options: string[]
  /** 反作弊 / 使用说明 */
  notes: string[]
  screenshots: string[]
  downloads: TrainerDownloadFile[]
}

export interface TrainerDetailResponse {
  ok: boolean
  trainer: TrainerDetail | null
  error?: string
}

export interface TrainerDownloadInput {
  url: string
  title: string
  version?: string
  /** 详情页地址，下载时作为 Referer */
  pageUrl?: string
  sourceType: TrainerSourceType
  sourceBaseUrl: string
  sourceId?: string
  sourceName?: string
  cover?: string | null
}

/**
 * 已安装的修改器记录（随备份与云同步走，文件本身不参与备份）。
 * folder / exe 都相对「下载目录/修改器」根目录。
 */
export interface InstalledTrainer {
  /** 安装目录名，同时作为唯一 id */
  folder: string
  title: string
  source: TrainerSourceType | 'local'
  sourceId: string
  pageUrl: string
  cover: string | null
  version: string
  /** 主程序相对安装目录的路径，找不到 exe 时为空串 */
  exe: string
  files: number
  sizeBytes: number
  installedAt: number
}

export interface TrainerDownloadResponse {
  ok: boolean
  trainer?: InstalledTrainer
  /** 无法自动解压等提示（例如 rar / 7z） */
  note?: string
  error?: string
}

export interface TrainerLibraryResponse {
  ok: boolean
  /** 修改器根目录绝对路径 */
  root: string
  items: InstalledTrainer[]
  error?: string
}

export interface TrainerActionResult {
  ok: boolean
  message?: string
  error?: string
}

/** 修改器源测试：count = 首页拿到的条目数 */
export interface TrainerTestResult {
  ok: boolean
  count?: number
  message?: string
  error?: string
}
