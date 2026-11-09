import type {
  MusicQuality,
  MusicResolveResponse,
  MusicSearchResponse,
  MusicSong,
  MusicSourceInput,
  MusicTestResult
} from '../src/shared/music'
import { DEFAULT_MUSIC_BASE_URLS, DEFAULT_MUSIC_SOURCES } from '../src/shared/music'
import { isLxScriptUrl, resolveLxMusicUrl } from './lxSource'
import { decodeLxSongId, fetchLxLyric, searchLxSource } from './musicPlatforms'

/**
 * 在线音乐：音源配置在「配置管理 → 片源管理 → 音乐源」里维护
 * （默认无名音乐网 mvmp3 + 闪闪音乐网 33ve；无损音乐 flac.music.hi.cn 适配器保留，默认源暂时下线）。
 *
 * 无名音乐 / 33ve 是同一套建站系统，接口完全一致：
 * 搜索：GET /so.php?wd=&page=，服务端渲染 HTML
 * 直链：POST /style/js/play.php 表单 id + type=dance → JSON { url, lrc, pic, name, singer }
 *
 * 无损音乐（flac.music.hi.cn）是另一套 JSON 接口，按 baseUrl 主机名自动识别：
 * 搜索：POST /ajax.php?act=search  platform=kuwo&keyword=&page=&size=20
 * 直链：POST /ajax.php?act=getUrl   platform=kuwo&songid=&format=&bitrate=&time=&sign=
 * 直链必须带搜索结果里的 time + sign（sign 只绑 songid，换 format / bitrate 仍然有效）；
 * 站点酷我（kuwo）能直接返回直链；网易云（wyy）的 getUrl 目前全量报「接口请求失败」，
 * 解析时依次尝试：站点 getUrl → 网易云官方匿名接口（免费歌给完整直链，会员歌只有 30~45 秒试听）
 * → 酷我同名同歌手替代音源。歌曲 id 编码为 hi~kuwo~<songid>~<time>~<sign>，
 * 收藏 / 下载 / 重开应用后仍能直接解析。
 *
 * 主进程只接收调用方传入的 { id, baseUrl }，不保存音源配置。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const RESOLVE_TTL_MS = 4 * 60 * 1000
const resolveCache = new Map<string, { url: string; lrc: string; cover: string; at: number }>()

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

function sourceLabel(source: MusicSourceInput): string {
  return source.name?.trim() || normalizeBase(source.baseUrl)
}

/** 无损音乐站（flac.music.hi.cn）：按主机名识别，允许用户填镜像子域 */
function isHiSource(source: { baseUrl: string }): boolean {
  try {
    const host = new URL(normalizeBase(source.baseUrl)).hostname.toLowerCase()
    return host === 'music.hi.cn' || host.endsWith('.music.hi.cn')
  } catch {
    return false
  }
}

const HI_PREFIX = 'hi~'
const HI_PAGE_SIZE = 20

interface HiMinfo {
  format?: string
  bitrate?: string
  size?: string
}

interface HiSong {
  id?: string | number
  name?: string
  artist?: string
  album_name?: string
  pic_url?: string
  duration?: string | number
  minfo?: HiMinfo[]
  time?: string | number
  sign?: string
}

interface HiResponse {
  code?: number
  msg?: string
  data?: {
    list?: HiSong[]
    total?: number
    url?: string
    format?: string
    bitrate?: number
  }
}

interface HiSongId {
  platform: 'kuwo' | 'wyy'
  songId: string
  time: string
  sign: string
}

/** 歌曲 id：hi~<platform>~<songid>~<time>~<sign>（收藏 / 下载后重开应用仍可直接解析） */
function encodeHiId(platform: HiSongId['platform'], song: HiSong): string | null {
  const id = song.id == null ? '' : String(song.id).trim()
  const time = song.time == null ? '' : String(song.time).trim()
  const sign = (song.sign ?? '').trim()
  if (!/^\d+$/.test(id) || !/^\d+$/.test(time) || !/^[0-9a-f]{32}$/i.test(sign)) return null
  return `${HI_PREFIX}${platform}~${id}~${time}~${sign}`
}

function parseHiId(songId: string): HiSongId | null {
  if (!songId.startsWith(HI_PREFIX)) return null
  const parts = songId.split('~')
  if (parts.length !== 5) return null
  const [, platform, id, time, sign] = parts
  if (platform !== 'kuwo' && platform !== 'wyy') return null
  if (!/^\d+$/.test(id) || !/^\d+$/.test(time) || !/^[0-9a-f]{32}$/i.test(sign)) return null
  return { platform, songId: id, time, sign }
}

