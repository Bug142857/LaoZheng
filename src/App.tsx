import { useEffect, useRef, useState } from 'react'
import {
  BookHeart,
  Download,
  Globe,
  Heart,
  Home,
  Images,
  ListChecks,
  MonitorPlay,
  Music,
  PlayCircle,
  Popcorn,
  Search,
  Settings,
  Tv,
  type LucideIcon
} from 'lucide-react'
import { DataProvider, useData } from './state/DataContext'
import { HomePage } from './pages/HomePage'
import { SearchPage } from './pages/SearchPage'
import { WatchPage } from './pages/WatchPage'
import { LivePage } from './pages/LivePage'
import { MusicPage } from './pages/MusicPage'
import { DownloadsPage } from './pages/DownloadsPage'
import { XSitePage } from './pages/XSitePage'
import { PsitePage } from './pages/PsitePage'
import { BikaPage } from './pages/BikaPage'
import { ComicPage } from './pages/ComicPage'
import { CollectionPage } from './pages/CollectionPage'
import { MelonPage } from './pages/MelonPage'
import { ListsPage } from './pages/ListsPage'
import { ListDetailPage } from './pages/ListDetailPage'
import { FavoritesPage } from './pages/FavoritesPage'
import { SettingsPage } from './pages/SettingsPage'
import { EmptyState } from './components/ui'

import type { HomeModule } from './modules'

type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'watch' }
  | { name: 'live' }
  | { name: 'music' }
  | { name: 'xsite' }
  | { name: 'psite' }
  | { name: 'bika' }
  | { name: 'comic' }
  | { name: 'melon' }
  | { name: 'h1'; index: number }
  | { name: 'book' }
  | { name: 'game' }
  | { name: 'lists' }
  | { name: 'list'; id: number }
  | { name: 'favorites' }
  | { name: 'downloads' }
  | { name: 'settings' }

interface NavItem {
  key:
    | 'home'
    | 'search'
    | 'watch'
    | 'live'
    | 'music'
    | 'xsite'
    | 'psite'
    | 'bika'
    | 'comic'
    | 'melon'
    | 'lists'
    | 'favorites'
    | 'downloads'
    | 'settings'
  label: string
  icon: LucideIcon
  ready: boolean
}

const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: '首页', icon: Home, ready: true },
  { key: 'search', label: '搜索', icon: Search, ready: true },
  { key: 'watch', label: '观影', icon: MonitorPlay, ready: true },
  { key: 'live', label: '电视', icon: Tv, ready: true },
  { key: 'music', label: '音乐', icon: Music, ready: true },
  { key: 'xsite', label: 'X站', icon: Globe, ready: true },
  { key: 'psite', label: 'P站', icon: PlayCircle, ready: true },
  { key: 'bika', label: '本子', icon: BookHeart, ready: true },
  { key: 'comic', label: '漫画', icon: Images, ready: true },
  { key: 'melon', label: '吃瓜', icon: Popcorn, ready: true },
  { key: 'lists', label: '清单', icon: ListChecks, ready: true },
  { key: 'favorites', label: '收藏', icon: Heart, ready: true },
  { key: 'downloads', label: '下载', icon: Download, ready: true },
  { key: 'settings', label: '设置', icon: Settings, ready: true }
]

function leafRoute(key: NavItem['key']): Route {
  switch (key) {
    case 'home':
      return { name: 'home' }
    case 'search':
      return { name: 'search' }
    case 'watch':
      return { name: 'watch' }
    case 'live':
      return { name: 'live' }
    case 'music':
      return { name: 'music' }
    case 'xsite':
      return { name: 'xsite' }
    case 'psite':
      return { name: 'psite' }
    case 'bika':
      return { name: 'bika' }
    case 'comic':
      return { name: 'comic' }
    case 'melon':
      return { name: 'melon' }
    case 'lists':
      return { name: 'lists' }
    case 'favorites':
      return { name: 'favorites' }
    case 'downloads':
      return { name: 'downloads' }
    case 'settings':
      return { name: 'settings' }
  }
}

