import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * 按大小轮转的日志追加：
 * 超过上限时把当前日志改名为 .1（只保留一份旧日志），避免 crash.log / 渲染层错误日志无限增长。
 */

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

export function appendLogSync(
  file: string,
  text: string,
  maxBytes = DEFAULT_MAX_BYTES
): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    if (existsSync(file) && statSync(file).size > maxBytes) {
      const old = `${file}.1`
      rmSync(old, { force: true })
      renameSync(file, old)
    }
    appendFileSync(file, text, 'utf8')
  } catch {
    // 日志失败不影响主流程
  }
}

export async function appendLog(
  file: string,
  text: string,
  maxBytes = DEFAULT_MAX_BYTES
): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true })
    const info = await stat(file).catch(() => null)
    if (info && info.size > maxBytes) {
      const old = `${file}.1`
      await rm(old, { force: true }).catch(() => undefined)
      await rename(file, old).catch(() => undefined)
    }
    await appendFile(file, text, 'utf8')
  } catch {
    // 日志失败不影响主流程
  }
}
