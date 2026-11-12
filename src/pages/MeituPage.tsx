import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Download, Heart, Loader2 } from 'lucide-react'
import { useData } from '../state/DataContext'
import {
  ConfirmDialog,
  EmptyState,
  LoadingBlock,
  ModuleShortcuts,
  Pagination
} from '../components/ui'
import { ComicReader } from '../components/ComicReader'
import { SearchBar } from '../components/SearchBar'
import { loadCache, saveCache } from '../utils/cache'
import {
  meituFallbackCategories,
  toMeituSourceRef,
  type MeituAlbum,
  type MeituAlbumDetail,
  type MeituCategory,
  type MeituFocus,
  type MeituPageData,
  type MeituSource,
  type MeituStar
} from '../shared/meitu'

interface MeituCache {
  source: string
  category: string
  page: number
  data: MeituPageData | null
}

const EMPTY_CACHE: MeituCache = { source: '', category: '', page: 1, data: null }

/** 魅影画廊分类 id：全部 / 旧版 c<termId> / 站点导航 slug（可含 / 与百分号编码） */
function isJb9CategoryId(value: string): boolean {
  return value === '@stars' || /^c\d+$/.test(value) || /^[\w%./-]+$/.test(value)
}

function readInitialCache(sources: MeituSource[]): MeituCache {
  const cached = loadCache<MeituCache>('meitu2', EMPTY_CACHE)
  const source = sources.find((entry) => entry.id === cached.source) ?? sources[0]
  if (!source) return { source: '', category: '', page: 1, data: null }
  const saved = typeof cached.category === 'string' ? cached.category : ''
  // 雪月映画不展示分类；明星作品列表不恢复（缓存里没有明星名字）；非法分类 id 一并作废
  const category =
    source.template === 'taoo' ||
    saved.startsWith('@author:') ||
    (saved !== '' && !isJb9CategoryId(saved))
      ? ''
      : saved
  const usable =
    cached.source === source.id &&
    cached.data &&
    Array.isArray(cached.data.items) &&
    cached.data.items.length > 0 &&
    (cached.data.category ?? '') === category
  const data = usable
    ? {
        ...cached.data!,
        source: source.id,
        keyword: '',
        category,
        page: cached.page || 1,
        items: (cached.data!.items ?? []).filter((item) => item.source === source.id)
      }
    : null
  return {
    source: source.id,
    category,
    page: data?.page ?? 1,
    data: data && data.items.length ? data : null
  }
}

function sourceReferer(source: MeituSource): string {
  try {
    return `${new URL(source.baseUrl).origin}/`
  } catch {
    return ''
  }
}

function albumKey(album: Pick<MeituAlbum, 'source' | 'id'>): string {
  return `${album.source}|${album.id}`
}

function starCategory(star: MeituStar): string {
  return `@author:${star.slug}`
}

interface ViewerState {
  album: MeituAlbum
  images: { url: string; thumb?: string }[]
  loading: boolean
  error: string | null
}

