import { parse } from 'node-html-parser'
import type {
  SkCatalogResponse,
  SkCategory,
  SkDetailResponse,
  SkItem,
  SkPlayResponse,
  SkSort
} from '../src/shared/shuangkan'
import { SK_XHAMSTER_BASE } from '../src/shared/shuangkan'
import { formatDuration } from '../src/shared/xsite'
import {
  GO_COOKIE,
  GO_MOBILE_UA,
  GO_UA,
  SiteResolver,
  absoluteUrl,
  attr,
  clampPage,
  decodeEntities,
  originOf,
  requestSite,
  text
} from './gohome'

/**
 * 爽看的 xhamster 源：镜像 zh.xhamster02.com 用桌面 UA 才有完整列表
 * （手机 UA 只渲染 5 条）。列表 .thumb-list__item，详情页 m3u8 在 <link rel=preload> 里。
 */

const resolver = new SiteResolver({
  defaultBase: SK_XHAMSTER_BASE,
  match: /xhamster/i,
  label: 'xhamster',
  cookie: GO_COOKIE
})

const UA = { ua: GO_UA, cookie: GO_COOKIE }
const ID_RE = /^videos\/[A-Za-z0-9_-]{3,200}$/

function pathOf(category: string, page: number, sort: SkSort): string {
  // 最新 = /newest，热门 = /best；分类页把排序段放在分类名后
  const mode = sort === 'hot' ? 'best' : 'newest'
  if (category) {
    const base = `/categories/${encodeURIComponent(category)}/${mode}`
    return page > 1 ? `${base}/${page}` : base
  }
  return page > 1 ? `/${mode}/${page}` : `/${mode}`
}

function itemIdOf(href: string): string {
  let path = href
  try {
    path = new URL(href, 'https://xhamster.com').pathname
  } catch {
    path = href
  }
  const id = path.replace(/^\/+/, '')
  return ID_RE.test(id) ? id : ''
}

interface XhThumb {
  title?: string
  duration?: number
  created?: number
  views?: number
  pageURL?: string
  thumbURL?: string | null
}

