import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, FolderOpen, Music as MusicIcon, Play, RefreshCw, Trash2, X } from 'lucide-react'
import { EmptyState, Modal } from '../components/ui'
import { VideoPlayer } from '../components/VideoPlayer'
import { formatBytes, type DownloadItem, type DownloadListResponse } from '../shared/downloads'

function kindLabel(kind: DownloadItem['kind']): string {
  return kind === 'video' ? '视频' : kind === 'music' ? '音乐' : '文件'
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function DownloadsPage({ onNotice }: { onNotice: (text: string) => void }) {
  const [data, setData] = useState<DownloadListResponse | null>(null)
  const [playing, setPlaying] = useState<DownloadItem | null>(null)
  const [removing, setRemoving] = useState<DownloadItem | null>(null)

  const refresh = async () => {
    const next = await window.laozheng.listDownloads()
    setData(next)
  }

  useEffect(() => {
    void refresh()
    const off = window.laozheng.onDownloadsChanged(() => void refresh())
    const timer = window.setInterval(() => void refresh(), 1500)
    return () => {
      off()
      window.clearInterval(timer)
    }
  }, [])

  const tasks = useMemo(() => data?.tasks ?? [], [data])
  const items = useMemo(() => data?.items ?? [], [data])

  const openDir = async () => {
    try {
      await window.laozheng.openDownloadsDir()
    } catch (err) {
      onNotice(`打开目录失败：${(err as Error).message}`)
    }
  }

  const cancel = async (id: string) => {
    await window.laozheng.cancelDownload(id)
    void refresh()
  }

  const doRemove = async (deleteFile: boolean) => {
    if (!removing) return
    await window.laozheng.removeDownload(removing.id, deleteFile)
    onNotice(deleteFile ? '已删除文件与记录' : '已移除下载记录')
    setRemoving(null)
    if (playing?.id === removing.id) setPlaying(null)
    void refresh()
  }

  if (playing) {
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={() => setPlaying(null)}>
            <ChevronLeft size={15} /> 返回下载
          </button>
          <h1 className="page-title">{playing.title}</h1>
          <span className="page-desc">
            {kindLabel(playing.kind)} · {formatBytes(playing.sizeBytes)}
          </span>
        </header>
        {playing.kind === 'video' ? (
          <VideoPlayer src={playing.playUrl} />
        ) : (
          <section className="now-playing">
            <div className="now-cover">
              {playing.coverUrl ? <img src={playing.coverUrl} alt="" /> : <MusicIcon size={26} />}
            </div>
            <div className="now-main">
              <div className="now-title">{playing.title}</div>
              <audio key={playing.playUrl} src={playing.playUrl} controls autoPlay style={{ width: '100%', marginTop: 8 }} />
            </div>
          </section>
        )}
        <div className="page-desc" style={{ marginTop: 12 }}>
          文件位置：{playing.displayPath}
        </div>
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">下载</h1>
        <span className="page-desc">
          视频 / 音乐下载到系统下载目录下的「老郑分享」文件夹
        </span>
        <div className="page-actions">
          <button className="btn" onClick={() => void refresh()}>
            <RefreshCw size={15} /> 刷新
          </button>
          <button className="btn" onClick={() => void openDir()}>
            <FolderOpen size={15} /> 打开目录
          </button>
        </div>
      </header>

      {data ? <div className="page-desc" style={{ marginBottom: 12 }}>{data.dir}</div> : null}

      {tasks.length > 0 && (
        <section className="settings-card" style={{ marginBottom: 16 }}>
          <h3>正在下载</h3>
          {tasks.map((task) => (
            <div key={task.id} className="download-task">
              <div className="download-task-head">
                <span className="row-title">{task.title}</span>
                <span className="page-desc">
                  {task.state === 'failed'
                    ? `失败：${task.error ?? '未知错误'}`
                    : task.progress >= 0
                      ? `${Math.round(task.progress * 100)}%`
                      : formatBytes(task.bytes)}
                </span>
                <button className="icon-btn" title="移除任务" onClick={() => void cancel(task.id)}>
                  <X size={14} />
                </button>
              </div>
              <div className="progress">
                <span
                  style={{
                    width: task.progress >= 0 ? `${Math.max(2, task.progress * 100)}%` : '35%',
                    opacity: task.progress >= 0 ? 1 : 0.5
                  }}
                />
              </div>
              <div className="page-desc">
                {formatBytes(task.bytes)}
                {task.totalBytes > 0 ? ` / ${formatBytes(task.totalBytes)}` : ''}
                {task.sourceName ? ` · 来自 ${task.sourceName}` : ''}
              </div>
            </div>
          ))}
        </section>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="还没有下载"
          desc="在观影播放页点「下载」，或在音乐播放条点「下载」，文件会保存到「老郑分享」目录。"
        />
      ) : (
        <div className="rows">
          {items.map((item) => (
            <div key={item.id} className="row">
              <div className="row-cover">
                {item.coverUrl ? (
                  <img src={item.coverUrl} alt="" loading="lazy" />
                ) : item.kind === 'music' ? (
                  <MusicIcon size={18} />
                ) : (
                  '文件'
                )}
              </div>
              <div className="row-main">
                <div className="row-title">{item.title}</div>
                <div className="row-meta">
                  {[kindLabel(item.kind), formatBytes(item.sizeBytes), item.sourceName, formatTime(item.createdAt)]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="row-meta">{item.displayPath}</div>
              </div>
              <button className="btn" onClick={() => setPlaying(item)}>
                <Play size={14} /> 播放
              </button>
              <button className="icon-btn danger" title="删除" onClick={() => setRemoving(item)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {removing && (
        <Modal
          title="删除下载"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setRemoving(null)}>
                取消
              </button>
              <button className="btn" onClick={() => void doRemove(false)}>
                仅移除记录
              </button>
              <button className="btn danger" onClick={() => void doRemove(true)}>
                删除文件
              </button>
            </>
          }
        >
          <p>
            确定处理「{removing.title}」吗？
            {removing.hls ? '\nHLS 下载会整目录删除（切片与播放列表）。' : ''}
          </p>
        </Modal>
      )}
    </>
  )
}
