import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Download, Heart } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, LoadingBlock, ModuleShortcuts, Pagination } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { VideoPlayer } from '../components/VideoPlayer'
import { loadCache, saveCache } from '../utils/cache'
import { requestDownload } from '../utils/download'
import { P_CATEGORIES, formatDuration, type PVideo } from '../shared/psite'

interface PCache {
  sort: string
  catId: number
  query: string
  page: number
  lastPage: number
  hasMore: boolean
  items: PVideo[]
}

const EMPTY_P_CACHE: PCache = {
  sort: 'recommended',
  catId: 0,
  query: '',
  page: 1,
  lastPage: 0,
  hasMore: true,
  items: []
}

const cache: PCache = (() => {
  const cached = loadCache<PCache>('psite', EMPTY_P_CACHE)
  // 重开应用回到「推荐 + 第一页」；默认列表缓存仍直接显示
  if (cached.catId !== 0 || cached.query || cached.page !== 1) return { ...EMPTY_P_CACHE }
  return cached
})()

const mediaCache = new Map<string, { url: string; fallbackUrl?: string; at: number }>()
/** 媒体直链带签名，10 分钟后失效，不能一直复用 */
const MEDIA_TTL = 10 * 60 * 1000

export function PsitePage({
  onNotice,
  focus,
  resetSignal,
  onExit,
  onOpenFavorites,
  onOpenDownloads
}: {
  onNotice: (text: string) => void
  focus?: { id: string; title: string; subtitle: string; cover: string | null; durationSec: number }
  resetSignal?: number
  /** 从收藏进入时，播放页返回走全局上一页 */
  onExit?: () => void
  onOpenFavorites?: () => void
  onOpenDownloads?: () => void
}) {
  const { data, update } = useData()
  const [catId, setCatId] = useState(cache.catId)
  const [query, setQuery] = useState(cache.query)
  const [input, setInput] = useState(cache.query)
  const [page, setPage] = useState(cache.page)
  const [items, setItems] = useState<PVideo[]>(cache.items)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<{
    video: PVideo
    url: string
    fallbackUrl?: string
  } | null>(null)
  const [hasMore, setHasMore] = useState(cache.hasMore)
  const [pendingCat, setPendingCat] = useState<number | null>(null)
  /** 从收藏进入时先显示解析中的页面，避免闪一下搜索界面 */
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  /** 播放失败自动换一条新签名线路重试（每次播放只重试一次） */
  const [playbackNonce, setPlaybackNonce] = useState(0)
  const retriedRef = useRef(false)
  const requestSeq = useRef(0)

  useEffect(() => {
    if (resetSignal === undefined) return
    setPlaying(null)
    setOpening(false)
    setOpenError(null)
    retriedRef.current = false
  }, [resetSignal])

  /** 进入播放页时回到顶部：避免还停在列表的滚动位置 */
  useEffect(() => {
    if (!playing) return
    document.querySelector<HTMLElement>('.content')?.scrollTo({ top: 0 })
  }, [playing])

  const load = async (nextCat: number, nextQuery: string, nextPage: number) => {
    const seq = ++requestSeq.current
    setPendingCat(nextCat)
    setLoading(true)
    setError(null)
    const res = await window.laozheng.pList('recommended', nextCat, nextQuery, nextPage)
    if (seq !== requestSeq.current) return
    setPendingCat(null)
    setLoading(false)
    if (!res.ok) {
      setError(res.error ?? '加载失败')
      return
    }
    setItems(res.items)
    setHasMore(res.hasMore)
    setPage(nextPage)
    setCatId(nextCat)
    setQuery(nextQuery)
    Object.assign(cache, {
      sort: 'recommended',
      catId: nextCat,
      query: nextQuery,
      page: nextPage,
      lastPage: res.lastPage,
      hasMore: res.hasMore,
      items: res.items
    })
    // 只把「推荐 + 第一页」写进本地缓存，重开应用才能立刻显示
    if (nextCat === 0 && !nextQuery && nextPage === 1) {
      saveCache<PCache>('psite', { ...cache })
    }
  }

  useEffect(() => {
    if (!cache.items.length) void load(cache.catId, cache.query, 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const favOf = (video: PVideo) =>
    data.innerFavs.find((f) => f.module === 'psite' && f.id === video.vkey)

  const toggleFav = (video: PVideo) => {
    const exists = !!favOf(video)
    update((d) => {
      if (exists) {
        return { ...d, innerFavs: d.innerFavs.filter((f) => !(f.module === 'psite' && f.id === video.vkey)) }
      }
      return {
        ...d,
        innerFavs: [
          ...d.innerFavs,
          {
            module: 'psite',
            id: video.vkey,
            title: video.title,
            subtitle: [video.uploader, video.views].filter(Boolean).join(' · '),
            cover: video.thumbnail,
            savedAt: Date.now(),
            videoUrl: null,
            mediaId: 0,
            durationSec: video.durationSec,
            tweetUrl: null,
            payload: null
          }
        ]
      }
    })
    onNotice(exists ? '已取消收藏' : '已收藏，可在「收藏」页查看')
  }

  const resolve = async (
    video: PVideo
  ): Promise<{ url: string; fallbackUrl?: string } | null> => {
    const cached = mediaCache.get(video.vkey)
    if (cached && Date.now() - cached.at < MEDIA_TTL) return cached
    if (cached) mediaCache.delete(video.vkey)
    onNotice('正在解析播放线路…')
    const res = await window.laozheng.pResolve(video.vkey)
    if (!res.ok || !res.url) {
      onNotice(`获取播放地址失败：${res.error ?? '未知错误'}`)
      return null
    }
    const media = { url: res.url, fallbackUrl: res.fallbackUrl, at: Date.now() }
    mediaCache.set(video.vkey, media)
    return media
  }

  const play = async (video: PVideo, alive?: () => boolean): Promise<boolean> => {
    const media = await resolve(video)
    if (!media) return false
    if (alive && !alive()) return false
    retriedRef.current = false
    setPlaying({ video, url: media.url, fallbackUrl: media.fallbackUrl })
    return true
  }

  // 从收藏进入：先显示解析中，解析完成直接进播放页，不再先闪一下列表
  useEffect(() => {
    if (!focus?.id) {
      setOpening(false)
      setOpenError(null)
      return
    }
    let alive = true
    setOpening(true)
    setOpenError(null)
    setPlaying(null)
    retriedRef.current = false
    void (async () => {
      const ok = await play(
        {
          vkey: focus.id,
          title: focus.title,
          thumbnail: focus.cover,
          durationSec: focus.durationSec,
          views: '',
          uploader: focus.subtitle
        },
        () => alive
      )
      if (!alive) return
      setOpening(false)
      if (!ok) setOpenError('获取播放地址失败，请稍后重试或换一个网络节点')
    })()
    return () => {
      alive = false
      setPlaying(null)
      setOpening(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.id])

  const download = async (video: PVideo) => {
    const media = await resolve(video)
    if (!media) return
    requestDownload({
      title: video.title,
      url: media.url,
      kind: 'video',
      coverUrl: video.thumbnail ?? '',
      sourceName: 'P站',
      durationSec: video.durationSec
    })
  }

  if ((opening || openError) && !playing) {
    return (
      <>
        <header className="page-header">
          <button
            className="btn ghost"
            onClick={() => {
              setOpening(false)
              setOpenError(null)
              if (focus?.id && onExit) onExit()
            }}
          >
            <ChevronLeft size={15} /> 返回
          </button>
          <h1 className="page-title">{focus?.title ?? 'P站视频'}</h1>
        </header>
        {opening ? (
          <EmptyState title="正在解析播放线路…" desc="正在探测可用的清晰度，请稍等。" />
        ) : (
          <EmptyState title="打开失败" desc={openError ?? '请稍后重试'} />
        )}
      </>
    )
  }

  if (playing) {
    return (
      <>
        <header className="page-header">
          <button
            className="btn ghost"
            onClick={() => {
              // 先关掉播放页再返回，避免返回上一页后又回到播放页
              setPlaying(null)
              if (focus?.id && onExit) onExit()
            }}
          >
            <ChevronLeft size={15} /> 返回
          </button>
          <h1 className="page-title">{playing.video.title}</h1>
          <span className="page-desc">
            P站 · {playing.video.uploader || '未知频道'} · {formatDuration(playing.video.durationSec)}
          </span>
          <div className="page-actions">
            <button className="btn" onClick={() => void download(playing.video)}>
              <Download size={15} /> 下载
            </button>
            <button className="btn" onClick={() => toggleFav(playing.video)}>
              <Heart size={15} fill={favOf(playing.video) ? 'currentColor' : 'none'} />{' '}
              {favOf(playing.video) ? '已收藏' : '收藏'}
            </button>
          </div>
        </header>
        <VideoPlayer
          key={`${playing.video.vkey}-${playbackNonce}`}
          src={playing.url}
          fallbackSrc={playing.fallbackUrl}
          resumeKey={`psite|${playing.video.title}`}
          onFail={(msg) => {
            // P站媒体签名会失效：第一次失败自动重新解析一次（新签名），仍失败再提示
            mediaCache.delete(playing.video.vkey)
            if (!retriedRef.current) {
              retriedRef.current = true
              onNotice('播放线路失效，正在重新解析…')
              void (async () => {
                const media = await resolve(playing.video)
                if (!media) {
                  onNotice(`${msg}（重新解析失败）`)
                  return
                }
                setPlaying({
                  video: playing.video,
                  url: media.url,
                  fallbackUrl: media.fallbackUrl
                })
                setPlaybackNonce((value) => value + 1)
              })()
              return
            }
            onNotice(msg)
          }}
        />
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        {focus?.id && onExit ? (
          <button className="btn ghost" onClick={onExit}>
            <ChevronLeft size={15} /> 返回
          </button>
        ) : null}
        <h1 className="page-title">P站</h1>
        <div className="page-actions">
          <ModuleShortcuts onOpenFavorites={onOpenFavorites} onOpenDownloads={onOpenDownloads} />
        </div>
      </header>

      <SearchBar
        value={input}
        onChange={setInput}
        onSubmit={() => void load(catId, input.trim(), 1)}
        onCancel={() => {
          requestSeq.current += 1
          setLoading(false)
        }}
        onClear={() => {
          setInput('')
          void load(catId, '', 1)
        }}
        searching={loading && !!query}
        placeholder="搜索视频关键词…"
      />

      {!query && (
        <div className="toolbar">
          <button
            className={`chip ${(pendingCat ?? catId) === 0 ? 'active' : ''}`}
            onClick={() => void load(0, '', 1)}
          >
            推荐
          </button>
          {P_CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`chip ${(pendingCat ?? catId) === c.id ? 'active' : ''}`}
              onClick={() => void load(c.id, '', 1)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {loading && items.length > 0 ? <LoadingBlock text="正在切换，请稍等…" /> : null}

      {loading && items.length === 0 ? (
        <EmptyState title="正在加载视频列表…" desc="列表页较大，通常需要几秒。" />
      ) : error ? (
        <EmptyState
          title="加载失败"
          desc={error}
          action={
            <button className="btn" onClick={() => void load(catId, query, page)}>
              重试
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState title="没有找到视频" desc="换个关键词、分类或排序再试。" />
      ) : (
        <>
          <div className="media-grid">
            {items.map((video) => (
              <button key={video.vkey} className="media-card" onClick={() => void play(video)}>
                <span className="media-thumb">
                  {video.thumbnail ? <img src={video.thumbnail} alt="" loading="lazy" /> : null}
                  <span className="media-duration">{formatDuration(video.durationSec)}</span>
                  <span
                    className={`fav-heart ${favOf(video) ? 'on' : ''}`}
                    role="button"
                    title={favOf(video) ? '取消收藏' : '收藏'}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFav(video)
                    }}
                  >
                    <Heart size={15} fill={favOf(video) ? 'currentColor' : 'none'} />
                  </span>
                </span>
                <span className="media-title">{video.title}</span>
                <span className="media-meta">
                  {[video.uploader, video.views].filter(Boolean).join(' · ') || '—'}
                </span>
              </button>
            ))}
          </div>

          <Pagination
            page={page}
            lastPage={0}
            hasMore={hasMore}
            showLast={false}
            disabled={loading}
            onChange={(next) => void load(catId, query, next)}
          />
        </>
      )}
    </>
  )
}
