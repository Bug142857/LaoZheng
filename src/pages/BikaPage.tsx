import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Download, Heart } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, LoadingBlock, ConfirmDialog, ModuleShortcuts, Pagination } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { ComicReader } from '../components/ComicReader'
import { loadCache, saveCache } from '../utils/cache'
import type { BikaCategory, BikaChapter, BikaComic } from '../shared/bika'

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

const EMPTY_BIKA_CACHE: ListCache = {
  category: '',
  sort: 'dd',
  query: '',
  page: 1,
  pages: 1,
  items: [],
  categories: [],
  loaded: false
}

const cache: ListCache = (() => {
  const cached = loadCache<ListCache>('bika', EMPTY_BIKA_CACHE)
  // 每次打开应用回到默认分类 / 默认排序；默认列表缓存仍直接显示
  if (cached.category || cached.query || cached.sort !== 'dd' || cached.page !== 1) {
    return { ...EMPTY_BIKA_CACHE }
  }
  return cached
})()

let bikaCounts: Record<string, number> = {}
let bikaCountsRequested = false

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

/** 章节统一按 order 升序存放，展示时默认倒序 */
function sortChapters(items: BikaChapter[]): BikaChapter[] {
  return [...items].sort((a, b) => a.order - b.order)
}

export function BikaPage({
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
  /** 从收藏进入时，详情 / 阅读返回走全局上一页 */
  onExit?: () => void
  onOpenFavorites?: () => void
  onOpenDownloads?: () => void
}) {
  const { data, update } = useData()
  const [categories, setCategories] = useState<BikaCategory[]>(cache.categories)
  const [counts, setCounts] = useState<Record<string, number>>(bikaCounts)
  const [category, setCategory] = useState(cache.category)
  const [sort, setSort] = useState(cache.sort === 'vd' ? 'vd' : 'dd')
  const [query, setQuery] = useState(cache.query)
  const [input, setInput] = useState(cache.query)
  const [page, setPage] = useState(cache.page)
  const [pages, setPages] = useState(cache.pages)
  const [items, setItems] = useState<BikaComic[]>(cache.items)
  const [loading, setLoading] = useState(!cache.loaded)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [reader, setReader] = useState<ReaderState | null>(null)
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null)
  const [confirmBatch, setConfirmBatch] = useState<BikaChapter[] | null>(null)
  const [chapterDesc, setChapterDesc] = useState(true)
  const [pending, setPending] = useState<{ category: string; sort: string } | null>(null)
  const readerRef = useRef<HTMLDivElement | null>(null)
  const requestSeq = useRef(0)

  useEffect(() => {
    if (resetSignal === undefined) return
    setDetail(null)
    setReader(null)
  }, [resetSignal])

  const load = async (
    nextCategory: string,
    nextSort: string,
    nextQuery: string,
    nextPage: number
  ) => {
    const seq = ++requestSeq.current
    setPending({ category: nextCategory, sort: nextSort })
    setLoading(true)
    setError(null)
    const res = nextQuery
      ? await window.laozheng.bikaSearch(nextQuery, nextPage, nextSort)
      : await window.laozheng.bikaList(nextPage, nextCategory, nextSort)
    if (seq !== requestSeq.current) return
    setPending(null)
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
    // 只缓存默认分类 / 默认排序的第一页，重开应用才能立刻显示
    if (!nextQuery && !nextCategory && nextSort === 'dd' && nextPage === 1) {
      saveCache<ListCache>('bika', { ...cache })
    }
  }

  useEffect(() => {
    if (!cache.loaded) void load(cache.category, sort, cache.query, 1)
    if (!cache.categories.length) {
      void window.laozheng.bikaCategories().then((res) => {
        if (!res.ok) return
        cache.categories = res.items
        saveCache<ListCache>('bika', { ...cache })
        setCategories(res.items)
      })
    }
    if (!bikaCountsRequested) {
      bikaCountsRequested = true
      void window.laozheng.bikaCategoryCounts().then((res) => {
        if (!res.ok) return
        bikaCounts = res.counts
        setCounts(res.counts)
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
    setChapterDesc(true)
    setDetail({ comic, chapters: [], loading: true, error: null })
    const [detailRes, chapterRes] = await Promise.all([
      window.laozheng.bikaDetail(comic.id),
      window.laozheng.bikaChapters(comic.id)
    ])
    const merged = detailRes.ok && detailRes.comic ? detailRes.comic : comic
    setDetail({
      comic: merged,
      chapters: chapterRes.ok ? sortChapters(chapterRes.items) : [],
      loading: false,
      error: detailRes.ok
        ? chapterRes.ok
          ? null
          : chapterRes.error ?? '章节加载失败'
        : detailRes.error ?? '详情加载失败'
    })
  }

  const openDetailById = async (id: string, alive?: () => boolean) => {
    setChapterDesc(true)
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
    if (alive && !alive()) return
    setDetail({
      comic: detailRes.ok && detailRes.comic ? detailRes.comic : placeholder,
      chapters: chapterRes.ok ? sortChapters(chapterRes.items) : [],
      loading: false,
      error: detailRes.ok
        ? chapterRes.ok
          ? null
          : chapterRes.error ?? '章节加载失败'
        : detailRes.error ?? '详情加载失败'
    })
  }

  useEffect(() => {
    if (!focusId) return
    let alive = true
    void openDetailById(focusId, () => alive)
    return () => {
      alive = false
      setDetail(null)
      setReader(null)
    }
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

  const downloadChapters = async (chapters: BikaChapter[]) => {
    const comic = detail?.comic
    if (!comic || !chapters.length || batch) return
    setBatch({ done: 0, total: chapters.length })
    const payload: { key: string; name: string; urls: string[] }[] = []
    try {
      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i]
        const res = await window.laozheng.bikaImages(comic.id, chapter.order)
        if (res.ok && res.urls.length) {
          payload.push({ key: String(chapter.order), name: chapter.title, urls: res.urls })
        } else {
          onNotice(`${chapter.title} 取图失败，已跳过`)
        }
        setBatch({ done: i + 1, total: chapters.length })
      }
      if (!payload.length) {
        onNotice('没有可下载的章节')
        return
      }
      const res = await window.laozheng.addComicBatchDownload({
        comic: {
          source: 'bika',
          id: comic.id,
          title: comic.title,
          cover: comic.thumb
        },
        chapters: payload,
        referer: 'https://picaapi.picacomic.com/',
        sourceName: '本子'
      })
      onNotice(
        res.ok
          ? `已加入下载队列（${payload.length} 话），可在「下载」页查看进度`
          : `下载失败：${res.error}`
      )
    } finally {
      setBatch(null)
    }
  }

  const downloadChapter = () => {
    if (!reader) return
    setConfirmBatch([reader.chapter])
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
          <>
            <ComicReader images={reader.urls} />
            <div className="reader-footer">
              <button className="btn" disabled={!hasPrev} onClick={() => stepChapter(-1)}>
                上一话
              </button>
              <button className="btn" disabled={!hasNext} onClick={() => stepChapter(1)}>
                下一话
              </button>
            </div>
          </>
        )}
        {confirmBatch ? (
          <ConfirmDialog
            title="下载章节"
            message={`将下载 ${confirmBatch.length} 话的图片到本地，是否继续？`}
            confirmText="开始下载"
            onConfirm={() => {
              const list = confirmBatch
              setConfirmBatch(null)
              if (list) void downloadChapters(list)
            }}
            onCancel={() => setConfirmBatch(null)}
          />
        ) : null}
      </div>
    )
  }

  if (detail) {
    const chapterList = chapterDesc ? [...detail.chapters].reverse() : detail.chapters
    return (
      <>
        <header className="page-header">
          <button
            className="btn ghost"
            onClick={() => {
              // 先清掉详情再返回，避免从收藏返回后又落回详情页
              setDetail(null)
              setReader(null)
              if (focusId && onExit) onExit()
            }}
          >
            <ChevronLeft size={15} /> 返回列表
          </button>
          <h1 className="page-title">{detail.comic.title}</h1>
          <div className="page-actions">
            <button className="btn ghost" onClick={() => setChapterDesc((v) => !v)}>
              章节：{chapterDesc ? '倒序' : '正序'}
            </button>
            {resumeChapter ? (
              <button className="btn primary" onClick={() => void openChapter(resumeChapter)}>
                继续阅读 · {resumeChapter.title}
              </button>
            ) : null}
            <button
              className="btn"
              disabled={!!batch || detail.chapters.length === 0}
              onClick={() => setConfirmBatch(detail.chapters)}
            >
              <Download size={14} />{' '}
              {batch ? `准备中 ${batch.done}/${batch.total}` : '下载整本'}
            </button>
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
            {chapterList.map((chapter) => (
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
        {confirmBatch ? (
          <ConfirmDialog
            title="下载整本"
            message={`将下载「${detail.comic.title}」共 ${confirmBatch.length} 话到本地，是否继续？`}
            confirmText="开始下载"
            onConfirm={() => {
              const list = confirmBatch
              setConfirmBatch(null)
              if (list) void downloadChapters(list)
            }}
            onCancel={() => setConfirmBatch(null)}
          />
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
        <h1 className="page-title">本子</h1>
        <div className="page-actions">
          <ModuleShortcuts onOpenFavorites={onOpenFavorites} onOpenDownloads={onOpenDownloads} />
        </div>
      </header>

      <SearchBar
        value={input}
        onChange={setInput}
        onSubmit={() => void load(category, sort, input.trim(), 1)}
        onCancel={() => {
          requestSeq.current += 1
          setLoading(false)
        }}
        onClear={() => {
          setInput('')
          void load(category, sort, '', 1)
        }}
        searching={loading && !!query}
        placeholder="搜索漫画关键词…"
      />

      {!query && (
        <div className="toolbar">
          <button
            className={`chip ${
              (pending ? pending.sort : sort) === 'dd' ? 'active' : ''
            }`}
            onClick={() => void load(category, 'dd', '', 1)}
          >
            最新
          </button>
          <button
            className={`chip ${
              (pending ? pending.sort : sort) === 'vd' ? 'active' : ''
            }`}
            onClick={() => void load(category, 'vd', '', 1)}
          >
            热门
          </button>
          <button
            className={`chip ${
              (pending ? pending.category : category) === '' ? 'active' : ''
            }`}
            onClick={() => void load('', sort, '', 1)}
          >
            全部
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`chip ${
                (pending ? pending.category : category) === c.title ? 'active' : ''
              }`}
              onClick={() => void load(c.title, sort, '', 1)}
            >
              {c.title}
              {counts[c.title] > 0 ? <span className="chip-count">{counts[c.title]}</span> : null}
            </button>
          ))}
        </div>
      )}

      {loading && items.length > 0 ? <LoadingBlock text="正在切换，请稍等…" /> : null}

      {loading && items.length === 0 ? (
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
                  <span
                    className={`fav-heart ${favOf(comic.id) ? 'on' : ''}`}
                    role="button"
                    title={favOf(comic.id) ? '取消收藏' : '收藏'}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFav(comic)
                    }}
                  >
                    <Heart size={15} fill={favOf(comic.id) ? 'currentColor' : 'none'} />
                  </span>
                </span>
                <span className="comic-title">{comic.title}</span>
                <span className="comic-sub">
                  {[comic.author, `${comic.epsCount} 话`].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
          </div>

          <Pagination
            page={page}
            lastPage={pages}
            disabled={loading}
            onChange={(next) => void load(category, sort, query, next)}
          />
        </>
      )}
    </>
  )
}
