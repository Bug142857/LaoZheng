import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AppData,
  CollectionItem,
  ItemList,
  ListItem,
  VodSource
} from '../src/shared/types'
import {
  mergeDefaultSingingVideos,
  normalizeSingingVideos,
  type SingingVideo
} from '../src/shared/singing'
import { loadData, saveData } from './store'

/**
 * 启动时补齐默认数据（与手机端 `DefaultSeed.kt` 同一份资产）：
 * 影视源、表世界清单只在首次启动且为空时写入；
 * 软件使用经验与演唱默认视频每次启动都按 bvid / 工具 id 合并（用户自己的笔记保留，默认内容随版本更新）。
 *
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

/** 种子文件约 1.2MB：进程内只解析一次，避免启动阶段重复读盘 */
let seedCache: Promise<Record<string, unknown> | null> | null = null

function readSeedCached(): Promise<Record<string, unknown> | null> {
  if (!seedCache) seedCache = readSeed()
  return seedCache
}

interface SeedMarker {
  /** 影视源 / 清单 / 软件经验是否已经播过种 */
  done: boolean
  /** 演唱默认视频是否已经补过（v0.194） */
  singing: boolean
}

async function readMarker(): Promise<SeedMarker> {
  try {
    const raw = JSON.parse(await readFile(markerPath(), 'utf8')) as {
      done?: boolean
      singing?: boolean
    }
    return { done: raw?.done === true, singing: raw?.singing === true }
  } catch {
    return { done: false, singing: false }
  }
}

