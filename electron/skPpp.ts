import { parse } from 'node-html-parser'
import type {
  SkCatalogResponse,
  SkCategory,
  SkDetailResponse,
  SkItem,
  SkPlayResponse
} from '../src/shared/shuangkan'
import { SK_PPP_BASE } from '../src/shared/shuangkan'
import { formatDuration } from '../src/shared/xsite'
import {
  GO_COOKIE,
  GO_UA,
  SiteResolver,
  absoluteUrl,
  attr,
  clampPage,
  decodeEntities,
  requestSite,
  text
} from './gohome'

/**
 * 爽看的「亚洲素人精选」（PPP.Porn / 591av.ws）源：
 * KVS 模板，列表 .card-video，详情页播放地址在 var stream = '...m3u8' 里。
 */

const resolver = new SiteResolver({
  defaultBase: SK_PPP_BASE,
  match: /亚洲素人|素人精选|素人精選/i,
  label: '亚洲素人精选',
  cookie: GO_COOKIE
})

const UA = { ua: GO_UA, cookie: GO_COOKIE }
const ID_RE = /^[A-Za-z0-9]{3,64}$/

/** 镜像忽略 ?page= 查询参数，KVS 分页必须走路径：/new/N/ 与 /categories/<slug>/N/ */
function pathOf(category: string, page: number): string {
  if (!category) return `/new/${Math.max(1, page)}/`
  return page > 1 ? `/categories/${category}/${page}/` : `/categories/${category}/`
}

function itemIdOf(href: string): string {
  let path = href
  try {
    path = new URL(href, 'https://591av.ws').pathname
  } catch {
    path = href
  }
  const matched = /\/v\/([A-Za-z0-9]+)\/?/.exec(path)
  return matched ? matched[1] : ''
}

function parseItems(root: ReturnType<typeof parse>, base: string): SkItem[] {
  const out: SkItem[] = []
  const seen = new Set<string>()
  for (const card of root.querySelectorAll('.card-video')) {
    const anchor = card.querySelector('.card-video__title a') ?? card.querySelector('a[href*="/v/"]')
    if (!anchor) continue
    const id = itemIdOf(attr(anchor, 'href'))
    if (!id || seen.has(id)) continue
    const img = card.querySelector('img')
    const title =
      text(anchor.text) ||
      text(attr(img, 'alt'))
    if (!title) continue
    const duration = text(card.querySelector('.card-video__duration')?.text)
    const stats = text(card.querySelector('.card-video__stats')?.text)
    seen.add(id)
    out.push({
      id,
      title,
      cover: absoluteUrl(attr(img, 'data-src') || attr(img, 'src'), base),
      duration,
      meta: [stats].filter((value) => !!value)
    })
  }
  return out
}

let categoriesCache: { base: string; at: number; list: SkCategory[] } | null = null

