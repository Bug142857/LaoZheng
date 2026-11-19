import { app, dialog, session } from 'electron'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CacheClearResult, CacheDirResult, CacheInfo } from '../src/shared/settings'
import { cacheRoot, downloadRoot, setCacheRoot } from './settings'
import { clearApiCacheMemory, resetApiCacheDiskUsage } from './apiCache'
import { imageCacheDir, invalidateImageCacheSize } from './imageCache'
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
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'blob_storage',
  // 洛雪音源脚本缓存：清理缓存后下次搜索重新下载
  'lx-sources'
]

/** 图片 / 接口缓存目录：跟随设置里的缓存目录 */
const DATA_CACHE_DIRS = ['image-cache', 'api-cache']

export function updatesDir(): string {
  return join(app.getPath('userData'), 'updates')
}

/** 启动时清掉上一次下载的安装包，避免 updates 目录越积越多 */
export async function cleanupUpdatesDir(): Promise<void> {
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

export async function cacheInfo(): Promise<CacheInfo> {
  const imageBytes = await dirSize(imageCacheDir())
  const apiBytes = await dirSize(join(cacheRoot(), 'api-cache'))
  let bytes = imageBytes + apiBytes
  for (const name of USER_DATA_CACHE_DIRS) {
    if (DATA_CACHE_DIRS.includes(name)) continue
    bytes += await dirSize(join(app.getPath('userData'), name))
  }
  bytes += await dirSize(updatesDir())
  const parts = await partFiles(downloadRoot())
  for (const file of parts) bytes += await stat(file).then((s) => s.size).catch(() => 0)
  return { bytes, imageBytes, apiBytes, parts: parts.length, dir: cacheRoot() }
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
    return { ok: true, freed: before.bytes }
  } catch (err) {
    return { ok: false, freed: 0, error: (err as Error).message }
  }
}
