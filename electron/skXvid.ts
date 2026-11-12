import type { HTMLElement } from 'node-html-parser'
import { parse } from 'node-html-parser'
import type {
  SkCatalogResponse,
  SkCategory,
  SkDetailResponse,
  SkItem,
  SkPlayResponse,
  SkSort
} from '../src/shared/shuangkan'
import { SK_XVID_BASE } from '../src/shared/shuangkan'
import { formatDuration } from '../src/shared/xsite'
import {
  GO_COOKIE,
  GO_UA,
  SiteResolver,
  absoluteUrl,
  attr,
  clampPage,
  decodeEntities,
  originOf,
  requestSite,
  text,
  trackImages
} from './gohome'

/**
 * 爽看的 XVIDEOS 源：镜像 www.xvideos1.icu 必须用桌面 UA（手机 UA 会跳到 /notmobile）。
 * 列表是标准 .thumb-block 结构，详情页的 HLS 地址在 html5player.setVideoHLS(...) 里。
 */

const resolver = new SiteResolver({
  defaultBase: SK_XVID_BASE,
  match: /xvideos/i,
  label: 'XVIDEOS',
  cookie: GO_COOKIE
})

const UA = { ua: GO_UA, cookie: GO_COOKIE, nodeFetch: true }
const ID_RE = /^([A-Za-z0-9]+)~[A-Za-z0-9_.-]{1,140}$/

function pathOf(category: string, page: number, sort: SkSort): string {
  if (category) {
    // 分类页默认 Relevance，这里显式指定：最新 = 上传时间，热门 = 播放量
    const by = sort === 'hot' ? 's:views' : 's:uploaddate'
    return page > 1 ? `/c/${by}/${category}/${page}` : `/c/${by}/${category}`
  }
  // /best 是站点的本月最佳榜单，只有一页；其余走 /new/<page>
  if (sort === 'hot') return '/best'
  return `/new/${page}`
}

/** href 形如 /video.<eid>/<slug>；用 eid~slug 当稳定 ID，详情页可直接用该路径 */
/** 列表页链接可能带数字段（/video.<eid>/<num>/<num>/<slug>），取末段当 slug */
function itemIdOf(href: string): string {
  let path = href
  try {
    path = new URL(href, 'https://x.invalid').pathname
  } catch {
    // 保留原样
  }
  const matched = /^\/video\.([A-Za-z0-9]+)\/(.+)$/.exec(path)
  if (!matched) return ''
  const slug = matched[2].split('/').filter(Boolean).pop() ?? ''
  return slug ? `${matched[1]}~${slug}` : ''
}

function detailPathOf(id: string): string {
  const matched = ID_RE.exec(id)
  return matched ? `/video.${matched[1]}/${matched[2]}` : ''
}

function normalizeDuration(value: string): string {
  const raw = value.trim()
  const hours = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*min)?$/i.exec(raw)
  if (hours) {
    const h = Number(hours[1] || 0)
    const m = Number(hours[2] || 0)
    if (h || m) return h ? `${h}:${String(m).padStart(2, '0')}:00` : `${m}:00`
  }
  return raw
}

/** 镜像列表偶尔直接下发未渲染的懒加载模板（xv_THUMBNUM_t.jpg），CDN 只认具体帧号 */
function normalizeCover(raw: string): string {
  return raw.replace(/THUMBNUM/gi, '1')
}

function parseItems(root: ReturnType<typeof parse>, base: string): SkItem[] {
  const out: SkItem[] = []
  const seen = new Set<string>()
  for (const block of root.querySelectorAll('.thumb-block')) {
    const anchor =
      block.querySelector('p.title a') ?? block.querySelector('a[href^="/video."]')
    const href = attr(anchor, 'href')
    const id = itemIdOf(href)
    if (!id || seen.has(id)) continue
    const img = block.querySelector('img')
    const cover = normalizeCover(
      absoluteUrl(attr(img, 'data-src') || attr(img, 'data-mzl') || attr(img, 'src'), base)
    )
    const title =
      text(attr(anchor, 'title')) ||
      text((block.querySelector('p.title') ?? block.querySelector('.title'))?.text)
    if (!title) continue
    const durationNode =
      block.querySelector('p.metadata .duration') ?? block.querySelector('.duration')
    const metadata = text(
      (block.querySelector('p.metadata') ?? block.querySelector('.video-metadata'))?.text
    )
    const uploader = text(
      (block.querySelector('p.metadata .name') ?? block.querySelector('.name'))?.text
    )
    const views = /([\d.,]+[KMB]?)\s*Views?/i.exec(metadata)?.[0] ?? ''
    seen.add(id)
    out.push({
      id,
      title,
      cover,
      duration: normalizeDuration(text(durationNode?.text)),
      meta: [uploader, views].filter((value) => !!value)
    })
  }
  return out
}

