import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ElementType,
  type MouseEvent as ReactMouseEvent
} from 'react'
import {
  BookOpen,
  BookText,
  Camera,
  Clapperboard,
  Gamepad,
  Gamepad2,
  Home,
  Images,
  ListChecks,
  Magnet,
  MonitorCog,
  MonitorPlay,
  Music,
  MicVocal,
  Newspaper,
  PlayCircle,
  Popcorn,
  Radio,
  Settings,
  Tv,
  Wallpaper,
  Wand2,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import { DataProvider, useData } from './state/DataContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { HomePage } from './pages/HomePage'
import type { WatchFocus } from './pages/WatchPage'
import type { DramaFocus } from './pages/DramaPage'
import type { DownloadSection } from './pages/DownloadsPage'
import type { NovelFocus } from './pages/NovelPage'
import type { ShuangkanFocus } from './shared/shuangkan'
import type { GameCheatFocus } from './pages/GameCheatPage'
import type { SkContent } from './shared/shuangkan'
import { EmptyState } from './components/ui'
import { ImageViewer } from './components/ImageViewer'
import { DownloadCenter } from './components/DownloadCenter'
import { UpdateModal } from './components/UpdateModal'
import {
  MusicPlayerBar,
  MusicPlayerProvider
} from './components/MusicPlayer'
import { syncUiSettings } from './utils/theme'
import { clearCachePrefix } from './utils/cache'

import type { InnerFav } from './shared/types'
import type { UpdateCheckResult } from './shared/update'
import type { LivePlatformId, LiveRoomFocus } from './shared/livePlatform'
import {
  isWallpaperSourceId,
  parseWallpaperFavPayload,
  type WallpaperFocus,
  type WallpaperItem
} from './shared/wallpaper'
import { parseMeituFavId, parseMeituFavPayload, type MeituFocus } from './shared/meitu'

/**
 * 按页代码分割：首屏只加载主页与框架，其余模块访问时才拉对应 chunk。
 * 每个模块外套 ErrorBoundary + Suspense：渲染异常只影响该模块，懒加载时有占位提示。
 */
function pageBoundary<P extends object>(
  label: string,
  Comp: ElementType<P>
): ComponentType<P> {
  const Page = Comp as ComponentType<P>
  return function BoundedPage(props: P) {
    return (
      <ErrorBoundary label={label}>
        <Suspense fallback={<EmptyState title={`正在加载${label}…`} />}>
          <Page {...props} />
        </Suspense>
      </ErrorBoundary>
    )
  }
}

const WatchPage = pageBoundary(
  '影视',
  lazy(() => import('./pages/WatchPage').then((m) => ({ default: m.WatchPage })))
)
const DramaPage = pageBoundary(
  '短剧',
  lazy(() => import('./pages/DramaPage').then((m) => ({ default: m.DramaPage })))
)
const LivePage = pageBoundary(
  '电视',
  lazy(() => import('./pages/LivePage').then((m) => ({ default: m.LivePage })))
)
const LiveRoomsPage = pageBoundary(
  '直播',
  lazy(() => import('./pages/LiveRoomsPage').then((m) => ({ default: m.LiveRoomsPage })))
)
const SingingPage = pageBoundary(
  '演唱',
  lazy(() => import('./pages/SingingPage').then((m) => ({ default: m.SingingPage })))
)
const MusicPage = pageBoundary(
  '音乐',
  lazy(() => import('./pages/MusicPage').then((m) => ({ default: m.MusicPage })))
)
const DownloadsPage = pageBoundary(
  '下载',
  lazy(() => import('./pages/DownloadsPage').then((m) => ({ default: m.DownloadsPage })))
)
const ComicPage = pageBoundary(
  '漫画',
  lazy(() => import('./pages/ComicPage').then((m) => ({ default: m.ComicPage })))
)
const NovelPage = pageBoundary(
  '小说',
  lazy(() => import('./pages/NovelPage').then((m) => ({ default: m.NovelPage })))
)
const GamePage = pageBoundary(
  '游戏',
  lazy(() => import('./pages/GamePage').then((m) => ({ default: m.GamePage })))
)
const EmuPage = pageBoundary(
  '模拟',
  lazy(() => import('./pages/EmuPage').then((m) => ({ default: m.EmuPage })))
)
const BookPage = pageBoundary(
  '图书',
  lazy(() => import('./pages/BookPage').then((m) => ({ default: m.BookPage })))
)
const MelonPage = pageBoundary(
  '吃瓜',
  lazy(() => import('./pages/MelonPage').then((m) => ({ default: m.MelonPage })))
)
const NewsPage = pageBoundary(
  '资讯',
  lazy(() => import('./pages/NewsPage').then((m) => ({ default: m.NewsPage })))
)
const ShuangkanPage = pageBoundary(
  '皇片',
  lazy(() => import('./pages/ShuangkanPage').then((m) => ({ default: m.ShuangkanPage })))
)
const MagnetPage = pageBoundary(
  '磁力',
  lazy(() => import('./pages/MagnetPage').then((m) => ({ default: m.MagnetPage })))
)
const ListsPage = pageBoundary(
  '清单',
  lazy(() => import('./pages/ListsPage').then((m) => ({ default: m.ListsPage })))
)
const ListDetailPage = pageBoundary(
  '清单详情',
  lazy(() => import('./pages/ListDetailPage').then((m) => ({ default: m.ListDetailPage })))
)
const FavoritesPage = pageBoundary(
  '收藏',
  lazy(() => import('./pages/FavoritesPage').then((m) => ({ default: m.FavoritesPage })))
)
const SettingsPage = pageBoundary(
  '设置',
  lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
)
const SysInfoPage = pageBoundary(
  '硬件',
  lazy(() => import('./pages/SysInfoPage').then((m) => ({ default: m.SysInfoPage })))
)
const WallpaperPage = pageBoundary(
  '壁纸',
  lazy(() => import('./pages/WallpaperPage').then((m) => ({ default: m.WallpaperPage })))
)
const MeituPage = pageBoundary(
  '套图',
  lazy(() => import('./pages/MeituPage').then((m) => ({ default: m.MeituPage })))
)
const GameCheatPage = pageBoundary(
  '补丁',
  lazy(() => import('./pages/GameCheatPage').then((m) => ({ default: m.GameCheatPage })))
)
const ToolsPage = pageBoundary(
  '软件',
  lazy(() => import('./pages/ToolsPage').then((m) => ({ default: m.ToolsPage })))
)

type Route =
  | { name: 'home' }
  | { name: 'watch'; focus?: WatchFocus; searchTitle?: string }
  | { name: 'drama'; focus?: DramaFocus }
  | { name: 'live'; focusUrl?: string }
  | { name: 'liveRooms'; focus?: LiveRoomFocus }
  | { name: 'singing'; focusId?: string }
  | { name: 'music'; focus?: FavFocus }
  | { name: 'comic'; focusId?: string }
  | { name: 'novel'; focus?: NovelFocus }
  | { name: 'melon'; focusId?: string }
  | { name: 'news' }
  | { name: 'shuangkan'; focus?: ShuangkanFocus }
  | { name: 'book'; focusId?: string }
  | { name: 'game'; focusId?: string }
  | { name: 'emu'; focusId?: string }
  | { name: 'magnet'; searchTitle?: string }
  | { name: 'lists' }
  | { name: 'list'; id: number }
  | { name: 'favorites'; moduleKey?: string; direct?: boolean }
  | { name: 'downloads'; section?: DownloadSection }
  | { name: 'sysinfo' }
  | { name: 'wallpaper'; focus?: WallpaperFocus }
  | { name: 'meitu'; focus?: MeituFocus }
  | { name: 'gamecheat'; focus?: GameCheatFocus }
  | { name: 'tools' }
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
    | 'drama'
    | 'shuangkan'
    | 'comic'
    | 'novel'
    | 'emu'
    | 'game'
    | 'book'
    | 'live'
    | 'liveRooms'
    | 'singing'
    | 'music'
    | 'melon'
    | 'news'
    | 'magnet'
    | 'sysinfo'
    | 'wallpaper'
    | 'meitu'
    | 'gamecheat'
    | 'tools'
    | 'settings'
  label: string
  icon: LucideIcon
  ready: boolean
}

