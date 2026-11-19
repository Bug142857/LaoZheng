/** 音乐模块共用类型（默认音源：无名音乐网，备用线路：无名闪闪音乐；可在片源管理里增删改） */

export type MusicPlatform = 'mvmp3' | 's33ve' | 'hi'

/** site = 站点接口（无名音乐 / 33ve / 无损音乐适配器）；lx = 洛雪音乐自定义音源脚本 */
export type MusicSourceKind = 'site' | 'lx'
export type MusicLxPlatform = 'kw' | 'kg' | 'tx' | 'wy'

/** 音乐源备用线路（无名闪闪音乐），主源搜索失败 / 空结果时自动使用 */
export interface MusicSourceBackup {
  id: string
  name: string
  baseUrl: string
  enabled: boolean
  testStatus: 'ok' | 'bad' | null
  testMsg: string | null
  testAt: number
}

/** 主进程只关心地址；id 用来给歌曲打 platform 标记 */
export interface MusicSourceBackupInput {
  id: string
  name?: string
  baseUrl: string
}

/** 音乐源配置：默认站共用同一套 CMS 接口，搜索 / 解析由主进程按地址自动识别 */
export interface MusicSource {
  id: string
  name: string
  baseUrl: string
  /** 内置默认源：不可删除，只能停用；自定义源可删 */
  builtin?: boolean
  /** 缺省按地址自动识别（.js 结尾视为洛雪脚本） */
  kind?: MusicSourceKind
  /** 洛雪源启用的平台；不填时按脚本声明的全部平台搜索 */
  platforms?: MusicLxPlatform[]
  /** 备用线路；null 表示不使用备用源 */
  backup?: MusicSourceBackup | null
  enabled: boolean
  testStatus: 'ok' | 'bad' | null
  testMsg: string | null
  testAt: number
}

/** 主进程只关心地址；id 用来给歌曲打 platform 标记 */
export interface MusicSourceInput {
  id: string
  name?: string
  baseUrl: string
  kind?: MusicSourceKind
  platforms?: MusicLxPlatform[]
  backup?: MusicSourceBackupInput | null
}

/** 无名闪闪音乐：无名音乐 + 闪闪音乐两条线路，同一套建站系统 */
export const MUSIC_SOURCE_LINES: MusicSourceLine[] = [
  { id: 'mvmp3', name: '无名音乐', baseUrl: 'http://www.mvmp3.com' },
  { id: 's33ve', name: '闪闪音乐', baseUrl: 'https://www.33ve.com' }
]

export interface MusicSourceLine {
  id: string
  name: string
  baseUrl: string
}

/** 按地址识别线路名（无名音乐 / 闪闪音乐），自定义镜像返回空字符串 */
export function musicLineName(baseUrl?: string | null): string {
  if (!baseUrl) return ''
  try {
    const host = new URL(baseUrl.trim()).hostname.toLowerCase()
    if (host === 'mvmp3.com' || host.endsWith('.mvmp3.com')) return '无名音乐'
    if (host === '33ve.com' || host.endsWith('.33ve.com')) return '闪闪音乐'
  } catch {
    // 地址不完整时按自定义处理
  }
  return ''
}

/** 无名闪闪音乐的默认备用线路：闪闪音乐 */
export const DEFAULT_MUSIC_BACKUP: MusicSourceBackup = {
  id: 's33ve',
  name: '闪闪音乐',
  baseUrl: 'https://www.33ve.com',
  enabled: true,
  testStatus: 'ok',
  testMsg: '可用',
  testAt: 0
}

function cloneMusicBackup(backup: MusicSourceBackup): MusicSourceBackup {
  return { ...backup }
}

/** 默认备用线路：优先取与主线路不同的那条内置线路 */
function defaultBackupForPrimary(primaryBaseUrl: string): MusicSourceBackup {
  const primaryName = musicLineName(primaryBaseUrl)
  const line =
    MUSIC_SOURCE_LINES.find((item) => !primaryName || item.name !== primaryName) ??
    MUSIC_SOURCE_LINES[1]
  return {
    id: line.id,
    name: line.name,
    baseUrl: line.baseUrl,
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  }
}

