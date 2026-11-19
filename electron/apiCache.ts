import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cacheRoot } from './settings'

/**
 * 接口响应磁盘缓存：列表 / 详情这类可重建的数据落 <cacheRoot>/api-cache
 * （cacheRoot 默认 userData，可在设置里更换）。
 *
 * 策略（2026-10-30 用户要求「不要每次都重新加载，除非手动清了缓存」）：
 * - 只要磁盘里有缓存，就先返回上次结果，页面永远不出现加载态；
 * - ttlMs 变成「静默刷新间隔」：超过间隔时后台重新请求一次，成功后覆盖缓存，
 *   但本次调用仍立即返回旧数据，不阻塞界面；
 * - 只有用户主动「清理缓存」才真正删除缓存文件与内存。
 * 只缓存成功响应（ok !== false），失败结果照常返回但不落盘。
 */

interface CacheEntry<T> {
  at: number
  value: T
}

const MEMORY_LIMIT = 400
/**
 * 接口缓存磁盘上限（1GB）+ LRU 淘汰：
 * 以前只写不删，长期使用会无限增长；超过上限后按文件修改时间从旧到新淘汰，
 * 10 分钟内写过的文件跳过，避免删掉正在读取的缓存。
 */
const DISK_LIMIT_BYTES = 1024 ** 3
const DISK_TRIM_RATIO = 0.9
const DISK_MIN_EVICT_AGE_MS = 10 * 60_000
const memory = new Map<string, CacheEntry<unknown>>()
/** 正在后台刷新的 key，避免同一接口被并发重复请求 */
const refreshing = new Set<string>()
/** 冷启动并发请求同一 key 时共用同一个 Promise，避免首屏重复打同一接口 */
const inflight = new Map<string, Promise<unknown>>()
/** 用户主动刷新时的临时绕过前缀：窗口期内命中的 key 直接重新请求 */
const forced = new Map<string, number>()
const FORCE_WINDOW_MS = 8_000
/**
 * 缓存代次：导入 / 云恢复 / 清理缓存时递增。
 * 清理前发出的请求可能晚于清理才返回，不带代次校验会把旧结果重新写回内存和磁盘。
 */
let epoch = 0
/** 接口缓存磁盘占用估算：写入时累加，淘汰时重新扫描校正 */
let diskBytes = 0
/** 启动后第一次写入时扫描一次已有缓存，避免历史超大目录一直不触发淘汰 */
let diskScanned = false
let trimRunning = false
let trimAgain = false

/** 标记一批 key 前缀，在接下来几秒内跳过旧缓存、直接取最新数据（刷新按钮 / 点标题用） */
export function forceApiCache(prefixes: string[]): void {
  const until = Date.now() + FORCE_WINDOW_MS
  for (const prefix of prefixes) {
    const key = prefix.trim()
    if (key) forced.set(key, until)
  }
}

function isForced(key: string): boolean {
  if (!forced.size) return false
  const now = Date.now()
  let matched = false
  for (const [prefix, until] of forced) {
    if (until <= now) {
      forced.delete(prefix)
      continue
    }
    if (key.startsWith(prefix)) matched = true
  }
  return matched
}

function dirOf(): string {
  return join(cacheRoot(), 'api-cache')
}

function fileOf(key: string): string {
  return join(dirOf(), `${createHash('sha1').update(key).digest('hex')}.json`)
}

interface DiskCacheFile {
  path: string
  size: number
  mtimeMs: number
}

async function listDiskCacheFiles(): Promise<DiskCacheFile[]> {
  let names: string[]
  try {
    names = await readdir(dirOf())
  } catch {
    return []
  }
  const out: DiskCacheFile[] = []
  for (const name of names) {
    const path = join(dirOf(), name)
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) continue
    out.push({ path, size: info.size, mtimeMs: info.mtimeMs })
  }
  return out
}

