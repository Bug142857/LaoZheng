import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Heart, RefreshCw, Search } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState } from '../components/ui'
import {
  BIKA_SORTS,
  type BikaCategory,
  type BikaChapter,
  type BikaComic
} from '../shared/bika'

interface ListCache {
  category: string
  sort: string
  query: string
  page: number
  pages: number
  items: BikaComic[]
  categories: BikaCategory[]
  loaded: boolean
}

const cache: ListCache = {
  category: '',
  sort: 'dd',
  query: '',
  page: 1,
  pages: 1,
  items: [],
  categories: [],
  loaded: false
}

interface DetailState {
  comic: BikaComic
  chapters: BikaChapter[]
  loading: boolean
  error: string | null
}

interface ReaderState {
  comic: BikaComic
  chapter: BikaChapter
  urls: string[]
  loading: boolean
  error: string | null
}

export function BikaPage({
  onNotice,
  focusId
}: {
  onNotice: (text: string) => void
  focusId?: string
}) {
  const { data, update } = useData()
  const [categories, setCategories] = useState<BikaCategory[]>(cache.categories)
  const [category, setCategory] = useState(cache.category)
  const [sort, setSort] = useState(cache.sort)
  const [query, setQuery] = useState(cache.query)
  const [input, setInput] = useState(cache.query)
  const [page, setPage] = useState(cache.page)
  const [pages, setPages] = useState(cache.pages)
  const [items, setItems] = useState<BikaComic[]>(cache.items)
  const [loading, setLoading] = useState(!cache.loaded)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [reader, setReader] = useState<ReaderState | null>(null)
  const readerRef = useRef<HTMLDivElement | null>(null)

  const load = async (
    nextCategory: string,
    nextSort: string,
    nextQuery: string,
    nextPage: number
  ) => {
    setLoading(true)
    setError(null)
    const res = nextQuery
      ? await window.laozheng.bikaSearch(nextQuery, nextPage, nextSort)
      : await window.laozheng.bikaList(nextPage, nextCategory, nextSort)
    setLoading(false)
    if (!res.ok) {
      setError(res.error ?? '加载失败')
      return
    }
    setItems(res.items)
    setPages(res.pages || 1)
    setPage(nextPage)
    setCategory(nextCategory)
    setSort(nextSort)
    setQuery(nextQuery)
    Object.assign(cache, {
      category: nextCategory,
      sort: nextSort,
      query: nextQuery,
      page: nextPage,
      pages: res.pages || 1,
      items: res.items,
      loaded: true
    })
  }

  useEffect(() => {
    if (!cache.loaded) void load(cache.category, cache.sort, cache.query, 1)
    if (!cache.categories.length) {
      void window.laozheng.bikaCategories().then((res) => {
        if (!res.ok) return
        cache.categories = res.items
        setCategories(res.items)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (reader) readerRef.current?.scrollIntoView({ block: 'start' })
  }, [reader])

  const favOf = (id: string) => data.innerFavs.some((f) => f.module === 'h2' && f.id === id)

  const toggleFav = (comic: BikaComic) => {
    const exists = favOf(comic.id)
    update((d) => {
      if (exists) {
        return { ...d, innerFavs: d.innerFavs.filter((f) => !(f.module === 'h2' && f.id === comic.id)) }
      }
      return {
        ...d,
        innerFavs: [
          ...d.innerFavs,
          {
            module: 'h2',
            id: comic.id,
            title: comic.title,
            subtitle: [comic.author, comic.categories[0]].filter(Boolean).join(' · '),
            cover: comic.thumb || null,
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

  const openDetail = async (comic: BikaComic) => {
    setDetail({ comic, chapters: [], loading: true, error: null })
    const [detailRes, chapterRes] = await Promise.all([
      window.laozheng.bikaDetail(comic.id),
      window.laozheng.bikaChapters(comic.id)
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

  const openDetailById = async (id: string) => {
    const placeholder: BikaComic = {
      id,
      title: '本子',
      author: '',
      thumb: '',
      likes: 0,
      views: 0,
      finished: false,
      categories: [],
      tags: [],
      epsCount: 0,
      pagesCount: 0,
      description: '',
      chineseTeam: '',
      updatedAt: ''
    }
    setDetail({ comic: placeholder, chapters: [], loading: true, error: null })
    const [detailRes, chapterRes] = await Promise.all([
      window.laozheng.bikaDetail(id),
      window.laozheng.bikaChapters(id)
    ])
    setDetail({
      comic: detailRes.ok && detailRes.comic ? detailRes.comic : placeholder,
      chapters: chapterRes.ok ? chapterRes.items : [],
      loading: false,
      error: detailRes.ok
        ? chapterRes.ok
          ? null
          : chapterRes.error ?? '章节加载失败'
        : detailRes.error ?? '详情加载失败'
    })
  }

  useEffect(() => {
    if (focusId) void openDetailById(focusId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])

  const progressKey = (id: string): string => `bika/${id}`
  const progress = detail ? data.readProgress[progressKey(detail.comic.id)] : undefined
  const resumeChapter = detail?.chapters.find((c) => String(c.order) === progress)

  const openChapter = async (chapter: BikaChapter) => {
    const comic = detail?.comic
    if (!comic) return
    setReader({ comic, chapter, urls: [], loading: true, error: null })
    const res = await window.laozheng.bikaImages(comic.id, chapter.order)
    setReader({
      comic,
      chapter,
      urls: res.ok ? res.urls : [],
      loading: false,
      error: res.ok ? (res.urls.length ? null : '本章没有图片') : res.error ?? '图片加载失败'
    })
    if (res.ok && res.urls.length) {
      update((d) => ({
        ...d,
        readProgress: { ...d.readProgress, [progressKey(comic.id)]: String(chapter.order) }
      }))
    }
  }

  const downloadChapter = async () => {
    if (!reader || !reader.urls.length) return
    const res = await window.laozheng.addImageDownload({
      title: `${reader.comic.title} ${reader.chapter.title}`.slice(0, 120),
      urls: reader.urls,
      referer: 'https://picaapi.picacomic.com/',
      coverUrl: reader.comic.thumb,
      sourceName: '本子'
    })
    onNotice(res.ok ? '已加入下载队列，可在「下载」页查看进度' : `下载失败：${res.error}`)
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
          <span className="page-desc">{reader.chapter.title}</span>
          <div className="page-actions">
            <button className="btn" disabled={!reader.urls.length} onClick={() => void downloadChapter()}>
              <Download size={14} /> 下载本章
            </button>
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
            {resumeChapter ? (
              <button className="btn primary" onClick={() => void openChapter(resumeChapter)}>
                继续阅读 · {resumeChapter.title}
              </button>
            ) : null}
            <button className="btn" onClick={() => toggleFav(detail.comic)}>
              <Heart size={15} fill={favOf(detail.comic.id) ? 'currentColor' : 'none'} />{' '}
              {favOf(detail.comic.id) ? '已收藏' : '收藏'}
            </button>
          </div>
        </header>

        <div className="comic-detail">
          <div className="comic-detail-cover">
            {detail.comic.thumb ? <img src={detail.comic.thumb} alt="" /> : null}
          </div>
          <div className="comic-detail-info">
            <div className="row-title" style={{ whiteSpace: 'normal' }}>
              {detail.comic.title}
            </div>
            <div className="comic-meta">
              {[
                detail.comic.author ? `作者：${detail.comic.author}` : '',
                detail.comic.finished ? '已完结' : '连载中',
                `${detail.comic.epsCount} 话`,
                detail.comic.likes ? `${detail.comic.likes} 喜欢` : ''
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {detail.comic.categories.length ? (
              <div className="comic-tags">
                {detail.comic.categories.map((c) => (
                  <span key={c} className="badge">
                    {c}
                  </span>
                ))}
              </div>
            ) : null}
            {detail.comic.description ? (
              <p className="comic-desc">{detail.comic.description}</p>
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
                className={`chapter-chip ${String(chapter.order) === progress ? 'active' : ''}`}
                onClick={() => void openChapter(chapter)}
              >
                {chapter.title}
                {String(chapter.order) === progress ? <span className="chapter-size">上次看到</span> : null}
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
        <h1 className="page-title">本子</h1>
        <span className="page-desc">哔咔 · 内置账号自动登录 · 需要外网环境</span>
      </header>

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          void load(category, sort, input.trim(), 1)
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
              void load(category, sort, '', 1)
            }}
          >
            清除搜索
          </button>
        ) : null}
        <button
          className="btn ghost"
          disabled={loading}
          onClick={() => void load(category, sort, query, page)}
        >
          <RefreshCw size={14} /> 刷新
        </button>
      </form>

      {!query && (
        <div className="toolbar">
          <select className="select-inline" value={sort} onChange={(e) => void load(category, e.target.value, '', 1)}>
            {BIKA_SORTS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            className={`chip ${!category ? 'active' : ''}`}
            onClick={() => void load('', sort, '', 1)}
          >
            全部
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`chip ${category === c.title ? 'active' : ''}`}
              onClick={() => void load(c.title, sort, '', 1)}
            >
              {c.title}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <EmptyState title="正在加载漫画列表…" desc="哔咔需要外网环境，首次加载可能稍慢。" />
      ) : error ? (
        <EmptyState
          title="加载失败"
          desc={error}
          action={
            <button className="btn" onClick={() => void load(category, sort, query, page)}>
              重试
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState title="没有找到漫画" desc="换个关键词、分类或排序再试。" />
      ) : (
        <>
          <div className="comic-grid">
            {items.map((comic) => (
              <button key={comic.id} className="comic-card" onClick={() => void openDetail(comic)}>
                <span className="comic-cover">
                  {comic.thumb ? <img src={comic.thumb} alt="" loading="lazy" /> : null}
                  {comic.finished ? <span className="comic-badge">完结</span> : null}
                </span>
                <span className="comic-title">{comic.title}</span>
                <span className="comic-sub">
                  {[comic.author, `${comic.epsCount} 话`].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
          </div>

          <div className="toolbar" style={{ marginTop: 14 }}>
            <button className="btn" disabled={page <= 1} onClick={() => void load(category, sort, query, page - 1)}>
              <ChevronLeft size={14} /> 上一页
            </button>
            <span className="page-desc">
              第 {page} 页 / 共 {pages} 页
            </span>
            <button
              className="btn"
              disabled={page >= pages}
              onClick={() => void load(category, sort, query, page + 1)}
            >
              下一页 <ChevronRight size={14} />
            </button>
          </div>
        </>
      )}
    </>
  )
}