export function MeituPage({
  onNotice,
  focus,
  resetSignal,
  onExit,
  onOpenFavorites,
  onOpenDownloads
}: {
  onNotice: (text: string) => void
  focus?: MeituFocus
  resetSignal?: number
  onExit?: () => void
  onOpenFavorites?: () => void
  onOpenDownloads?: () => void
}) {
  const { data: appData, update } = useData()
  /** 美图源来自片源管理，只展示启用的源 */
  const sources = useMemo(
    () => appData.meituSources.filter((entry) => entry.enabled),
    [appData.meituSources]
  )
  const [initial] = useState(() => readInitialCache(sources))
  const [sourceId, setSourceId] = useState(initial.source)
  const [category, setCategory] = useState(initial.category)
  const [starName, setStarName] = useState('')
  const [pageNum, setPageNum] = useState(initial.page)
  const [input, setInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [data, setData] = useState<MeituPageData | null>(initial.data)
  const [loading, setLoading] = useState(!initial.data)
  const [error, setError] = useState<string | null>(null)
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  const [confirmDownload, setConfirmDownload] = useState(false)
  const [saving, setSaving] = useState(false)
  const [broken, setBroken] = useState<Record<string, true>>({})
  const [categoriesMap, setCategoriesMap] = useState<Record<string, MeituCategory[]>>({})
  const requestSeq = useRef(0)
  const detailCache = useRef(new Map<string, MeituAlbumDetail>())
  const openedFocus = useRef(0)
  const activeSource = useMemo(
    () => sources.find((entry) => entry.id === sourceId) ?? sources[0],
    [sources, sourceId]
  )
  const categoryKey = activeSource
    ? `${activeSource.id}|${activeSource.template}|${activeSource.baseUrl}`
    : ''
  const categories = useMemo(
    () =>
      activeSource
        ? categoriesMap[categoryKey] ?? meituFallbackCategories(activeSource)
        : [],
    [categoriesMap, categoryKey, activeSource]
  )
  const visibleItems = useMemo(
    () => (data ? data.items.filter((item) => !broken[albumKey(item)]) : []),
    [data, broken]
  )
  const viewerUrls = useMemo(
    () => (viewer ? viewer.images.map((image) => image.url) : []),
    [viewer?.images]
  )

  const load = async (next?: {
    sourceId?: string
    category?: string
    page?: number
    keyword?: string
  }) => {
    const nextSource =
      sources.find((entry) => entry.id === (next?.sourceId ?? activeSource?.id)) ?? activeSource
    if (!nextSource) return
    const nextCategory = next?.category ?? category
    const nextPage = next?.page ?? pageNum
    const nextKeyword = next?.keyword ?? keyword
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    const res = await window.laozheng.meituList(
      toMeituSourceRef(nextSource),
      nextCategory,
      nextPage,
      nextKeyword
    )
    if (seq !== requestSeq.current) return
    setLoading(false)
    if (!res.ok || !res.page) {
      setError(res.error ?? '加载失败')
      return
    }
    setData(res.page)
    if (!nextKeyword) {
      saveCache<MeituCache>('meitu2', {
        source: nextSource.id,
        category: nextCategory,
        page: nextPage,
        data: res.page
      })
    }
  }

  useEffect(() => {
    // 有缓存也照常请求一次：先显示缓存，主进程再按 TTL 静默刷新，避免套图首页一直停在旧列表
    if (activeSource) void load({})
    // 首次进入只加载一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // 雪月映画不展示分类，也就不必抓分类
    if (!activeSource || activeSource.template !== 'jb9') return
    const key = `${activeSource.id}|${activeSource.template}|${activeSource.baseUrl}`
    let alive = true
    const fallback = meituFallbackCategories(activeSource)
    setCategoriesMap((prev) => (prev[key] ? prev : { ...prev, [key]: fallback }))
    window.laozheng
      .meituCategories(toMeituSourceRef(activeSource))
      .then((res) => {
        if (!alive || !res.ok || !res.categories?.length) return
        setCategoriesMap((prev) => ({ ...prev, [key]: res.categories! }))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // 只在源变化时同步分类
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryKey])

  const resetReady = useRef(false)
  useEffect(() => {
    if (!resetReady.current) {
      resetReady.current = true
      return
    }
    if (!activeSource) return
    setInput('')
    setKeyword('')
    setCategory('')
    setStarName('')
    setPageNum(1)
    setViewer(null)
    void load({ category: '', page: 1, keyword: '' })
    // 点标题回到默认态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal])

  const isFav = (album: Pick<MeituAlbum, 'source' | 'id'>): boolean =>
    appData.innerFavs.some((fav) => fav.module === 'meitu' && fav.id === albumKey(album))

  const sourceName = (id: string): string =>
    appData.meituSources.find((entry) => entry.id === id)?.name ?? '套图'

  const toggleFav = (album: MeituAlbum, images: number) => {
    const exists = isFav(album)
    const meta = [
      sourceName(album.source),
      images > 0 ? `${images} 张` : '',
      album.tags.slice(0, 2).join(' / ')
    ]
      .filter(Boolean)
      .join(' · ')
    const payload = {
      source: album.source,
      pageUrl: album.pageUrl,
      cover: album.cover,
      title: album.title,
      imageCount: images,
      tags: album.tags
    }
    update((current) =>
      exists
        ? {
            ...current,
            innerFavs: current.innerFavs.filter(
              (fav) => !(fav.module === 'meitu' && fav.id === albumKey(album))
            )
          }
        : {
            ...current,
            innerFavs: [
              ...current.innerFavs,
              {
                module: 'meitu',
                id: albumKey(album),
                title: album.title,
                subtitle: meta,
                cover: album.cover || null,
                savedAt: Date.now(),
                videoUrl: null,
                mediaId: 0,
                durationSec: 0,
                tweetUrl: null,
                payload: JSON.stringify(payload)
              }
            ]
          }
    )
    onNotice(exists ? '已取消收藏' : '已收藏，可在收藏页查看')
  }

  const openAlbum = async (album: MeituAlbum) => {
    const sourceConfig = appData.meituSources.find((entry) => entry.id === album.source)
    if (!sourceConfig) {
      onNotice('这个套图源已被删除')
      return
    }
    const key = `${album.source}|${album.pageUrl}`
    const cached = detailCache.current.get(key)
    if (cached) {
      setViewer({ album, images: cached.images, loading: false, error: null })
      return
    }
    setViewer({ album, images: [], loading: true, error: null })
    const res = await window.laozheng.meituDetail(toMeituSourceRef(sourceConfig), album.pageUrl)
    if (!res.ok || !res.album) {
      setViewer({
        album,
        images: [],
        loading: false,
        error: res.error ?? '加载图集失败'
      })
      return
    }
    detailCache.current.set(key, res.album)
    setViewer({
      album: { ...album, title: res.album.title || album.title, imageCount: res.album.images.length },
      images: res.album.images,
      loading: false,
      error: null
    })
  }

  useEffect(() => {
    if (!focus || focus.at === openedFocus.current) return
    openedFocus.current = focus.at
    void openAlbum(focus.album)
    // focus 由收藏进入时带上，只处理一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.at])

  useEffect(() => {
    if (!viewer) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewer(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewer])

  const pickSource = (id: string) => {
    const next = sources.find((entry) => entry.id === id)
    if (!next) return
    setSourceId(id)
    setCategory('')
    setStarName('')
    setPageNum(1)
    setKeyword('')
    setInput('')
    setViewer(null)
    void load({ sourceId: id, category: '', page: 1, keyword: '' })
  }

  const pickCategory = (id: string) => {
    setCategory(id)
    setStarName('')
    setKeyword('')
    setInput('')
    setPageNum(1)
    setViewer(null)
    void load({ category: id, page: 1, keyword: '' })
  }

  const pickStar = (star: MeituStar) => {
    const next = starCategory(star)
    setCategory(next)
    setStarName(star.name)
    setKeyword('')
    setInput('')
    setPageNum(1)
    setViewer(null)
    void load({ category: next, page: 1, keyword: '' })
  }

  const submitSearch = () => {
    const next = input.trim()
    if (next === keyword) return
    setKeyword(next)
    setPageNum(1)
    setViewer(null)
    void load({ keyword: next, page: 1 })
  }

  const clearSearch = () => {
    if (!keyword) return
    setInput('')
    setKeyword('')
    setPageNum(1)
    void load({ keyword: '', page: 1 })
  }

  const changePage = (next: number) => {
    setPageNum(next)
    setViewer(null)
    void load({ page: next })
  }

  /** 整本图集加入下载：逐张走下载中心 */
  const saveAlbum = async () => {
    if (!viewer || saving) return
    const sourceConfig = appData.meituSources.find((entry) => entry.id === viewer.album.source)
    if (!sourceConfig) {
      onNotice('这个套图源已被删除，无法下载')
      return
    }
    setSaving(true)
    let ok = 0
    let failed = 0
    try {
      for (const [index, image] of viewer.images.entries()) {
        const res = await window.laozheng.addDownload({
          title: `${viewer.album.title}-${index + 1}`,
          url: image.url,
          kind: 'meitu',
          coverUrl: viewer.album.cover,
          sourceName: sourceConfig.name,
          referer: sourceReferer(sourceConfig)
        })
        if (res.ok) ok += 1
        else failed += 1
      }
      onNotice(
        failed
          ? `已加入下载 ${ok} 张，${failed} 张失败`
          : `已加入下载队列（${ok} 张），可在下载 → 套图查看进度`
      )
    } catch (err) {
      onNotice(`下载失败：${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  /** 网格浏览卡片右上角：单张图片直接加入下载 */
  const saveImage = async (url: string, index: number) => {
    if (!viewer) return
    const sourceConfig = appData.meituSources.find((entry) => entry.id === viewer.album.source)
    if (!sourceConfig) {
      onNotice('这个套图源已被删除，无法下载')
      return
    }
    const res = await window.laozheng
      .addDownload({
        title: `${viewer.album.title}-${index + 1}`,
        url,
        kind: 'meitu',
        coverUrl: viewer.album.cover,
        sourceName: sourceConfig.name,
        referer: sourceReferer(sourceConfig)
      })
      .catch((err: Error) => ({ ok: false, error: err.message }))
    onNotice(res.ok ? '已加入下载管理，可在下载 → 套图查看' : res.error ?? '加入下载失败')
  }

  const activeCategory = categories.find((entry) => entry.id === category)
  const categoryLabel = category.startsWith('@author:')
    ? starName || '明星作品'
    : activeCategory?.label ?? (category === '@stars' ? '热门明星' : '全部')
  const statusText = [
    activeSource
      ? keyword
        ? `搜索「${keyword}」`
        : activeSource.template === 'jb9'
          ? `${activeSource.name} · ${categoryLabel}`
          : activeSource.name
      : '',
    data
      ? data.stars?.length
        ? `本页 ${data.stars.length} 位明星`
        : data.total > 0
          ? `本页 ${data.total} 个图集`
          : '没有图集'
      : '',
    loading ? '加载中…' : ''
  ]
    .filter(Boolean)
    .join(' · ')

  const header = (
    <header className="page-header">
      {focus && onExit ? (
        <button
          className="btn ghost"
          onClick={() => {
            setViewer(null)
            onExit()
          }}
        >
          <ChevronLeft size={15} /> 返回
        </button>
      ) : null}
      <h1 className="page-title">套图</h1>
      <div className="page-actions">
        <ModuleShortcuts onOpenFavorites={onOpenFavorites} onOpenDownloads={onOpenDownloads} />
      </div>
    </header>
  )

  if (!activeSource) {
    return (
      <>
        {header}
        <EmptyState
          title="还没有套图源"
          desc="打开 设置 → 片源管理 → 套图源，添加或导入套图源后就能浏览了。"
        />
      </>
    )
  }

  if (viewer) {
    const displayCount = viewer.images.length || viewer.album.imageCount
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={() => setViewer(null)}>
            <ChevronLeft size={15} /> 返回列表
          </button>
          <h1 className="page-title">{viewer.album.title}</h1>
          <span className="page-desc">
            {[
              sourceName(viewer.album.source),
              displayCount ? `${displayCount} 张` : '',
              viewer.album.tags.slice(0, 4).join(' / ')
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <div className="page-actions">
            <button
              className="btn"
              onClick={() => toggleFav(viewer.album, viewer.images.length)}
            >
              <Heart size={15} fill={isFav(viewer.album) ? 'currentColor' : 'none'} />{' '}
              {isFav(viewer.album) ? '已收藏' : '收藏'}
            </button>
            <button
              className="btn primary"
              disabled={saving || !viewer.images.length}
              onClick={() => setConfirmDownload(true)}
            >
              {saving ? <Loader2 size={15} className="spin" /> : <Download size={15} />}{' '}
              下载全部
            </button>
            {focus && onExit ? (
              <button
                className="btn ghost"
                onClick={() => {
                  setViewer(null)
                  onExit()
                }}
              >
                返回
              </button>
            ) : null}
          </div>
        </header>

        {viewer.loading ? <LoadingBlock text="正在加载图集…" /> : null}
        {!viewer.loading && viewer.error ? (
          <EmptyState
            title="图集加载失败"
            desc={viewer.error}
            action={
              <button className="btn primary" onClick={() => void openAlbum(viewer.album)}>
                重新加载
              </button>
            }
          />
        ) : null}
        {!viewer.loading && viewerUrls.length ? (
          <ComicReader images={viewerUrls} defaultMode="grid" onSaveImage={saveImage} />
        ) : null}

        {confirmDownload ? (
          <ConfirmDialog
            title="下载图集"
            message={`将把「${viewer.album.title}」共 ${viewer.images.length} 张图片加入下载，是否继续？`}
            confirmText="开始下载"
            onConfirm={() => {
              setConfirmDownload(false)
              void saveAlbum()
            }}
            onCancel={() => setConfirmDownload(false)}
          />
        ) : null}
      </>
    )
  }

  return (
    <>
      {header}

      <SearchBar
        value={input}
        onChange={setInput}
        onSubmit={submitSearch}
        onClear={clearSearch}
        placeholder={`在 ${activeSource.name} 搜索图集…`}
        onRefresh={() => {
          void window.laozheng.forceRefresh('meitu').catch(() => {})
          void load({ page: 1 })
        }}
        refreshing={loading}
        leading={
          <select
            className="select-inline wallpaper-select"
            value={activeSource.id}
            title="套图源"
            onChange={(event) => pickSource(event.target.value)}
          >
            {sources.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        }
      />

      {activeSource.template === 'jb9' ? (
        <div className="toolbar meitu-category-bar">
          {category.startsWith('@author:') ? (
            <>
              <button className="chip" onClick={() => pickCategory('@stars')}>
                ‹ 热门明星
              </button>
              <button className="chip active">{starName || '明星作品'}</button>
            </>
          ) : null}
          {categories.map((entry) => (
            <button
              key={entry.id || 'all'}
              className={`chip ${entry.id === category ? 'active' : ''}`}
              onClick={() => pickCategory(entry.id)}
            >
              {entry.label}
              {entry.count ? <span className="chip-count">{entry.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="wallpaper-status">{statusText}</div>

      {error && data ? (
        <div className="wallpaper-error-bar">
          <span>{error}</span>
          <button className="btn" onClick={() => void load({ page: pageNum })}>
            重试
          </button>
        </div>
      ) : null}

      {!data && loading ? <LoadingBlock text="正在加载套图…" /> : null}

      {!data && !loading && error ? (
        <EmptyState
          title="套图加载失败"
          desc={error}
          action={
            <button className="btn primary" onClick={() => void load({ page: pageNum })}>
              重新加载
            </button>
          }
        />
      ) : null}

      {data && data.items.length === 0 && !data.stars?.length ? (
        <EmptyState
          title={keyword ? '没有找到匹配的图集' : '这个分类暂时没有图集'}
          desc={keyword ? '换一个关键词再试。' : '换一个分类或套图源看看。'}
        />
      ) : null}

      {data && data.items.length > 0 && visibleItems.length === 0 ? (
        <EmptyState
          title="这批图集的封面都失效了"
          desc="站点返回的图片地址已不可用，换一个分类或刷新页面试试。"
          action={
            <button className="btn primary" onClick={() => void load({ page: pageNum })}>
              刷新
            </button>
          }
        />
      ) : null}

      {data?.stars?.length ? (
        <div className="meitu-star-grid">
          {data.stars.map((star) => (
            <div
              key={star.slug}
              className="wallpaper-card meitu-star-card"
              role="button"
              tabIndex={0}
              title="查看这位明星的作品"
              onClick={() => pickStar(star)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') pickStar(star)
              }}
            >
              <div className="meitu-star-avatar">
                {star.avatar ? <img src={star.avatar} alt={star.name} loading="lazy" /> : null}
              </div>
              <div className="meitu-card-body">
                <div className="meitu-card-title">{star.name}</div>
                <div className="meitu-card-meta">
                  {[
                    star.articles ? `${star.articles} 篇文章` : '',
                    star.reads ? `${star.reads.toLocaleString('zh-CN')} 阅读` : ''
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {star.desc ? <div className="meitu-star-desc">{star.desc}</div> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {visibleItems.length > 0 ? (
        <div className="wallpaper-grid">
          {visibleItems.map((item) => (
            <div
              key={`${item.source}-${item.id}`}
              className="wallpaper-card"
              role="button"
              tabIndex={0}
              title="点击查看图集"
              onClick={() => void openAlbum(item)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') void openAlbum(item)
              }}
            >
              <div className="wallpaper-thumb" style={{ aspectRatio: '3 / 4' }}>
                <img
                  src={item.cover}
                  alt={item.title}
                  loading="lazy"
                  decoding="async"
                  onError={() => setBroken((prev) => ({ ...prev, [albumKey(item)]: true }))}
                />
                <button
                  className={`fav-heart ${isFav(item) ? 'on' : ''}`}
                  title={isFav(item) ? '取消收藏' : '收藏'}
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleFav(item, item.imageCount)
                  }}
                >
                  <Heart size={14} fill={isFav(item) ? 'currentColor' : 'none'} />
                </button>
              </div>
              <div className="meitu-card-body">
                <div className="meitu-card-title" title={item.title}>
                  {item.title}
                </div>
                <div className="meitu-card-meta">
                  {[
                    item.imageCount > 0 ? `${item.imageCount} 张` : '',
                    item.tags.slice(0, 2).join(' / ')
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {data && (data.items.length > 0 || data.stars?.length) ? (
        <Pagination page={pageNum} lastPage={data.lastPage} onChange={changePage} />
      ) : null}
    </>
  )
}
