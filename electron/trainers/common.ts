import { parse } from 'node-html-parser'
import { fetchSubjectDetail, searchSubjects } from '../douban'
import {
  TRAINER_SOURCE_TYPE_LABEL,
  type TrainerSourceInput,
  type TrainerSourceType
} from '../../src/shared/trainers'

export type TrainerCategory = 'trainer' | 'save'
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
export const MAX_DOWNLOAD = 300 * 1024 * 1024

export const MONTHS: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12'
}

export interface NormalizedSource {
  id: string
  type: TrainerSourceType
  baseUrl: string
  name: string
}

export function normalizeSource(input: TrainerSourceInput): NormalizedSource | null {
  if (!input || typeof input !== 'object') return null
  if (
    input.type !== 'fling' &&
    input.type !== 'megagames' &&
    input.type !== '3dm' &&
    input.type !== 'gamersky' &&
    input.type !== 'ali213'
  ) {
    return null
  }
  if (typeof input.baseUrl !== 'string' || !/^https?:\/\//i.test(input.baseUrl.trim())) return null
  return {
    id: typeof input.id === 'string' ? input.id : input.type,
    type: input.type,
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
    name:
      typeof input.name === 'string' && input.name.trim()
        ? input.name.trim()
        : TRAINER_SOURCE_TYPE_LABEL[input.type].split('（')[0]
  }
}

export function sameHost(url: string, baseUrl: string): boolean {
  try {
    const target = new URL(url)
    const base = new URL(baseUrl)
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return false
    return target.hostname === base.hostname || target.hostname.endsWith(`.${base.hostname}`)
  } catch {
    return false
  }
}

export function absUrl(raw: string, base: string): string {
  try {
    return new URL(raw, base).toString()
  } catch {
    return ''
  }
}

export function safeName(raw: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return (cleaned || `修改器-${Date.now()}`).slice(0, 80)
}

export async function fetchText(url: string, referer?: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: referer ?? url
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000)
  })
  if (!res.ok) throw new Error(`站点返回 HTTP ${res.status}`)
  const html = await res.text()
  if (!html.trim()) throw new Error('站点返回空内容')
  return html
}

export function linesOf(el: { innerHTML: string; text: string }): string[] {
  const withBreaks = el.innerHTML
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
  const text = parse(`<div>${withBreaks}</div>`, { comment: false }).querySelector('div')?.text
  return (text ?? el.text)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** 跨源去重用：去掉版本号 / +N Trainer / 来源后缀，只保留游戏名 */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/v?\d+(?:\.\d+)*(?:\.\*)?\+?/g, '')
    .replace(/plus\s*\.?\s*\d+/g, '')
    .replace(/trainer|修改器|多功能|update|更新/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
}

/* ------------------------------ 风灵月影 FLiNG ------------------------------ */


export function sourceCategory(source: NormalizedSource): TrainerCategory {
  if (source.type === '3dm') return /\/patch_20_/.test(source.baseUrl) ? 'save' : 'trainer'
  if (source.type === 'gamersky') return /\/sav\/?$/.test(source.baseUrl) ? 'save' : 'trainer'
  if (source.type === 'ali213') return /\/class5_/.test(source.baseUrl) ? 'save' : 'trainer'
  return 'trainer'
}

export const NETDISK_HOSTS = [
  'pan.baidu.com',
  'pan.quark.cn',
  'pan.xunlei.com',
  'aliyundrive.com',
  'alipan.com',
  '123pan.com',
  '123684.com',
  'cloud.189.cn',
  'db4.gamersky.com',
  'db5.gamersky.com'
]

/** 网盘 / 网页地址：详情里只提供「打开网页」，不当作文件下载 */
export function isNetdiskUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase()
    return NETDISK_HOSTS.some((entry) => host === entry || host.endsWith(`.${entry}`))
  } catch {
    return false
  }
}

/** 迅雷专用链接：thunder://base64("AA"+url+"ZZ") */
export function decodeThunder(raw: string): string {
  try {
    const text = Buffer.from(raw.replace(/^thunder:\/\//i, ''), 'base64').toString('utf8')
    return text.replace(/^AA/, '').replace(/ZZ$/, '')
  } catch {
    return ''
  }
}

/* ---------- 3DM ---------- */

/** 3DM 列表页没有封面，按详情页 og:image 补齐；成功缓存 6 小时，失败 10 分钟后重试 */
export const COVER_TTL = 6 * 60 * 60 * 1000
export const COVER_FAIL_TTL = 10 * 60 * 1000
export const trainerCoverCache = new Map<string, { at: number; cover: string | null }>()


export async function runWithLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const current = items[index]
      index += 1
      if (current === undefined) return
      await worker(current)
    }
  })
  await Promise.all(runners)
}

/** 同一游戏的多条修改器共用一张游戏封面，按游戏名去重后再并发抓取 */

export function englishNamesFromInfo(info: string): string[] {
  const out: string[] = []
  for (const line of info.split(/\n|　+/)) {
    const match = /(?:又名|原名|英文名|外文名)\s*[:：]\s*(.+)/.exec(line)
    if (!match) continue
    for (const raw of match[1].split('/')) {
      const name = raw.replace(/\s+/g, ' ').trim()
      if (name.length >= 3 && /[a-zA-Z]{3}/.test(name)) out.push(name)
    }
  }
  return out
}

/** 豆瓣标题常见「中文 English Name」：取其中最长的一段拉丁字母作为英文名 */
export function englishFromTitle(title: string): string {
  const matches = title.match(/[A-Za-z][A-Za-z0-9:'’.\-& ]{3,}/g) ?? []
  const names = matches
    .map((raw) => raw.replace(/\s+/g, ' ').replace(/[.:'’\-& ]+$/g, '').trim())
    .filter((name) => /[A-Za-z]{3}/.test(name))
    .sort((a, b) => b.length - a.length)
  return names[0] ?? ''
}

const translationCache = new Map<string, string>()

export async function translateGameName(keyword: string): Promise<string> {
  if (!/[\u4e00-\u9fa5]/.test(keyword) || /[a-zA-Z]{3}/.test(keyword)) return ''
  const cached = translationCache.get(keyword)
  if (cached !== undefined) return cached
  try {
    const search = await searchSubjects('game', keyword)
    if (!search.ok) return ''
    for (const item of search.items.slice(0, 3)) {
      const fromTitle = englishFromTitle(item.title)
      if (fromTitle) {
        translationCache.set(keyword, fromTitle)
        return fromTitle
      }
      const detail = await fetchSubjectDetail('game', item.id)
      const info = detail.ok ? detail.detail?.info ?? '' : ''
      const names = englishNamesFromInfo(info)
      if (names.length) {
        translationCache.set(keyword, names[0])
        return names[0]
      }
    }
  } catch {
    // 豆瓣不可用时按原关键词搜索
  }
  return ''
}

/* ------------------------------ 多源聚合 ------------------------------ */

