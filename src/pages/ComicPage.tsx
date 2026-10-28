import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Heart, ListPlus, Search } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState } from '../components/ui'
import {
  KOMIIC_PAGE_SIZE,
  komiicStatusLabel,
  type KomiicCategory,
  type KomiicChapter,
  type KomiicComic
} from '../shared/komiic'

type Mode = 'recent' | 'hot' | 'category' | 'search'

interface ListCache {
  mode: Mode
  categoryId: string
  query: string
  items: KomiicComic[]
  offset: number
  hasMore: boolean
  loaded: boolean
}

const cache: ListCache = {
  mode: 'recent',
  categoryId: '',
  query: '',
  items: [],
  offset: 0,
  hasMore: true,
  loaded: false
}

let categoryCache: KomiicCategory[] = []

interface DetailState {
  comic: KomiicComic
  chapters: KomiicChapter[]
  loading: boolean
  error: string | null
}

interface ReaderState {
  comic: KomiicComic
  chapter: KomiicChapter
  urls: string[]
  loading: boolean
  error: string | null
}

export function ComicPage({ onNotice }: { onNotice: (text: string) => void }) {
  const { data, update } = useData()
  const [categories, setCategories] = useState<KomiicCategory[]>(categoryCache)
  const [mode, setMode] = useState<Mode>(cache.mode)
  const [categoryId, setCategoryId] = useState(cache.categoryId)
  const [query, setQuery] = useState(cache.query)
  const [input, setInput] = useState(cache.query)
  const [items, setItems] = useState<KomiicComic[]>(cache.items)
  const [offset, setOffset] = useState(cache.offset)
  const [hasMore, setHasMore] = useState(cache.hasMore)
  const [loading, setLoading] = useState(!cache.loaded)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [reader, setReader] = useState<ReaderState | null>(null)
  const readerRef = useRef<HTMLDivElement | null>(null)

  const fetchPage = async (
    nextMode: Mode,
    nextCategoryId: string,
    nextQuery: string,
    nextOffset: number
  ) => {
    if (nextMode === 'recent') return window.laozheng.komiicRecent(nextOffset)
    if (nextMode === 'hot') return window.laozheng.komiicHot(nextOffset)
    if (nextMode === 'category') return window.laozheng.komiicByCategory(nextCategoryId, nextOffset)
    return window.laozheng.komiicSearch(nextQuery, nextOffset)
  }

  const load = async (
    nextMode: Mode,
    nextCategoryId: string,
    nextQuery: string,
    append: boolean
  ) => {
    const nextOffset = append ? offset : 0
    setLoading(true)
    setError(null)
    const res = await fetchPage(nextMode, nextCategoryId, nextQuery, nextOffset)
    setLoading(false)
    if (!res.ok) {
      setError(res.error ?? '加载失败')
      return
    }
    const merged = append ? [...items, ...res.items] : res.items
    const nextHasMore = res.items.length >= KOMIIC_PAGE_SIZE
    setItems(merged)
    setHasMore(nextHasMore)
    setOffset(merged.length)
    setMode(nextMode)
    setCategoryId(nextCategoryId)
    setQuery(nextQuery)
    Object.assign(cache, {
      mode: nextMode,
      categoryId: nextCategoryId,
      query: nextQuery,
      items: merged,
      offset: merged.length,
      hasMore: nextHasMore,
      loaded: true
    })
  }

  useEffect(() => {
    if (!cache.loaded) void load(cache.mode, cache.categoryId, cache.query, false)
    if (!categoryCache.length) {
      void window.laozheng.komiicCategories().then((res) => {
        if (!res.ok) return
        categoryCache = res.items
        setCategories(res.items)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (reader) readerRef.current?.scrollIntoView({ block: 'start' })
  }, [reader])

  const favOf = (id: string) => data.innerFavs.some((f) => f.module === 'comic' && f.id === id)

  const toggleFav = (comic: KomiicComic) => {
    const exists = favOf(comic.id)
    update((d) => {
      if (exists) {
        return {
          ...d,
          innerFavs: d.innerFavs.filter((f) => !(f.module === 'comic' && f.id === comic.id))
        }
      }
      return {
        ...d,
        innerFavs: [
          ...d.innerFavs,
          {
            module: 'comic',
            id: comic.id,
            title: comic.title,
            subtitle: [
              comic.authors.map((a) => a.name).join(' / '),
              komiicStatusLabel(comic.status)
            ]
              .filter(Boolean)
              .join(' · '),
            cover: comic.imageUrl || null,
            savedAt: Date.now(),
            videoUrl: null,
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

  const openDetail = async (comic: KomiicComic) => {
    setDetail({ comic, chapters: [], loading: true, error: null })
    const [detailRes, chapterRes] = await Promise.all([
      window.laozheng.komiicDetail(comic.id),
      window.laozheng.komiicChapters(comic.id)
    ])
    const merged = detailRes.ok && detailRes.comic ? detailRes.comic : comic
    setDetail({
      comic: merged,
      chapters: chapterRes.ok ? chapterRes.items : [],
      loading: false,
      error: detailRes.ok
        ? chapterRes.ok
          ? null
          : chapterRes.error ?? '章节加载失败'
        : detailRes.error ?? '详情加载失败'
    })
  }

  const openChapter = async (chapter: KomiicChapter) => {
    const comic = detail?.comic
    if (!comic) return
    setReader({ comic, chapter, urls: [], loading: true, error: null })
    const res = await window.laozheng.komiicImages(comic.id, chapter.id)
    setReader({
      comic,
      chapter,
      urls: res.ok ? res.urls : [],
      loading: false,
      error: res.ok ? (res.urls.length ? null : '本章没有图片') : res.error ?? '图片加载失败'
    })
  }

  const stepChapter = (delta: number) => {
    if (!detail || !reader) return
    const index = detail.chapters.findIndex((c) => c.id === reader.chapter.id)
    const next = detail.chapters[index + delta]
    if (next) void openChapter(next)
  }

  if (reader) {
    const index = detail?.chapters.findIndex((c) => c.id === reader.chapter.id) ?? -1
    const hasPrev = index > 0
    const hasNext = index >= 0 && index < (detail?.chapters.length ?? 0) - 1
    return (
      <div ref={readerRef}>
        <header className="page-header">
          <button className="btn ghost" onClick={() => setReader(null)}>
            <ChevronLeft size={15} /> 返回章节
          </button>
          <h1 className="page-title">{reader.comic.title}</h1>
          <span className="page-desc">
            {reader.chapter.serial ? `第 ${reader.chapter.serial} 话` : reader.chapter.id}
            {reader.chapter.size ? ` · ${reader.chapter.size} 张` : ''}
          </span>
          <div className="page-actions">
            <button className="btn" disabled={!hasPrev} onClick={() => stepChapter(-1)}>
              上一话
            </button>
            <button className="btn" disabled={!hasNext} onClick={() => stepChapter(1)}>
              下一话
            </button>
          </div>
        </header>

        {reader.loading ? (
          <EmptyState title="正在加载章节图片…" />
        ) : reader.error ? (
          <EmptyState
            title="加载失败"
            desc={reader.error}
            action={
              <button className="btn" onClick={() => void openChapter(reader.chapter)}>
                重试
              </button>
            }
          />
        ) : (
          <div className="reader">
            {reader.urls.map((url, i) => (
              <img key={`${url}-${i}`} src={url} alt={`第 ${i + 1} 页`} loading="lazy" />
            ))}
            <div className="reader-footer">
              <button className="btn" disabled={!hasPrev} onClick={() => stepChapter(-1)}>
                上一话
              </button>
              <button className="btn" disabled={!hasNext} onClick={() => stepChapter(1)}>
                下一话
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (detail) {
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={() => setDetail(null)}>
            <ChevronLeft size={15} /> 返回列表
          </button>
          <h1 className="page-title">{detail.comic.title}</h1>
          <div className="page-actions">
            <button className="btn" onClick={() => toggleFav(detail.comic)}>
              <Heart size={15} fill={favOf(detail.comic.id) ? 'currentColor' : 'none'} />{' '}
              {favOf(detail.comic.id) ? '已收藏' : '收藏'}
            </button>
          </div>
        </header>

        <div className="comic-detail">
          <div className="comic-detail-cover">
            {detail.comic.imageUrl ? <img src={detail.comic.imageUrl} alt="" /> : null}
          </div>
          <div className="comic-detail-info">
            <div className="row-title" style={{ whiteSpace: 'normal' }}>
              {detail.comic.title}
            </div>
            <div className="comic-meta">
              {[
                detail.comic.authors.map((a) => a.name).join(' / '),
                komiicStatusLabel(detail.comic.status),
                detail.comic.views ? `${detail.comic.views} 浏览` : '',
                detail.comic.favoriteCount ? `${detail.comic.favoriteCount} 收藏` : ''
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {detail.comic.categories.length ? (
              <div className="comic-tags">
                {detail.comic.categories.map((c) => (
                  <span key={c.id} className="badge">
                    {c.name}
                  </span>
                ))}
              </div>
            ) : null}
            {detail.comic.lastChapterUpdate ? (
              <div className="comic-meta">最新：{detail.comic.lastChapterUpdate}</div>
            ) : null}
          </div>
        </div>

        {detail.loading ? (
          <EmptyState title="正在加载章节…" />
        ) : detail.error ? (
          <EmptyState
            title="章节加载失败"
            desc={detail.error}
            action={
              <button className="btn" onClick={() => void openDetail(detail.comic)}>
                重试
              </button>
            }
          />
        ) : detail.chapters.length === 0 ? (
          <EmptyState title="没有章节" desc="该漫画暂无可用章节。" />
        ) : (
          <div className="chapter-grid">
            {detail.chapters.map((chapter) => (
              <button
                key={chapter.id}
                className="chapter-chip"
                onClick={() => void openChapter(chapter)}
              >
                {chapter.serial ? `第 ${chapter.serial} 话` : `章节 ${chapter.id}`}
                {chapter.size ? <span className="chapter-size">{chapter.size}P</span> : null}
              </button>
            ))}
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">漫画</h1>
        <span className="page-desc">Komiic · 内置账号自动登录 · 章节图自动带鉴权</span>
      </header>

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          const keyword = input.trim()
          if (keyword) void load('search', '', keyword, false)
        }}
      >
        <label className="search">
          <Search size={16} />
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="搜索漫画关键词…" />
        </label>
        <button className="btn primary" type="submit" disabled={loading}>
          搜索
        </button>
        {query ? (
          <button
            className="btn ghost"
            onClick={() => {
              setInput('')
              void load('recent', '', '', false)
            }}
          >
            清除搜索
          </button>
        ) : null}
      </form>

      {!query && (
        <>
          <div className="toolbar">
            <button
              className={`chip ${mode === 'recent' ? 'active' : ''}`}
              onClick={() => void load('recent', '', '', false)}
            >
              最近更新
            </button>
            <button
              className={`chip ${mode === 'hot' ? 'active' : ''}`}
              onClick={() => void load('hot', '', '', false)}
            >
              热门
            </button>
          </div>
          {categories.length ? (
            <div className="toolbar">
              {categories.map((c) => (
                <button
                  key={c.id}
                  className={`chip ${mode === 'category' && categoryId === c.id ? 'active' : ''}`}
                  onClick={() => void load('category', c.id, '', false)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}

      {loading && items.length === 0 ? (
        <EmptyState title="正在加载漫画列表…" />
      ) : error ? (
        <EmptyState
          title="加载失败"
          desc={error}
          action={
            <button className="btn" onClick={() => void load(mode, categoryId, query, false)}>
              重试
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState title="没有找到漫画" desc="换个关键词或分类再试。" />
      ) : (
        <>
          <div className="comic-grid">
            {items.map((comic) => (
              <button key={comic.id} className="comic-card" onClick={() => void openDetail(comic)}>
                <span className="comic-cover">
                  {comic.imageUrl ? <img src={comic.imageUrl} alt="" loading="lazy" /> : null}
                  <span className="comic-badge">{komiicStatusLabel(comic.status)}</span>
                </span>
                <span className="comic-title">{comic.title}</span>
                <span className="comic-sub">
                  {comic.authors.map((a) => a.name).join(' / ') || comic.categories.map((c) => c.name).join(' · ') || '—'}
                </span>
              </button>
            ))}
          </div>

          <div className="toolbar" style={{ marginTop: 14 }}>
            <button
              className="btn"
              disabled={loading || !hasMore}
              onClick={() => void load(mode, categoryId, query, true)}
            >
              <ListPlus size={14} /> {loading ? '加载中…' : hasMore ? '加载更多' : '已到末尾'}
            </button>
            <span className="page-desc">已加载 {items.length} 部</span>
          </div>
        </>
      )}
    </>
  )
}