async function writeMarker(singing: boolean): Promise<void> {
  const path = markerPath()
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(
    path,
    JSON.stringify({ done: true, singing, at: Date.now() }, null, 2),
    'utf8'
  )
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
    // 种子里的影视源都是内置源：不可删除，只能停用
    builtin: true,
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

/** 内置的软件使用经验（新装用户默认带一份，用户自己的笔记优先） */
function mapToolNotes(value: unknown): Record<string, string> | null {
  const o = obj(value)
  if (!o) return null
  const out: Record<string, string> = {}
  for (const [key, html] of Object.entries(o)) {
    if (!key || typeof html !== 'string' || !html.trim()) continue
    out[key] = html
  }
  return Object.keys(out).length ? out : null
}

/** 按种子里的影视源给老数据补 builtin 标记：内置源不可删除，只能停用 */
function markVodSourcesBuiltin(data: AppData, seed: Record<string, unknown> | null): boolean {
  if (!seed || !Array.isArray(seed.vodSources) || !data.vodSources.length) return false
  const presets = seed.vodSources.map(mapVod).filter((s): s is VodSource => !!s)
  if (!presets.length) return false
  let changed = false
  data.vodSources = data.vodSources.map((source) => {
    if (source.builtin) return source
    // 显式 builtin:false 的是用户自定义源，不要覆盖
    if (source.builtin === false) return source
    const builtin = presets.some(
      (preset) => preset.id === source.id || preset.baseUrl === source.baseUrl
    )
    if (!builtin) return source
    changed = true
    return { ...source, builtin: true }
  })
  return changed
}

/** 导入 / 云恢复后给备份里的影视源补 builtin 标记，避免默认源变成可删除 */
export async function markBuiltinVodSources(data: AppData): Promise<boolean> {
  return markVodSourcesBuiltin(data, await readSeedCached())
}

/**
 * 启动第一阶段（开窗前）：只处理首次安装需要的影视源 / 清单播种。
 * 老用户（seed-state 已存在）直接返回，不再解析 1.2MB 的种子文件，缩短首屏时间。
 */
export async function seedDefaultData(): Promise<void> {
  const marker = await readMarker()
  if (marker.done) return
  const seed = await readSeedCached()
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

  await writeMarker(false)
  if (changed) await saveData(data)
}

/**
 * 启动第二阶段（主窗口显示后空闲执行）：标记内置源，并合并软件使用经验与演唱默认视频。
 * 这些数据量最大的部分不再阻塞开窗；失败只记日志，下次启动会再同步。
 */
export async function syncSeedExtras(): Promise<void> {
  const marker = await readMarker()
  const seed = await readSeedCached()
  if (!seed) return
  const data: AppData = await loadData()
  let changed = false

  // 老数据 / 旧版本导出的备份：种子里的影视源统一标记为内置源
  if (markVodSourcesBuiltin(data, seed)) changed = true

  // 软件使用经验：种子里有的工具每次启动都同步（老郑编辑时会把内容写回种子，随版本更新给用户）
  const seedNotes = mapToolNotes(seed.toolNotes)
  if (seedNotes) {
    const current = data.toolNotes ?? {}
    const next = { ...current }
    let notesChanged = false
    for (const [key, html] of Object.entries(seedNotes)) {
      if (next[key] !== html) {
        next[key] = html
        notesChanged = true
      }
    }
    if (notesChanged) {
      data.toolNotes = next
      changed = true
    }
  }

  // 演唱默认视频：缺少的按 bvid 补进来，已存在的强制同步标题与 favAt。
  // 用户端没有改名入口，标题完全由 default-seed.json 维护，老郑改名后所有用户下次启动生效。
  const seedVideos = normalizeSingingVideos(seed.singingVideos)
  if (seedVideos.length) {
    const merged = mergeDefaultSingingVideos(data.singingVideos, seedVideos)
    if (merged.changed) {
      data.singingVideos = merged.videos
      changed = true
    }
  }

  if (changed) await saveData(data)
  if (!marker.singing) await writeMarker(true)
}

/** 种子写回串行化 + 原子替换：避免并发写交错，或写到一半把随版本下发的种子截断 */
let seedWriteChain: Promise<unknown> = Promise.resolve()

function enqueueSeedWrite<T>(task: () => Promise<T>): Promise<T> {
  const result = seedWriteChain.catch(() => undefined).then(task)
  seedWriteChain = result.catch(() => undefined)
  return result
}

async function writeSeedFile(file: string, data: Record<string, unknown>): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

/**
 * 老郑在应用里保存软件经验时，把内容写回种子文件：
 * 下次发版后新装 / 升级用户就能拿到这份默认经验。资源目录只读时静默失败。
 */
export function saveDefaultToolNote(toolId: string, html: string): Promise<boolean> {
  return enqueueSeedWrite(async () => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(toolId) || html.length > 5_000_000) return false
    for (const file of assetCandidates()) {
      try {
        const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
        if (!raw || typeof raw !== 'object') continue
        const notes = { ...(obj(raw.toolNotes) ?? {}) }
        if (html.trim()) notes[toolId] = html
        else delete notes[toolId]
        raw.toolNotes = notes
        await writeSeedFile(file, raw)
        seedCache = null
        return true
      } catch {
        // 当前候选文件不存在或不可写，继续尝试下一个
      }
    }
    return false
  })
}

/** 老郑在设置里添加演唱视频时，把条目写回种子文件，随下个版本带给用户 */
export function saveSingingVideoDefault(video: unknown): Promise<boolean> {
  return enqueueSeedWrite(async () => {
    const [clean] = normalizeSingingVideos([video])
    if (!clean) return false
    const entry: SingingVideo = { ...clean, favAt: clean.favAt || Date.now() }
    for (const file of assetCandidates()) {
      try {
        const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
        if (!raw || typeof raw !== 'object') continue
        const videos = Array.isArray(raw.singingVideos)
          ? normalizeSingingVideos(raw.singingVideos)
          : []
        const index = videos.findIndex((item) => item.bvid === entry.bvid)
        if (index >= 0) videos[index] = { ...videos[index], ...entry }
        else videos.push(entry)
        raw.singingVideos = videos
        await writeSeedFile(file, raw)
        seedCache = null
        return true
      } catch {
        // 当前候选文件不存在或不可写，继续尝试下一个
      }
    }
    return false
  })
}