/** 页面把完整列表塞在 window.initials 里；DOM 只是懒加载骨架，大部分缩略图没有 src */
function extractInitials(html: string): unknown {
  const start = html.indexOf('window.initials')
  if (start < 0) return null
  const eq = html.indexOf('=', start)
  const begin = html.indexOf('{', eq)
  if (begin < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = begin; i < html.length; i++) {
    const c = html[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(begin, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function findThumbProps(node: unknown, depth = 0): XhThumb[] | null {
  if (!node || typeof node !== 'object' || depth > 12) return null
  const record = node as Record<string, unknown>
  if (Array.isArray(record.videoThumbProps)) return record.videoThumbProps as XhThumb[]
  for (const value of Object.values(record)) {
    const found = findThumbProps(value, depth + 1)
    if (found) return found
  }
  return null
}

function formatViews(value: number | undefined): string {
  if (!Number.isFinite(value) || !value || value <= 0) return ''
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

function formatDate(seconds: number | undefined): string {
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) return ''
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseJsonItems(html: string, base: string): SkItem[] {
  const props = findThumbProps(extractInitials(html))
  if (!props?.length) return []
  const out: SkItem[] = []
  const seen = new Set<string>()
  for (const video of props) {
    const id = itemIdOf(String(video.pageURL ?? ''))
    const title = text(video.title)
    if (!id || !title || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      title,
      cover: absoluteUrl(decodeEntities(String(video.thumbURL ?? '')), base),
      duration: video.duration ? formatDuration(video.duration) : '',
      meta: [formatViews(video.views), formatDate(video.created)].filter((value) => !!value)
    })
  }
  return out
}

function parseItems(root: ReturnType<typeof parse>, html: string, base: string): SkItem[] {
  const fromJson = parseJsonItems(html, base)
  if (fromJson.length) return fromJson
  const out: SkItem[] = []
  const seen = new Set<string>()
  for (const item of root.querySelectorAll('.thumb-list__item')) {
    const hrefs = [
      attr(item.querySelector('a[data-role="thumb-link"]'), 'href'),
      attr(item.querySelector('a[href*="/videos/"]'), 'href')
    ].filter(Boolean)
    let id = ''
    for (const href of hrefs) {
      id = itemIdOf(href)
      if (id) break
    }
    if (!id || seen.has(id)) continue
    const img = item.querySelector('img')
    const title =
      text(attr(item.querySelector('a[data-role="thumb-link"]'), 'aria-label')) ||
      text(attr(img, 'alt')) ||
      text(item.querySelector('.titleContainer-4cd1d a')?.text)
    if (!title) continue
    const duration = text(item.querySelector('[data-role="video-duration"]')?.text)
    const date = text(item.querySelector('.video-thumb__date-added')?.text)
    seen.add(id)
    out.push({
      id,
      title,
      cover: absoluteUrl(attr(img, 'src'), base),
      duration,
      meta: [date].filter((value) => !!value)
    })
  }
  return out
}

let categoriesCache: { base: string; at: number; list: SkCategory[] } | null = null

let countsCache: { base: string; at: number; map: Map<string, number> } | null = null

/**
 * 分类页把当前分类的视频总数放在筛选器的「全部」项里。
 * 页面 300KB+，读到 count 就中断，避免拖慢分类加载。
 */
async function fetchCategoryCount(base: string, slug: string): Promise<number> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(`${originOf(base)}/categories/${encodeURIComponent(slug)}`, {
      headers: {
        'User-Agent': GO_MOBILE_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Cookie: GO_COOKIE
      },
      redirect: 'follow',
      signal: controller.signal
    })
    if (!res.ok || !res.body) return 0
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let size = 0
    while (size < 400_000) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      buffer += decoder.decode(value, { stream: true })
      const matched = /"value":"any"[^}]*?"count":(\d+)/.exec(buffer)
      if (matched) {
        void reader.cancel().catch(() => undefined)
        return Number(matched[1])
      }
    }
    return 0
  } catch {
    return 0
  } finally {
    clearTimeout(timer)
  }
}

async function loadCategoryCounts(base: string, slugs: string[]): Promise<Map<string, number>> {
  const origin = originOf(base)
  if (
    countsCache &&
    countsCache.base === origin &&
    Date.now() - countsCache.at < 2 * 60 * 60 * 1000
  ) {
    return countsCache.map
  }
  const map = new Map<string, number>()
  const queue = [...slugs]
  const workers = Array.from({ length: 16 }, async () => {
    for (;;) {
      const slug = queue.shift()
      if (!slug) return
      const count = await fetchCategoryCount(base, slug)
      if (count > 0) map.set(slug, count)
    }
  })
  await Promise.all(workers)
  if (map.size) countsCache = { base: origin, at: Date.now(), map }
  return map
}

