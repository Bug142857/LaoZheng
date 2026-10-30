import { useEffect, useRef, useState } from 'react'
import {
  BookHeart,
  BookOpen,
  Film,
  Gamepad2,
  Globe,
  Home,
  Images,
  ListChecks,
  MonitorPlay,
  Music,
  PlayCircle,
  Popcorn,
  Settings,
  Tv,
  type LucideIcon
} from 'lucide-react'
import { DataProvider, useData } from './state/DataContext'
import { HomePage } from './pages/HomePage'
import { WatchPage, type WatchFocus } from './pages/WatchPage'
import { LivePage } from './pages/LivePage'
import { MusicPage } from './pages/MusicPage'
import { DownloadsPage, type DownloadSection } from './pages/DownloadsPage'
import { XSitePage } from './pages/XSitePage'
import { PsitePage } from './pages/PsitePage'
import { BikaPage } from './pages/BikaPage'
import { ComicPage } from './pages/ComicPage'
import { GamePage } from './pages/GamePage'
import { BookPage } from './pages/BookPage'
import { MelonPage } from './pages/MelonPage'
import { ListsPage } from './pages/ListsPage'
import { ListDetailPage } from './pages/ListDetailPage'
import { FavoritesPage } from './pages/FavoritesPage'
import { SettingsPage } from './pages/SettingsPage'
import { EmptyState } from './components/ui'
import { ImageViewer } from './components/ImageViewer'
import { DownloadCenter } from './components/DownloadCenter'
import {
  MusicPlayerBar,
  MusicPlayerProvider
} from './components/MusicPlayer'
import { syncUiSettings } from './utils/theme'
import { H1_FIXED_SOURCES } from './shared/vod'

import type { InnerFav } from './shared/types'

type Route =
  | { name: 'home' }
  | { name: 'watch'; focus?: WatchFocus; searchTitle?: string }
  | { name: 'live'; focusUrl?: string }
  | { name: 'music'; focus?: FavFocus }
  | { name: 'xsite'; focusId?: string }
  | { name: 'psite'; focus?: FavFocus }
  | { name: 'bika'; focusId?: string }
  | { name: 'comic'; focusId?: string }
  | { name: 'melon'; focusId?: string }
  | { name: 'h1'; index: number; focus?: WatchFocus }
  | { name: 'book'; focusId?: string }
  | { name: 'game'; focusId?: string }
  | { name: 'lists' }
  | { name: 'list'; id: number }
  | { name: 'favorites'; moduleKey?: string; direct?: boolean }
  | { name: 'downloads'; section?: DownloadSection }
  | { name: 'settings' }

interface FavFocus {
  id: string
  title: string
  subtitle: string
  cover: string | null
  durationSec: number
  payload: string | null
}

interface NavItem {
  key:
    | 'home'
    | 'lists'
    | 'watch'
    | 'h1_1'
    | 'h1_2'
    | 'h1_3'
    | 'h1_4'
    | 'bika'
    | 'comic'
    | 'game'
    | 'book'
    | 'live'
    | 'music'
    | 'melon'
    | 'xsite'
    | 'psite'
    | 'settings'
  label: string
  icon: LucideIcon
  ready: boolean
  /** 需要外网环境的模块：导航项后显示「外网」小字 */
  external?: boolean
}

/** 顺序与手机端 v0.325 一致（清单 → 观影 → 音乐 → 游戏 → 电视 → 吃瓜 → 外网模块 → 设置） */
const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: '首页', icon: Home, ready: true },
  { key: 'lists', label: '清单', icon: ListChecks, ready: true },
  { key: 'watch', label: '观影', icon: MonitorPlay, ready: true },
  { key: 'music', label: '音乐', icon: Music, ready: true },
  { key: 'game', label: '游戏', icon: Gamepad2, ready: true },
  { key: 'live', label: '电视', icon: Tv, ready: true },
  { key: 'melon', label: '吃瓜', icon: Popcorn, ready: true },
  { key: 'book', label: '图书', icon: BookOpen, ready: true, external: true },
  { key: 'comic', label: '漫画', icon: Images, ready: true, external: true },
  { key: 'bika', label: '本子', icon: BookHeart, ready: true, external: true },
  { key: 'h1_1', label: '番1', icon: Film, ready: true, external: true },
  { key: 'h1_2', label: '番2', icon: Film, ready: true, external: true },
  { key: 'h1_3', label: '番3', icon: Film, ready: true, external: true },
  { key: 'h1_4', label: '番4', icon: Film, ready: true, external: true },
  { key: 'psite', label: 'P站', icon: PlayCircle, ready: true, external: true },
  { key: 'xsite', label: 'X站', icon: Globe, ready: true, external: true },
  { key: 'settings', label: '设置', icon: Settings, ready: true }
]

