import type {
  MusicPlatform,
  MusicResolveResponse,
  MusicSearchResponse,
  MusicSong
} from '../src/shared/music'

/**
 * 在线音乐：无名音乐网（mvmp3）主源 + 闪闪音乐网（33ve）兜底。
 * 两个站点是同一套建站系统，接口完全一致：
 * 搜索：GET /so.php?wd=&page=，服务端渲染 HTML
 * 直链：POST /style/js/play.php 表单 id + type=dance → JSON { url, lrc, pic, name, singer }
 */

const SITES: Record<MusicPlatform, string> = {
  mvmp3: 'http://www.mvmp3.com',
  s33ve: 'https://www.33ve.com'
}

const LABELS: Record<MusicPlatform, string> = {
  mvmp3: '无名音乐',
  s33ve: '33ve'
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const RESOLVE_TTL_MS = 4 * 60 * 1000
const resolveCache = new Map<string, { url: string; lrc: string; cover: string; at: number }>()

const PLATFORMS: MusicPlatform[] = ['mvmp3', 's33ve']

function isPlatform(value: string): value is MusicPlatform {
  return value === 'mvmp3' || value === 's33ve'
}

async function getPage(platform: MusicPlatform, url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: `${SITES[platform]}/`
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

function parseSongs(html: string, platform: MusicPlatform): MusicSong[] {
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
      durationMs: parseDuration(duration),
      platform
    })
  }
  return items
}

async function searchAt(
  platform: MusicPlatform,
  keyword: string,
  page: number
): Promise<MusicSong[]> {
  const html = await getPage(
    platform,
    `${SITES[platform]}/so.php?wd=${encodeURIComponent(keyword)}&page=${Math.max(1, page)}`
  )
  return parseSongs(html, platform)
}

/** 搜索：先 mvmp3，失败或无结果再用 33ve 兜底 */
export async function searchMusic(rawKeyword: string, page = 1): Promise<MusicSearchResponse> {
  const keyword = rawKeyword.trim()
  if (!keyword) return { ok: true, items: [] }
  const errors: string[] = []
  for (const platform of PLATFORMS) {
    try {
      const items = await searchAt(platform, keyword, page)
      if (items.length) return { ok: true, items }
      errors.push(`${LABELS[platform]}：没有搜到歌曲`)
    } catch (err) {
      errors.push(`${LABELS[platform]}：${err instanceof Error ? err.message : '搜索失败'}`)
    }
  }
  return { ok: false, items: [], error: errors.join('；') }
}

interface PlayJson {
  url?: string
  lrc?: string
  pic?: string
  name?: string
  singer?: string
}

async function requestPlay(
  platform: MusicPlatform,
  id: string,
  type: string
): Promise<PlayJson> {
  const site = SITES[platform]
  const res = await fetch(`${site}/style/js/play.php`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${site}/`
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

export async function resolveMusic(
  songId: string,
  platform = 'mvmp3'
): Promise<MusicResolveResponse> {
  if (!/^[0-9a-f]{32}$/i.test(songId)) return { ok: false, error: '歌曲编号无效' }
  const source: MusicPlatform = isPlatform(platform) ? platform : 'mvmp3'
  const cacheKey = `${source}:${songId}`
  const cached = resolveCache.get(cacheKey)
  if (cached && Date.now() - cached.at < RESOLVE_TTL_MS) {
    return { ok: true, url: cached.url, lrc: cached.lrc, cover: cached.cover }
  }

  let lastError = '取播放直链失败'
  for (const type of ['dance', 'music', 'mp3']) {
    try {
      const data = await requestPlay(source, songId, type)
      const url = typeof data.url === 'string' ? data.url : ''
      if (url.startsWith('http')) {
        const lrc = (data.lrc ?? '').replace(/\\n/g, '\n')
        const cover = data.pic ?? ''
        resolveCache.set(cacheKey, { url, lrc, cover, at: Date.now() })
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

/**
 * 旧收藏（手机端 joox| / netease| 条目）回退：
 * 拿「歌名 + 歌手」依次去 mvmp3、33ve 搜同名歌，命中后解析直链。
 */
export async function resolveLegacyMusic(
  name: string,
  artists: string
): Promise<MusicResolveResponse> {
  const title = name.trim()
  const keyword = [title, artists.trim()].filter(Boolean).join(' ').trim()
  if (!title) return { ok: false, error: '收藏缺少歌名，无法回退搜索' }
  const norm = (s: string): string => s.trim().toLowerCase()
  const firstArtist = artists.split(/[/&、,]/)[0]?.trim() ?? ''

  for (const platform of PLATFORMS) {
    let candidates: MusicSong[]
    try {
      candidates = await searchAt(platform, keyword || title, 1)
    } catch {
      continue
    }
    const target =
      candidates.find(
        (s) =>
          norm(s.name) === norm(title) &&
          !!firstArtist &&
          norm(s.artists).includes(norm(firstArtist))
      ) ??
      candidates.find((s) => norm(s.name) === norm(title)) ??
      candidates.find((s) => norm(s.name).includes(norm(title)))
    if (!target) continue
    const resolved = await resolveMusic(target.id, platform)
    if (resolved.ok) return resolved
  }
  return { ok: false, error: 'mvmp3 / 33ve 里也没有找到同名歌曲' }
}
