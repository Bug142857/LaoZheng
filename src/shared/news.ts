/** 资讯（今日热榜 tophub.today）共用类型 */

export interface NewsCategory {
  key: string
  label: string
}

/** 站点顶部一级分类（顺序与站点导航一致；AI 分类已按用户要求去掉） */
export const NEWS_CATEGORIES: NewsCategory[] = [
  { key: 'news', label: '综合' },
  { key: 'brief', label: '简报' },
  { key: 'tech', label: '科技' },
  { key: 'ent', label: '娱乐' },
  { key: 'community', label: '社区' },
  { key: 'shopping', label: '购物' },
  { key: 'finance', label: '财经' },
  { key: 'developer', label: '开发' },
  { key: 'epaper', label: '报刊' }
]

export function newsCategoryLabel(key: string): string {
  return NEWS_CATEGORIES.find((category) => category.key === key)?.label ?? key
}

export interface NewsItem {
  rank: number
  title: string
  /** 榜单附带信息：热度 / 来源 / 销量等，没有就是空串 */
  extra: string
  /** 原文外链；站内跳转 / 无法还原的链接为 null */
  url: string | null
}

export interface NewsNodeCard {
  /** 榜单编号（/n/<id>） */
  id: string
  /** 站点名，如「微博」 */
  name: string
  /** 榜单名，如「热搜榜」 */
  board: string
  /** 站点图标，取不到为 null */
  icon: string | null
  /** 榜单条目（分类页每张卡最多约 100 条，卡片内滚动展示） */
  items: NewsItem[]
}

/** 分类页「热门榜单」下的子分类（对应 /c/<key>?q=<q>） */
export interface NewsSubCategory {
  label: string
  q: string
}

/** 一级分类页：一页 12 个榜单卡片 */
export interface NewsFeedResponse {
  ok: boolean
  category?: string
  /** 当前请求的子分类 q，空串表示全部分类 */
  query?: string
  /** 当前页码（站点参数 p，从 1 开始） */
  page?: number
  /** 站点分页器给出的总页数 */
  totalPages?: number
  /** 该一级分类下的子分类（热搜 / 滚动新闻 / 微信…） */
  subs?: NewsSubCategory[]
  cards?: NewsNodeCard[]
  /** 分类页头部的榜单总数（如「综合 490个」） */
  total?: number
  fetchedAt?: number
  /** 分类页被站点拦截时，用首页对应分区兜底（无分页、卡片较少） */
  fallback?: boolean
  error?: string
}

export interface NewsNodeDetail {
  id: string
  /** 榜单完整标题，如「微博热搜榜」 */
  title: string
  /** 站点自己的更新文案，如「2分钟前更新」 */
  updated: string
  fetchedAt: number
  items: NewsItem[]
}

export interface NewsNodeResponse {
  ok: boolean
  detail?: NewsNodeDetail
  error?: string
}

/** 收藏 payload：记录榜单所属分类、子分类、页码与已保存的条目，收藏页直接滚动展示 */
export interface NewsFavPayload {
  category: string
  /** 收藏时所在的子分类 q；空串表示「全部分类」 */
  query: string
  /** 收藏时所在的分类页，刷新时优先重取这一页 */
  page: number
  nodeId: string
  name: string
  board: string
  icon: string | null
  items: NewsItem[]
}

function normalizeFavItems(raw: unknown): NewsItem[] {
  if (!Array.isArray(raw)) return []
  const items: NewsItem[] = []
  for (const entry of raw.slice(0, 120)) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    if (!title) continue
    items.push({
      rank: Number.isFinite(row.rank) ? Number(row.rank) : items.length + 1,
      title,
      extra: typeof row.extra === 'string' ? row.extra : '',
      url: typeof row.url === 'string' && /^https?:\/\//i.test(row.url) ? row.url : null
    })
  }
  return items
}

export function parseNewsFavPayload(raw: string | null): NewsFavPayload | null {
  if (!raw) return null
  try {
    const json = JSON.parse(raw) as Record<string, unknown>
    const nodeId = typeof json.nodeId === 'string' ? json.nodeId : ''
    if (!nodeId) return null
    return {
      category: typeof json.category === 'string' ? json.category : '',
      query: typeof json.query === 'string' ? json.query : '',
      page: typeof json.page === 'number' && json.page >= 1 ? Math.floor(json.page) : 1,
      nodeId,
      name: typeof json.name === 'string' ? json.name : '',
      board: typeof json.board === 'string' ? json.board : '',
      icon: typeof json.icon === 'string' ? json.icon : null,
      items: normalizeFavItems(json.items)
    }
  } catch {
    return null
  }
}
