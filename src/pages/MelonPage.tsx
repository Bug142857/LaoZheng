import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Download, Heart, Play, X } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, ModuleShortcuts, Pagination } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { MelonImage } from '../components/MelonImage'
import { VideoPlayer } from '../components/VideoPlayer'
import { loadCache, saveCache } from '../utils/cache'
import { requestDownload } from '../utils/download'
import {
  MELON_CATEGORIES,
  type MelonBlock,
  type MelonDetail,
  type MelonPage,
  type MelonPost
} from '../shared/melon'

interface InlineVideo {
  url: string
  title: string
  /** 对应正文第几个 block，用于把播放器放在这组按钮下面 */
  blockIndex: number
}

interface MelonCache {
  path: string
  keyword: string
  page: MelonPage | null
}

const initialCache = (() => {
  const cached = loadCache<MelonCache>('melon', { path: '/', keyword: '', page: null })
  // 每次打开应用回到默认分类（最新）；默认列表本身仍从缓存直接显示
  if (cached.path === '/' && !cached.keyword) return cached
  return { path: '/', keyword: '', page: null }
})()
/** 分类数量一次探测后全局复用（切换模块不重复请求） */
let melonCounts: Record<string, number> = {}
let melonCountsRequested = false

function formatClock(total: number): string {
  const sec = Math.max(0, Math.round(total))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** 站点翻页形如 /category/xsxy/2/ 或 /page/2/ */
function pagePath(base: string, page: number): string {
  const clean = base.replace(/^\/+|\/+$/g, '')
  if (page <= 1) return clean ? `/${clean}/` : '/'
  return clean ? `/${clean}/${page}/` : `/page/${page}/`
}

export function MelonPage({
  onNotice,
  focusId,
  resetSignal,
  onExit,
  onOpenFavorites,
  onOpenDownloads
}: {
  onNotice: (text: string) => void
  focusId?: string
  resetSignal?: number
  /** 从收藏进入时，详情 / 播放返回走全局上一页 */
  onExit?: () => void
  onOpenFavorites?: () => void
  onOpenDownloads?: () => void
}) {
  const { data, update } = useData()
  const [path, setPath] = useState(initialCache.path)
  const [basePath, setBasePath] = useState(
    initialCache.keyword ? `/search/${encodeURIComponent(initialCache.keyword)}/` : initialCache.path
  )
  const [pageNum, setPageNum] = useState(1)
  const [input, setInput] = useState(initialCache.keyword)
  const [keyword, setKeyword] = useState(initialCache.keyword)
  const [page, setPage] = useState<MelonPage | null>(initialCache.page)
  const [counts, setCounts] = useState<Record<string, number>>(melonCounts)
  const [loading, setLoading] = useState(!initialCache.page)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<MelonDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<InlineVideo | null>(null)
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  /** 正文视频时长：站点不返回，播放前用隐藏 video 读元数据补上 */
  const [durations, setDurations] = useState<Record<number, string>>({})
  const requestSeq = useRef(0)

  useEffect(() => {
    if (resetSignal === undefined) return
    setDetail(null)
    setPlaying(null)
  }, [resetSignal])

  const load = async (nextPath: string, nextKeyword = keyword) => {
    const seq = ++requestSeq.current
    setPendingPath(nextPath)
    setLoading(true)
    setError(null)
    const res = await window.laozheng.melonList(nextPath)
    if (seq !== requestSeq.current) return
    setPendingPath(null)
    setLoading(false)
    if (!res.ok || !res.page) {
      setError(res.error ?? '加载失败')
      return
    }
    setPage(res.page)
    setPath(nextPath)
    // 只缓存默认分类，避免搜索 / 别的分类把默认列表缓存覆盖掉
    if (nextPath === '/' && !nextKeyword) {
      saveCache<MelonCache>('melon', { path: '/', keyword: '', page: res.page })
    }
  }

  useEffect(() => {
    // 直接用缓存列表渲染时，主进程还没见过这些图床域名：补登记一次以便注入防盗链头
    const covers = (initialCache.page?.items ?? [])
      .map((item) => item.cover)
      .filter((url): url is string => !!url)
    if (covers.length) void window.laozheng.trackMelonImages(covers)
    if (!initialCache.page) void load('/')
    if (!melonCountsRequested) {
      melonCountsRequested = true
      void window.laozheng.melonCategoryCounts().then((res) => {
        if (!res.ok) return
        melonCounts = res.counts
        setCounts(res.counts)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!focusId) return
    let alive = true
    void openDetail({ id: focusId }, () => alive)
    return () => {
      alive = false
      setDetail(null)
      setPlaying(null)
      setDetailError(null)
      setDetailLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])

  const switchCategory = (next: string) => {
    setKeyword('')
    setInput('')
    setBasePath(next)
    setPageNum(1)
    void load(next, '')
  }

  const doSearch = () => {
    const kw = input.trim()
    if (!kw) return
    setKeyword(kw)
    const nextBase = `/search/${encodeURIComponent(kw)}/`
    setBasePath(nextBase)
    setPageNum(1)
    void load(nextBase, kw)
  }

  const gotoPage = (next: number) => {
    setPageNum(next)
    void load(pagePath(basePath, next))
  }

  const openDetail = async (post: MelonPost | { id: string }, alive?: () => boolean) => {
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    setPlaying(null)
    setDurations({})
    const res = await window.laozheng.melonDetail(post.id)
    if (alive && !alive()) return
    setDetailLoading(false)
    if (!res.ok || !res.detail) {
      setDetailError(res.error ?? '加载失败')
      return
    }
    setDetail(res.detail)
  }

  // 站点不返回时长：HLS 让主进程读 #EXTINF，直链 mp4 用隐藏 video 读元数据
  useEffect(() => {
    if (!detail) return
    let alive = true
    const elements: HTMLVideoElement[] = []
    detail.blocks.forEach((block, index) => {
      if (block.type !== 'video') return
      if (/m3u8/i.test(block.url)) {
        void window.laozheng.melonDuration(block.url).then((res) => {
          if (!alive || !res.ok || !res.seconds) return
          setDurations((prev) => ({ ...prev, [index]: formatClock(res.seconds as number) }))
        })
        return
      }
      const el = document.createElement('video')
      el.preload = 'metadata'
      el.muted = true
      el.src = block.url
      elements.push(el)
      el.onloadedmetadata = () => {
        if (!alive) return
        if (Number.isFinite(el.duration) && el.duration > 0) {
          setDurations((prev) => ({ ...prev, [index]: formatClock(el.duration) }))
        }
        el.removeAttribute('src')
        el.load()
      }
    })
    return () => {
      alive = false
      for (const el of elements) {
        el.removeAttribute('src')
        el.load()
      }
    }
  }, [detail])

  const favOf = (id: string) => data.innerFavs.find((f) => f.module === 'melon' && f.id === id)

  const toggleFav = (post: MelonPost | MelonDetail, videoUrl?: string) => {
    const id = post.id
    const exists = !!favOf(id)
    const cover = 'cover' in post ? post.cover : null
    const author = post.author
    const date = post.date
    update((d) => {
      if (exists) {
        return { ...d, innerFavs: d.innerFavs.filter((f) => !(f.module === 'melon' && f.id === id)) }
      }
      return {
        ...d,
        innerFavs: [
          ...d.innerFavs,
          {
            module: 'melon',
            id,
            title: post.title,
            subtitle: [author, date].filter(Boolean).join(' · '),
            cover,
            savedAt: Date.now(),
            videoUrl: videoUrl ?? null,
            mediaId: 0,
            durationSec: 0,
            tweetUrl: null,
            payload: null
          }
        ]
      }
    })
    onNotice(exists ? '已取消收藏' : '已收藏，可在「收藏」页查看')
  }

  const downloadVideo = (block: Extract<MelonBlock, { type: 'video' }>, post: MelonDetail) => {
    requestDownload({
      title: `${post.title} ${block.title}`.trim().slice(0, 120),
      url: block.url,
      kind: 'video',
      coverUrl: post.cover ?? '',
      sourceName: '吃瓜'
    })
  }

  if (detail || detailLoading || detailError) {
    const videos = (detail?.blocks ?? []).filter(
      (b): b is Extract<MelonBlock, { type: 'video' }> => b.type === 'video'
    )
    const fav = detail ? favOf(detail.id) : undefined
    return (
      <>
        <header className="page-header">
          <button
            className="btn ghost"
            onClick={() => {
              setPlaying(null)
              setDetail(null)
              setDetailError(null)
              setDetailLoading(false)
              if (focusId && onExit) onExit()
            }}
          >
            <ChevronLeft size={15} /> 返回列表
          </button>
          <h1 className="page-title" style={{ fontSize: 18 }}>
            {detail?.title ?? '吃瓜详情'}
          </h1>
          {detail ? (
            <div className="page-actions">
              <button className="btn" onClick={() => toggleFav(detail, videos[0]?.url)}>
                <Heart size={15} fill={fav ? 'currentColor' : 'none'} /> {fav ? '已收藏' : '收藏'}
              </button>
            </div>
          ) : null}
        </header>

        {detailLoading ? (
          <EmptyState title="正在加载正文…" />
        ) : detailError ? (
          <EmptyState title="加载失败" desc={detailError} />
        ) : detail ? (
          <article className="melon-article">
            <div className="page-desc" style={{ marginBottom: 12 }}>
              {[detail.author, detail.date, detail.categories.join(', ')].filter(Boolean).join(' · ')}
            </div>
            {detail.blocks.map((block, i) => {
              if (block.type === 'image') {
                return <MelonImage key={i} className="melon-image" url={block.url} />
              }
              if (block.type === 'heading') {
                return (
                  <h3 key={i} className="melon-heading">
                    {block.text}
                  </h3>
                )
              }
              if (block.type === 'text') {
                return (
                  <p key={i} className="melon-text">
                    {block.text}
                  </p>
                )
              }
              return (
                <div key={i} className="melon-video-block">
                  <div className="melon-video">
                    <button
                      className="btn primary"
                      onClick={() =>
                        setPlaying({ url: block.url, title: block.title, blockIndex: i })
                      }
                    >
                      <Play size={15} /> 播放视频
                    </button>
                    <button className="btn" onClick={() => void downloadVideo(block, detail)}>
                      <Download size={14} /> 下载
                    </button>
                    {durations[i] ? (
                      <span className="melon-video-duration">时长 {durations[i]}</span>
                    ) : null}
                  </div>
                  {playing?.blockIndex === i ? (
                    <div className="melon-video-player">
                      <div className="melon-video-player-head">
                        <button
                          className="icon-btn"
                          title="关闭播放"
                          onClick={() => setPlaying(null)}
                        >
                          <X size={15} />
                        </button>
                      </div>
                      <VideoPlayer
                        src={playing.url}
                        resumeKey={`melon|${detail.id}|${playing.title}`}
                      />
                    </div>
                  ) : null}
                </div>
              )
            })}

          </article>
        ) : null}
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        {focusId && onExit ? (
          <button className="btn ghost" onClick={onExit}>
            <ChevronLeft size={15} /> 返回
          </button>
        ) : null}
        <h1 className="page-title">吃瓜</h1>
        <div className="page-actions">
          <ModuleShortcuts onOpenFavorites={onOpenFavorites} onOpenDownloads={onOpenDownloads} />
        </div>
      </header>

      <SearchBar
        value={input}
        onChange={setInput}
        onSubmit={doSearch}
        onCancel={() => {
          requestSeq.current += 1
          setLoading(false)
        }}
        onClear={() => {
          setInput('')
          switchCategory('/')
        }}
        searching={loading && !!keyword}
        placeholder="搜索吃瓜内容…"
      />

      <div className="toolbar">
        {MELON_CATEGORIES.map((c) => (
          <button
            key={c.path}
            className={`chip ${
              keyword ? '' : (pendingPath ?? path) === c.path ? 'active' : ''
            }`}
            onClick={() => switchCategory(c.path)}
          >
            {c.label}
            {counts[c.path] > 0 ? <span className="chip-count">{counts[c.path]}</span> : null}
          </button>
        ))}
      </div>

      {loading ? (
        <EmptyState title="正在加载…" desc="镜像线路响应稍慢，请稍候。" />
      ) : error ? (
        <EmptyState
          title="加载失败"
          desc={error}
          action={
            <button className="btn" onClick={() => void load(path)}>
              重试
            </button>
          }
        />
      ) : !page || page.items.length === 0 ? (
        <EmptyState title={keyword ? '没有搜到内容' : '这个分类暂时没有内容'} desc="换一个分类或关键词再试。" />
      ) : (
        <>
          <div className="media-grid">
            {page.items.map((post) => (
              <button key={post.id} className="media-card" onClick={() => void openDetail(post)}>
                <span className="media-thumb" style={{ aspectRatio: '4 / 3' }}>
                  <MelonImage url={post.cover} />
                  <span
                    className={`fav-heart ${favOf(post.id) ? 'on' : ''}`}
                    role="button"
                    title={favOf(post.id) ? '取消收藏' : '收藏'}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFav(post)
                    }}
                  >
                    <Heart size={15} fill={favOf(post.id) ? 'currentColor' : 'none'} />
                  </span>
                </span>
                <span className="media-title" style={{ WebkitLineClamp: 3 }}>
                  {post.title}
                </span>
                <span className="media-meta">
                  {[post.author, post.date].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
          </div>

          <Pagination
            page={pageNum}
            lastPage={page.lastPage ?? (page.nextPath ? 0 : 1)}
            hasMore={!!page.nextPath}
            disabled={loading}
            onChange={gotoPage}
          />
        </>
      )}
    </>
  )
}
