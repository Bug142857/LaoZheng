import { app, dialog } from 'electron'
import { join } from 'node:path'

import { writeFile } from 'node:fs/promises'


import { lastDialogDir, rememberDialogDir, settingsSnapshot } from '../settings'






import { doubanAuthStatus } from '../doubanAuth'

import { loadLiveSources } from '../live'















import { exportDownloadRecords } from '../downloads'



import { melonFetchImage, melonImageAuth } from '../melon'









import { komiicImageAuth } from '../komiic'








import { loadMagnetState } from '../magnet'








import type { LiveSource } from '../../src/shared/live'
import { type AppData } from '../../src/shared/types'
import type { SearchCategory, SubjectKind } from '../../src/shared/douban'
import type { VodSourceInput } from '../../src/shared/vod'
import type { DramaSourceInput } from '../../src/shared/drama'
import { NOVEL_SOURCE_TEMPLATES, type NovelSourceInput, type NovelSourceTemplate } from '../../src/shared/novel'


import { BIKA_UA, IMAGE_REFERER, IMAGE_UA, KOMIIC_UA, VOD_UA } from '../userAgents'
import { progress } from '../progress'



/** 备份 / 云同步统一出口：把只存在主进程的数据一起合并进备份 */
/**
 * 备份 / 云同步统一出口：把只存在主进程的数据（电视源、下载记录、本机设置、播放进度）
 * 一起合并进备份，避免导出或同步时漏掉。
 */
export async function buildBackupPayload(data: AppData): Promise<AppData> {
  const [liveSources, downloads, magnet] = await Promise.all([
    loadLiveSources(),
    exportDownloadRecords(),
    loadMagnetState()
  ])
  return {
    ...data,
    version: 1,
    // 磁力搜索结果只是本次运行的会话缓存（启动时会被 data:load 清掉），不写进备份 / 云同步
    magnetSearch: undefined,
    liveSources,
    downloads,
    // 磁力源属于用户配置，必须跟备份 / 云同步一起走
    magnetSources: magnet.sources,
    settings: settingsSnapshot(),
    // 播放进度已独立存储：合并主进程内存中的最新值，保证备份 / 云同步不丢进度
    readProgress: { ...data.readProgress, ...progress().peek() }
  }
}

export function snapshotsRoot(): string {
  return app.getPath('userData')
}

/** 轻量结构校验：只检查备份判据字段，防止渲染层异常数据写出坏 data.json */
export function isAppDataShape(data: unknown): data is AppData {
  if (!data || typeof data !== 'object') return false
  const value = data as Record<string, unknown>
  return (
    Array.isArray(value.items) &&
    Array.isArray(value.lists) &&
    Array.isArray(value.listItems) &&
    (value.version === undefined || typeof value.version === 'number')
  )
}

/** 图片下载：按站点补防盗链头，统一成 Buffer（图片右键保存用） */
export function imageHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': VOD_UA, Accept: 'image/*,*/*' }
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return headers
  }
  if (/(^|\.)doubanio\.com$|(^|\.)douban\.com$/.test(host)) {
    headers['Referer'] = IMAGE_REFERER
    headers['User-Agent'] = IMAGE_UA
  } else if (/(^|\.)phncdn\.com$/.test(host)) {
    headers['Referer'] = 'https://www.pornhub.com/'
    headers['Cookie'] = 'accessAgeDisclaimerPH=1; age_verified=1; accessPH=1'
  } else if (/(^|\.)komiic\.(com|cc)$/.test(host)) {
    try {
      const auth = komiicImageAuth(new URL(url))
      if (auth) {
        headers['Cookie'] = auth.cookie
        headers['Referer'] = auth.referer
        headers['User-Agent'] = KOMIIC_UA
      }
    } catch {
      // 非法 URL 用默认头
    }
  } else if (/(^|\.)picacomic\.com$|(^|\.)go2778\.com$/.test(host)) {
    headers['User-Agent'] = BIKA_UA
    headers['Referer'] = 'https://picaapi.picacomic.com/'
  } else if (/(^|\.)(mayiwsk\.info|biquges\.com)$/.test(host)) {
    headers['Referer'] = 'http://www.mayiwsk.info/'
    headers['User-Agent'] = VOD_UA
  } else if (/(^|\.)(95dushu\.info|jwdushu\.com)$/.test(host)) {
    headers['Referer'] = 'http://www.95dushu.info/'
    headers['User-Agent'] = VOD_UA
  } else if (/(^|\.)(xuanhuange\.info|xuanhuange\.net|xuanhuange\.com)$/.test(host)) {
    headers['Referer'] = 'http://www.xuanhuange.info/'
    headers['User-Agent'] = VOD_UA
  } else if (/(^|\.)(ecombdimg\.com|shimolife\.com)$/.test(host)) {
    // 漫画客封面 / 章节图：图床按来源页做防盗链
    headers['Referer'] = 'http://www.yumanhua.com/'
    headers['User-Agent'] = VOD_UA
  } else if (/(^|\.)haowallpaper\.com$/.test(host)) {
    headers['Referer'] = 'https://haowallpaper.com/'
  } else if (/(^|\.)wallspic\.com$/.test(host)) {
    headers['Referer'] = 'https://wallspic.com/'
  } else if (/(^|\.)bzee\.cn$/.test(host)) {
    // 壁纸迷图床（xz / imgtu 等子域）按来源页做防盗链
    headers['Referer'] = 'https://www.bizhimi.cn/'
  }
  return headers
}

