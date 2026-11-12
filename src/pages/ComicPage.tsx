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
import {
  YUMANHUA_CATEGORIES,
  yumanhuaSourceId,
  type YumanhuaChapter,
  type YumanhuaComic
} from '../shared/yumanhua'
import { DEFAULT_COMIC_SOURCES, type ComicSource, type ComicSourceTemplate } from '../shared/comicSources'
import { BIKAHUB_COMIC_CATEGORIES, bikahubComicSourceId } from '../shared/bikahub'
import { TPTOON_CATEGORIES, tptoonComicSourceId } from '../shared/tptoon'
import { JMCOMIC_CATEGORIES, jmcomicComicSourceId } from '../shared/jmcomic'

type Mode = 'recent' | 'hot' | 'category' | 'search'
type ComicSourceId = string

interface ChapterView extends KomiicChapter {
  /** 漫画客章节名（第 12 话 / 番外），有值时直接显示 */
  label?: string
}

const COMIC_SOURCE_KEY = 'laozheng.comic.source'
const COMIC_TEMPLATE_KEY = 'laozheng.comic.template'
/** 搜索结果一次拉全量，前端按 24 条/页分页 */
const COMIC_SEARCH_PAGE_SIZE = 24

function categoriesForTemplate(template: ComicSourceTemplate): KomiicCategory[] {
  if (template === 'bikahub') return BIKAHUB_COMIC_CATEGORIES.map((item) => ({ ...item, count: 0 }))
  if (template === 'tptoon') return TPTOON_CATEGORIES.map((item) => ({ ...item, count: 0 }))
  if (template === 'jmcomic') return JMCOMIC_CATEGORIES.map((item) => ({ ...item, count: 0 }))
  return YUMANHUA_CATEGORIES.map((item) => ({ ...item, count: 0 }))
}

function chapterLabel(chapter: ChapterView): string {
  if (chapter.label) return chapter.label
  return chapter.serial ? `第 ${chapter.serial} 话` : `章节 ${chapter.id}`
}

function yumanhuaToComic(comic: YumanhuaComic): KomiicComic {
  return {
    id: comic.id,
    title: comic.title,
    status: comic.status,
    imageUrl: comic.cover,
    authors: comic.author ? [{ id: '', name: comic.author }] : [],
    categories: comic.tags.map((tag, index) => ({ id: `tag-${index}`, name: tag, count: 0 })),
    dateUpdated: '',
    lastChapterUpdate: comic.latest,
    monthViews: 0,
    views: 0,
    favoriteCount: 0
  }
}

function yumanhuaToChapter(chapter: YumanhuaChapter): ChapterView {
  return {
    id: chapter.id,
    serial: chapter.name,
    type: '',
    size: chapter.size,
    label: chapter.name
  }
}

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

interface YumListCache {
  mode: Mode
  categoryId: string
  query: string
  items: KomiicComic[]
  hasMore: boolean
  lastPage: number
  loaded: boolean
}

const EMPTY_YUM_CACHE: YumListCache = {
  mode: 'recent',
  categoryId: '',
  query: '',
  items: [],
  hasMore: false,
  lastPage: 1,
  loaded: false
}

const yumCache: YumListCache = (() => {
  const cached = loadCache<YumListCache>('comic.yumanhua', EMPTY_YUM_CACHE)
  if (cached.mode !== 'recent' || cached.categoryId || cached.query) {
    return { ...EMPTY_YUM_CACHE }
  }
  return cached
})()

const bkhCache: YumListCache = (() => {
  const cached = loadCache<YumListCache>('comic.bikahub', EMPTY_YUM_CACHE)
  if (cached.mode !== 'recent' || cached.categoryId || cached.query) {
    return { ...EMPTY_YUM_CACHE }
  }
  return cached
})()

const tptCache: YumListCache = (() => {
  const cached = loadCache<YumListCache>('comic.tptoon', EMPTY_YUM_CACHE)
  if (cached.mode !== 'recent' || cached.categoryId || cached.query) {
    return { ...EMPTY_YUM_CACHE }
  }
  return cached
})()

