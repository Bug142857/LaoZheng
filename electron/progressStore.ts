import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'

/**
 * 播放 / 阅读进度的独立存储。
 * 以前进度写在 data.json 里，播放时每 8 秒就会序列化并重写约 1.2MB 的整份数据；
 * 现在渲染层只提交 key + seconds，主进程在内存里立即更新、磁盘按窗口批量写入，
 * 退出 / 暂停 / 切集时再强制刷新。进度仍会合并进备份与云同步，不形成数据孤岛。
 */

const KEY_MAX = 500
const VALUE_MAX = 500
const MAX_ENTRIES = 5000
const WRITE_DELAY_MS = 800

export function normalizeProgressEntry(
  rawKey: unknown,
  rawValue: unknown
): { key: string; value: string } | null {
  if (typeof rawKey !== 'string') return null
  const key = rawKey.trim()
  if (!key || key.length > KEY_MAX) return null
  if (typeof rawValue !== 'string' && typeof rawValue !== 'number') return null
  const value = String(rawValue).trim()
  if (!value || value.length > VALUE_MAX) return null
  return { key, value }
}

function normalizeRecord(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  let count = 0
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = normalizeProgressEntry(key, value)
    if (!entry) continue
    out[entry.key] = entry.value
    count += 1
    if (count >= MAX_ENTRIES) break
  }
  return out
}

function tempPath(target: string): string {
  return `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
}

export class ProgressStore {
  private values: Record<string, string> | null = null
  private loading: Promise<Record<string, string>> | null = null
  private timer: NodeJS.Timeout | null = null
  private writeChain: Promise<void> = Promise.resolve()
  /** 同步落盘代次：退出前的同步写会让仍在途的异步写失效，避免旧进度覆盖新进度 */
  private syncEpoch = 0

  constructor(private readonly filePath: string) {}

  async load(): Promise<Record<string, string>> {
    if (this.values) return this.values
    if (!this.loading) {
      this.loading = readFile(this.filePath, 'utf8')
        .then((text) => normalizeRecord(JSON.parse(text)))
        .catch(() => ({}))
        .then((value) => {
          this.values = value
          return value
        })
    }
    return this.loading
  }

  /** 当前内存中的进度快照（用于备份 / 云同步合并） */
  peek(): Record<string, string> {
    return this.values ? { ...this.values } : {}
  }

  async set(key: string, value: string | number): Promise<void> {
    const entry = normalizeProgressEntry(key, value)
    if (!entry) return
    await this.load()
    if (!this.values) this.values = {}
    // 达到上限时丢掉最早写入的一条，避免异常数据把文件撑大
    if (!(entry.key in this.values) && Object.keys(this.values).length >= MAX_ENTRIES) {
      const first = Object.keys(this.values)[0]
      if (first) delete this.values[first]
    }
    this.values[entry.key] = entry.value
    this.schedule()
  }

  /** 导入 / 云恢复：整体替换进度并立即落盘 */
  async replaceAll(raw: unknown): Promise<void> {
    this.values = normalizeRecord(raw)
    this.loading = Promise.resolve(this.values)
    await this.flush()
  }

  /** 把内存进度写入磁盘；多次调用串行执行，避免旧数据覆盖新数据 */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const snapshot = this.peek()
    const epoch = this.syncEpoch
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => this.write(snapshot, epoch))
      .catch((err) => console.error('[progress] 写入进度失败', err))
    return this.writeChain
  }

  /** 退出前同步落盘：不能 await，用同步写保证最后一次进度不丢 */
  flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.values) return
    // 代次递增：仍在途的异步写完成后会发现自己已过期，不会把旧进度覆盖回来
    this.syncEpoch += 1
    const target = this.filePath
    const tmp = tempPath(target)
    try {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(tmp, JSON.stringify(this.values, null, 2), 'utf8')
      renameSync(tmp, target)
    } catch (err) {
      console.error('[progress] 退出前写入进度失败', err)
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, WRITE_DELAY_MS)
    this.timer.unref?.()
  }

  private async write(value: Record<string, string>, epoch: number): Promise<void> {
    const target = this.filePath
    await mkdir(dirname(target), { recursive: true })
    const tmp = tempPath(target)
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    if (epoch !== this.syncEpoch) {
      // 退出前的同步落盘已经写了更新的数据，这次异步写直接丢弃
      await rm(tmp, { force: true }).catch(() => undefined)
      return
    }
    await rename(tmp, target).catch(async (err) => {
      await rm(tmp, { force: true }).catch(() => undefined)
      throw err
    })
    // 极端顺序：检查代次之后、rename 完成之前插入了同步落盘，本次 rename 可能把
    // 同步写入的最新进度盖回旧值；发现代次过期就再同步补写一次当前内存值
    if (epoch !== this.syncEpoch) this.flushSync()
  }
}
