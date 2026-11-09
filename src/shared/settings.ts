/** 本机界面设置（单独保存；导出 / 云同步时作为 PC 扩展字段附带快照） */

export type ThemeMode = 'system' | 'light' | 'dark'

export interface UiSettings {
  theme: ThemeMode
  /** 主题色 key，见渲染进程 src/utils/theme.ts 的 ACCENT_OPTIONS */
  accent: string
}

export interface CacheInfo {
  /** 可清理的缓存总大小（字节） */
  bytes: number
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
