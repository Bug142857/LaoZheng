import { useEffect, useState } from 'react'
import { ChevronLeft, Download, Heart, Play } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, Modal } from '../components/ui'
import { VideoPlayer } from '../components/VideoPlayer'
import {
  X_RANGES,
  formatCount,
  formatDuration,
  type XCategory,
  type XDetail,
  type XPost
} from '../shared/xsite'

interface XCache {
  range: string
  category: string
  page: number
  lastPage: number
  total: number
  items: XPost[]
}

const cache: XCache = { range: 'weekly', category: '', page: 1, lastPage: 0, total: 0, items: [] }

export function XSitePage({
  onNotice,
  focusId
}: {
  onNotice: (text: string) => void
  focusId?: string
}) {
  const { data, update } = useData()
  const [range, setRange] = useState(cache.range)
  const [category, setCategory] = useState(cache.category)
  const [page, setPage] = useState(cache.page)
  const [lastPage, setLastPage] = useState(cache.lastPage)
  const [items, setItems] = useState<XPost[]>(cache.items)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState<XCategory[]>([])
  const [detail, setDetail] = useState<XDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<XPost | null>(null)

  const load = async (nextRange: string, nextCategory: string, nextPage: number) => {
    setLoading(true)
    setError(null)
    const res = await window.laozheng.xList(nextRange, nextPage, nextCategory)
    setLoading(false)
    if (!res.ok || !res.page) {
      setError(res.error ?? '加载失败')
      return
    }
    setItems(res.page.items)
    setLastPage(res.page.lastPage)
    setPage(res.page.page)
    setRange(nextRange)
    setCategory(nextCategory)
    Object.assign(cache, {
      range: nextRange,
      category: nextCategory,
      page: res.page.page,
      lastPage: res.page.lastPage,
      total: res.page.total,
      items: res.page.items
    })
  }

  useEffect(() => {
    window.laozheng.xCategories().then((res) => {
      if (res.ok) setCategories(res.items)
    })
    if (!cache.items.length) void load(cache.range, cache.category, 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!focusId) return
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    void window.laozheng.xDetail(focusId).then((res) => {
      setDetailLoading(false)
      if (!res.ok || !res.detail) {
        setDetailError(res.error ?? '加载失败')
        return
      }
      setDetail(res.detail)
    })
  }, [focusId])

  const openDetail = async (post: XPost) => {
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    const res = await window.laozheng.xDetail(post.urlCd)
    setDetailLoading(false)
    if (!res.ok || !res.detail) {
      setDetailError(res.error ?? '加载失败')
      return
    }
    setDetail(res.detail)
  }

  const favOf = (post: XPost) =>
    data.innerFavs.find((f) => f.module === 'xsite' && f.id === post.urlCd)

  const toggleFav = (post: XPost, tags: string[] = []) => {
    const exists = !!favOf(post)
    update((d) => {
      if (exists) {
        return { ...d, innerFavs: d.innerFavs.filter((f) => !(f.module === 'xsite' && f.id === post.urlCd)) }
      }
      return {
        ...d,
        innerFavs: [
          ...d.innerFavs,
          {
            module: 'xsite',
            id: post.urlCd,
            title: post.account ? `@${post.account}` : 'X视频',
            subtitle: tags.length ? tags.join(' · ') : `${formatCount(post.favorite)} 赞`,
            cover: post.thumbnail,
            savedAt: Date.now(),
            videoUrl: post.videoUrl,
            mediaId: post.mediaId,
            durationSec: post.durationSec,
            tweetUrl: post.tweetUrl,
            payload: null
          }
        ]
      }
    })
    onNotice(exists ? '已取消收藏' : '已收藏，可在「收藏」页查看')
  }

  const download = async (post: XPost) => {
    const res = await window.laozheng.addDownload({
      title: post.account ? `X站 @${post.account}` : 'X站视频',
      url: post.videoUrl,
      kind: 'video',
      coverUrl: post.thumbnail ?? '',
      sourceName: 'X站'
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
          <h1 className="page-title">{playing.account ? `@${playing.account}` : 'X站视频'}</h1>
          <span className="page-desc">X站 · {formatDuration(playing.durationSec)}</span>
          <div className="page-actions">
            <button className="btn" onClick={() => void download(playing)}>
              <Download size={15} /> 下载
            </button>
            <button className="btn" onClick={() => toggleFav(playing)}>
              <Heart size={15} fill={favOf(playing) ? 'currentColor' : 'none'} />{' '}
              {favOf(playing) ? '已收藏' : '收藏'}
            </button>
          </div>
        </header>
        <VideoPlayer src={playing.videoUrl} />
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">X站</h1>
        <span className="page-desc">
          排行榜 · {cache.total ? `共 ${formatCount(cache.total)} 条` : '数据来自站点公开接口'}
        </span>
      </header>

      <div className="toolbar">
        {X_RANGES.map((r) => (
          <button
            key={r.code}
            className={`chip ${range === r.code ? 'active' : ''}`}
            onClick={() => void load(r.code, category, 1)}
          >
            {r.label}
          </button>
        ))}
        <select
          className="select-inline"
          value={category}
          onChange={(e) => void load(range, e.target.value, 1)}
        >
          <option value="">全部分类</option>
          {categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <EmptyState title="正在加载排行榜…" />
      ) : error ? (
        <EmptyState
          title="加载失败"
          desc={error}
          action={
            <button className="btn" onClick={() => void load(range, category, page)}>
              重试
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState title="这个分类暂时没有内容" desc="换一个分类或榜单再试。" />
      ) : (
        <>
          <div className="media-grid">
            {items.map((post) => (
              <button key={post.urlCd} className="media-card" onClick={() => void openDetail(post)}>
                <span className="media-thumb">
                  {post.thumbnail ? <img src={post.thumbnail} alt="" loading="lazy" /> : null}
                  <span className="media-duration">{formatDuration(post.durationSec)}</span>
                </span>
                <span className="media-title">{post.account ? `@${post.account}` : 'X视频'}</span>
                <span className="media-meta">
                  {formatCount(post.favorite)} 赞 · {formatCount(post.pv)} 次观看
                </span>
              </button>
            ))}
          </div>

          <div className="toolbar" style={{ marginTop: 14 }}>
            <button className="btn" disabled={page <= 1} onClick={() => void load(range, category, page - 1)}>
              上一页
            </button>
            <span className="page-desc">第 {page} 页{lastPage ? ` / 共 ${lastPage} 页` : ''}</span>
            <button
              className="btn"
              disabled={lastPage > 0 && page >= lastPage}
              onClick={() => void load(range, category, page + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}

      {(detail || detailLoading || detailError) && (
        <Modal
          title={detail?.post.account ? `@${detail.post.account}` : 'X站视频'}
          onClose={() => {
            setDetail(null)
            setDetailError(null)
          }}
          footer={
            <>
              <button className="btn ghost" onClick={() => setDetail(null)}>
                关闭
              </button>
              {detail ? (
                <>
                  <button className="btn" onClick={() => void download(detail.post)}>
                    <Download size={14} /> 下载
                  </button>
                  <button className="btn" onClick={() => toggleFav(detail.post, detail.tags)}>
                    <Heart size={14} fill={favOf(detail.post) ? 'currentColor' : 'none'} />{' '}
                    {favOf(detail.post) ? '已收藏' : '收藏'}
                  </button>
                  <button className="btn primary" onClick={() => setPlaying(detail.post)}>
                    <Play size={14} /> 播放
                  </button>
                </>
              ) : null}
            </>
          }
        >
          {detailLoading ? (
            <p>正在加载详情…</p>
          ) : detailError ? (
            <p>{detailError}</p>
          ) : detail ? (
            <div className="detail-head">
              <div className="detail-cover" style={{ width: 160, height: 90, flexBasis: 160 }}>
                {detail.post.thumbnail ? <img src={detail.post.thumbnail} alt="" /> : null}
              </div>
              <div className="detail-meta">
                <div>时长：{formatDuration(detail.post.durationSec) || '—'}</div>
                <div>
                  赞 {formatCount(detail.post.favorite)} · 观看 {formatCount(detail.post.pv)}
                </div>
                <div>{detail.tags.length ? detail.tags.join(' · ') : '没有标签'}</div>
                {detail.postedAt ? <div className="detail-source">{detail.postedAt.slice(0, 10)}</div> : null}
              </div>
            </div>
          ) : null}
        </Modal>
      )}
    </>
  )
}
