import { useEffect, useMemo, useState } from 'react'
import {
  BookHeart,
  BookOpen,
  BookText,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Film,
  FolderOpen,
  ImageIcon,
  Images,
  Music as MusicIcon,
  Play,
  Trash2,
  Wallpaper,
  Wand2,
  X,
  type LucideIcon
} from 'lucide-react'
import { EmptyState, Modal } from '../components/ui'
import { MelonImage } from '../components/MelonImage'
import { ComicReader } from '../components/ComicReader'
import { useMusicPlayer } from '../components/MusicPlayer'
import {
  formatBytes,
  type DownloadItem,
  type DownloadKind,
  type DownloadListResponse
} from '../shared/downloads'

/** 下载分区（与手机端下载管理一致：视频 / 漫画 / 本子 / 音乐 / 壁纸 / 书籍 / 小说 / 修改器） */
export type DownloadSection =
  | 'video'
  | 'comic'
  | 'h2'
  | 'music'
  | 'wallpaper'
  | 'book'
  | 'novel'
  | 'trainer'

const SECTIONS: { key: DownloadSection; label: string; icon: LucideIcon }[] = [
  { key: 'video', label: '视频', icon: Film },
  { key: 'comic', label: '漫画', icon: Images },
  { key: 'h2', label: '本子', icon: BookHeart },
  { key: 'music', label: '音乐', icon: MusicIcon },
  { key: 'wallpaper', label: '壁纸', icon: ImageIcon },
  { key: 'book', label: '书籍', icon: BookOpen },
  { key: 'novel', label: '小说', icon: BookText },
  { key: 'trainer', label: '修改器', icon: Wand2 }
]

/** 分区 → 磁盘子目录（漫画与本子共用「漫画」目录） */
const SECTION_KIND: Record<DownloadSection, DownloadKind> = {
  video: 'video',
  comic: 'comic',
  h2: 'comic',
  music: 'music',
  wallpaper: 'wallpaper',
  book: 'book',
  novel: 'novel',
  trainer: 'trainer'
}

function kindLabel(kind: DownloadItem['kind']): string {
  return kind === 'video'
    ? '视频'
    : kind === 'music'
      ? '音乐'
      : kind === 'comic'
        ? '漫画'
        : kind === 'book'
          ? '图书'
          : kind === 'novel'
            ? '小说'
            : kind === 'wallpaper'
              ? '壁纸'
              : kind === 'trainer'
                ? '修改器'
                : '文件'
}