/** 淘汰到上限的 90%：按修改时间从旧到新删，刚写过的文件不动 */
async function trimDiskCache(): Promise<void> {
  const files = await listDiskCacheFiles()
  const now = Date.now()
  let total = 0
  const candidates: DiskCacheFile[] = []
  for (const file of files) {
    total += file.size
    const isTmp = file.path.endsWith('.tmp')
    if (isTmp) {
      // 写入中断留下的临时文件：超过 1 小时直接清掉
      if (now - file.mtimeMs > 60 * 60_000) {
        await unlink(file.path).catch(() => undefined)
        total -= file.size
      }
      continue
    }
    if (file.path.endsWith('.json') && now - file.mtimeMs > DISK_MIN_EVICT_AGE_MS) {
      candidates.push(file)
    }
  }
  diskBytes = total
  if (total <= DISK_LIMIT_BYTES) return
  candidates.sort((a, b) => a.mtimeMs - b.mtimeMs)
  const target = DISK_LIMIT_BYTES * DISK_TRIM_RATIO
  for (const file of candidates) {
    if (total <= target) break
    try {
      await unlink(file.path)
      total -= file.size
    } catch {
      // 文件正被占用 / 已删除：跳过，不影响其他缓存
    }
  }
  diskBytes = total
}

function scheduleDiskTrim(): void {
  if (trimRunning) {
    trimAgain = true
    return
  }
  trimRunning = true
  void trimDiskCache()
    .catch(() => undefined)
    .finally(() => {
      trimRunning = false
      if (trimAgain) {
        trimAgain = false
        if (diskBytes > DISK_LIMIT_BYTES) scheduleDiskTrim()
      }
    })
}

/** 缓存目录被整体清理 / 切换后重置磁盘占用估算 */
export function resetApiCacheDiskUsage(): void {
  diskBytes = 0
  diskScanned = false
}

function remember<T>(key: string, entry: CacheEntry<T>): void {
  if (memory.size >= MEMORY_LIMIT) {
    const oldest = memory.keys().next().value
    if (oldest) memory.delete(oldest)
  }
  memory.set(key, entry as CacheEntry<unknown>)
}

/** 同一 key 的并发加载只请求一次 */
function loadOnce<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>
  const promise = load().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key)
  })
  inflight.set(key, promise as Promise<unknown>)
  return promise
}

function isFailure(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const o = value as {
    ok?: unknown
    partial?: unknown
    error?: unknown
    detail?: { partial?: unknown }
    person?: { partial?: unknown }
  }
  if (o.ok === false) return true
  // 电视源这类结果没有 ok 字段，失败时只在 error 里带原因：
  // 不当作失败的话会把「网络加载失败」缓存 10 分钟，用户点重试也仍然命中旧错误
  if (o.ok === undefined && typeof o.error === 'string' && o.error.trim()) return true
  // 次要数据超时 / 作品列表没拿到：不要把这个残缺结果缓存一周
  return o.partial === true || o.detail?.partial === true || o.person?.partial === true
}

async function store<T>(key: string, value: T, at: number): Promise<void> {
  // 请求发出后缓存被清理过：这次结果相对新数据已经过期，不再写回
  if (at !== epoch) return
  const entry: CacheEntry<T> = { at: Date.now(), value }
  remember(key, entry)
  const text = JSON.stringify(entry)
  try {
    await mkdir(dirOf(), { recursive: true })
    const target = fileOf(key)
    const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, target)
    diskBytes += Buffer.byteLength(text, 'utf8')
    if (!diskScanned) {
      diskScanned = true
      scheduleDiskTrim()
    } else if (diskBytes > DISK_LIMIT_BYTES) {
      scheduleDiskTrim()
    }
  } catch {
    // 缓存写入失败不影响正常返回
  }
}

/** 后台刷新：无论成功失败都不影响本次返回，失败时保留旧缓存 */
async function revalidate<T>(key: string, load: () => Promise<T>): Promise<void> {
  if (refreshing.has(key)) return
  refreshing.add(key)
  const at = epoch
  try {
    const value = await load()
    if (!isFailure(value)) await store(key, value, at)
  } catch {
    // 后台刷新失败：继续使用旧缓存
  } finally {
    refreshing.delete(key)
  }
}

