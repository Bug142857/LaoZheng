/**
 * 电视（自定义 M3U / M3U8 直播源）。
 * 与手机端一致：网络源直接加载，本地导入的文本存在 content 里（url 以 local:// 开头）。
 */

export interface LiveSource {
  id: string
  name: string
  url: string
  content: string
  enabled: boolean
}

export interface LiveChannel {
  group: string
  name: string
  url: string
}

export interface LiveChannelResult {
  sourceId: string
  sourceName: string
  channels: LiveChannel[]
  error?: string
}

export interface LiveImportResult {
  canceled: boolean
  source?: LiveSource
  error?: string
}

export function isLocalLiveSource(source: LiveSource): boolean {
  return source.url.startsWith('local://')
}

/** 解析标准 M3U：group-title / tvg-name / 逗号后的频道名，同一地址只保留第一条 */
export function parseM3u(text: string): LiveChannel[] {
  const out = new Map<string, LiveChannel>()
  let name: string | null = null
  let group = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.toUpperCase().startsWith('#EXTINF')) {
      group = line.match(/group-title="([^"]*)"/i)?.[1]?.trim() ?? ''
      const tvg = line.match(/tvg-name="([^"]*)"/i)?.[1]?.trim() ?? ''
      const display = line.slice(line.lastIndexOf(',') + 1).trim()
      name = display || tvg
    } else if (!line.startsWith('#')) {
      const channelName =
        name?.trim() ||
        line.split('/').pop()?.split('?')[0]?.trim() ||
        '未命名频道'
      if (!out.has(line)) {
        out.set(line, { group: group || '未分组', name: channelName, url: line })
      }
      name = null
    }
  }
  return [...out.values()]
}
