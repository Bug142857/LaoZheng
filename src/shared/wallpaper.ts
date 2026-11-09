/** 壁纸模块：壁纸源配置、分类与数据口径 */

/** 壁纸源的解析模板：壁纸站点结构固定，添加源时选择站点模板 */
export type WallpaperSourceTemplate = 'wallspic' | 'bizhimi'

/** 壁纸设备维度：电脑 / 手机，分类按设备区分 */
export type WallpaperDevice = 'pc' | 'mobile'

export const WALLPAPER_DEVICES: { id: WallpaperDevice; label: string }[] = [
  { id: 'pc', label: '电脑壁纸' },
  { id: 'mobile', label: '手机壁纸' }
]

export interface WallpaperCategory {
  id: string
  label: string
  /** 站点返回的分类数量；内置兜底分类没有数量 */
  count?: number
  /** 分类备注（如「二次元 · 卡通 · 国漫 · Q版」） */
  hint?: string
}

/** 壁纸源：存放在 data.wallpaperSources，随备份与云同步走 */
export interface WallpaperSource {
  id: string
  name: string
  baseUrl: string
  template: WallpaperSourceTemplate
  enabled: boolean
  testStatus: 'ok' | 'bad' | null
  testMsg: string | null
  testAt: number
}

/** 渲染层传给主进程的最小壁纸源信息 */
export interface WallpaperSourceRef {
  id: string
  template: WallpaperSourceTemplate
  baseUrl: string
}

export interface WallpaperSourceInput {
  id?: string
  name: string
  baseUrl: string
  template: WallpaperSourceTemplate
  enabled?: boolean
}

export const WALLPAPER_SOURCE_TEMPLATES: {
  id: WallpaperSourceTemplate
  label: string
  /** 添加源时的默认名称 */
  name: string
  homepage: string
}[] = [
  {
    id: 'wallspic',
    label: 'Wallspic 站点模板',
    name: 'Wallspic',
    homepage: 'https://wallspic.com/cn'
  },
  {
    id: 'bizhimi',
    label: '壁纸迷站点模板',
    name: '壁纸迷',
    homepage: 'https://www.bizhimi.cn'
  }
]

/** 默认壁纸源：只内置站点地址，源本身可在片源管理里添加 / 修改 / 删除 */
export const DEFAULT_WALLPAPER_SOURCES: WallpaperSource[] = [
  {
    id: 'bizhimi',
    name: '壁纸迷',
    baseUrl: 'https://www.bizhimi.cn',
    template: 'bizhimi',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'wallspic',
    name: 'Wallspic',
    baseUrl: 'https://wallspic.com/cn',
    template: 'wallspic',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  }
]

/** Wallspic「种类」完整列表（与站点侧边栏的「种类」下拉一致） */
const WALLSPIC_CATEGORIES: WallpaperCategory[] = [
  { id: 'pinpai', label: '品牌' },
  { id: 'ji_shu', label: '技术' },
  { id: 'shi', label: '市' },
  { id: 'tiyu', label: '体育' },
  { id: 'tietu', label: '贴图' },
  { id: 'chouxiang', label: '抽象' },
  { id: 'qita', label: '其他' },
  { id: 'dongwu', label: '动物' },
  { id: 'riben_dongman', label: '日本动漫' },
  { id: 'yinshi', label: '饮食' },
  { id: 'youxi_lei', label: '游戏类' },
  { id: 'kongjian', label: '空间' },
  { id: 'qiche', label: '汽车' },
  { id: 'yinyue', label: '音乐' },
  { id: 'dianying', label: '电影' },
  { id: 'huahui', label: '花卉' },
  { id: 'huanxiang', label: '幻想' },
  { id: 'hangkong', label: '航空' },
  { id: 'motuo_che', label: '摩托车' },
  { id: 'xingzhi', label: '性质' },
  { id: 'renmin', label: '人民' },
  { id: 'jiaqi_yu_huodong', label: '假期与活动' },
  { id: 'wuqi', label: '武器' }
]

