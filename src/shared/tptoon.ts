/** 头牌漫画（tptoon.net）：漫画模块的外部源，站点失效时走 tpmh8.cc 防失联页换址 */

export const TPTOON_SOURCE_ID = 'tptoon'
export const TPTOON_DEFAULT_BASE = 'https://tptoon.net'
export const TPTOON_COMIC_ID_PREFIX = 'tpt:'
/** 地址发布页：站点打不开时从这里找可用线路 */
export const TPTOON_GOHOME_URL = 'https://tpmh8.cc/'
export const TPTOON_PAGE_SIZE = 30
export const TPTOON_SEARCH_PAGE_SIZE = 20

export interface TptoonCategory {
  id: string
  name: string
}

/** 分类 slug → 条目数量；-1 表示暂时取不到 */
export interface TptoonCategoryCountsResponse {
  ok: boolean
  counts: Record<string, number>
  error?: string
}

/** 站点导航里的七个分类，slug 用于 /<slug>/index_N.html */
export const TPTOON_CATEGORIES: TptoonCategory[] = [
  { id: 'hanman', name: '韩漫' },
  { id: 'riman', name: '日漫' },
  { id: '3d', name: '3D' },
  { id: 'doujin', name: '同人誌' },
  { id: 'single', name: '单行本' },
  { id: 'short', name: '短篇' },
  { id: 'other', name: '其他' }
]

export function tptoonComicId(rawId: string, sourceId = TPTOON_SOURCE_ID): string {
  const value = rawId.trim().replace(/^\/+|\/+$/g, '')
  if (/^tpt[_a-zA-Z0-9]*:/.test(value)) return value
  const prefix = sourceId === TPTOON_SOURCE_ID ? TPTOON_COMIC_ID_PREFIX : `tpt_${sourceId}:`
  return `${prefix}${value}`
}

export function tptoonComicSlug(id: string): string {
  const index = id.lastIndexOf(':')
  return index >= 0 ? id.slice(index + 1) : id
}

export function tptoonComicSourceId(id: string): string {
  if (!id.startsWith('tpt')) return ''
  const index = id.indexOf(':')
  if (index < 0) return TPTOON_SOURCE_ID
  const prefix = id.slice(0, index)
  return prefix === 'tpt' ? TPTOON_SOURCE_ID : prefix.replace(/^tpt_/, '')
}
