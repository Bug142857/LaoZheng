import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Download, Heart } from 'lucide-react'
import { useData } from '../state/DataContext'
import {
  ConfirmDialog,
  EmptyState,
  LoadingBlock,
  ModuleShortcuts,
  Pagination
} from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { ComicReader } from '../components/ComicReader'
import { loadCache, saveCache } from '../utils/cache'
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
  lastPage: number
  loaded: boolean
}

const EMPTY_COMIC_CACHE: ListCache = {
  mode: 'recent',
  categoryId: '',
  query: '',
  items: [],
  offset: 0,
  hasMore: true,
  lastPage: 0,
  loaded: false
}

const cache: ListCache = (() => {
  const cached = loadCache<ListCache>('comic', EMPTY_COMIC_CACHE)
  // 每次打开应用回到「最近」；默认列表缓存仍直接显示
  if (cached.mode !== 'recent' || cached.categoryId || cached.query || cached.offset !== 0) {
    return { ...EMPTY_COMIC_CACHE }
  }
  return cached
})()

/** 旧缓存里可能有已下线的「连载中 / 已完结」，统一回落到最近 */
const storedMode = cache.mode as string
const initialMode: Mode =
  storedMode === 'hot' || storedMode === 'category' || storedMode === 'search'
    ? storedMode
    : 'recent'

let categoryCache: KomiicCategory[] = loadCache<KomiicCategory[]>('comic.categories', [])

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

/** 章节统一按话数升序存放，展示时默认倒序 */
function sortChapters(items: KomiicChapter[]): KomiicChapter[] {
  return [...items].sort((a, b) => {
    const na = Number.parseFloat(a.serial)
    const nb = Number.parseFloat(b.serial)
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
    return a.id.localeCompare(b.id, undefined, { numeric: true })
  })
}

