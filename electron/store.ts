import { app } from 'electron'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AppData, EMPTY_DATA, normalizeData, stripNullFields } from '../src/shared/types'

/** 数据文件固定放在 app.getPath('userData') 下，便于备份与排查 */
export function dataFilePath(): string {
  return join(app.getPath('userData'), 'data.json')
}

function cloneEmpty(): AppData {
  return JSON.parse(JSON.stringify(EMPTY_DATA)) as AppData
}

/** 启动阶段 seed + data:load 会各读一次 data.json：按文件内容缓存，避免重复解析 1.2MB */
let cachedDataText: string | null = null
let cachedData: AppData | null = null

export async function loadData(): Promise<AppData> {
  try {
    const text = await readFile(dataFilePath(), 'utf8')
    if (cachedData && cachedDataText === text) return cachedData
    const data = normalizeData(JSON.parse(text))
    cachedDataText = text
    cachedData = data
    return data
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.error('[store] 读取数据失败，使用空数据', err)
      // 文件损坏时先另存一份，避免后续保存把用户原始数据彻底覆盖
      await rename(dataFilePath(), `${dataFilePath()}.broken-${Date.now()}`).catch(() => undefined)
      return cloneEmpty()
    }
    // 首次启动：落一份空数据，方便用户直接找到 data.json 并备份
    const empty = cloneEmpty()
    await saveData(empty)
    return empty
  }
}

/** 临时文件名带随机后缀，避免退出前的同步保存与普通保存互相覆盖 */
function tempPath(target: string): string {
  return `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
}

/**
 * 保存序号：多个保存请求可能乱序完成（例如退出前的同步落盘晚于此前发起的异步保存），
 * 用最后落盘序号保证过期数据不会把更新的数据覆盖回磁盘。
 */
let saveSeq = 0
let lastWrittenSeq = 0

const RENAME_ATTEMPTS = 3
const RENAME_WAIT_MS = 25

/** 退出前的同步保存不能 await，用极短的同步等待做重试 */
function waitSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    // 环境不支持时直接进入下一次重试
  }
}

/** Windows 上杀软 / 网盘可能短暂占用 data.json，rename 失败时快速重试 */
function renameSyncRetry(from: string, to: string): void {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt += 1) {
    try {
      renameSync(from, to)
      return
    } catch (err) {
      lastError = err
      if (attempt < RENAME_ATTEMPTS) waitSync(RENAME_WAIT_MS)
    }
  }
  throw lastError ?? new Error('保存失败')
}

/** 数据文件体积上限（字符数）：超过通常是渲染层写出了异常数据，宁可拒绝也不写坏文件 */
const MAX_DATA_CHARS = 200 * 1024 * 1024

/** 写临时文件再替换，避免写入中断把 data.json 写坏 */
export async function saveData(data: AppData): Promise<void> {
  const seq = ++saveSeq
  const target = dataFilePath()
  const text = JSON.stringify(data, null, 2)
  if (text.length > MAX_DATA_CHARS) throw new Error('数据体积异常，已拒绝写入')
  await mkdir(app.getPath('userData'), { recursive: true })
  const tmp = tempPath(target)
  try {
    await writeFile(tmp, text, 'utf8')
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
  try {
    // 检查序号与 rename 必须在同一个同步临界区：否则退出前的 saveDataSync
    // 可能插在两者之间，随后这次的旧数据会把刚写入的最新数据覆盖掉
    if (lastWrittenSeq > seq) {
      rmSync(tmp, { force: true })
      return
    }
    renameSyncRetry(tmp, target)
    lastWrittenSeq = seq
    cachedDataText = text
    cachedData = data
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

/** 退出前同步落盘：防止防抖队列里的最后一次修改随窗口关闭一起丢掉 */
export function saveDataSync(data: AppData): void {
  const seq = ++saveSeq
  const target = dataFilePath()
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmp = tempPath(target)
  const text = JSON.stringify(data, null, 2)
  writeFileSync(tmp, text, 'utf8')
  try {
    renameSyncRetry(tmp, target)
    lastWrittenSeq = seq
    cachedDataText = text
    cachedData = data
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

/** 通用 JSON 原子写入：先写临时文件再替换，失败时清掉残留 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = tempPath(file)
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    await rename(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
}

/** 从手机端导出的 JSON 读取（格式 version 1，必须有 items / lists / listItems） */
export async function importFromFile(file: string): Promise<AppData> {
  // 有些编辑器保存 UTF-8 JSON 时会带 BOM，先去掉再解析
  const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '')
  const raw = JSON.parse(text) as Record<string, unknown>
  // 必须是数组而不是仅存在同名字段，避免误选普通 JSON 后把数据清空
  if (!Array.isArray(raw.items) || !Array.isArray(raw.lists) || !Array.isArray(raw.listItems)) {
    throw new Error('不是有效的备份文件（items / lists / listItems 必须是数组）')
  }
  return normalizeData(raw)
}

/** 导出为手机端可识别的 JSON（字段与 Android ExportJson.kt 一致） */
export async function exportToFile(file: string, data: AppData): Promise<void> {
  // 手机端 org.json 的 optString 会把 null 读成 "null"，导出前统一去掉 null 字段
  const out: AppData = stripNullFields({
    ...data,
    version: 1,
    exportAt: formatNow()
  })
  await writeJsonAtomic(file, out)
}

function formatNow(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
