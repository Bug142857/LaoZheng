import { parse, type HTMLElement } from 'node-html-parser'
import { NEWS_CATEGORIES, type NewsFeedResponse, type NewsItem, type NewsNodeCard, type NewsNodeResponse, type NewsSubCategory } from '../src/shared/news'

/**
 * 资讯（今日热榜 tophub.today）解析：
 *  - 一级分类页 /c/<key>（综合 / 科技 / 娱乐 / 社区 / 购物 / 财经 / 开发 / 简报 / AI / 报刊），
 *    一页 12 个 .cc-cd 榜单卡片，卡片本身带完整榜单（约 30~100 条，页面内滚动）；
 *  - 卡片头部：.cc-cd-lb 站点名 + 图标、.cc-cd-sb-st 榜单名、/n/<id> 榜单编号；
 *  - 卡片条目：.cc-cd-cb-ll 里 span.s 名次、span.t 标题、span.e 热度 / 来源；
 *  - 榜单详情页 /n/<id>：.rank-all-item 表格，第一格名次、标题链接、.item-desc / td.ws 热度。
 */

const BASE = 'https://tophub.today'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
/** 单张卡片最多保留的条目，防止个别榜单异常膨胀 */
const ITEM_LIMIT = 120
/** 站点对短时间大量请求很敏感（会弹「安全验证」），请求间至少间隔 700ms */
const MIN_INTERVAL_MS = 700

let requestQueue: Promise<unknown> = Promise.resolve()
let lastRequestAt = 0

function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt))
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    lastRequestAt = Date.now()
    return task()
  }
  const next = requestQueue.then(run, run)
  requestQueue = next.catch(() => undefined)
  return next
}

async function httpGet(path: string): Promise<string> {
  const res = await throttled(() =>
    fetch(`${BASE}${path}`, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000)
    })
  )
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const html = await res.text()
  if (!html.trim()) throw new Error('站点返回空内容')
  // 请求过密时站点会回 403 安全验证（带验证码的拦截页）
  if (res.status === 200 && html.includes('<title>安全验证</title>')) {
    const err = new Error('安全验证') as Error & { status?: number }
    err.status = 403
    throw err
  }
  return html
}

/** 站点拦截 / 网络错误统一成用户能看懂的话 */
function feedError(err: unknown): string {
  if (err instanceof Error && /Timeout|Abort/.test(err.name)) return '请求超时，请稍后重试'
  const status = (err as { status?: number })?.status
  if (status === 403) return '站点触发安全验证，请稍后在浏览器打开 tophub.today 后重试'
  if (status === 503) return '站点暂时限制访问（HTTP 503），请稍后重试'
  if (status && status >= 500) return `站点暂时不可用（HTTP ${status}）`
  return '热榜加载失败'
}

/** tophub 的跳转链接（/link?domain=&url=）还原成原文地址；站内链接不返回 */
function realUrl(raw: string | undefined | null): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw, BASE)
    if (/^https?:$/.test(url.protocol) === false) return null
    const host = url.hostname.toLowerCase()
    if (host === 'tophub.today' || host === 'www.tophub.today' || host === 'm.tophub.today') {
      if (url.pathname !== '/link') return null
      const target = url.searchParams.get('url')?.trim() ?? ''
      return /^https?:\/\//i.test(target) ? target : null
    }
    return url.href
  } catch {
    return null
  }
}

