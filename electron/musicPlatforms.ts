import { lxQualityFromType, lxSourceMeta, type LxScriptMeta } from './lxSource'
import type {
  MusicLxPlatform,
  MusicQuality,
  MusicSong,
  MusicSourceInput
} from '../src/shared/music'

/**
 * 洛雪音源的搜索层。
 *
 * 洛雪自定义音源只解析播放地址，不提供搜索；这里用各平台公开接口拿到歌曲 ID，
 * 再把 ID 交给 lxSource.ts 的脚本解析。当前支持酷我 / 酷狗 / QQ / 网易云。
 */

export type LxPlatform = MusicLxPlatform

export const LX_PLATFORMS: LxPlatform[] = ['kw', 'kg', 'tx', 'wy']

export const LX_PLATFORM_LABEL: Record<LxPlatform, string> = {
  kw: '酷我',
  kg: '酷狗',
  tx: 'QQ',
  wy: '网易云'
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const PAGE_SIZE = 20
const SONG_PREFIX = 'lx~'

export interface PlatformSong {
  platform: LxPlatform
  songId: string
  name: string
  artists: string
  album: string
  cover: string
  durationMs: number
  musicInfo: Record<string, unknown>
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
}

function text(value: unknown): string {
  return decodeEntities(String(value ?? '').replace(/<[^>]+>/g, '')).trim()
}

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      ...headers
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const raw = await fetchText(url, headers)
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error('接口返回异常')
  }
}

/** 酷我接口返回的是单引号 JS 对象（对象里还有嵌套对象），先转成标准 JSON 再解析 */
function parseLooseObject<T>(text: string): T {
  let out = ''
  let inString = false
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') {
        const next = text[i + 1] ?? ''
        // 单引号对象里的 \' 要还原成 '，否则拼出来的不是合法 JSON
        if (next === "'") out += "'"
        else out += ch + next
        i += 1
      } else if (ch === quote) {
        out += '"'
        inString = false
      } else if (ch === '"') {
        out += '\\"'
      } else {
        out += ch
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch
      inString = true
      out += '"'
    } else {
      out += ch
    }
  }
  return JSON.parse(out) as T
}

interface KuwoSong {
  SONGNAME?: string
  ARTIST?: string
  ALBUM?: string
  DURATION?: string | number
  DC_TARGETID?: string | number
  MUSICRID?: string
}

async function searchKuwo(keyword: string, page: number): Promise<PlatformSong[]> {
  const pn = (Math.max(1, page) - 1) * PAGE_SIZE
  const raw = await fetchText(
    `http://search.kuwo.cn/r.s?all=${encodeURIComponent(keyword)}&ft=music&itemset=web_2013&client=kt&pn=${pn}&rn=${PAGE_SIZE}&rformat=json&encoding=utf8`,
    { Referer: 'http://www.kuwo.cn/' }
  )
  const data = parseLooseObject<{ abslist?: KuwoSong[] }>(raw)
  const items: PlatformSong[] = []
  for (const song of data.abslist ?? []) {
    const name = text(song.SONGNAME)
    const rawId = String(song.DC_TARGETID ?? song.MUSICRID ?? '').replace(/^MUSIC_/i, '')
    if (!name || !/^\d+$/.test(rawId)) continue
    const artists = text(song.ARTIST)
    const album = text(song.ALBUM)
    const duration = Number(song.DURATION) || 0
    items.push({
      platform: 'kw',
      songId: rawId,
      name,
      artists,
      album,
      cover: '',
      durationMs: duration * 1000,
      musicInfo: { songmid: rawId, name, singer: artists, albumName: album, duration }
    })
  }
  return items
}

interface KugouSong {
  hash?: string
  '320hash'?: string
  sqhash?: string
  audio_id?: number | string
  album_id?: string
  album_audio_id?: number | string
  songname?: string
  singername?: string
  album_name?: string
  duration?: number
  trans_param?: { union_cover?: string }
}

