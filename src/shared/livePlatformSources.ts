/**
 * 平台直播源（B站 / 斗鱼 / 抖音）。
 * 与「电视」模块的 IPTV 直播源（shared/live.ts）是两套数据，互不影响。
 * 数据形状与其它片源一致，存放在 data.livePlatformSources，随备份与云同步走。
 */
import { vodHost } from './vod'
import type { LivePlatformId } from './livePlatform'
import type { VodSource } from './types'

export type LivePlatformSource = VodSource

export const DEFAULT_LIVE_PLATFORM_SOURCES: LivePlatformSource[] = [
  {
    id: 'bilibili',
    name: 'B站',
    baseUrl: 'https://live.bilibili.com',
    enabled: true,
    region: 'cn',
    regionManual: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'douyu',
    name: '斗鱼',
    baseUrl: 'https://www.douyu.com',
    enabled: true,
    region: 'cn',
    regionManual: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  },
  {
    id: 'douyin',
    name: '抖音',
    baseUrl: 'https://live.douyin.com',
    enabled: true,
    region: 'cn',
    regionManual: true,
    testStatus: 'ok',
    testMsg: '可用',
    testAt: 0
  }
]

const DEFAULT_NAMES: Record<LivePlatformId, string> = {
  bilibili: 'B站',
  douyu: '斗鱼',
  douyin: '抖音'
}

/** 从源地址 / id 判断对应平台适配器 */
export function livePlatformOfSource(source: { id?: string; baseUrl?: string }): LivePlatformId | null {
  const text = `${source.id ?? ''} ${source.baseUrl ?? ''}`.toLowerCase()
  if (/bilibili|b23\.tv/.test(text)) return 'bilibili'
  if (/douyu/.test(text)) return 'douyu'
  if (/douyin/.test(text)) return 'douyin'
  return null
}

/** 平台默认显示名（没有配置源时兜底） */
export function livePlatformDefaultName(platform: LivePlatformId): string {
  return DEFAULT_NAMES[platform]
}

/**
 * 直播源配置：
 * - 旧数据没有该字段时补三个默认平台源；
 * - 已存在数组时以用户配置为准（删空也保持为空）；
 * - 同一平台只保留第一条（界面下拉按平台切换）；
 * - 无法识别平台的地址直接丢弃，避免出现无法播放的源。
 */
export function normalizeLivePlatformSources(raw: unknown): LivePlatformSource[] {
  if (!Array.isArray(raw)) return DEFAULT_LIVE_PLATFORM_SOURCES.map((source) => ({ ...source }))
  const out: LivePlatformSource[] = []
  const seen = new Set<LivePlatformId>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as Partial<LivePlatformSource>
    if (typeof source.id !== 'string' || !source.id.trim()) continue
    if (typeof source.baseUrl !== 'string' || !/^https?:\/\//i.test(source.baseUrl.trim())) {
      continue
    }
    const baseUrl = source.baseUrl.trim().replace(/\/+$/, '')
    const platform = livePlatformOfSource({ id: source.id, baseUrl })
    if (!platform || seen.has(platform)) continue
    seen.add(platform)
    out.push({
      id: source.id.trim(),
      name: source.name?.trim() || DEFAULT_NAMES[platform],
      baseUrl,
      enabled: source.enabled !== false,
      region: source.region === 'proxy' ? 'proxy' : 'cn',
      regionManual: source.regionManual !== false,
      testStatus: typeof source.testStatus === 'string' ? source.testStatus : 'ok',
      testMsg: typeof source.testMsg === 'string' ? source.testMsg : '可用',
      testAt:
        typeof source.testAt === 'number' && Number.isFinite(source.testAt) ? source.testAt : 0
    })
  }
  return out
}

/** 已启用的平台源（按平台去重，默认 B站 → 斗鱼 → 抖音 顺序） */
export function enabledLivePlatforms(
  sources: LivePlatformSource[]
): { source: LivePlatformSource; platform: LivePlatformId }[] {
  const out: { source: LivePlatformSource; platform: LivePlatformId }[] = []
  const seen = new Set<LivePlatformId>()
  for (const source of sources) {
    if (!source.enabled) continue
    const platform = livePlatformOfSource(source)
    if (!platform || seen.has(platform)) continue
    seen.add(platform)
    out.push({ source, platform })
  }
  return out
}

/** 新添加 / 导入时的兜底名称 */
export function livePlatformSourceName(baseUrl: string, platform: LivePlatformId | null): string {
  return platform ? DEFAULT_NAMES[platform] : vodHost(baseUrl)
}
