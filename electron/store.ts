import { app } from 'electron'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { AppData, EMPTY_DATA, normalizeData } from '../src/shared/types'

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
      return cloneEmpty()
    }
    // 首次启动：落一份空数据，方便用户直接找到 data.json 并备份
    const empty = cloneEmpty()
    await saveData(empty)
    return empty
  }
}

/** 写临时文件再替换，避免写入中断把 data.json 写坏 */
export async function saveData(data: AppData): Promise<void> {
  const target = dataFilePath()
  await mkdir(app.getPath('userData'), { recursive: true })
  const tmp = `${target}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, target)
}

/** 从手机端导出的 JSON 读取（格式 version 1，必须有 items / lists / listItems） */
export async function importFromFile(file: string): Promise<AppData> {
  const text = await readFile(file, 'utf8')
  const raw = JSON.parse(text) as Record<string, unknown>
  if (!('items' in raw) || !('lists' in raw) || !('listItems' in raw)) {
    throw new Error('不是有效的备份文件（缺少 items / lists / listItems）')
  }
  return normalizeData(raw)
}

/** 导出为手机端可识别的 JSON（字段与 Android ExportJson.kt 一致） */
export async function exportToFile(file: string, data: AppData): Promise<void> {
  const out: AppData = {
    ...data,
    version: 1,
    exportAt: formatNow()
  }
  await writeFile(file, JSON.stringify(out, null, 2), 'utf8')
}

function formatNow(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
