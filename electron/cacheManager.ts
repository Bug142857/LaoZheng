import { app, dialog, session } from 'electron'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CacheClearResult, CacheDirResult, CacheInfo } from '../src/shared/settings'
import { cacheRoot, downloadRoot, setCacheRoot } from './settings'
import { clearApiCacheMemory, resetApiCacheDiskUsage } from './apiCache'
import { imageCacheBytes, invalidateImageCacheSize } from './imageCache'
import { clearLxSourceCache } from './lxSource'
import { hasRunningDownloads } from './downloads'

/**
 * 缓存管理（从 main.ts 拆出）：
 * 统计 / 清理图片、接口、Chromium 网络缓存与下载临时文件，以及更换缓存目录。
 * 清理只影响缓存，不动收藏、清单、阅读进度和各站登录态。
 */

/** Electron 网络 / 代码缓存目录（固定放 userData，不动 Local Storage，避免清掉网页登录态） */
const USER_DATA_CACHE_DIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'GrShaderCache',
  'ShaderCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'blob_storage',
  // 洛雪音源脚本缓存：清理缓存后下次搜索重新下载
  'lx-sources'
]

/** 图片 / 接口缓存目录：跟随设置里的缓存目录 */
const DATA_CACHE_DIRS = ['image-cache', 'api-cache']

/**
 * Chromium persist:* 分区（直播 / 模拟器 / 磁力 / 豆瓣 / Z-Library 等）的缓存子目录。
 * 只清这些目录，保留 Network（Cookie）、Local Storage、IndexedDB（模拟器存档）等登录 / 用户数据。
 */
const PARTITION_CACHE_SUBDIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache'
]

/** 设置页短时间内重复打开时复用上次统计结果，避免每次全量 stat */
const CACHE_INFO_TTL_MS = 10_000
let cacheInfoCache: { at: number; dir: string; value: CacheInfo } | null = null

function cacheInfoDirty(): void {
  cacheInfoCache = null
}

export function updatesDir(): string {
  return join(app.getPath('userData'), 'updates')
}

/**
 * 更新安装包下载中（含暂停等待）：updates 目录里是正在写的 .part，
 * 此时清理缓存不能删，否则更新下载会被打断。
 * updateManager 在下载开始 / 结束时设置，避免 cacheManager 反向依赖它。
 */
let updatesDownloadActive = false

export function setUpdatesDownloadActive(active: boolean): void {
  updatesDownloadActive = active
}

/** 启动时清掉上一次下载的安装包，避免 updates 目录越积越多 */
export async function cleanupUpdatesDir(): Promise<void> {
  if (updatesDownloadActive) return
  const dir = updatesDir()
  try {
    for (const name of await readdir(dir)) {
      await rm(join(dir, name), { recursive: true, force: true }).catch(() => undefined)
    }
  } catch {
    // 目录不存在时无需处理
  }
}

export async function dirSize(dir: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) total += await dirSize(full)
    else if (entry.isFile()) total += await stat(full).then((s) => s.size).catch(() => 0)
  }
  return total
}

/** 下载目录里未完成的 .part 临时文件（中断下载的残留） */
async function partFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await partFiles(full)))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.part')) out.push(full)
  }
  return out
}

/** 所有 persist:* 分区的缓存子目录（不包含 Cookie / Local Storage / IndexedDB） */
async function partitionCacheDirs(): Promise<string[]> {
  const root = join(app.getPath('userData'), 'Partitions')
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const dirs: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    for (const sub of PARTITION_CACHE_SUBDIRS) {
      const dir = join(root, entry.name, sub)
      const exists = await stat(dir).then(
        (info) => info.isDirectory(),
        () => false
      )
      if (exists) dirs.push(dir)
    }
  }
  return dirs
}

