import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import {
  BookOpen,
  BookText,
  Camera,
  Clapperboard,
  Gamepad2,
  Images,
  ListChecks,
  Magnet,
  MonitorCog,
  MonitorPlay,
  Music,
  PlayCircle,
  Popcorn,
  Radio,
  Settings,
  Tv,
  Wallpaper,
  Wand2,
  type LucideIcon
} from 'lucide-react'
import { DataProvider, useData } from './state/DataContext'
import { WatchPage, type WatchFocus } from './pages/WatchPage'
import { DramaPage, type DramaFocus } from './pages/DramaPage'
import { LivePage } from './pages/LivePage'
import { LiveRoomsPage } from './pages/LiveRoomsPage'
import { MusicPage } from './pages/MusicPage'
import { DownloadsPage, type DownloadSection } from './pages/DownloadsPage'
import { ComicPage } from './pages/ComicPage'
import { NovelPage, type NovelFocus } from './pages/NovelPage'
import { GamePage } from './pages/GamePage'
import { BookPage } from './pages/BookPage'
import { MelonPage } from './pages/MelonPage'
import { ShuangkanPage } from './pages/ShuangkanPage'
import type { SkContent, ShuangkanFocus } from './shared/shuangkan'
import { MagnetPage } from './pages/MagnetPage'
import { ListsPage } from './pages/ListsPage'
import { ListDetailPage } from './pages/ListDetailPage'
import { FavoritesPage } from './pages/FavoritesPage'
import { SettingsPage } from './pages/SettingsPage'
import { SysInfoPage } from './pages/SysInfoPage'
import { WallpaperPage } from './pages/WallpaperPage'
import { MeituPage } from './pages/MeituPage'
import { GameCheatPage, type GameCheatFocus } from './pages/GameCheatPage'
import { EmptyState } from './components/ui'
import { ImageViewer } from './components/ImageViewer'
import { DownloadCenter } from './components/DownloadCenter'
import {
  MusicPlayerBar,
  MusicPlayerProvider
} from './components/MusicPlayer'
import { syncUiSettings } from './utils/theme'
import { clearCachePrefix } from './utils/cache'

import type { InnerFav } from './shared/types'
import type { LivePlatformId, LiveRoomFocus } from './shared/livePlatform'
import {
  isWallpaperSourceId,
  parseWallpaperFavPayload,
  type WallpaperFocus,
  type WallpaperItem
} from './shared/wallpaper'
import { parseMeituFavId, parseMeituFavPayload, type MeituFocus } from './shared/meitu'

type Route =
  | { name: 'watch'; focus?: WatchFocus; searchTitle?: string }
  | { name: 'drama'; focus?: DramaFocus }
  | { name: 'live'; focusUrl?: string }
  | { name: 'liveRooms'; focus?: LiveRoomFocus }
  | { name: 'music'; focus?: FavFocus }
  | { name: 'comic'; focusId?: string }
  | { name: 'novel'; focus?: NovelFocus }
  | { name: 'melon'; focusId?: string }
  | { name: 'shuangkan'; focus?: ShuangkanFocus }
  | { name: 'book'; focusId?: string }
  | { name: 'game'; focusId?: string }
  | { name: 'magnet'; searchTitle?: string }
  | { name: 'lists' }
  | { name: 'list'; id: number }
  | { name: 'favorites'; moduleKey?: string; direct?: boolean }
  | { name: 'downloads'; section?: DownloadSection }
  | { name: 'sysinfo' }
  | { name: 'wallpaper'; focus?: WallpaperFocus }
  | { name: 'meitu'; focus?: MeituFocus }
  | { name: 'gamecheat'; focus?: GameCheatFocus }
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
    | 'lists'
    | 'watch'
    | 'drama'
    | 'shuangkan'
    | 'comic'
    | 'novel'
    | 'game'
    | 'book'
    | 'live'
    | 'liveRooms'
    | 'music'
    | 'melon'
    | 'magnet'
    | 'sysinfo'
    | 'wallpaper'
    | 'meitu'
    | 'gamecheat'
    | 'settings'
  label: string
  icon: LucideIcon
  ready: boolean
}

/** 首页「硬件」不放在导航里，点顶部「老郑分享」进入 */
const HOME_NAV_ITEM: NavItem = { key: 'sysinfo', label: '硬件', icon: MonitorCog, ready: true }

