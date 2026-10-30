import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Download, X } from 'lucide-react'
import { ConfirmDialog } from './ui'
import { DOWNLOAD_REQUEST_EVENT } from '../utils/download'
import { formatBytes, type DownloadAddInput, type DownloadTask } from '../shared/downloads'

/**
 * 下载中心：所有模块的下载都先经过这里确认，并在左下角用悬浮窗展示进度。
 * 失败任务保留在悬浮窗里，点 × 取消时会一并清理没下完的产物。
 */
export function DownloadCenter({
  onNotice,
  onOpenDownloads
}: {
  onNotice: (text: string) => void
  onOpenDownloads: () => void
}) {
  const [pending, setPending] = useState<DownloadAddInput | null>(null)
  const [busy, setBusy] = useState(false)
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const [collapsed, setCollapsed] = useState(false)

  const refresh = async () => {
    try {
      const res = await window.laozheng.listDownloads()
      setTasks(res.tasks)
    } catch {
      // 下载服务尚未就绪时忽略
    }
  }

  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<DownloadAddInput>).detail
      if (detail?.url) setPending(detail)
    }
    window.addEventListener(DOWNLOAD_REQUEST_EVENT, onRequest)
    return () => window.removeEventListener(DOWNLOAD_REQUEST_EVENT, onRequest)
  }, [])

  useEffect(() => {
    void refresh()
    const off = window.laozheng.onDownloadsChanged(() => void refresh())
    return off
  }, [])

  const confirm = async () => {
    if (!pending || busy) return
    setBusy(true)
    const res = await window.laozheng.addDownload(pending)
    setBusy(false)
    setPending(null)
    if (res.ok) {
      onNotice('已加入下载队列，左下角可查看进度')
      void refresh()
    } else {
      onNotice(`下载失败：${res.error ?? '未知错误'}`)
    }
  }

  const cancel = async (task: DownloadTask) => {
    await window.laozheng.cancelDownload(task.id)
    onNotice(task.state === 'failed' ? '已清除失败的下载' : '已取消下载')
    void refresh()
  }

  const running = tasks.filter((t) => t.state === 'running').length

  return (
    <>
      {pending ? (
        <ConfirmDialog
          title="确认下载"
          message={[
            `即将下载「${pending.title || '未命名'}」。`,
            pending.sourceName ? `来源：${pending.sourceName}` : '',
            /\.m3u8(\?|$)/i.test(pending.url) ? '这是 HLS 视频，会下载全部分片并合并。' : '',
            '确认后开始下载，左下角会显示进度。'
          ]
            .filter(Boolean)
            .join('\n')}
          confirmText={busy ? '正在添加…' : '开始下载'}
          onConfirm={() => void confirm()}
          onCancel={() => {
            if (!busy) setPending(null)
          }}
        />
      ) : null}

      {tasks.length ? (
        <div className="download-float">
          <div className="download-float-head">
            <Download size={14} />
            <span>
              {running > 0 ? `正在下载 ${running} 项` : `下载任务 ${tasks.length} 项`}
            </span>
            <button className="icon-btn" title="查看下载管理" onClick={onOpenDownloads}>
              查看
            </button>
            <button
              className="icon-btn"
              title={collapsed ? '展开' : '收起'}
              onClick={() => setCollapsed((v) => !v)}
            >
              {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
          {collapsed ? null : (
            <div className="download-float-list">
              {tasks.map((task) => (
                <div key={task.id} className="download-float-item">
                  <div className="download-float-title" title={task.title}>
                    {task.title}
                  </div>
                  <div className="download-float-meta">
                    {task.state === 'failed'
                      ? `失败：${task.error ?? '未知错误'}`
                      : task.progress >= 0
                        ? `${Math.round(task.progress * 100)}%`
                        : formatBytes(task.bytes)}
                  </div>
                  {task.state === 'running' ? (
                    <div className="progress">
                      <span
                        style={{
                          width: task.progress >= 0 ? `${Math.max(2, task.progress * 100)}%` : '35%',
                          opacity: task.progress >= 0 ? 1 : 0.5
                        }}
                      />
                    </div>
                  ) : null}
                  <button
                    className="icon-btn danger"
                    title={task.state === 'failed' ? '清除失败任务与残留文件' : '取消下载'}
                    onClick={() => void cancel(task)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </>
  )
}
