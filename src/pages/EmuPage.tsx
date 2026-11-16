import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { Heart } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, LoadingBlock, ModuleShortcuts, Pagination } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { loadCache, saveCache } from '../utils/cache'
import {
  EMU_DEFAULT_COVER,
  EMU_PLATFORMS,
  emuPlatformLabel,
  isEmuPlatform,
  type EmuGameItem,
  type EmuPlatformId,
  type EmuTag
} from '../shared/emu'

interface ListCache {
  mode: 'list' | 'search'
  platform: EmuPlatformId
  tag: string
  query: string
  page: number
  items: EmuGameItem[]
  loaded: boolean
}

const EMPTY_CACHE: ListCache = {
  mode: 'list',
  platform: 'fc',
  tag: '',
  query: '',
  page: 1,
  items: [],
  loaded: false
}

const cache: ListCache = (() => {
  const cached = loadCache<ListCache>('emu.list.v2', EMPTY_CACHE)
  // 默认 FC；上次停在其它平台时，重开应用也回到 FC 第一页
  if (!isEmuPlatform(cached.platform) || cached.platform !== 'fc') return { ...EMPTY_CACHE }
  return {
    mode: cached.mode === 'search' ? 'search' : 'list',
    platform: cached.platform,
    tag: typeof cached.tag === 'string' ? cached.tag : '',
    query: typeof cached.query === 'string' ? cached.query : '',
    page: Number.isInteger(cached.page) && cached.page > 0 ? cached.page : 1,
    items: Array.isArray(cached.items) ? cached.items : [],
    loaded: cached.loaded === true
  }
})()

let tagCache: Record<string, EmuTag[]> = loadCache<Record<string, EmuTag[]>>('emu.tags.v2', {})