const jmCache: YumListCache = (() => {
  const cached = loadCache<YumListCache>('comic.jmcomic', EMPTY_YUM_CACHE)
  if (cached.mode !== 'recent' || cached.categoryId || cached.query) {
    return { ...EMPTY_YUM_CACHE }
  }
  return cached
})()

/** 漫画客 / 哔咔 / 头牌 / 禁漫天堂都是分页式列表源，各自留一份浏览缓存 */
function listCacheFor(template: ComicSourceTemplate): YumListCache {
  if (template === 'bikahub') return bkhCache
  if (template === 'tptoon') return tptCache
  if (template === 'jmcomic') return jmCache
  return yumCache
}

function listCacheKeyFor(template: ComicSourceTemplate): string {
  if (template === 'bikahub') return 'comic.bikahub'
  if (template === 'tptoon') return 'comic.tptoon'
  if (template === 'jmcomic') return 'comic.jmcomic'
  return 'comic.yumanhua'
}

const storedComicSource: ComicSourceId =
  (typeof localStorage !== 'undefined' ? localStorage.getItem(COMIC_SOURCE_KEY) : '') || 'yumanhua'
const storedComicTemplate: ComicSourceTemplate | '' =
  typeof localStorage !== 'undefined'
    ? (localStorage.getItem(COMIC_TEMPLATE_KEY) as ComicSourceTemplate | null) || ''
    : ''
const initialTemplate: ComicSourceTemplate =
  storedComicTemplate ||
  (storedComicSource === 'komiic'
    ? 'komiic'
    : storedComicSource === 'bikahub'
      ? 'bikahub'
      : storedComicSource === 'tptoon'
        ? 'tptoon'
        : storedComicSource === 'jmcomic'
          ? 'jmcomic'
          : 'yumanhua')

const sourceInitialCache =
  initialTemplate === 'komiic' ? cache : listCacheFor(initialTemplate)
const sourceInitialMode: Mode = initialTemplate === 'komiic' ? initialMode : 'recent'

function findComicSource(sources: ComicSource[], id: string): ComicSource | undefined {
  return sources.find((source) => source.id === id)
}

function sourceOfComic(sources: ComicSource[], id: string): ComicSource | undefined {
  if (id.startsWith('ymh')) {
    const sourceId = yumanhuaSourceId(id)
    return sources.find((source) => source.id === sourceId) ??
      sources.find((source) => source.template === 'yumanhua')
  }
  if (id.startsWith('bkh')) {
    const sourceId = bikahubComicSourceId(id)
    return sources.find((source) => source.id === sourceId) ??
      sources.find((source) => source.template === 'bikahub')
  }
  if (id.startsWith('tpt')) {
    const sourceId = tptoonComicSourceId(id)
    return sources.find((source) => source.id === sourceId) ??
      sources.find((source) => source.template === 'tptoon')
  }
  if (/^jm[_A-Za-z0-9]*:/.test(id)) {
    const sourceId = jmcomicComicSourceId(id)
    return sources.find((source) => source.id === sourceId) ??
      sources.find((source) => source.template === 'jmcomic')
  }
  return sources.find((source) => source.template === 'komiic')
}

interface DetailState {
  comic: KomiicComic
  chapters: ChapterView[]
  loading: boolean
  error: string | null
}

interface ReaderState {
  comic: KomiicComic
  chapter: ChapterView
  urls: string[]
  loading: boolean
  error: string | null
}

