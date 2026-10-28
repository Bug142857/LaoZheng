import { useEffect, useState } from 'react'
import {
  Download,
  Heart,
  Home,
  ListChecks,
  Search,
  Settings,
  type LucideIcon
} from 'lucide-react'
import { DataProvider, useData } from './state/DataContext'
import { HomePage } from './pages/HomePage'
import { SearchPage } from './pages/SearchPage'
import { ListsPage } from './pages/ListsPage'
import { ListDetailPage } from './pages/ListDetailPage'
import { FavoritesPage } from './pages/FavoritesPage'
import { SettingsPage } from './pages/SettingsPage'
import { EmptyState } from './components/ui'
import type { HomeModule } from './modules'

type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'lists' }
  | { name: 'list'; id: number }
  | { name: 'favorites' }
  | { name: 'downloads' }
  | { name: 'settings' }

interface NavItem {
  key: 'home' | 'search' | 'lists' | 'favorites' | 'downloads' | 'settings'
  label: string
  icon: LucideIcon
  ready: boolean
}

const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: '首页', icon: Home, ready: true },
  { key: 'search', label: '搜索', icon: Search, ready: true },
  { key: 'lists', label: '清单', icon: ListChecks, ready: true },
  { key: 'favorites', label: '收藏', icon: Heart, ready: true },
  { key: 'downloads', label: '下载', icon: Download, ready: false },
  { key: 'settings', label: '设置', icon: Settings, ready: true }
]

function leafRoute(key: NavItem['key']): Route {
  switch (key) {
    case 'home':
      return { name: 'home' }
    case 'search':
      return { name: 'search' }
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

      <main className="content">
        {route.name === 'home' && <HomePage onOpen={openModule} />}
        {route.name === 'search' && <SearchPage onNotice={setNotice} />}
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
        {route.name === 'downloads' && (
          <EmptyState
            title="下载管理规划中"
            desc="PC 端会先接入搜索与播放，再复用手机端的下载目录结构（视频 / 漫画 / 本子 / 音乐 / 书籍）。"
          />
        )}
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
