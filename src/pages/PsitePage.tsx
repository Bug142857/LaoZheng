import { useEffect, useState } from 'react'
import { ChevronLeft, Download, Heart, Play, Search } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, Modal } from '../components/ui'
import { VideoPlayer } from '../components/VideoPlayer'
import { P_CATEGORIES, P_SORTS, formatDuration, type PVideo } from '../shared/psite'

interface PCache {
  sort: string
  catId: number
  query: string
  page: number
  lastPage: number
  items: PVideo[]
}

const cache: PCache = {
  sort: 'recommended',
  catId: 0,
  query: '',
  page: 1,
  lastPage: 0,
  items: []
}

const mediaCache = new Map<string, string>()

export function PsitePage({
  onNotice,
  focus
}: {
  onNotice: (text: string) => void
  focus?: { id: string; title: string; subtitle: string; cover: string | null; durationSec: number }
}) {
  const { data, update } = useData()
  const [sort, setSort] = useState(cache.sort)
  const [catId, setCatId] = useState(cache.catId)
  const [query, setQuery] = useState(cache.query)
  const [input, setInput] = useState(cache.query)
  const [page, setPage] = useState(cache.page)
  const [lastPage, setLastPage] = useState(cache.lastPage)
  const [items, setItems] = useState<PVideo[]>(cache.items)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<PVideo | null>(null)
  const [resolving, setResolving] = useState(false)
  const [playing, setPlaying] = useState<{ video: PVideo; url: string } | null>(null)

  const load = async (nextSort: string, nextCat: number, nextQuery: string, nextPage: number) => {
    setLoading(true)
    setError(null)
    const res = await window.laozheng.pList(nextSort, nextCat, nextQuery, nextPage)
    setLoading(false)
    if (!res.ok) {
      setError(res.error ?? '加载失败')
      return
    }
    setItems(res.items)
    setLastPage(res.lastPage)
    setPage(nextPage)
    setSort(nextSort)
    setCatId(nextCat)
    setQuery(nextQuery)
    Object.assign(cache, {
      sort: nextSort,
      catId: nextCat,
      query: nextQuery,
      page: nextPage,
      lastPage: res.lastPage,
      items: res.items
    })
  }

  useEffect(() => {
    if (!cache.items.length) void load(cache.sort, cache.catId, cache.query, 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!focus?.id) return
    setDetail({
      vkey: focus.id,
      title: focus.title,
      thumbnail: focus.cover,
      durationSec: focus.durationSec,
      views: '',
      uploader: focus.subtitle
    })
  }, [focus?.id])

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

  const resolve = async (video: PVideo): Promise<string | null> => {
    const cached = mediaCache.get(video.vkey)
    if (cached) return cached
    setResolving(true)
    const res = await window.laozheng.pResolve(video.vkey)
    setResolving(false)
    if (!res.ok || !res.url) {
      onNotice(`获取播放地址失败：${res.error ?? '未知错误'}`)
      return null
    }
    mediaCache.set(video.vkey, res.url)
    return res.url
  }

  const play = async (video: PVideo) => {
    const url = await resolve(video)
    if (!url) return
    setDetail(null)
    setPlaying({ video, url })
  }

  const download = async (video: PVideo) => {
    const url = await resolve(video)
    if (!url) return
    const res = await window.laozheng.addDownload({
      title: video.title,
      url,
      kind: 'video',
      coverUrl: video.thumbnail ?? '',
      sourceName: 'P站'
    })
    onNotice(res.ok ? '已加入下载队列' : `下载失败：${res.error}`)
  }

  if (playing) {
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={() => setPlaying(null)}>
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
        <VideoPlayer src={playing.url} />
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">P站</h1>
        <span className="page-desc">列表 / 搜索 / 播放 · 需要外网环境</span>
      </header>

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          void load(sort, catId, input.trim(), 1)
        }}
      >
        <label className="search">
          <Search size={16} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="搜索视频关键词…"
          />
        </label>
        <button className="btn primary" type="submit" disabled={loading}>
          搜索
        </button>
        {query ? (
          <button
            className="btn ghost"
            onClick={() => {
              setInput('')
              void load(sort, catId, '', 1)
            }}
          >
            清除搜索
          </button>
        ) : null}
      </form>

      {!query && (
        <div className="toolbar">
          {P_SORTS.map((s) => (
            <button
              key={s.code || 'new'}
              className={`chip ${sort === s.code ? 'active' : ''}`}
              onClick={() => void load(s.code, catId, '', 1)}
            >
              {s.label}
            </button>
          ))}
          <select
            className="select-inline"
            value={catId}
            onChange={(e) => void load(sort, Number(e.target.value), '', 1)}
          >
            <option value={0}>全部分类</option>
            {P_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <EmptyState title="正在加载视频列表…" desc="列表页较大，通常需要几秒。" />
      ) : error ? (
        <EmptyState
          title="加载失败"
          desc={error}
          action={
            <button className="btn" onClick={() => void load(sort, catId, query, page)}>
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
              <button key={video.vkey} className="media-card" onClick={() => setDetail(video)}>
                <span className="media-thumb">
                  {video.thumbnail ? <img src={video.thumbnail} alt="" loading="lazy" /> : null}
                  <span className="media-duration">{formatDuration(video.durationSec)}</span>
                </span>
                <span className="media-title">{video.title}</span>
                <span className="media-meta">
                  {[video.uploader, video.views].filter(Boolean).join(' · ') || '—'}
                </span>
              </button>
            ))}
          </div>

          <div className="toolbar" style={{ marginTop: 14 }}>
            <button
              className="btn"
              disabled={page <= 1}
              onClick={() => void load(sort, catId, query, page - 1)}
            >
              上一页
            </button>
            <span className="page-desc">第 {page} 页{lastPage ? ` / 约 ${lastPage} 页` : ''}</span>
            <button
              className="btn"
              disabled={lastPage > 0 && page >= lastPage}
              onClick={() => void load(sort, catId, query, page + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}

      {detail && (
        <Modal
          title="视频详情"
          onClose={() => setDetail(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setDetail(null)}>
                关闭
              </button>
              <button className="btn" disabled={resolving} onClick={() => void download(detail)}>
                <Download size={14} /> {resolving ? '解析中…' : '下载'}
              </button>
              <button className="btn" onClick={() => toggleFav(detail)}>
                <Heart size={14} fill={favOf(detail) ? 'currentColor' : 'none'} />{' '}
                {favOf(detail) ? '已收藏' : '收藏'}
              </button>
              <button className="btn primary" disabled={resolving} onClick={() => void play(detail)}>
                <Play size={14} /> {resolving ? '解析中…' : '播放'}
              </button>
            </>
          }
        >
          <div className="detail-head">
            <div className="detail-cover" style={{ width: 160, height: 90, flexBasis: 160 }}>
              {detail.thumbnail ? <img src={detail.thumbnail} alt="" /> : null}
            </div>
            <div className="detail-meta">
              <div className="row-title" style={{ whiteSpace: 'normal' }}>
                {detail.title}
              </div>
              <div>{detail.uploader || '未知频道'}</div>
              <div>{[detail.views, formatDuration(detail.durationSec)].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