export function sniffImageExt(contentType: string, fallback: string): string {
  const type = contentType.toLowerCase()
  if (type.includes('image/png')) return '.png'
  if (type.includes('image/webp')) return '.webp'
  if (type.includes('image/gif')) return '.gif'
  if (type.includes('image/jpeg')) return '.jpg'
  if (type.includes('image/avif')) return '.avif'
  return fallback
}

export async function saveImageToFile(
  rawUrl: string,
  nameHint?: string
): Promise<{ canceled: boolean; path?: string; error?: string }> {
  try {
    const url = rawUrl.trim()
    if (!url) return { canceled: false, error: '图片地址为空' }
    let buffer: Buffer
    let ext = '.jpg'
    const customName = typeof nameHint === 'string' && nameHint.trim().length > 0
    let base = customName ? nameHint.trim().slice(0, 80) : `老郑分享图片-${stamp()}`
    if (url.startsWith('data:')) {
      const match = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
      if (!match) return { canceled: false, error: '图片数据无效' }
      ext = sniffImageExt(match[1] ?? '', '.jpg')
      buffer = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]))
    } else {
      if (!/^https?:\/\//i.test(url)) return { canceled: false, error: '图片地址无效' }
      // 吃瓜图床是 AES 密文，必须走解密接口
      let melon = false
      try {
        melon = !!melonImageAuth(new URL(url))
      } catch {
        melon = false
      }
      if (melon) {
        const res = await melonFetchImage(url)
        if (!res.ok || !res.dataUrl) return { canceled: false, error: res.error ?? '图片解密失败' }
        return saveImageToFile(res.dataUrl)
      }
      const res = await fetch(url, {
        headers: imageHeaders(url),
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000)
      })
      if (!res.ok) return { canceled: false, error: `图片下载失败：HTTP ${res.status}` }
      buffer = Buffer.from(await res.arrayBuffer())
      ext = sniffImageExt(res.headers.get('content-type') ?? '', ext)
      if (!customName) {
        try {
          const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
          if (name && name.length <= 80) {
            base = name.replace(/\.[a-z0-9]+$/i, '') || base
          }
        } catch {
          // 用默认文件名
        }
      }
    }
    const picked = await dialog.showSaveDialog({
      title: '保存图片',
      defaultPath: join(
        lastDialogDir('image', app.getPath('pictures')),
        `${safeFileBase(base)}${ext}`
      ),
      filters: [{ name: '图片', extensions: ['jpg', 'png', 'webp', 'gif', 'avif'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    await rememberDialogDir('image', picked.filePath)
    await writeFile(picked.filePath, buffer)
    return { canceled: false, path: picked.filePath }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

export function safeFileBase(raw: string): string {
  return (
    raw
      .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || '图片'
  )
}

export function isLiveSource(value: unknown): value is LiveSource {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.url === 'string' &&
    (o.url.startsWith('http') || o.url.startsWith('local://')) &&
    typeof o.content === 'string'
  )
}

export function isVodSourceInput(value: unknown): value is VodSourceInput {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.baseUrl === 'string' &&
    /^https?:\/\//i.test(o.baseUrl) &&
    o.baseUrl.length <= 300
  )
}

export function isDramaSourceInput(value: unknown): value is DramaSourceInput {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  if (typeof o.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(o.id)) return false
  if (typeof o.name !== 'string' || o.name.length > 80) return false
  // 苹果CMS 短剧源必须带合法接口地址；内置源（西饭 / 肉视频 / 旧红果、河马）不需要
  if (o.baseUrl === undefined) {
    return o.id === 'xifan' || o.id === 'rou07' || o.id === 'hongguo' || o.id === 'hema'
  }
  return (
    typeof o.baseUrl === 'string' &&
    /^https?:\/\//i.test(o.baseUrl) &&
    o.baseUrl.length <= 300
  )
}

export function isNovelSourceInput(value: unknown): value is NovelSourceInput {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  if (typeof o.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(o.id)) return false
  if (typeof o.name !== 'string' || o.name.length > 80) return false
  if (typeof o.baseUrl !== 'string' || !/^https?:\/\//i.test(o.baseUrl) || o.baseUrl.length > 300) {
    return false
  }
  return NOVEL_SOURCE_TEMPLATES.includes(o.template as NovelSourceTemplate)
}

export const SEARCH_CATEGORIES = new Set<SearchCategory>(['video', 'book', 'game', 'person'])
export const SUBJECT_KINDS = new Set<SubjectKind>(['movie', 'tv', 'book', 'game'])

/** 豆瓣登录态变化后换一套缓存 key，避免登录前搜不到的老片一直命中旧缓存 */
export function doubanCacheScope(): string {
  const status = doubanAuthStatus()
  return status.loggedIn ? `in-${status.updatedAt}` : 'out'
}

export function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}


export const HOUR = 60 * 60 * 1000
export const DAY = 24 * HOUR
/** 修改器解析逻辑变更时递增，旧的搜索 / 详情缓存立即失效 */
export const TRAINER_CACHE_VERSION = 3
