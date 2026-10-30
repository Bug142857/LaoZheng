import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Copy, Download, Heart } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, LoadingBlock, Modal, ModuleShortcuts, Pagination } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { loadCache, saveCache } from '../utils/cache'
import type { GameCategory, GameDetail, GameItem } from '../shared/wygamer'

interface ListCache {
  mode: 'home' | 'category' | 'search'
  categoryUrl: string
  query: string
  page: number
  lastPage: number
  items: GameItem[]
  loaded: boolean
}

const EMPTY_GAME_CACHE: ListCache = {
  mode: 'home',
  categoryUrl: '',
  query: '',
  page: 1,
  lastPage: 1,
  items: [],
  loaded: false
}

const cache: ListCache = (() => {
  const cached = loadCache<ListCache>('game', EMPTY_GAME_CACHE)
  // 每次打开应用回到首页；默认列表缓存仍直接显示
  if (cached.mode !== 'home' || cached.query || cached.page !== 1) {
    return { ...EMPTY_GAME_CACHE }
  }
  return cached
})()

let categoryCache: GameCategory[] = loadCache<GameCategory[]>('game.categories', [])

interface DetailState {
  game: GameDetail | null
  loading: boolean
  error: string | null
}

export function GamePage({
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
  /** 从收藏进入时，详情页返回走全局上一页 */
  onExit?: () => void
  onOpenFavorites?: () => void
  onOpenDownloads?: () => void
}) {
  const { data, update } = useData()
  const [categories, setCategories] = useState<GameCategory[]>(categoryCache)
  const [mode, setMode] = useState(cache.mode)
  const [categoryUrl, setCategoryUrl] = useState(cache.categoryUrl)
  const [query, setQuery] = useState(cache.query)
  const [input, setInput] = useState(cache.query)
  const [page, setPage] = useState(cache.page)
  const [lastPage, setLastPage] = useState(cache.lastPage)
  const [items, setItems] = useState<GameItem[]>(cache.items)
  const [loading, setLoading] = useState(!cache.loaded)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [netdisk, setNetdisk] = useState<{ label: string; url: string } | null>(null)
  const [showAllShots, setShowAllShots] = useState(false)
  /** 点了分类但列表还没回来：先高亮分类并显示「请稍等」 */
  const [pending, setPending] = useState<{ mode: ListCache['mode']; categoryUrl: string } | null>(
    null
  )
  const requestSeq = useRef(0)

  useEffect(() => {
    if (resetSignal === undefined) return
    setDetail(null)
  }, [resetSignal])

  const load = async (nextMode: ListCache['mode'], nextCategory: string, nextQuery: string, nextPage: number) => {
    const seq = ++requestSeq.current
    setPending({ mode: nextMode, categoryUrl: nextCategory })
    setLoading(true)
    setError(null)
    const res =
      nextMode === 'home'
        ? await window.laozheng.wygamerHome(nextPage)
        : nextMode === 'category'
          ? await window.laozheng.wygamerByCategory(nextCategory, nextPage)
          : await window.laozheng.wygamerSearch(nextQuery, nextPage)
    if (seq !== requestSeq.current) return
    setPending(null)
    setLoading(false)
    if (!res.ok) {
      setError(res.error ?? '加载失败')
      return
    }
    setItems(res.items)
    setPage(res.page)
    setLastPage(res.lastPage || res.page)
    setMode(nextMode)
    setCategoryUrl(nextCategory)
    setQuery(nextQuery)
    Object.assign(cache, {
      mode: nextMode,
      categoryUrl: nextCategory,
      query: nextQuery,
      page: res.page,
      lastPage: res.lastPage || res.page,
      items: res.items,
      loaded: true
    })
    // 只缓存首页第一页，重开应用才能立刻显示
    if (nextMode === 'home' && !nextQuery && res.page === 1) {
      saveCache<ListCache>('game', { ...cache })
    }
  }

  useEffect(() => {
    if (!cache.loaded) void load(cache.mode, cache.categoryUrl, cache.query, cache.page)
    if (!categoryCache.length) {
      void window.laozheng.wygamerCategories().then((res) => {
        if (!res.ok) return
        categoryCache = res.items
        saveCache<GameCategory[]>('game.categories', res.items)
        setCategories(res.items)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadDetail = async (id: string, alive?: () => boolean) => {
    setShowAllShots(false)
    setDetail({ game: null, loading: true, error: null })
    const res = await window.laozheng.wygamerDetail(id)
    if (alive && !alive()) return
    setDetail({ game: res.ok ? res.game : null, loading: false, error: res.ok ? null : res.error ?? '详情加载失败' })
  }

  useEffect(() => {
    if (!focusId) return
    let alive = true
    void loadDetail(focusId, () => alive)
    return () => {
      alive = false
      setDetail(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])

  const favOf = (id: string) => data.innerFavs.some((f) => f.module === 'game' && f.id === id)

  const toggleFav = (item: GameItem) => {
    const exists = favOf(item.id)
    update((d) => {
      if (exists) return { ...d, innerFavs: d.innerFavs.filter((f) => !(f.module === 'game' && f.id === item.id)) }
      return {
        ...d,
        innerFavs: [
          ...d.innerFavs,
          {
            module: 'game',
            id: item.id,
            title: item.title,
            subtitle: item.categories.join(' · '),
            cover: item.cover,
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

  const resolveDownload = async (label: string, payUrl: string) => {
    onNotice('正在解析网盘链接…')
    const res = await window.laozheng.wygamerResolveDownload(payUrl)
    if (!res.ok || !res.url) {
      onNotice(`解析失败：${res.error ?? '未知错误'}`)
      return
    }
    setNetdisk({ label, url: res.url })
  }

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      onNotice(`已复制${label}`)
    } catch {
      onNotice('复制失败，请手动选择文本')
    }
  }

  if (detail) {
    const game = detail.game
    const favItem: GameItem | null = game
      ? {
          id: game.id,
          title: game.title,
          url: '',
          cover: game.cover,
          categories: game.categories,
          badge: null
        }
      : null
    return (
      <>
        <header className="page-header">
          <button
            className="btn ghost"
            onClick={() => {
              // 先清掉详情再返回，避免从收藏返回后又落回详情页
              setDetail(null)
              if (focusId && onExit) onExit()
            }}
          >
            <ChevronLeft size={15} /> 返回列表
          </button>
          <h1 className="page-title">{game?.title ?? '游戏详情'}</h1>
          {favItem ? (
            <div className="page-actions">
              <button className="btn" onClick={() => toggleFav(favItem)}>
                <Heart size={15} fill={favOf(favItem.id) ? 'currentColor' : 'none'} />{' '}
                {favOf(favItem.id) ? '已收藏' : '收藏'}
              </button>
            </div>
          ) : null}
        </header>

        {detail.loading ? (
          <EmptyState title="正在加载详情…" />
        ) : detail.error || !game ? (
          <EmptyState
            title="加载失败"
            desc={detail.error ?? '没有拿到详情'}
            action={
              focusId ? (
                <button className="btn" onClick={() => void loadDetail(focusId)}>
                  重试
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="comic-detail">
              <div className="comic-detail-cover">
                {game.cover ? <img src={game.cover} alt="" /> : null}
              </div>
              <div className="comic-detail-info">
                <div className="row-title" style={{ whiteSpace: 'normal' }}>
                  {game.title}
                </div>
                {game.categories.length ? (
                  <div className="comic-tags">
                    {game.categories.map((c) => (
                      <span key={c} className="badge">
                        {c}
                      </span>
                    ))}
                  </div>
                ) : null}
                {game.attrs.length ? (
                  <div className="game-attrs">
                    {game.attrs.map((a) => (
                      <div key={a.key} className="game-attr">
                        <span className="game-attr-key">{a.key}</span>
                        <span className="game-attr-value">{a.value}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {game.unzipPassword ? (
                  <div className="game-password">
                    <span>解压密码：{game.unzipPassword}</span>
                    <button className="btn ghost" onClick={() => void copy(game.unzipPassword ?? '', '解压密码')}>
                      <Copy size={13} /> 复制
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <section className="settings-card" style={{ marginTop: 16 }}>
              <h3>下载</h3>
              {game.downloads.length === 0 ? (
                <div className="settings-hint">暂无下载链接</div>
              ) : (
                <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  {game.downloads.map((d) => (
                    <button key={d.url} className="btn primary" onClick={() => void resolveDownload(d.label, d.url)}>
                      <Download size={14} /> {d.label}
                    </button>
                  ))}
                </div>
              )}
              <p className="settings-hint">
                链接指向网盘分享页（迅雷 / 百度等），无法直链下载；解析后会给出「浏览器打开 / 复制链接」。
              </p>
            </section>

            {game.screenshots.length ? (
              <section style={{ marginTop: 18 }}>
                <h3 className="melon-heading">游戏截图</h3>
                <div className="game-shots">
                  {(showAllShots ? game.screenshots : game.screenshots.slice(0, 6)).map((src) => (
                    <img key={src} src={src} alt="" loading="lazy" />
                  ))}
                </div>
                {game.screenshots.length > 6 ? (
                  <div className="detail-collapse-line">
                    <button
                      className="btn section-more"
                      onClick={() => setShowAllShots((v) => !v)}
                    >
                      {showAllShots ? '收起' : `查看全部（${game.screenshots.length} 张）`}
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}

            {game.blocks.length ? (
              <article className="melon-article" style={{ marginTop: 18 }}>
                {game.blocks.map((b, i) =>
                  b.isHeading ? (
                    <h3 key={i} className="melon-heading">
                      {b.text}
                    </h3>
                  ) : (
                    <p key={i} className="melon-text">
                      {b.text}
                    </p>
                  )
                )}
              </article>
            ) : null}
          </>
        )}

        {netdisk ? (
          <Modal
            title={`网盘链接 · ${netdisk.label}`}
            onClose={() => setNetdisk(null)}
            footer={
              <>
                <button className="btn ghost" onClick={() => setNetdisk(null)}>
                  关闭
                </button>
                <button className="btn" onClick={() => void copy(netdisk.url, '网盘链接')}>
                  <Copy size={14} /> 复制链接
                </button>
                <button
                  className="btn primary"
                  onClick={() => {
                    void window.laozheng.openExternal(netdisk.url)
                  }}
                >
                  浏览器打开
                </button>
              </>
            }
          >
            <p style={{ wordBreak: 'break-all' }}>{netdisk.url}</p>
            <p className="settings-hint">用浏览器打开可跳转到网盘 App / 网页，保存后可在网盘内下载。</p>
          </Modal>
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
        <h1 className="page-title">游戏</h1>
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
          void load('home', '', '', 1)
        }}
        searching={loading && mode === 'search'}
        placeholder="搜索游戏关键词…"
      />

      {!query && (
        <div className="toolbar">
          <button
            className={`chip ${
              pending ? (pending.mode === 'home' ? 'active' : '') : mode === 'home' ? 'active' : ''
            }`}
            onClick={() => void load('home', '', '', 1)}
          >
            最新
          </button>
          {categories.map((c) => {
            const active = pending
              ? pending.mode === 'category' && pending.categoryUrl === c.url
              : mode === 'category' && categoryUrl === c.url
            return (
              <button
                key={c.url}
                className={`chip ${active ? 'active' : ''}`}
                onClick={() => void load('category', c.url, '', 1)}
              >
                {c.name}
                {c.count ? <span className="chip-count">{c.count}</span> : null}
              </button>
            )
          })}
        </div>
      )}

      {loading && items.length > 0 ? <LoadingBlock text="正在切换，请稍等…" /> : null}

      {loading && items.length === 0 ? (
        <EmptyState title="正在加载游戏列表…" />
      ) : error ? (
        <EmptyState
          title="加载失败"
          desc={error}
          action={
            <button className="btn" onClick={() => void load(mode, categoryUrl, query, page)}>
              重试
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState title="没有找到游戏" desc="换个关键词或分类再试。" />
      ) : (
        <>
          <div className="media-grid">
            {items.map((item) => (
              <button
                key={item.id}
                className="media-card"
                onClick={() => void loadDetail(item.id)}
              >
                <span className="media-thumb" style={{ aspectRatio: '16 / 9' }}>
                  {item.cover ? <img src={item.cover} alt="" loading="lazy" /> : null}
                  {item.badge ? (
                    <span className={`media-badge ${item.badge.includes('免费') ? 'free' : ''}`}>{item.badge}</span>
                  ) : null}
                  <span
                    className="fav-heart"
                    role="button"
                    title={favOf(item.id) ? '取消收藏' : '收藏'}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFav(item)
                    }}
                  >
                    <Heart size={15} fill={favOf(item.id) ? 'currentColor' : 'none'} />
                  </span>
                </span>
                <span className="media-title">{item.title}</span>
                <span className="media-meta">{item.categories.join(' · ') || '—'}</span>
              </button>
            ))}
          </div>

          <Pagination
            page={page}
            lastPage={lastPage}
            disabled={loading}
            onChange={(next) => void load(mode, categoryUrl, query, next)}
          />
        </>
      )}
    </>
  )
}
