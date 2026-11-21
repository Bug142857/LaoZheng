import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Download, Heart, RefreshCw, Type } from 'lucide-react'
import { useData, useProgressValue } from '../state/DataContext'
import { CacheTip, ConfirmDialog, EmptyState, ModuleShortcuts, Pagination } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { loadCache, saveCache } from '../utils/cache'
import { useDetailScrollRestore } from '../utils/scroll'
import {
  NOVEL_SOURCE_CATEGORIES,
  normalizeNovelStatus,
  type NovelChapter,
  type NovelDetail,
  type NovelItem,
  type NovelSource
} from '../shared/novel'

export interface NovelFocus {
  sourceId: string
  bookId: string
  title?: string
}

interface ReaderState {
  chapter: NovelChapter
  content: string
  loading: boolean
  error: string | null
}

/** 列表每页数量：蚂蚁文学搜索固定返回 50 条，客户端分页展示 */
const PAGE_SIZE = 24

interface NovelListCache {
  sourceId: string
  mode: 'home' | 'search' | 'category'
  categoryId: string
  categoryPage: number
  keyword: string
  items: NovelItem[]
  page: number
  loaded: boolean
}

const EMPTY_NOVEL_CACHE: NovelListCache = {
  sourceId: '',
  mode: 'home',
  categoryId: '',
  categoryPage: 1,
  keyword: '',
  items: [],
  page: 1,
  loaded: false
}

/** 阅读器排版：字号 / 行距 / 页宽，按本机持久化（localStorage） */
interface ReaderSettings {
  fontSize: number
  lineHeight: number
  width: number
}

const READER_SETTINGS_KEY = 'lz-novel-reader'
const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontSize: 16,
  lineHeight: 1.95,
  width: 860
}

function loadReaderSettings(): ReaderSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(READER_SETTINGS_KEY) || 'null') as Partial<ReaderSettings> | null
    if (!raw) return DEFAULT_READER_SETTINGS
    const fontSize = Number(raw.fontSize)
    const lineHeight = Number(raw.lineHeight)
    const width = Number(raw.width)
    return {
      fontSize: Number.isFinite(fontSize) ? Math.min(26, Math.max(13, fontSize)) : 16,
      lineHeight: Number.isFinite(lineHeight) ? Math.min(2.6, Math.max(1.4, lineHeight)) : 1.95,
      width: Number.isFinite(width) ? Math.min(1200, Math.max(600, width)) : 860
    }
  } catch {
    return DEFAULT_READER_SETTINGS
  }
}

const cache: NovelListCache = (() => {
  const cached = loadCache<NovelListCache>('novel', EMPTY_NOVEL_CACHE)
  // 每次打开应用回到「全部源 · 推荐」；默认列表缓存仍直接显示
  if (cached.mode !== 'home' || cached.keyword || cached.categoryId || cached.sourceId) {
    return { ...EMPTY_NOVEL_CACHE }
  }
  return cached
})()

function toInput(source: NovelSource) {
  return {
    id: source.id,
    name: source.name,
    baseUrl: source.baseUrl,
    template: source.template
  }
}

function chapterCacheKey(sourceId: string, bookId: string, chapterId: string): string {
  return `${sourceId}|${bookId}|${chapterId}`
}

function progressKey(sourceId: string, bookId: string): string {
  return `novel/${sourceId}/${bookId}`
}

function rankItem(item: NovelItem, keyword: string): number {
  const title = item.title.trim()
  if (title === keyword) return 0
  if (title.startsWith(keyword)) return 1
  if (title.includes(keyword)) return 2
  const author = item.author.trim()
  if (author === keyword) return 3
  if (author.startsWith(keyword)) return 4
  if (author.includes(keyword)) return 5
  return 6
}