/** 壁纸迷内容分类（站点「筛选 → 分类」下拉，id 为 WordPress 分类 ID） */
const BIZHIMI_CATEGORIES: WallpaperCategory[] = [
  { id: '560', label: '3g-壁纸' },
  { id: '651', label: 'Bzee图库' },
  { id: '650', label: 'Bzee视觉' },
  { id: '607', label: 'ESO' },
  { id: '450', label: 'NASA' },
  { id: '585', label: 'Pexels' },
  { id: '605', label: 'Pixabay' },
  { id: '514', label: 'Unsplash' },
  { id: '506', label: 'wallhaven' },
  { id: '545', label: 'WallHere' },
  { id: '583', label: 'Wallpaper Abyss' },
  { id: '563', label: 'WallpaperUP' },
  { id: '3', label: 'Windows聚焦' },
  { id: '609', label: '乌云壁纸' },
  { id: '805', label: '人像写真' },
  { id: '5535', label: '体育运动' },
  { id: '614', label: '公元桌面' },
  { id: '2775', label: '动物世界' },
  { id: '2774', label: '卡通动漫' },
  { id: '434', label: '周度精选' },
  { id: '5533', label: '唯美情感' },
  { id: '543', label: '壁纸汇' },
  { id: '541', label: '壁纸社' },
  { id: '5531', label: '宇宙星空' },
  { id: '5534', label: '影视' },
  { id: '457', label: '彼岸图网' },
  { id: '448', label: '拾光壁纸' },
  { id: '516', label: '故宫博物院' },
  { id: '2480', label: '机械科技' },
  { id: '522', label: '极简' },
  { id: '2773', label: '游戏画面' },
  { id: '446', label: '简洁桌面' },
  { id: '5530', label: '简约' },
  { id: '653', label: '美食图片' },
  { id: '652', label: '自然风景' },
  { id: '581', label: '色彩' },
  { id: '735', label: '花卉' },
  { id: '547', label: '花猫壁纸' },
  { id: '579', label: '蔚蓝主页' },
  { id: '520', label: '轻壁纸' },
  { id: '5532', label: '静物特写' }
]

/** 「全部」分类：电脑 / 手机各自的基础分类 id */
export function wallpaperBaseCategoryId(
  source: Pick<WallpaperSource, 'template'>,
  device: WallpaperDevice
): string {
  if (source.template === 'wallspic') return device === 'pc' ? 'for_desktop' : 'for_mobile'
  return device === 'pc' ? '34' : '5626'
}

/**
 * 按设备生成兜底分类：
 * - Wallspic 站点本身就按设备提供分类（genre/for_desktop、genre/for_mobile）；
 * - 壁纸迷手机壁纸的分类来自站点导航（运行时抓取），兜底只保留「全部」。
 */
export function wallpaperFallbackCategories(
  source: Pick<WallpaperSource, 'template'>,
  device: WallpaperDevice
): WallpaperCategory[] {
  const base: WallpaperCategory = { id: wallpaperBaseCategoryId(source, device), label: '全部' }
  if (source.template === 'wallspic') {
    const suffix = device === 'pc' ? 'for_desktop' : 'for_mobile'
    return [
      base,
      ...WALLSPIC_CATEGORIES.map((entry) => ({ ...entry, id: `${entry.id}/${suffix}` }))
    ]
  }
  if (device === 'mobile') return [base]
  return [base, ...BIZHIMI_CATEGORIES]
}

export interface WallpaperItem {
  source: string
  id: string
  title: string
  /** 列表缩略图，直接可显示 */
  thumb: string
  /** 原站详情页，用于解析大图 */
  pageUrl: string
  width: number
  height: number
  /** 列表自带的大图地址（壁纸迷）；其它源在下载时再解析 */
  fullUrl: string | null
  /** 预览图（列表自带），没有时用 thumb */
  previewUrl?: string | null
  sizeText: string
  tags: string[]
}

export interface WallpaperPage {
  source: string
  category: string
  keyword: string
  page: number
  lastPage: number
  total: number
  items: WallpaperItem[]
}

export interface WallpaperListResponse {
  ok: boolean
  page?: WallpaperPage
  error?: string
}

export interface WallpaperCategoriesResponse {
  ok: boolean
  categories?: WallpaperCategory[]
  error?: string
}

export interface WallpaperResolveResponse {
  ok: boolean
  url?: string
  width?: number
  height?: number
  sizeText?: string
  error?: string
}

/** 收藏 payload：从收藏直接打开大图预览所需的信息 */
export interface WallpaperFavPayload {
  source: string
  pageUrl: string
  thumb: string
  width: number
  height: number
  fullUrl?: string | null
  previewUrl?: string | null
  sizeText?: string
  tags?: string[]
}

/** 从收藏进入壁纸页时的预览参数 */
export interface WallpaperFocus {
  item: WallpaperItem
  at: number
}

export function isWallpaperTemplate(value: unknown): value is WallpaperSourceTemplate {
  return value === 'wallspic' || value === 'bizhimi'
}

export function isWallpaperDevice(value: unknown): value is WallpaperDevice {
  return value === 'pc' || value === 'mobile'
}

