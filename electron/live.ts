import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseM3u, type LiveChannelResult, type LiveSource } from '../src/shared/live'

/** 电视源单独落盘（手机端也存在本地设置里，不进备份 JSON） */
export function liveSourcesPath(): string {
  return join(app.getPath('userData'), 'live-sources.json')
}

const DEFAULT_LIVE_SOURCES: LiveSource[] = [
  {
    id: 'iptv4',
    name: 'IPv4 直播源',
    url: 'https://gh-proxy.com/raw.githubusercontent.com/vbskycn/iptv/refs/heads/master/tv/iptv4.m3u',
    content: '',
    enabled: true
  }
]

function normalizeSource(raw: unknown): LiveSource | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const url = typeof o.url === 'string' ? o.url.trim() : ''
  if (!url) return null
  return {
    id: typeof o.id === 'string' && o.id ? o.id : `live_${Math.abs(hash(url))}`,
    name: typeof o.name === 'string' && o.name ? o.name : '直播源',
    url,
    content: typeof o.content === 'string' ? o.content : '',
    enabled: o.enabled !== false
  }
}

export function normalizeLiveSources(raw: unknown): LiveSource[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeSource).filter((s): s is LiveSource => !!s)
}

export async function loadLiveSources(): Promise<LiveSource[]> {
  const path = liveSourcesPath()
  try {
    const text = await readFile(path, 'utf8')
    return normalizeLiveSources(JSON.parse(text))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[live] 读取电视源失败，使用内置源', err)
    }
    await saveLiveSources(DEFAULT_LIVE_SOURCES)
    return DEFAULT_LIVE_SOURCES
  }
}

export async function saveLiveSources(sources: LiveSource[]): Promise<void> {
  const path = liveSourcesPath()
  await mkdir(app.getPath('userData'), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(sources, null, 2), 'utf8')
  await rename(tmp, path)
}

const UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'

export async function loadLiveChannels(source: LiveSource): Promise<LiveChannelResult> {
  if (source.url.startsWith('local://')) {
    const channels = parseM3u(source.content)
    return channels.length
      ? { sourceId: source.id, sourceName: source.name, channels }
      : {
          sourceId: source.id,
          sourceName: source.name,
          channels: [],
          error: '该源没有解析到频道，可重新导入'
        }
  }
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': UA, Accept: 'text/plain,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    const channels = parseM3u(text)
    return channels.length
      ? { sourceId: source.id, sourceName: source.name, channels }
      : {
          sourceId: source.id,
          sourceName: source.name,
          channels: [],
          error: '该源没有解析到频道（可能不是 M3U 列表）'
        }
  } catch (err) {
    const message =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
        ? '加载超时，可点重试'
        : '网络加载失败，可点重试'
    return { sourceId: source.id, sourceName: source.name, channels: [], error: message }
  }
}

export function makeLocalSource(name: string, content: string): LiveSource {
  const id = `local_${Math.abs(hash(`${name}:${content.length}`))}`
  return { id, name, url: `local://${name}`, content, enabled: true }
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}