/** 老郑分享：清单 → 影视 → 短剧 → 电视 → 直播 → 音乐 → 漫画 → 小说 → 图书 → 游戏 → 补丁 → 磁力 → 壁纸 → 美图 → 吃瓜 → 皇片 */
const NAV_ITEMS: NavItem[] = [
  { key: 'lists', label: '清单', icon: ListChecks, ready: true },
  { key: 'watch', label: '影视', icon: MonitorPlay, ready: true },
  { key: 'drama', label: '短剧', icon: Clapperboard, ready: true },
  { key: 'live', label: '电视', icon: Tv, ready: true },
  { key: 'liveRooms', label: '直播', icon: Radio, ready: true },
  { key: 'music', label: '音乐', icon: Music, ready: true },
  { key: 'comic', label: '漫画', icon: Images, ready: true },
  { key: 'novel', label: '小说', icon: BookText, ready: true },
  { key: 'book', label: '图书', icon: BookOpen, ready: true },
  { key: 'game', label: '游戏', icon: Gamepad2, ready: true },
  { key: 'gamecheat', label: '补丁', icon: Wand2, ready: true },
  { key: 'magnet', label: '磁力', icon: Magnet, ready: true },
  { key: 'wallpaper', label: '壁纸', icon: Wallpaper, ready: true },
  { key: 'meitu', label: '套图', icon: Camera, ready: true },
  { key: 'melon', label: '吃瓜', icon: Popcorn, ready: true },
  { key: 'shuangkan', label: '皇片', icon: PlayCircle, ready: true }
]

/** 设置固定在导航底部 */
const SETTINGS_NAV_ITEM: NavItem = { key: 'settings', label: '设置', icon: Settings, ready: true }

/**
 * 按保存的顺序排列导航项。
 * 新版本新增的模块不在旧顺序里时，插到默认顺序里它前一个模块的后面
 * （否则新模块会被排到最底部，例如「小说」应固定在「磁力」下面）。
 */
function orderedNavItems(items: NavItem[], order?: string[]): NavItem[] {
  if (!order?.length) return items
  const known = new Set<string>(items.map((item) => item.key))
  const keys = order.filter((key) => known.has(key))
  const seen = new Set(keys)
  for (const item of items) {
    if (seen.has(item.key)) continue
    const defaultIndex = items.findIndex((entry) => entry.key === item.key)
    let insertAt = 0
    for (let i = defaultIndex - 1; i >= 0; i -= 1) {
      const index = keys.indexOf(items[i].key)
      if (index >= 0) {
        insertAt = index + 1
        break
      }
    }
    keys.splice(insertAt, 0, item.key)
    seen.add(item.key)
  }
  return keys
    .map((key) => items.find((item) => item.key === key))
    .filter((item): item is NavItem => !!item)
}

