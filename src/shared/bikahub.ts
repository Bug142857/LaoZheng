/** 哔咔（bikahub.net）小说 / 漫画源共用的编号与分类定义 */

export const BIKAHUB_NOVEL_SOURCE_ID = 'bikahub'
export const BIKAHUB_COMIC_SOURCE_ID = 'bikahub'
export const BIKAHUB_DEFAULT_BASE = 'https://bikahub.net'
export const BIKAHUB_COMIC_ID_PREFIX = 'bkh:'

/** 小说分类（取自站点 /novel 顶部标签，slug 用于 /novel/category/<slug>） */
export const BIKAHUB_NOVEL_CATEGORIES = [
  { id: 'dushi', name: '都市' },
  { id: 'xiaoyaun', name: '校园' },
  { id: 'luanlun', name: '乱伦' },
  { id: 'xuanhuan', name: '玄幻' },
  { id: 'chuanyue', name: '穿越' },
  { id: 'wuxia', name: '武侠' },
  { id: 'qihuan', name: '奇幻' },
  { id: 'jiakonglishi', name: '架空历史' },
  { id: 'tongren', name: '同人' }
]

/** 漫画分类（取自站点 /comic 顶部标签，slug 用于 /comic/category/<slug>） */
export const BIKAHUB_COMIC_CATEGORIES = [
  { id: 'riman', name: '日漫' },
  { id: 'tongren', name: '同人' },
  { id: 'hanman', name: '韩漫' },
  { id: 'danben', name: '单本' },
  { id: 'quancai', name: '全彩' },
  { id: 'baihe', name: '百合' },
  { id: 'duanpian', name: '短篇' },
  { id: 'hougong', name: '后宫' },
  { id: 'xuesheng', name: '学生' },
  { id: 'xiaoyuan', name: '校园' },
  { id: 'luanlun', name: '乱伦' },
  { id: 'tiaojiao', name: '调教' },
  { id: 'renqi', name: '人妻' },
  { id: 'ntr', name: 'NTR' },
  { id: 'nvpu', name: '女仆' },
  { id: 'juqing', name: '剧情' },
  { id: 'qihuan', name: '奇幻' },
  { id: 'luoli', name: '萝莉' },
  { id: 'juru', name: '巨乳' },
  { id: 'bl', name: 'BL' }
]

/** 分类 slug → 条目数量；-1 表示暂时取不到 */
export interface BikahubCategoryCountsResponse {
  ok: boolean
  counts: Record<string, number>
  error?: string
}

export function bikahubComicId(rawId: string, sourceId = BIKAHUB_COMIC_SOURCE_ID): string {
  const value = rawId.trim().replace(/^\/+|\/+$/g, '')
  if (/^bkh[_a-zA-Z0-9]*:/.test(value)) return value
  const prefix = sourceId === BIKAHUB_COMIC_SOURCE_ID ? BIKAHUB_COMIC_ID_PREFIX : `bkh_${sourceId}:`
  return `${prefix}${value}`
}

export function bikahubComicSlug(id: string): string {
  const index = id.lastIndexOf(':')
  return index >= 0 ? id.slice(index + 1) : id
}

export function bikahubComicSourceId(id: string): string {
  if (!id.startsWith('bkh')) return ''
  const index = id.indexOf(':')
  if (index < 0) return BIKAHUB_COMIC_SOURCE_ID
  const prefix = id.slice(0, index)
  return prefix === 'bkh' ? BIKAHUB_COMIC_SOURCE_ID : prefix.replace(/^bkh_/, '')
}
