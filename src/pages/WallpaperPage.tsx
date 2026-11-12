import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Heart,
  Loader2,
  X
} from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, LoadingBlock, ModuleShortcuts, Pagination } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { loadCache, saveCache } from '../utils/cache'
import {
  WALLPAPER_DEVICES,
  isWallpaperDevice,
  toWallpaperSourceRef,
  wallpaperBaseCategoryId,
  wallpaperDeviceLabel,
  wallpaperFallbackCategories,
  type WallpaperCategory,
  type WallpaperDevice,
  type WallpaperFocus,
  type WallpaperItem,
  type WallpaperPage as WallpaperPageData,
  type WallpaperSource
} from '../shared/wallpaper'

interface WallpaperCache {
  source: string
  device: WallpaperDevice
  category: string
  page: number
  data: WallpaperPageData | null
}

const EMPTY_CACHE: WallpaperCache = {
  source: '',
  device: 'pc',
  category: '',
  page: 1,
  data: null
}

function readInitialCache(sources: WallpaperSource[]): WallpaperCache {
  const cached = loadCache<WallpaperCache>('wallpaper2', EMPTY_CACHE)
  const source = sources.find((entry) => entry.id === cached.source) ?? sources[0]
  if (!source) return { source: '', device: 'pc', category: '', page: 1, data: null }
  let device: WallpaperDevice = isWallpaperDevice(cached.device) ? cached.device : 'pc'
  let category = typeof cached.category === 'string' ? cached.category : ''
  // 旧缓存：分类里存的是 pc / mobile，迁到新的设备维度
  if (category === 'pc' || category === 'mobile') {
    device = category
    category = ''
  }
  // 缓存来自别的（已删除的）源时，回到该源的基础分类
  if (!category || cached.source !== source.id) {
    category = wallpaperBaseCategoryId(source, device)
  }
  const usable =
    cached.source === source.id &&
    cached.category === category &&
    cached.data &&
    Array.isArray(cached.data.items) &&
    cached.data.items.length > 0
  const data = usable
    ? {
        ...cached.data!,
        source: source.id,
        category,
        keyword: '',
        page: cached.page || 1,
        items: (cached.data!.items ?? []).filter((item) => item.source === source.id)
      }
    : null
  return {
    source: source.id,
    device,
    category,
    page: data?.page ?? 1,
    data: data && data.items.length ? data : null
  }
}

/** 下载原图时补上站点 Referer，避免 CDN 防盗链；壁纸迷的图床反而拒绝带 Referer，直接留空 */
function sourceReferer(source: WallpaperSource): string {
  if (source.template === 'bizhimi') return ''
  try {
    return `${new URL(source.baseUrl).origin}/`
  } catch {
    return ''
  }
}

function wallpaperKey(item: Pick<WallpaperItem, 'source' | 'id'>): string {
  return `${item.source}|${item.id}`
}