async function hiPost(
  baseUrl: string,
  act: 'search' | 'getUrl',
  params: Record<string, string>
): Promise<HiResponse> {
  const res = await fetch(`${baseUrl}/ajax.php?act=${act}`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Referer: `${baseUrl}/`
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`站点返回 HTTP ${res.status}`)
  const text = await res.text()
  try {
    return JSON.parse(text) as HiResponse
  } catch {
    throw new Error('站点返回异常')
  }
}

/** 酷我 / 网易云共用同一套搜索接口；歌曲 id 里带平台，解析时按平台走不同兜底 */
async function searchHiPlatform(
  base: string,
  sourceId: string,
  platform: HiSongId['platform'],
  keyword: string,
  page: number
): Promise<MusicSong[]> {
  const data = await hiPost(base, 'search', {
    platform,
    keyword,
    page: String(Math.max(1, page)),
    size: String(HI_PAGE_SIZE)
  })
  if (data.code !== 0) throw new Error(data.msg || '搜索失败')
  const items: MusicSong[] = []
  for (const song of data.data?.list ?? []) {
    const id = encodeHiId(platform, song)
    const name = (song.name ?? '').trim()
    if (!id || !name) continue
    const seen = new Set<string>()
    const qualities: MusicQuality[] = []
    for (const m of song.minfo ?? []) {
      const format = (m.format ?? '').trim().toLowerCase()
      const bitrate = String(m.bitrate ?? '').trim()
      if (!format || !bitrate) continue
      // 网易云匿名接口最高只有 MP3 320kbps，不展示站点标称的 FLAC，避免选项与实际不符
      if (platform === 'wyy' && format !== 'mp3') continue
      const key = `${format}/${bitrate}`
      if (seen.has(key)) continue
      seen.add(key)
      qualities.push({ format, bitrate, size: (m.size ?? '').trim() || undefined })
    }
    items.push({
      id,
      name,
      artists: (song.artist ?? '').trim(),
      album: (song.album_name ?? '').trim(),
      cover: (song.pic_url ?? '').trim(),
      durationMs: Math.max(0, Number(song.duration) || 0) * 1000,
      platform: sourceId,
      baseUrl: base,
      origin: platform,
      qualities
    })
  }
  return items
}

/** 无损音乐：酷我 + 网易云一起搜，单边失败不影响另一边 */
async function searchHi(
  source: MusicSourceInput,
  keyword: string,
  page: number
): Promise<MusicSong[]> {
  const base = normalizeBase(source.baseUrl)
  const [kuwo, wyy] = await Promise.allSettled([
    searchHiPlatform(base, source.id, 'kuwo', keyword, page),
    searchHiPlatform(base, source.id, 'wyy', keyword, page)
  ])
  const items: MusicSong[] = []
  const errors: string[] = []
  if (kuwo.status === 'fulfilled') items.push(...kuwo.value)
  else errors.push(`酷我：${kuwo.reason instanceof Error ? kuwo.reason.message : '搜索失败'}`)
  if (wyy.status === 'fulfilled') items.push(...wyy.value)
  else errors.push(`网易云：${wyy.reason instanceof Error ? wyy.reason.message : '搜索失败'}`)
  if (!items.length && errors.length === 2) throw new Error(errors.join('；'))
  return items
}

/** 用 time + sign 取直链；站点会按可用音质自动降级（flac 请求也可能返回 mp3 地址） */
async function hiGetUrl(base: string, id: HiSongId, quality?: MusicQuality): Promise<string> {
  const defaults = [
    { format: 'flac', bitrate: '2000' },
    { format: 'mp3', bitrate: '320' },
    { format: 'mp3', bitrate: '128' }
  ]
  const preferred =
    quality?.format && quality?.bitrate
      ? { format: quality.format, bitrate: quality.bitrate }
      : null
  // 用户选了低音质时只往下退，不要偷偷换成更大的文件
  const limit = preferred ? Number(preferred.bitrate) || 0 : Number.POSITIVE_INFINITY
  const steps = [
    ...(preferred ? [preferred] : []),
    ...defaults.filter(
      (step) =>
        Number(step.bitrate) <= limit &&
        !(preferred && step.format === preferred.format && step.bitrate === preferred.bitrate)
    )
  ]
  let lastError = '取播放直链失败'
  for (const step of steps) {
    try {
      const data = await hiPost(base, 'getUrl', {
        platform: id.platform,
        songid: id.songId,
        format: step.format,
        bitrate: step.bitrate,
        time: id.time,
        sign: id.sign
      })
      const url = typeof data.data?.url === 'string' ? data.data.url : ''
      if (data.code === 0 && url.startsWith('http')) return url
      lastError = data.msg || '站点未返回直链'
    } catch (err) {
      lastError = err instanceof Error ? err.message : '取直链失败'
    }
  }
  throw new Error(lastError)
}

