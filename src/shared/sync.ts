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
  /** 上传前发现云端备份比本机新，需要用户确认是否覆盖 */
  conflict?: boolean
  /** 云端文件最后修改时间（毫秒） */
  remoteAt?: number
}

/** 从 WebDAV PROPFIND 的 XML 里取 getlastmodified，解析失败返回 null */
export function parseWebDavLastModified(xml: string): number | null {
  if (!xml) return null
  const match = xml.match(/<[^>]*lastmodified[^>]*>([^<]+)<[^>]*>/i)
  if (!match) return null
  const time = Date.parse(match[1].trim())
  return Number.isFinite(time) ? time : null
}

/** 上传前判断是否需要提示覆盖：云端比本机新超过 5 秒才提示，避免刚保存就上传的误报 */
export function shouldWarnUploadConflict(
  remoteAt: number | null,
  localAt: number
): remoteAt is number {
  return remoteAt != null && Number.isFinite(remoteAt) && remoteAt > localAt + 5000
}
