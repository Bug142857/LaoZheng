/** 漫画源配置：漫画客（可加镜像）与 Komiic，可在片源管理里增删改 / 启停 / 测试 */

export type ComicSourceTemplate = 'yumanhua' | 'komiic'

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
  }
]

export function inferComicTemplate(baseUrl: string): ComicSourceTemplate {
  return /komiic\.(com|cc)/i.test(baseUrl) ? 'komiic' : 'yumanhua'
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
    if (source.template !== 'yumanhua' && source.template !== 'komiic') continue
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