/** 站点本身没有封面时，按书名生成一张渐变封面，避免列表全是空白占位 */
const COVER_PALETTE = [
  ['#4f6df5', '#8b5cf6'],
  ['#e0526b', '#f0915a'],
  ['#0f9d8a', '#4fc3a1'],
  ['#5b6cf0', '#26a4c9'],
  ['#8b5cf6', '#d946ef'],
  ['#e08a2e', '#b45309'],
  ['#334155', '#64748b'],
  ['#0ea5a4', '#0369a1']
]

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function generatedCover(title: string): string {
  const text = (title || '未命名').trim() || '未命名'
  let hash = 0
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0
  const [from, to] = COVER_PALETTE[Math.abs(hash) % COVER_PALETTE.length]
  const lines: string[] = []
  for (let i = 0; i < text.length && lines.length < 2; i += 5) lines.push(text.slice(i, i + 5))
  if (text.length > 10) lines[1] = `${text.slice(5, 9)}…`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="120" height="160" rx="10" fill="url(#g)"/><circle cx="102" cy="22" r="34" fill="rgba(255,255,255,.12)"/><text x="60" y="${lines.length > 1 ? 64 : 74}" text-anchor="middle" fill="#fff" font-family="system-ui,-apple-system,'Microsoft YaHei',sans-serif" font-size="16" font-weight="600">${lines
    .map((line, index) => `<tspan x="60" dy="${index === 0 ? 0 : 21}">${escapeXml(line)}</tspan>`)
    .join('')}</text><text x="60" y="144" text-anchor="middle" fill="rgba(255,255,255,.72)" font-family="system-ui,sans-serif" font-size="9">老郑分享 · 小说</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** 封面加载失败或源站没有封面时，用书名生成封面兜底 */
function NovelCover({ src, title }: { src?: string; title?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return (
    <img
      src={!src || failed ? generatedCover(title ?? '') : src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

export function NovelPage({
  onNotice,
  focus,
  resetSignal,
  onExit,
  onOpenFavorites,
  onOpenDownloads
}: {
  onNotice: (text: string) => void
  focus?: NovelFocus
  resetSignal?: number
  /** 从收藏进入时，详情 / 阅读返回走全局上一页 */
  onExit?: () => void
  onOpenFavorites?: () => void
  onOpenDownloads?: () => void
}) {
  const { data, update, updateProgress } = useData()
  const sources = useMemo(
    () => data.novelSources.filter((source) => source.enabled),
    [data.novelSources]
  )
  const availableKey = sources.map((source) => `${source.id}:${source.baseUrl}`).join(',')
  /** 空字符串 = 全部源（和其它带源模块统一：搜索框前默认「全部源」） */
  const [sourceId, setSourceId] = useState(cache.sourceId)
  const [items, setItems] = useState<NovelItem[]>(cache.items)
  const [mode, setMode] = useState<'home' | 'search' | 'category'>(cache.mode)
  const [categoryId, setCategoryId] = useState('')
  const [categoryPage, setCategoryPage] = useState(1)
  const [categoryHasMore, setCategoryHasMore] = useState(false)
  const [categoryTotalPages, setCategoryTotalPages] = useState(0)
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({})
  const [keyword, setKeyword] = useState('')
  const [input, setInput] = useState('')
  const [page, setPage] = useState(cache.page)
  const [loading, setLoading] = useState(!cache.loaded)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<NovelDetail | null>(null)
  const [detailSourceId, setDetailSourceId] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [reader, setReader] = useState<ReaderState | null>(null)
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(loadReaderSettings)
  const [typesettingOpen, setTypesettingOpen] = useState(false)
  useDetailScrollRestore(!!detail || !!reader, 'novel')
  const [downloading, setDownloading] = useState<{
    key: string
    done: number
    total: number
  } | null>(null)
  const [confirmingDownload, setConfirmingDownload] = useState(false)
  const [chapterDesc, setChapterDesc] = useState(false)
  const listSeq = useRef(0)
  const detailSeq = useRef(0)
  const readerSeq = useRef(0)
  const readerRef = useRef<HTMLDivElement | null>(null)
  /** 预加载过的章节正文：最多保留最近 8 章，切章时直接命中 */
  const chapterCacheRef = useRef<Map<string, string>>(new Map())
  const prefetchingRef = useRef<Set<string>>(new Set())
  /** 预取定时器 / 代次：关闭详情或换书后作废，避免晚到的正文写回已清空的缓存 */
  const prefetchTimersRef = useRef<Set<number>>(new Set())
  const prefetchGenRef = useRef(0)

  const resetChapterPrefetch = () => {
    prefetchGenRef.current += 1
    for (const timer of prefetchTimersRef.current) window.clearTimeout(timer)
    prefetchTimersRef.current.clear()
    prefetchingRef.current.clear()
    chapterCacheRef.current.clear()
  }

  // 页面卸载时清掉未触发的预取定时器；已在请求中的结果只写 ref，不会再影响界面
  useEffect(() => {
    const timers = prefetchTimersRef.current
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
      timers.clear()
    }
  }, [])

  // 排版设置按本机持久化；改字号 / 行距不重置章节进度与滚动位置
  useEffect(() => {
    try {
      localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(readerSettings))
    } catch {
      // 忽略存储失败
    }
  }, [readerSettings])

  const activeSource =
    sources.find((source) => source.id === sourceId) ?? null
  const categories = activeSource
    ? (NOVEL_SOURCE_CATEGORIES[activeSource.template] ?? [])
    : []
  const categoryCountKey = activeSource
    ? `${activeSource.id}|${activeSource.baseUrl}|${activeSource.template}`
    : ''

  // 哔咔书源分类数量：逐分类取第一页的 total（主进程缓存 10 分钟）
  useEffect(() => {
    setCategoryCounts({})
    if (!activeSource || activeSource.template !== 'bikahub') return
    let alive = true
    void window.laozheng
      .novelCategoryCounts(toInput(activeSource))
      .then((res) => {
        if (alive && res.ok) setCategoryCounts(res.counts)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryCountKey])
  const detailSource =
    data.novelSources.find((source) => source.id === detailSourceId) ?? null
  // 只订阅当前这本书的进度，其它进度变化不触发本页重渲染
  const detailProgress = useProgressValue(
    detail && detailSourceId ? progressKey(detailSourceId, detail.bookId) : ''
  )
  const sourceOf = (item: NovelItem): NovelSource | null =>
    data.novelSources.find((source) => source.id === (item.sourceId ?? sourceId)) ??
    activeSource ??
    sources[0] ??
    null

  const targetsOf = (scope: string): NovelSource[] => {
    if (!scope) return sources
    const one = sources.find((source) => source.id === scope)
    return one ? [one] : []
  }

  const loadHome = async (scope: string) => {
    const seq = ++listSeq.current
    // 已经在看同一个「推荐」列表时保留现有条目：切回模块只做后台刷新，不再白屏重载
    const keepItems = mode === 'home' && !categoryId && !keyword && scope === sourceId
    setMode('home')
    setCategoryId('')
    setCategoryPage(1)
    setCategoryHasMore(false)
    setKeyword('')
    if (!keepItems) setItems([])
    setPage(1)
    setLoading(true)
    setError(null)
    setDetail(null)
    setDetailError(null)
    setReader(null)
    const targets = targetsOf(scope)
    if (!targets.length) {
      setLoading(false)
      return
    }
    const results = await Promise.all(
      targets.map(async (source) => {
        try {
          return { source, res: await window.laozheng.novelHome(toInput(source)) }
        } catch (err) {
          return { source, res: { ok: false, items: [], error: (err as Error).message } }
        }
      })
    )
    if (seq !== listSeq.current) return
    setLoading(false)
    const okResults = results.filter((result) => result.res.ok)
    if (!okResults.length) {
      setError(results[0]?.res.error ?? '加载失败')
      return
    }
    const merged: NovelItem[] = []
    const seen = new Set<string>()
    for (const { source, res } of okResults) {
      for (const item of res.items) {
        const key = `${source.id}|${item.bookId}`
        if (seen.has(key)) continue
        seen.add(key)
        merged.push({ ...item, sourceId: source.id, sourceName: source.name })
      }
    }
    setItems(merged)
    // 只缓存「全部源 · 推荐」第一页，重开应用立即有内容
    if (!scope) {
      saveCache<NovelListCache>('novel', {
        sourceId: '',
        mode: 'home',
        categoryId: '',
        categoryPage: 1,
        keyword: '',
        items: merged,
        page: 1,
        loaded: true
      })
    }
  }

  const doSearch = async (scope: string, text: string) => {
    const query = text.trim()
    if (!query) return
    const seq = ++listSeq.current
    setMode('search')
    setCategoryId('')
    setCategoryPage(1)
    setCategoryHasMore(false)
    setKeyword(query)
    setPage(1)
    setLoading(true)
    setError(null)
    setDetail(null)
    setDetailError(null)
    setReader(null)
    const targets = targetsOf(scope)
    if (!targets.length) {
      setLoading(false)
      return
    }
    const results = await Promise.all(
      targets.map(async (source) => {
        try {
          return { source, res: await window.laozheng.novelSearch(toInput(source), query) }
        } catch (err) {
          return { source, res: { ok: false, items: [], error: (err as Error).message } }
        }
      })
    )
    if (seq !== listSeq.current) return
    setLoading(false)
    const okResults = results.filter((result) => result.res.ok)
    if (!okResults.length) {
      setItems([])
      setError(results[0]?.res.error ?? '搜索失败')
      return
    }
    const merged: NovelItem[] = []
    const seen = new Set<string>()
    for (const { source, res } of okResults) {
      for (const item of res.items) {
        const key = `${source.id}|${item.bookId}`
        if (seen.has(key)) continue
        seen.add(key)
        merged.push({ ...item, sourceId: source.id, sourceName: source.name })
      }
    }
    merged.sort(
      (a, b) => rankItem(a, query) - rankItem(b, query) || a.title.length - b.title.length
    )
    setItems(merged)
  }

  const loadCategory = async (scope: string, nextCategoryId: string, pageNum: number) => {
    const target = sources.find((source) => source.id === scope)
    if (!target || !nextCategoryId) return
    const seq = ++listSeq.current
    setMode('category')
    setCategoryId(nextCategoryId)
    setCategoryPage(pageNum)
    setKeyword('')
    setItems([])
    setPage(1)
    setLoading(true)
    setError(null)
    setDetail(null)
    setDetailError(null)
    setReader(null)
    try {
      const res = await window.laozheng.novelCategory(
        toInput(target),
        nextCategoryId,
        pageNum
      )
      if (seq !== listSeq.current) return
      setLoading(false)
      if (!res.ok) {
        setItems([])
        setCategoryHasMore(false)
        setCategoryTotalPages(0)
        setError(res.error ?? '加载失败')
        return
      }
      setItems(
        res.items.map((item) => ({
          ...item,
          sourceId: target.id,
          sourceName: target.name
        }))
      )
      setCategoryHasMore(!!res.hasMore)
      setCategoryTotalPages(
        res.totalPages && res.totalPages > 0
          ? res.totalPages
          : res.hasMore
            ? pageNum + 1
            : pageNum
      )
    } catch (err) {
      if (seq !== listSeq.current) return
      setLoading(false)
      setItems([])
      setCategoryHasMore(false)
      setError((err as Error).message)
    }
  }

  const openDetail = async (
    source: NovelSource,
    bookId: string,
    title?: string,
    meta?: Pick<NovelItem, 'author' | 'cover' | 'status' | 'latestChapter'>
  ) => {
    const seq = ++detailSeq.current
    readerSeq.current += 1
    resetChapterPrefetch()
    setDetailSourceId(source.id)
    setDetailLoading(true)
    setDetailError(null)
    setDetail({
      bookId,
      title: title ?? '',
      author: meta?.author ?? '',
      cover: meta?.cover ?? '',
      intro: '',
      category: '',
      status: normalizeNovelStatus(meta?.status),
      latestChapter: meta?.latestChapter ?? '',
      chapters: []
    })
    setReader(null)
    const res = await window.laozheng.novelDetail(toInput(source), bookId)
    if (seq !== detailSeq.current) return
    setDetailLoading(false)
    if (!res.ok || !res.detail) {
      setDetailError(res.error ?? '加载失败')
      return
    }
    setDetail({
      ...res.detail,
      title: res.detail.title || title || '',
      author: res.detail.author || meta?.author || '',
      cover: res.detail.cover || meta?.cover || '',
      status: normalizeNovelStatus(res.detail.status) || normalizeNovelStatus(meta?.status),
      latestChapter: res.detail.latestChapter || meta?.latestChapter || ''
    })
  }

  const closeDetail = () => {
    detailSeq.current += 1
    readerSeq.current += 1
    resetChapterPrefetch()
    setDetail(null)
    setDetailError(null)
    setReader(null)
    if (focus && onExit) onExit()
  }

  const rememberChapter = (key: string, content: string) => {
    const cache = chapterCacheRef.current
    cache.set(key, content)
    while (cache.size > 8) {
      const oldest = cache.keys().next().value
      if (!oldest) break
      cache.delete(oldest)
    }
  }

  /** 空闲预取下一章；失败不提示，用户翻到时会正常请求 */
  const prefetchChapter = (chapter: NovelChapter | undefined) => {
    if (!chapter || !detail || !detailSource) return
    const cacheKey = chapterCacheKey(detailSource.id, detail.bookId, chapter.id)
    if (chapterCacheRef.current.has(cacheKey) || prefetchingRef.current.has(cacheKey)) return
    prefetchingRef.current.add(cacheKey)
    const sourceInput = toInput(detailSource)
    const bookId = detail.bookId
    const gen = prefetchGenRef.current
    const timer = window.setTimeout(() => {
      prefetchTimersRef.current.delete(timer)
      // 期间已经关闭详情 / 换了书：这次预取作废，不再发请求
      if (gen !== prefetchGenRef.current) return
      void window.laozheng
        .novelChapter(sourceInput, bookId, chapter.id)
        .then((res) => {
          if (gen !== prefetchGenRef.current) return
          if (res.ok && res.chapter) rememberChapter(cacheKey, res.chapter.content)
        })
        .catch(() => undefined)
        .finally(() => {
          // 新一轮预取开始后旧请求不能清掉新轮次的标记
          if (gen === prefetchGenRef.current) prefetchingRef.current.delete(cacheKey)
        })
    }, 500)
    prefetchTimersRef.current.add(timer)
  }

  const openChapter = async (chapter: NovelChapter) => {
    if (!detail || !detailSource) return
    const cacheKey = chapterCacheKey(detailSource.id, detail.bookId, chapter.id)
    const cached = chapterCacheRef.current.get(cacheKey)
    const index = detail.chapters.findIndex((item) => item.id === chapter.id)
    const prefetchNext = () => {
      prefetchChapter(index >= 0 ? detail.chapters[index + 1] : undefined)
    }
    const seq = ++readerSeq.current
    if (cached != null) {
      setReader({ chapter, content: cached, loading: false, error: null })
      updateProgress(progressKey(detailSource.id, detail.bookId), chapter.id)
      prefetchNext()
      return
    }
    setReader({ chapter, content: '', loading: true, error: null })
    const res = await window.laozheng.novelChapter(
      toInput(detailSource),
      detail.bookId,
      chapter.id
    )
    if (seq !== readerSeq.current) return
    if (!res.ok || !res.chapter) {
      setReader({
        chapter,
        content: '',
        loading: false,
        error: res.error ?? '章节加载失败'
      })
      return
    }
    rememberChapter(cacheKey, res.chapter.content)
    setReader({ chapter, content: res.chapter.content, loading: false, error: null })
    updateProgress(progressKey(detailSource.id, detail.bookId), chapter.id)
    prefetchNext()
  }

  const stepChapter = (delta: number) => {
    if (!detail || !reader) return
    const index = detail.chapters.findIndex((chapter) => chapter.id === reader.chapter.id)
    const next = detail.chapters[index + delta]
    if (next) void openChapter(next)
  }

  const isFavOf = (source: NovelSource, bookId: string): boolean =>
    data.innerFavs.some((fav) => fav.module === 'novel' && fav.id === `${source.id}|${bookId}`)

  const toggleFav = (
    source: NovelSource,
    book: {
      bookId: string
      title: string
      author?: string
      cover?: string
      status?: string
    }
  ) => {
    if (!book.bookId) return
    const id = `${source.id}|${book.bookId}`
    const exists = data.innerFavs.some((fav) => fav.module === 'novel' && fav.id === id)
    update((current) => {
      if (exists) {
        return {
          ...current,
          innerFavs: current.innerFavs.filter(
            (fav) => !(fav.module === 'novel' && fav.id === id)
          )
        }
      }
      return {
        ...current,
        innerFavs: [
          ...current.innerFavs,
          {
            module: 'novel',
            id,
            title: book.title,
            subtitle: [book.author, normalizeNovelStatus(book.status), source.name]
              .filter(Boolean)
              .join(' · '),
            cover: book.cover || null,
            savedAt: Date.now(),
            videoUrl: null,
            mediaId: 0,
            durationSec: 0,
            tweetUrl: null,
            payload: JSON.stringify({
              sourceId: source.id,
              bookId: book.bookId
            })
          }
        ]
      }
    })
    onNotice(exists ? '已取消收藏' : '已收藏，可在「收藏」页查看')
  }

  const downloadBook = async () => {
    if (!detail || !detailSource || downloading || !detail.chapters.length) return
    const key = `${detailSource.id}|${detail.bookId}`
    const total = detail.chapters.length
    setDownloading({ key, done: 0, total })
    onNotice(`开始下载《${detail.title}》，共 ${total} 章`)
    try {
      const res = await window.laozheng.novelDownload({
        source: toInput(detailSource),
        bookId: detail.bookId,
        title: detail.title,
        author: detail.author,
        status: detail.status,
        intro: detail.intro,
        cover: detail.cover,
        chapters: detail.chapters
      })
      setDownloading(null)
      if (!res.ok) {
        onNotice(`下载失败：${res.error ?? '未知错误'}`)
        return
      }
      onNotice(
        `已下载 ${res.chapters ?? 0} 章${
          res.failed ? `（${res.failed} 章失败）` : ''
        }：${res.path}`
      )
    } catch (err) {
      setDownloading(null)
      onNotice(`下载失败：${(err as Error).message}`)
    }
  }

  const changeSource = (next: string) => {
    if (next === sourceId) return
    setSourceId(next)
    if (mode === 'search' && keyword) {
      void doSearch(next, keyword)
      return
    }
    void loadHome(next)
  }

  // 进入模块 / 点击导航刷新：按当前下拉的书源重新加载推荐
  useEffect(() => {
    if (focus) return
    const preferred = sources.some((source) => source.id === sourceId) ? sourceId : ''
    if (preferred !== sourceId) setSourceId(preferred)
    void loadHome(preferred)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal, focus?.sourceId, focus?.bookId, availableKey])

  // 从收藏打开：按收藏里的书源与书籍编号直接进详情
  useEffect(() => {
    if (!focus) return
    const source = data.novelSources.find((item) => item.id === focus.sourceId)
    if (!source) {
      setDetail(null)
      setError(`书源「${focus.sourceId}」已被删除，无法打开收藏。`)
      return
    }
    setSourceId(source.id)
    setError(null)
    void openDetail(source, focus.bookId, focus.title)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.sourceId, focus?.bookId])

  useEffect(() => {
    if (reader) readerRef.current?.scrollIntoView({ block: 'start' })
  }, [reader])

  // 整本下载进度由主进程推送
  useEffect(() => {
    return window.laozheng.onNovelDownloadProgress((progress) => {
      const key = `${progress.sourceId}|${progress.bookId}`
      setDownloading((current) =>
        current && current.key === key
          ? { ...current, done: progress.done, total: progress.total }
          : current
      )
    })
  }, [])

  if (reader) {
    const index = detail?.chapters.findIndex((item) => item.id === reader.chapter.id) ?? -1
    const hasPrev = index > 0
    const hasNext = index >= 0 && index < (detail?.chapters.length ?? 0) - 1
    const paragraphs = reader.content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    return (
      <div ref={readerRef}>
        <header className="page-header">
          <button className="btn ghost" onClick={() => setReader(null)}>
            <ChevronLeft size={15} /> 返回章节
          </button>
          <h1 className="page-title">
            {detail?.title ?? ''} · {reader.chapter.name}
          </h1>
          <div className="page-actions">
            <button
              className={`btn ghost${typesettingOpen ? ' active' : ''}`}
              title="字号 / 行距 / 背景 / 页宽"
              onClick={() => setTypesettingOpen((value) => !value)}
            >
              <Type size={15} /> 排版
            </button>
            <button className="btn" disabled={!hasPrev} onClick={() => stepChapter(-1)}>
              上一章
            </button>
            <button className="btn" disabled={!hasNext} onClick={() => stepChapter(1)}>
              下一章
            </button>
          </div>
        </header>

        {typesettingOpen ? (
          <div className="reader-settings">
            <label>
              字号
              <input
                type="range"
                min={13}
                max={26}
                step={1}
                value={readerSettings.fontSize}
                onChange={(event) =>
                  setReaderSettings((prev) => ({
                    ...prev,
                    fontSize: Number(event.target.value)
                  }))
                }
              />
              <span>{readerSettings.fontSize}px</span>
            </label>
            <label>
              行距
              <input
                type="range"
                min={1.4}
                max={2.6}
                step={0.05}
                value={readerSettings.lineHeight}
                onChange={(event) =>
                  setReaderSettings((prev) => ({
                    ...prev,
                    lineHeight: Number(event.target.value)
                  }))
                }
              />
              <span>{readerSettings.lineHeight.toFixed(2)}</span>
            </label>
            <label>
              页宽
              <input
                type="range"
                min={600}
                max={1200}
                step={20}
                value={readerSettings.width}
                onChange={(event) =>
                  setReaderSettings((prev) => ({ ...prev, width: Number(event.target.value) }))
                }
              />
              <span>{readerSettings.width}px</span>
            </label>
          </div>
        ) : null}

        {reader.loading ? (
          <EmptyState title="正在加载章节正文…" />
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
            <article
              className="novel-content"
              style={{
                fontSize: readerSettings.fontSize,
                lineHeight: readerSettings.lineHeight,
                maxWidth: readerSettings.width
              }}
            >
              {paragraphs.map((line, index) => (
                <p key={`${index}-${line.slice(0, 8)}`}>{line}</p>
              ))}
            </article>
            <div className="reader-footer">
              <button className="btn" disabled={!hasPrev} onClick={() => stepChapter(-1)}>
                上一章
              </button>
              <button className="btn" disabled={!hasNext} onClick={() => stepChapter(1)}>
                下一章
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  if (detail) {
    const progress = detailSource ? detailProgress : undefined
    const resume = detail.chapters.find((chapter) => chapter.id === progress)
    const chapters = chapterDesc ? [...detail.chapters].reverse() : detail.chapters
    const downloadKey = detailSource ? `${detailSource.id}|${detail.bookId}` : ''
    const downloadingThis = downloading && downloading.key === downloadKey ? downloading : null
    const fav = detailSource ? isFavOf(detailSource, detail.bookId) : false
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={closeDetail}>
            <ChevronLeft size={15} /> 返回列表
          </button>
          <h1 className="page-title">{detail.title || '书籍详情'}</h1>
          <div className="page-actions">
            <button className="btn ghost" onClick={() => setChapterDesc((value) => !value)}>
              章节：{chapterDesc ? '倒序' : '正序'}
            </button>
            {resume ? (
              <button className="btn primary" onClick={() => void openChapter(resume)}>
                继续阅读 · {resume.name}
              </button>
            ) : detail.chapters.length ? (
              <button
                className="btn primary"
                onClick={() => void openChapter(detail.chapters[0])}
              >
                开始阅读
              </button>
            ) : null}
            <button
              className="btn"
              disabled={!detail.chapters.length || !!downloading}
              onClick={() => setConfirmingDownload(true)}
              title="下载整本 TXT（保存到下载目录/小说）"
            >
              <Download size={15} />
              {downloadingThis
                ? `下载中 ${downloadingThis.done}/${downloadingThis.total}`
                : downloading
                  ? '下载中…'
                  : '下载 TXT'}
            </button>
            <button
              className="btn"
              disabled={!detailSource}
              onClick={() => detailSource && toggleFav(detailSource, detail)}
            >
              <Heart size={15} fill={fav ? 'currentColor' : 'none'} /> {fav ? '已收藏' : '收藏'}
            </button>
          </div>
        </header>

        <div className="comic-detail">
          <div className="comic-detail-cover novel-detail-cover">
            <NovelCover src={detail.cover} title={detail.title} />
          </div>
          <div className="comic-detail-info">
            <div className="row-title" style={{ whiteSpace: 'normal' }}>
              {detail.title}
            </div>
            <div className="comic-meta">
              {[
                detail.author ? `作者：${detail.author}` : '',
                detailSource?.name ?? '',
                detail.category,
                normalizeNovelStatus(detail.status),
                detail.chapters.length ? `共 ${detail.chapters.length} 章` : ''
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {detail.latestChapter ? (
              <div className="comic-meta">最新：{detail.latestChapter}</div>
            ) : null}
            {detail.intro ? <p className="comic-desc">{detail.intro}</p> : null}
          </div>
        </div>

        {detailLoading ? (
          <EmptyState title="正在加载章节…" />
        ) : detailError ? (
          <EmptyState
            title="章节加载失败"
            desc={detailError}
            action={
              detailSource && detail.bookId ? (
                <button
                  className="btn"
                  onClick={() => void openDetail(detailSource, detail.bookId, detail.title)}
                >
                  重试
                </button>
              ) : undefined
            }
          />
        ) : detail.chapters.length === 0 ? (
          <EmptyState title="没有章节" desc="该书籍暂无可用章节。" />
        ) : (
          <div className="chapter-grid">
            {chapters.map((chapter) => (
              <button
                key={chapter.id}
                className={`chapter-chip ${chapter.id === progress ? 'active' : ''}`}
                onClick={() => void openChapter(chapter)}
              >
                <span>{chapter.name}</span>
                {chapter.id === progress ? <span className="chapter-size">上次看到</span> : null}
              </button>
            ))}
          </div>
        )}

        {confirmingDownload ? (
          <ConfirmDialog
            title="下载小说"
            message={`即将下载《${detail.title}》，共 ${detail.chapters.length} 章。\n下载完成后会合并成一个 TXT，保存到「下载目录/小说」文件夹。\n整本下载可能需要几分钟，确认后开始。`}
            confirmText="开始下载"
            onConfirm={() => {
              setConfirmingDownload(false)
              void downloadBook()
            }}
            onCancel={() => setConfirmingDownload(false)}
          />
        ) : null}
      </>
    )
  }

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageItems =
    mode === 'category' ? items : items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  return (
    <>
      <header className="page-header">
        {focus && onExit ? (
          <button className="btn ghost" onClick={onExit}>
            <ChevronLeft size={15} /> 返回
          </button>
        ) : null}
        <h1 className="page-title">小说</h1>
        <div className="page-actions">
          <ModuleShortcuts
            onOpenFavorites={onOpenFavorites}
            onOpenDownloads={onOpenDownloads}
          />
        </div>
      </header>

      {sources.length === 0 ? (
        <EmptyState
          title="还没有启用的书源"
          desc="到 配置管理 → 片源管理 → 小说源 里启用或添加书源。"
        />
      ) : (
        <>
          <SearchBar
            value={input}
            onChange={setInput}
            onSubmit={() => void doSearch(sourceId, input)}
            onCancel={() => {
              listSeq.current += 1
              setLoading(false)
            }}
            onClear={() => {
              setInput('')
              void loadHome(sourceId)
            }}
            searching={loading && mode === 'search'}
            placeholder="搜索书名 / 作者…"
            onRefresh={() => {
              void window.laozheng.forceRefresh('novel').catch(() => {})
              if (mode === 'search' && keyword) {
                void doSearch(sourceId, keyword)
                return
              }
              if (mode === 'category' && categoryId) {
                void loadCategory(sourceId, categoryId, 1)
                return
              }
              void loadHome(sourceId)
            }}
            refreshing={loading}
            refreshDisabled={mode === 'search' && !keyword}
            leading={
              <select
                className="select-inline"
                value={activeSource ? sourceId : ''}
                disabled={loading}
                title="小说源"
                onChange={(event) => changeSource(event.target.value)}
              >
                <option value="">全部源（{sources.length}）</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            }
          />

          {mode === 'search' && keyword ? (
            <div className="toolbar">
              <span className="page-desc">搜索结果：{keyword}</span>
            </div>
          ) : activeSource ? (
            <div className="toolbar">
              <button
                className={`chip ${mode !== 'category' ? 'active' : ''}`}
                onClick={() => void loadHome(sourceId)}
              >
                推荐
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  className={`chip ${
                    mode === 'category' && categoryId === category.id ? 'active' : ''
                  }`}
                  onClick={() => void loadCategory(sourceId, category.id, 1)}
                >
                  {category.name}
                  {categoryCounts[category.id] > 0 ? (
                    <span className="chip-count">{categoryCounts[category.id]}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          {loading && items.length === 0 ? (
            <EmptyState
              title={
                mode === 'search'
                  ? '正在搜索…'
                  : mode === 'category'
                    ? '正在加载分类…'
                    : '正在加载推荐…'
              }
            />
          ) : error && items.length === 0 ? (
            <EmptyState
              title="加载失败"
              desc={error}
              action={
                <button
                  className="btn"
                  onClick={() =>
                    mode === 'search' && keyword
                      ? void doSearch(sourceId, keyword)
                      : void loadHome(sourceId)
                  }
                >
                  <RefreshCw size={14} /> 重试
                </button>
              }
            />
          ) : items.length === 0 ? (
            <EmptyState
              title={mode === 'search' ? '没有找到书籍' : '暂无推荐'}
              desc={
                mode === 'search'
                  ? '换个书名或作者名再试。'
                  : mode === 'category'
                    ? '换个分类再试。'
                    : '可以直接搜索书名或作者。'
              }
            />
          ) : (
            <>
              {error ? (
                <CacheTip
                  message={`刷新失败：${error}，当前显示上次缓存。`}
                  onRetry={() =>
                    mode === 'search' && keyword
                      ? void doSearch(sourceId, keyword)
                      : void loadHome(sourceId)
                  }
                />
              ) : null}
              <div className="comic-grid">
                {pageItems.map((item) => {
                  const source = sourceOf(item)
                  const fav = source ? isFavOf(source, item.bookId) : false
                  const status = normalizeNovelStatus(item.status)
                  const subtitle = [item.author, status].filter(Boolean).join(' · ')
                  return (
                    <div
                      key={`${item.sourceId ?? source?.id ?? ''}-${item.bookId}`}
                      className="comic-card"
                    >
                      <button
                        className="comic-cover novel-cover"
                        onClick={() =>
                          source &&
                          void openDetail(source, item.bookId, item.title, {
                            author: item.author,
                            cover: item.cover,
                            status: item.status,
                            latestChapter: item.latestChapter
                          })
                        }
                      >
                        <NovelCover src={item.cover} title={item.title} />
                        {source ? (
                          <span
                            className={`fav-heart ${fav ? 'on' : ''}`}
                            role="button"
                            title={fav ? '取消收藏' : '收藏'}
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleFav(source, item)
                            }}
                          >
                            <Heart size={15} fill={fav ? 'currentColor' : 'none'} />
                          </span>
                        ) : null}
                      </button>
                      <div className="comic-title" title={item.title}>
                        {item.title}
                      </div>
                      <div className="comic-sub">{subtitle || '—'}</div>
                    </div>
                  )
                })}
              </div>

              {mode === 'category' ? (
                <Pagination
                  page={categoryPage}
                  lastPage={
                    categoryTotalPages > 0
                      ? categoryTotalPages
                      : categoryHasMore
                        ? categoryPage + 1
                        : categoryPage
                  }
                  hasMore={categoryHasMore}
                  showLast={false}
                  disabled={loading}
                  onChange={(next) => void loadCategory(sourceId, categoryId, next)}
                />
              ) : (
                <Pagination
                  page={currentPage}
                  lastPage={pageCount}
                  disabled={loading}
                  onChange={setPage}
                />
              )}
            </>
          )}
        </>
      )}
    </>
  )
}
