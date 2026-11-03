import { app } from 'electron'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { AppData, EMPTY_DATA, normalizeData, stripNullFields } from '../src/shared/types'

/** 数据文件固定放在 app.getPath('userData') 下，便于备份与排查 */
export function dataFilePath(): string {
  return join(app.getPath('userData'), 'data.json')
}

function cloneEmpty(): AppData {
  return JSON.parse(JSON.stringify(EMPTY_DATA)) as AppData
}

export async function loadData(): Promise<AppData> {
  try {
    const text = await readFile(dataFilePath(), 'utf8')
    return normalizeData(JSON.parse(text))
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

/** 写临时文件再替换，避免写入中断把 data.json 写坏 */
export async function saveData(data: AppData): Promise<void> {
  const target = dataFilePath()
  await mkdir(app.getPath('userData'), { recursive: true })
  const tmp = tempPath(target)
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, target)
}

/** 退出前同步落盘：防止防抖队列里的最后一次修改随窗口关闭一起丢掉 */
export function saveDataSync(data: AppData): void {
  const target = dataFilePath()
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmp = tempPath(target)
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, target)
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
  // 先写临时文件再替换，避免覆盖旧备份时中途失败留下半个文件
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(out, null, 2), 'utf8')
  await rename(tmp, file)
}

function formatNow(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