/** 漫画与本子共用 kind=comic，用来源名区分 */
function sectionOf(item: DownloadItem): DownloadSection {
  if (item.kind === 'music') return 'music'
  if (item.kind === 'book') return 'book'
  if (item.kind === 'novel') return 'novel'
  if (item.kind === 'wallpaper') return 'wallpaper'
  if (item.kind === 'trainer') return 'trainer'
  if (item.kind === 'comic') return item.sourceName === '本子' ? 'h2' : 'comic'
  return 'video'
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function formatDuration(sec?: number): string {
  if (!sec) return ''
  const total = Math.round(sec)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

interface ReadingState {
  title: string
  chapters: { name: string; urls: string[] }[]
  index: number
}

export function DownloadsPage({
  onNotice,
  onBack,
  initialSection
}: {
  onNotice: (text: string) => void
  onBack: () => void
  initialSection?: DownloadSection
}) {
  const player = useMusicPlayer()
  const [data, setData] = useState<DownloadListResponse | null>(null)
  const [removing, setRemoving] = useState<DownloadItem | null>(null)
  const [section, setSection] = useState<DownloadSection | null>(initialSection ?? null)
  const [musicSort, setMusicSort] = useState<'recent' | 'artist'>('recent')
  const [reading, setReading] = useState<ReadingState | null>(null)
  const [settingWallpaper, setSettingWallpaper] = useState<string | null>(null)

  useEffect(() => {
    setSection(initialSection ?? null)
  }, [initialSection])

  const refresh = async () => {
    const next = await window.laozheng.listDownloads()
    setData(next)
  }

  useEffect(() => {
    void refresh()
    // 进度 / 完成 / 删除都由主进程广播，不再定时轮询整张下载列表
    return window.laozheng.onDownloadsChanged(() => void refresh())
  }, [])

  const tasks = useMemo(() => data?.tasks ?? [], [data])
  const allItems = useMemo(() => data?.items ?? [], [data])

  const summary = useMemo(() => {
    const map: Record<DownloadSection, { count: number; bytes: number }> = {
      video: { count: 0, bytes: 0 },
      comic: { count: 0, bytes: 0 },
      h2: { count: 0, bytes: 0 },
      music: { count: 0, bytes: 0 },
      wallpaper: { count: 0, bytes: 0 },
      book: { count: 0, bytes: 0 },
      novel: { count: 0, bytes: 0 },
      trainer: { count: 0, bytes: 0 }
    }
    for (const item of allItems) {
      const key = sectionOf(item)
      map[key].count += 1
      map[key].bytes += item.sizeBytes || 0
    }
    return map
  }, [allItems])

  const items = useMemo(() => {
    const list = section ? allItems.filter((item) => sectionOf(item) === section) : []
    if (section === 'music' && musicSort === 'artist') {
      return [...list].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
    }
    return list
  }, [allItems, section, musicSort])

  const openDir = async () => {
    try {
      // 在分区里点「打开目录」直接进对应子目录，总览页才打开下载根目录
      await window.laozheng.openDownloadsDir(section ? SECTION_KIND[section] : undefined)
    } catch (err) {
      onNotice(`打开目录失败：${(err as Error).message}`)
    }
  }

  const cancel = async (id: string) => {
    await window.laozheng.cancelDownload(id)
    void refresh()
  }

  const openLocal = async (item: DownloadItem) => {
    try {
      await window.laozheng.openDownloadItem(item.id)
    } catch (err) {
      onNotice(`打开失败：${(err as Error).message}`)
    }
  }

  const applyWallpaper = async (item: DownloadItem) => {
    if (settingWallpaper) return
    setSettingWallpaper(item.id)
    try {
      await window.laozheng.setWallpaper(item.id)
      onNotice(`已设为桌面壁纸：${item.title}`)
    } catch (err) {
      onNotice(`设置壁纸失败：${(err as Error).message}`)
    } finally {
      setSettingWallpaper(null)
    }
  }

  const playItem = async (item: DownloadItem) => {
    if (item.kind === 'music') {
      const songs = items
        .filter((row) => row.kind === 'music' && row.playUrl)
        .map((row) => ({
          key: row.id,
          id: row.id,
          title: row.title,
          artists: row.sourceName || '本地音乐',
          cover: row.coverUrl || null,
          url: row.playUrl
        }))
      const start = songs.findIndex((song) => song.key === item.id)
      player.playQueue(songs, start < 0 ? 0 : start)
      return
    }
    try {
      // 视频直接交给系统默认播放器
      await window.laozheng.playDownloadItem(item.id)
    } catch (err) {
      onNotice(`播放失败：${(err as Error).message}`)
    }
  }

  const openReader = async (item: DownloadItem) => {
    const res = await window.laozheng.readDownloadItem(item.id)
    if (!res.ok) {
      onNotice(`打开失败：${res.error ?? '未知错误'}`)
      return
    }
    if (res.kind === 'comic' && res.chapters?.length) {
      setReading({ title: item.title, chapters: res.chapters, index: 0 })
      return
    }
    // 图书不再提供应用内阅读，统一用「本地打开」交给系统阅读器
    onNotice('这个下载请用「本地打开」查看')
  }

  const runTrainer = async (item: DownloadItem) => {
    try {
      await window.laozheng.runDownloadTrainer(item.id)
      onNotice('已请求管理员权限启动修改器')
    } catch (err) {
      onNotice(`启动失败：${(err as Error).message}`)
    }
  }

  const openItemFolder = async (item: DownloadItem) => {
    try {
      await window.laozheng.openDownloadFolder(item.id)
    } catch (err) {
      onNotice(`打开目录失败：${(err as Error).message}`)
    }
  }

  const doRemove = async (deleteFile: boolean) => {
    if (!removing) return
    try {
      const res = await window.laozheng.removeDownload(removing.id, deleteFile)
      if (!res?.ok) {
        // 文件被占用时记录仍在，弹窗保留，用户可以关掉播放器后重试
        onNotice(`删除失败：${res?.error ?? '未知错误'}`)
        return
      }
    } catch (err) {
      onNotice(`删除失败：${(err as Error).message}`)
      return
    }
    onNotice(deleteFile ? '已移到系统回收站并删除记录' : '已移除下载记录')
    setRemoving(null)
    void refresh()
  }

  if (reading) {
    const chapter = reading.chapters[reading.index]
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={() => setReading(null)}>
            <ChevronLeft size={15} /> 返回下载
          </button>
          <h1 className="page-title">
            {reading.title}
            {chapter?.name ? ` · ${chapter.name}` : ''}
          </h1>
          <div className="page-actions">
            <button
              className="btn"
              disabled={reading.index <= 0}
              onClick={() => setReading({ ...reading, index: reading.index - 1 })}
            >
              上一话
            </button>
            <button
              className="btn"
              disabled={reading.index >= reading.chapters.length - 1}
              onClick={() => setReading({ ...reading, index: reading.index + 1 })}
            >
              下一话
            </button>
          </div>
        </header>
        {chapter ? <ComicReader images={chapter.urls} /> : <EmptyState title="这一话没有图片" />}
      </>
    )
  }

  const activeSection = section ? SECTIONS.find((s) => s.key === section) : null

  return (
    <>
      <header className="page-header">
        <button
          className="btn ghost"
          onClick={() => {
            // 从模块右上角直达分区时，返回就是回上一页；自己点进来的则先回下载管理
            if (initialSection || !section) {
              onBack()
              return
            }
            setSection(null)
          }}
        >
          <ChevronLeft size={15} /> {section && !initialSection ? '下载管理' : '返回'}
        </button>
        <h1 className="page-title">{activeSection ? activeSection.label : '下载'}</h1>
        <div className="page-actions">
          <button className="btn" onClick={() => void openDir()}>
            <FolderOpen size={15} /> 打开目录
          </button>
        </div>
      </header>

      {!section ? (
        <>
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
                    <button
                      className="icon-btn"
                      title={task.state === 'failed' ? '清除失败任务与残留文件' : '取消下载'}
                      onClick={() => void cancel(task.id)}
                    >
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

          <div className="settings-list">
            {SECTIONS.map((entry) => {
              const Icon = entry.icon
              const info = summary[entry.key]
              return (
                <button
                  key={entry.key}
                  className="settings-entry"
                  onClick={() => setSection(entry.key)}
                >
                  <span className="settings-entry-icon">
                    <Icon size={20} strokeWidth={1.8} />
                  </span>
                  <span className="settings-entry-main">
                    <span className="settings-entry-title">{entry.label}</span>
                    <span className="settings-entry-hint">
                      {info.count > 0
                        ? `${info.count} 个文件 · 共 ${formatBytes(info.bytes)}`
                        : '暂无下载'}
                    </span>
                  </span>
                  <ChevronRight size={17} className="settings-entry-arrow" />
                </button>
              )
            })}
          </div>
        </>
      ) : items.length === 0 ? (
        <EmptyState
          title={`还没有${activeSection?.label ?? ''}下载`}
          desc="到对应模块点「下载」，文件会保存到下载总目录下的对应子文件夹。"
        />
      ) : section === 'video' ? (
        <div className="download-grid">
          {items.map((item) => (
            <div key={item.id} className="download-card">
              <span className="download-card-cover">
                {item.coverUrl ? (
                  item.sourceName === '吃瓜' ? (
                    <MelonImage url={item.coverUrl} />
                  ) : (
                    <img src={item.coverUrl} alt="" loading="lazy" />
                  )
                ) : (
                  <div className="row-cover">视频</div>
                )}
              </span>
              <div className="download-card-main">
                <div className="download-card-title" title={item.title}>
                  {item.title}
                </div>
                <div className="download-card-meta">
                  {[
                    formatDuration(item.durationSec),
                    formatBytes(item.sizeBytes),
                    item.sourceName,
                    item.hls ? '未合并（重开应用会再试一次）' : '',
                    formatTime(item.createdAt)
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <div className="download-card-actions">
                <button className="btn primary" onClick={() => void playItem(item)}>
                  <Play size={13} /> 播放
                </button>
                <button className="btn danger" onClick={() => setRemoving(item)}>
                  <Trash2 size={13} /> 删除
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : section === 'wallpaper' ? (
        <div className="download-grid">
          {items.map((item) => (
            <div key={item.id} className="download-card">
              <span className="download-card-cover">
                {item.coverUrl ? (
                  <img src={item.coverUrl} alt="" loading="lazy" />
                ) : (
                  <div className="row-cover">壁纸</div>
                )}
              </span>
              <div className="download-card-main">
                <div className="download-card-title" title={item.title}>
                  {item.title}
                </div>
                <div className="download-card-meta">
                  {[formatBytes(item.sizeBytes), item.sourceName, formatTime(item.createdAt)]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <div className="download-card-actions">
                <button
                  className="btn primary"
                  disabled={settingWallpaper === item.id}
                  onClick={() => void applyWallpaper(item)}
                >
                  <Wallpaper size={13} />{' '}
                  {settingWallpaper === item.id ? '设置中…' : '设为壁纸'}
                </button>
                <button className="btn" onClick={() => void openLocal(item)}>
                  <ExternalLink size={13} /> 打开
                </button>
                <button className="btn danger" onClick={() => setRemoving(item)}>
                  <Trash2 size={13} /> 删除
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : section === 'trainer' ? (
        <div className="rows">
          {items.map((item) => (
            <div key={item.id} className="row">
              <div className="row-cover">
                {item.coverUrl ? (
                  <img src={item.coverUrl} alt="" loading="lazy" />
                ) : (
                  <Wand2 size={16} />
                )}
              </div>
              <div className="row-main">
                <div className="row-title">{item.title}</div>
                <div className="row-meta">
                  {[formatBytes(item.sizeBytes), item.sourceName, formatTime(item.createdAt)]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="row-meta">{item.displayPath}</div>
              </div>
              <button
                className="btn primary"
                disabled={item.folder || !/\.exe$/i.test(item.playPath)}
                onClick={() => void runTrainer(item)}
              >
                <Play size={13} /> 启动
              </button>
              <button className="btn" onClick={() => void openItemFolder(item)}>
                <FolderOpen size={13} /> 目录
              </button>
              <button className="icon-btn danger" title="删除" onClick={() => setRemoving(item)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : section === 'music' ? (
        <>
          <div className="toolbar">
            <button
              className={`chip ${musicSort === 'recent' ? 'active' : ''}`}
              onClick={() => setMusicSort('recent')}
            >
              最近
            </button>
            <button
              className={`chip ${musicSort === 'artist' ? 'active' : ''}`}
              onClick={() => setMusicSort('artist')}
            >
              歌手
            </button>
          </div>
          <div className="rows compact">
            {items.map((item) => (
              <div key={item.id} className="row">
                <div className="row-cover">
                  {item.coverUrl ? (
                    <img src={item.coverUrl} alt="" loading="lazy" />
                  ) : (
                    <MusicIcon size={16} />
                  )}
                </div>
                <div className="row-main">
                  <div className="row-title">{item.title}</div>
                  <div className="row-meta">
                    {[
                      kindLabel(item.kind),
                      formatDuration(item.durationSec),
                      formatBytes(item.sizeBytes),
                      item.sourceName
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <button className="btn" onClick={() => void playItem(item)}>
                  <Play size={13} /> 播放
                </button>
                <button className="icon-btn danger" title="删除" onClick={() => setRemoving(item)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="rows">
          {items.map((item) => (
            <div key={item.id} className="row">
              <div className="row-cover">
                {item.coverUrl ? (
                  <img src={item.coverUrl} alt="" loading="lazy" />
                ) : (
                  (kindLabel(item.kind) || '文件').slice(0, 2)
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
              {section === 'book' || section === 'novel' ? null : (
                <button className="btn primary" onClick={() => void openReader(item)}>
                  <BookOpen size={13} /> 阅读
                </button>
              )}
              <button className="btn" title="用系统默认应用打开" onClick={() => void openLocal(item)}>
                <ExternalLink size={13} /> 本地打开
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
                移到回收站
              </button>
            </>
          }
        >
          <p>
            确定删除「{removing.title}」吗？
            {'\n'}
            文件会移到 Windows 回收站，仍可从回收站还原；下载记录会一并移除，之后从回收站还原文件时记录会自动恢复。
            {removing.hls ? '\nHLS 下载会整目录移到回收站（切片与播放列表）。' : ''}
          </p>
        </Modal>
      )}
    </>
  )
}
