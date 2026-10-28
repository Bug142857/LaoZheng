/** 下载管理共用类型（视频 / 音乐 / 其他文件；漫画、书籍等模块接入后复用） */

export type DownloadKind = 'video' | 'music' | 'file'

export interface DownloadItem {
  id: string
  title: string
  kind: DownloadKind
  sourceUrl: string
  /** 可播放地址（本地媒体服务 http 地址） */
  playUrl: string
  /** 展示用相对路径（相对下载根目录） */
  displayPath: string
  sizeBytes: number
  createdAt: number
  coverUrl: string
  sourceName: string
  hls: boolean
}

export interface DownloadTask {
  id: string
  title: string
  kind: DownloadKind
  url: string
  sourceName: string
  coverUrl: string
  state: 'running' | 'failed'
  /** 0..1；-1 表示总量未知 */
  progress: number
  bytes: number
  totalBytes: number
  error?: string
}

export interface DownloadListResponse {
  items: DownloadItem[]
  tasks: DownloadTask[]
  dir: string
}

export interface DownloadAddInput {
  title: string
  url: string
  kind: DownloadKind
  coverUrl?: string
  sourceName?: string
}

export interface DownloadAddResult {
  ok: boolean
  error?: string
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}
