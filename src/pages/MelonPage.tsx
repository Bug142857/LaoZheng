import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Download, Heart, Play, Search } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState } from '../components/ui'
import { VideoPlayer } from '../components/VideoPlayer'
import {
  MELON_CATEGORIES,
  type MelonBlock,
  type MelonDetail,
  type MelonPage,
  type MelonPost
} from '../shared/melon'

interface Playing {
  url: string
  title: string
  post: MelonDetail | MelonPost
}

export function MelonPage({ onNotice }: { onNotice: (text: string) => void }) {
  const { data, update } = useData()
  const [path, setPath] = useState('/')
  const [input, setInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState<MelonPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<MelonDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<Playing | null>(null)
  const historyRef = useRef<string[]>([])

  const load = async (nextPath: string) => {
    setLoading(true)
    setError(null)
    const res = await window.laozheng.melonList(nextPath)
    setLoading(false)
    if (!res.ok || !res.page) {
      setError(res.error ?? '加载失败')
      return
    }
    setPage(res.page)
    setPath(nextPath)
  }

  useEffect(() => {
    void load('/')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchCategory = (next: string) => {
    historyRef.current = []
    setKeyword('')
    setInput('')
    void load(next)
  }

  const doSearch = () => {
    const kw = input.trim()
    if (!kw) return
    historyRef.current = []
    setKeyword(kw)
    void load(`/search/${encodeURIComponent(kw)}/`)
  }

  const nextPage = () => {
    if (!page?.nextPath) return
    historyRef.current.push(path)
    void load(page.nextPath)
  }

  const prevPage = () => {
    const prev = historyRef.current.pop()
    if (prev) void load(prev)
  }

  const openDetail = async (post: MelonPost | { id: string }) => {
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    const res = await window.laozheng.melonDetail(post.id)
    setDetailLoading(false)
    if (!res.ok || !res.detail) {
      setDetailError(res.error ?? '加载失败')
      return
    }
    setDetail(res.detail)
  }

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

  const downloadVideo = async (block: Extract<MelonBlock, { type: 'video' }>, post: MelonDetail) => {
    const res = await window.laozheng.addDownload({
      title: `${post.title} ${block.title}`.trim().slice(0, 120),
      url: block.url,
      kind: 'video',
      coverUrl: post.cover ?? '',
      sourceName: '吃瓜'
    })
    onNotice(res.ok ? '已加入下载队列' : `下载失败：${res.error}`)
  }

  if (playing) {
    const fav = favOf(playing.post.id)
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={() => setPlaying(null)}>
            <ChevronLeft size={15} /> 返回
          </button>
          <h1 className="page-title">{playing.title}</h1>
          <span className="page-desc">吃瓜 · 视频</span>
          <div className="page-actions">
            <button className="btn" onClick={() => void downloadVideo({ type: 'video', title: playing.title, url: playing.url }, detailForDownload(playing))}>
              <Download size={15} /> 下载
            </button>
            <button className="btn" onClick={() => toggleFav(playing.post, playing.url)}>
              <Heart size={15} fill={fav ? 'currentColor' : 'none'} /> {fav ? '已收藏' : '收藏'}
            </button>
          </div>
        </header>
        <VideoPlayer src={playing.url} />
      </>
    )
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
              setDetail(null)
              setDetailError(null)
              setDetailLoading(false)
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
                return (
                  <img
                    key={i}
                    className="melon-image"
                    src={block.url}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                    }}
                  />
                )
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
                <div key={i} className="melon-video">
                  <button className="btn primary" onClick={() => setPlaying({ url: block.url, title: block.title, post: detail })}>
                    <Play size={15} /> 播放视频
                  </button>
                  <button className="btn" onClick={() => void downloadVideo(block, detail)}>
                    <Download size={14} /> 下载
                  </button>
                </div>
              )
            })}

            {detail.related.length > 0 ? (
              <>
                <h3 className="melon-heading">相关推荐</h3>
                <div className="rows">
                  {detail.related.map((r) => (
                    <div key={r.id} className="row clickable" onClick={() => void openDetail(r)}>
                      <div className="row-main">
                        <div className="row-title">{r.title}</div>
                      </div>
                      <span className="badge">查看</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </article>
        ) : null}
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">吃瓜</h1>
        <span className="page-desc">51爆料 · 镜像自动选线 · 视频可播放与下载</span>
      </header>

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          doSearch()
        }}
      >
        <label className="search">
          <Search size={16} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="搜索吃瓜内容…"
          />
        </label>
        <button className="btn primary" type="submit" disabled={!input.trim() || loading}>
          搜索
        </button>
      </form>

      <div className="toolbar">
        {MELON_CATEGORIES.map((c) => (
          <button
            key={c.path}
            className={`chip ${keyword ? '' : path === c.path ? 'active' : ''}`}
            onClick={() => switchCategory(c.path)}
          >
            {c.label}
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
                  {post.cover ? <img src={post.cover} alt="" loading="lazy" /> : null}
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

          <div className="toolbar" style={{ marginTop: 14 }}>
            <button className="btn" disabled={historyRef.current.length === 0} onClick={prevPage}>
              上一页
            </button>
            <span className="page-desc">
              {keyword ? `搜索：${keyword}` : `共 ${page.items.length} 条`}
              {page.lastPage ? ` · 第 ${page.lastPage} 页为止` : ''}
            </span>
            <button className="btn" disabled={!page.nextPath} onClick={nextPage}>
              下一页
            </button>
          </div>
        </>
      )}
    </>
  )
}

function detailForDownload(playing: Playing): MelonDetail {
  if ('blocks' in playing.post) return playing.post
  return {
    id: playing.post.id,
    title: playing.post.title,
    cover: playing.post.cover,
    author: playing.post.author,
    date: playing.post.date,
    categories: playing.post.categories,
    blocks: [],
    related: []
  }
}
