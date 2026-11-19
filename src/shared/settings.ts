/** 本机界面设置（单独保存；导出 / 云同步时作为 PC 扩展字段附带快照） */

import type { MusicQueueItem } from './music'

export type ThemeMode = 'system' | 'light' | 'dark'
export type MusicPlayMode = 'single' | 'order' | 'shuffle'

export interface UiSettings {
  theme: ThemeMode
  /** 主题色 key，见渲染进程 src/utils/theme.ts 的 ACCENT_OPTIONS */
  accent: string
  /** 音乐播放器音量（0~1），记住上次值并随备份 / 云同步走 */
  musicVolume?: number
  /** 音乐播放器是否静音 */
  musicMuted?: boolean
  /** 音乐播放队列（重启后恢复，随备份 / 云同步走） */
  musicQueue?: MusicQueueItem[]
  /** 上次播放到队列中的第几条 */
  musicQueueIndex?: number
  /** 上次播放模式 */
  musicMode?: MusicPlayMode
  /** 上次播放进度（秒），恢复后作为续播位置 */
  musicQueueTime?: number
}

export interface CacheInfo {
  /** 可清理的缓存总大小（字节） */
  bytes: number
  /** 图片缓存占用（字节） */
  imageBytes: number
  /** 接口缓存占用（字节） */
  apiBytes: number
  /** 下载目录里残留的 .part 临时文件数量 */
  parts: number
  /** 当前缓存根目录（图片 / 接口缓存都放在这里） */
  dir: string
}

export interface CacheClearResult {
  ok: boolean
  freed: number
  error?: string
}

/** 更换缓存目录结果：切换成功后旧目录的缓存会被清空 */
export interface CacheDirResult {
  canceled: boolean
  dir?: string
  freed?: number
  error?: string
}
