/**
 * 小说模块共用类型。
 * 书源使用固定解析模板（笔趣阁系），可在片源管理里增删改 / 启停 / 测试。
 * 小说源随 data.json 备份与云同步一起走；手机端会忽略该字段。
 */

export type NovelSourceTemplate =
  | 'bqg70'
  | 'bqg52'
  | 'biqugeco'
  | 'mayi'
  | '95dushu'
  | 'xuanhuange'
  | 'qishu5wa'
  | 'xyuzhaiwu'
  | 'xhytd'
  | 'ajnnan'
  | 'bqquge'
  | 'zuizhong'
  | 'banshanren'
  | 'shenpinwu'

export const NOVEL_SOURCE_TEMPLATES: NovelSourceTemplate[] = [
  'bqg70',
  'bqg52',
  'biqugeco',
  'mayi',
  '95dushu',
  'xuanhuange',
  'qishu5wa',
  'xyuzhaiwu',
  'xhytd',
  'ajnnan',
  'bqquge',
  'zuizhong',
  'banshanren',
  'shenpinwu'
]

/** 新建 / 编辑书源时可选的模板；bqg70 / bqg52 / biqugeco / xyuzhaiwu 已下线，仅保留旧数据解析兼容 */
export const NOVEL_SOURCE_TEMPLATE_OPTIONS: NovelSourceTemplate[] = [
  'mayi',
  '95dushu',
  'xuanhuange',
  'qishu5wa',
  'xhytd',
  'ajnnan',
  'bqquge',
  'zuizhong',
  'banshanren'
]

export const NOVEL_SOURCE_TEMPLATE_LABEL: Record<NovelSourceTemplate, string> = {
  bqg70: '笔趣阁（bqg70）',
  bqg52: '笔趣阁（52bqg）',
  biqugeco: '笔趣阁小说（biqugeco）',
  mayi: '蚂蚁文学（biquges）',
  '95dushu': '九五小说（95dushu）',
  xuanhuange: '玄幻阁（xuanhuange）',
  qishu5wa: '奇书小说（5wa）',
  xyuzhaiwu: '新御宅屋',
  xhytd: '黄易小说（xhytd）',
  ajnnan: '无极小说（ajnnan）',
  bqquge: '笔趣阁（bqquge）',
  zuizhong: '最终小说网（zuizhong）',
  banshanren: '搬山人小说网',
  shenpinwu: '神书网（shenpinwu）'
}

export interface NovelCategory {
  id: string
  name: string
}

/** 支持分类浏览的书源；没有列出的模板在小说页只显示推荐 / 搜索 */
export const NOVEL_SOURCE_CATEGORIES: Partial<Record<NovelSourceTemplate, NovelCategory[]>> = {
  mayi: [
    { id: 'xuanhuanxiaoshuo', name: '玄幻' },
    { id: 'xiuzhenxiaoshuo', name: '修真' },
    { id: 'dushixiaoshuo', name: '都市' },
    { id: 'chuanyuexiaoshuo', name: '穿越' },
    { id: 'wangyouxiaoshuo', name: '网游' },
    { id: 'kehuanxiaoshuo', name: '科幻' }
  ],
  '95dushu': [{ id: 'quanben', name: '全本' }],
  xuanhuange: [
    { id: '1', name: '玄幻' },
    { id: '2', name: '武侠' },
    { id: '3', name: '都市' },
    { id: '4', name: '历史' },
    { id: '5', name: '言情' },
    { id: '6', name: '穿越' },
    { id: '7', name: '科幻' },
    { id: '8', name: '恐怖' },
    { id: '9', name: '校园' },
    { id: '10', name: '异界' }
  ],
  qishu5wa: [
    { id: '1', name: '玄幻' },
    { id: '2', name: '修真' },
    { id: '3', name: '都市' },
    { id: '4', name: '穿越' },
    { id: '5', name: '网游' },
    { id: '6', name: '科幻' },
    { id: '7', name: '其他' }
  ],
  bqquge: [
    { id: 'xuanhuan', name: '玄幻' },
    { id: 'qihuan', name: '奇幻' },
    { id: 'wuxia', name: '武侠' },
    { id: 'xianxia', name: '仙侠' },
    { id: 'dushi', name: '都市' },
    { id: 'junshi', name: '军事' },
    { id: 'lishi', name: '历史' },
    { id: 'youxi', name: '游戏' },
    { id: 'tiyu', name: '体育' },
    { id: 'kehuan', name: '科幻' },
    { id: 'xuanyi', name: '悬疑' },
    { id: 'qing', name: '轻小' },
    { id: 'chuanyue', name: '穿越' },
    { id: 'yanqing', name: '言情' }
  ],
  zuizhong: [
    { id: '1', name: '玄幻修真' },
    { id: '2', name: '重生穿越' },
    { id: '3', name: '都市小说' },
    { id: '4', name: '军史小说' },
    { id: '5', name: '网游小说' },
    { id: '6', name: '科幻小说' },
    { id: '7', name: '灵异小说' },
    { id: '8', name: '言情小说' },
    { id: '9', name: '其他小说' }
  ],
  banshanren: [
    { id: '4', name: '奇幻玄幻' },
    { id: '5', name: 'BG言情' },
    { id: '1', name: 'BL耽美' },
    { id: '2', name: 'GL百合' },
    { id: '3', name: '现代都市' },
    { id: '7', name: '穿越重生' },
    { id: '8', name: '武侠仙侠' }
  ],
  shenpinwu: [
    { id: 'xuanhuan', name: '玄幻' },
    { id: 'wuxia', name: '武侠' },
    { id: 'dushi', name: '都市' },
    { id: 'lishi', name: '历史' },
    { id: 'kehuan', name: '科幻' },
    { id: 'youxi', name: '游戏' },
    { id: 'nvsheng', name: '女生' },
    { id: 'qita', name: '其他' }
  ]
}

