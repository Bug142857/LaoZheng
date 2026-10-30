/** 下载管理共用类型（视频 / 音乐 / 漫画 / 图书 / 其他文件） */

export type DownloadKind = 'video' | 'music' | 'comic' | 'book' | 'file'

/** 落盘保存的下载记录（不含每次启动临时生成的 playUrl），也是备份 JSON 的一部分 */
export interface DownloadRecord {
  id: string
  title: string
  kind: DownloadKind
  sourceUrl: string
  /** 相对下载根目录的路径 */
  playPath: string
  /** 展示用相对路径（相对下载根目录） */
  displayPath: string
  sizeBytes: number
  createdAt: number
  coverUrl: string
  sourceName: string
  hls: boolean
  /** 目录型下载（漫画章节等），不能直接播放，只能打开目录 */
  folder?: boolean
  /** 媒体时长（秒，音乐 / 视频有则显示） */
  durationSec?: number
  /** 下载时使用的 Referer（吃瓜镜像等防盗链 CDN，重开应用后修复 / 续传还要用） */
  referer?: string
}

export interface DownloadItem extends DownloadRecord {
  /** 可播放地址（本地媒体服务 http 地址） */
  playUrl: string
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
  /** 媒体时长（秒），下载列表里展示 */
  durationSec?: number
  referer?: string
}

export interface DownloadAddResult {
  ok: boolean
  error?: string
}

/** 更改下载总目录：move = 是否把旧目录内容迁移到新目录并清理旧目录 */
export interface DownloadChangeRootResult {
  ok: boolean
  root?: string
  moved?: number
  error?: string
}

/** 应用内阅读已下载内容：漫画按章节返回图片地址，图书返回阅读页地址 */
export interface DownloadReadResult {
  ok: boolean
  kind?: 'comic' | 'book'
  chapters?: { name: string; urls: string[] }[]
  url?: string
  error?: string
}

/** 漫画 / 本子批量下载（整本或单章都是 chapters 数组） */
export type ComicSource = 'komiic' | 'bika'

export interface ComicMetaInput {
  source: ComicSource
  id: string
  title: string
  cover?: string
}

export interface ComicChapterInput {
  key: string
  name: string
  urls: string[]
}

export interface ComicBatchDownloadInput {
  comic: ComicMetaInput
  chapters: ComicChapterInput[]
  referer?: string
  sourceName?: string
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