function leafRoute(key: NavItem['key']): Route {
  switch (key) {
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
    case 'book':
      return { name: 'book' }
    case 'live':
      return { name: 'live' }
    case 'liveRooms':
      return { name: 'liveRooms' }
    case 'music':
      return { name: 'music' }
    case 'melon':
      return { name: 'melon' }
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
  music: { fav: 'music', download: 'music' },
  game: { fav: 'game' },
  melon: { fav: 'melon', download: 'video' },
  book: { fav: 'book', download: 'book' },
  comic: { fav: 'comic', download: 'comic' },
  novel: { fav: 'novel', download: 'novel' },
  gamecheat: { fav: 'trainer', download: 'trainer' },
  wallpaper: { fav: 'wallpaper', download: 'wallpaper' },
  meitu: { fav: 'meitu', download: 'meitu' }
}

/** 点标题回到默认页时要清掉的模块本地缓存前缀 */
const MODULE_CACHE_PREFIXES: Record<string, string[]> = {
  watch: ['h1_', 'watch_'],
  drama: ['drama'],
  shuangkan: ['shuangkan'],
  comic: ['comic'],
  novel: ['novel'],
  melon: ['melon'],
  game: ['game'],
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
  const [stack, setStack] = useState<Route[]>([{ name: 'sysinfo' }])
  const [notice, setNotice] = useState<string | null>(null)
  const [visited, setVisited] = useState<string[]>(['sysinfo'])
  const [navEpoch, setNavEpoch] = useState<Record<string, number>>({})
  /** 点页面标题时递增，用于让需要强制重取数据的页面（如电脑信息）区分普通进入与刷新 */
  const [refreshEpoch, setRefreshEpoch] = useState<Record<string, number>>({})
  /** 导入备份 / 云恢复后递增：常驻挂载的模块页需要整页重挂载，避免继续用旧源数据 */
  const [dataEpoch, setDataEpoch] = useState(0)
  /** 导航项拖动排序（存进本机设置，随备份 / 云同步走） */
  const [navOrder, setNavOrder] = useState<Record<string, string[]>>({})
  const navOrderRef = useRef<Record<string, string[]>>({})
  const [draggingNav, setDraggingNav] = useState<string | null>(null)
  const contentRef = useRef<HTMLElement | null>(null)
  const route = stack[stack.length - 1]

  const activeNav =
    route.name === 'list'
      ? 'lists'
      : route.name === 'favorites' || route.name === 'downloads'
        ? ''
        : route.name

  /** 统一的「上一页」：永远回到进入当前页面前的页面，不越级 */
  const pushRoute = (next: Route) =>
    setStack((prev) => {
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
  const backRoute = () => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))

  const activeKey = routeKey(route)
  /** 当前路由的页面必须立刻出现，不能等 effect 补 visited（否则会闪一帧空白） */
  const shownKeys = visited.includes(activeKey) ? visited : [...visited, activeKey]

  useEffect(() => {
    void syncUiSettings()
  }, [])

  /** 读取上次拖好的导航顺序；读不到就用代码里的默认顺序 */
  useEffect(() => {
    let alive = true
    window.laozheng
      .getNavOrder()
      .then((order) => {
        if (!alive) return
        navOrderRef.current = order
        setNavOrder(order)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  /** 导入备份 / 云恢复后，主进程写回了新的导航顺序：立即刷新侧栏，不必等重启 */
  useEffect(() => {
    const onNavOrder = (event: Event): void => {
      const order = (event as CustomEvent<Record<string, string[]>>).detail
      if (!order || typeof order !== 'object') return
      navOrderRef.current = order
      setNavOrder(order)
    }
    window.addEventListener('laozheng:nav-order', onNavOrder)
    return () => window.removeEventListener('laozheng:nav-order', onNavOrder)
  }, [])

  // 导入 / 云恢复替换了数据：所有常驻挂载的模块页重新挂载，重新按新源加载
  useEffect(() => {
    const onDataReplaced = (): void => setDataEpoch((value) => value + 1)
    window.addEventListener('laozheng:data-replaced', onDataReplaced)
    return () => window.removeEventListener('laozheng:data-replaced', onDataReplaced)
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
    setStack([leafRoute(item.key)])
    setNavEpoch((prev) => ({ ...prev, [item.key]: (prev[item.key] ?? 0) + 1 }))
  }

  /** 拖动导航项即时换位；松手时才写回本机设置 */
  const moveNavItem = (fromKey: string, toKey: string) => {
    if (!fromKey || fromKey === toKey) return
    const keys = orderedNavItems(NAV_ITEMS, navOrderRef.current.share).map((item) => item.key)
    const from = keys.indexOf(fromKey as NavItem['key'])
    const to = keys.indexOf(toKey as NavItem['key'])
    if (from < 0 || to < 0) return
    keys.splice(to, 0, keys.splice(from, 1)[0])
    const next = { ...navOrderRef.current, share: keys }
    navOrderRef.current = next
    setNavOrder(next)
  }

  const persistNavOrder = () => {
    setDraggingNav(null)
    void window.laozheng.setNavOrder(navOrderRef.current).catch(() => {})
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

  const navButton = (item: NavItem, draggable = false) => {
    const Icon = item.icon
    const active = activeNav === item.key
    const dragProps = draggable
      ? {
          draggable: true,
          onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => {
            setDraggingNav(item.key)
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', item.key)
          },
          onDragOver: (event: ReactDragEvent<HTMLButtonElement>) => {
            if (!draggingNav) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            // 只有越过目标项中点才换位，避免元素互换后指针仍在原位置来回抖动
            const fromIndex = orderedItems.findIndex((entry) => entry.key === draggingNav)
            const toIndex = orderedItems.findIndex((entry) => entry.key === item.key)
            if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
            const rect = event.currentTarget.getBoundingClientRect()
            const belowMiddle = event.clientY > rect.top + rect.height / 2
            if (fromIndex < toIndex && !belowMiddle) return
            if (fromIndex > toIndex && belowMiddle) return
            moveNavItem(draggingNav, item.key)
          },
          onDrop: (event: ReactDragEvent<HTMLButtonElement>) => {
            event.preventDefault()
          },
          onDragEnd: persistNavOrder
        }
      : {}
    return (
      <button
        key={item.key}
        className={`nav-item ${active ? 'active' : ''} ${
          draggingNav === item.key ? 'dragging' : ''
        }`}
        onClick={() => openNav(item)}
        {...dragProps}
      >
        <Icon size={17} strokeWidth={1.9} />
        {item.label}
      </button>
    )
  }

  const orderedItems = orderedNavItems(NAV_ITEMS, navOrder.share)

  return (
    <div className="app">
      <aside className="sidebar">
        <button
          className="sidebar-brand"
          onClick={() => openNav(HOME_NAV_ITEM)}
          title="回到硬件首页"
          aria-label="老郑分享，点击回到硬件首页"
        >
          <span className="brand-mark">郑</span>
          <span className="brand-title">老郑分享</span>
        </button>

        <nav className="nav">{orderedItems.map((item) => navButton(item, true))}</nav>

        <div className="sidebar-divider" />
        {navButton(SETTINGS_NAV_ITEM)}
      </aside>

      <main className="content" ref={contentRef} onClick={onContentClick}>
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
              {...shortcuts('liveRooms')}
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