export interface NovelSource {
  id: string
  name: string
  baseUrl: string
  template: NovelSourceTemplate
  enabled: boolean
  testStatus: 'ok' | 'bad' | null
  testMsg: string | null
  testAt: number
}

export interface NovelSourceInput {
  id: string
  name: string
  baseUrl: string
  template: NovelSourceTemplate
}

/**
 * 内置书源：蚂蚁文学 + 九五小说 + 玄幻阁（后两个是 2026-11-04 从 Legado 合集里实测筛出的免费源）。
 * 新安装默认显示有效，之后手动测试会覆盖成真实结果。
 */
export const DEFAULT_NOVEL_SOURCES: NovelSource[] = [
  {
    id: 'mayi',
    name: '蚂蚁文学',
    baseUrl: 'https://www.biquges.com',
    template: 'mayi',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: '95dushu',
    name: '九五小说',
    baseUrl: 'http://www.95dushu.info',
    template: '95dushu',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'xuanhuange',
    name: '玄幻阁',
    baseUrl: 'http://www.xuanhuange.info',
    template: 'xuanhuange',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'qishu5wa',
    name: '奇书小说',
    baseUrl: 'https://m.5wa.net',
    template: 'qishu5wa',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'xhytd',
    name: '黄易小说',
    baseUrl: 'http://www.xhytd.com',
    template: 'xhytd',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'ajnnan',
    name: '无极小说',
    baseUrl: 'http://ajnnan.com',
    template: 'ajnnan',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'bqquge',
    name: '笔趣阁',
    baseUrl: 'https://www.bqquge.org',
    template: 'bqquge',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'zuizhong',
    name: '最终小说网',
    baseUrl: 'https://www.zuizhong.net',
    template: 'zuizhong',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'banshanren',
    name: '搬山人小说网',
    baseUrl: 'https://www.banshanren.com',
    template: 'banshanren',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
]

/** 后续新增的内置源：老数据首次加载时补一次，删除后不再自动加回 */
export const ADDED_NOVEL_SOURCES: NovelSource[] = DEFAULT_NOVEL_SOURCES.filter((source) =>
  [
    '95dushu',
    'xuanhuange',
    'qishu5wa',
    'xhytd',
    'ajnnan',
    'bqquge',
    'zuizhong',
    'banshanren'
  ].includes(source.id)
)

/** 已下线的旧内置书源：老数据加载时清理掉，手动添加的 novel_* 源不受影响 */
const RETIRED_NOVEL_SOURCES: Record<string, RegExp> = {
  bqg70: /bqg70\./i,
  bqg52: /52bqg|bqg52/i,
  biqugeco: /biqugeco/i
}

function isTemplate(value: unknown): value is NovelSourceTemplate {
  return NOVEL_SOURCE_TEMPLATES.includes(value as NovelSourceTemplate)
}

/**
 * 书源配置：
 * - 旧数据没有 novelSources 时补内置书源（只含蚂蚁文学）；
 * - 已经存在数组时以用户配置为准（删空也保持为空，不再自动加回）；
 * - 老数据里自动带进来的笔趣阁系内置源（bqg70 / bqg52 / biqugeco）与新御宅屋（xyuzhaiwu）移除。
 */
export function normalizeNovelSources(raw: unknown): NovelSource[] {
  if (!Array.isArray(raw)) return DEFAULT_NOVEL_SOURCES.map((source) => ({ ...source }))
  const out: NovelSource[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as Partial<NovelSource>
    if (typeof source.id !== 'string' || !source.id) continue
    if (typeof source.baseUrl !== 'string' || !/^https?:\/\//i.test(source.baseUrl.trim())) {
      continue
    }
    if (!isTemplate(source.template)) continue
    // 2026-11-06：神书网比其它源慢很多，先下线（保留模板解析代码，后续可恢复）
    if (source.id === 'shenpinwu' || /shenpinwu\./i.test(source.baseUrl)) continue
    // 2026-11-05：新御宅屋源下线，内置和手动添加的同站源一并清理
    if (source.id === 'xyuzhaiwu' || /xyuzhaiwu/i.test(source.baseUrl)) continue
    const retired = RETIRED_NOVEL_SOURCES[source.id]
    if (retired && retired.test(source.baseUrl)) continue
    if (out.some((item) => item.id === source.id || item.baseUrl === source.baseUrl)) continue
    out.push({
      id: source.id,
      name: source.name?.trim() || source.baseUrl,
      baseUrl: source.baseUrl.trim().replace(/\/+$/, ''),
      template: source.template,
      enabled: source.enabled !== false,
      testStatus:
        source.testStatus === 'ok' || source.testStatus === 'bad' ? source.testStatus : null,
      testMsg: typeof source.testMsg === 'string' ? source.testMsg : null,
      testAt:
        typeof source.testAt === 'number' && Number.isFinite(source.testAt) ? source.testAt : 0
    })
  }
  return out
}

/** 搜索结果 / 推荐列表里的书 */
export interface NovelItem {
  bookId: string
  title: string
  author: string
  cover: string
  category?: string
  status?: string
  latestChapter?: string
  /** 全部源搜索 / 推荐时标记来源，单源模式可省略 */
  sourceId?: string
  sourceName?: string
}

/** 站点状态统一成「完结 / 连载」 */
export function normalizeNovelStatus(raw: string | undefined | null): string {
  const value = (raw ?? '').trim()
  if (!value) return ''
  if (value.includes('完')) return '完结'
  if (value.includes('连载')) return '连载'
  return value
}

/** 整本下载 TXT 用到的书籍信息（章节由详情页传入，避免重复抓目录） */
export interface NovelDownloadInput {
  source: NovelSourceInput
  bookId: string
  title: string
  author?: string
  status?: string
  intro?: string
  cover?: string
  chapters: NovelChapter[]
}

export interface NovelDownloadProgress {
  sourceId: string
  bookId: string
  done: number
  total: number
}

export interface NovelDownloadResult {
  ok: boolean
  path?: string
  chapters?: number
  failed?: number
  sizeBytes?: number
  error?: string
}

export interface NovelListResponse {
  ok: boolean
  items: NovelItem[]
  error?: string
  /** 分类浏览时是否还有下一页（搜索 / 推荐不返回） */
  hasMore?: boolean
}

export interface NovelChapter {
  id: string
  name: string
  index: number
}

export interface NovelDetail {
  bookId: string
  title: string
  author: string
  cover: string
  intro: string
  category: string
  status: string
  latestChapter: string
  chapters: NovelChapter[]
}

export interface NovelDetailResponse {
  ok: boolean
  detail?: NovelDetail
  error?: string
}

export interface NovelChapterContent {
  id: string
  content: string
}

export interface NovelChapterResponse {
  ok: boolean
  chapter?: NovelChapterContent
  error?: string
}

/** 书源测试结果（count = 首页能解析出的推荐书目数） */
export interface NovelTestResult {
  ok: boolean
  count?: number
  message?: string
  error?: string
}
