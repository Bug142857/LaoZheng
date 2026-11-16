/** 模拟模块：老郑分享 PC 端（yikm.net 复古游戏） */

export type EmuPlatformId =
  | 'java'
  | 'fc'
  | 'sfc'
  | 'arcade'
  | 'gba'
  | 'nds'
  | 'md'
  | 'dos'
  | 'flash'

/** 站点没有封面时使用的默认图 */
export const EMU_DEFAULT_COVER = 'https://img.1990i.com/fcpic/nopic.png'

export interface EmuPlatform {
  id: EmuPlatformId
  label: string
  /** 站点平台参数 e；街机不用 e，只用固定 tag */
  e: string
  /** 街机的固定 tag */
  tag: string
}

/** 平台顺序与站点菜单一致，默认 FC；Java 放到 DOS 后面 */
export const EMU_PLATFORMS: EmuPlatform[] = [
  // e 同时用于分类标签过滤（FC 的分类标签是 ?tag=2&e=0，GBA 是 ?tag=动作&e=2，MD 是 ?tag=角色扮演&e=3）
  { id: 'fc', label: 'FC', e: '0', tag: '0' },
  { id: 'sfc', label: 'SFC', e: '5', tag: '' },
  { id: 'arcade', label: '街机', e: '', tag: '9' },
  { id: 'gba', label: 'GBA', e: '2', tag: '11' },
  { id: 'nds', label: 'NDS', e: '7', tag: '' },
  { id: 'md', label: 'MD', e: '3', tag: '13' },
  { id: 'dos', label: 'DOS', e: '6', tag: '' },
  { id: 'java', label: 'Java', e: '8', tag: '' },
  { id: 'flash', label: 'Flash', e: '9', tag: '' }
]

export function isEmuPlatform(value: unknown): value is EmuPlatformId {
  return typeof value === 'string' && EMU_PLATFORMS.some((item) => item.id === value)
}

export function emuPlatformLabel(id: string): string {
  return EMU_PLATFORMS.find((item) => item.id === id)?.label ?? '模拟'
}

export interface EmuGameItem {
  id: string
  title: string
  cover: string | null
  /** 站点卡片上的分类 / 系列标签 */
  category: string
  platform: EmuPlatformId
}

export interface EmuTag {
  name: string
  value: string
}

export interface EmuListResponse {
  ok: boolean
  items: EmuGameItem[]
  page: number
  /** 站点不提供真实末页，固定为 0，用 hasMore 判断下一页 */
  lastPage: number
  hasMore: boolean
  tags?: EmuTag[]
  error?: string
}

export interface EmuOpenResponse {
  ok: boolean
  error?: string
}

/** 站点搜索是单页返回（page 参数无效），所以不带分页字段 */
export interface EmuSearchResponse {
  ok: boolean
  items: EmuGameItem[]
  error?: string
}
