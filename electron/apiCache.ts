import { app } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 接口响应磁盘缓存：列表 / 详情这类可重建的数据落 userData/api-cache。
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
const memory = new Map<string, CacheEntry<unknown>>()
/** 正在后台刷新的 key，避免同一接口被并发重复请求 */
const refreshing = new Set<string>()

function dirOf(): string {
  return join(app.getPath('userData'), 'api-cache')
}

function fileOf(key: string): string {
  return join(dirOf(), `${createHash('sha1').update(key).digest('hex')}.json`)
}

function remember<T>(key: string, entry: CacheEntry<T>): void {
  if (memory.size >= MEMORY_LIMIT) {
    const oldest = memory.keys().next().value
    if (oldest) memory.delete(oldest)
  }
  memory.set(key, entry as CacheEntry<unknown>)
}

function isFailure(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const o = value as {
    ok?: unknown
    partial?: unknown
    detail?: { partial?: unknown }
    person?: { partial?: unknown }
  }
  if (o.ok === false) return true
  // 次要数据超时 / 作品列表没拿到：不要把这个残缺结果缓存一周
  return o.partial === true || o.detail?.partial === true || o.person?.partial === true
}

async function store<T>(key: string, value: T): Promise<void> {
  const entry: CacheEntry<T> = { at: Date.now(), value }
  remember(key, entry)
  try {
    await mkdir(dirOf(), { recursive: true })
    const target = fileOf(key)
    const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
    await writeFile(tmp, JSON.stringify(entry), 'utf8')
    await rename(tmp, target)
  } catch {
    // 缓存写入失败不影响正常返回
  }
}

/** 后台刷新：无论成功失败都不影响本次返回，失败时保留旧缓存 */
async function revalidate<T>(key: string, load: () => Promise<T>): Promise<void> {
  if (refreshing.has(key)) return
  refreshing.add(key)
  try {
    const value = await load()
    if (!isFailure(value)) await store(key, value)
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
  try {
    const value = await load()
    if (!isFailure(value)) await store(key, value)
    return value
  } catch {
    return stale
  } finally {
    refreshing.delete(key)
  }
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
  const hit = memory.get(key)
  if (hit) {
    const age = now - hit.at
    if (age > maxStaleMs) return refreshNow(key, load, hit.value as T)
    if (age >= ttlMs) void revalidate(key, load)
    return hit.value as T
  }

  try {
    const raw = JSON.parse(await readFile(fileOf(key), 'utf8')) as CacheEntry<T>
    if (raw && typeof raw.at === 'number') {
      remember(key, raw)
      const age = now - raw.at
      if (age > maxStaleMs) return refreshNow(key, load, raw.value)
      if (age >= ttlMs) void revalidate(key, load)
      return raw.value
    }
  } catch {
    // 没有缓存或内容损坏：继续请求
  }

  const value = await load()
  if (!isFailure(value)) void store(key, value)
  return value
}

/** 清理缓存时同步清掉内存，否则删了磁盘还会继续命中旧数据 */
export function clearApiCacheMemory(): void {
  memory.clear()
  refreshing.clear()
}
