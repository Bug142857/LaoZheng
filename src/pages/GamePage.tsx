import { useEffect, useState } from 'react'
import { ChevronLeft, Copy, Download, Heart, Search } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, Modal } from '../components/ui'
import { CollectionPage } from './CollectionPage'
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

const cache: ListCache = {
  mode: 'home',
  categoryUrl: '',
  query: '',
  page: 1,
  lastPage: 1,
  items: [],
  loaded: false
}

let categoryCache: GameCategory[] = []

interface DetailState {
  game: GameDetail | null
  loading: boolean
  error: string | null
}

export function GamePage({
  onNotice,
  focusId,
  onGoSearch
}: {
  onNotice: (text: string) => void
  focusId?: string
  onGoSearch: () => void
}) {
  const { data, update } = useData()
  const [showCollection, setShowCollection] = useState(false)
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

  const load = async (nextMode: ListCache['mode'], nextCategory: string, nextQuery: string, nextPage: number) => {
    setLoading(true)
    setError(null)
    const res =
      nextMode === 'home'
        ? await window.laozheng.wygamerHome(nextPage)
        : nextMode === 'category'
          ? await window.laozheng.wygamerByCategory(nextCategory, nextPage)
          : await window.laozheng.wygamerSearch(nextQuery, nextPage)
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
  }

  useEffect(() => {
    if (!cache.loaded) void load(cache.mode, cache.categoryUrl, cache.query, cache.page)
    if (!categoryCache.length) {
      void window.laozheng.wygamerCategories().then((res) => {
        if (!res.ok) return
        categoryCache = res.items
        setCategories(res.items)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadDetail = async (id: string) => {
    setDetail({ game: null, loading: true, error: null })
    const res = await window.laozheng.wygamerDetail(id)
    setDetail({ game: res.ok ? res.game : null, loading: false, error: res.ok ? null : res.error ?? '详情加载失败' })
  }

  useEffect(() => {
    if (focusId) void loadDetail(focusId)
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

  if (showCollection) {
    return (
      <>
        <header className="page-header">
          <h1 className="page-title">游戏</h1>
          <span className="page-desc">已收藏的游戏（豆瓣条目）</span>
          <div className="page-actions">
            <button className="btn" onClick={() => setShowCollection(false)}>
              无忧游戏库
            </button>
          </div>
        </header>
        <CollectionPage
          category="游戏"
          title="游戏"
          desc="已收藏的游戏"
          embedded
          onNotice={onNotice}
          onGoSearch={onGoSearch}
        />
      </>
    )
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
          <button className="btn ghost" onClick={() => setDetail(null)}>
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
                  {game.screenshots.map((src) => (
                    <img key={src} src={src} alt="" loading="lazy" />
                  ))}
                </div>
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
        <h1 className="page-title">游戏</h1>
        <span className="page-desc">无忧游戏库 · 内置账号自动登录 · 网盘分享链接</span>
        <div className="page-actions">
          <button className="btn" onClick={() => setShowCollection(true)}>
            豆瓣收藏
          </button>
        </div>
      </header>

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          const keyword = input.trim()
          if (keyword) void load('search', '', keyword, 1)
        }}
      >
        <label className="search">
          <Search size={16} />
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="搜索游戏关键词…" />
        </label>
        <button className="btn primary" type="submit" disabled={loading}>
          搜索
        </button>
        {query ? (
          <button
            className="btn ghost"
            onClick={() => {
              setInput('')
              void load('home', '', '', 1)
            }}
          >
            清除搜索
          </button>
        ) : null}
      </form>

      {!query && (
        <div className="toolbar">
          <button
            className={`chip ${mode === 'home' ? 'active' : ''}`}
            onClick={() => void load('home', '', '', 1)}
          >
            最新
          </button>
          {categories.map((c) => (
            <button
              key={c.url}
              className={`chip ${mode === 'category' && categoryUrl === c.url ? 'active' : ''}`}
              onClick={() => void load('category', c.url, '', 1)}
            >
              {c.name}
              {c.count ? <span className="chip-count">{c.count}</span> : null}
            </button>
          ))}
        </div>
      )}

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

          <div className="toolbar" style={{ marginTop: 14 }}>
            <button className="btn" disabled={loading || page <= 1} onClick={() => void load(mode, categoryUrl, query, page - 1)}>
              上一页
            </button>
            <span className="page-desc">
              第 {page} 页{lastPage ? ` / 共 ${lastPage} 页` : ''}
            </span>
            <button
              className="btn"
              disabled={loading || (lastPage > 0 && page >= lastPage)}
              onClick={() => void load(mode, categoryUrl, query, page + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </>
  )
}
