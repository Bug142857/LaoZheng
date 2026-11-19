import {
  BookOpen,
  BookText,
  Camera,
  Clapperboard,
  Gamepad,
  Gamepad2,
  ImageIcon,
  Images,
  MicVocal,
  MonitorPlay,
  Music,
  Newspaper,
  PlayCircle,
  Popcorn,
  Radio,
  Tv,
  Wand2,
  type LucideIcon
} from 'lucide-react'
import type { AppData, InnerFav } from '../shared/types'
import { livePlatformDefaultName, livePlatformOfSource } from '../shared/livePlatformSources'

/**
 * 收藏分类的公共定义：主页与收藏页共用。
 * 单独成文件，避免主页静态引用 FavoritesPage 导致收藏页无法按页分包。
 */

/** 收藏管理按模块整理（顺序与侧栏导航一致） */
export const FAV_MODULE_ORDER = [
  'news',
  'watch',
  'drama',
  'tv',
  'live',
  'singing',
  'music',
  'comic',
  'novel',
  'book',
  'emu',
  'game',
  'trainer',
  'wallpaper',
  'meitu',
  'melon',
  'shuangkan'
] as const

/** 已移除模块的旧收藏不再展示，但数据仍保留在备份里 */
export const HIDDEN_FAV_MODULES = new Set(['h2', 'h1', 'psite', 'xsite'])

export const FAV_MODULE_ICONS: Record<string, LucideIcon> = {
  news: Newspaper,
  watch: MonitorPlay,
  drama: Clapperboard,
  shuangkan: PlayCircle,
  music: Music,
  emu: Gamepad,
  game: Gamepad2,
  trainer: Wand2,
  tv: Tv,
  melon: Popcorn,
  novel: BookText,
  book: BookOpen,
  comic: Images,
  live: Radio,
  singing: MicVocal,
  wallpaper: ImageIcon,
  meitu: Camera
}

/** 平台直播收藏单独存在 data.liveFavorites，这里转换成统一收藏行 */
export function liveFavsFromData(
  data: Pick<AppData, 'liveFavorites' | 'livePlatformSources'>
): InnerFav[] {
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
}