/** 点顶部「老郑分享」进入主页，主页暂为空白页 */
const HOME_NAV_ITEM: NavItem = { key: 'home', label: '主页', icon: Home, ready: true }

/** 老郑分享：资讯 → 清单 → 影视 → 短剧 → 电视 → 直播 → 音乐 → 漫画 → 小说 → 图书 → 模拟 → 游戏 → 补丁 → 软件 → 硬件 → 磁力 → 壁纸 → 美图 → 吃瓜 → 皇片 */
const NAV_ITEMS: NavItem[] = [
  { key: 'news', label: '资讯', icon: Newspaper, ready: true },
  { key: 'lists', label: '清单', icon: ListChecks, ready: true },
  { key: 'watch', label: '影视', icon: MonitorPlay, ready: true },
  { key: 'drama', label: '短剧', icon: Clapperboard, ready: true },
  { key: 'live', label: '电视', icon: Tv, ready: true },
  { key: 'liveRooms', label: '直播', icon: Radio, ready: true },
  { key: 'singing', label: '演唱', icon: MicVocal, ready: true },
  { key: 'music', label: '音乐', icon: Music, ready: true },
  { key: 'comic', label: '漫画', icon: Images, ready: true },
  { key: 'novel', label: '小说', icon: BookText, ready: true },
  { key: 'book', label: '图书', icon: BookOpen, ready: true },
  { key: 'emu', label: '模拟', icon: Gamepad, ready: true },
  { key: 'game', label: '游戏', icon: Gamepad2, ready: true },
  { key: 'gamecheat', label: '补丁', icon: Wand2, ready: true },
  { key: 'tools', label: '软件', icon: Wrench, ready: true },
  { key: 'sysinfo', label: '硬件', icon: MonitorCog, ready: true },
  { key: 'magnet', label: '磁力', icon: Magnet, ready: true },
  { key: 'wallpaper', label: '壁纸', icon: Wallpaper, ready: true },
  { key: 'meitu', label: '套图', icon: Camera, ready: true },
  { key: 'melon', label: '吃瓜', icon: Popcorn, ready: true },
  { key: 'shuangkan', label: '皇片', icon: PlayCircle, ready: true }
]