export async function cacheInfo(): Promise<CacheInfo> {
  const dir = cacheRoot()
  if (
    cacheInfoCache &&
    cacheInfoCache.dir === dir &&
    Date.now() - cacheInfoCache.at < CACHE_INFO_TTL_MS
  ) {
    return cacheInfoCache.value
  }
  // 图片缓存已有增量统计，直接复用；其余目录并行统计，缩短设置页等待
  const [imageBytes, apiBytes, partitionDirs, parts] = await Promise.all([
    imageCacheBytes(),
    dirSize(join(dir, 'api-cache')),
    partitionCacheDirs(),
    partFiles(downloadRoot())
  ])
  const [dataBytes, partitionBytes, updatesBytes, partBytes] = await Promise.all([
    (async () => {
      let total = 0
      for (const name of USER_DATA_CACHE_DIRS) {
        if (DATA_CACHE_DIRS.includes(name)) continue
        total += await dirSize(join(app.getPath('userData'), name))
      }
      return total
    })(),
    (async () => {
      let total = 0
      for (const path of partitionDirs) total += await dirSize(path)
      return total
    })(),
    dirSize(updatesDir()),
    (async () => {
      let total = 0
      for (const file of parts) total += await stat(file).then((s) => s.size).catch(() => 0)
      return total
    })()
  ])
  const bytes = imageBytes + apiBytes + dataBytes + partitionBytes + updatesBytes + partBytes
  const value: CacheInfo = {
    bytes,
    imageBytes,
    apiBytes,
    partitionBytes,
    parts: parts.length,
    dir
  }
  cacheInfoCache = { at: Date.now(), dir, value }
  return value
}

/** 清空各 persist:* 分区的 HTTP / Code Cache；Cookie、Local Storage、IndexedDB 保持不动 */
async function clearPartitionCaches(): Promise<void> {
  const root = join(app.getPath('userData'), 'Partitions')
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const ses = session.fromPartition(`persist:${entry.name}`)
    await ses.clearCache().catch(() => undefined)
    await ses.clearCodeCaches({}).catch(() => undefined)
  }
}

/** 清掉指定根目录下的图片 / 接口缓存 */
async function clearDataCache(root: string): Promise<number> {
  let freed = 0
  for (const name of DATA_CACHE_DIRS) {
    const dir = join(root, name)
    freed += await dirSize(dir)
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
  invalidateImageCacheSize()
  resetApiCacheDiskUsage()
  return freed
}

/** 更换缓存目录：先验证新目录可用，再清空旧目录缓存并切换 */
export async function chooseCacheDir(): Promise<CacheDirResult> {
  const picked = await dialog.showOpenDialog({
    title: '选择缓存目录',
    defaultPath: cacheRoot(),
    properties: ['openDirectory', 'createDirectory']
  })
  if (picked.canceled || !picked.filePaths[0]) return { canceled: true }
  const next = picked.filePaths[0]
  const current = cacheRoot()
  const same = resolve(next).toLowerCase() === resolve(current).toLowerCase()
  try {
    // 先在新目录建好子目录：不可写时直接报错，避免旧缓存已经清掉却切换失败
    await mkdir(join(next, 'image-cache'), { recursive: true })
    await mkdir(join(next, 'api-cache'), { recursive: true })
    if (same) return { canceled: false, dir: current, freed: 0 }
    // 先清内存并递增缓存代次，再进行磁盘删除：
    // 否则删除期间返回的旧请求会把刚删掉的缓存写回旧目录
    clearApiCacheMemory()
    const freed = await clearDataCache(current)
    const dir = await setCacheRoot(next)
    cacheInfoDirty()
    return { canceled: false, dir, freed }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/** 清理缓存：图片 / 网络缓存、已下载的更新安装包、下载临时文件；不影响收藏、清单、登录态 */
export async function clearCache(): Promise<CacheClearResult> {
  try {
    const before = await cacheInfo()
    // 先清内存副本并递增缓存代次，避免清理过程中返回的旧请求把缓存写回
    clearApiCacheMemory()
    await session.defaultSession.clearCache()
    for (const name of USER_DATA_CACHE_DIRS) {
      await rm(join(app.getPath('userData'), name), { recursive: true, force: true }).catch(
        () => undefined
      )
    }
    // 直播 / 模拟器 / 磁力等 persist:* 分区的缓存不在 defaultSession 下，单独清
    await clearPartitionCaches()
    await clearDataCache(cacheRoot())
    // 洛雪音源脚本已加载进内存：一并丢弃，避免仅删磁盘后仍继续用旧脚本
    clearLxSourceCache()
    await cleanupUpdatesDir()
    // 有下载任务在跑时不能删 .part，否则正在写入的文件会被直接删掉
    if (!hasRunningDownloads()) {
      for (const file of await partFiles(downloadRoot())) {
        await rm(file, { force: true }).catch(() => undefined)
      }
    }
    cacheInfoDirty()
    return { ok: true, freed: before.bytes }
  } catch (err) {
    return { ok: false, freed: 0, error: (err as Error).message }
  }
}