function leafRoute(key: NavItem['key']): Route {
  switch (key) {
    case 'home':
      return { name: 'home' }
    case 'lists':
      return { name: 'lists' }
    case 'watch':
      return { name: 'watch' }
    case 'h1_1':
      return { name: 'h1', index: 0 }
    case 'h1_2':
      return { name: 'h1', index: 1 }
    case 'h1_3':
      return { name: 'h1', index: 2 }
    case 'h1_4':
      return { name: 'h1', index: 3 }
    case 'bika':
      return { name: 'bika' }
    case 'comic':
      return { name: 'comic' }
    case 'game':
      return { name: 'game' }
    case 'book':
      return { name: 'book' }
    case 'live':
      return { name: 'live' }
    case 'music':
      return { name: 'music' }
    case 'melon':
      return { name: 'melon' }
    case 'xsite':
      return { name: 'xsite' }
    case 'psite':
      return { name: 'psite' }
    case 'settings':
      return { name: 'settings' }
  }
}

/** 路由 → 常驻页面 key（模块页切走后不卸载，搜索继续跑、列表不重载） */
function routeKey(route: Route): string {
  if (route.name === 'h1') return `h1_${route.index + 1}`
  // 清单逐级进入时也是一个新页面：带上 id 让滚动位置回到顶部
  if (route.name === 'list') return `list:${route.id}`
  return route.name
}

interface ShortcutConfig {
  fav?: string
  download?: DownloadSection
}

/** 各模块右上角「收藏 / 下载」对应的数据口径 */
const MODULE_SHORTCUTS: Record<string, ShortcutConfig> = {
  watch: { fav: 'watch', download: 'video' },
  h1_1: { fav: 'h1', download: 'video' },
  h1_2: { fav: 'h1', download: 'video' },
  h1_3: { fav: 'h1', download: 'video' },
  h1_4: { fav: 'h1', download: 'video' },
  live: { fav: 'tv' },
  music: { fav: 'music', download: 'music' },
  game: { fav: 'game' },
  melon: { fav: 'melon', download: 'video' },
  book: { fav: 'book', download: 'book' },
  comic: { fav: 'comic', download: 'comic' },
  bika: { fav: 'h2', download: 'h2' },
  psite: { fav: 'psite', download: 'video' },
  xsite: { fav: 'xsite', download: 'video' }
}

/** 收藏 payload 里保存的片源 / 条目信息（新版收藏才有） */
interface FavPayload {
  sourceId?: string
  vodId?: number
  groupName?: string
}

function parseFavPayload(raw: string | null): FavPayload {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as FavPayload
    return {
      sourceId: typeof value.sourceId === 'string' ? value.sourceId : undefined,
      vodId: typeof value.vodId === 'number' ? value.vodId : undefined,
      groupName: typeof value.groupName === 'string' ? value.groupName : undefined
    }
  } catch {
    return {}
  }
}