async function searchKugou(keyword: string, page: number): Promise<PlatformSong[]> {
  const url = `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(keyword)}&page=${Math.max(1, page)}&pagesize=${PAGE_SIZE}`
  const data = await fetchJson<{ data?: { info?: KugouSong[] } }>(url, {
    Referer: 'http://www.kugou.com/'
  }).catch(() =>
    fetchJson<{ data?: { info?: KugouSong[] } }>(url.replace('mobilecdn.kugou.com', 'mobiles.kugou.com'), {
      Referer: 'http://www.kugou.com/'
    })
  )
  const items: PlatformSong[] = []
  for (const song of data.data?.info ?? []) {
    const name = text(song.songname)
    const hash = String(song.hash ?? '').trim()
    if (!name || !hash) continue
    const artists = text(song.singername)
    const album = text(song.album_name)
    const duration = Number(song.duration) || 0
    const unionCover = String(song.trans_param?.union_cover ?? '')
    const cover = unionCover ? unionCover.replace('{size}', '240') : ''
    const musicInfo: Record<string, unknown> = {
      songmid: String(song.audio_id ?? ''),
      hash,
      hash_320: String(song['320hash'] ?? ''),
      hash_sq: String(song.sqhash ?? ''),
      sqhash: String(song.sqhash ?? ''),
      album_id: String(song.album_id ?? ''),
      album_audio_id: song.album_audio_id ?? '',
      name,
      singer: artists,
      albumName: album,
      duration
    }
    items.push({
      platform: 'kg',
      songId: hash,
      name,
      artists,
      album,
      cover,
      durationMs: duration * 1000,
      musicInfo
    })
  }
  return items
}

interface QqSong {
  songmid?: string
  songname?: string
  singer?: { name?: string }[]
  albumname?: string
  albummid?: string
  interval?: number
}

async function searchQq(keyword: string, page: number): Promise<PlatformSong[]> {
  const data = await fetchJson<{ data?: { song?: { list?: QqSong[] } } }>(
    `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=${Math.max(1, page)}&n=${PAGE_SIZE}&w=${encodeURIComponent(keyword)}&format=json`,
    { Referer: 'https://y.qq.com/' }
  )
  const items: PlatformSong[] = []
  for (const song of data.data?.song?.list ?? []) {
    const songmid = String(song.songmid ?? '').trim()
    const name = text(song.songname)
    if (!songmid || !name) continue
    const artists = (song.singer ?? []).map((item) => text(item?.name)).filter(Boolean).join('/')
    const album = text(song.albumname)
    const duration = Number(song.interval) || 0
    const albummid = String(song.albummid ?? '')
    items.push({
      platform: 'tx',
      songId: songmid,
      name,
      artists,
      album,
      cover: albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg` : '',
      durationMs: duration * 1000,
      musicInfo: { songmid, name, singer: artists, albumName: album, duration, albumMid: albummid }
    })
  }
  return items
}

interface WySong {
  id?: number | string
  name?: string
  artists?: { name?: string }[]
  album?: { name?: string }
  duration?: number
}

async function searchNetease(keyword: string, page: number): Promise<PlatformSong[]> {
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE
  const data = await fetchJson<{ result?: { songs?: WySong[] } }>(
    `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&offset=${offset}&limit=${PAGE_SIZE}`,
    {
      Referer: 'https://music.163.com/',
      Cookie: 'os=pc; appver=8.9.70; osver=Microsoft-Windows-10-Professional-build-19045-64bit'
    }
  )
  const items: PlatformSong[] = []
  for (const song of data.result?.songs ?? []) {
    const id = String(song.id ?? '').trim()
    const name = text(song.name)
    if (!id || !name) continue
    const artists = (song.artists ?? []).map((item) => text(item?.name)).filter(Boolean).join('/')
    const album = text(song.album?.name)
    const durationMs = Number(song.duration) || 0
    items.push({
      platform: 'wy',
      songId: id,
      name,
      artists,
      album,
      cover: '',
      durationMs,
      musicInfo: { id, name, singer: artists, albumName: album, duration: Math.round(durationMs / 1000) }
    })
  }
  return items
}

const SEARCHERS: Record<LxPlatform, (keyword: string, page: number) => Promise<PlatformSong[]>> = {
  kw: searchKuwo,
  kg: searchKugou,
  tx: searchQq,
  wy: searchNetease
}

export function encodeLxSongId(platform: LxPlatform, musicInfo: Record<string, unknown>): string {
  return `${SONG_PREFIX}${platform}~${Buffer.from(JSON.stringify(musicInfo)).toString('base64url')}`
}

export function decodeLxSongId(songId: string): { platform: LxPlatform; musicInfo: Record<string, unknown> } | null {
  if (!songId.startsWith(SONG_PREFIX)) return null
  const rest = songId.slice(SONG_PREFIX.length)
  const index = rest.indexOf('~')
  if (index <= 0) return null
  const platform = rest.slice(0, index)
  if (!LX_PLATFORMS.includes(platform as LxPlatform)) return null
  try {
    const parsed = JSON.parse(Buffer.from(rest.slice(index + 1), 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    return { platform: platform as LxPlatform, musicInfo: parsed as Record<string, unknown> }
  } catch {
    return null
  }
}

function qualitiesFor(meta: LxScriptMeta, platform: LxPlatform): MusicQuality[] {
  const types = meta.sources[platform]?.qualitys ?? []
  const out: MusicQuality[] = []
  const seen = new Set<string>()
  for (const type of types) {
    const quality = lxQualityFromType(type)
    if (!quality) continue
    const key = `${quality.format}/${quality.bitrate}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(quality)
  }
  out.sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))
  return out.length ? out : [{ format: 'mp3', bitrate: '320' }, { format: 'mp3', bitrate: '128' }]
}

