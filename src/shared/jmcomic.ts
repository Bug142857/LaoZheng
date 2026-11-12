/** 禁漫天堂（18comic）：漫画模块的外部源，站点失效时走 x99dh.net 的「优选访问」换址 */

export const JMCOMIC_SOURCE_ID = 'jmcomic'
export const JMCOMIC_DEFAULT_BASE = 'https://18comic66.com'
export const JMCOMIC_COMIC_ID_PREFIX = 'jm:'
/** 地址发布页：站点打不开时从这里解析「优选访问」里的禁漫线路 */
export const JMCOMIC_GOHOME_URL = 'https://x99dh.net/'
/** 列表每页 80 条（站点固定） */
export const JMCOMIC_PAGE_SIZE = 80
/** 章节图打乱算法的分界：album / photo id 大于该值的图片需要重排 */
export const JMCOMIC_SCRAMBLE_ID = 220980

export interface JmcomicCategory {
  id: string
  name: string
}

/** 分类 slug → 条目数量；-1 表示暂时取不到 */
export interface JmcomicCategoryCountsResponse {
  ok: boolean
  counts: Record<string, number>
  error?: string
}

/** 站点导航里的六个分类，slug 用于 /albums/<slug>?page=N */
export const JMCOMIC_CATEGORIES: JmcomicCategory[] = [
  { id: 'hanman', name: '韩漫' },
  { id: 'doujin', name: '同人' },
  { id: 'single', name: '单本' },
  { id: 'short', name: '短篇' },
  { id: 'meiman', name: 'English Manga' },
  { id: 'another', name: '其他类' }
]

export function jmcomicComicId(rawId: string, sourceId = JMCOMIC_SOURCE_ID): string {
  const value = rawId.trim().replace(/^\/+|\/+$/g, '')
  if (/^jm[_a-zA-Z0-9]*:/.test(value)) return value
  const prefix =
    sourceId === JMCOMIC_SOURCE_ID ? JMCOMIC_COMIC_ID_PREFIX : `jm_${sourceId}:`
  return `${prefix}${value}`
}

export function jmcomicComicSlug(id: string): string {
  const index = id.lastIndexOf(':')
  return index >= 0 ? id.slice(index + 1) : id
}

/** 只认「jm:xxx」/「jm_源id:xxx」，避免把漫画客里以 jm 开头的 slug 误判过来 */
export function jmcomicComicSourceId(id: string): string {
  const index = id.indexOf(':')
  if (index <= 0) return ''
  const prefix = id.slice(0, index)
  if (prefix === 'jm') return JMCOMIC_SOURCE_ID
  const matched = /^jm_([A-Za-z0-9-]+)$/.exec(prefix)
  return matched ? matched[1] : ''
}