function Shell() {
  const { ready } = useData()
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }])
  const [notice, setNotice] = useState<string | null>(null)
  const [visited, setVisited] = useState<string[]>(['home'])
  const [navEpoch, setNavEpoch] = useState<Record<string, number>>({})
  const contentRef = useRef<HTMLElement | null>(null)
  const route = stack[stack.length - 1]

  /** 统一的「上一页」：永远回到进入当前页面前的页面，不越级 */
  const pushRoute = (next: Route) => setStack((prev) => [...prev, next])
  const backRoute = () => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))

  const activeKey = routeKey(route)
  /** 当前路由的页面必须立刻出现，不能等 effect 补 visited（否则会闪一帧空白） */
  const shownKeys = visited.includes(activeKey) ? visited : [...visited, activeKey]

  useEffect(() => {
    void syncUiSettings()
  }, [])

  useEffect(() => {
    if (!visited.includes(activeKey)) setVisited((prev) => [...prev, activeKey])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      contentRef.current?.scrollTo({ top: 0 })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [activeKey])

  /** 页面被切走（隐藏）后停止其中的视频 / 音频，避免在后台继续出声 */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      document.querySelectorAll<HTMLMediaElement>('.content video, .content audio').forEach((el) => {
        const owner = el.closest<HTMLElement>('[data-page-slot]')
        if (owner && owner.style.display === 'none' && !el.paused) {
          el.pause()
        }
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [activeKey])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 2800)
    return () => window.clearTimeout(timer)
  }, [notice])

  if (!ready) {
    return (
      <div className="app">
        <main className="content">
          <EmptyState title="正在加载本地数据…" />
        </main>
      </div>
    )
  }

  const activeNav =
    route.name === 'list'
      ? 'lists'
      : route.name === 'h1'
        ? `h1_${route.index + 1}`
        : route.name === 'favorites' || route.name === 'downloads'
          ? ''
          : route.name

  const openFav = (fav: InnerFav) => {
    const focus: FavFocus = {
      id: fav.id,
      title: fav.title,
      subtitle: fav.subtitle,
      cover: fav.cover,
      durationSec: fav.durationSec,
      payload: fav.payload
    }
    switch (fav.module) {
      case 'h2':
        pushRoute({ name: 'bika', focusId: fav.id })
        return
      case 'comic':
        pushRoute({ name: 'comic', focusId: fav.id })
        return
      case 'game':
        pushRoute({ name: 'game', focusId: fav.id })
        return
      case 'book':
        pushRoute({ name: 'book', focusId: fav.id })
        return
      case 'xsite':
        pushRoute({ name: 'xsite', focusId: fav.id })
        return
      case 'psite':
        pushRoute({ name: 'psite', focus: focus })
        return
      case 'melon':
        pushRoute({ name: 'melon', focusId: fav.id })
        return
      case 'music':
        pushRoute({ name: 'music', focus })
        return
      case 'tv':
        pushRoute({ name: 'live', focusUrl: fav.videoUrl ?? fav.id })
        return
      case 'watch':
      case 'h1': {
        const payload = parseFavPayload(fav.payload)
        const watchFocus: WatchFocus = {
          url: fav.videoUrl ?? undefined,
          title: fav.title,
          sourceId: payload.sourceId,
          // 旧收藏没有 payload：副标题第一段是片源名，mediaId 是站点条目 id
          sourceName: payload.sourceId ? undefined : fav.subtitle.split(' · ')[0],
          vodId: payload.vodId ?? (fav.mediaId > 0 ? fav.mediaId : undefined),
          groupName: payload.groupName
        }
        if (fav.module === 'h1') {
          const match = /^h1_fixed_(\d)$/.exec(payload.sourceId ?? '')
          const byName = H1_FIXED_SOURCES.findIndex((s) => s.name === watchFocus.sourceName)
          const index = match
            ? Math.max(0, Math.min(3, Number(match[1]) - 1))
            : byName >= 0
              ? byName
              : 0
          pushRoute({ name: 'h1', index, focus: watchFocus })
        } else {
          pushRoute({ name: 'watch', focus: watchFocus })
        }
        return
      }
      default:
        setNotice(`「${fav.title}」所属模块暂不支持从收藏直接打开。`)
    }
  }

  const openShortcut = (key: string, kind: 'fav' | 'download') => {
    const config = MODULE_SHORTCUTS[key]
    if (!config) return
    if (kind === 'fav' && config.fav) {
      pushRoute({ name: 'favorites', moduleKey: config.fav, direct: true })
    } else if (kind === 'download' && config.download) {
      pushRoute({ name: 'downloads', section: config.download })
    }
  }

  /** 清单条目「在线观看」：带着片名跳到观影并自动搜索 */
  const openWatchSearch = (title: string) => {
    pushRoute({ name: 'watch', searchTitle: title })
  }

  const openNav = (item: NavItem) => {
    if (!item.ready) {
      setNotice(`「${item.label}」将在后续版本接入。`)
      return
    }
    // 点侧栏进入模块时直接回到该模块首页，不保留上次的详情 / 播放页
    setStack([leafRoute(item.key)])
    setNavEpoch((prev) => ({ ...prev, [item.key]: (prev[item.key] ?? 0) + 1 }))
  }

  /** 收藏页内部切换模块时写回路由，从条目返回后仍停留在同一模块 */
  const setFavoritesModule = (moduleKey: string | null) => {
    setStack((prev) => {
      const top = prev[prev.length - 1]
      if (top.name !== 'favorites') return prev
      return [
        ...prev.slice(0, -1),
        { name: 'favorites', moduleKey: moduleKey ?? undefined, direct: top.direct }
      ]
    })
  }

  const slot = (key: string) => ({
    style: { display: (activeKey === key ? 'block' : 'none') as 'block' | 'none' },
    'data-page-slot': key
  })

  const shortcuts = (key: string) => ({
    onOpenFavorites: MODULE_SHORTCUTS[key]?.fav ? () => openShortcut(key, 'fav') : undefined,
    onOpenDownloads: MODULE_SHORTCUTS[key]?.download
      ? () => openShortcut(key, 'download')
      : undefined
  })

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">郑</span>
          <span className="brand-title">老郑分享</span>
        </div>

        <nav className="nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = activeNav === item.key
            return (
              <button
                key={item.key}
                className={`nav-item ${active ? 'active' : ''}`}
                onClick={() => openNav(item)}
              >
                <Icon size={17} strokeWidth={1.9} />
                {item.label}
                {item.external ? (
                  <span className="nav-suffix" title="需要外网环境">
                    外网
                  </span>
                ) : null}
              </button>
            )
          })}
        </nav>
      </aside>

      <main className="content" ref={contentRef}>
        {shownKeys.includes('home') ? (
          <div {...slot('home')}>
            <HomePage />
          </div>
        ) : null}

        {shownKeys.includes('lists') ? (
          <div {...slot('lists')}>
            <ListsPage
              onOpenList={(id) => pushRoute({ name: 'list', id })}
              onNotice={setNotice}
              resetSignal={navEpoch.lists}
            />
          </div>
        ) : null}

        {shownKeys.includes('watch') ? (
          <div {...slot('watch')}>
            <WatchPage
              onNotice={setNotice}
              focus={route.name === 'watch' ? route.focus : undefined}
              searchTitle={route.name === 'watch' ? route.searchTitle : undefined}
              resetSignal={navEpoch.watch}
              onExit={backRoute}
              {...shortcuts('watch')}
            />
          </div>
        ) : null}

        {[0, 1, 2, 3].map((index) => {
          const key = `h1_${index + 1}`
          if (!shownKeys.includes(key)) return null
          return (
            <div key={key} {...slot(key)}>
              <WatchPage
                variant={{ label: `番${index + 1}`, index }}
                focus={route.name === 'h1' && route.index === index ? route.focus : undefined}
                resetSignal={navEpoch[key]}
                onNotice={setNotice}
                onExit={backRoute}
                {...shortcuts(key)}
              />
            </div>
          )
        })}

        {shownKeys.includes('live') ? (
          <div {...slot('live')}>
            <LivePage
              onNotice={setNotice}
              focusUrl={route.name === 'live' ? route.focusUrl : undefined}
              resetSignal={navEpoch.live}
              onExit={backRoute}
              {...shortcuts('live')}
            />
          </div>
        ) : null}

        {shownKeys.includes('music') ? (
          <div {...slot('music')}>
            <MusicPage
              onNotice={setNotice}
              focus={route.name === 'music' ? route.focus : undefined}
              resetSignal={navEpoch.music}
              onExit={backRoute}
              {...shortcuts('music')}
            />
          </div>
        ) : null}

        {shownKeys.includes('xsite') ? (
          <div {...slot('xsite')}>
            <XSitePage
              onNotice={setNotice}
              focusId={route.name === 'xsite' ? route.focusId : undefined}
              resetSignal={navEpoch.xsite}
              onExit={backRoute}
              {...shortcuts('xsite')}
            />
          </div>
        ) : null}

        {shownKeys.includes('psite') ? (
          <div {...slot('psite')}>
            <PsitePage
              onNotice={setNotice}
              focus={route.name === 'psite' ? route.focus : undefined}
              resetSignal={navEpoch.psite}
              onExit={backRoute}
              {...shortcuts('psite')}
            />
          </div>
        ) : null}

        {shownKeys.includes('bika') ? (
          <div {...slot('bika')}>
            <BikaPage
              onNotice={setNotice}
              focusId={route.name === 'bika' ? route.focusId : undefined}
              resetSignal={navEpoch.bika}
              onExit={backRoute}
              {...shortcuts('bika')}
            />
          </div>
        ) : null}

        {shownKeys.includes('comic') ? (
          <div {...slot('comic')}>
            <ComicPage
              onNotice={setNotice}
              focusId={route.name === 'comic' ? route.focusId : undefined}
              resetSignal={navEpoch.comic}
              onExit={backRoute}
              {...shortcuts('comic')}
            />
          </div>
        ) : null}

        {shownKeys.includes('melon') ? (
          <div {...slot('melon')}>
            <MelonPage
              onNotice={setNotice}
              focusId={route.name === 'melon' ? route.focusId : undefined}
              resetSignal={navEpoch.melon}
              onExit={backRoute}
              {...shortcuts('melon')}
            />
          </div>
        ) : null}

        {shownKeys.includes('game') ? (
          <div {...slot('game')}>
            <GamePage
              onNotice={setNotice}
              focusId={route.name === 'game' ? route.focusId : undefined}
              resetSignal={navEpoch.game}
              onExit={backRoute}
              {...shortcuts('game')}
            />
          </div>
        ) : null}

        {shownKeys.includes('book') ? (
          <div {...slot('book')}>
            <BookPage
              onNotice={setNotice}
              focusId={route.name === 'book' ? route.focusId : undefined}
              resetSignal={navEpoch.book}
              onExit={backRoute}
              {...shortcuts('book')}
            />
          </div>
        ) : null}

        {shownKeys.includes('settings') ? (
          <div {...slot('settings')}>
            <SettingsPage
              onNotice={setNotice}
              resetSignal={navEpoch.settings}
              onOpenPage={(page, moduleKey) => {
                if (page === 'favorites') {
                  pushRoute({ name: 'favorites', moduleKey })
                } else {
                  pushRoute({ name: 'downloads' })
                }
              }}
            />
          </div>
        ) : null}

        {route.name === 'list' ? (
          <ListDetailPage
            listId={route.id}
            onBack={backRoute}
            onOpenList={(id) => pushRoute({ name: 'list', id })}
            onNotice={setNotice}
            onWatch={openWatchSearch}
          />
        ) : null}

        {route.name === 'favorites' ? (
          <FavoritesPage
            onOpen={openFav}
            onBack={backRoute}
            onModuleChange={setFavoritesModule}
            onNotice={setNotice}
            initialModule={route.moduleKey}
            directEntry={route.direct}
          />
        ) : null}

        {route.name === 'downloads' ? (
          <DownloadsPage
            onNotice={setNotice}
            onBack={backRoute}
            initialSection={route.section}
          />
        ) : null}
      </main>

      <MusicPlayerBar />
      <DownloadCenter
        onNotice={setNotice}
        onOpenDownloads={() => {
          if (route.name !== 'downloads') pushRoute({ name: 'downloads' })
        }}
      />
      <ImageViewer onNotice={setNotice} />
      {notice ? <div className="toast">{notice}</div> : null}
    </div>
  )
}

export default function App() {
  return (
    <DataProvider>
      <MusicPlayerProvider>
        <Shell />
      </MusicPlayerProvider>
    </DataProvider>
  )
}
