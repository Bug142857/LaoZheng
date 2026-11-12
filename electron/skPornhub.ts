import { parse } from 'node-html-parser'
import type {
  SkCatalogResponse,
  SkCategory,
  SkDetailResponse,
  SkItem,
  SkPlayResponse,
  SkSort
} from '../src/shared/shuangkan'
import { SK_PORNHUB_BASE } from '../src/shared/shuangkan'
import { P_CATEGORIES } from '../src/shared/psite'
import { formatDuration } from '../src/shared/xsite'
import {
  GO_MOBILE_UA,
  GO_PH_COOKIE,
  SiteResolver,
  attr,
  clampPage,
  fetchText,
  originOf
} from './gohome'
import { pDetail, pList, type PSite } from './psite'

/**
 * 爽看的 Pornhub 源：国内镜像（cn.pornhub06.com 等）代理了手机版页面，
 * 结构与 pornhub.com 一致，因此直接复用 psite.ts 的列表 / 详情解析。
 */

const resolver = new SiteResolver({
  defaultBase: SK_PORNHUB_BASE,
  match: /pornhub/i,
  label: 'Pornhub',
  cookie: GO_PH_COOKIE
})

const ID_RE = /^[A-Za-z0-9]{5,40}$/

function site(base: string): PSite {
  return { base, cookie: GO_PH_COOKIE }
}

/** 片源管理里的地址优先；失败后依次换默认地址与优选线路 */
async function withSite<T extends { ok: boolean; error?: string }>(
  baseUrl: string | undefined,
  run: (site: PSite) => Promise<T>
): Promise<T> {
  const tried = new Set<string>()
  let last: T | null = null
  const preferred = originOf(baseUrl)
  if (preferred) {
    tried.add(preferred)
    last = await run(site(preferred))
    if (last.ok) return last
  }
  const base = await resolver.resolve().catch(() => '')
  if (base && !tried.has(base)) {
    tried.add(base)
    last = await run(site(base))
    if (last.ok) return last
  }
  const fresh = await resolver.resolve(true).catch(() => '')
  if (fresh && !tried.has(fresh)) {
    tried.add(fresh)
    last = await run(site(fresh))
    if (last.ok) return last
  }
  if (last) return last
  return { ok: false, error: '站点无法访问' } as T
}

function categoriesOf(): SkCategory[] {
  return P_CATEGORIES.map((item) => ({ slug: String(item.id), label: item.label }))
}

let categoriesCache: { base: string; at: number; list: SkCategory[] } | null = null

/**
 * 分类数量：镜像的 /categories 页面会给出每个分类的完整视频数，
 * 列表页不返回总数，只能从这里取一次（缓存 30 分钟）。
 */
async function loadCategories(base: string): Promise<SkCategory[]> {
  if (
    categoriesCache &&
    categoriesCache.base === base &&
    Date.now() - categoriesCache.at < 30 * 60 * 1000
  ) {
    return categoriesCache.list
  }
  try {
    // 用 Chromium 网络栈：Node 的 fetch 在部分镜像上会一直卡到超时，
    // 分类数量就永远为空
    const html = await fetchText(`${base}/categories`, `${base}/`, {
      ua: GO_MOBILE_UA,
      cookie: GO_PH_COOKIE,
      timeout: 15_000
    })
    const root = parse(html)
    const counts = new Map<string, number>()
    for (const anchor of root.querySelectorAll('a[href*="/video?c="]')) {
      const matched = /[?&]c=(\d+)/.exec(attr(anchor, 'href'))
      const count = /(\d[\d,]*)\s*Videos?/i.exec(anchor.text.replace(/\s+/g, ' '))
      if (!matched || !count) continue
      counts.set(matched[1], Number(count[1].replace(/,/g, '')))
    }
    const list =
      counts.size > 0
        ? P_CATEGORIES.map((item) => {
            const count = counts.get(String(item.id))
            return {
              slug: String(item.id),
              label: item.label,
              ...(count ? { count } : {})
            }
          })
        : categoriesOf()
    categoriesCache = { base, at: Date.now(), list }
    return list
  } catch {
    return categoriesCache?.base === base ? categoriesCache.list : categoriesOf()
  }
}