function isLxUrl(value: string): boolean {
  return /\.js(?:[?#]|$)/i.test(value.trim())
}

function guessMusicSourceKind(source: Partial<MusicSource>): MusicSourceKind {
  if (source.kind === 'lx' || source.kind === 'site') return source.kind
  return isLxUrl(String(source.baseUrl ?? '')) ? 'lx' : 'site'
}

export const DEFAULT_MUSIC_SOURCES: MusicSource[] = [
  {
    id: 'mvmp3',
    name: '无名闪闪音乐',
    baseUrl: MUSIC_SOURCE_LINES[0].baseUrl,
    backup: cloneMusicBackup(DEFAULT_MUSIC_BACKUP),
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  }
]

/** 洛雪音乐自定义音源脚本（只解析播放地址，搜索由酷狗 / QQ 公开接口提供） */
export const LX_MUSIC_SOURCES: MusicSource[] = [
  {
    id: 'lx_fish',
    name: 'fish 聚合音源 (Flac)',
    baseUrl: 'https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/fish/latest.js',
    kind: 'lx',
    platforms: ['kg', 'tx'],
    enabled: true,
    testStatus: null,
    testMsg: null,
    testAt: 0
  }
]

/** 后续新增的内置源：老数据首次加载时补一次，删除后不再自动加回 */
export const ADDED_LX_MUSIC_SOURCES = LX_MUSIC_SOURCES

/** 旧收藏按 platform 找默认地址（用户删掉默认源时的兜底） */
export const DEFAULT_MUSIC_BASE_URLS: Record<string, string> = {
  ...Object.fromEntries(
    [...DEFAULT_MUSIC_SOURCES, ...LX_MUSIC_SOURCES].map((s) => [s.id, s.baseUrl])
  ),
  // 旧收藏里 platform = s33ve 的歌仍要能找到无名闪闪音乐的地址
  s33ve: DEFAULT_MUSIC_BACKUP.baseUrl
}

function normalizeMusicBackup(raw: unknown): MusicSourceBackup | null {
  if (!raw || typeof raw !== 'object') return null
  const backup = raw as Partial<MusicSourceBackup>
  const baseUrl = typeof backup.baseUrl === 'string' ? backup.baseUrl.trim().replace(/\/+$/, '') : ''
  if (!/^https?:\/\//i.test(baseUrl)) return null
  const lineName = musicLineName(baseUrl)
  const rawName = backup.name?.trim() ?? ''
  // 内置线路统一叫「无名音乐 / 闪闪音乐」，自定义地址保留原名称
  const name =
    lineName && (!rawName || rawName === '无名闪闪音乐' || rawName === '33ve')
      ? lineName
      : rawName || DEFAULT_MUSIC_BACKUP.name
  return {
    id: typeof backup.id === 'string' && backup.id ? backup.id : 's33ve',
    name,
    baseUrl,
    enabled: backup.enabled !== false,
    testStatus:
      backup.testStatus === 'ok' || backup.testStatus === 'bad' ? backup.testStatus : null,
    testMsg: typeof backup.testMsg === 'string' ? backup.testMsg : null,
    testAt:
      typeof backup.testAt === 'number' && Number.isFinite(backup.testAt) ? backup.testAt : 0
  }
}

/**
 * 音乐源配置：
 * - 旧数据没有 musicSources 时补默认源；
 * - 已经存在数组时完全以用户配置为准（删空也保持为空，不再自动加回）；
 * - 旧数据里独立的 33ve 源迁移成无名音乐的备用线路（名称统一为「无名闪闪音乐」）；
 * - 新增字段 backup：缺省时无名音乐自动带无名闪闪音乐，显式 null 表示不使用备用源。
 */
export function normalizeMusicSources(raw: unknown): MusicSource[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_MUSIC_SOURCES, ...LX_MUSIC_SOURCES].map((source) => ({
      ...source,
      builtin: true,
      backup: source.backup ? cloneMusicBackup(source.backup) : null
    }))
  }
  const parsed: { source: MusicSource; backupRaw?: unknown }[] = []
  let legacyBackup: MusicSourceBackup | null = null
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as Partial<MusicSource>
    if (typeof source.baseUrl !== 'string' || !/^https?:\/\//i.test(source.baseUrl.trim())) {
      continue
    }
    if (typeof source.id !== 'string' || !source.id) continue
    try {
      new URL(source.baseUrl.trim())
    } catch {
      continue
    }
    // 只迁移旧的内置 s33ve 源：用户自己添加的 33ve 镜像保留原 id，避免收藏的 platform 失效
    if (source.id === 's33ve') {
      legacyBackup = normalizeMusicBackup({
        ...source,
        id: 's33ve',
        name: DEFAULT_MUSIC_BACKUP.name
      })
      continue
    }
    const rawName = source.name?.trim() || source.baseUrl
    // 老数据里的默认名自动换成新的 (Flac) 标识，用户改过的名字保持原样
    const name =
      source.id === 'lx_fish' && rawName === 'fish 聚合音源'
        ? 'fish 聚合音源 (Flac)'
        : source.id === 'mvmp3' && (rawName === '无名音乐' || rawName === '无名音乐镜像')
          ? '无名闪闪音乐'
          : rawName
    parsed.push({
      backupRaw: Object.prototype.hasOwnProperty.call(entry, 'backup')
        ? (entry as Partial<MusicSource>).backup
        : undefined,
      source: {
        id: source.id,
        name,
        baseUrl: source.baseUrl.trim().replace(/\/+$/, ''),
        // 内置源（无名闪闪音乐 / 洛雪 fish）不可删除，只能停用；显式 builtin:false 的是自定义源
        builtin:
          source.builtin === false
            ? false
            : DEFAULT_MUSIC_SOURCES.some((preset) => preset.id === source.id) ||
              LX_MUSIC_SOURCES.some((preset) => preset.id === source.id),
        kind: guessMusicSourceKind(source),
        platforms: Array.isArray(source.platforms)
          ? source.platforms.filter((item): item is MusicLxPlatform =>
              ['kw', 'kg', 'tx', 'wy'].includes(String(item))
            )
          : undefined,
        enabled: source.enabled !== false,
        testStatus:
          source.testStatus === 'ok' || source.testStatus === 'bad' ? source.testStatus : null,
        testMsg: typeof source.testMsg === 'string' ? source.testMsg : null,
        testAt:
          typeof source.testAt === 'number' && Number.isFinite(source.testAt) ? source.testAt : 0
      }
    })
  }
  const hasMvmp3 = parsed.some((entry) => entry.source.id === 'mvmp3')
  const out: MusicSource[] = []
  for (const { source, backupRaw } of parsed) {
    const hasBackupField = backupRaw !== undefined
    const normalized = hasBackupField ? normalizeMusicBackup(backupRaw) : null
    const legacyUsable =
      !!legacyBackup && musicLineName(legacyBackup.baseUrl) !== musicLineName(source.baseUrl)
    const fallback =
      legacyUsable && legacyBackup
        ? { ...legacyBackup }
        : defaultBackupForPrimary(source.baseUrl)
    out.push({
      ...source,
      // 无名闪闪音乐固定保留两条线路：显式 null 或缺失都补一条备用线路
      backup: source.id === 'mvmp3' ? normalized ?? fallback : normalized
    })
  }
  // 没有无名音乐但还留着 33ve 的老配置：保留成独立源，避免用户丢源
  if (legacyBackup && !hasMvmp3) {
    out.push({
      id: 's33ve',
      name: legacyBackup.name,
      baseUrl: legacyBackup.baseUrl,
      builtin: true,
      enabled: legacyBackup.enabled,
      testStatus: legacyBackup.testStatus,
      testMsg: legacyBackup.testMsg,
      testAt: legacyBackup.testAt
    })
  }
  // 老配置里主线路停用、33ve 启用：备用线路可用时至少保留一个可选源，
  // 避免音乐页提示「没有启用的音乐源」且 UI 无法单独启用备用线路
  if (out.length && !out.some((source) => source.enabled)) {
    const withBackup = out.find((source) => source.backup?.enabled)
    if (withBackup) withBackup.enabled = true
  }
  return out
}