async function loadCategories(base: string): Promise<SkCategory[]> {
  if (
    categoriesCache &&
    categoriesCache.base === base &&
    Date.now() - categoriesCache.at < 30 * 60 * 1000
  ) {
    return categoriesCache.list
  }
  try {
    const { html } = await requestSite(resolver, '/categories', base, UA)
    const root = parse(html)
    const out: SkCategory[] = []
    const seen = new Set<string>()
    for (const anchor of root.querySelectorAll('a[href*="/categories/"]')) {
      const href = attr(anchor, 'href')
      const matched = /\/categories\/([^/?#]+)\/?$/.exec(href)
      const label = text(anchor.text)
      if (!matched || !label) continue
      let slug = matched[1]
      try {
        slug = decodeURIComponent(slug)
      } catch {
        // 保持原样
      }
      // 「澳门人」不是常用分类，用户要求从分类 chips 中去掉
      if (slug === 'macanese' || label === '澳门人') continue
      if (seen.has(slug)) continue
      seen.add(slug)
      out.push({ slug, label })
      if (out.length >= 60) break
    }
    const counts = await loadCategoryCounts(
      base,
      out.map((item) => item.slug)
    )
    const list = out.map((item) => {
      const count = counts.get(item.slug)
      return count ? { ...item, count } : item
    })
    categoriesCache = { base, at: Date.now(), list }
    return list
  } catch {
    return categoriesCache?.base === base ? categoriesCache.list : []
  }
}

function lastPageOf(root: ReturnType<typeof parse>, current: number): number {
  let max = current
  for (const anchor of root.querySelectorAll('a[href*="/newest/"], a[href*="/best/"], a[href*="/categories/"], a[href*="page="]')) {
    const href = attr(anchor, 'href')
    const matched =
      /(?:\/newest\/|\/best\/|\/categories\/[^/?#]+\/(?:newest|best)\/|\/categories\/[^/?#]+\/)(\d+)(?:[?#]|$)/.exec(href) ??
      /[?&]page=(\d+)/.exec(href)
    if (matched) max = Math.max(max, Number(matched[1]))
  }
  return max
}

export async function xhamsterCatalog(
  category: string,
  page: number,
  baseUrl?: string,
  sort: SkSort = 'latest'
): Promise<SkCatalogResponse> {
  const current = clampPage(page)
  try {
    const [content, categories] = await Promise.all([
      requestSite(resolver, pathOf(category, current, sort), baseUrl, UA),
      category ? Promise.resolve([] as SkCategory[]) : loadCategories(baseUrl || SK_XHAMSTER_BASE)
    ])
    const root = parse(content.html)
    const items = parseItems(root, content.html, content.base)
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

export async function xhamsterSearch(
  keyword: string,
  page: number,
  baseUrl?: string
): Promise<SkCatalogResponse> {
  const current = clampPage(page)
  try {
    const path = `/search?q=${encodeURIComponent(keyword)}&page=${current}`
    const { html, base } = await requestSite(resolver, path, baseUrl, UA)
    const root = parse(html)
    const items = parseItems(root, html, base)
    const reported = lastPageOf(root, current)
    return {
      ok: true,
      items,
      page: current,
      lastPage: items.length ? Math.max(reported, current + 1) : Math.max(reported, current),
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

export async function xhamsterDetail(
  id: string,
  baseUrl?: string
): Promise<SkDetailResponse> {
  if (!ID_RE.test(id)) return { ok: false, error: '无效的视频 ID' }
  try {
    const { html, base } = await requestSite(resolver, `/${id}`, baseUrl, UA)
    const root = parse(html)
    const playUrl = decodeEntities(
      /\bhttps?:\/\/[^"'\s<>]+?\.m3u8[^"'\s<>]*/.exec(html)?.[0] ?? ''
    ).replace(/\\\//g, '/')
    if (!playUrl) return { ok: false, error: '页面没有播放数据' }
    const tags: string[] = []
    for (const anchor of root.querySelectorAll('a[href*="/categories/"]')) {
      const label = text(anchor.text)
      if (label && !tags.includes(label)) tags.push(label)
      if (tags.length >= 12) break
    }
    const duration = text(
      (root.querySelector('[data-role="video-duration"]') ?? root.querySelector('.video-duration'))
        ?.text
    )
    const cover = attr(root.querySelector('meta[property="og:image"]'), 'content')
    return {
      ok: true,
      detail: {
        id,
        source: 'video',
        title: text(root.querySelector('h1')?.text) || 'xhamster',
        cover: absoluteUrl(cover, base),
        intro: attr(root.querySelector('meta[property="og:description"]'), 'content'),
        tags,
        meta: [],
        duration: /^\d+(:\d+)+$/.test(duration) ? duration : '',
        episodes: [],
        playUrl
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '加载失败' }
  }
}

export async function xhamsterPlay(id: string, baseUrl?: string): Promise<SkPlayResponse> {
  const res = await xhamsterDetail(id, baseUrl)
  if (!res.ok || !res.detail?.playUrl) {
    return { ok: false, error: res.error || '没有解析到播放地址' }
  }
  return { ok: true, url: res.detail.playUrl }
}
