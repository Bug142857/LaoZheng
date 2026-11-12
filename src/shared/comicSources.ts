/** 漫画源配置：漫画客（可加镜像）、Komiic、哔咔、头牌与禁漫天堂，可在片源管理里增删改 / 启停 / 测试 */

export type ComicSourceTemplate = 'yumanhua' | 'komiic' | 'bikahub' | 'tptoon' | 'jmcomic'

export interface ComicSource {
  id: string
  name: string
  baseUrl: string
  template: ComicSourceTemplate
  enabled: boolean
  testStatus: 'ok' | 'bad' | null
  testMsg: string | null
  testAt: number
}

export interface ComicSourceInput {
  id: string
  name: string
  baseUrl: string
  template: ComicSourceTemplate
}

export const DEFAULT_COMIC_SOURCES: ComicSource[] = [
  {
    id: 'yumanhua',
    name: '漫画客',
    baseUrl: 'http://www.yumanhua.com',
    template: 'yumanhua',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'komiic',
    name: 'Komiic',
    baseUrl: 'https://komiic.com',
    template: 'komiic',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'bikahub',
    name: '哔咔漫画',
    baseUrl: 'https://bikahub.net',
    template: 'bikahub',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'tptoon',
    name: '头牌漫画',
    baseUrl: 'https://tptoon.net',
    template: 'tptoon',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'jmcomic',
    name: '禁漫天堂',
    baseUrl: 'https://18comic66.com',
    template: 'jmcomic',
    enabled: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  }
]

/** 头牌漫画默认源：老数据首次加载补一次，删除后不再自动加回 */
export const TPTOON_COMIC_SOURCE: ComicSource = DEFAULT_COMIC_SOURCES.find(
  (source) => source.id === 'tptoon'
) as ComicSource

/** 禁漫天堂默认源：老数据首次加载补一次，删除后不再自动加回 */
export const JMCOMIC_COMIC_SOURCE: ComicSource = DEFAULT_COMIC_SOURCES.find(
  (source) => source.id === 'jmcomic'
) as ComicSource

/** 2026-11-10 新增的哔咔源：老数据首次加载补一次，删除后不再自动加回 */
export const ADDED_COMIC_SOURCES: ComicSource[] = DEFAULT_COMIC_SOURCES.filter(
  (source) => source.id === 'bikahub'
)

export function inferComicTemplate(baseUrl: string): ComicSourceTemplate {
  if (/komiic\.(com|cc)/i.test(baseUrl)) return 'komiic'
  if (/bikahub\.net|bikago\.net|mlaridyo\.cc|dojqybrcm\.com/i.test(baseUrl)) return 'bikahub'
  if (/18comic|jmcomic|18mj|jm\d*\./i.test(baseUrl)) return 'jmcomic'
  if (
    /tptoon|tpmh\d*\.|tpmhw\.com|toupai|toonmh|mttoon|rrtoon|mhqun|bbmh|dybqg|qqmh/i.test(baseUrl)
  ) {
    return 'tptoon'
  }
  return 'yumanhua'
}

export function normalizeComicSources(raw: unknown): ComicSource[] {
  if (!Array.isArray(raw)) return DEFAULT_COMIC_SOURCES.map((source) => ({ ...source }))
  const out: ComicSource[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as Partial<ComicSource>
    if (typeof source.id !== 'string' || !source.id) continue
    if (typeof source.baseUrl !== 'string' || !/^https?:\/\//i.test(source.baseUrl.trim())) {
      continue
    }
    if (
      source.template !== 'yumanhua' &&
      source.template !== 'komiic' &&
      source.template !== 'bikahub' &&
      source.template !== 'tptoon' &&
      source.template !== 'jmcomic'
    ) {
      continue
    }
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