/** 壁纸源 id 为任意非空字符串（源可以由用户自己添加） */
export function isWallpaperSourceId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80
}

export function wallpaperTemplateLabel(template: WallpaperSourceTemplate): string {
  return (
    WALLPAPER_SOURCE_TEMPLATES.find((entry) => entry.id === template)?.label ??
    WALLPAPER_SOURCE_TEMPLATES[0].label
  )
}

export function wallpaperDeviceLabel(device: WallpaperDevice): string {
  return WALLPAPER_DEVICES.find((entry) => entry.id === device)?.label ?? device
}

/** 按站点地址猜壁纸源模板；认不出来时返回 null */
export function inferWallpaperTemplate(baseUrl: string): WallpaperSourceTemplate | null {
  const text = baseUrl.trim().toLowerCase()
  if (!text) return null
  if (text.includes('wallspic.com')) return 'wallspic'
  if (text.includes('bizhimi.cn')) return 'bizhimi'
  return null
}

export function toWallpaperSourceRef(source: WallpaperSource): WallpaperSourceRef {
  return { id: source.id, template: source.template, baseUrl: source.baseUrl }
}

/** 缺失时补默认源；已有配置（包括用户删空）以用户为准 */
export function normalizeWallpaperSources(raw: unknown): WallpaperSource[] {
  if (!Array.isArray(raw)) return DEFAULT_WALLPAPER_SOURCES.map((source) => ({ ...source }))
  const rows: WallpaperSource[] = []
  const ids = new Set<string>()
  const urls = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Partial<WallpaperSource>
    const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : ''
    if (!/^https?:\/\//i.test(baseUrl) || urls.has(baseUrl)) continue
    const template = isWallpaperTemplate(record.template)
      ? record.template
      : inferWallpaperTemplate(baseUrl)
    if (!template) continue
    let id =
      typeof record.id === 'string' && record.id.trim()
        ? record.id.trim().slice(0, 80)
        : template
    let n = 2
    while (ids.has(id)) id = `${template}_${n++}`
    ids.add(id)
    urls.add(baseUrl)
    let host = baseUrl
    try {
      host = new URL(baseUrl).hostname
    } catch {
      // 非法地址已在上面过滤，这里只做兜底
    }
    rows.push({
      id,
      name: (typeof record.name === 'string' && record.name.trim()) || host,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      template,
      enabled: record.enabled !== false,
      testStatus: record.testStatus === 'bad' ? 'bad' : record.testStatus === 'ok' ? 'ok' : null,
      testMsg: typeof record.testMsg === 'string' ? record.testMsg : null,
      testAt: typeof record.testAt === 'number' ? record.testAt : 0
    })
  }
  // 2026-11-09 v0.107：默认源改成壁纸迷，老数据里 Wallspic 在前的顺手调换
  const bizhimiIndex = rows.findIndex((source) => source.id === 'bizhimi')
  const wallspicIndex = rows.findIndex((source) => source.id === 'wallspic')
  if (bizhimiIndex > wallspicIndex && wallspicIndex >= 0 && bizhimiIndex >= 0) {
    const [bizhimi] = rows.splice(bizhimiIndex, 1)
    rows.splice(wallspicIndex, 0, bizhimi)
  }
  return rows
}

/** 收藏 id 形如「源 id|条目 id」，旧数据里可能带已下线的 haowall 前缀 */
export function parseWallpaperFavId(raw: string): {
  source: string | null
  itemId: string
} {
  const [idSource, ...rest] = raw.split('|')
  return {
    source: isWallpaperSourceId(idSource) ? idSource : null,
    itemId: rest.join('|')
  }
}

export function parseWallpaperFavPayload(raw: string | null): WallpaperFavPayload | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return null
    const parsed = value as Partial<WallpaperFavPayload>
    if (!isWallpaperSourceId(parsed.source)) return null
    if (typeof parsed.pageUrl !== 'string' || !parsed.pageUrl) return null
    return {
      source: parsed.source,
      pageUrl: parsed.pageUrl,
      thumb: typeof parsed.thumb === 'string' ? parsed.thumb : '',
      width: typeof parsed.width === 'number' ? parsed.width : 0,
      height: typeof parsed.height === 'number' ? parsed.height : 0,
      fullUrl: typeof parsed.fullUrl === 'string' ? parsed.fullUrl : null,
      previewUrl: typeof parsed.previewUrl === 'string' ? parsed.previewUrl : null,
      sizeText: typeof parsed.sizeText === 'string' ? parsed.sizeText : '',
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag): tag is string => typeof tag === 'string')
        : []
    }
  } catch {
    return null
  }
}