/** 分类在 /categories/ 独立页（.card-cat-v2__link），列表页里没有 */
async function loadCategories(base: string): Promise<SkCategory[]> {
  if (
    categoriesCache &&
    categoriesCache.base === base &&
    Date.now() - categoriesCache.at < 30 * 60 * 1000
  ) {
    return categoriesCache.list
  }
  try {
    const { html } = await requestSite(resolver, '/categories/', base, UA)
    const root = parse(html)
    const out: SkCategory[] = []
    const seen = new Set<string>()
    for (const anchor of root.querySelectorAll('a[href*="/categories/"]')) {
      const href = attr(anchor, 'href')
      const matched = /\/categories\/([^/?#]+)\/?$/.exec(href)
      if (!matched) continue
      let slug = matched[1]
      try {
        slug = decodeURIComponent(slug)
      } catch {
        // 保持原样
      }
      if (seen.has(slug)) continue
      const raw = text(anchor.text).replace(/\s+/g, ' ').trim()
      // 文本形如 "8943 影片 中国AV"
      const counted = /^(\d+)\s*影片\s*(.+)$/.exec(raw)
      const label = counted ? counted[2] : raw
      if (!label) continue
      seen.add(slug)
      out.push({
        slug,
        label,
        count: counted ? Number(counted[1]) : undefined
      })
      if (out.length >= 60) break
    }
    if (out.length) {
      categoriesCache = { base, at: Date.now(), list: out }
      return out
    }
    return categoriesCache?.base === base ? categoriesCache.list : []
  } catch {
    return categoriesCache?.base === base ? categoriesCache.list : []
  }
}

/** 分页条文本形如 1/1315，分类 / 搜索页也一致 */
function lastPageOf(root: ReturnType<typeof parse>, current: number): number {
  let max = current
  const label = text(root.querySelector('.pagination')?.text).replace(/\s+/g, ' ')
  const matched = /(\d+)\s*\/\s*(\d+)(?!\d)/.exec(label)
  if (matched) max = Math.max(max, Number(matched[2]))
  for (const anchor of root.querySelectorAll('a[href*="/new/"], a[href*="?page="]')) {
    const href = attr(anchor, 'href')
    const page = /\/new\/(\d+)\//.exec(href) ?? /[?&]page=(\d+)/.exec(href)
    if (page) max = Math.max(max, Number(page[1]))
  }
  return max
}

export async function pppCatalog(
  category: string,
  page: number,
  baseUrl?: string
): Promise<SkCatalogResponse> {
  const current = clampPage(page)
  try {
    const { html, base } = await requestSite(resolver, pathOf(category, current), baseUrl, UA)
    const root = parse(html)
    const items = parseItems(root, base)
    const categories = category ? [] : await loadCategories(base)
    const reported = lastPageOf(root, current)
    return {
      ok: true,
      items,
      page: current,
      lastPage: items.length ? Math.max(reported, current + 1) : Math.max(reported, current),
      categories
    }
  } catch (err) {
    return {
      ok: false,
      items: [],
      page: current,
      lastPage: current,
      categories: [],
      error: err instanceof Error ? err.message : '加载失败'
    }
  }
}

/**
 * 搜索分页走 KVS 的 AJAX 接口：GET 路径 /search/<kw>/2/ 会 404，
 * ?page=N 也会被忽略，只有 get_block + from_videos/from_albums 能翻页。
 */
const SEARCH_BLOCK = 'list_videos_videos_list_search_result'

function searchPathOf(keyword: string, page: number): string {
  const q = encodeURIComponent(keyword)
  if (page <= 1) return `/search/?q=${q}`
  return (
    `/search/?q=${q}&mode=async&function=get_block&block_id=${SEARCH_BLOCK}` +
    `&q=${q}&category_ids=&sort_by=&from_videos=${page}&from_albums=${page}`
  )
}

export async function pppSearch(
  keyword: string,
  page: number,
  baseUrl?: string
): Promise<SkCatalogResponse> {
  const current = clampPage(page)
  try {
    const { html, base } = await requestSite(
      resolver,
      searchPathOf(keyword, current),
      baseUrl,
      UA
    )
    const root = parse(html)
    const items = parseItems(root, base)
    const reported = lastPageOf(root, current)
    return {
      ok: true,
      items,
      page: current,
      lastPage: Math.max(reported, current),
      categories: []
    }
  } catch (err) {
    return {
      ok: false,
      items: [],
      page: current,
      lastPage: current,
      categories: [],
      error: err instanceof Error ? err.message : '搜索失败'
    }
  }
}

/**
 * 站点 CDN 会把详情页缓存数小时，缓存里的 var stream 播放令牌（约 3 小时有效）
 * 往往已经过期，直接播就是 410。带一次性参数强制回源，才能拿到当前有效的令牌。
 */
function freshPath(id: string): string {
  return `/v/${id}/?t=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export async function pppDetail(id: string, baseUrl?: string): Promise<SkDetailResponse> {
  if (!ID_RE.test(id)) return { ok: false, error: '无效的视频 ID' }
  try {
    const { html, base } = await requestSite(resolver, freshPath(id), baseUrl, UA)
    const root = parse(html)
    const playUrl = decodeEntities(
      /var\s+stream\s*=\s*'([^']+)'/.exec(html)?.[1] ??
        /var\s+stream\s*=\s*"([^"]+)"/.exec(html)?.[1] ??
        ''
    ).replace(/\\\//g, '/')
    if (!playUrl) return { ok: false, error: '页面没有播放数据' }
    const tags: string[] = []
    for (const anchor of root.querySelectorAll('a[href*="/categories/"]')) {
      const label = text(anchor.text)
      if (!label || label === '所有分类' || tags.includes(label)) continue
      tags.push(label)
      if (tags.length >= 12) break
    }
    const titleTag = text(root.querySelector('title')?.text).split(/\s+-\s+PPP/)[0] || ''
    const title = text(attr(root.querySelector('meta[property="og:title"]'), 'content')) || titleTag
    const cover =
      attr(root.querySelector('video[poster]'), 'poster') ||
      attr(root.querySelector('meta[property="og:image"]'), 'content')
    const durationSec = Number(
      /property="video:duration"\s+content="(\d+)"/.exec(html)?.[1] ?? 0
    )
    return {
      ok: true,
      detail: {
        id,
        source: 'video',
        title: title || '亚洲素人精选',
        cover: absoluteUrl(cover, base),
        intro: '',
        tags,
        meta: [],
        duration: formatDuration(durationSec),
        episodes: [],
        playUrl
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '加载失败' }
  }
}

export async function pppPlay(id: string, baseUrl?: string): Promise<SkPlayResponse> {
  const res = await pppDetail(id, baseUrl)
  if (!res.ok || !res.detail?.playUrl) {
    return { ok: false, error: res.error || '没有解析到播放地址' }
  }
  const playUrl = res.detail.playUrl
  // v0.122：KVS 站点对较老的视频会直接给出已过期 / 已失效的播放链接，请求只会得到
  // 410 Gone（或 403 / 404），渲染层看起来就是「线路失效」。提前识别并说清楚。
  // ① 地址里带过期时间戳（/stream/<签名>/<过期秒>/…）时先按时间判断，省一次请求
  const expire = /\/stream\/[^/]+\/(\d{9,11})\//.exec(playUrl)?.[1]
  if (expire && Number(expire) * 1000 < Date.now()) {
    return { ok: false, error: '这个视频的播放权限已失效（站点侧过期），请换一个视频' }
  }
  // ② 兜底实际探一次清单头：时间戳不一定每次都带，站点也会直接删资源
  try {
    const probe = await fetch(playUrl, {
      headers: { 'User-Agent': GO_UA, Cookie: GO_COOKIE, Referer: baseUrl || 'https://591av.ws/' },
      redirect: 'follow',
      signal: AbortSignal.timeout(6_000)
    })
    if (probe.status === 410 || probe.status === 404 || probe.status === 403) {
      return { ok: false, error: '这个视频的播放权限已失效（站点侧过期），请换一个视频' }
    }
  } catch {
    // 探活失败不阻断播放，交给渲染层重试
  }
  return { ok: true, url: playUrl }
}
