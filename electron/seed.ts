import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AppData,
  CollectionItem,
  ItemList,
  ListItem,
  VodSource
} from '../src/shared/types'
import { loadData, saveData } from './store'

/**
 * 首次启动的默认数据（与手机端 `DefaultSeed.kt` 同一份资产）：
 * 影视源、表世界清单（含条目与关联）一次性写入。
 *
 * 只在对应数据为空、且从未播种过时写入；用户自己改过的配置一律不覆盖。
 * 资产位置：开发时 `resources/default-seed.json`，打包后 `process.resourcesPath/default-seed.json`。
 */

function markerPath(): string {
  return join(app.getPath('userData'), 'seed-state.json')
}

function assetCandidates(): string[] {
  return [
    join(process.resourcesPath, 'default-seed.json'),
    join(app.getAppPath(), 'resources', 'default-seed.json'),
    join(__dirname, '../../resources/default-seed.json')
  ]
}

async function readSeed(): Promise<Record<string, unknown> | null> {
  for (const file of assetCandidates()) {
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as unknown
      if (raw && typeof raw === 'object') return raw as Record<string, unknown>
    } catch {
      // 继续尝试下一个位置
    }
  }
  return null
}

async function markerDone(): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(markerPath(), 'utf8')) as { done?: boolean }
    return raw?.done === true
  } catch {
    return false
  }
}

async function writeMarker(): Promise<void> {
  const path = markerPath()
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(path, JSON.stringify({ done: true, at: Date.now() }, null, 2), 'utf8')
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function str(o: Record<string, unknown>, key: string, fallback = ''): string {
  const v = o[key]
  return typeof v === 'string' ? v : fallback
}

function num(o: Record<string, unknown>, key: string, fallback = 0): number {
  const v = o[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function nullableStr(o: Record<string, unknown>, key: string): string | null {
  const v = o[key]
  return typeof v === 'string' && v ? v : null
}

function mapVod(value: unknown): VodSource | null {
  const o = obj(value)
  if (!o) return null
  const id = str(o, 'id')
  const baseUrl = str(o, 'baseUrl')
  if (!id || !baseUrl) return null
  const region = str(o, 'region', 'cn') || 'cn'
  return {
    id,
    name: str(o, 'name', id),
    baseUrl,
    enabled: o.enabled !== false,
    region: region === 'proxy' ? 'proxy' : 'cn',
    regionManual: o.regionManual === true,
    testStatus: nullableStr(o, 'testStatus'),
    testMsg: nullableStr(o, 'testMsg'),
    testAt: num(o, 'testAt')
  }
}

function mapItem(value: unknown): CollectionItem | null {
  const o = obj(value)
  if (!o) return null
  const id = num(o, 'id')
  const title = str(o, 'title')
  if (!id || !title) return null
  return {
    id,
    category: str(o, 'category'),
    doubanId: str(o, 'doubanId'),
    title,
    subTitle: str(o, 'subTitle'),
    year: str(o, 'year'),
    doubanRating: typeof o.doubanRating === 'number' ? o.doubanRating : null,
    coverUrl: nullableStr(o, 'coverUrl'),
    summary: str(o, 'summary'),
    info: str(o, 'info'),
    directors: str(o, 'directors'),
    casts: str(o, 'casts'),
    genres: str(o, 'genres'),
    doubanUrl: nullableStr(o, 'doubanUrl'),
    status: str(o, 'status'),
    myRating: num(o, 'myRating'),
    note: str(o, 'note'),
    createdAt: num(o, 'createdAt', Date.now()),
    updatedAt: num(o, 'updatedAt', Date.now())
  }
}

function mapList(value: unknown): ItemList | null {
  const o = obj(value)
  if (!o) return null
  const id = num(o, 'id')
  const name = str(o, 'name')
  if (!id || !name) return null
  return {
    id,
    name,
    description: str(o, 'description'),
    coverUrl: nullableStr(o, 'coverUrl'),
    parentId: typeof o.parentId === 'number' ? o.parentId : null,
    sortIndex: num(o, 'sortIndex'),
    world: num(o, 'world'),
    musicList: o.musicList === true,
    createdAt: num(o, 'createdAt', Date.now())
  }
}

function mapListItems(value: unknown, lists: ItemList[], items: CollectionItem[]): ListItem[] {
  if (!Array.isArray(value)) return []
  const listIds = new Set(lists.map((l) => l.id))
  const itemIds = new Set(items.map((i) => i.id))
  const out: ListItem[] = []
  for (const raw of value) {
    const o = obj(raw)
    if (!o) continue
    const listId = num(o, 'listId')
    const itemId = num(o, 'itemId')
    if (!listIds.has(listId) || !itemIds.has(itemId)) continue
    out.push({ listId, itemId, orderIndex: num(o, 'orderIndex') })
  }
  return out
}

/** 启动时调用：补齐空白的影视源与清单数据，只播种一次 */
export async function seedDefaultData(): Promise<void> {
  if (await markerDone()) return
  const seed = await readSeed()
  if (!seed) {
    console.warn('[seed] 未找到 default-seed.json，跳过默认数据')
    return
  }

  const data: AppData = await loadData()
  let changed = false

  if (data.vodSources.length === 0 && Array.isArray(seed.vodSources)) {
    const sources = seed.vodSources.map(mapVod).filter((s): s is VodSource => !!s)
    if (sources.length) {
      data.vodSources = sources
      changed = true
    }
  }

  if (data.lists.length === 0 && Array.isArray(seed.lists)) {
    const lists = seed.lists.map(mapList).filter((l): l is ItemList => !!l)
    if (lists.length) {
      const items = Array.isArray(seed.items)
        ? seed.items.map(mapItem).filter((i): i is CollectionItem => !!i)
        : []
      data.lists = lists
      data.items = items
      data.listItems = mapListItems(seed.listItems, lists, items)
      changed = true
    }
  }

  if (changed) await saveData(data)
  await writeMarker()
}
