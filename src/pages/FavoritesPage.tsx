import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Heart, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useData } from '../state/DataContext'
import { favModuleLabel, filterFavs, formatTime } from '../utils/data'
import {
  FAV_MODULE_ICONS,
  FAV_MODULE_ORDER,
  HIDDEN_FAV_MODULES,
  liveFavsFromData
} from '../utils/favorites'
import { ConfirmDialog, EmptyState } from '../components/ui'
import { VirtualRows } from '../components/VirtualRows'
import { MelonImage } from '../components/MelonImage'
import { useMusicPlayer } from '../components/MusicPlayer'
import type { InnerFav } from '../shared/types'
import { parseNewsFavPayload, type NewsItem } from '../shared/news'

export function FavoritesPage({
  onOpen,
  onBack,
  onModuleChange,
  onNotice,
  initialModule,
  directEntry
}: {
  onOpen: (fav: InnerFav) => void
  onBack: () => void
  /** 当前选中的模块要写回路由，从条目返回时仍停留在该模块收藏里 */
  onModuleChange?: (key: string | null) => void
  onNotice?: (text: string) => void
  /** 从模块右上角进入时直接打开该模块的收藏 */
  initialModule?: string
  /** 直接入口（模块右上角）：返回直接回上一页，而不是收藏管理 */
  directEntry?: boolean
}) {
  const { data, update } = useData()
  const player = useMusicPlayer()
  const [moduleKey, setModuleKey] = useState<string | null>(initialModule ?? null)
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<'recent' | 'artist'>('recent')

  useEffect(() => {
    setModuleKey(initialModule ?? null)
    setQuery('')
  }, [initialModule])

  const changeModule = (key: string | null) => {
    setModuleKey(key)
    setQuery('')
    onModuleChange?.(key)
  }

  /** 平台直播收藏单独存在 data.liveFavorites，这里转换成统一收藏行参与收藏管理 */
  const liveFavs = useMemo<InnerFav[]>(
    () =>
      liveFavsFromData({
        liveFavorites: data.liveFavorites,
        livePlatformSources: data.livePlatformSources
      }),
    [data.liveFavorites, data.livePlatformSources]
  )

  const allFavs = useMemo(
    () =>
      [...data.innerFavs, ...liveFavs].filter(
        (fav) => !HIDDEN_FAV_MODULES.has(fav.module)
      ),
    [data.innerFavs, liveFavs]
  )

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const fav of allFavs) map.set(fav.module, (map.get(fav.module) ?? 0) + 1)
    return map
  }, [allFavs])

  /** 每个模块都固定显示（没有收藏也显示 0 条），不再提供「全部收藏」 */
  const modules = useMemo(() => {
    const extra = [...counts.keys()].filter(
      (key) => !(FAV_MODULE_ORDER as readonly string[]).includes(key)
    )
    return [...FAV_MODULE_ORDER, ...extra]
  }, [counts])

  const favs = useMemo(() => {
    const base =
      moduleKey && moduleKey !== 'all'
        ? allFavs.filter((f) => f.module === moduleKey)
        : allFavs
    const list = filterFavs(base, query)
    if (moduleKey === 'music' && sortMode === 'artist') {
      return [...list].sort(
        (a, b) =>
          a.subtitle.localeCompare(b.subtitle, 'zh-Hans-CN') || b.savedAt - a.savedAt
      )
    }
    return [...list].sort((a, b) => b.savedAt - a.savedAt)
  }, [allFavs, moduleKey, query, sortMode])

  const musicDuration = (fav: InnerFav): string => {
    if (!fav.durationSec) return ''
    const total = Math.round(fav.durationSec)
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  }

  const videoDuration = (fav: InnerFav): string => {
    if (!fav.durationSec) return ''
    const total = Math.round(fav.durationSec)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`
  }

  /** 短剧 / 皇片 / 直播 / 壁纸 / 演唱用网格卡片展示，其余模块保持列表 */
  const gridModule =
    moduleKey === 'drama' ||
    moduleKey === 'shuangkan' ||
    moduleKey === 'live' ||
    moduleKey === 'singing' ||
    moduleKey === 'wallpaper'

  /** 删除前先确认，避免误点垃圾桶直接删掉收藏 */
  const [removing, setRemoving] = useState<InnerFav | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchRemoving, setBatchRemoving] = useState(false)
  const [newsRefreshing, setNewsRefreshing] = useState(false)

  const favKey = (fav: InnerFav): string => `${fav.module}-${fav.id}`

  useEffect(() => {
    setSelectMode(false)
    setSelected(new Set())
  }, [moduleKey])

  // 搜索变化时保留批量模式，但把已选收敛到当前可见项，避免删除看不见的收藏
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev
      const visible = new Set(favs.map((fav) => `${fav.module}-${fav.id}`))
      const next = new Set([...prev].filter((key) => visible.has(key)))
      return next.size === prev.size ? prev : next
    })
  }, [favs])

  const toggleSelect = (key: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const removeSelected = () => {
    const ids = new Set(selected)
    const targets = favs.filter((fav) => ids.has(favKey(fav)))
    const liveIds = new Set(
      targets.filter((fav) => fav.module === 'live').map((fav) => fav.id)
    )
    const innerKeys = new Set(
      targets
        .filter((fav) => fav.module !== 'live')
        .map((fav) => `${fav.module}|${fav.id}`)
    )
    update((d) => ({
      ...d,
      innerFavs: d.innerFavs.filter((fav) => !innerKeys.has(`${fav.module}|${fav.id}`)),
      liveFavorites: d.liveFavorites.filter(
        (item) => !liveIds.has(`${item.platform}:${item.roomId}`)
      )
    }))
    onNotice?.(`已删除 ${targets.length} 条收藏`)
    setBatchRemoving(false)
    setSelectMode(false)
    setSelected(new Set())
  }

  const removeFav = (fav: InnerFav) => {
    if (fav.module === 'live') {
      update((d) => ({
        ...d,
        liveFavorites: d.liveFavorites.filter(
          (item) => `${item.platform}:${item.roomId}` !== fav.id
        )
      }))
      onNotice?.(`已删除收藏「${fav.title}」`)
      return
    }
    update((d) => ({
      ...d,
      innerFavs: d.innerFavs.filter((f) => !(f.module === fav.module && f.id === fav.id))
    }))
    onNotice?.(`已删除收藏「${fav.title}」`)
  }

  const openNewsItem = (item: NewsItem) => {
    if (!item.url) {
      onNotice?.('这条资讯没有可打开的原文链接')
      return
    }
    void window.laozheng.openExternal(item.url).catch(() => onNotice?.('打开原文失败'))
  }

  /** 刷新所有资讯收藏：按「分类 + 页码」各取一次分类页，再把卡片内容写回收藏 payload */
  const refreshNewsFavs = async () => {
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
            // 卡片图标 / 标题也一起更新，否则刷新后仍显示旧值
            cover: refreshed?.icon ?? fav.cover,
            title:
              [refreshed?.name, refreshed?.board].filter(Boolean).join(' · ') || fav.title
          }
        })
      }))
    }
    setNewsRefreshing(false)
    onNotice?.(
      failed ? `已刷新 ${next.size} 个榜单，${failed} 个暂时未更新` : `已刷新 ${next.size} 个榜单`
    )
  }

  // 模块卡片首页
  if (!moduleKey) {
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={onBack}>
            <ChevronLeft size={15} /> 返回
          </button>
          <h1 className="page-title">收藏管理</h1>
        </header>

        <div className="settings-list">
          {modules.map((key) => {
            const Icon = FAV_MODULE_ICONS[key] ?? Heart
            const count = counts.get(key) ?? 0
            return (
              <button key={key} className="settings-entry" onClick={() => changeModule(key)}>
                <span className="settings-entry-icon">
                  <Icon size={20} strokeWidth={1.8} />
                </span>
                <span className="settings-entry-main">
                  <span className="settings-entry-title">{favModuleLabel(key)}</span>
                  <span className="settings-entry-hint">
                    {count > 0 ? `${count} 条收藏` : '暂无收藏'}
                  </span>
                </span>
                <ChevronRight size={17} className="settings-entry-arrow" />
              </button>
            )
          })}
        </div>
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        <button
          className="btn ghost"
          onClick={() => {
            if (directEntry) {
              onBack()
              return
            }
            changeModule(null)
          }}
        >
          <ChevronLeft size={15} /> {directEntry ? '返回' : '收藏管理'}
        </button>
        <h1 className="page-title">
          {moduleKey === 'all' ? '全部收藏' : favModuleLabel(moduleKey)}
        </h1>
        <div className="page-actions">
          {moduleKey === 'news' ? (
            <button
              className="btn btn-sq"
              title="刷新收藏的榜单"
              aria-label="刷新收藏的榜单"
              disabled={newsRefreshing}
              onClick={() => void refreshNewsFavs()}
            >
              <RefreshCw size={15} className={newsRefreshing ? 'spin' : ''} />
            </button>
          ) : null}
          <button
            className={`btn ${selectMode ? 'primary' : ''}`}
            onClick={() => {
              setSelectMode((value) => !value)
              setSelected(new Set())
            }}
          >
            {selectMode ? '完成' : '批量管理'}
          </button>
        </div>
      </header>

      <div className="toolbar">
        <label className="search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题或作者…"
          />
          {query ? (
            <button
              type="button"
              className="search-clear"
              title="清空搜索"
              onClick={() => setQuery('')}
            >
              ✕
            </button>
          ) : null}
        </label>
      </div>

      {selectMode ? (
        <div className="toolbar batch-bar">
          <button
            className="chip"
            onClick={() => {
              const allSelected = favs.length > 0 && favs.every((fav) => selected.has(favKey(fav)))
              setSelected(allSelected ? new Set() : new Set(favs.map(favKey)))
            }}
          >
            {favs.length > 0 && favs.every((fav) => selected.has(favKey(fav)))
              ? '取消全选'
              : '全选'}
          </button>
          <span className="page-desc">已选 {selected.size} 项</span>
          <button
            className="btn danger"
            disabled={!selected.size}
            onClick={() => setBatchRemoving(true)}
          >
            <Trash2 size={14} /> 删除所选
          </button>
        </div>
      ) : null}

      {moduleKey === 'music' ? (
        <div className="toolbar" style={{ marginTop: -4 }}>
          <button
            className={`chip ${sortMode === 'recent' ? 'active' : ''}`}
            onClick={() => setSortMode('recent')}
          >
            最近
          </button>
          <button
            className={`chip ${sortMode === 'artist' ? 'active' : ''}`}
            onClick={() => setSortMode('artist')}
          >
            歌手
          </button>
        </div>
      ) : null}

      {favs.length === 0 ? (
        <EmptyState
          title={query ? '没有找到匹配的收藏' : '这个模块还没有收藏'}
          desc={query ? '换一个关键词再试。' : '在模块列表卡片点爱心即可收藏到这里。'}
        />
      ) : moduleKey === 'news' ? (
        <div className="news-grid">
          {favs.map((f) => {
            const key = favKey(f)
            const isSelected = selected.has(key)
            const payload = parseNewsFavPayload(f.payload)
            const items = payload?.items ?? []
            const name = payload?.name || f.title
            return (
              <article
                key={key}
                className={`news-card${selectMode ? ' select-mode' : ''}${
                  isSelected ? ' selected' : ''
                }`}
                role={selectMode ? 'button' : undefined}
                tabIndex={selectMode ? 0 : undefined}
                onClick={() => {
                  if (selectMode) toggleSelect(key)
                }}
                onKeyDown={(event) => {
                  if (selectMode && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    toggleSelect(key)
                  }
                }}
              >
                {selectMode ? (
                  <label className="select-check" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(key)}
                    />
                  </label>
                ) : null}
                <div className="news-card-head">
                  {f.cover ? (
                    <img
                      className="news-card-icon"
                      src={f.cover}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="news-card-icon news-card-icon-fallback">
                      {name.slice(0, 1)}
                    </span>
                  )}
                  <span className="news-card-title">
                    <span className="news-card-name">{name}</span>
                    <span className="news-card-board">{payload?.board || f.subtitle}</span>
                  </span>
                  {selectMode ? null : (
                    <button
                      className="icon-btn danger"
                      title="删除收藏"
                      aria-label="删除收藏"
                      onClick={(event) => {
                        event.stopPropagation()
                        setRemoving(f)
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
                <div className="news-card-items">
                  {items.length ? (
                    items.map((item) => (
                      <button
                        key={`${item.rank}-${item.title}`}
                        className="news-item"
                        title={item.url ? item.title : '暂无原文链接'}
                        onClick={(event) => {
                          if (selectMode) {
                            event.stopPropagation()
                            toggleSelect(key)
                            return
                          }
                          openNewsItem(item)
                        }}
                      >
                        <span className={`news-item-rank ${item.rank <= 3 ? 'top' : ''}`}>
                          {item.rank}
                        </span>
                        <span className="news-item-title">{item.title}</span>
                        {item.extra ? <span className="news-item-extra">{item.extra}</span> : null}
                      </button>
                    ))
                  ) : (
                    <div className="news-card-empty">收藏时没有保存条目，可在资讯页重新收藏</div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      ) : gridModule ? (
        <div className="media-grid">
          {favs.map((f) => {
            const key = favKey(f)
            const open = (): void => onOpen(f)
            const activate = (): void => {
              if (selectMode) toggleSelect(key)
              else open()
            }
            const duration = videoDuration(f)
            return (
              <div
                key={key}
                className={`media-card${selectMode ? ' select-mode' : ''}${
                  selected.has(key) ? ' selected' : ''
                }`}
                role="button"
                tabIndex={0}
                title={selectMode ? '选择收藏' : '打开对应模块'}
                onClick={activate}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') activate()
                }}
              >
                <span className="media-thumb">
                  {f.cover ? <img src={f.cover} alt="" loading="lazy" /> : null}
                  {duration ? <span className="media-duration">{duration}</span> : null}
                  {selectMode ? (
                    <label className="select-check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={() => toggleSelect(key)}
                      />
                    </label>
                  ) : (
                    <button
                      className="fav-remove"
                      title="删除收藏"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRemoving(f)
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
                <span className="media-title" style={{ WebkitLineClamp: 2 }}>
                  {f.title}
                </span>
                <span className="media-meta">
                  {[f.subtitle, formatTime(f.savedAt)].filter(Boolean).join(' · ')}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <VirtualRows
          className={`rows ${moduleKey === 'music' ? 'compact' : ''}`}
          rowHeight={moduleKey === 'music' ? 47 : 83}
          items={favs.map((f, index) => {
            const isMusic = f.module === 'music'
            const key = favKey(f)
            const open = (): void => {
              if (isMusic) player.playFavs(favs, index)
              else onOpen(f)
            }
            const activate = (): void => {
              if (selectMode) toggleSelect(key)
              else open()
            }
            return {
              key,
              node: (
                <div
                  className={`row clickable${selected.has(key) ? ' selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  title={
                    selectMode
                      ? '选择收藏'
                      : isMusic
                        ? '用内置播放器播放，并播放当前列表'
                        : '打开对应模块'
                  }
                  onClick={activate}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') activate()
                  }}
                >
                  {selectMode ? (
                    <input
                      type="checkbox"
                      className="row-check"
                      checked={selected.has(key)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelect(key)}
                    />
                  ) : null}
                  <div className="row-cover">
                    {f.cover ? (
                      f.module === 'melon' ? (
                        <MelonImage url={f.cover} />
                      ) : (
                        <img src={f.cover} alt="" loading="lazy" />
                      )
                    ) : (
                      favModuleLabel(f.module).slice(0, 2)
                    )}
                  </div>
                  <div className="row-main">
                    <div className="row-title">{f.title}</div>
                    <div className="row-meta">
                      {isMusic
                        ? [f.subtitle, musicDuration(f)].filter(Boolean).join(' · ')
                        : [f.subtitle, videoDuration(f), formatTime(f.savedAt)]
                            .filter(Boolean)
                            .join(' · ')}
                    </div>
                  </div>
                  <span className="badge brand">
                    {isMusic ? '播放' : favModuleLabel(f.module)}
                  </span>
                  {selectMode ? null : (
                    <button
                      className="icon-btn danger"
                      title="删除收藏"
                      aria-label="删除收藏"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRemoving(f)
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                  <ChevronRight size={15} className="row-arrow" />
                </div>
              )
            }
          })}
        />
      )}

      {batchRemoving ? (
        <ConfirmDialog
          title={`批量删除 ${selected.size} 条收藏`}
          message={`确定删除选中的 ${selected.size} 条收藏吗？删除后可在对应模块重新收藏。`}
          confirmText="删除"
          danger
          onConfirm={removeSelected}
          onCancel={() => setBatchRemoving(false)}
        />
      ) : null}

      {removing ? (
        <ConfirmDialog
          title="删除收藏"
          message={`确定删除收藏「${removing.title}」吗？删除后可在对应模块重新收藏。`}
          confirmText="删除"
          danger
          onConfirm={() => {
            removeFav(removing)
            setRemoving(null)
          }}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </>
  )
}