/** 站点分类是英文，这里按现有分类名做中文映射（slug 去掉末尾的 -数字 ID） */
const XV_CATEGORY_LABELS: Record<string, string> = {
  ai: 'AI',
  amateur: '业余',
  anal: '肛交',
  arab: '阿拉伯',
  asian_woman: '亚洲',
  asmr: 'ASMR',
  ass: '美臀',
  bbw: '丰满',
  bi_sexual: '双性恋',
  big_ass: '巨臀',
  big_cock: '巨根',
  big_tits: '巨乳',
  black_woman: '黑人',
  blonde: '金发',
  blowjob: '口交',
  brunette: '褐发',
  cam_porn: '直播',
  creampie: '内射',
  cuckold: '绿帽',
  cumshot: '射精',
  femdom: '女尊',
  fisting: '拳交',
  fucked_up_family: '家庭乱伦',
  gangbang: '群交',
  gapes: '扩肛',
  indian: '印度',
  interracial: '跨种族',
  latina: '拉丁',
  lesbian: '女同',
  lingerie: '内衣',
  mature: '熟女',
  milf: '少妇',
  oiled: '油滑',
  redhead: '红发',
  solo_and_masturbation: '自慰',
  squirting: '潮吹',
  stockings: '丝袜',
  teen: '少女'
}

function localizeCategory(slug: string, label: string): string {
  const key = slug.replace(/-\d+$/, '').toLowerCase()
  return XV_CATEGORY_LABELS[key] ?? label
}