/** 无损音乐站点返回的可用音质（格式 / 码率 / 文件大小） */
export interface MusicQuality {
  format: string
  bitrate: string
  size?: string
}

/** 音乐播放队列条目：持久化到 settings.json，随备份 / 云同步走 */
export interface MusicQueueItem {
  /** 唯一键：platform|id 或直链 */
  key: string
  id: string
  platform?: string
  /** 音源站点地址（自定义 / 镜像音乐源需要） */
  baseUrl?: string
  /** 无损音乐站点的实际平台（kuwo / wyy），用于下载窗口提示 */
  origin?: string
  /** 下载时可选的音质 */
  qualities?: MusicQuality[]
  title: string
  artists: string
  cover: string | null
  /** 已解析直链（本地音乐 / 下载音乐） */
  url?: string
}

/** 恢复队列时做结构校验：只保留字段完整的条目，避免坏数据把播放器打挂 */
export function normalizeMusicQueue(input: unknown): MusicQueueItem[] {
  if (!Array.isArray(input)) return []
  const out: MusicQueueItem[] = []
  for (const raw of input.slice(0, 500)) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (typeof item.key !== 'string' || !item.key) continue
    if (typeof item.id !== 'string' || !item.id) continue
    if (typeof item.title !== 'string' || !item.title) continue
    const qualities = Array.isArray(item.qualities)
      ? item.qualities
          .slice(0, 10)
          .map((q) => q as Record<string, unknown>)
          .filter((q) => typeof q?.format === 'string' && typeof q?.bitrate === 'string')
          .map((q) => ({
            format: String(q.format),
            bitrate: String(q.bitrate),
            ...(typeof q.size === 'string' ? { size: q.size } : {})
          }))
      : undefined
    out.push({
      key: item.key,
      id: item.id,
      ...(typeof item.platform === 'string' ? { platform: item.platform } : {}),
      ...(typeof item.baseUrl === 'string' ? { baseUrl: item.baseUrl } : {}),
      ...(typeof item.origin === 'string' ? { origin: item.origin } : {}),
      ...(qualities && qualities.length ? { qualities } : {}),
      title: item.title,
      artists: typeof item.artists === 'string' ? item.artists : '',
      cover: typeof item.cover === 'string' ? item.cover : null,
      ...(typeof item.url === 'string' && item.url ? { url: item.url } : {})
    })
  }
  return out
}