function toItem(video: {
  vkey: string
  title: string
  thumbnail: string | null
  durationSec: number
  views: string
  uploader: string
}): SkItem {
  return {
    id: video.vkey,
    title: video.title,
    cover: video.thumbnail ?? '',
    duration: formatDuration(video.durationSec),
    meta: [video.views, video.uploader].filter((value) => !!value)
  }
}

export async function pornhubCatalog(
  category: string,
  page: number,
  baseUrl?: string,
  sort: SkSort = 'recommended'
): Promise<SkCatalogResponse> {
  const current = clampPage(page)
  const catId = Number.parseInt(category, 10) || 0
  // 默认信息流 = /recommended，和 P站模块口径一致；分类页固定走 /video?c=
  const sortCode = sort === 'hot' ? 'ht' : sort === 'latest' ? '' : 'recommended'
  let categories: SkCategory[] = []
  const res = await withSite(baseUrl, async (site) => {
    const [list, cats] = await Promise.all([
      pList(sortCode, catId, '', current, site),
      catId ? Promise.resolve<SkCategory[]>([]) : loadCategories(site.base)
    ])
    if (list.ok) categories = cats
    return list
  })
  if (!res.ok) {
    return {
      ok: false,
      items: [],
      page: current,
      lastPage: current,
      categories: category ? [] : categoriesOf(),
      error: res.error || '加载失败'
    }
  }
  const items = res.items.map(toItem)
  // 站点分页条只到当前页附近，不能据此锁死：还有数据就多给一页
  const lastPage = res.hasMore ? Math.max(res.lastPage, current + 1) : Math.max(res.lastPage, current)
  return {
    ok: true,
    items,
    page: current,
    lastPage,
    categories: category ? [] : categories.length ? categories : categoriesOf()
  }
}

export async function pornhubSearch(
  keyword: string,
  page: number,
  baseUrl?: string
): Promise<SkCatalogResponse> {
  const current = clampPage(page)
  const res = await withSite(baseUrl, (site) => pList('', 0, keyword, current, site))
  if (!res.ok) {
    return {
      ok: false,
      items: [],
      page: current,
      lastPage: current,
      categories: [],
      error: res.error || '搜索失败'
    }
  }
  const items = res.items.map(toItem)
  const lastPage = res.hasMore ? Math.max(res.lastPage, current + 1) : Math.max(res.lastPage, current)
  return { ok: true, items, page: current, lastPage, categories: [] }
}

export async function pornhubDetail(
  id: string,
  baseUrl?: string
): Promise<SkDetailResponse> {
  if (!ID_RE.test(id)) return { ok: false, error: '无效的视频 ID' }
  const res = await withSite(baseUrl, (site) => pDetail(id, site))
  if (!res.ok || !res.url) {
    return { ok: false, error: res.error || '没有解析到播放地址' }
  }
  return {
    ok: true,
    detail: {
      id,
      source: 'video',
      title: res.title || 'Pornhub 视频',
      cover: res.cover || '',
      intro: res.intro || '',
      tags: res.tags ?? [],
      meta: [res.views, res.uploader, res.quality].filter((value): value is string => !!value),
      duration: res.durationSec ? formatDuration(res.durationSec) : '',
      episodes: [],
      playUrl: res.url
    }
  }
}

export async function pornhubPlay(id: string, baseUrl?: string): Promise<SkPlayResponse> {
  const res = await pornhubDetail(id, baseUrl)
  if (!res.ok || !res.detail?.playUrl) {
    return { ok: false, error: res.error || '没有解析到播放地址' }
  }
  return { ok: true, url: res.detail.playUrl }
}
