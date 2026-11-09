/** 音乐模块共用类型（默认音源：无名音乐网 / 闪闪音乐网，可在片源管理里增删改；无损音乐适配器保留） */

export type MusicPlatform = 'mvmp3' | 's33ve' | 'hi'

/** site = 站点接口（无名音乐 / 33ve / 无损音乐适配器）；lx = 洛雪音乐自定义音源脚本 */
export type MusicSourceKind = 'site' | 'lx'
export type MusicLxPlatform = 'kw' | 'kg' | 'tx' | 'wy'

/** 音乐源配置：默认两个站共用同一套 CMS 接口，搜索 / 解析由主进程按地址自动识别 */
export interface MusicSource {
  id: string
  name: string
  baseUrl: string
  /** 缺省按地址自动识别（.js 结尾视为洛雪脚本） */
  kind?: MusicSourceKind
  /** 洛雪源启用的平台；不填时按脚本声明的全部平台搜索 */
  platforms?: MusicLxPlatform[]
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
    name: '无名音乐',
    baseUrl: 'http://www.mvmp3.com',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 's33ve',
    name: '33ve',
    baseUrl: 'https://www.33ve.com',
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
export const DEFAULT_MUSIC_BASE_URLS: Record<string, string> = Object.fromEntries(
  [...DEFAULT_MUSIC_SOURCES, ...LX_MUSIC_SOURCES].map((s) => [s.id, s.baseUrl])
)

/**
 * 音乐源配置：
 * - 旧数据没有 musicSources 时补默认源；
 * - 已经存在数组时完全以用户配置为准（删空也保持为空，不再自动加回）。
 */
export function normalizeMusicSources(raw: unknown): MusicSource[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_MUSIC_SOURCES, ...LX_MUSIC_SOURCES].map((source) => ({ ...source }))
  }
  const out: MusicSource[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as Partial<MusicSource>
    if (typeof source.baseUrl !== 'string' || !/^https?:\/\//i.test(source.baseUrl.trim())) {
      continue
    }
    if (typeof source.id !== 'string' || !source.id) continue
    const rawName = source.name?.trim() || source.baseUrl
    // 老数据里的默认名自动换成新的 (Flac) 标识，用户改过的名字保持原样
    const name =
      source.id === 'lx_fish' && rawName === 'fish 聚合音源'
        ? 'fish 聚合音源 (Flac)'
        : rawName
    out.push({
      id: source.id,
      name,
      baseUrl: source.baseUrl.trim().replace(/\/+$/, ''),
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
    })
  }
  return out
}

/** 无损音乐站点返回的可用音质（格式 / 码率 / 文件大小） */
export interface MusicQuality {
  format: string
  bitrate: string
  size?: string
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
