/** Z-Library 共享类型，字段对齐手机端 ZlibClient.kt */

export interface ZlibBook {
  id: string
  hash: string
  title: string
  author: string | null
  cover: string | null
  year: string | null
  language: string | null
  extension: string | null
  filesize: string | null
  publisher: string | null
  description: string | null
  rating: string | null
  /** 站点下载入口（形如 /dl/xxxx），前端不自行拼地址 */
  dl: string | null
  readOnlineUrl: string | null
}

export interface ZlibSearchResponse {
  ok: boolean
  books: ZlibBook[]
  page: number
  totalPages: number
  error?: string
}

export interface ZlibDetailResponse {
  ok: boolean
  book: ZlibBook | null
  error?: string
}

export interface ZlibStatusResponse {
  ok: boolean
  loggedIn: boolean
  host: string
  message: string
  /** 已保存的登录账号（密码不会返回渲染进程） */
  username: string
  /** 今日已下载数量 / 每日额度（拿不到时为 null） */
  downloadsToday?: number | null
  downloadsLimit?: number | null
}

export interface ZlibLoginResult {
  ok: boolean
  message: string
  host?: string
}

export interface ZlibDownloadResponse {
  ok: boolean
  path?: string
  name?: string
  error?: string
}

export function zlibBookKey(book: Pick<ZlibBook, 'id' | 'hash'>): string {
  return `${book.id}|${book.hash || '-'}`
}
