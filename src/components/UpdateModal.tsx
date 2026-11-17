import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { Modal } from './ui'
import {
  formatUpdateSpeed,
  type UpdateCheckResult,
  type UpdateProgress
} from '../shared/update'

function formatMb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const mb = bytes / 1024 / 1024
  return mb >= 10 ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`
}

/**
 * 更新弹窗：启动检查到新版本 / 设置页手动检查共用同一套窗口。
 * 打开时只展示版本与更新说明，点「下载更新」后才开始下载并显示进度 / 速度 / 线路。
 */
export function UpdateModal({
  open,
  info,
  onClose,
  onNotice
}: {
  open: boolean
  info: UpdateCheckResult | null
  onClose: () => void
  onNotice?: (text: string) => void
}) {
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [busy, setBusy] = useState<'download' | 'install' | null>(null)
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null)
  const watchingRef = useRef(false)

  useEffect(() => {
    watchingRef.current = open
  }, [open])

  // 换新版本时重置上一次的下载进度 / 安装包路径
  useEffect(() => {
    setProgress(null)
    setBusy(null)
    setDownloadedPath(null)
  }, [info?.latest])

  useEffect(() => {
    return window.laozheng.onUpdateProgress((next) => {
      if (!watchingRef.current) return
      if (next.error) {
        setProgress(null)
        setBusy(null)
        return
      }
      setProgress(next)
      if (next.percent >= 1) setBusy(null)
    })
  }, [])

  const download = async (): Promise<void> => {
    if (!info?.downloadUrl || busy) return
    setBusy('download')
    setDownloadedPath(null)
    setProgress({ received: 0, total: 0, percent: 0, speed: 0, phase: 'selecting' })
    try {
      const res = await window.laozheng.downloadUpdate(info.downloadUrl)
      if (res.canceled) {
        setProgress(null)
        onNotice?.('已取消下载')
        return
      }
      if (!res.ok || !res.path) {
        setProgress(null)
        onNotice?.(`下载失败：${res.error ?? '未知错误'}`)
        return
      }
      setDownloadedPath(res.path)
      onNotice?.('安装包已下载完成，点「立即安装」会打开安装向导（应用会先退出）')
    } catch (err) {
      setProgress(null)
      onNotice?.(err instanceof Error ? err.message : '下载失败')
    } finally {
      setBusy(null)
    }
  }

  const install = async (): Promise<void> => {
    if (!downloadedPath || busy) return
    setBusy('install')
    try {
      await window.laozheng.installUpdate(downloadedPath)
    } catch (err) {
      setBusy(null)
      onNotice?.(err instanceof Error ? err.message : '安装失败')
    }
  }

  if (!open || !info?.hasUpdate) return null

  const percent = progress?.percent ?? 0
  const speedText = formatUpdateSpeed(progress?.speed)
  let status = ''
  if (progress) {
    if (progress.paused) status = `已暂停 · ${Math.round(percent * 100)}%`
    else if (progress.phase === 'selecting') status = '正在测速选择最快线路…'
    else if (percent >= 1) status = '下载完成'
    else if (progress.total > 0) status = `正在下载 · ${Math.round(percent * 100)}%`
    else status = `正在下载 · ${formatMb(progress.received)}`
  }
  const detail = [status, speedText, progress?.line ? `线路 ${progress.line}` : '']
    .filter(Boolean)
    .join(' · ')

  return (
    <Modal
      title={`发现新版本 ${info.latest ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            稍后
          </button>
          {info.url ? (
            <button
              className="btn"
              onClick={() => void window.laozheng.openExternal(info.url ?? '')}
            >
              打开发布页
            </button>
          ) : null}
          {info.downloadUrl && !downloadedPath ? (
            <button
              className="btn primary"
              disabled={busy === 'download'}
              onClick={() => void download()}
            >
              <Download size={14} /> {busy === 'download' ? '下载中…' : '下载更新'}
            </button>
          ) : null}
          {downloadedPath ? (
            <button
              className="btn primary"
              disabled={busy === 'install'}
              onClick={() => void install()}
            >
              {busy === 'install' ? '正在启动安装…' : '立即安装'}
            </button>
          ) : null}
        </>
      }
    >
      <p>
        当前版本 v{info.current}
        {info.notes ? `\n\n${info.notes}` : ''}
      </p>
      {progress ? (
        <div className="page-desc">
          <div>{detail}</div>
          <div className="update-progress-track">
            <div
              className={`update-progress-fill${
                progress.paused
                  ? ' paused'
                  : progress.phase === 'selecting'
                    ? ' indeterminate'
                    : ''
              }`}
              style={{ width: `${Math.round(percent * 100)}%` }}
            />
          </div>
          {percent < 1 ? (
            <div
              className="update-progress-actions"
              style={{ justifyContent: 'flex-start', marginTop: 8 }}
            >
              <button
                className="btn ghost"
                onClick={() => {
                  void (progress.paused
                    ? window.laozheng.resumeUpdate()
                    : window.laozheng.pauseUpdate())
                }}
              >
                {progress.paused ? '继续' : '暂停'}
              </button>
              <button className="btn ghost" onClick={() => void window.laozheng.cancelUpdate()}>
                取消
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}