/** 章节统一按话数升序存放，展示时默认倒序 */
function sortChapters<T extends KomiicChapter>(items: T[]): T[] {
  const numberOf = (value: string): number => {
    // 兼容「第107.2话」「2话」「01」等写法
    const matched = /^第?\s*(\d{1,6}(?:\.\d{1,2})?)/.exec(value.trim())
    if (matched) return Number(matched[1])
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }
  return [...items].sort((a, b) => {
    const na = numberOf(a.serial)
    const nb = numberOf(b.serial)
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
  const comicSources = data.comicSources ?? DEFAULT_COMIC_SOURCES
  const enabledComicSources = comicSources.filter((item) => item.enabled)
  const [sourceId, setSourceId] = useState<ComicSourceId>(storedComicSource)
  const activeComicSource =
    findComicSource(enabledComicSources, sourceId) ??
    findComicSource(comicSources, sourceId) ??
    enabledComicSources[0] ??
    comicSources[0]
  const activeTemplate = activeComicSource?.template ?? initialTemplate
  const [categories, setCategories] = useState<KomiicCategory[]>(
    initialTemplate === 'komiic' ? categoryCache : categoriesForTemplate(initialTemplate)
  )
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({})
  const [mode, setMode] = useState<Mode>(sourceInitialMode)
  const [categoryId, setCategoryId] = useState(
    initialTemplate === 'komiic' ? cache.categoryId : ''
  )
  const [query, setQuery] = useState(initialTemplate === 'komiic' ? cache.query : '')
  const [input, setInput] = useState(initialTemplate === 'komiic' ? cache.query : '')
  const [items, setItems] = useState<KomiicComic[]>(sourceInitialCache.items)
  const [searchPage, setSearchPage] = useState(1)
  const [hasMore, setHasMore] = useState(sourceInitialCache.hasMore)
  const [lastPage, setLastPage] = useState(
    initialTemplate === 'komiic' ? cache.lastPage ?? 0 : sourceInitialCache.lastPage ?? 1
  )
  const [pageNum, setPageNum] = useState(
    initialTemplate === 'komiic'
      ? Math.floor(cache.offset / KOMIIC_PAGE_SIZE) + 1
      : 1
  )
  const [pending, setPending] = useState<{ mode: Mode; categoryId: string } | null>(null)
  const [loading, setLoading] = useState(!sourceInitialCache.loaded)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [reader, setReader] = useState<ReaderState | null>(null)
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null)
  const [confirmBatch, setConfirmBatch] = useState<ChapterView[] | null>(null)
  const [chapterDesc, setChapterDesc] = useState(true)
  const readerRef = useRef<HTMLDivElement | null>(null)
  const requestSeq = useRef(0)
  /** 只应用最后一次章节取图结果，避免返回后旧请求又把阅读器打开 */
  const chapterSeq = useRef(0)
  /** 只应用最后一次详情请求，避免连点两部漫画时旧响应覆盖新详情 */
  const detailOpenSeq = useRef(0)
  const listKeyRef = useRef('')
  const probeCache = useRef(new Map<string, number>())

  useEffect(() => {
    if (resetSignal === undefined) return
    chapterSeq.current += 1
    detailOpenSeq.current += 1
    setDetail(null)
    setReader(null)
  }, [resetSignal])

  const fetchPage = async (
    nextMode: Mode,
    nextCategoryId: string,
    nextQuery: string,
    nextOffset: number,
    nextSourceId: ComicSourceId = sourceId,
    nextPage = Math.floor(nextOffset / KOMIIC_PAGE_SIZE) + 1
  ) => {
    const sourceConfig =
      findComicSource(enabledComicSources, nextSourceId) ??
      findComicSource(comicSources, nextSourceId) ??
      activeComicSource
    const template = sourceConfig?.template ?? 'yumanhua'
    if (
      template === 'yumanhua' ||
      template === 'bikahub' ||
      template === 'tptoon' ||
      template === 'jmcomic'
    ) {
      const baseUrl = sourceConfig?.baseUrl
      const sid = sourceConfig?.id
      const api =
        template === 'bikahub'
          ? {
              recent: () => window.laozheng.bikahubComicRecent(baseUrl, sid, nextPage),
              hot: () => window.laozheng.bikahubComicHot(baseUrl, sid, nextPage),
              category: (category: string) =>
                window.laozheng.bikahubComicCategory(category, baseUrl, sid, nextPage),
              search: (keyword: string) =>
                window.laozheng.bikahubComicSearch(keyword, baseUrl, sid)
            }
          : template === 'tptoon'
            ? {
                recent: () => window.laozheng.tptoonComicRecent(baseUrl, sid, nextPage),
                hot: () => window.laozheng.tptoonComicHot(baseUrl, sid, nextPage),
                category: (category: string) =>
                  window.laozheng.tptoonComicCategory(category, baseUrl, sid, nextPage),
                search: (keyword: string) =>
                  window.laozheng.tptoonComicSearch(keyword, baseUrl, sid)
              }
            : template === 'jmcomic'
              ? {
                  recent: () => window.laozheng.jmcomicRecent(baseUrl, sid, nextPage),
                  hot: () => window.laozheng.jmcomicHot(baseUrl, sid, nextPage),
                  category: (category: string) =>
                    window.laozheng.jmcomicCategory(category, baseUrl, sid, nextPage),
                  search: (keyword: string) =>
                    window.laozheng.jmcomicSearch(keyword, baseUrl, sid, nextPage)
                }
              : {
                  recent: () => window.laozheng.yumanhuaRecent(baseUrl, sid),
                  hot: () => window.laozheng.yumanhuaHot(baseUrl, sid),
                  category: (category: string) =>
                    window.laozheng.yumanhuaCategory(category, baseUrl, sid),
                  search: (keyword: string) =>
                    window.laozheng.yumanhuaSearch(keyword, baseUrl, sid)
                }
      const res =
        nextMode === 'recent'
          ? await api.recent()
          : nextMode === 'hot'
            ? await api.hot()
            : nextMode === 'category'
              ? await api.category(nextCategoryId)
              : await api.search(nextQuery)
      return {
        ok: res.ok,
        items: res.items.map(yumanhuaToComic),
        error: res.error,
        hasMore: res.hasMore === true,
        lastPage: res.totalPages
      }
    }
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
    const key = `komiic|${targetMode}|${targetCategory}|${targetQuery}`
    if (probeCache.current.has(key)) {
      if (listKeyRef.current === key) setLastPage(probeCache.current.get(key) ?? 1)
      return
    }
    const offsetOf = (p: number) => Math.max(0, (p - 1) * KOMIIC_PAGE_SIZE)
    let low = 1
    let high = 2
    try {
      while (high <= 4096) {
        const res = await fetchPage(targetMode, targetCategory, targetQuery, offsetOf(high), 'komiic')
        if (!res.ok || !res.items.length) break
        low = high
        high *= 2
      }
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2)
        const res = await fetchPage(targetMode, targetCategory, targetQuery, offsetOf(mid), 'komiic')
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
    nextPage: number,
    nextSourceId: ComicSourceId = sourceId
  ) => {
    const sourceConfig =
      findComicSource(enabledComicSources, nextSourceId) ??
      findComicSource(comicSources, nextSourceId) ??
      activeComicSource
    if (!sourceConfig) {
      setPending(null)
      setLoading(false)
      setError('没有启用的漫画源，请到「配置管理 → 片源管理 → 漫画源」启用')
      return
    }
    const template = sourceConfig.template
    const isKomiic = template === 'komiic'
    const nextOffset = Math.max(0, (nextPage - 1) * KOMIIC_PAGE_SIZE)
    const seq = ++requestSeq.current
    if (nextMode === 'search') setSearchPage(1)
    setPending({ mode: nextMode, categoryId: nextCategoryId })
    setLoading(true)
    setError(null)
    const res = await fetchPage(
      nextMode,
      nextCategoryId,
      nextQuery,
      nextOffset,
      nextSourceId,
      nextPage
    )
    if (seq !== requestSeq.current) return
    setPending(null)
    setLoading(false)
    if (!res.ok) {
      setError(res.error ?? '加载失败')
      return
    }
    const nextHasMore = isKomiic
      ? res.items.length >= KOMIIC_PAGE_SIZE
      : (res as { hasMore?: boolean }).hasMore === true
    const key = `${nextSourceId}|${nextMode}|${nextCategoryId}|${nextQuery}`
    listKeyRef.current = key
    const knownLastPage = isKomiic
      ? probeCache.current.get(key) ?? 0
      : ((res as { lastPage?: number }).lastPage ?? (template === 'tptoon' ? 0 : 1))
    setItems(res.items)
    setHasMore(nextHasMore)
    setLastPage(knownLastPage)
    setPageNum(nextPage)
    setMode(nextMode)
    setCategoryId(nextCategoryId)
    setQuery(nextQuery)
    if (!isKomiic) {
      const targetCache = listCacheFor(template)
      const cacheKey = listCacheKeyFor(template)
      Object.assign(targetCache, {
        mode: nextMode,
        categoryId: nextCategoryId,
        query: nextQuery,
        items: res.items,
        hasMore: nextHasMore,
        lastPage: knownLastPage,
        loaded: true
      })
      if (nextMode === 'recent' && !nextCategoryId && !nextQuery && nextPage === 1) {
        saveCache<YumListCache>(cacheKey, { ...targetCache })
      }
    } else {
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
  }

  const loadKomiicCategories = () => {
    if (categoryCache.length) {
      setCategories(categoryCache)
      return
    }
    void window.laozheng.komiicCategories().then((res) => {
      if (!res.ok) return
      categoryCache = res.items
      saveCache<KomiicCategory[]>('comic.categories', res.items)
      setCategories(res.items)
    })
  }

  useEffect(() => {
    if (activeTemplate !== 'komiic') {
      setCategories(categoriesForTemplate(activeTemplate))
      // 有缓存也请求一次：点标题刷新会重挂载本页，但模块级缓存 loaded 仍是 true，不能靠它跳过
      void load('recent', '', '', 1, sourceId)
    } else {
      void load(initialMode, cache.categoryId, cache.query, 1, sourceId)
      loadKomiicCategories()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 哔咔 / 头牌 / 禁漫分类数量：哔咔取分类页 total，头牌二分探末页，禁漫按末页折算（主进程缓存 24 小时）
  useEffect(() => {
    setCategoryCounts({})
    if (
      activeTemplate !== 'bikahub' &&
      activeTemplate !== 'tptoon' &&
      activeTemplate !== 'jmcomic'
    ) {
      return
    }
    let alive = true
    const baseUrl = activeComicSource?.baseUrl
    const load =
      activeTemplate === 'bikahub'
        ? window.laozheng.bikahubComicCategoryCounts(baseUrl)
        : activeTemplate === 'tptoon'
          ? window.laozheng.tptoonComicCategoryCounts(baseUrl)
          : window.laozheng.jmcomicCategoryCounts(baseUrl)
    void load
      .then((res) => {
        if (alive && res.ok) setCategoryCounts(res.counts)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTemplate, activeComicSource?.id, activeComicSource?.baseUrl])

  const changeSource = (next: ComicSourceId) => {
    if (next === sourceId) return
    const nextConfig =
      findComicSource(comicSources, next) ?? enabledComicSources[0] ?? comicSources[0]
    const nextTemplate = nextConfig?.template ?? 'yumanhua'
    localStorage.setItem(COMIC_SOURCE_KEY, next)
    localStorage.setItem(COMIC_TEMPLATE_KEY, nextTemplate)
    requestSeq.current += 1
    chapterSeq.current += 1
    detailOpenSeq.current += 1
    setSourceId(next)
    setDetail(null)
    setReader(null)
    setError(null)
    setQuery('')
    setInput('')
    setCategoryId('')
    setMode('recent')
    setPageNum(1)
    setSearchPage(1)
    setPending(null)
    if (nextTemplate !== 'komiic') {
      setCategories(categoriesForTemplate(nextTemplate))
      const cached = listCacheFor(nextTemplate)
      setItems(cached.items)
      setHasMore(cached.hasMore)
      setLastPage(cached.lastPage ?? 1)
      setLoading(!cached.loaded)
      void load('recent', '', '', 1, next)
    } else {
      loadKomiicCategories()
      setItems(cache.items)
      setHasMore(cache.hasMore)
      setLastPage(cache.lastPage ?? 0)
      setLoading(!cache.loaded)
      void load('recent', '', '', 1, next)
    }
  }

  useEffect(() => {
    if (!enabledComicSources.length) return
    if (enabledComicSources.some((item) => item.id === sourceId)) return
    // 当前源被停用 / 删除：走正常切源流程，清详情并重新拉列表，避免「新源选择器 + 旧源列表」
    changeSource(enabledComicSources[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.comicSources, sourceId, enabledComicSources])

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
    const seq = ++detailOpenSeq.current
    setChapterDesc(true)
    setDetail({ comic, chapters: [], loading: true, error: null })
    const config = sourceOfComic(comicSources, comic.id)
    const template = config?.template ?? 'yumanhua'
    if (template !== 'komiic') {
      const baseUrl = config?.baseUrl
      const [detailRes, chapterRes] =
        template === 'bikahub'
          ? await Promise.all([
              window.laozheng.bikahubComicDetail(comic.id, baseUrl),
              window.laozheng.bikahubComicChapters(comic.id, baseUrl)
            ])
          : template === 'tptoon'
            ? await Promise.all([
                window.laozheng.tptoonComicDetail(comic.id, baseUrl),
                window.laozheng.tptoonComicChapters(comic.id, baseUrl)
              ])
            : template === 'jmcomic'
              ? await Promise.all([
                  window.laozheng.jmcomicDetail(comic.id, baseUrl),
                  window.laozheng.jmcomicChapters(comic.id, baseUrl)
                ])
              : await Promise.all([
                  window.laozheng.yumanhuaDetail(comic.id, baseUrl),
                  window.laozheng.yumanhuaChapters(comic.id, baseUrl)
                ])
      const parsed = detailRes.ok && detailRes.comic ? yumanhuaToComic(detailRes.comic) : comic
      // 头牌详情页没有连载状态：保留列表卡片上的状态，避免显示「未知」
      const merged = parsed.status || !comic.status ? parsed : { ...parsed, status: comic.status }
      if (seq !== detailOpenSeq.current) return
      setDetail({
        comic: merged,
        chapters: chapterRes.ok ? chapterRes.items.map(yumanhuaToChapter) : [],
        loading: false,
        error: detailRes.ok
          ? chapterRes.ok
            ? null
            : chapterRes.error ?? '章节加载失败'
          : detailRes.error ?? '详情加载失败'
      })
      return
    }
    const [detailRes, chapterRes] = await Promise.all([
      window.laozheng.komiicDetail(comic.id),
      window.laozheng.komiicChapters(comic.id)
    ])
    const merged = detailRes.ok && detailRes.comic ? detailRes.comic : comic
    if (seq !== detailOpenSeq.current) return
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
    const config = sourceOfComic(comicSources, id)
    const template = config?.template ?? 'yumanhua'
    const targetSourceId =
      config?.id ??
      (template === 'komiic'
        ? 'komiic'
        : template === 'bikahub'
          ? 'bikahub'
          : template === 'tptoon'
            ? 'tptoon'
            : template === 'jmcomic'
              ? 'jmcomic'
              : 'yumanhua')
    if (targetSourceId !== sourceId) {
      localStorage.setItem(COMIC_SOURCE_KEY, targetSourceId)
      localStorage.setItem(COMIC_TEMPLATE_KEY, template)
      setSourceId(targetSourceId)
      if (template !== 'komiic') {
        setCategories(categoriesForTemplate(template))
        const cached = listCacheFor(template)
        setItems(cached.items)
        setHasMore(cached.hasMore)
        setLastPage(cached.lastPage ?? 1)
      } else {
        loadKomiicCategories()
        setItems(cache.items)
        setHasMore(cache.hasMore)
        setLastPage(cache.lastPage ?? 0)
      }
    }
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
    if (template !== 'komiic') {
      const baseUrl = config?.baseUrl
      const [detailRes, chapterRes] =
        template === 'bikahub'
          ? await Promise.all([
              window.laozheng.bikahubComicDetail(id, baseUrl),
              window.laozheng.bikahubComicChapters(id, baseUrl)
            ])
          : template === 'tptoon'
            ? await Promise.all([
                window.laozheng.tptoonComicDetail(id, baseUrl),
                window.laozheng.tptoonComicChapters(id, baseUrl)
              ])
            : template === 'jmcomic'
              ? await Promise.all([
                  window.laozheng.jmcomicDetail(id, baseUrl),
                  window.laozheng.jmcomicChapters(id, baseUrl)
                ])
              : await Promise.all([
                  window.laozheng.yumanhuaDetail(id, baseUrl),
                  window.laozheng.yumanhuaChapters(id, baseUrl)
                ])
      if (alive && !alive()) return
      setDetail({
        comic:
          detailRes.ok && detailRes.comic ? yumanhuaToComic(detailRes.comic) : placeholder,
        chapters: chapterRes.ok ? chapterRes.items.map(yumanhuaToChapter) : [],
        loading: false,
        error: detailRes.ok
          ? chapterRes.ok
            ? null
            : chapterRes.error ?? '章节加载失败'
          : detailRes.error ?? '详情加载失败'
      })
      return
    }
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
      chapterSeq.current += 1
      detailOpenSeq.current += 1
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

  const openChapter = async (chapter: ChapterView) => {
    const comic = detail?.comic
    if (!comic) return
    const seq = ++chapterSeq.current
    setReader({ comic, chapter, urls: [], loading: true, error: null })
    const config = sourceOfComic(comicSources, comic.id)
    const template = config?.template ?? 'yumanhua'
    const res =
      template === 'bikahub'
        ? await window.laozheng.bikahubComicImages(comic.id, chapter.id, config?.baseUrl)
        : template === 'tptoon'
          ? await window.laozheng.tptoonComicImages(comic.id, chapter.id, config?.baseUrl)
          : template === 'jmcomic'
            ? await window.laozheng.jmcomicImages(comic.id, chapter.id, config?.baseUrl)
            : template === 'yumanhua'
              ? await window.laozheng.yumanhuaImages(comic.id, chapter.id, config?.baseUrl)
              : await window.laozheng.komiicImages(comic.id, chapter.id)
    if (seq !== chapterSeq.current) return
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

  const closeReader = () => {
    chapterSeq.current += 1
    setReader(null)
  }

  /** 漫画下载用的源信息：单张 / 整本共用 */
  const comicDownloadMeta = (comicId: string) => {
    const config = sourceOfComic(comicSources, comicId)
    const template = config?.template ?? 'yumanhua'
    return {
      template,
      referer:
        template === 'komiic'
          ? 'https://komiic.com/'
          : `${
              config?.baseUrl ??
              (template === 'bikahub'
                ? 'https://bikahub.net'
                : template === 'tptoon'
                  ? 'https://tptoon.net'
                  : template === 'jmcomic'
                    ? 'https://18comic66.com'
                    : 'http://www.yumanhua.com')
            }/`,
      sourceName:
        config?.name ??
        (template === 'komiic'
          ? '漫画'
          : template === 'bikahub'
            ? '哔咔漫画'
            : template === 'tptoon'
              ? '头牌漫画'
              : template === 'jmcomic'
                ? '禁漫天堂'
                : '漫画客')
    }
  }

  /** 网格浏览卡片右上角：单张图片直接加入下载 */
  const saveReaderImage = async (url: string, index: number) => {
    if (!reader) return
    const meta = comicDownloadMeta(reader.comic.id)
    try {
      const res = await window.laozheng.addDownload({
        title: `${reader.comic.title}-${chapterLabel(reader.chapter)}-${index + 1}`,
        url,
        kind: 'comic',
        coverUrl: reader.comic.imageUrl,
        sourceName: meta.sourceName,
        referer: meta.referer
      })
      onNotice(res.ok ? '已加入下载管理，可在下载 → 漫画查看' : res.error ?? '加入下载失败')
    } catch (err) {
      onNotice(`下载失败：${(err as Error).message}`)
    }
  }

  const downloadChapters = async (chapters: ChapterView[]) => {
    const comic = detail?.comic
    if (!comic || !chapters.length || batch) return
    const config = sourceOfComic(comicSources, comic.id)
    const template = config?.template ?? 'yumanhua'
    const meta = comicDownloadMeta(comic.id)
    setBatch({ done: 0, total: chapters.length })
    const payload: { key: string; name: string; urls: string[] }[] = []
    try {
      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i]
        const res =
          template === 'bikahub'
            ? await window.laozheng.bikahubComicImages(comic.id, chapter.id, config?.baseUrl)
            : template === 'tptoon'
              ? await window.laozheng.tptoonComicImages(comic.id, chapter.id, config?.baseUrl)
              : template === 'jmcomic'
                ? await window.laozheng.jmcomicImages(comic.id, chapter.id, config?.baseUrl)
                : template === 'yumanhua'
                  ? await window.laozheng.yumanhuaImages(comic.id, chapter.id, config?.baseUrl)
                  : await window.laozheng.komiicImages(comic.id, chapter.id)
        if (res.ok && res.urls.length) {
          payload.push({
            key: chapter.id,
            name: chapter.label || (chapter.serial ? `第 ${chapter.serial} 话` : chapter.id),
            urls: res.urls
          })
        } else {
          onNotice(`${chapterLabel(chapter)} 取图失败，已跳过`)
        }
        setBatch({ done: i + 1, total: chapters.length })
      }
      if (!payload.length) {
        onNotice('没有可下载的章节')
        return
      }
      const res = await window.laozheng.addComicBatchDownload({
        comic: {
          source: template,
          id: comic.id,
          title: comic.title,
          cover: comic.imageUrl
        },
        chapters: payload,
        referer: meta.referer,
        sourceName: meta.sourceName
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
          <button className="btn ghost" onClick={closeReader}>
            <ChevronLeft size={15} /> 返回章节
          </button>
          <h1 className="page-title">{reader.comic.title}</h1>
          <span className="page-desc">
            {chapterLabel(reader.chapter)}
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
            <ComicReader images={reader.urls} onSaveImage={saveReaderImage} />
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
              chapterSeq.current += 1
              detailOpenSeq.current += 1
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
                继续阅读 · {chapterLabel(resumeChapter)}
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
                {chapterLabel(chapter)}
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

  const clientSearchPaging =
    mode === 'search' && (activeTemplate === 'bikahub' || activeTemplate === 'tptoon')
  const searchLastPage = Math.max(1, Math.ceil(items.length / COMIC_SEARCH_PAGE_SIZE))
  const safeSearchPage = Math.min(Math.max(1, searchPage), searchLastPage)
  const visibleItems = clientSearchPaging
    ? items.slice(
        (safeSearchPage - 1) * COMIC_SEARCH_PAGE_SIZE,
        safeSearchPage * COMIC_SEARCH_PAGE_SIZE
      )
    : items

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
        onRefresh={() => {
          void window.laozheng.forceRefresh('comic').catch(() => {})
          void load(mode, categoryId, query, pageNum)
        }}
        refreshing={loading}
        placeholder={
          activeTemplate === 'yumanhua'
            ? '搜索漫画客漫画…'
            : activeTemplate === 'bikahub'
              ? '搜索哔咔漫画…'
              : activeTemplate === 'tptoon'
                ? '搜索头牌漫画…'
                : activeTemplate === 'jmcomic'
                  ? '搜索禁漫天堂漫画…'
                  : '搜索 Komiic 漫画…'
        }
        leading={
          <select
            className="select-inline"
            value={sourceId}
            disabled={loading && items.length === 0}
            title="漫画源"
            onChange={(e) => changeSource(e.target.value)}
          >
            {enabledComicSources.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.template === 'komiic' ? '（外网）' : ''}
              </option>
            ))}
          </select>
        }
      />

      {query ? (
        <div className="toolbar">
          <span className="page-desc">
            搜索结果：{query}
            {clientSearchPaging && items.length > 0 ? `（${items.length} 条）` : ''}
          </span>
        </div>
      ) : (
        <div className="toolbar">
          <button
            className={`chip ${(pending?.mode ?? mode) === 'recent' ? 'active' : ''}`}
            onClick={() => void load('recent', '', '', 1)}
          >
            {activeTemplate === 'yumanhua' ? '最近更新' : '最近'}
          </button>
          {activeTemplate !== 'bikahub' ? (
            <button
              className={`chip ${(pending?.mode ?? mode) === 'hot' ? 'active' : ''}`}
              onClick={() => void load('hot', '', '', 1)}
            >
              {activeTemplate === 'yumanhua' ? '排行榜' : '热门'}
            </button>
          ) : null}
          {categories.map((c) => {
            const active = pending
              ? pending.mode === 'category' && pending.categoryId === c.id
              : mode === 'category' && categoryId === c.id
            const count = categoryCounts[c.id] ?? c.count
            return (
              <button
                key={c.id}
                className={`chip ${active ? 'active' : ''}`}
                onClick={() => void load('category', c.id, '', 1)}
              >
                {c.name}
                {count > 0 ? <span className="chip-count">{count}</span> : null}
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
            {visibleItems.map((comic) => (
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

          {clientSearchPaging ? (
            <Pagination
              page={safeSearchPage}
              lastPage={searchLastPage}
              disabled={loading}
              onChange={setSearchPage}
            />
          ) : (
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
          )}
        </>
      )}
    </>
  )
}