export function EmuPage({
  onNotice,
  focusId,
  resetSignal,
  onOpenFavorites
}: {
  onNotice: (text: string) => void
  focusId?: string
  resetSignal?: number
  onOpenFavorites?: () => void
}) {
  const { data, update } = useData()
  const [mode, setMode] = useState<'list' | 'search'>(cache.mode)
  const [platform, setPlatform] = useState<EmuPlatformId>(cache.platform)
  const [tag, setTag] = useState(cache.tag)
  const [query, setQuery] = useState(cache.query)
  const [input, setInput] = useState(cache.query)
  const [page, setPage] = useState(cache.page)
  const [items, setItems] = useState<EmuGameItem[]>(cache.items)
  const [tags, setTags] = useState<Record<string, EmuTag[]>>(tagCache)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(!cache.loaded)
  const [error, setError] = useState<string | null>(null)
  const requestSeq = useRef(0)
  const handledFocus = useRef('')

  const load = async (nextPlatform: EmuPlatformId, nextTag: string, nextPage: number) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    const res = await window.laozheng.emuList(nextPlatform, nextTag, nextPage)
    if (seq !== requestSeq.current) return
    setLoading(false)
    if (!res.ok) {
      setError(res.error ?? '加载失败')
      return
    }
    setPlatform(nextPlatform)
    setTag(nextTag)
    setMode('list')
    setQuery('')
    setInput('')
    setPage(res.page)
    setItems(res.items)
    setHasMore(res.hasMore)
    if (res.tags?.length) {
      tagCache = { ...tagCache, [nextPlatform]: res.tags }
      saveCache('emu.tags.v2', tagCache)
      setTags(tagCache)
    }
    Object.assign(cache, {
      mode: 'list',
      platform: nextPlatform,
      tag: nextTag,
      query: '',
      page: res.page,
      items: res.items,
      loaded: true
    })
    saveCache<ListCache>('emu.list.v2', { ...cache })
  }

  const search = async (keyword: string) => {
    const text = keyword.trim()
    if (!text) return
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    const res = await window.laozheng.emuSearch(text)
    if (seq !== requestSeq.current) return
    setLoading(false)
    if (!res.ok) {
      setError(res.error ?? '搜索失败')
      return
    }
    setMode('search')
    setQuery(text)
    setInput(text)
    setPage(1)
    setItems(res.items)
    setHasMore(false)
    Object.assign(cache, {
      mode: 'search',
      query: text,
      page: 1,
      items: res.items,
      loaded: true
    })
    saveCache<ListCache>('emu.list.v2', { ...cache })
  }

  useEffect(() => {
    // 有缓存也请求一次，避免点标题刷新后仍显示旧列表
    if (cache.mode === 'search' && cache.query) void search(cache.query)
    else void load(cache.platform, cache.tag, cache.page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (resetSignal === undefined) return
    void load(cache.platform, '', 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal])

  const favOf = (id: string) =>
    data.innerFavs.some((fav) => fav.module === 'emu' && fav.id === id)

  const openGame = async (item: EmuGameItem) => {
    const res = await window.laozheng.emuOpen(item.id)
    if (!res.ok) onNotice(res.error ?? '打开游戏失败')
  }

  const toggleFav = (item: EmuGameItem) => {
    const exists = favOf(item.id)
    update((d) => {
      if (exists) {
        return {
          ...d,
          innerFavs: d.innerFavs.filter((fav) => !(fav.module === 'emu' && fav.id === item.id))
        }
      }
      return {
        ...d,
        innerFavs: [
          ...d.innerFavs,
          {
            module: 'emu',
            id: item.id,
            title: item.title,
            subtitle: [emuPlatformLabel(item.platform), item.category].filter(Boolean).join(' · '),
            cover: item.cover,
            savedAt: Date.now(),
            videoUrl: null,
            mediaId: 0,
            durationSec: 0,
            tweetUrl: null,
            payload: JSON.stringify({ platform: item.platform })
          }
        ]
      }
    })
    onNotice(exists ? '已取消收藏' : '已收藏，可在「收藏」页查看')
  }

  useEffect(() => {
    if (!focusId) {
      handledFocus.current = ''
      return
    }
    if (handledFocus.current === focusId) return
    handledFocus.current = focusId
    const fav = data.innerFavs.find((entry) => entry.module === 'emu' && entry.id === focusId)
    let favPlatform: EmuPlatformId | null = null
    if (fav?.payload) {
      try {
        const payload = JSON.parse(fav.payload) as { platform?: unknown }
        if (isEmuPlatform(payload.platform)) favPlatform = payload.platform
      } catch {
        // 旧收藏没有 payload，按当前平台兜底
      }
    }
    void openGame({
      id: focusId,
      title: fav?.title || '模拟游戏',
      cover: fav?.cover ?? null,
      category: fav?.subtitle ?? '',
      platform: favPlatform ?? platform
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, data.innerFavs])

  const switchPlatform = (next: EmuPlatformId) => {
    if (next === platform && !tag && page === 1 && !error) return
    void load(next, '', 1)
  }

  const platformTags = tags[platform] ?? []

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">模拟</h1>
        <div className="page-actions">
          <ModuleShortcuts onOpenFavorites={onOpenFavorites} />
        </div>
      </header>

      <SearchBar
        value={input}
        onChange={setInput}
        onSubmit={() => {
          const keyword = input.trim()
          if (keyword) void search(keyword)
        }}
        onCancel={() => {
          requestSeq.current += 1
          setLoading(false)
        }}
        onClear={() => {
          setInput('')
          void load(platform, tag, 1)
        }}
        searching={loading && mode === 'search'}
        placeholder="搜索游戏（魂斗罗、马里奥、龙战士…）"
        onRefresh={() => {
          void window.laozheng.forceRefresh('emu').catch(() => {})
          if (mode === 'search' && query) void search(query)
          else void load(platform, tag, page)
        }}
        refreshing={loading}
      />

      <div className="toolbar">
        <select
          className="select-inline"
          value={platform}
          onChange={(event) => {
            if (isEmuPlatform(event.target.value)) switchPlatform(event.target.value)
          }}
        >
          {EMU_PLATFORMS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          className="select-inline"
          value={tag}
          onChange={(event) => void load(platform, event.target.value, 1)}
        >
          <option value="">全部分类</option>
          {platformTags.map((item) => (
            <option key={item.value} value={item.value}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      {loading && items.length > 0 ? <LoadingBlock text="正在切换，请稍等…" /> : null}

      {loading && items.length === 0 ? (
        <EmptyState title={mode === 'search' ? '正在搜索…' : '正在加载模拟游戏…'} />
      ) : error ? (
        <EmptyState
          title="加载失败"
          desc={error}
          action={
            <button
              className="btn"
              onClick={() => {
                if (mode === 'search' && query) void search(query)
                else void load(platform, tag, page)
              }}
            >
              重试
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={mode === 'search' ? `没有搜到「${query}」` : '没有找到游戏'}
          desc={
            mode === 'search'
              ? '站点的搜索索引主要覆盖 GBA / MD / SFC，FC / 街机部分条目可能搜不到，可返回分类浏览。'
              : '换个平台或分类再试。'
          }
        />
      ) : (
        <>
          <div className="media-grid">
            {items.map((item) => (
              <button
                key={item.id}
                className="media-card"
                onClick={() => void openGame(item)}
              >
                <span className="media-thumb" style={{ aspectRatio: '4 / 3' }}>
                  <img
                    src={item.cover || EMU_DEFAULT_COVER}
                    alt=""
                    loading="lazy"
                    onError={(event: SyntheticEvent<HTMLImageElement>) => {
                      const img = event.currentTarget
                      if (img.src !== EMU_DEFAULT_COVER) img.src = EMU_DEFAULT_COVER
                    }}
                  />
                  <span className="media-badge">{emuPlatformLabel(item.platform)}</span>
                  <span
                    className="fav-heart"
                    role="button"
                    title={favOf(item.id) ? '取消收藏' : '收藏'}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleFav(item)
                    }}
                  >
                    <Heart size={15} fill={favOf(item.id) ? 'currentColor' : 'none'} />
                  </span>
                </span>
                <span className="media-title">{item.title}</span>
                <span className="media-meta">{item.category || '—'}</span>
              </button>
            ))}
          </div>

          {mode === 'list' ? (
            <Pagination
              page={page}
              lastPage={0}
              hasMore={hasMore}
              disabled={loading}
              showLast={false}
              onChange={(next) => void load(platform, tag, next)}
            />
          ) : (
            <p className="settings-hint">
              站点搜索一次性返回 {items.length} 条结果，不支持翻页。
            </p>
          )}
        </>
      )}
    </>
  )
}
