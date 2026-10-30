import type { AppData, CollectionItem, InnerFav, ItemList } from '../shared/types'

export function rootLists(data: AppData): ItemList[] {
  return data.lists
    .filter((l) => l.parentId == null)
    .sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt)
}

export function childrenOf(data: AppData, parentId: number): ItemList[] {
  return data.lists
    .filter((l) => l.parentId === parentId)
    .sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt)
}

/** 含所有子清单的 id 集合（用于递归计数与级联删除） */
export function descendantIds(data: AppData, listId: number): Set<number> {
  const ids = new Set<number>([listId])
  let changed = true
  while (changed) {
    changed = false
    for (const l of data.lists) {
      if (l.parentId != null && ids.has(l.parentId) && !ids.has(l.id)) {
        ids.add(l.id)
        changed = true
      }
    }
  }
  return ids
}

export function countItems(data: AppData, listId: number, includeChildren = true): number {
  const ids = includeChildren ? descendantIds(data, listId) : new Set([listId])
  const seen = new Set<number>()
  for (const rel of data.listItems) {
    if (ids.has(rel.listId)) seen.add(rel.itemId)
  }
  return seen.size
}

export function itemsOf(data: AppData, listId: number): CollectionItem[] {
  const rels = data.listItems
    .filter((r) => r.listId === listId)
    .sort((a, b) => a.orderIndex - b.orderIndex)
  const byId = new Map(data.items.map((i) => [i.id, i]))
  return rels.map((r) => byId.get(r.itemId)).filter((i): i is CollectionItem => !!i)
}

export function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.id), 0) + 1
}

/**
 * 清单封面拼图：优先清单自己的 coverUrl，然后按「本清单条目 → 子清单封面 →
 * 子清单条目 → 更深层子清单」的顺序收集，最多 4 张（与手机端内部封面拼图一致）。
 */
export function listCovers(data: AppData, listId: number, limit = 4): string[] {
  const out: string[] = []
  const push = (url: string | null | undefined): void => {
    if (url && !out.includes(url) && out.length < limit) out.push(url)
  }

  /** 条目按新加入的排在前面（orderIndex 越大越新） */
  const newestItems = (id: number): CollectionItem[] => {
    const byId = new Map(data.items.map((i) => [i.id, i]))
    return data.listItems
      .filter((r) => r.listId === id)
      .sort((a, b) => b.orderIndex - a.orderIndex)
      .map((r) => byId.get(r.itemId))
      .filter((i): i is CollectionItem => !!i)
  }

  const list = data.lists.find((l) => l.id === listId)
  push(list?.coverUrl)
  for (const item of newestItems(listId)) push(item.coverUrl)

  const walk = (parentId: number): void => {
    const children = childrenOf(data, parentId).sort((a, b) => b.createdAt - a.createdAt)
    for (const child of children) {
      push(child.coverUrl)
      for (const item of newestItems(child.id)) push(item.coverUrl)
      if (out.length >= limit) return
      walk(child.id)
      if (out.length >= limit) return
    }
  }
  walk(listId)
  return out
}

/** 兼容旧调用：取拼图的第一张 */
export function listCover(data: AppData, listId: number): string | null {
  return listCovers(data, listId, 1)[0] ?? null
}

/** 条目所在清单名（去重）；不在任何清单时返回空数组 */
export function listNamesOfItem(data: AppData, itemId: number): string[] {
  const nameById = new Map(data.lists.map((l) => [l.id, l.name]))
  const names = data.listItems
    .filter((r) => r.itemId === itemId)
    .map((r) => nameById.get(r.listId))
    .filter((n): n is string => !!n)
  return [...new Set(names)]
}

export function formatTime(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* 清单封面配色：与手机端一致的做法，按清单名 hash 稳定取色 */
const TILE_GRADIENTS: [string, string][] = [
  ['#5B8DEF', '#3E63C9'],
  ['#7C6FF0', '#5A48C4'],
  ['#4FBFA1', '#2E9478'],
  ['#F2A65A', '#D0762A'],
  ['#EF6F8E', '#CB4467'],
  ['#54B4D3', '#2F85A3'],
  ['#93B85A', '#6D903C'],
  ['#B08BF2', '#8258D1']
]

export function tileGradient(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  const [a, b] = TILE_GRADIENTS[Math.abs(hash) % TILE_GRADIENTS.length]
  return `linear-gradient(135deg, ${a}, ${b})`
}

export function countFavs(data: AppData): number {
  return data.innerFavs.length
}

export type FavModule = { key: string; label: string }

export const FAV_MODULE_LABELS: Record<string, string> = {
  melon: '吃瓜',
  xsite: 'X站',
  psite: 'P站',
  h1: '番号',
  h2: '本子',
  comic: '漫画',
  tv: '电视',
  music: '音乐',
  watch: '观影',
  book: '图书',
  game: '游戏'
}

export function favModuleLabel(key: string): string {
  return FAV_MODULE_LABELS[key] ?? key
}

export function filterFavs(favs: InnerFav[], query: string): InnerFav[] {
  const q = query.trim().toLowerCase()
  if (!q) return favs
  return favs.filter(
    (f) => f.title.toLowerCase().includes(q) || f.subtitle.toLowerCase().includes(q)
  )
}
