/**
 * 演唱模块：只存手动添加的 B站视频条目（早期收藏夹视频已一次性导入）。
 * 与「直播」共用 B站登录态（electron/livePlatform/auth.ts），登录只影响播放清晰度。
 */

export interface SingingVideo {
  /** B站视频号，唯一键 */
  bvid: string
  /** 分P 序号 */
  page: number
  /** 界面显示的标题（可自定义） */
  title: string
  /** B站原标题，用来判断标题是否被改过 */
  originalTitle: string
  cover: string
  durationSec: number
  /** 分类名（手动添加时填写） */
  category: string
  owner: string
  addedAt: number
}

export interface SingingVideoInfo {
  bvid: string
  page: number
  title: string
  cover: string
  durationSec: number
  owner: string
  error?: string
}

export interface SingingQuality {
  id: string
  label: string
  /** DASH 清晰度对应的视频地址；durl 回退时为空（需重新请求） */
  src?: string
  /** CDN 备用地址 */
  backupSrc?: string
}

export interface SingingPlayback {
  bvid: string
  src: string
  /** DASH 音轨地址；有值时播放器用双轨同步播放 */
  audioSrc?: string
  /** DASH 音轨备用地址 */
  audioBackupSrc?: string
  qualities: SingingQuality[]
  qualityId: string
  error?: string
}

/** B站弹幕：time 秒，mode 1~3 滚动 / 4 底部 / 5 顶部 */
export interface SingingDanmakuItem {
  time: number
  mode: number
  size: number
  color: number
  text: string
}

export interface SingingDanmakuResult {
  items: SingingDanmakuItem[]
  error?: string
}

/** 演唱分类树节点（按收藏夹名字里的「-」分 1~3 级） */
export interface SingingCategoryNode {
  name: string
  count: number
  children: SingingCategoryNode[]
}

/** 一级分类固定排在最后 */
export const SINGING_TAIL_CATEGORIES = ['游戏剧情', '影视动漫', '文学科普']

export const SINGING_MANUAL_CATEGORY = '手动添加'

const BVID_RE = /^BV[0-9A-Za-z]{10}$/

export function isBvid(value: unknown): value is string {
  return typeof value === 'string' && BVID_RE.test(value)
}

/** 演唱条目兜底：坏数据直接丢掉，标题被改过的保留自定义标题 */
export function normalizeSingingVideos(raw: unknown): SingingVideo[] {
  if (!Array.isArray(raw)) return []
  const out: SingingVideo[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const o = entry as Record<string, unknown>
    const bvid = typeof o.bvid === 'string' ? o.bvid.trim() : ''
    if (!isBvid(bvid) || seen.has(bvid)) continue
    seen.add(bvid)
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    const originalTitle =
      typeof o.originalTitle === 'string' && o.originalTitle.trim()
        ? o.originalTitle.trim()
        : title
    const page = typeof o.page === 'number' && Number.isFinite(o.page) && o.page > 0 ? o.page : 1
    out.push({
      bvid,
      page,
      title: title || originalTitle,
      originalTitle,
      cover: typeof o.cover === 'string' ? o.cover : '',
      durationSec:
        typeof o.durationSec === 'number' && Number.isFinite(o.durationSec)
          ? Math.max(0, Math.round(o.durationSec))
          : 0,
      category:
        typeof o.category === 'string' && o.category.trim()
          ? o.category.trim()
          : SINGING_MANUAL_CATEGORY,
      owner: typeof o.owner === 'string' ? o.owner.trim() : '',
      addedAt:
        typeof o.addedAt === 'number' && Number.isFinite(o.addedAt) ? o.addedAt : Date.now()
    })
  }
  return out
}

/** 分类名 → 1~3 级路径；只有两级的归入第三级「其他」 */
export function singingCategoryPath(category: string): string[] {
  const parts = category
    .split('-')
    .map((part) => part.trim())
    .filter(Boolean)
  if (!parts.length) return ['其他']
  if (parts.length === 1) return [parts[0]]
  if (parts.length === 2) return [parts[0], parts[1], '其他']
  return [parts[0], parts[1], parts.slice(2).join('-')]
}

/** 分类树：一级顺序按数据首次出现，游戏剧情 / 影视动漫 / 文学科普固定排最后 */
export function singingCategoryTree(videos: SingingVideo[]): SingingCategoryNode[] {
  const roots: SingingCategoryNode[] = []
  for (const video of videos) {
    const path = singingCategoryPath(video.category)
    let level = roots
    for (const name of path) {
      let node = level.find((entry) => entry.name === name)
      if (!node) {
        node = { name, count: 0, children: [] }
        level.push(node)
      }
      node.count += 1
      level = node.children
    }
  }
  const tail = SINGING_TAIL_CATEGORIES.map((name) =>
    roots.find((node) => node.name === name)
  ).filter((node): node is SingingCategoryNode => !!node)
  const head = roots.filter((node) => !SINGING_TAIL_CATEGORIES.includes(node.name))
  return [...head, ...tail]
}