const NETEASE_LEVEL: Record<string, string> = {
  '128': 'standard',
  '320': 'exhigh'
}

async function neteaseJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: 'https://music.163.com/',
      Cookie: 'os=pc; appver=8.9.70; osver=Microsoft-Windows-10-Professional-build-19045-64bit'
    },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`网易云返回 HTTP ${res.status}`)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('网易云返回异常')
  }
}

/** 网易云官方匿名接口：免费歌曲给完整直链，会员歌曲只给 30~45 秒试听 */
async function neteasePlayUrl(
  songId: string,
  quality?: MusicQuality
): Promise<{ url: string; trial: boolean } | null> {
  const level = NETEASE_LEVEL[quality?.bitrate ?? ''] ?? 'exhigh'
  try {
    const raw = (await neteaseJson(
      `https://music.163.com/api/song/enhance/player/url/v1?ids=%5B${encodeURIComponent(songId)}%5D&level=${level}&encodeType=mp3`
    )) as { data?: { url?: string | null; freeTrialInfo?: unknown }[] }
    const entry = raw.data?.[0]
    const url = typeof entry?.url === 'string' ? entry.url : ''
    if (!url.startsWith('http')) return null
    return { url, trial: !!entry?.freeTrialInfo }
  } catch {
    return null
  }
}

async function neteaseLyric(songId: string): Promise<string> {
  try {
    const raw = (await neteaseJson(
      `https://music.163.com/api/song/lyric?id=${encodeURIComponent(songId)}&lv=1&kv=1&tv=-1`
    )) as { lrc?: { lyric?: string } }
    return (raw.lrc?.lyric ?? '').trim()
  } catch {
    return ''
  }
}

/** 网易云歌曲在酷我找同名同歌手的替代音源（找不到就宁可失败，不要放错歌） */
async function findKuwoMatch(
  base: string,
  title: string,
  artists: string
): Promise<MusicSong | null> {
  const keyword = [title.trim(), artists.trim()].filter(Boolean).join(' ')
  if (!keyword) return null
  try {
    const items = await searchHiPlatform(base, 'hi', 'kuwo', keyword, 1)
    const norm = (value: string): string => value.trim().toLowerCase()
    const firstArtist = artists.split(/[/&、,]/)[0]?.trim() ?? ''
    return (
      items.find(
        (item) =>
          norm(item.name) === norm(title) &&
          !!firstArtist &&
          norm(item.artists).includes(norm(firstArtist))
      ) ?? null
    )
  } catch {
    return null
  }
}

async function resolveWyy(
  base: string,
  id: HiSongId,
  title: string,
  artists: string,
  quality?: MusicQuality
): Promise<MusicResolveResponse> {
  const lrcPromise = neteaseLyric(id.songId)
  let siteError = ''
  try {
    const url = await hiGetUrl(base, id, quality)
    return { ok: true, url, lrc: await lrcPromise }
  } catch (err) {
    siteError = err instanceof Error ? err.message : '网易云接口请求失败'
  }
  // 站点网易云接口坏了：先用网易云官方接口拿免费完整直链，再退酷我同名同歌手
  const [original, lrc] = await Promise.all([neteasePlayUrl(id.songId, quality), lrcPromise])
  if (original && !original.trial) return { ok: true, url: original.url, lrc }
  const match = await findKuwoMatch(base, title, artists)
  if (match) {
    const fresh = parseHiId(match.id)
    if (fresh) {
      try {
        return { ok: true, url: await hiGetUrl(base, fresh, quality), lrc }
      } catch {
        // 继续走下面的失败提示
      }
    }
  }
  return {
    ok: false,
    error: original?.trial
      ? '网易云该歌曲需要会员（只能试听），且没有找到可替代音源'
      : `网易云接口请求失败：${siteError}`
  }
}

