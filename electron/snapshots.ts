import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DataSnapshotInfo } from '../src/shared/types'

/**
 * 覆盖前本地快照：整体导入 / 云恢复会替换本机全部数据，
 * 覆盖前先把当前 data.json 复制到 userData/snapshots，保留最近若干份并提供恢复入口。
 * 快照创建失败时调用方会中止覆盖，避免「确认覆盖等于不可回滚」。
 */

const KEEP = 20
const NAME_PATTERN = /^data-[\d-]+-[a-z0-9-]+\.json$/i

export interface DataSnapshot extends DataSnapshotInfo {}

function snapshotsDir(root: string): string {
  return join(root, 'snapshots')
}

function safeReason(reason: string): string {
  const value = reason
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return value || 'manual'
}

function stamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(
    now.getMinutes()
  )}${p(now.getSeconds())}-${String(now.getMilliseconds()).padStart(3, '0')}`
}

/** 复制当前 data.json 生成快照；复制失败会抛错，调用方据此中止覆盖 */
export async function createDataSnapshot(
  root: string,
  dataFile: string,
  reason: string,
  latestProgress?: Record<string, string>
): Promise<DataSnapshot | null> {
  // data.json 不存在（首次启动 / 上次损坏被移走）时没有可保护的旧数据，
  // 返回 null 视为成功，不能因为复制 ENOENT 就把整体导入 / 云恢复卡死
  const exists = await stat(dataFile).then(
    (info) => info.isFile(),
    () => false
  )
  if (!exists) return null
  const dir = snapshotsDir(root)
  await mkdir(dir, { recursive: true })
  const name = `data-${stamp()}-${safeReason(reason)}.json`
  const target = join(dir, name)
  const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  // 播放 / 阅读进度存在独立文件里，纯观看不会触发整份 data.json 保存，快照可能落后。
  // 这里把主进程内存里的最新进度合进快照，避免恢复快照把最近的观看进度一起回退。
  let merged = false
  if (latestProgress && Object.keys(latestProgress).length) {
    try {
      const raw = JSON.parse(await readFile(dataFile, 'utf8')) as Record<string, unknown>
      const current =
        raw.readProgress && typeof raw.readProgress === 'object' && !Array.isArray(raw.readProgress)
          ? (raw.readProgress as Record<string, string>)
          : {}
      raw.readProgress = { ...current, ...latestProgress }
      await writeFile(tmp, JSON.stringify(raw, null, 2), 'utf8')
      merged = true
    } catch {
      // data.json 解析失败时退回直接复制，保证覆盖前仍有可回滚副本
    }
  }
  // 直接复制文件（不整份读进内存），失败时由调用方中止覆盖
  if (!merged) await copyFile(dataFile, tmp)
  await rename(tmp, target).catch(async (err) => {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw err
  })
  await pruneSnapshots(root)
  const info = await stat(target)
  return { name, createdAt: info.mtimeMs, bytes: info.size, reason: safeReason(reason) }
}

/**
 * 导入 / 云恢复前的完整快照：直接写入备份内容。
 * data.json 里只有基础数据，电视源 / 下载记录 / 磁力源 / 本机设置单独存储，
 * 只复制 data.json 的话，导入覆盖这些数据后无法通过「恢复快照」回滚。
 */
export async function writeDataSnapshot(
  root: string,
  reason: string,
  payload: unknown
): Promise<DataSnapshot> {
  const dir = snapshotsDir(root)
  await mkdir(dir, { recursive: true })
  const name = `data-${stamp()}-${safeReason(reason)}.json`
  const target = join(dir, name)
  const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
    await rename(tmp, target)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
  await pruneSnapshots(root)
  const info = await stat(target)
  return { name, createdAt: info.mtimeMs, bytes: info.size, reason: safeReason(reason) }
}

/** 本地日期（年月日），用于判断今天是否已经自动快照过 */
function dayStamp(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
    date.getDate()
  ).padStart(2, '0')}`
}

/**
 * 每日自动快照：每天最多一份，复用现有快照目录与保留策略。
 * 导入 / 云恢复之外也给普通误删、数据异常留一个可回滚点。
 * buildPayload 提供时写入完整备份（含电视源 / 下载记录 / 磁力源 / 本机设置），
 * 否则只复制 data.json。
 */
export async function ensureDailySnapshot(
  root: string,
  dataFile: string,
  latestProgress?: Record<string, string>,
  buildPayload?: () => Promise<unknown>
): Promise<DataSnapshot | null> {
  try {
    const list = await listDataSnapshots(root)
    const today = dayStamp(Date.now())
    if (list.some((item) => item.reason === 'auto' && dayStamp(item.createdAt) === today)) {
      return null
    }
    if (buildPayload) return await writeDataSnapshot(root, 'auto', await buildPayload())
    return await createDataSnapshot(root, dataFile, 'auto', latestProgress)
  } catch (err) {
    console.error('[snapshot] 每日自动快照失败，跳过本次', err)
    return null
  }
}

/** 列出本地快照（新的在前） */
export async function listDataSnapshots(root: string): Promise<DataSnapshot[]> {
  const dir = snapshotsDir(root)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const out: DataSnapshot[] = []
  for (const name of entries) {
    if (!NAME_PATTERN.test(name)) continue
    try {
      const info = await stat(join(dir, name))
      if (!info.isFile()) continue
      const reason = name.replace(/^data-[\d-]+-/, '').replace(/\.json$/i, '')
      out.push({ name, createdAt: info.mtimeMs, bytes: info.size, reason })
    } catch {
      // 单个快照读取失败不影响其他项
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

/** 读取指定快照内容（只允许 snapshots 目录下的合法文件名） */
export async function readDataSnapshot(root: string, name: string): Promise<string> {
  if (!NAME_PATTERN.test(name)) throw new Error('快照名称无效')
  return readFile(join(snapshotsDir(root), name), 'utf8')
}

/** 只保留最近 KEEP 份，避免长期导入 / 恢复把磁盘占满 */
export async function pruneSnapshots(root: string): Promise<void> {
  const list = await listDataSnapshots(root)
  for (const item of list.slice(KEEP)) {
    await rm(join(snapshotsDir(root), item.name), { force: true }).catch(() => undefined)
  }
}