export function ComicPage({
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
  const [categories, setCategories] = useState<KomiicCategory[]>(categoryCache)
  const [mode, setMode] = useState<Mode>(initialMode)
  const [categoryId, setCategoryId] = useState(cache.categoryId)
  const [query, setQuery] = useState(cache.query)
  const [input, setInput] = useState(cache.query)
  const [items, setItems] = useState<KomiicComic[]>(cache.items)
  const [hasMore, setHasMore] = useState(cache.hasMore)
  const [lastPage, setLastPage] = useState(cache.lastPage ?? 0)
  const [pageNum, setPageNum] = useState(Math.floor(cache.offset / KOMIIC_PAGE_SIZE) + 1)
  const [pending, setPending] = useState<{ mode: Mode; categoryId: string } | null>(null)
  const [loading, setLoading] = useState(!cache.loaded)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [reader, setReader] = useState<ReaderState | null>(null)
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null)
  const [confirmBatch, setConfirmBatch] = useState<KomiicChapter[] | null>(null)
  const [chapterDesc, setChapterDesc] = useState(true)
  const readerRef = useRef<HTMLDivElement | null>(null)
  const requestSeq = useRef(0)
  const listKeyRef = useRef('')
  const probeCache = useRef(new Map<string, number>())

  useEffect(() => {
    if (resetSignal === undefined) return
    setDetail(null)
    setReader(null)
  }, [resetSignal])

  const fetchPage = async (
    nextMode: Mode,
    nextCategoryId: string,
    nextQuery: string,
    nextOffset: number
  ) => {
    if (nextMode === 'recent') return window.laozheng.komiicRecent(nextOffset, '')
    if (nextMode === 'hot') return window.laozheng.komiicHot(nextOffset)
    if (nextMode === 'category') return window.laozheng.komiicByCategory(nextCategoryId, nextOffset)
    return window.laozheng.komiicSearch(nextQuery, nextOffset)
  }

  /** 最近 / 热门 / 搜索接口不返回总数：用指数探测 + 二分找出最后一页，缓存后分页器就能显示「共 N 页」 */
  const probeTotalPages = async (
    targetMode: Mode,
    targetCategory: string,
    targetQuery: string
  ) => {
    const key = `${targetMode}|${targetCategory}|${targetQuery}`
    if (probeCache.current.has(key)) {
      if (listKeyRef.current === key) setLastPage(probeCache.current.get(key) ?? 1)
      return
    }
    const offsetOf = (p: number) => Math.max(0, (p - 1) * KOMIIC_PAGE_SIZE)
    let low = 1
    let high = 2
    try {
      while (high <= 4096) {
        const res = await fetchPage(targetMode, targetCategory, targetQuery, offsetOf(high))
        if (!res.ok || !res.items.length) break
        low = high
        high *= 2
      }
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2)
        const res = await fetchPage(targetMode, targetCategory, targetQuery, offsetOf(mid))
        if (res.ok && res.items.length) low = mid
        else high = mid
      }
    } catch {
      return
    }
    probeCache.current.set(key, low)
    if (listKeyRef.current !== key) return
    setLastPage(low)
    Object.assign(cache, { lastPage: low })
    if (cache.mode === 'recent' && !cache.categoryId && !cache.query) {
      saveCache<ListCache>('comic', { ...cache })
    }
  }

  const load = async (
    nextMode: Mode,
    nextCategoryId: string,
    nextQuery: string,
    nextPage: number
  ) => {
    const nextOffset = Math.max(0, (nextPage - 1) * KOMIIC_PAGE_SIZE)
    const seq = ++requestSeq.current
    setPending({ mode: nextMode, categoryId: nextCategoryId })
    setLoading(true)
    setError(null)
    const res = await fetchPage(nextMode, nextCategoryId, nextQuery, nextOffset)
    if (seq !== requestSeq.current) return
    setPending(null)
    setLoading(false)
    if (!res.ok) {
      setError(res.error ?? '加载失败')
      return
    }
    const nextHasMore = res.items.length >= KOMIIC_PAGE_SIZE
    const key = `${nextMode}|${nextCategoryId}|${nextQuery}`
    listKeyRef.current = key
    const knownLastPage = probeCache.current.get(key) ?? 0
    setItems(res.items)
    setHasMore(nextHasMore)
    setLastPage(knownLastPage)
    setPageNum(nextPage)
    setMode(nextMode)
    setCategoryId(nextCategoryId)
    setQuery(nextQuery)
    Object.assign(cache, {
      mode: nextMode,
      categoryId: nextCategoryId,
      query: nextQuery,
      items: res.items,
      offset: nextOffset + res.items.length,
      hasMore: nextHasMore,
      lastPage: knownLastPage,
      loaded: true
    })
    // 只缓存「最近 + 第一页」，重开应用才能立刻显示默认列表
    if (nextMode === 'recent' && !nextCategoryId && !nextQuery && nextPage === 1) {
      saveCache<ListCache>('comic', { ...cache })
    }
    if (nextMode !== 'category' && !knownLastPage) {
      void probeTotalPages(nextMode, nextCategoryId, nextQuery)
    }
  }

  useEffect(() => {
    if (!cache.loaded || (cache.mode as string) !== initialMode) {
      void load(initialMode, cache.categoryId, cache.query, 1)
    }
    if (!categoryCache.length) {
      void window.laozheng.komiicCategories().then((res) => {
        if (!res.ok) return
        categoryCache = res.items
        saveCache<KomiicCategory[]>('comic.categories', res.items)
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
    setChapterDesc(true)
    setDetail({ comic, chapters: [], loading: true, error: null })
    const [detailRes, chapterRes] = await Promise.all([
      window.laozheng.komiicDetail(comic.id),
      window.laozheng.komiicChapters(comic.id)
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
    const placeholder: KomiicComic = {
      id,
      title: '漫画',
      status: '',
      imageUrl: '',
      authors: [],
      categories: [],
      dateUpdated: '',
      lastChapterUpdate: '',
      monthViews: 0,
      views: 0,
      favoriteCount: 0
    }
    setDetail({ comic: placeholder, chapters: [], loading: true, error: null })
    const [detailRes, chapterRes] = await Promise.all([
      window.laozheng.komiicDetail(id),
      window.laozheng.komiicChapters(id)
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

  const progressKey = (id: string): string => `comic/${id}`
  const progress = detail ? data.readProgress[progressKey(detail.comic.id)] : undefined
  const resumeChapter = detail?.chapters.find((c) => c.id === progress)
  /** 分类模式能算出总页数；最近 / 热门只能点「尾页」时探测 */
  const categoryLastPage =
    mode === 'category'
      ? Math.ceil((categories.find((c) => c.id === categoryId)?.count ?? 0) / KOMIIC_PAGE_SIZE)
      : 0

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
    if (res.ok && res.urls.length) {
      update((d) => ({
        ...d,
        readProgress: { ...d.readProgress, [progressKey(comic.id)]: chapter.id }
      }))
    }
  }

  const downloadChapters = async (chapters: KomiicChapter[]) => {
    const comic = detail?.comic
    if (!comic || !chapters.length || batch) return
    setBatch({ done: 0, total: chapters.length })
    const payload: { key: string; name: string; urls: string[] }[] = []
    try {
      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i]
        const res = await window.laozheng.komiicImages(comic.id, chapter.id)
        if (res.ok && res.urls.length) {
          payload.push({
            key: chapter.id,
            name: chapter.serial ? `第 ${chapter.serial} 话` : chapter.id,
            urls: res.urls
          })
        } else {
          onNotice(`${chapter.serial ? `第 ${chapter.serial} 话` : chapter.id} 取图失败，已跳过`)
        }
        setBatch({ done: i + 1, total: chapters.length })
      }
      if (!payload.length) {
        onNotice('没有可下载的章节')
        return
      }
      const res = await window.laozheng.addComicBatchDownload({
        comic: {
          source: 'komiic',
          id: comic.id,
          title: comic.title,
          cover: comic.imageUrl
        },
        chapters: payload,
        referer: 'https://komiic.com/',
        sourceName: '漫画'
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

  /** 最近 / 热门接口不返回总数：点「尾页」时指数探测 + 二分找最后一页 */
  const goLastPage = async () => {
    if (loading) return
    const seq = ++requestSeq.current
    setLoading(true)
    const offsetOf = (p: number) => Math.max(0, (p - 1) * KOMIIC_PAGE_SIZE)
    let low = 1
    let high = 2
    try {
      while (high <= 4096) {
        const res = await fetchPage(mode, categoryId, query, offsetOf(high))
        if (seq !== requestSeq.current) return
        if (!res.ok || !res.items.length) break
        low = high
        high *= 2
      }
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2)
        const res = await fetchPage(mode, categoryId, query, offsetOf(mid))
        if (seq !== requestSeq.current) return
        if (res.ok && res.items.length) low = mid
        else high = mid
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
    if (seq !== requestSeq.current) return
    void load(mode, categoryId, query, low)
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
                继续阅读 · {resumeChapter.serial ? `第 ${resumeChapter.serial} 话` : resumeChapter.id}
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
            {chapterList.map((chapter) => (
              <button
                key={chapter.id}
                className={`chapter-chip ${chapter.id === progress ? 'active' : ''}`}
                onClick={() => void openChapter(chapter)}
              >
                {chapter.serial ? `第 ${chapter.serial} 话` : `章节 ${chapter.id}`}
                {chapter.id === progress ? <span className="chapter-size">上次看到</span> : null}
                {chapter.size ? <span className="chapter-size">{chapter.size}P</span> : null}
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
        <h1 className="page-title">漫画</h1>
        <div className="page-actions">
          <ModuleShortcuts onOpenFavorites={onOpenFavorites} onOpenDownloads={onOpenDownloads} />
        </div>
      </header>

      <SearchBar
        value={input}
        onChange={setInput}
        onSubmit={() => {
          const keyword = input.trim()
          if (keyword) void load('search', '', keyword, 1)
        }}
        onCancel={() => {
          requestSeq.current += 1
          setLoading(false)
        }}
        onClear={() => {
          setInput('')
          void load('recent', '', '', 1)
        }}
        searching={loading && mode === 'search'}
        placeholder="搜索漫画关键词…"
      />

      {query ? (
        <div className="toolbar">
          <span className="page-desc">搜索结果：{query}</span>
        </div>
      ) : (
        <div className="toolbar">
          <button
            className={`chip ${(pending?.mode ?? mode) === 'recent' ? 'active' : ''}`}
            onClick={() => void load('recent', '', '', 1)}
          >
            最近
          </button>
          <button
            className={`chip ${(pending?.mode ?? mode) === 'hot' ? 'active' : ''}`}
            onClick={() => void load('hot', '', '', 1)}
          >
            热门
          </button>
          {categories.map((c) => {
            const active = pending
              ? pending.mode === 'category' && pending.categoryId === c.id
              : mode === 'category' && categoryId === c.id
            return (
              <button
                key={c.id}
                className={`chip ${active ? 'active' : ''}`}
                onClick={() => void load('category', c.id, '', 1)}
              >
                {c.name}
                {c.count > 0 ? <span className="chip-count">{c.count}</span> : null}
              </button>
            )
          })}
        </div>
      )}

      {loading && items.length > 0 ? <LoadingBlock text="正在切换，请稍等…" /> : null}

      {loading && items.length === 0 ? (
        <EmptyState title="正在加载漫画列表…" />
      ) : error ? (
        <EmptyState
          title="加载失败"
          desc={error}
          action={
            <button className="btn" onClick={() => void load(mode, categoryId, query, pageNum)}>
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
                  {comic.authors.map((a) => a.name).join(' / ') || comic.categories.map((c) => c.name).join(' · ') || '—'}
                </span>
              </button>
            ))}
          </div>

          <Pagination
            page={pageNum}
            lastPage={categoryLastPage || lastPage}
            onLast={
              categoryLastPage > 0 || lastPage > 0 ? undefined : () => void goLastPage()
            }
            hasMore={hasMore}
            disabled={loading}
            onChange={(next) => void load(mode, categoryId, query, next)}
          />
        </>
      )}
    </>
  )
}
