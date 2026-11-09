/**
 * 番号模块的片源（默认四个外网采集站）。
 * 与影视源同构，但单独存放在 data.h1Sources，不参与影视搜索。
 */
import { vodHost } from './vod'
import type { VodSource } from './types'

export type H1Source = VodSource

/** 默认四个源的中文名与影视源内置列表保持一致 */
export const DEFAULT_H1_SOURCES: H1Source[] = [
  {
    id: 'h1_fixed_1',
    name: '黄色仓库',
    baseUrl: 'https://hsckzy.vip/api.php/provide/vod',
    enabled: true,
    region: 'proxy',
    regionManual: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'h1_fixed_2',
    name: '91麻豆',
    baseUrl: 'https://91md.me/api.php/provide/vod',
    enabled: true,
    region: 'proxy',
    regionManual: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'h1_fixed_3',
    name: '奶香香',
    baseUrl: 'https://Naixxzy.com/api.php/provide/vod',
    enabled: true,
    region: 'proxy',
    regionManual: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'h1_fixed_4',
    name: '精品资源',
    baseUrl: 'https://www.jingpinx.com/api.php/provide/vod',
    enabled: true,
    region: 'proxy',
    regionManual: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  }
]

/** v0.86 及更早版本默认使用的英文名，老数据升级时替换为中文名 */
const LEGACY_NAMES: Record<string, string[]> = {
  h1_fixed_1: ['hsckzy.vip'],
  h1_fixed_2: ['91md.me'],
  h1_fixed_3: ['naixxzy.com'],
  h1_fixed_4: ['jingpinx.com', 'www.jingpinx.com']
}

/**
 * 番号源配置：
 * - 旧数据没有 h1Sources 时补四个默认源（中文名，默认标记为有效）；
 * - 已经存在数组时以用户配置为准（删空也保持为空，不再自动加回）；
 * - 老数据里的默认四源若仍是英文名 / 未测试，升级为中文名并标记为有效；
 *   用户改过名字、地址或测试结果的保持原样。
 */
export function normalizeH1Sources(raw: unknown): H1Source[] {
  if (!Array.isArray(raw)) return DEFAULT_H1_SOURCES.map((source) => ({ ...source }))
  const out: H1Source[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as Partial<H1Source>
    if (typeof source.id !== 'string' || !source.id) continue
    if (typeof source.baseUrl !== 'string' || !/^https?:\/\//i.test(source.baseUrl.trim())) {
      continue
    }
    const baseUrl = source.baseUrl.trim().replace(/\/+$/, '')
    let name = source.name?.trim() || vodHost(baseUrl)
    let testStatus = typeof source.testStatus === 'string' ? source.testStatus : null
    let testMsg = typeof source.testMsg === 'string' ? source.testMsg : null
    const fallback = DEFAULT_H1_SOURCES.find((item) => item.id === source.id)
    if (fallback && vodHost(baseUrl) === vodHost(fallback.baseUrl)) {
      const legacy = LEGACY_NAMES[fallback.id] ?? []
      if (legacy.includes(name) || name === vodHost(baseUrl)) name = fallback.name
      if (!testStatus) {
        testStatus = 'ok'
        testMsg = '可用'
      }
    }
    out.push({
      id: source.id,
      name,
      baseUrl,
      enabled: source.enabled !== false,
      region: 'proxy',
      regionManual: true,
      testStatus,
      testMsg,
      testAt:
        typeof source.testAt === 'number' && Number.isFinite(source.testAt) ? source.testAt : 0
    })
  }
  return out
}