/** 设置固定在导航底部 */
const SETTINGS_NAV_ITEM: NavItem = { key: 'settings', label: '设置', icon: Settings, ready: true }

/** 常驻挂载的模块 key（与下方 slot 一一对应）；清单详情 / 收藏 / 下载不在其中 */
const KEEP_ALIVE_KEYS = new Set<string>([
  'home',
  ...NAV_ITEMS.map((item) => item.key),
  'settings'
])

function leafRoute(key: NavItem['key']): Route {
  switch (key) {
    case 'home':
      return { name: 'home' }
    case 'lists':
      return { name: 'lists' }
    case 'watch':
      return { name: 'watch' }
    case 'drama':
      return { name: 'drama' }
    case 'shuangkan':
      return { name: 'shuangkan' }
    case 'comic':
      return { name: 'comic' }
    case 'novel':
      return { name: 'novel' }
    case 'game':
      return { name: 'game' }
    case 'emu':
      return { name: 'emu' }
    case 'book':
      return { name: 'book' }
    case 'live':
      return { name: 'live' }
    case 'liveRooms':
      return { name: 'liveRooms' }
    case 'singing':
      return { name: 'singing' }
    case 'music':
      return { name: 'music' }
    case 'melon':
      return { name: 'melon' }
    case 'news':
      return { name: 'news' }
    case 'magnet':
      return { name: 'magnet' }
    case 'sysinfo':
      return { name: 'sysinfo' }
    case 'wallpaper':
      return { name: 'wallpaper' }
    case 'meitu':
      return { name: 'meitu' }
    case 'gamecheat':
      return { name: 'gamecheat' }
    case 'tools':
      return { name: 'tools' }
    case 'settings':
      return { name: 'settings' }
  }
}

/** 路由 → 常驻页面 key（模块页切走后不卸载，搜索继续跑、列表不重载） */
function routeKey(route: Route): string {
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
  // 观影页只保留收藏入口，下载入口按用户要求移除
  watch: { fav: 'watch' },
  drama: { fav: 'drama', download: 'video' },
  shuangkan: { fav: 'shuangkan', download: 'video' },
  live: { fav: 'tv' },
  liveRooms: { fav: 'live' },
  singing: { fav: 'singing' },
  music: { fav: 'music', download: 'music' },
  emu: { fav: 'emu' },
  game: { fav: 'game' },
  melon: { fav: 'melon', download: 'video' },
  news: { fav: 'news' },
  book: { fav: 'book', download: 'book' },
  comic: { fav: 'comic', download: 'comic' },
  novel: { fav: 'novel', download: 'novel' },
  gamecheat: { fav: 'trainer', download: 'trainer' },
  wallpaper: { fav: 'wallpaper', download: 'wallpaper' },
  meitu: { fav: 'meitu', download: 'meitu' }
}

/** 点标题回到默认页时要清掉的模块本地缓存前缀 */
const MODULE_CACHE_PREFIXES: Record<string, string[]> = {
  watch: ['watch_'],
  drama: ['drama'],
  shuangkan: ['shuangkan'],
  comic: ['comic'],
  novel: ['novel'],
  melon: ['melon'],
  news: ['news'],
  game: ['game'],
  emu: ['emu'],
  book: ['book'],
  wallpaper: ['wallpaper'],
  meitu: ['meitu'],
  psite: ['psite'],
  xsite: ['xsite'],
  search: ['search'],
  gamecheat: ['cheat'],
  music: ['music'],
  live: ['live'],
  liveRooms: ['liveRooms']
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
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return {}
    const parsed = value as FavPayload
    return {
      sourceId: typeof parsed.sourceId === 'string' ? parsed.sourceId : undefined,
      vodId: typeof parsed.vodId === 'number' ? parsed.vodId : undefined,
      groupName: typeof parsed.groupName === 'string' ? parsed.groupName : undefined
    }
  } catch {
    return {}
  }
}

interface LiveFavPayload {
  platform?: LivePlatformId
  roomId?: string
  title?: string
  anchor?: string
  cover?: string
}

function parseLiveFavPayload(raw: string | null): LiveFavPayload {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return {}
    const parsed = value as LiveFavPayload
    return {
      platform:
        parsed.platform === 'bilibili' || parsed.platform === 'douyu' || parsed.platform === 'douyin'
          ? parsed.platform
          : undefined,
      roomId: typeof parsed.roomId === 'string' ? parsed.roomId : undefined,
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      anchor: typeof parsed.anchor === 'string' ? parsed.anchor : undefined,
      cover: typeof parsed.cover === 'string' ? parsed.cover : undefined
    }
  } catch {
    return {}
  }
}

interface DramaFavPayload {
  sourceId?: string
  sourceName?: string
  baseUrl?: string
  seriesId?: string
}