/** sign 过期 / 失效时按歌名 + 歌手重新搜一遍，拿新的 time + sign */
async function refreshHiId(
  base: string,
  id: HiSongId,
  title: string,
  artists: string
): Promise<HiSongId | null> {
  const keyword = [title.trim(), artists.trim()].filter(Boolean).join(' ')
  if (!keyword) return null
  try {
    const items = await searchHiPlatform(base, 'hi', 'kuwo', keyword, 1)
    const exact = items.find((item) => parseHiId(item.id)?.songId === id.songId)
    const sameName = items.find(
      (item) => title.trim() && item.name.trim().toLowerCase() === title.trim().toLowerCase()
    )
    const hit = exact ?? sameName ?? items[0]
    return hit ? parseHiId(hit.id) : null
  } catch {
    return null
  }
}

async function resolveHi(
  base: string,
  id: HiSongId,
  title?: string,
  artists?: string,
  quality?: MusicQuality
): Promise<MusicResolveResponse> {
  if (id.platform === 'wyy') {
    return resolveWyy(base, id, title ?? '', artists ?? '', quality)
  }
  try {
    return { ok: true, url: await hiGetUrl(base, id, quality) }
  } catch (err) {
    const fresh = await refreshHiId(base, id, title ?? '', artists ?? '')
    if (fresh) {
      try {
        return { ok: true, url: await hiGetUrl(base, fresh, quality) }
      } catch {
        // 用刷新后的错误继续走下面的兜底
      }
    }
    return { ok: false, error: err instanceof Error ? err.message : '取播放直链失败' }
  }
}

async function getPage(baseUrl: string, url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: `${baseUrl}/`
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

function parseSongs(html: string, source: MusicSourceInput): MusicSong[] {
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
    const size = block.match(/class="size"[^>]*>\s*大小[:：]\s*([^<]+)/)?.[1]?.trim() ?? ''
    items.push({
      id,
      name: name || title,
      artists,
      album: '',
      cover,
      durationMs: parseDuration(duration),
      platform: source.id,
      baseUrl: normalizeBase(source.baseUrl),
      sizeHint: size || undefined
    })
  }
  return items
}

async function searchAt(
  source: MusicSourceInput,
  keyword: string,
  page: number
): Promise<MusicSong[]> {
  const base = normalizeBase(source.baseUrl)
  if (source.kind === 'lx' || isLxScriptUrl(source.baseUrl)) {
    const { items, errors } = await searchLxSource(source, keyword, page)
    if (!items.length) throw new Error(errors.join('；') || '没有搜到歌曲')
    return items
  }
  if (isHiSource(source)) return searchHi(source, keyword, page)
  const html = await getPage(
    base,
    `${base}/so.php?wd=${encodeURIComponent(keyword)}&page=${Math.max(1, page)}`
  )
  return parseSongs(html, source)
}