function parseCategories(root: ReturnType<typeof parse>): SkCategory[] {
  const out: SkCategory[] = []
  const seen = new Set<string>()
  for (const anchor of root.querySelectorAll('a[href^="/c/"]')) {
    const href = attr(anchor, 'href')
    let slug = href.slice(3).split(/[?#/]/)[0]
    try {
      slug = decodeURIComponent(slug)
    } catch {
      // 保持原样
    }
    const label = text(anchor.text)
    // /c/s:uploaddate/... 这类是排序链接，不是分类
    if (!slug || slug.startsWith('s:') || !label || slug.length > 80 || seen.has(slug)) continue
    seen.add(slug)
    out.push({ slug, label: localizeCategory(slug, label) })
  }
  return out
}

let countsCache: { base: string; at: number; map: Map<string, number> } | null = null

/** 分类页内嵌的 "nbResults":N 就是该分类的视频总数；页面 100KB+，读到就中断 */
async function fetchCategoryCount(base: string, slug: string): Promise<number> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(`${originOf(base)}/c/${encodeURIComponent(slug)}`, {
      headers: {
        'User-Agent': GO_UA,
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
    while (size < 120_000) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      buffer += decoder.decode(value, { stream: true })
      const matched = /"nbResults":(\d+)/.exec(buffer)
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

async function loadCategoryCounts(
  base: string,
  slugs: string[]
): Promise<Map<string, number>> {
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
  const workers = Array.from({ length: 8 }, async () => {
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

function lastPageOf(root: ReturnType<typeof parse>, current: number): number {
  let max = current
  const links = root.querySelectorAll('.pagination a, a[rel="next"]')
  for (const anchor of links) {
    const href = attr(anchor, 'href')
    const page = /[?&]p=(\d+)/.exec(href)
    if (page) {
      max = Math.max(max, Number(page[1]) + 1)
      continue
    }
    const numbered = /\/(\d+)(?:[?#]|$)/.exec(href)
    if (numbered && /^\/(?:c|new)\//.test(href)) max = Math.max(max, Number(numbered[1]))
  }
  return max
}

export async function xvidCatalog(
  category: string,
  page: number,
  baseUrl?: string,
  sort: SkSort = 'latest'
): Promise<SkCatalogResponse> {
  const current = clampPage(page)
  try {
    const { html, base } = await requestSite(
      resolver,
      pathOf(category, current, sort),
      baseUrl,
      UA
    )
    const root = parse(html)
    const items = parseItems(root, base)
    // 封面 CDN 校验 Referer，且必须与本次实际出页的镜像一致：在返回给渲染层之前登记，
    // 避免只靠后到的 IPC 登记导致首屏图片裸请求拿到 143 字节提示清单
    trackImages(items.map((item) => item.cover), base)
    let categories: SkCategory[] = []
    if (!category) {
      const parsed = parseCategories(root)
      const counts = await loadCategoryCounts(base, parsed.map((entry) => entry.slug))
      categories = parsed.map((entry) => {
        const count = counts.get(entry.slug)
        return count ? { ...entry, count } : entry
      })
    }
    const reported = lastPageOf(root, current)
    // /best 只有一页，翻页参数会被忽略
    const single = !category && sort === 'hot'
    const lastPage = single
      ? current
      : items.length
        ? Math.max(reported, current + 1)
        : Math.max(reported, current)
    return {
      ok: true,
      items,
      page: current,
      lastPage,
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

export async function xvidSearch(
  keyword: string,
  page: number,
  baseUrl?: string
): Promise<SkCatalogResponse> {
  const current = clampPage(page)
  try {
    const path = `/?k=${encodeURIComponent(keyword)}&p=${current - 1}`
    const { html, base } = await requestSite(resolver, path, baseUrl, UA)
    const root = parse(html)
    const items = parseItems(root, base)
    trackImages(items.map((item) => item.cover), base)
    // 这些镜像会把带查询串的请求当成首页返回（搜索被忽略），
    // 标题里没有关键词说明拿到的不是搜索结果，直接提示而不是返回首页 / 空列表
    const title = text(root.querySelector('title')?.text).toLowerCase()
    if (!title.includes(keyword.trim().toLowerCase())) {
      return {
        ok: false,
        items: [],
        page: current,
        lastPage: current,
        categories: [],
        error: '该源不支持搜索，请改用分类浏览'
      }
    }
    return {
      ok: true,
      items,
      page: current,
      lastPage: items.length ? current + 1 : current,
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

function isoDurationSec(value: string): number {
  const matched = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(value.trim())
  if (!matched) return 0
  return (
    Number(matched[1] || 0) * 86_400 +
    Number(matched[2] || 0) * 3_600 +
    Number(matched[3] || 0) * 60 +
    Math.round(Number(matched[4] || 0))
  )
}

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

export async function xvidDetail(id: string, baseUrl?: string): Promise<SkDetailResponse> {
  const path = detailPathOf(id)
  if (!path) return { ok: false, error: '无效的视频 ID' }
  try {
    const { html, base } = await requestSite(resolver, path, baseUrl, UA)
    const root = parse(html)
    const ld = parseLd(root)
    const hls =
      /setVideoHLS\(\s*'([^']+)'\s*\)/.exec(html)?.[1] ??
      /setVideoHLS\(\s*"([^"]+)"\s*\)/.exec(html)?.[1] ??
      /https?:\/\/[^"'\s<>]+?\.m3u8[^"'\s<>]*/.exec(html)?.[0] ??
      ''
    const playUrl = decodeEntities(hls).replace(/\\\//g, '/')
    const cover = normalizeCover(
      absoluteUrl(
        attr(root.querySelector('meta[property="og:image"]'), 'content') ||
          (Array.isArray(ld.thumbnailUrl) ? ld.thumbnailUrl[0] : ld.thumbnailUrl) ||
          '',
        base
      )
    )
    if (cover) trackImages([cover], base)
    const tags: string[] = []
    for (const anchor of root.querySelectorAll('a[href^="/tags/"]')) {
      const label = text(anchor.text)
      if (label && !tags.includes(label)) tags.push(label)
      if (tags.length >= 12) break
    }
    const durationSec = isoDurationSec(String(ld.duration ?? ''))
    const views = formatCount(Number(ld.interactionStatistic?.userInteractionCount ?? 0))
    const uploadDate = String(ld.uploadDate ?? '').slice(0, 10)
    if (!playUrl && !/\.mp4/i.test(String(ld.contentUrl ?? ''))) {
      return { ok: false, error: '页面没有播放数据' }
    }
    return {
      ok: true,
      detail: {
        id,
        source: 'video',
        title: String(ld.name ?? '') || text(root.querySelector('h2.page-title')?.text) || 'XVIDEOS',
        cover,
        intro: String(ld.description ?? ''),
        tags,
        meta: [views, uploadDate].filter((value) => !!value),
        duration: durationSec ? formatDuration(durationSec) : '',
        episodes: [],
        playUrl: playUrl || String(ld.contentUrl ?? '')
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '加载失败' }
  }
}

interface XvLd {
  name?: string
  description?: string
  thumbnailUrl?: string | string[]
  uploadDate?: string
  duration?: string
  contentUrl?: string
  interactionStatistic?: { userInteractionCount?: number }
}

function parseLd(root: ReturnType<typeof parse>): XvLd {
  const node: HTMLElement | null = root.querySelector('script[type="application/ld+json"]')
  if (!node) return {}
  try {
    return JSON.parse(node.text) as XvLd
  } catch {
    return {}
  }
}

export async function xvidPlay(id: string, baseUrl?: string): Promise<SkPlayResponse> {
  const res = await xvidDetail(id, baseUrl)
  if (!res.ok || !res.detail?.playUrl) {
    return { ok: false, error: res.error || '没有解析到播放地址' }
  }
  return { ok: true, url: res.detail.playUrl }
}