function parseDramaPayload(raw: string | null): DramaFavPayload {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return {}
    const parsed = value as DramaFavPayload
    return {
      sourceId: typeof parsed.sourceId === 'string' ? parsed.sourceId : undefined,
      sourceName: typeof parsed.sourceName === 'string' ? parsed.sourceName : undefined,
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : undefined,
      seriesId: typeof parsed.seriesId === 'string' ? parsed.seriesId : undefined
    }
  } catch {
    return {}
  }
}

interface NovelFavPayload {
  sourceId?: string
  bookId?: string
}

function parseNovelPayload(raw: string | null): NovelFavPayload {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return {}
    const parsed = value as NovelFavPayload
    return {
      sourceId: typeof parsed.sourceId === 'string' ? parsed.sourceId : undefined,
      bookId: typeof parsed.bookId === 'string' ? parsed.bookId : undefined
    }
  } catch {
    return {}
  }
}

interface ShuangkanFavPayload {
  sourceId?: string
  sourceName?: string
  baseUrl?: string
  content?: string
  id?: string
  title?: string
}

function parseShuangkanPayload(raw: string | null): ShuangkanFavPayload {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return {}
    const parsed = value as ShuangkanFavPayload
    return {
      sourceId: typeof parsed.sourceId === 'string' ? parsed.sourceId : undefined,
      sourceName: typeof parsed.sourceName === 'string' ? parsed.sourceName : undefined,
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : undefined,
      content: typeof parsed.content === 'string' ? parsed.content : undefined,
      id: typeof parsed.id === 'string' ? parsed.id : undefined,
      title: typeof parsed.title === 'string' ? parsed.title : undefined
    }
  } catch {
    return {}
  }
}

interface TrainerFavPayload {
  url?: string
  sourceId?: string
  version?: string
}

function parseTrainerPayload(raw: string | null): TrainerFavPayload {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return {}
    const parsed = value as TrainerFavPayload
    return {
      url: typeof parsed.url === 'string' ? parsed.url : undefined,
      sourceId: typeof parsed.sourceId === 'string' ? parsed.sourceId : undefined,
      version: typeof parsed.version === 'string' ? parsed.version : undefined
    }
  } catch {
    return {}
  }
}

