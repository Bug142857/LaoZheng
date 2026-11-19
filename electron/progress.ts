import { app } from 'electron'
import { join } from 'node:path'
import { ProgressStore } from './progressStore'

/** 播放 / 阅读进度单例：主进程与 IPC 共用同一份内存状态 */
let progressStore: ProgressStore | null = null

export function progress(): ProgressStore {
  if (!progressStore) {
    progressStore = new ProgressStore(join(app.getPath('userData'), 'read-progress.json'))
  }
  return progressStore
}

export function flushProgressSync(): void {
  progressStore?.flushSync()
}