/**
 * 洛雪脚本只解析播放地址、不提供歌词；酷狗 / QQ 的歌词用公开接口补上。
 * 失败时返回空串，不影响歌曲下载。
 */
export async function fetchLxLyric(
  platform: LxPlatform,
  musicInfo: Record<string, unknown>
): Promise<string> {
  try {
    if (platform === 'tx') {
      const songmid = String(musicInfo.songmid ?? '').trim()
      if (!songmid) return ''
      const raw = await fetchText(
        `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(songmid)}&format=json&nobase64=1&g_tk=5381`,
        { Referer: 'https://y.qq.com/portal/player.html' }
      )
      const data = JSON.parse(raw) as { lyric?: string }
      return decodeEntities(String(data.lyric ?? '').replace(/\\n/g, '\n')).trim()
    }
    if (platform === 'kg') {
      const hash = String(musicInfo.hash ?? '').trim()
      const name = String(musicInfo.name ?? '').trim()
      const singer = String(musicInfo.singer ?? '').trim()
      if (!hash || !name) return ''
      const duration = Math.round(Number(musicInfo.duration) || 0)
      const keyword = encodeURIComponent([singer, name].filter(Boolean).join(' '))
      const searchRaw = await fetchText(
        `https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=${keyword}&duration=${duration}&hash=${encodeURIComponent(hash)}`,
        { Referer: 'https://www.kugou.com/' }
      )
      const search = JSON.parse(searchRaw) as {
        candidates?: { id?: string; accesskey?: string; duration?: number }[]
      }
      const candidates = search.candidates ?? []
      const picked = candidates[0]
      if (!picked?.id || !picked.accesskey) return ''
      const downloadRaw = await fetchText(
        `https://lyrics.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(picked.id)}&accesskey=${encodeURIComponent(picked.accesskey)}&fmt=lrc&charset=utf8`,
        { Referer: 'https://www.kugou.com/' }
      )
      const download = JSON.parse(downloadRaw) as { content?: string }
      if (!download.content) return ''
      return Buffer.from(download.content, 'base64').toString('utf8').trim()
    }
    return ''
  } catch {
    return ''
  }
}

/** 一个洛雪源一次搜索：并行搜它声明支持的平台，单边失败不影响其它平台 */
export async function searchLxSource(
  source: MusicSourceInput,
  keyword: string,
  page: number
): Promise<{ items: MusicSong[]; errors: string[] }> {
  const meta = await lxSourceMeta(source.baseUrl)
  const wanted = source.platforms?.length
    ? source.platforms
    : source.baseUrl.includes('/fish/')
      ? (['kg', 'tx'] as LxPlatform[])
      : LX_PLATFORMS
  const platforms = LX_PLATFORMS.filter(
    (platform) => wanted.includes(platform) && !!meta.sources[platform]
  )
  if (!platforms.length) {
    throw new Error('该洛雪音源没有声明可搜索的平台（酷狗 / QQ）')
  }
  const settled = await Promise.allSettled(
    platforms.map((platform) => SEARCHERS[platform](keyword, page))
  )
  const items: MusicSong[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  settled.forEach((result, index) => {
    const platform = platforms[index]
    if (result.status === 'rejected') {
      errors.push(`${LX_PLATFORM_LABEL[platform]}：${result.reason instanceof Error ? result.reason.message : '搜索失败'}`)
      return
    }
    const qualities = qualitiesFor(meta, platform)
    for (const song of result.value) {
      const key = `${song.platform}:${song.songId}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        id: encodeLxSongId(song.platform, song.musicInfo),
        name: song.name,
        artists: song.artists,
        album: song.album,
        cover: song.cover,
        durationMs: song.durationMs,
        platform: source.id,
        baseUrl: source.baseUrl,
        origin: song.platform,
        qualities
      })
    }
  })
  // 各平台接口顺序不同：同名 / 以关键词开头的歌排前面，KTV、伴奏等靠后
  const key = keyword.trim().toLowerCase()
  const rank = (item: MusicSong): number => {
    const name = item.name.trim().toLowerCase()
    const artists = item.artists.trim().toLowerCase()
    if (name === key) return 0
    if (name.startsWith(key)) return 1
    if (name.includes(key)) return 2
    if (artists === key) return 3
    return 4
  }
  items.sort((a, b) => rank(a) - rank(b))
  return { items, errors }
}