function Shell() {
  const { ready, data, update } = useData()
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }])
  const [notice, setNotice] = useState<string | null>(null)
  /** 启动时检查到的新版本：用应用内更新弹窗展示，确认后才下载 */
  const [startupUpdate, setStartupUpdate] = useState<UpdateCheckResult | null>(null)
  const [visited, setVisited] = useState<string[]>(['home'])
  const [navEpoch, setNavEpoch] = useState<Record<string, number>>({})
  /** 点页面标题时递增，用于让需要强制重取数据的页面（如电脑信息）区分普通进入与刷新 */
  const [refreshEpoch, setRefreshEpoch] = useState<Record<string, number>>({})
  /** 导入备份 / 云恢复后递增：常驻挂载的模块页需要整页重挂载，避免继续用旧源数据 */
  const [dataEpoch, setDataEpoch] = useState(0)
  /** 开发者模式：本次客户端运行期间有效，解锁演唱管理与软件经验编辑 */
  const [developerMode, setDeveloperMode] = useState(false)
  const contentRef = useRef<HTMLElement | null>(null)
  /** 返回上一页时恢复各页面离开前的滚动位置 */
  const scrollMemoryRef = useRef<Record<string, number>>({})
  const restoreScrollRef = useRef(false)
  const route = stack[stack.length - 1]

  const activeNav =
    route.name === 'list'
      ? 'lists'
      : route.name === 'favorites' || route.name === 'downloads'
        ? ''
        : route.name

  const activeKey = routeKey(route)

  /** 统一的「上一页」：永远回到进入当前页面前的页面，不越级 */
  const pushRoute = (next: Route) =>
    setStack((prev) => {
      restoreScrollRef.current = false
      const el = contentRef.current
      if (el) scrollMemoryRef.current[activeKey] = el.scrollTop
      const top = prev[prev.length - 1]
      // 同一张壁纸的详情不重复入栈（双击收藏卡片时只算一次进入）
      if (
        next.name === 'wallpaper' &&
        top.name === 'wallpaper' &&
        next.focus?.item.source === top.focus?.item.source &&
        next.focus?.item.id === top.focus?.item.id
      ) {
        return prev
      }
      return [...prev, next]
    })
  const backRoute = () => {
    if (stack.length <= 1) return
    const el = contentRef.current
    if (el) scrollMemoryRef.current[activeKey] = el.scrollTop
    restoreScrollRef.current = true
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
  }

  /** 当前路由的页面必须立刻出现，不能等 effect 补 visited（否则会闪一帧空白） */
  const shownKeys = visited.includes(activeKey) ? visited : [...visited, activeKey]

  // 吸顶页头静止时完全透明；只在内容滚动后加模糊 / 淡底，避免顶部与正文出现色差
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const update = (): void => {
      el.dataset.scrolled = el.scrollTop > 6 ? 'true' : 'false'
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => el.removeEventListener('scroll', update)
  }, [ready])

  useEffect(() => {
    void syncUiSettings()
  }, [])

  // 导入 / 云恢复替换了数据：所有常驻挂载的模块页重新挂载，重新按新源加载
  useEffect(() => {
    const onDataReplaced = (): void => setDataEpoch((value) => value + 1)
    window.addEventListener('laozheng:data-replaced', onDataReplaced)
    return () => window.removeEventListener('laozheng:data-replaced', onDataReplaced)
  }, [])

  // 数据落盘失败（磁盘满 / 文件被杀软或网盘占用）时明确提示，避免修改静默丢失
  useEffect(() => {
    const onSaveError = (event: Event): void => {
      const detail = (event as CustomEvent<string>).detail
      setNotice(detail || '数据保存失败，请检查磁盘空间或杀毒软件是否占用数据文件')
    }
    window.addEventListener('laozheng:save-error', onSaveError)
    return () => window.removeEventListener('laozheng:save-error', onSaveError)
  }, [])

  useEffect(() => {
    // 有限 KeepAlive：最多保留最近 6 个模块页，避免浏览越多 DOM / 内存越涨；
    // 列表状态由各模块已有缓存恢复，滚动位置保存在 scrollMemoryRef。
    // 清单详情 / 收藏 / 下载是路由页（不常驻挂载），不占 KeepAlive 名额。
    if (!KEEP_ALIVE_KEYS.has(activeKey)) return
    setVisited((prev) => {
      const withoutActive = prev.filter((key) => key !== activeKey)
      const next = [...withoutActive, activeKey]
      if (next.length <= 6) return next
      // 主页固定保留一个名额：其余模块按最近访问轮换，避免浏览几个模块后主页被卸载
      const rest = next.filter((key) => key !== 'home')
      return ['home', ...rest.slice(rest.length - 5)]
    })
  }, [activeKey])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const el = contentRef.current
      if (!el) return
      if (restoreScrollRef.current) {
        restoreScrollRef.current = false
        el.scrollTop = scrollMemoryRef.current[activeKey] ?? 0
      } else {
        el.scrollTop = 0
      }
      // 通知页面滚动已恢复：模块内的详情返回记忆需要以这个最终位置为准，
      // 浏览器有时不会为程序化滚动派发 scroll 事件
      window.dispatchEvent(
        new CustomEvent('laozheng:page-scroll-restored', {
          detail: { key: activeKey, top: el.scrollTop }
        })
      )
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

  /** 启动时的更新提示：先订阅推送，再主动取一次，避免渲染层挂载晚于检查结果 */
  useEffect(() => {
    let alive = true
    const off = window.laozheng.onUpdateAvailable((info) => {
      if (alive && info?.hasUpdate) setStartupUpdate(info)
    })
    void window.laozheng
      .pendingUpdate()
      .then((info) => {
        if (alive && info?.hasUpdate) setStartupUpdate(info)
      })
      .catch(() => undefined)
    return () => {
      alive = false
      off()
    }
  }, [])

  if (!ready) {
    return (
      <div className="app">
        <div className="app-titlebar" />
        <main className="content">
          <EmptyState title="正在加载本地数据…" />
        </main>
      </div>
    )
  }

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
      case 'comic':
        pushRoute({ name: 'comic', focusId: fav.id })
        return
      case 'novel': {
        const payload = parseNovelPayload(fav.payload)
        const [idSource, ...rest] = fav.id.split('|')
        const sourceId = payload.sourceId ?? idSource
        const bookId = payload.bookId ?? rest.join('|')
        if (!sourceId || !bookId) {
          setNotice(`「${fav.title}」缺少书籍信息，无法直接打开。`)
          return
        }
        pushRoute({ name: 'novel', focus: { sourceId, bookId, title: fav.title } })
        return
      }
      case 'game':
        pushRoute({ name: 'game', focusId: fav.id })
        return
      case 'singing':
        pushRoute({ name: 'singing', focusId: fav.id })
        return
      case 'emu':
        pushRoute({ name: 'emu', focusId: fav.id })
        return
      case 'book':
        pushRoute({ name: 'book', focusId: fav.id })
        return
      case 'melon':
        pushRoute({ name: 'melon', focusId: fav.id })
        return
      case 'wallpaper': {
        const [idSource, ...rest] = fav.id.split('|')
        // 哲风壁纸已下线：旧收藏给出明确提示，不再尝试打开
        if (idSource === 'haowall') {
          setNotice(`「${fav.title}」来自已下线的哲风壁纸，无法直接打开。`)
          return
        }
        const payload = parseWallpaperFavPayload(fav.payload)
        const source =
          payload?.source ?? (isWallpaperSourceId(idSource) ? idSource : null)
        const itemId = rest.join('|')
        const pageUrl = payload?.pageUrl ?? ''
        if (!source || !pageUrl) {
          setNotice(`「${fav.title}」缺少壁纸信息，无法直接打开。`)
          return
        }
        const sourceConfig = data.wallpaperSources.find((entry) => entry.id === source)
        if (!sourceConfig) {
          setNotice(`「${fav.title}」的壁纸源已删除，无法直接打开。`)
          return
        }
        if (!sourceConfig.enabled) {
          setNotice(`「${fav.title}」的壁纸源已停用，请在片源管理里启用。`)
          return
        }
        const item: WallpaperItem = {
          source,
          id: itemId,
          title: fav.title,
          thumb: payload?.thumb || fav.cover || '',
          pageUrl,
          width: payload?.width ?? 0,
          height: payload?.height ?? 0,
          fullUrl: payload?.fullUrl ?? null,
          previewUrl: payload?.previewUrl ?? null,
          sizeText: payload?.sizeText ?? '',
          tags: payload?.tags ?? []
        }
        pushRoute({ name: 'wallpaper', focus: { item, at: Date.now() } })
        return
      }
      case 'meitu': {
        const payload = parseMeituFavPayload(fav.payload)
        const parsed = parseMeituFavId(fav.id)
        const source = payload?.source ?? parsed.source
        if (!source || !payload) {
          setNotice(`「${fav.title}」缺少套图信息，无法直接打开。`)
          return
        }
        const sourceConfig = data.meituSources.find((entry) => entry.id === source)
        if (!sourceConfig) {
          setNotice(`「${fav.title}」的套图源已删除，无法直接打开。`)
          return
        }
        if (!sourceConfig.enabled) {
          setNotice(`「${fav.title}」的套图源已停用，请在片源管理里启用。`)
          return
        }
        pushRoute({
          name: 'meitu',
          focus: {
            album: {
              source,
              id: parsed.albumId || payload.title,
              title: fav.title,
              cover: payload.cover || fav.cover || '',
              pageUrl: payload.pageUrl,
              imageCount: payload.imageCount,
              tags: payload.tags,
              timeText: ''
            },
            at: Date.now()
          }
        })
        return
      }
      case 'trainer': {
        const payload = parseTrainerPayload(fav.payload)
        const url = payload.url ?? fav.videoUrl ?? ''
        if (!url) {
          setNotice(`「${fav.title}」缺少修改器链接，无法直接打开。`)
          return
        }
        pushRoute({
          name: 'gamecheat',
          focus: {
            url,
            sourceId: payload.sourceId ?? '',
            title: fav.title,
            cover: fav.cover,
            version: payload.version
          }
        })
        return
      }
      case 'music':
        pushRoute({ name: 'music', focus })
        return
      case 'tv':
        pushRoute({ name: 'live', focusUrl: fav.videoUrl ?? fav.id })
        return
      case 'live': {
        const payload = parseLiveFavPayload(fav.payload)
        const [idPlatform, idRoom] = fav.id.split(':')
        const platform =
          payload.platform ??
          (idPlatform === 'bilibili' || idPlatform === 'douyu' || idPlatform === 'douyin'
            ? idPlatform
            : undefined)
        const roomId = payload.roomId ?? idRoom
        if (!platform || !roomId) {
          setNotice(`「${fav.title}」缺少直播间信息，无法直接打开。`)
          return
        }
        pushRoute({
          name: 'liveRooms',
          focus: {
            platform,
            roomId,
            title: payload.title ?? fav.title,
            anchor: payload.anchor,
            cover: payload.cover ?? fav.cover ?? undefined,
            at: Date.now()
          }
        })
        return
      }
      case 'shuangkan': {
        const payload = parseShuangkanPayload(fav.payload)
        // 收藏 id 形如「源 id|内容库|条目 id」，旧收藏没有 payload 时用它兜底
        const [idSource, idContent, ...rest] = fav.id.split('|')
        const sourceId = payload.sourceId ?? idSource
        const content: SkContent =
          (payload.content ?? idContent) === 'series' ? 'series' : 'video'
        const itemId = payload.id ?? rest.join('|')
        if (!sourceId || !itemId) {
          setNotice(`「${fav.title}」缺少皇片信息，无法直接打开。`)
          return
        }
        pushRoute({
          name: 'shuangkan',
          focus: {
            sourceId,
            sourceName: payload.sourceName,
            baseUrl: payload.baseUrl,
            content,
            id: itemId,
            title: payload.title ?? fav.title,
            at: Date.now()
          }
        })
        return
      }
      case 'drama': {
        const payload = parseDramaPayload(fav.payload)
        // 收藏 id 形如「源 id|剧集 id」，旧收藏没有 payload 时用它兜底
        const [idSource, ...rest] = fav.id.split('|')
        const sourceId = payload.sourceId ?? idSource
        const seriesId = payload.seriesId ?? rest.join('|')
        if (!sourceId || !seriesId) {
          setNotice(`「${fav.title}」缺少短剧信息，无法直接打开。`)
          return
        }
        pushRoute({
          name: 'drama',
          focus: {
            sourceId,
            sourceName: payload.sourceName,
            baseUrl: payload.baseUrl,
            seriesId,
            title: fav.title
          }
        })
        return
      }
      case 'watch': {
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
        pushRoute({ name: 'watch', focus: watchFocus })
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

  /** 清单条目「下载」：带着片名跳到磁力页并自动搜索 */
  const openMagnetSearch = (title: string) => {
    pushRoute({ name: 'magnet', searchTitle: title })
  }

  const openNav = (item: NavItem) => {
    if (!item.ready) {
      setNotice(`「${item.label}」将在后续版本接入。`)
      return
    }
    // 点侧栏进入模块时直接回到该模块首页，不保留上次的详情 / 播放页
    restoreScrollRef.current = false
    setStack([leafRoute(item.key)])
    setNavEpoch((prev) => ({ ...prev, [item.key]: (prev[item.key] ?? 0) + 1 }))
  }

  /** 点页面标题 = 刷新当前页：模块页回到模块首页并重新挂载（清空搜索 / 结果等初始态） */
  const refreshCurrent = () => {
    const isDetail =
      route.name === 'list' || route.name === 'favorites' || route.name === 'downloads'
    if (!isDetail && activeNav) {
      // 丢掉 focus / searchTitle 等入口参数，保留返回栈
      setStack((prev) => [...prev.slice(0, -1), leafRoute(activeNav as NavItem['key'])])
    }
    // 清掉当前模块的列表缓存并让接口缓存短时间失效，重新挂载后回到真正的默认页
    for (const prefix of MODULE_CACHE_PREFIXES[activeKey] ?? []) clearCachePrefix(prefix)
    void window.laozheng.forceRefresh(activeKey).catch(() => {})
    if (activeKey === 'magnet') {
      // 磁力搜索结果会写进 data，刷新时一并清掉，否则重新挂载又会恢复上次结果
      update((current) =>
        current.magnetSearch ? { ...current, magnetSearch: undefined } : current
      )
    }
    setNavEpoch((prev) => ({ ...prev, [activeKey]: (prev[activeKey] ?? 0) + 1 }))
    setRefreshEpoch((prev) => ({ ...prev, [activeKey]: (prev[activeKey] ?? 0) + 1 }))
    contentRef.current?.scrollTo({ top: 0 })
  }

  const onContentClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('h1.page-title')) refreshCurrent()
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
    // 点标题刷新时换 key，整页重新挂载，回到初始状态（搜索、结果、弹层等全部清空）
    key: `${key}:${refreshEpoch[key] ?? 0}:${dataEpoch}`,
    style: { display: (activeKey === key ? 'block' : 'none') as 'block' | 'none' },
    'data-page-slot': key
  })

  const shortcuts = (key: string) => ({
    onOpenFavorites: MODULE_SHORTCUTS[key]?.fav ? () => openShortcut(key, 'fav') : undefined,
    onOpenDownloads: MODULE_SHORTCUTS[key]?.download
      ? () => openShortcut(key, 'download')
      : undefined
  })

  const navButton = (item: NavItem) => {
    const Icon = item.icon
    const active = activeNav === item.key
    return (
      <button
        key={item.key}
        className={`nav-item ${active ? 'active' : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => openNav(item)}
      >
        <Icon size={17} strokeWidth={1.9} />
        {item.label}
      </button>
    )
  }

  const orderedItems = NAV_ITEMS

  return (
    <div className="app">
      <div className="app-titlebar" />
      <aside className="sidebar">
        <button
          className="sidebar-brand"
          onClick={() => openNav(HOME_NAV_ITEM)}
          title="回到主页"
          aria-label="老郑分享，点击回到主页"
        >
          <span className="brand-mark">郑</span>
          <span className="brand-title">老郑分享</span>
        </button>

        <nav className="nav">{orderedItems.map((item) => navButton(item))}</nav>

        <div className="sidebar-divider" />
        {navButton(SETTINGS_NAV_ITEM)}
      </aside>

      <main className="content" ref={contentRef} onClick={onContentClick}>
        {shownKeys.includes('home') ? (
          <div {...slot('home')}>
            <HomePage
              onOpenFav={openFav}
              onOpenFavorites={() => pushRoute({ name: 'favorites' })}
              onOpenList={(id) => pushRoute({ name: 'list', id })}
              onNotice={setNotice}
            />
          </div>
        ) : null}

        {shownKeys.includes('lists') ? (
          <div {...slot('lists')}>
            <ListsPage
              onOpenList={(id) => pushRoute({ name: 'list', id })}
              onNotice={setNotice}
              resetSignal={navEpoch.lists}
              onWatch={openWatchSearch}
              onMagnet={openMagnetSearch}
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

        {shownKeys.includes('shuangkan') ? (
          <div {...slot('shuangkan')}>
            <ShuangkanPage
              onNotice={setNotice}
              resetSignal={navEpoch.shuangkan}
              focus={route.name === 'shuangkan' ? route.focus : undefined}
              onExit={backRoute}
              {...shortcuts('shuangkan')}
            />
          </div>
        ) : null}

        {shownKeys.includes('drama') ? (
          <div {...slot('drama')}>
            <DramaPage
              onNotice={setNotice}
              resetSignal={navEpoch.drama}
              focus={route.name === 'drama' ? route.focus : undefined}
              onExit={backRoute}
              {...shortcuts('drama')}
            />
          </div>
        ) : null}

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

        {shownKeys.includes('liveRooms') ? (
          <div {...slot('liveRooms')}>
            <LiveRoomsPage
              onNotice={setNotice}
              resetSignal={navEpoch.liveRooms}
              focus={route.name === 'liveRooms' ? route.focus : undefined}
              onExit={backRoute}
              active={activeKey === 'liveRooms'}
              {...shortcuts('liveRooms')}
            />
          </div>
        ) : null}

        {shownKeys.includes('singing') ? (
          <div {...slot('singing')}>
            <SingingPage
              onNotice={setNotice}
              focusId={route.name === 'singing' ? route.focusId : undefined}
              resetSignal={navEpoch.singing}
              active={activeKey === 'singing'}
              onExit={backRoute}
              {...shortcuts('singing')}
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

        {shownKeys.includes('novel') ? (
          <div {...slot('novel')}>
            <NovelPage
              onNotice={setNotice}
              focus={route.name === 'novel' ? route.focus : undefined}
              resetSignal={navEpoch.novel}
              onExit={backRoute}
              {...shortcuts('novel')}
            />
          </div>
        ) : null}

        {shownKeys.includes('news') ? (
          <div {...slot('news')}>
            <NewsPage
              onNotice={setNotice}
              resetSignal={navEpoch.news}
              {...shortcuts('news')}
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

        {shownKeys.includes('magnet') ? (
          <div {...slot('magnet')}>
            <MagnetPage
              onNotice={setNotice}
              searchTitle={route.name === 'magnet' ? route.searchTitle : undefined}
              resetSignal={navEpoch.magnet}
            />
          </div>
        ) : null}

        {shownKeys.includes('emu') ? (
          <div {...slot('emu')}>
            <EmuPage
              onNotice={setNotice}
              focusId={route.name === 'emu' ? route.focusId : undefined}
              resetSignal={navEpoch.emu}
              {...shortcuts('emu')}
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

        {shownKeys.includes('sysinfo') ? (
          <div {...slot('sysinfo')}>
            <SysInfoPage
              onNotice={setNotice}
              resetSignal={navEpoch.sysinfo}
              forceSignal={refreshEpoch.sysinfo}
            />
          </div>
        ) : null}

        {shownKeys.includes('wallpaper') ? (
          <div {...slot('wallpaper')}>
            <WallpaperPage
              onNotice={setNotice}
              focus={route.name === 'wallpaper' ? route.focus : undefined}
              resetSignal={navEpoch.wallpaper}
              onExit={backRoute}
              {...shortcuts('wallpaper')}
            />
          </div>
        ) : null}

        {shownKeys.includes('meitu') ? (
          <div {...slot('meitu')}>
            <MeituPage
              onNotice={setNotice}
              focus={route.name === 'meitu' ? route.focus : undefined}
              resetSignal={navEpoch.meitu}
              onExit={backRoute}
              {...shortcuts('meitu')}
            />
          </div>
        ) : null}

        {shownKeys.includes('gamecheat') ? (
          <div {...slot('gamecheat')}>
            <GameCheatPage
              onNotice={setNotice}
              resetSignal={navEpoch.gamecheat}
              focus={route.name === 'gamecheat' ? route.focus : undefined}
              onExit={backRoute}
              {...shortcuts('gamecheat')}
            />
          </div>
        ) : null}

        {shownKeys.includes('tools') ? (
          <div {...slot('tools')}>
            <ToolsPage
              onNotice={setNotice}
              resetSignal={navEpoch.tools}
              developerMode={developerMode}
            />
          </div>
        ) : null}

        {shownKeys.includes('settings') ? (
          <div {...slot('settings')}>
            <SettingsPage
              onNotice={setNotice}
              resetSignal={navEpoch.settings}
              developerMode={developerMode}
              onEnterDeveloperMode={() => setDeveloperMode(true)}
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
            key={`${activeKey}:${refreshEpoch[activeKey] ?? 0}:${dataEpoch}`}
            listId={route.id}
            onBack={backRoute}
            onOpenList={(id) => pushRoute({ name: 'list', id })}
            onNotice={setNotice}
            onWatch={openWatchSearch}
            onMagnet={openMagnetSearch}
          />
        ) : null}

        {route.name === 'favorites' ? (
          <FavoritesPage
            key={`${activeKey}:${refreshEpoch[activeKey] ?? 0}:${dataEpoch}`}
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
            key={`${activeKey}:${refreshEpoch[activeKey] ?? 0}:${dataEpoch}`}
            onNotice={setNotice}
            onBack={backRoute}
            initialSection={route.section}
          />
        ) : null}
      </main>

      {/* 主页底部自带播放器，避免和全局播放条重复 */}
      {activeKey !== 'home' ? <MusicPlayerBar /> : null}
      <DownloadCenter
        onNotice={setNotice}
        onOpenDownloads={() => {
          if (route.name !== 'downloads') pushRoute({ name: 'downloads' })
        }}
      />
      <ImageViewer onNotice={setNotice} />
      <UpdateModal
        open={!!startupUpdate}
        info={startupUpdate}
        onClose={() => setStartupUpdate(null)}
        onNotice={setNotice}
      />
      {notice ? <div className="toast">{notice}</div> : null}
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary label="应用" fullPage>
      <DataProvider>
        <MusicPlayerProvider>
          <Shell />
        </MusicPlayerProvider>
      </DataProvider>
    </ErrorBoundary>
  )
}