export function WallpaperPage({
  onNotice,
  focus,
  resetSignal,
  onExit,
  onOpenFavorites,
  onOpenDownloads
}: {
  onNotice: (text: string) => void
  focus?: WallpaperFocus
  resetSignal?: number
  onExit?: () => void
  onOpenFavorites?: () => void
  onOpenDownloads?: () => void
}) {
  const { data: appData, update } = useData()
  /** 壁纸源来自片源管理，只展示启用的源 */
  const sources = useMemo(
    () => appData.wallpaperSources.filter((entry) => entry.enabled),
    [appData.wallpaperSources]
  )
  const [initial] = useState(() => readInitialCache(sources))
  const [sourceId, setSourceId] = useState(initial.source)
  const [device, setDevice] = useState<WallpaperDevice>(initial.device)
  const [category, setCategory] = useState(initial.category)
  const [pageNum, setPageNum] = useState(initial.page)
  const [input, setInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [data, setData] = useState<WallpaperPageData | null>(initial.data)
  const [loading, setLoading] = useState(!initial.data)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<WallpaperItem | null>(null)
  const [previewList, setPreviewList] = useState<WallpaperItem[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [previewUrl, setPreviewUrl] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [broken, setBroken] = useState<Record<string, true>>({})
  const [categoriesMap, setCategoriesMap] = useState<Record<string, WallpaperCategory[]>>({})
  const [categoryLoading, setCategoryLoading] = useState(false)
  const requestSeq = useRef(0)
  const closingRef = useRef(false)
  const activeSource = useMemo(
    () => sources.find((entry) => entry.id === sourceId) ?? sources[0],
    [sources, sourceId]
  )
  const categoryKey = activeSource
    ? `${activeSource.id}|${activeSource.template}|${activeSource.baseUrl}|${device}`
    : ''
  const categories = useMemo(
    () =>
      activeSource
        ? categoriesMap[categoryKey] ?? wallpaperFallbackCategories(activeSource, device)
        : [],
    [categoriesMap, categoryKey, activeSource, device]
  )
  /** 站点图片失效的卡片直接不显示 */
  const visibleItems = useMemo(
    () => (data ? data.items.filter((item) => !broken[wallpaperKey(item)]) : []),
    [data, broken]
  )

  const load = async (next?: {
    sourceId?: string
    device?: WallpaperDevice
    category?: string
    page?: number
    keyword?: string
  }) => {
    const nextSource =
      sources.find((entry) => entry.id === (next?.sourceId ?? activeSource?.id)) ?? activeSource
    if (!nextSource) return
    const nextDevice = next?.device ?? device
    const nextCategory = next?.category ?? category
    const nextPage = next?.page ?? pageNum
    const nextKeyword = next?.keyword ?? keyword
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    const res = await window.laozheng.wallpaperList(
      toWallpaperSourceRef(nextSource),
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
    // 搜索结果是临时的，只缓存浏览态；翻页也一起记住
    if (!nextKeyword) {
      saveCache<WallpaperCache>('wallpaper2', {
        source: nextSource.id,
        device: nextDevice,
        category: nextCategory,
        page: nextPage,
        data: res.page
      })
    }
  }

  useEffect(() => {
    if (!activeSource) return
    void load({
      sourceId: initial.source,
      category: initial.category,
      page: initial.page
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 源列表首次可用时补一次加载（例如刚在片源管理里添加壁纸源）
  useEffect(() => {
    if (!activeSource) return
    if (data || loading) return
    void load({ sourceId: activeSource.id, category, page: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource?.id])

  // 当前展示的数据属于已删除的源时，切到第一个可用源重新加载
  useEffect(() => {
    if (!activeSource || !data) return
    if (data.source === activeSource.id) return
    const nextCategory = wallpaperBaseCategoryId(activeSource, device)
    setSourceId(activeSource.id)
    setCategory(nextCategory)
    setPageNum(1)
    setInput('')
    setKeyword('')
    setPreview(null)
    setData(null)
    void load({
      sourceId: activeSource.id,
      device,
      category: nextCategory,
      page: 1,
      keyword: ''
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource?.id])

  // 从站点抓取当前设备的完整分类（带数量）；失败时保留内置兜底分类
  useEffect(() => {
    if (!activeSource) return
    let alive = true
    setCategoryLoading(true)
    window.laozheng
      .wallpaperCategories(toWallpaperSourceRef(activeSource), device)
      .then((res) => {
        if (!alive) return
        setCategoryLoading(false)
        if (res.ok && res.categories?.length) {
          setCategoriesMap((prev) => ({ ...prev, [categoryKey]: res.categories! }))
        }
      })
      .catch(() => {
        if (alive) setCategoryLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryKey])

  // 分类列表更新后，当前分类若已不存在（站点调整）就切到第一个
  useEffect(() => {
    if (!activeSource) return
    // 兜底分类可能不含站点导航分类，等真实分类抓回来再判断
    const fetched = categoriesMap[categoryKey]
    if (!fetched) return
    if (fetched.some((entry) => entry.id === category)) return
    const first = fetched[0]?.id
    if (!first) return
    setCategory(first)
    setPageNum(1)
    setPreview(null)
    void load({ sourceId: activeSource.id, category: first, page: 1, keyword: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriesMap, categoryKey])

  useEffect(() => {
    if (!focus) return
    setPreview(focus.item)
    setPreviewList([focus.item])
    setPreviewIndex(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.at])

  useEffect(() => {
    if (resetSignal === undefined) return
    setPreview(null)
  }, [resetSignal])

  // 路由离开收藏详情后清掉残留的预览，避免返回到旧页面时又弹出图片
  const prevFocusAt = useRef<number | undefined>(focus?.at)
  useEffect(() => {
    if (prevFocusAt.current !== undefined && !focus) setPreview(null)
    prevFocusAt.current = focus?.at
  }, [focus?.at])

  // 预览只用列表自带的小图 / 预览图，不再为预览解析高清原图
  useEffect(() => {
    if (!preview) {
      setPreviewUrl('')
      return
    }
    setPreviewUrl(preview.previewUrl || preview.thumb)
  }, [preview])

  const closePreview = useCallback(() => {
    // 连点遮罩 / X 时只返回一次，避免一次关闭把路由连退两级
    if (closingRef.current) return
    closingRef.current = true
    setPreview(null)
    // 从收藏进入的预览就是详情页：关闭等于返回上一页
    if (focus && onExit) onExit()
  }, [focus, onExit])

  useEffect(() => {
    if (preview) closingRef.current = false
  }, [preview])

  const stepPreview = (delta: number) => {
    if (previewList.length < 2) return
    const next = (previewIndex + delta + previewList.length) % previewList.length
    setPreviewIndex(next)
    setPreview(previewList[next])
  }

  useEffect(() => {
    if (!preview) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePreview()
      else if (event.key === 'ArrowLeft') stepPreview(-1)
      else if (event.key === 'ArrowRight') stepPreview(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, previewIndex, previewList, closePreview])

  const pickSource = (next: string) => {
    if (next === activeSource?.id) return
    const nextSource = sources.find((entry) => entry.id === next)
    if (!nextSource) return
    const nextCategory = wallpaperBaseCategoryId(nextSource, device)
    setSourceId(next)
    setCategory(nextCategory)
    setPageNum(1)
    setInput('')
    setKeyword('')
    setPreview(null)
    setData(null)
    void load({ sourceId: next, category: nextCategory, page: 1, keyword: '' })
  }

  const pickDevice = (next: WallpaperDevice) => {
    if (!activeSource || next === device) return
    const nextCategory = wallpaperBaseCategoryId(activeSource, next)
    setDevice(next)
    setCategory(nextCategory)
    setPageNum(1)
    setInput('')
    setKeyword('')
    setPreview(null)
    void load({ sourceId: activeSource.id, device: next, category: nextCategory, page: 1, keyword: '' })
  }

  const pickCategory = (next: string) => {
    if (!activeSource || (next === category && !keyword)) return
    setCategory(next)
    setPageNum(1)
    setInput('')
    setKeyword('')
    setPreview(null)
    void load({ sourceId: activeSource.id, category: next, page: 1, keyword: '' })
  }

  const submitSearch = () => {
    const query = input.trim()
    if (!query || !activeSource) return
    setPageNum(1)
    setKeyword(query)
    setPreview(null)
    void load({ page: 1, keyword: query })
  }

  const clearSearch = () => {
    setInput('')
    setKeyword('')
    setPageNum(1)
    setPreview(null)
    void load({ page: 1, keyword: '' })
  }

  const goPage = (next: number) => {
    setPageNum(next)
    setPreview(null)
    void load({ page: next })
  }

  const favId = (item: WallpaperItem): string => wallpaperKey(item)

  const isFav = (item: WallpaperItem): boolean =>
    appData.innerFavs.some((fav) => fav.module === 'wallpaper' && fav.id === favId(item))

  const sourceName = (id: string): string =>
    appData.wallpaperSources.find((entry) => entry.id === id)?.name ?? '壁纸'

  const formatMeta = (item: WallpaperItem): string =>
    [
      item.width > 0 && item.height > 0 ? `${item.width}×${item.height}` : '',
      item.sizeText,
      sourceName(item.source)
    ]
      .filter(Boolean)
      .join(' · ')

  const toggleFav = (item: WallpaperItem) => {
    const exists = isFav(item)
    update((current) => {
      if (exists) {
        return {
          ...current,
          innerFavs: current.innerFavs.filter(
            (fav) => !(fav.module === 'wallpaper' && fav.id === favId(item))
          )
        }
      }
      return {
        ...current,
        innerFavs: [
          ...current.innerFavs,
          {
            module: 'wallpaper',
            id: favId(item),
            title: item.title,
            subtitle: formatMeta(item),
            cover: item.thumb || null,
            savedAt: Date.now(),
            videoUrl: null,
            mediaId: 0,
            durationSec: 0,
            tweetUrl: null,
            payload: JSON.stringify({
              source: item.source,
              pageUrl: item.pageUrl,
              thumb: item.thumb,
              width: item.width,
              height: item.height,
              fullUrl: item.fullUrl,
              previewUrl: item.previewUrl ?? null,
              sizeText: item.sizeText,
              tags: item.tags
            })
          }
        ]
      }
    })
    onNotice(exists ? '已取消收藏' : '已收藏，可在收藏页查看')
  }

  /** 下载原图：先解析站点原图地址，再交给下载管理，进度和记录都在下载页 */
  const saveItem = async (item: WallpaperItem) => {
    const id = favId(item)
    if (savingId) return
    const itemSource = appData.wallpaperSources.find((entry) => entry.id === item.source)
    if (!itemSource) {
      onNotice('这个壁纸源已被删除，无法下载')
      return
    }
    setSavingId(id)
    try {
      let url = item.fullUrl
      if (!url) {
        const res = await window.laozheng.wallpaperResolve(
          toWallpaperSourceRef(itemSource),
          item.pageUrl,
          item.width,
          item.height
        )
        if (res.ok && res.url) url = res.url
      }
      if (!url) {
        onNotice('没有找到可下载的原图地址')
        return
      }
      const res = await window.laozheng.addDownload({
        title: item.title,
        url,
        kind: 'wallpaper',
        coverUrl: item.thumb,
        sourceName: itemSource.name,
        referer: sourceReferer(itemSource)
      })
      if (!res.ok) {
        onNotice(res.error ?? '加入下载失败')
        return
      }
      onNotice('已加入下载管理，可在下载 → 壁纸查看进度')
    } catch (err) {
      onNotice(`下载失败：${(err as Error).message}`)
    } finally {
      setSavingId(null)
    }
  }

  const openPreview = (item: WallpaperItem) => {
    const items = visibleItems
    const index = items.findIndex((entry) => entry.id === item.id)
    setPreviewList(items.length ? items : [item])
    setPreviewIndex(index >= 0 ? index : 0)
    setPreview(item)
  }

  const activeCategory =
    categories.find((entry) => entry.id === category) ?? categories[0]
  const statusText = [
    activeSource
      ? keyword
        ? `搜索「${keyword}」`
        : `${activeSource.name} · ${wallpaperDeviceLabel(device)} · ${activeCategory?.label ?? '全部'}`
      : '',
    data
      ? data.total > 0
        ? `共 ${data.total} 张`
        : `本页 ${data.items.length} 张`
      : '',
    categoryLoading ? '正在同步分类数量…' : '',
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
            setPreview(null)
            onExit()
          }}
        >
          <ChevronLeft size={15} /> 返回
        </button>
      ) : null}
      <h1 className="page-title">壁纸</h1>
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
          title="还没有壁纸源"
          desc="打开 设置 → 片源管理 → 壁纸源，添加或导入壁纸源后就能浏览了。"
        />
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
        placeholder={`在 ${activeSource.name} · ${wallpaperDeviceLabel(device)} 搜索壁纸…`}
        onRefresh={() => {
          void window.laozheng.forceRefresh('wallpaper').catch(() => {})
          void load({ page: 1 })
        }}
        refreshing={loading}
        leading={
          <select
            className="select-inline wallpaper-select"
            value={activeSource.id}
            title="壁纸源"
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

      <div className="toolbar">
        <select
          className="select-inline"
          value={device}
          title="设备"
          onChange={(event) => pickDevice(event.target.value as WallpaperDevice)}
        >
          {WALLPAPER_DEVICES.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <select
          className="select-inline wallpaper-category-select"
          value={category}
          title="分类"
          onChange={(event) => pickCategory(event.target.value)}
        >
          {categories.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
              {typeof entry.count === 'number'
                ? ` (${entry.count.toLocaleString('zh-CN')})`
                : ''}
            </option>
          ))}
        </select>
        {categoryLoading ? <span className="settings-value">同步分类中…</span> : null}
      </div>

      <div className="wallpaper-status">{statusText}</div>

      {error && data ? (
        <div className="wallpaper-error-bar">
          <span>{error}</span>
          <button className="btn" onClick={() => void load({ page: pageNum })}>
            重试
          </button>
        </div>
      ) : null}

      {!data && loading ? <LoadingBlock text="正在加载壁纸…" /> : null}

      {!data && !loading && error ? (
        <EmptyState
          title="壁纸加载失败"
          desc={error}
          action={
            <button className="btn primary" onClick={() => void load({ page: pageNum })}>
              重新加载
            </button>
          }
        />
      ) : null}

      {data && data.items.length === 0 ? (
        <EmptyState
          title={keyword ? '没有找到匹配的壁纸' : '这个分类暂时没有壁纸'}
          desc={keyword ? '换一个关键词再试。' : '换一个分类或壁纸源看看。'}
        />
      ) : null}

      {data && data.items.length > 0 && visibleItems.length === 0 ? (
        <EmptyState
          title="这批壁纸的图片都失效了"
          desc="站点返回的图片地址已不可用，换一个分类或刷新页面试试。"
          action={
            <button className="btn primary" onClick={() => void load({ page: pageNum })}>
              刷新
            </button>
          }
        />
      ) : null}

      {visibleItems.length > 0 ? (
        <div className="wallpaper-grid">
          {visibleItems.map((item) => (
            <div
              key={`${item.source}-${item.id}`}
              className="wallpaper-card"
              role="button"
              tabIndex={0}
              title="点击预览大图"
              onClick={() => openPreview(item)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') openPreview(item)
              }}
            >
              <div
                className="wallpaper-thumb"
                style={{
                  aspectRatio:
                    item.width > 0 && item.height > 0
                      ? `${item.width} / ${item.height}`
                      : '16 / 9'
                }}
              >
                <img
                  src={item.thumb}
                  alt={item.title}
                  loading="lazy"
                  decoding="async"
                  onError={() =>
                    setBroken((prev) => ({ ...prev, [favId(item)]: true }))
                  }
                />
                <button
                  className={`fav-heart ${isFav(item) ? 'on' : ''}`}
                  title={isFav(item) ? '取消收藏' : '收藏'}
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleFav(item)
                  }}
                >
                  <Heart size={14} fill={isFav(item) ? 'currentColor' : 'none'} />
                </button>
                <button
                  className="wallpaper-download"
                  title="下载原图"
                  disabled={savingId === favId(item)}
                  onClick={(event) => {
                    event.stopPropagation()
                    void saveItem(item)
                  }}
                >
                  {savingId === favId(item) ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Download size={14} />
                  )}
                </button>
              </div>
              <div className="wallpaper-info">
                <span className="wallpaper-title">{item.title}</span>
                <span className="wallpaper-meta">{formatMeta(item)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {data ? (
        <Pagination
          page={data.page}
          lastPage={data.lastPage}
          disabled={loading}
          onChange={goPage}
        />
      ) : null}

      {preview ? (
        <div className="wallpaper-preview">
          <div className="wallpaper-preview-head">
            <div className="wallpaper-preview-title">{preview.title}</div>
            <button className="icon-btn" title="关闭" onClick={closePreview}>
              <X size={18} />
            </button>
          </div>
          <div
            className="wallpaper-preview-stage"
            onClick={(event) => {
              // 点黑色遮罩（不含图片本身和左右按钮）快速关闭
              if ((event.target as HTMLElement).closest('img, button')) return
              closePreview()
            }}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={preview.title}
                onError={() => {
                  if (previewUrl !== preview.thumb) {
                    setPreviewUrl(preview.thumb)
                    return
                  }
                  // 缩略图也加载不出来：隐藏这张壁纸并直接退出预览
                  setBroken((prev) => ({ ...prev, [wallpaperKey(preview)]: true }))
                  onNotice('这张壁纸的图片已失效')
                  closePreview()
                }}
              />
            ) : null}
            {previewList.length > 1 ? (
              <>
                <button
                  className="wallpaper-preview-arrow left"
                  title="上一张"
                  onClick={() => stepPreview(-1)}
                >
                  <ChevronLeft size={26} />
                </button>
                <button
                  className="wallpaper-preview-arrow right"
                  title="下一张"
                  onClick={() => stepPreview(1)}
                >
                  <ChevronRight size={26} />
                </button>
              </>
            ) : null}
          </div>
          <div className="wallpaper-preview-foot">
            <div className="wallpaper-preview-meta">
              {[
                sourceName(preview.source),
                preview.width > 0 && preview.height > 0
                  ? `${preview.width}×${preview.height}`
                  : '',
                preview.sizeText,
                preview.tags.slice(0, 4).join(' / ')
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            <div className="wallpaper-preview-actions">
              <button className="btn" onClick={() => toggleFav(preview)}>
                <Heart size={15} fill={isFav(preview) ? 'currentColor' : 'none'} />{' '}
                {isFav(preview) ? '已收藏' : '收藏'}
              </button>
              <button
                className="btn primary"
                disabled={savingId === favId(preview)}
                onClick={() => void saveItem(preview)}
              >
                {savingId === favId(preview) ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Download size={15} />
                )}{' '}
                下载原图
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
