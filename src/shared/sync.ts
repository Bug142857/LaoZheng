/** 云同步（WebDAV）共用类型；配置存本机，不进备份 JSON */

export interface SyncConfigView {
  url: string
  username: string
  hasPassword: boolean
}

export interface SyncConfigInput {
  url: string
  username: string
  /** 留空表示沿用已保存的密码 */
  password?: string
}

export interface SyncActionResult {
  ok: boolean
  message: string
  /** 下载同步时返回导入数据 */
  data?: unknown
}
