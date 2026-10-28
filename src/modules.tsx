import type { LucideIcon } from 'lucide-react'
import {
  BookHeart,
  BookOpen,
  Film,
  Gamepad2,
  Globe,
  Images,
  ListChecks,
  MonitorPlay,
  Music,
  PlayCircle,
  Popcorn,
  Tv
} from 'lucide-react'

export interface HomeModule {
  key: string
  title: string
  desc: string
  icon: LucideIcon
  /** 当前 PC 端是否已实现（未实现的点击后提示规划中） */
  ready: boolean
}

/** 与手机端 `INNER_MODULE_ENTRIES` 一一对应，后续按模块逐个补齐 */
export const HOME_MODULES: HomeModule[] = [
  { key: 'lists', title: '清单', desc: '搜索、分类与清单管理', icon: ListChecks, ready: true },
  { key: 'watch', title: '观影', desc: '跨片源在线搜索', icon: MonitorPlay, ready: false },
  { key: 'h1_1', title: '番1', desc: '番号片源 1', icon: Film, ready: false },
  { key: 'h1_2', title: '番2', desc: '番号片源 2', icon: Film, ready: false },
  { key: 'h1_3', title: '番3', desc: '番号片源 3', icon: Film, ready: false },
  { key: 'h1_4', title: '番4', desc: '番号片源 4', icon: Film, ready: false },
  { key: 'h2', title: '本子', desc: '哔咔漫画浏览与阅读', icon: BookHeart, ready: false },
  { key: 'comic', title: '漫画', desc: '漫画源分类与阅读', icon: Images, ready: false },
  { key: 'game', title: '游戏', desc: '豆瓣游戏收藏', icon: Gamepad2, ready: false },
  { key: 'book', title: '图书', desc: '豆瓣图书收藏', icon: BookOpen, ready: false },
  { key: 'tv', title: '电视', desc: 'M3U 直播源播放', icon: Tv, ready: false },
  { key: 'music', title: '音乐', desc: '多平台音乐搜索与播放', icon: Music, ready: false },
  { key: 'melon', title: '吃瓜', desc: '短视频与图集', icon: Popcorn, ready: false },
  { key: 'xsite', title: 'X站', desc: 'X 站视频浏览与播放', icon: Globe, ready: false },
  { key: 'psite', title: 'P站', desc: 'P 站视频浏览与播放', icon: PlayCircle, ready: false }
]
