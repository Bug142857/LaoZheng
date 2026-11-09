import { useEffect, useMemo, useState } from 'react'
import {
  BookHeart,
  BookOpen,
  BookText,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Film,
  Gamepad2,
  Globe,
  Heart,
  ImageIcon,
  Images,
  MonitorPlay,
  Music,
  PlayCircle,
  Popcorn,
  Radio,
  Search,
  Trash2,
  Tv,
  Wand2,
  type LucideIcon
} from 'lucide-react'
import { useData } from '../state/DataContext'
import { favModuleLabel, filterFavs, formatTime } from '../utils/data'
import { ConfirmDialog, EmptyState } from '../components/ui'
import { MelonImage } from '../components/MelonImage'
import { useMusicPlayer } from '../components/MusicPlayer'
import {
  livePlatformDefaultName,
  livePlatformOfSource
} from '../shared/livePlatformSources'
import type { InnerFav } from '../shared/types'

/** 收藏管理按模块整理（顺序与手机端模块宫格一致） */
const FAV_MODULE_ORDER = [
  'watch',
  'drama',
  'music',
  'game',
  'trainer',
  'tv',
  'melon',
  'novel',
  'book',
  'comic',
  'h2',
  'h1',
  'psite',
  'xsite',
  'live',
  'wallpaper'
] as const

const MODULE_ICONS: Record<string, LucideIcon> = {
  watch: MonitorPlay,
  drama: Clapperboard,
  music: Music,
  game: Gamepad2,
  trainer: Wand2,
  tv: Tv,
  melon: Popcorn,
  novel: BookText,
  book: BookOpen,
  comic: Images,
  h2: BookHeart,
  h1: Film,
  psite: PlayCircle,
  xsite: Globe,
  live: Radio,
  wallpaper: ImageIcon
}

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
  const liveFavs = useMemo<InnerFav[]>(() => {
    return data.liveFavorites.map((fav) => {
      const source = data.livePlatformSources.find(
        (item) => livePlatformOfSource(item) === fav.platform
      )
      const platformName = source?.name || livePlatformDefaultName(fav.platform)
      return {
        module: 'live',
        id: `${fav.platform}:${fav.roomId}`,
        title: fav.title || '未命名直播间',
        subtitle: [platformName, fav.anchor].filter(Boolean).join(' · '),
        cover: fav.cover || null,
        savedAt: fav.savedAt,
        videoUrl: null,
        mediaId: 0,
        durationSec: 0,
        tweetUrl: null,
        payload: JSON.stringify({
          platform: fav.platform,
          roomId: fav.roomId,
          title: fav.title,
          anchor: fav.anchor,
          cover: fav.cover,
          area: fav.area
        })
      }
    })
  }, [data.liveFavorites, data.livePlatformSources])

  const allFavs = useMemo(() => [...data.innerFavs, ...liveFavs], [data.innerFavs, liveFavs])

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

  /** 番号 / 短剧 / P站 / X站 / 直播 / 壁纸用网格展示，其余模块保持列表 */
  const gridModule =
    moduleKey === 'h1' ||
    moduleKey === 'drama' ||
    moduleKey === 'psite' ||
    moduleKey === 'xsite' ||
    moduleKey === 'live' ||
    moduleKey === 'wallpaper'

  /** 删除前先确认，避免误点垃圾桶直接删掉收藏 */
  const [removing, setRemoving] = useState<InnerFav | null>(null)

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
            const Icon = MODULE_ICONS[key] ?? Heart
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
      ) : gridModule ? (
        <div className="media-grid">
          {favs.map((f) => {
            const open = (): void => onOpen(f)
            const duration = videoDuration(f)
            return (
              <div
                key={`${f.module}-${f.id}`}
                className="media-card"
                role="button"
                tabIndex={0}
                title="打开对应模块"
                onClick={open}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') open()
                }}
              >
                <span className="media-thumb">
                  {f.cover ? <img src={f.cover} alt="" loading="lazy" /> : null}
                  {duration ? <span className="media-duration">{duration}</span> : null}
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
        <div className={`rows ${moduleKey === 'music' ? 'compact' : ''}`}>
          {favs.map((f, index) => {
            const isMusic = f.module === 'music'
            const open = (): void => {
              if (isMusic) player.playFavs(favs, index)
              else onOpen(f)
            }
            return (
              <div
                key={`${f.module}-${f.id}`}
                className="row clickable"
                role="button"
                tabIndex={0}
                title={isMusic ? '用内置播放器播放，并播放当前列表' : '打开对应模块'}
                onClick={open}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') open()
                }}
              >
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
                <span className="badge brand">{isMusic ? '播放' : favModuleLabel(f.module)}</span>
                <button
                  className="icon-btn danger"
                  title="删除收藏"
                  onClick={(e) => {
                    e.stopPropagation()
                    setRemoving(f)
                  }}
                >
                  <Trash2 size={15} />
                </button>
                <ChevronRight size={15} className="row-arrow" />
              </div>
            )
          })}
        </div>
      )}

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
