/** P站（pornhub.com）共用类型与分类表 */
import { formatDuration } from './xsite'

export interface PVideo {
  vkey: string
  title: string
  thumbnail: string | null
  durationSec: number
  views: string
  uploader: string
}

export interface PCategory {
  id: number
  label: string
}

export interface PListResponse {
  ok: boolean
  items: PVideo[]
  lastPage: number
  error?: string
}

export interface PMediaResponse {
  ok: boolean
  url?: string
  quality?: string
  isHls?: boolean
  error?: string
}

export const P_SORTS: { label: string; code: string }[] = [
  { label: '推荐', code: 'recommended' },
  { label: '最新', code: '' },
  { label: '最热', code: 'ht' },
  { label: '人气', code: 'mv' },
  { label: '高分', code: 'tr' }
]

export const P_CATEGORIES: PCategory[] = [
  { id: 3, label: '业余' },
  { id: 138, label: '认证素人' },
  { id: 1, label: '亚洲' },
  { id: 103, label: '韩国' },
  { id: 101, label: '印度' },
  { id: 98, label: '阿拉伯' },
  { id: 102, label: '巴西' },
  { id: 26, label: '拉丁' },
  { id: 99, label: '俄罗斯' },
  { id: 96, label: '英国' },
  { id: 100, label: '捷克' },
  { id: 94, label: '法国' },
  { id: 95, label: '德国' },
  { id: 97, label: '意大利' },
  { id: 4, label: '美臀' },
  { id: 8, label: '美乳' },
  { id: 59, label: '小胸' },
  { id: 7, label: '巨根' },
  { id: 9, label: '金发' },
  { id: 11, label: '深发' },
  { id: 42, label: '红发' },
  { id: 13, label: '口交' },
  { id: 20, label: '手交' },
  { id: 131, label: '舔舐' },
  { id: 15, label: '中出' },
  { id: 16, label: '颜射' },
  { id: 14, label: '爆射' },
  { id: 69, label: '潮吹' },
  { id: 80, label: '群交' },
  { id: 2, label: '狂欢' },
  { id: 72, label: '双管齐下' },
  { id: 21, label: '硬核' },
  { id: 67, label: '激烈' },
  { id: 41, label: '第一视角' },
  { id: 22, label: '自慰' },
  { id: 502, label: '女性高潮' },
  { id: 592, label: '指法' },
  { id: 23, label: '玩具' },
  { id: 10, label: '捆绑' },
  { id: 19, label: '拳交' },
  { id: 542, label: '绑带' },
  { id: 18, label: '恋物' },
  { id: 93, label: '玉足' },
  { id: 211, label: '圣水' },
  { id: 78, label: '按摩' },
  { id: 24, label: '户外' },
  { id: 31, label: '真实' },
  { id: 90, label: '试镜' },
  { id: 88, label: '校园' },
  { id: 89, label: '保姆' },
  { id: 444, label: '家庭幻想' },
  { id: 181, label: '老少配' },
  { id: 242, label: '绿帽' },
  { id: 25, label: '跨种族' },
  { id: 76, label: '双性男' },
  { id: 92, label: '男Solo' },
  { id: 492, label: '女Solo' },
  { id: 61, label: '直播' },
  { id: 86, label: '动漫' },
  { id: 241, label: '角色扮演' },
  { id: 81, label: '剧情' },
  { id: 33, label: '脱衣舞' },
  { id: 57, label: '合集' },
  { id: 522, label: '浪漫' },
  { id: 562, label: '纹身' },
  { id: 6, label: '大码' },
  { id: 32, label: '搞笑' }
]

export { formatDuration }
