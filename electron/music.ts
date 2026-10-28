import type {
  MusicResolveResponse,
  MusicSearchResponse,
  MusicSong
} from '../src/shared/music'

/**
 * 无名音乐网（http://www.mvmp3.com）客户端，口径与手机端 MvMp3.kt 一致：
 * 搜索：GET /so.php?wd=&page=  （服务端渲染 HTML，自带封面）
 * 直链：POST /style/js/play.php 表单 id + type=dance → JSON { url, lrc, pic, name, singer }
 */

const SITE = 'http://www.mvmp3.com'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const RESOLVE_TTL_MS = 4 * 60 * 1000
const resolveCache = new Map<string, { url: string; lrc: string; cover: string; at: number }>()

async function getPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: `${SITE}/`
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`站点返回 HTTP ${res.status}`)
  const text = await res.text()
  if (text.length < 100 || text.includes('verifyForm')) throw new Error('站点拒绝了请求，请稍后重试')
  return text
}

function parseDuration(text: string): number {
  const parts = text.split(':')
  if (parts.length !== 2) return 0
  const min = Number(parts[0])
  const sec = Number(parts[1])
  if (!Number.isFinite(min) || !Number.isFinite(sec)) return 0
  return (min * 60 + sec) * 1000
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export async function searchMusic(rawKeyword: string, page = 1): Promise<MusicSearchResponse> {
  const keyword = rawKeyword.trim()
  if (!keyword) return { ok: true, items: [] }
  try {
    const html = await getPage(
      `${SITE}/so.php?wd=${encodeURIComponent(keyword)}&page=${Math.max(1, page)}`
    )
    const items: MusicSong[] = []
    for (const match of html.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
      const block = match[1]
      const id = block.match(/\/mp3\/([0-9a-f]{32})\.html/)?.[1]
      if (!id) continue
      const rawTitle = block.match(/class="url"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? ''
      const title = decodeEntities(rawTitle.replace(/<[^>]+>/g, '')).trim()
      if (!title) continue
      const artists = title.includes(' - ') ? title.slice(0, title.indexOf(' - ')).trim() : ''
      const name = title.includes(' - ') ? title.slice(title.indexOf(' - ') + 3).trim() : title
      const cover = block.match(/<img src="([^"]+)"/)?.[1] ?? ''
      const duration = block.match(/stime"[^>]*>\s*(\d{1,2}:\d{2})/)?.[1] ?? ''
      items.push({
        id,
        name: name || title,
        artists,
        album: '',
        cover,
        durationMs: parseDuration(duration)
      })
    }
    if (!items.length) return { ok: false, items: [], error: '没有搜到歌曲，换个关键词试试' }
    return { ok: true, items }
  } catch (err) {
    return {
      ok: false,
      items: [],
      error: err instanceof Error ? err.message : '搜索失败'
    }
  }
}

interface PlayJson {
  url?: string
  lrc?: string
  pic?: string
  name?: string
  singer?: string
}

async function requestPlay(id: string, type: string): Promise<PlayJson> {
  const res = await fetch(`${SITE}/style/js/play.php`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${SITE}/`
    },
    body: new URLSearchParams({ id, type }),
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`站点返回 HTTP ${res.status}`)
  const text = await res.text()
  try {
    return JSON.parse(text) as PlayJson
  } catch {
    throw new Error('站点返回异常')
  }
}

export async function resolveMusic(songId: string): Promise<MusicResolveResponse> {
  if (!/^[0-9a-f]{32}$/i.test(songId)) return { ok: false, error: '歌曲编号无效' }
  const cached = resolveCache.get(songId)
  if (cached && Date.now() - cached.at < RESOLVE_TTL_MS) {
    return { ok: true, url: cached.url, lrc: cached.lrc, cover: cached.cover }
  }

  let lastError = '取播放直链失败'
  for (const type of ['dance', 'music', 'mp3']) {
    try {
      const data = await requestPlay(songId, type)
      const url = typeof data.url === 'string' ? data.url : ''
      if (url.startsWith('http')) {
        const lrc = (data.lrc ?? '').replace(/\\n/g, '\n')
        const cover = data.pic ?? ''
        resolveCache.set(songId, { url, lrc, cover, at: Date.now() })
        return {
          ok: true,
          url,
          lrc,
          cover,
          name: data.name ?? '',
          singer: data.singer ?? ''
        }
      }
      lastError = data.name ? '站点没有这首歌的可播放资源（可能已下架）' : '站点未返回直链'
    } catch (err) {
      lastError = err instanceof Error ? err.message : '取直链失败'
    }
  }
  return { ok: false, error: lastError }
}