function textOf(el: HTMLElement | null | undefined): string {
  return (el?.text ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeIcon(raw: string | undefined | null): string | null {
  const src = (raw ?? '').trim()
  if (!src) return null
  if (src.startsWith('//')) return `https:${src}`
  return /^https?:\/\//i.test(src) ? src : null
}

/* ---------------- 分类页 ---------------- */

function parseCard(card: HTMLElement, categoryLabel: string): NewsNodeCard | null {
  const href = card.querySelector('.cc-cd-is a')?.getAttribute('href') ?? ''
  const id = href.match(/\/n\/([A-Za-z0-9]+)/)?.[1] ?? ''
  // 分类页的站点名是 .cc-cd-lb 里的纯文本（首页则是 span），统一取文本即可
  const name = textOf(card.querySelector('.cc-cd-lb'))
  if (!id || !name) return null
  const board = textOf(card.querySelector('.cc-cd-sb-st')) || categoryLabel
  const icon = normalizeIcon(card.querySelector('.cc-cd-lb img')?.getAttribute('src'))
  const items: NewsItem[] = []
  // 标准榜单行：.cc-cd-cb-ll（span.s 名次 / span.t 标题 / span.e 热度）
  for (const row of card.querySelectorAll('.cc-cd-cb-ll').slice(0, ITEM_LIMIT)) {
    const title = textOf(row.querySelector('.t'))
    if (!title) continue
    const rankText = textOf(row.querySelector('.s'))
    items.push({
      rank: Number.parseInt(rankText, 10) || items.length + 1,
      title,
      extra: textOf(row.querySelector('.e')),
      url: realUrl(row.parentNode?.getAttribute?.('href'))
    })
  }
  // 购物卡片（淘宝 / 天猫等）是另一套结构：.sp 里 .rank / .tt / .ss
  if (!items.length) {
    for (const row of card.querySelectorAll('.sp').slice(0, ITEM_LIMIT)) {
      const title = textOf(row.querySelector('.tt'))
      if (!title) continue
      const rankText = textOf(row.querySelector('.rank'))
      items.push({
        rank: Number.parseInt(rankText, 10) || items.length + 1,
        title,
        extra: textOf(row.querySelector('.ss')),
        url: realUrl(row.querySelector('a')?.getAttribute('href'))
      })
    }
  }
  if (!items.length) return null
  return { id, name, board, icon, items }
}

/* 分类页被站点拦截时的首页兜底：首页仍有各分区榜单，只是没有分页 / 子分类 */

const HOME_SECTION_BY_CATEGORY: Record<string, string> = {
  news: '综合',
  brief: '日报',
  tech: '科技',
  ent: '娱乐',
  community: '社区',
  shopping: '购物',
  finance: '财经',
  developer: '开发'
}

let homeFallbackCache: { at: number; sections: Map<string, NewsNodeCard[]> } | null = null

async function homeFallback(categoryKey: string, label: string): Promise<NewsNodeCard[]> {
  const section = HOME_SECTION_BY_CATEGORY[categoryKey]
  if (!section) return []
  if (!homeFallbackCache || Date.now() - homeFallbackCache.at > 10 * 60 * 1000) {
    const html = await httpGet('/')
    const doc = parse(html)
    const map = new Map<string, NewsNodeCard[]>()
    for (const head of doc.querySelectorAll('div.bc-tc-tb')) {
      const name = textOf(head).replace(/\s*\d+\s*个\s*$/, '').trim()
      const box = head.parentNode?.nextElementSibling
      if (!name || !box) continue
      const cards: NewsNodeCard[] = []
      for (const card of box.querySelectorAll('.cc-cd')) {
        const node = parseCard(card, name || label)
        if (node) cards.push(node)
      }
      map.set(name, cards)
    }
    homeFallbackCache = { at: Date.now(), sections: map }
  }
  return homeFallbackCache.sections.get(section) ?? []
}

export async function newsFeed(
  categoryKey: string,
  query = '',
  page = 1
): Promise<NewsFeedResponse> {
  const category = NEWS_CATEGORIES.find((entry) => entry.key === categoryKey)
  if (!category) return { ok: false, error: '分类无效' }
  const q = query.trim().slice(0, 40)
  const currentPage = Math.max(1, Math.min(500, Math.floor(page) || 1))
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (currentPage > 1) params.set('p', String(currentPage))
  const search = params.toString()
  try {
    const html = await httpGet(`/c/${category.key}${search ? `?${search}` : ''}`)
    const doc = parse(html)
    const headText = textOf(doc.querySelector('div.bc-tc-tb'))
    const total = Number.parseInt(headText.match(/(\d+)\s*个/)?.[1] ?? '', 10) || 0
    let totalPages = 1
    for (const link of doc.querySelectorAll('.pagination .pager a')) {
      const n = Number.parseInt(textOf(link), 10)
      if (Number.isFinite(n) && n > totalPages) totalPages = n
    }
    const cards: NewsNodeCard[] = []
    const seen = new Set<string>()
    for (const card of doc.querySelectorAll('.cc-cd')) {
      const node = parseCard(card, category.label)
      if (!node) continue
      const key = `${node.id}|${node.board}`
      if (seen.has(key)) continue
      seen.add(key)
      cards.push(node)
    }
    // 「热门榜单」子分类（热搜 / 滚动新闻 / 微信…），点选后按 ?q= 过滤
    const subs: NewsSubCategory[] = []
    const seenSub = new Set<string>()
    for (const link of doc.querySelectorAll('.pb-qb-t-c a')) {
      const label = textOf(link)
      const href = link.getAttribute('href') ?? ''
      let value = ''
      try {
        value = new URL(href, BASE).searchParams.get('q')?.trim() ?? ''
      } catch {
        value = ''
      }
      if (!label || !value || seenSub.has(value)) continue
      seenSub.add(value)
      subs.push({ label, q: value })
    }
    if (!cards.length) return { ok: false, error: '分类页暂时没有内容' }
    return {
      ok: true,
      category: category.key,
      query: q,
      page: currentPage,
      totalPages,
      subs,
      cards,
      total,
      fetchedAt: Date.now()
    }
  } catch (err) {
    const status = (err as { status?: number })?.status
    // 403 / 503 是站点对分类页的限流拦截：改用首页对应分区兜底，至少还有内容
    // 子分类（?q=）没有对应的首页分区，兜底会把未过滤内容当成子分类展示，所以不兜底
    if ((status === 403 || status === 503) && !q) {
      try {
        const cards = await homeFallback(category.key, category.label)
        if (cards.length) {
          return {
            ok: true,
            category: category.key,
            query: q,
            page: 1,
            totalPages: 1,
            subs: [],
            cards,
            total: cards.length,
            fetchedAt: Date.now(),
            fallback: true
          }
        }
      } catch {
        // 首页也取不到时继续返回错误
      }
    }
    return { ok: false, error: feedError(err) }
  }
}

/* ---------------- 榜单详情 ---------------- */

export async function newsNode(id: string): Promise<NewsNodeResponse> {
  if (!/^[A-Za-z0-9]{4,30}$/.test(id)) return { ok: false, error: '榜单编号无效' }
  try {
    const html = await httpGet(`/n/${id}`)
    const doc = parse(html)
    const rawTitle = doc.querySelector('meta[name=title]')?.getAttribute('content') ?? ''
    const title = rawTitle.replace(/\s*[-–—]\s*今日热榜\s*$/, '').trim()
    const tabText = (doc.querySelector('.tab-sort')?.text ?? '').replace(/\s+/g, ' ')
    const updated = tabText.match(/(\d+\s*(?:秒|分钟|小时|天)前更新)/)?.[1] ?? ''

    const items: NewsItem[] = []
    const seenTitle = new Set<string>()
    for (const tr of doc.querySelectorAll('.rank-all-item table tbody tr')) {
      let link: HTMLElement | null = null
      for (const a of tr.querySelectorAll('a')) {
        // 「查看详细」图标链接带 title，跳过；标题链接一定没有 title
        if (a.getAttribute('title')) continue
        if (!textOf(a)) continue
        link = a
        break
      }
      const itemTitle = textOf(link)
      if (!itemTitle || seenTitle.has(itemTitle)) continue
      seenTitle.add(itemTitle)
      const rankText = textOf(tr.querySelectorAll('td')[0]).replace(/[.、]$/, '')
      const extra = textOf(tr.querySelector('.item-desc') ?? tr.querySelector('td.ws'))
      items.push({
        rank: Number.parseInt(rankText, 10) || items.length + 1,
        title: itemTitle,
        extra,
        url: realUrl(link?.getAttribute('href'))
      })
    }
    if (!items.length) return { ok: false, error: '榜单暂时没有内容' }
    return {
      ok: true,
      detail: { id, title: title || id, updated, fetchedAt: Date.now(), items }
    }
  } catch (err) {
    return { ok: false, error: feedError(err) }
  }
}