function Shell() {
  const { ready, saveState, data } = useData()
  const [route, setRoute] = useState<Route>({ name: 'home' })
  const [notice, setNotice] = useState<string | null>(null)
  const contentRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [route.name])

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

  const activeNav: Route['name'] = route.name === 'list' ? 'lists' : route.name

  const openModule = (m: HomeModule) => {
    if (m.key === 'lists') {
      setRoute({ name: 'lists' })
      return
    }
    if (m.key === 'watch') {
      setRoute({ name: 'watch' })
      return
    }
    if (m.key === 'tv') {
      setRoute({ name: 'live' })
      return
    }
    if (m.key === 'music') {
      setRoute({ name: 'music' })
      return
    }
    if (m.key === 'xsite') {
      setRoute({ name: 'xsite' })
      return
    }
    if (m.key === 'psite') {
      setRoute({ name: 'psite' })
      return
    }
    if (m.key === 'h2') {
      setRoute({ name: 'bika' })
      return
    }
    if (m.key === 'comic') {
      setRoute({ name: 'comic' })
      return
    }
    if (m.key === 'melon') {
      setRoute({ name: 'melon' })
      return
    }
    if (m.key === 'book') {
      setRoute({ name: 'book' })
      return
    }
    if (m.key === 'game') {
      setRoute({ name: 'game' })
      return
    }
    const h1 = m.key.match(/^h1_(\d)$/)
    if (h1) {
      setRoute({ name: 'h1', index: Number(h1[1]) - 1 })
      return
    }
    setNotice(`「${m.title}」模块将在后续版本接入，当前先完成框架与数据迁移。`)
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">郑</span>
          <span>
            <div className="brand-title">老郑分享</div>
            <div className="brand-sub">PC 端</div>
          </span>
        </div>

        <nav className="nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = activeNav === item.key
            const count = item.key === 'favorites' ? data.innerFavs.length : 0
            return (
              <button
                key={item.key}
                className={`nav-item ${active ? 'active' : ''}`}
                onClick={() => {
                  if (!item.ready) {
                    setNotice(`「${item.label}」将在后续版本接入。`)
                    return
                  }
                  setRoute(leafRoute(item.key))
                }}
              >
                <Icon size={17} strokeWidth={1.9} />
                {item.label}
                {count > 0 ? <span className="nav-badge">{count}</span> : null}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="save-state">
            <span className={`dot ${saveState === 'saving' ? 'saving' : ''}`} />
            {saveState === 'saving'
              ? '正在保存…'
              : saveState === 'saved'
                ? '已保存到本地'
                : '本地数据'}
          </div>
          <div>数据格式 version 1 · 与手机端互通</div>
        </div>
      </aside>

      <main className="content" ref={contentRef}>
        {route.name === 'home' && <HomePage onOpen={openModule} />}
        {route.name === 'search' && <SearchPage onNotice={setNotice} />}
        {route.name === 'watch' && <WatchPage onNotice={setNotice} />}
        {route.name === 'live' && <LivePage onNotice={setNotice} />}
        {route.name === 'music' && <MusicPage onNotice={setNotice} />}
        {route.name === 'xsite' && <XSitePage onNotice={setNotice} />}
        {route.name === 'psite' && <PsitePage onNotice={setNotice} />}
        {route.name === 'bika' && <BikaPage onNotice={setNotice} />}
        {route.name === 'comic' && <ComicPage onNotice={setNotice} />}
        {route.name === 'melon' && <MelonPage onNotice={setNotice} />}
        {route.name === 'h1' && (
          <WatchPage
            variant={{ label: `番${route.index + 1}`, proxyIndex: route.index }}
            onNotice={setNotice}
          />
        )}
        {route.name === 'book' && (
          <CollectionPage
            category="图书"
            title="图书"
            desc="已收藏的图书"
            onNotice={setNotice}
            onGoSearch={() => setRoute({ name: 'search' })}
          />
        )}
        {route.name === 'game' && (
          <CollectionPage
            category="游戏"
            title="游戏"
            desc="已收藏的游戏"
            onNotice={setNotice}
            onGoSearch={() => setRoute({ name: 'search' })}
          />
        )}
        {route.name === 'lists' && (
          <ListsPage
            onOpenList={(id) => setRoute({ name: 'list', id })}
            onNotice={setNotice}
          />
        )}
        {route.name === 'list' && (
          <ListDetailPage
            listId={route.id}
            onBack={() => setRoute({ name: 'lists' })}
            onOpenList={(id) => setRoute({ name: 'list', id })}
            onNotice={setNotice}
          />
        )}
        {route.name === 'favorites' && <FavoritesPage />}
        {route.name === 'downloads' && <DownloadsPage onNotice={setNotice} />}
        {route.name === 'settings' && <SettingsPage onNotice={setNotice} />}
      </main>

      {notice ? <div className="toast">{notice}</div> : null}
    </div>
  )
}

export default function App() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  )
}
