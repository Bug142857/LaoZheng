import type { DownloadAddInput } from '../shared/downloads'

/**
 * 全局下载入口：所有模块都先发事件，由 App 里的下载中心弹出确认框，
 * 用户确认后才真正加入下载队列，避免误点直接占用流量 / 额度。
 */
export const DOWNLOAD_REQUEST_EVENT = 'lz:download-request'

export function requestDownload(input: DownloadAddInput): void {
  window.dispatchEvent(new CustomEvent<DownloadAddInput>(DOWNLOAD_REQUEST_EVENT, { detail: input }))
}