/** 搜索：按传入的源顺序依次尝试，第一个有结果的源直接返回 */
export async function searchMusic(
  sources: MusicSourceInput[],
  rawKeyword: string,
  page = 1
): Promise<MusicSearchResponse> {
  const keyword = rawKeyword.trim()
  if (!keyword) return { ok: true, items: [] }
  const list = sources
    .filter((s) => s && typeof s.baseUrl === 'string' && /^https?:\/\//i.test(s.baseUrl))
    .sort((a, b) => {
      // 「全部源」优先用洛雪脚本（酷我 / 酷狗 / QQ / 网易云），失败再回落到站点源
      const la = a.kind === 'lx' || isLxScriptUrl(a.baseUrl) ? 0 : 1
      const lb = b.kind === 'lx' || isLxScriptUrl(b.baseUrl) ? 0 : 1
      return la - lb
    })
  if (!list.length) {
    return { ok: false, items: [], error: '没有启用的音乐源，请到「配置管理 → 片源管理」启用' }
  }
  const errors: string[] = []
  for (const source of list) {
    try {
      const items = await searchAt(source, keyword, page)
      if (items.length) return { ok: true, items }
      errors.push(`${sourceLabel(source)}：没有搜到歌曲`)
    } catch (err) {
      errors.push(`${sourceLabel(source)}：${err instanceof Error ? err.message : '搜索失败'}`)
    }
  }
  return { ok: false, items: [], error: errors.join('；') }
}

/** 音源测试：用固定关键词搜一次，返回条目数（洛雪源再验证一首能否解析直链） */
export async function testMusicSource(source: MusicSourceInput): Promise<MusicTestResult> {
  if (!source || !/^https?:\/\//i.test(source.baseUrl ?? '')) {
    return { ok: false, error: '音源地址无效' }
  }
  try {
    const items = await searchAt(source, 'love', 1)
    if (source.kind === 'lx' || isLxScriptUrl(source.baseUrl)) {
      // 有些脚本只对部分平台有效：按平台各取一首试解析，任意一个成功就算可用
      const candidates = items
        .filter(
          (item, index, list) =>
            decodeLxSongId(item.id) &&
            list.findIndex((other) => other.origin === item.origin) === index
        )
        .slice(0, 5)
      let lastError = '没有可解析的歌曲'
      for (const item of candidates) {
        const decoded = decodeLxSongId(item.id)
        if (!decoded) continue
        try {
          await resolveLxMusicUrl(
            normalizeBase(source.baseUrl),
            decoded.platform,
            decoded.musicInfo
          )
          return {
            ok: true,
            count: items.length,
            message: `可用，搜索到 ${items.length} 首，播放解析正常`
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : '未知错误'
        }
      }
      return {
        ok: false,
        count: items.length,
        error: `搜索到 ${items.length} 首，但解析失败：${lastError}`
      }
    }
    return { ok: true, count: items.length, message: `可用，搜索到 ${items.length} 首` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '测试失败' }
  }
}

interface PlayJson {
  url?: string
  lrc?: string
  pic?: string
  name?: string
  singer?: string
}

async function requestPlay(
  baseUrl: string,
  id: string,
  type: string
): Promise<PlayJson> {
  const res = await fetch(`${baseUrl}/style/js/play.php`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${baseUrl}/`
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
  platform = 'mvmp3',
  baseUrl?: string,
  title?: string,
  artists?: string,
  quality?: MusicQuality
): Promise<MusicResolveResponse> {
  const base = normalizeBase(baseUrl ?? '') || DEFAULT_MUSIC_BASE_URLS[platform] || ''
  const lxSong = decodeLxSongId(songId)
  if (lxSong) {
    if (!isLxScriptUrl(base)) {
      return { ok: false, error: '洛雪音源脚本地址无效，请到「配置管理 → 片源管理 → 音乐源」重新启用' }
    }
    const qualityKey = quality?.format && quality?.bitrate ? `${quality.format}/${quality.bitrate}` : ''
    const cacheKey = `${base}:${songId}:${qualityKey}`
    const cached = resolveCache.get(cacheKey)
    if (cached && Date.now() - cached.at < RESOLVE_TTL_MS) {
      return { ok: true, url: cached.url, lrc: cached.lrc, cover: cached.cover }
    }
    try {
      const [url, lrc] = await Promise.all([
        resolveLxMusicUrl(base, lxSong.platform, lxSong.musicInfo, quality),
        fetchLxLyric(lxSong.platform, lxSong.musicInfo)
      ])
      resolveCache.set(cacheKey, { url, lrc, cover: '', at: Date.now() })
      return { ok: true, url, lrc }
    } catch (err) {
      return {
        ok: false,
        error: `洛雪音源解析失败：${err instanceof Error ? err.message : '未知错误'}`
      }
    }
  }

  const hiId = parseHiId(songId)
  if (!hiId && !/^[0-9a-f]{32}$/i.test(songId)) return { ok: false, error: '歌曲编号无效' }
  if (!/^https?:\/\//i.test(base)) {
    return { ok: false, error: '未知音源，请到「配置管理 → 片源管理」启用对应音乐源' }
  }
  const qualityKey = quality?.format && quality?.bitrate ? `${quality.format}/${quality.bitrate}` : ''
  const cacheKey = `${base}:${songId}:${qualityKey}`
  const cached = resolveCache.get(cacheKey)
  if (cached && Date.now() - cached.at < RESOLVE_TTL_MS) {
    return { ok: true, url: cached.url, lrc: cached.lrc, cover: cached.cover }
  }

  if (hiId) {
    const resolved = await resolveHi(base, hiId, title, artists, quality)
    if (resolved.ok && resolved.url) {
      resolveCache.set(cacheKey, {
        url: resolved.url,
        lrc: resolved.lrc ?? '',
        cover: resolved.cover ?? '',
        at: Date.now()
      })
    }
    return resolved
  }

  let lastError = '取播放直链失败'
  for (const type of ['dance', 'music', 'mp3']) {
    try {
      const data = await requestPlay(base, songId, type)
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
 * 拿「歌名 + 歌手」依次去默认音乐源搜同名歌，命中后解析直链。
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

  for (const source of DEFAULT_MUSIC_SOURCES) {
    let candidates: MusicSong[]
    try {
      candidates = await searchAt(source, keyword || title, 1)
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
    const resolved = await resolveMusic(target.id, source.id, source.baseUrl, title, artists)
    if (resolved.ok) return resolved
  }
  return { ok: false, error: '默认音乐源里也没有找到同名歌曲' }
}
