import { useEffect, useMemo, useRef, useState } from 'react'
import { Heart, ListChecks, RefreshCw } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, ListCoverMosaic } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { LocalShortcutsSection } from '../components/LocalShortcuts'
import { MusicPlayerBar, songFromFav, useMusicPlayer } from '../components/MusicPlayer'
import { countItems, favModuleLabel, formatTime, listCovers, rootLists } from '../utils/data'
import type { InnerFav } from '../shared/types'
import { parseNewsFavPayload, type NewsItem } from '../shared/news'
import {
  FAV_MODULE_ICONS,
  FAV_MODULE_ORDER,
  HIDDEN_FAV_MODULES,
  liveFavsFromData
} from '../utils/favorites'

function durationText(sec: number): string {
  if (!sec || !Number.isFinite(sec)) return ''
  const total = Math.max(0, Math.floor(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`
}

/**
 * 主页：收藏总览 + 音乐收藏播放器。
 * 每个模块固定显示（空模块默认收起），搜索过滤收藏；音乐收藏只在底部播放器里按需展开。
 */
export function HomePage({
  onOpenFav,
  onOpenFavorites,
  onOpenList,
  onNotice
}: {
  onOpenFav: (fav: InnerFav) => void
  onOpenFavorites: () => void
  onOpenList: (id: number) => void
  onNotice: (text: string) => void
}) {
  const { data, update } = useData()
  const player = useMusicPlayer()
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [newsRefreshing, setNewsRefreshing] = useState(false)

  const lists = useMemo(() => rootLists(data), [data])

  const allFavs = useMemo(
    () =>
      [...data.innerFavs, ...liveFavsFromData(data)].filter(
        (fav) => !HIDDEN_FAV_MODULES.has(fav.module)
      ),
    [data]
  )

  const filteredFavs = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return allFavs
    return allFavs.filter((fav) =>
      [fav.title, fav.subtitle, favModuleLabel(fav.module)]
        .filter(Boolean)
        .some((text) => text.toLowerCase().includes(keyword))
    )
  }, [allFavs, query])

  /** 所有模块固定展示：导航顺序在前，未知模块补在最后 */
  const moduleKeys = useMemo(() => {
    const extras = [...new Set(allFavs.map((fav) => fav.module))].filter(
      (key) =>
        key !== 'music' &&
        !HIDDEN_FAV_MODULES.has(key) &&
        !(FAV_MODULE_ORDER as readonly string[]).includes(key)
    )
    return [...FAV_MODULE_ORDER.filter((key) => key !== 'music'), ...extras]
  }, [allFavs])

  /** 空模块默认收起；有收藏的模块默认展开 */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const next = new Set<string>()
    for (const key of FAV_MODULE_ORDER) {
      if (key === 'music') continue
      if (!allFavs.some((fav) => fav.module === key)) next.add(key)
    }
    return next
  })
  /** 「查看全部」：把分类从横向滑动改成完整网格展示 */
  const [fullOpen, setFullOpen] = useState<Set<string>>(new Set())
  /** 用户手动展开 / 收起的分类：数据变化时不再自动跟随 */
  const touchedCollapseRef = useRef<Set<string>>(new Set())

  // 收藏变化时，未手动操作过的分类保持「有收藏展开 / 无收藏收起」
  useEffect(() => {
    setCollapsed((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const key of FAV_MODULE_ORDER) {
        if (key === 'music' || touchedCollapseRef.current.has(key)) continue
        const hasFav = allFavs.some((fav) => fav.module === key)
        if (hasFav === !next.has(key)) continue
        if (hasFav) next.delete(key)
        else next.add(key)
        changed = true
      }
      return changed ? next : prev
    })
  }, [allFavs])

  const musicFavs = useMemo(
    () => allFavs.filter((fav) => fav.module === 'music').sort((a, b) => b.savedAt - a.savedAt),
    [allFavs]
  )
  const musicSongs = useMemo(() => musicFavs.map(songFromFav), [musicFavs])

  const newsFavCount = data.innerFavs.filter((fav) => fav.module === 'news').length

  const toggleCollapsed = (key: string) => {
    touchedCollapseRef.current.add(key)
    const willCollapse = !collapsed.has(key)
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    if (willCollapse) {
      setFullOpen((prev) => {
        if (!prev.has(key)) return prev
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  const toggleFull = (key: string) => {
    touchedCollapseRef.current.add(key)
    setCollapsed((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    setFullOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const openNewsItem = (item: NewsItem) => {
    if (!item.url) {
      onNotice('这条资讯没有可打开的原文链接')
      return
    }
    void window.laozheng.openExternal(item.url).catch(() => onNotice('打开原文失败'))
  }

  /** 刷新所有资讯收藏：按「分类 + 页码」各取一次分类页，再把卡片内容写回收藏 payload */
  const refreshNewsFavs = async (): Promise<void> => {
    const targets = data.innerFavs.filter((fav) => fav.module === 'news')
    if (!targets.length || newsRefreshing) return
    setNewsRefreshing(true)
    void window.laozheng.forceRefresh('news').catch(() => {})
    const groups = new Map<
      string,
      { category: string; query: string; page: number; favs: InnerFav[] }
    >()
    for (const fav of targets) {
      const payload = parseNewsFavPayload(fav.payload)
      const category = payload?.category || 'news'
      const query = payload?.query ?? ''
      const page = payload?.page ?? 1
      const key = `${category}|${query}|${page}`
      const group = groups.get(key) ?? { category, query, page, favs: [] }
      group.favs.push(fav)
      groups.set(key, group)
    }
    const next = new Map<string, string>()
    let failed = 0
    for (const group of groups.values()) {
      try {
        const res = await window.laozheng.newsFeed(group.category, group.query, group.page)
        if (!res.ok || !res.cards?.length) {
          failed += group.favs.length
          continue
        }
        const byId = new Map(res.cards.map((card) => [card.id, card]))
        for (const fav of group.favs) {
          const card = byId.get(fav.id)
          if (!card) {
            failed += 1
            continue
          }
          const payload = parseNewsFavPayload(fav.payload)
          next.set(
            fav.id,
            JSON.stringify({
              category: payload?.category ?? group.category,
              query: payload?.query ?? group.query,
              page: payload?.page ?? group.page,
              nodeId: fav.id,
              name: card.name || payload?.name || '',
              board: card.board || payload?.board || '',
              icon: card.icon ?? payload?.icon ?? fav.cover,
              items: card.items
            })
          )
        }
      } catch {
        failed += group.favs.length
      }
    }
    if (next.size) {
      update((d) => ({
        ...d,
        innerFavs: d.innerFavs.map((fav) => {
          if (fav.module !== 'news' || !next.has(fav.id)) return fav
          const payloadText = next.get(fav.id) ?? fav.payload
          const refreshed = parseNewsFavPayload(payloadText)
          return {
            ...fav,
            payload: payloadText,
            cover: refreshed?.icon ?? fav.cover,
            title:
              [refreshed?.name, refreshed?.board].filter(Boolean).join(' · ') || fav.title
          }
        })
      }))
    }
    setNewsRefreshing(false)
    onNotice(
      failed ? `已刷新 ${next.size} 个榜单，${failed} 个暂时未更新` : `已刷新 ${next.size} 个榜单`
    )
  }

  const openFav = (fav: InnerFav) => {
    // 模拟收藏直接拉起模拟器窗口，不再跳模拟模块
    if (fav.module === 'emu') {
      void window.laozheng
        .emuOpen(fav.id)
        .then((res) => {
          if (!res.ok) onNotice(res.error ?? '打开模拟器失败')
        })
        .catch(() => onNotice('打开模拟器失败'))
      return
    }
    onOpenFav(fav)
  }

  const card = (fav: InnerFav, onClick: () => void) => {
    const Icon = FAV_MODULE_ICONS[fav.module] ?? Heart
    const duration = durationText(fav.durationSec)
    return (
      <div
        key={`${fav.module}-${fav.id}`}
        className="media-card home-fav-card"
        role="button"
        tabIndex={0}
        title={fav.title}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onClick()
        }}
      >
        <span className="media-thumb">
          {fav.cover ? (
            <img src={fav.cover} alt="" loading="lazy" />
          ) : (
            <span className="home-fav-fallback">
              <Icon size={22} strokeWidth={1.8} />
            </span>
          )}
          {duration ? <span className="media-duration">{duration}</span> : null}
        </span>
        <span className="media-title">{fav.title}</span>
        <span className="media-meta">
          {[fav.subtitle, formatTime(fav.savedAt)].filter(Boolean).join(' · ')}
        </span>
      </div>
    )
  }

  const newsCard = (fav: InnerFav) => {
    const payload = parseNewsFavPayload(fav.payload)
    const items = payload?.items ?? []
    const name = payload?.name || fav.title
    return (
      <article key={`news-${fav.id}`} className="news-card">
        <div className="news-card-head">
          {fav.cover ? (
            <img
              className="news-card-icon"
              src={fav.cover}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="news-card-icon news-card-icon-fallback">{name.slice(0, 1)}</span>
          )}
          <span className="news-card-title">
            <span className="news-card-name">{name}</span>
            <span className="news-card-board">{payload?.board || fav.subtitle}</span>
          </span>
        </div>
        <div className="news-card-items">
          {items.length ? (
            items.map((item) => (
              <button
                key={`${item.rank}-${item.title}`}
                className="news-item"
                title={item.url ? item.title : '暂无原文链接'}
                onClick={() => openNewsItem(item)}
              >
                <span className={`news-item-rank ${item.rank <= 3 ? 'top' : ''}`}>
                  {item.rank}
                </span>
                <span className="news-item-title">{item.title}</span>
                {item.extra ? <span className="news-item-extra">{item.extra}</span> : null}
              </button>
            ))
          ) : (
            <div className="news-card-empty">收藏时没有保存条目，可以点标题后的刷新按钮</div>
          )}
        </div>
      </article>
    )
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">主页</h1>
        <span className="page-desc">{allFavs.length}</span>
        <div className="page-actions">
          <button className="btn" onClick={onOpenFavorites}>
            <Heart size={15} /> 收藏管理
          </button>
        </div>
      </header>

      <SearchBar
        value={input}
        onChange={setInput}
        onSubmit={() => setQuery(input.trim())}
        onClear={() => {
          setInput('')
          setQuery('')
        }}
        placeholder="搜索收藏：标题 / UP主 / 分类"
        submitLabel="搜索"
        disabled={!allFavs.length}
      />

      <LocalShortcutsSection onNotice={onNotice} />

      <section className="tool-group">
        <div className="tool-group-head">
          <ListChecks size={15} />
          <h2>清单</h2>
          <span className="tool-group-count">{lists.length}</span>
        </div>
        {lists.length ? (
          <div className="tile-grid">
            {lists.map((list) => {
              const subCount = data.lists.filter((item) => item.parentId === list.id).length
              return (
                <div key={list.id} className="tile" onClick={() => onOpenList(list.id)}>
                  <ListCoverMosaic covers={listCovers(data, list.id)} name={list.name} />
                  <span style={{ minWidth: 0 }}>
                    <div className="tile-name">{list.name}</div>
                    <div className="tile-meta">
                      {countItems(data, list.id)} 件
                      {subCount > 0 ? ` · ${subCount} 个子清单` : ''}
                    </div>
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="settings-hint">还没有清单。</div>
        )}
      </section>

      {allFavs.length === 0 ? (
        <EmptyState
          title="还没有收藏"
          desc="在各个模块点爱心收藏后，会按模块汇总到这里；音乐收藏可以在底部直接播放。"
        />
      ) : null}

      {moduleKeys.map((key) => {
        const Icon = FAV_MODULE_ICONS[key] ?? Heart
        const favs = filteredFavs
          .filter((fav) => fav.module === key)
          .sort((a, b) => b.savedAt - a.savedAt)
        const isCollapsed = collapsed.has(key)
        return (
          <section className="tool-group" key={key}>
            <div className="tool-group-head">
              <Icon size={15} />
              <h2>{favModuleLabel(key)}</h2>
              {key === 'news' ? (
                <button
                  className="icon-btn"
                  title="刷新资讯收藏"
                  disabled={newsRefreshing || newsFavCount === 0}
                  onClick={() => void refreshNewsFavs()}
                >
                  <RefreshCw size={14} className={newsRefreshing ? 'spin' : ''} />
                </button>
              ) : null}
              <span className="tool-group-count">{favs.length}</span>
              <div className="home-fav-actions">
                <button
                  className="btn ghost home-fav-more"
                  onClick={() => toggleCollapsed(key)}
                >
                  {isCollapsed ? '展开' : '隐藏'}
                </button>
                <button
                  className="btn ghost home-fav-more"
                  onClick={() => toggleFull(key)}
                >
                  {fullOpen.has(key) ? '收起' : '查看全部'}
                </button>
              </div>
            </div>
            {isCollapsed ? null : key === 'news' ? (
              favs.length ? (
                fullOpen.has(key) ? (
                  <div className="news-grid">{favs.map(newsCard)}</div>
                ) : (
                  <div className="home-news-row">{favs.map(newsCard)}</div>
                )
              ) : (
                <div className="settings-hint">暂无收藏</div>
              )
            ) : favs.length ? (
              fullOpen.has(key) ? (
                <div className="home-fav-grid">
                  {favs.map((fav) => card(fav, () => openFav(fav)))}
                </div>
              ) : (
                <div className="home-fav-row">
                  {favs.map((fav) => card(fav, () => openFav(fav)))}
                </div>
              )
            ) : (
              <div className="settings-hint">暂无收藏</div>
            )}
          </section>
        )
      })}

      <MusicPlayerBar
        alwaysVisible
        homeMode
        playlist={musicSongs}
        onPlayPlaylist={(index) => player.playFavs(musicFavs, index)}
      />
    </>
  )
}