/** 超过 maxStaleMs 仍拿不到新数据时，退回旧缓存，避免页面直接空白 */
async function refreshNow<T>(key: string, load: () => Promise<T>, stale: T): Promise<T> {
  if (refreshing.has(key)) return stale
  refreshing.add(key)
  const at = epoch
  try {
    const value = await load()
    if (!isFailure(value)) {
      await store(key, value, at)
      return value
    }
    // 刷新拿到的是失败结果：仍退回旧缓存，避免断网后页面直接空白
    return stale
  } catch {
    return stale
  } finally {
    refreshing.delete(key)
  }
}

async function readCached<T>(key: string): Promise<T | null> {
  const hit = memory.get(key)
  if (hit && hit.value !== undefined) return hit.value as T
  try {
    const raw = JSON.parse(await readFile(fileOf(key), 'utf8')) as CacheEntry<T>
    if (raw && typeof raw.at === 'number' && 'value' in raw && raw.value !== undefined) {
      remember(key, raw)
      return raw.value
    }
  } catch {
    // 没有缓存或内容损坏
  }
  return null
}

/**
 * @param ttlMs     静默刷新间隔：超过后后台更新，本次仍立即返回旧数据
 * @param maxStaleMs 最长可容忍的旧数据（带播放直链的接口用）：超过后先刷新再返回，
 *                   刷新失败仍退回旧缓存
 */
export async function cachedResponse<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  maxStaleMs = Number.POSITIVE_INFINITY
): Promise<T> {
  const now = Date.now()
  // 本次请求开始时的代次：加载期间缓存被清理过就不再写回
  const at = epoch
  // 用户刚点了刷新：这次必须拿新数据，失败时才退回旧缓存
  if (isForced(key)) {
    try {
      const value = await loadOnce(key, load)
      if (!isFailure(value)) {
        await store(key, value, at)
        return value
      }
      // 接口正常返回了失败结果（断网 / 源站限流）：退回旧缓存，避免页面直接变空
      const cached = await readCached<T>(key)
      return cached !== null ? cached : value
    } catch (err) {
      const cached = await readCached<T>(key)
      if (cached !== null) return cached
      throw err
    }
  }
  const hit = memory.get(key)
  if (hit) {
    const age = now - hit.at
    if (age > maxStaleMs) return refreshNow(key, load, hit.value as T)
    if (age >= ttlMs) void revalidate(key, load)
    return hit.value as T
  }

  try {
    const raw = JSON.parse(await readFile(fileOf(key), 'utf8')) as CacheEntry<T>
    // 缓存文件可能被截断或手工改坏：value 缺失时按未命中处理，避免把 undefined 返回给页面
    if (raw && typeof raw.at === 'number' && 'value' in raw && raw.value !== undefined) {
      remember(key, raw)
      const age = now - raw.at
      if (age > maxStaleMs) return refreshNow(key, load, raw.value)
      if (age >= ttlMs) void revalidate(key, load)
      return raw.value
    }
  } catch {
    // 没有缓存或内容损坏：继续请求
  }

  const value = await loadOnce(key, load)
  if (!isFailure(value)) void store(key, value, at)
  return value
}

/** 清理缓存时同步清掉内存，否则删了磁盘还会继续命中旧数据 */
export function clearApiCacheMemory(): void {
  // 递增代次：清理前发出的请求返回后不能再把旧结果写回缓存
  epoch += 1
  memory.clear()
  refreshing.clear()
  forced.clear()
  inflight.clear()
}

/** 导入备份 / 云恢复后清掉接口缓存：避免页面继续显示导入前的列表；图片缓存不动 */
export async function clearApiCache(): Promise<void> {
  clearApiCacheMemory()
  await rm(dirOf(), { recursive: true, force: true }).catch(() => undefined)
  resetApiCacheDiskUsage()
}