export interface MusicSong {
  id: string
  name: string
  artists: string
  album: string
  cover: string
  durationMs: number
  /** 音源 id；旧收藏里可能是 joox / netease */
  platform?: string
  /** 音源站点地址（搜到的歌自带，播放 / 下载 / 歌词解析直接用它） */
  baseUrl?: string
  /** 无损音乐站点的实际平台（kuwo = 酷我，wyy = 网易云） */
  origin?: string
  /** 下载时可选的音质；没有时按站点默认音质下载 */
  qualities?: MusicQuality[]
  /** 站点默认音质文件大小（无名音乐 / 33ve 搜索列表里有「大小」） */
  sizeHint?: string
}

export interface MusicSearchResponse {
  ok: boolean
  items: MusicSong[]
  error?: string
}

export interface MusicResolveResponse {
  ok: boolean
  url?: string
  lrc?: string
  cover?: string
  name?: string
  singer?: string
  error?: string
}

/** 音乐源测试：count = 用固定关键词搜到的条目数 */
export interface MusicTestResult {
  ok: boolean
  count?: number
  message?: string
  error?: string
}

/** 歌词下载：保存到「下载目录/音乐」，返回实际文件路径 */
export interface MusicLyricsSaveResult {
  ok: boolean
  path?: string
  error?: string
}

/** 榜单分类（来自 mvmp3：/list/top.html 的热门榜单 / 特色音乐 / 全球榜单） */
export interface MusicTopCategory {
  /** 站点路径标识，例如 kugou → /list/kugou.html */
  id: string
  name: string
}

export interface MusicTopGroup {
  id: string
  name: string
  categories: MusicTopCategory[]
}

export const MUSIC_TOP_GROUPS: MusicTopGroup[] = [
  {
    id: 'hot',
    name: '热门榜单',
    categories: [
      { id: 'kugou', name: '酷狗飙升榜' },
      { id: 'top', name: 'TOP排行榜' },
      { id: 'douyin', name: '抖音热歌榜' },
      { id: 'kuaishou', name: '快手热歌榜' },
      { id: 'djtop', name: 'DJ热歌榜' },
      { id: 'share', name: '音乐分享榜' },
      { id: 'ndtop', name: '内地排行榜' },
      { id: 'hktop', name: '香港排行榜' },
      { id: 'twtop', name: '台湾排行榜' },
      { id: 'ustop', name: '欧美排行榜' },
      { id: 'krtop', name: '韩国排行榜' }
    ]
  },
  {
    id: 'special',
    name: '特色音乐',
    categories: [
      { id: 'newacg', name: 'ACG新歌榜' },
      { id: 'dytop', name: '电音热歌榜' },
      { id: 'newzy', name: '综艺新歌榜' },
      { id: 'sctop', name: '说唱先锋榜' },
      { id: 'ystop', name: '影视金曲榜' },
      { id: 'yytop', name: '粤语金曲榜' },
      { id: 'omtop', name: '欧美金曲榜' },
      { id: 'kkyc', name: '音乐人原创榜' },
      { id: 'leida', name: '酷狗雷达榜' },
      { id: 'blhot', name: '80后热歌榜' },
      { id: 'jlhot', name: '90后热歌榜' }
    ]
  },
  {
    id: 'global',
    name: '全球榜单',
    categories: [
      { id: 'mgtop', name: '美国单曲榜' },
      { id: 'ygtop', name: '英国单曲榜' },
      { id: 'rbtop', name: '日本歌曲榜' },
      { id: 'hgtop', name: '韩国音乐榜' },
      { id: 'joox', name: 'JOOX热歌榜' },
      { id: 'kkbox', name: 'KKBOX风云榜' },
      { id: 'space', name: 'SHOWER榜' },
      { id: 'btptop', name: '电子舞曲榜' },
      { id: 'xyztop', name: '小语种热歌' },
      { id: 'song', name: '洗脑神曲' },
      { id: 'djwuqu', name: 'DJ舞曲' }
    ]
  }
]

export const MUSIC_TOP_CATEGORIES: MusicTopCategory[] = MUSIC_TOP_GROUPS.flatMap(
  (group) => group.categories
)
