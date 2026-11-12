import { parse, type HTMLElement } from 'node-html-parser'
import {
  SK_DEFAULT_BASE,
  defaultSkSort,
  type SkAdapter,
  type SkCatalogResponse,
  type SkCategory,
  type SkContent,
  type SkDetailResponse,
  type SkEpisode,
  type SkItem,
  type SkPlayResponse,
  type SkSort
} from '../src/shared/shuangkan'
import {
  SiteResolver,
  absoluteUrl,
  attr,
  requestSite,
  text,
  trackImages
} from './gohome'
import { pornhubCatalog, pornhubDetail, pornhubPlay, pornhubSearch } from './skPornhub'
import { pppCatalog, pppDetail, pppPlay, pppSearch } from './skPpp'
import { xhamsterCatalog, xhamsterDetail, xhamsterPlay, xhamsterSearch } from './skXhamster'
import { xvidCatalog, xvidDetail, xvidPlay, xvidSearch } from './skXvid'

/**
 * 爽看客户端：按适配器分发到不同站点。
 *
 * 肉视频 rou07 是服务端渲染 HTML：
 *   视频库 /v、分类 /t/<tag>、短剧库 /series、短剧详情 /s/<id>、视频详情 /v/<id>
 *   播放地址由详情页脚本里的 ev 载荷（base64 后整体减 k）解出，指向 /api/hls/<id>。
 *
 * 其他适配器（Pornhub / XVIDEOS / xhamster / 亚洲素人精选）见 sk*.ts，
 * 站点失效时统一到 x99dh 导航站的「优选访问」换址。
 */

const resolver = new SiteResolver({
  defaultBase: SK_DEFAULT_BASE,
  match: /肉视频|肉視頻/,
  label: '皇片',
  // v0.122：肉视频 /api/hls 网关按 UA 分流，注入桌面 UA 会命中 502 节点，
  // 保持裸请求（渲染层默认移动 UA）即可，不登记媒体鉴权
  mediaAuth: false
})

function request(path: string, baseUrl?: string): Promise<{ html: string; base: string }> {
  // 片源管理里配置的地址优先；连不上再走自动换址
  return requestSite(resolver, path, baseUrl)
}

export {
  imageAuth as shuangkanImageAuth,
  noteShuangkanMediaRedirect,
  trackImages as trackShuangkanImages
} from './gohome'
export {
  noteShuangkanMediaAuth,
  noteShuangkanMediaBase,
  resolveSkMediaPlay,
  shuangkanMediaAuth
} from './gohome'

import { noteShuangkanMediaAuth, resolveSkMediaPlay } from './gohome'

/**
 * v0.122：肉视频网关按 UA 分流到不同边缘节点，部分节点会整段时间 502。
 * 详情 / 播放时串行探测候选 UA，把能拿到正常清单的那个登记为媒体鉴权。
 * 播放地址仍返回原始 /api/hls 入口 —— 网关每次请求都会重新抽节点，
 * 锁死探测时那一个节点反而会在它变坏后彻底播不了（hls.js 重试也不会换节点）。
 * UA 结论缓存 10 分钟，避免每次播放都多打一次探测请求。
 */
let skRou07Ua = ''
let skRou07UaAt = 0

async function resolveRou07Play(playUrl: string): Promise<string> {
  try {
    if (skRou07Ua && Date.now() - skRou07UaAt < 10 * 60 * 1000) {
      noteShuangkanMediaAuth(new URL(playUrl).hostname, { ua: skRou07Ua })
      return playUrl
    }
    const hit = await resolveSkMediaPlay(playUrl)
    if (hit) {
      skRou07Ua = hit.ua
      skRou07UaAt = Date.now()
    }
    return playUrl
  } catch {
    return playUrl
  }
}

/* ---------------- 列表 ---------------- */

function parseCategories(root: ReturnType<typeof parse>, source: SkContent): SkCategory[] {
  const out: SkCategory[] = []
  const seen = new Set<string>()
  if (source === 'video') {
    for (const anchor of root.querySelectorAll('a[href^="/t/"]')) {
      const href = attr(anchor, 'href')
      const label = text(anchor.text)
      let slug = ''
      try {
        slug = decodeURIComponent(href.slice(3).split(/[?#]/)[0])
      } catch {
        slug = ''
      }
      if (!slug || !label || seen.has(slug)) continue
      seen.add(slug)
      // 二级分类的数量放在 <span class="text-dim"> 里，不剥掉会变成「fc2 ppv1,970」
      const countNode = anchor
        .querySelectorAll('span')
        .find((span) => String(span.getAttribute('class') ?? '').includes('text-dim'))
      const countText = countNode ? text(countNode.text) : ''
      const name = countText && label.endsWith(countText)
        ? label.slice(0, label.length - countText.length).trim()
        : label
      const count = countText ? Number(countText.replace(/,/g, '')) : NaN
      out.push({
        slug,
        label: name || label,
        count: Number.isFinite(count) ? count : undefined
      })
    }
    return out
  }
  for (const anchor of root.querySelectorAll('a[href^="/series?tag="]')) {
    const href = attr(anchor, 'href')
    let slug = ''
    try {
      slug = new URL(href, 'https://x').searchParams.get('tag') ?? ''
    } catch {
      slug = ''
    }
    const rawLabel = text(anchor.text)
    if (!slug || !rawLabel || seen.has(slug)) continue
    const matched = /^(.*?)([\d,]+)$/.exec(rawLabel)
    const label = matched?.[1]?.trim() || rawLabel
    const count = matched ? Number(matched[2].replace(/,/g, '')) : NaN
    seen.add(slug)
    out.push({ slug, label, count: Number.isFinite(count) ? count : undefined })
  }
  return out
}

function cardMeta(anchor: HTMLElement): string[] {
  const box = anchor
    .querySelectorAll('div')
    .find((div) => String(div.getAttribute('class') ?? '').includes('text-dim'))
  if (!box) return []
  return box.childNodes
    .filter((node) => node.nodeType === 1)
    .map((node) => text(node.text).replace(/^·\s*/, ''))
    .filter((value) => value && value !== '·')
}

function parseItems(
  root: ReturnType<typeof parse>,
  source: SkContent,
  base?: string
): SkItem[] {
  const prefix = source === 'video' ? '/v/' : '/s/'
  const items: SkItem[] = []
  const seen = new Set<string>()
  for (const anchor of root.querySelectorAll(`a[href^="${prefix}"]`)) {
    if (!anchor.querySelector('h3')) continue
    const href = attr(anchor, 'href')
    const id = href.slice(prefix.length).split(/[?#]/)[0]
    if (!id || seen.has(id)) continue
    const title = text(anchor.querySelector('h3')?.text)
    if (!title) continue
    const images = anchor.querySelectorAll('img')
    const coverNode =
      images.find((img) => text(img.getAttribute('alt'))) ||
      images.find((img) => img.getAttribute('src'))
    const cover = absoluteUrl(attr(coverNode, 'src'), base || SK_DEFAULT_BASE)
    if (cover) trackImages([cover], base)
    const spans = anchor.querySelectorAll('span').map((span) => text(span.text)).filter(Boolean)
    let duration = ''
    if (source === 'video') {
      duration = spans.find((value) => /^(\d+小時\d+分\d+秒|\d+分\d+秒|\d+秒)$/.test(value)) ?? ''
    } else {
      duration =
        spans.find((value) => /^全\s*\d+\s*集$/.test(value)) ||
        spans.find((value) => /^(本週更新|本週完結|新上架)$/.test(value)) ||
        ''
    }
    seen.add(id)
    items.push({ id, title, cover, duration, meta: cardMeta(anchor) })
  }
  return items
}

export async function shuangkanCatalog(
  source: SkContent,
  category: string,
  page: number,
  baseUrl?: string,
  adapter: SkAdapter = 'rou07',
  sort: SkSort = defaultSkSort(adapter)
): Promise<SkCatalogResponse> {
  const current = Math.max(1, Math.min(20_000, Math.floor(page) || 1))
  if (adapter !== 'rou07') {
    if (source !== 'video') {
      return {
        ok: false,
        items: [],
        page: current,
        lastPage: 0,
        categories: [],
        error: '该源不支持短剧'
      }
    }
    if (adapter === 'pornhub') return pornhubCatalog(category, current, baseUrl, sort)
    if (adapter === 'xvid') return xvidCatalog(category, current, baseUrl, sort)
    if (adapter === 'xhamster') return xhamsterCatalog(category, current, baseUrl, sort)
    return pppCatalog(category, current, baseUrl)
  }
  let path: string
  if (source === 'video') {
    path = category
      ? `/t/${encodeURIComponent(category)}?page=${current}`
      : `/v?page=${current}`
  } else {
    path = category
      ? `/series?tag=${encodeURIComponent(category)}&page=${current}`
      : `/series?page=${current}`
  }
  try {
    const { html, base } = await request(path, baseUrl)
    const root = parse(html)
    const items = parseItems(root, source, base)
    let lastPage = current
    for (const anchor of root.querySelectorAll('a[href]')) {
      const matched = /[?&]page=(\d+)/.exec(attr(anchor, 'href'))
      if (matched) lastPage = Math.max(lastPage, Number(matched[1]))
    }
    return {
      ok: true,
      items,
      page: current,
      lastPage,
      categories: parseCategories(root, source)
    }
  } catch (err) {
    return {
      ok: false,
      items: [],
      page: current,
      lastPage: 0,
      categories: [],
      error: err instanceof Error ? err.message : '加载失败'
    }
  }
}

/** 站内搜索：搜索页只有一页结果，翻页参数会被忽略 */
export async function shuangkanSearch(
  source: SkContent,
  keyword: string,
  page: number,
  baseUrl?: string,
  adapter: SkAdapter = 'rou07'
): Promise<SkCatalogResponse> {
  const current = Math.max(1, Math.floor(page) || 1)
  const query = keyword.trim().slice(0, 100)
  if (!query) return { ok: true, items: [], page: current, lastPage: 0, categories: [] }
  if (adapter !== 'rou07') {
    if (source !== 'video') {
      return {
        ok: false,
        items: [],
        page: current,
        lastPage: 0,
        categories: [],
        error: '该源不支持短剧'
      }
    }
    if (adapter === 'pornhub') return pornhubSearch(query, current, baseUrl)
    if (adapter === 'xvid') return xvidSearch(query, current, baseUrl)
    if (adapter === 'xhamster') return xhamsterSearch(query, current, baseUrl)
    return pppSearch(query, current, baseUrl)
  }
  try {
    const { html, base } = await request(
      `/search?q=${encodeURIComponent(query)}&tab=${source}&page=${current}`,
      baseUrl
    )
    const root = parse(html)
    // 搜索页也有分页，按页面上的 page= 链接取末页，别把结果锁在第一页
    let lastPage = current
    for (const anchor of root.querySelectorAll('a[href]')) {
      const matched = /[?&]page=(\d+)/.exec(attr(anchor, 'href'))
      if (matched) lastPage = Math.max(lastPage, Number(matched[1]))
    }
    return {
      ok: true,
      items: parseItems(root, source, base),
      page: current,
      lastPage,
      categories: []
    }
  } catch (err) {
    return {
      ok: false,
      items: [],
      page: current,
      lastPage: 0,
      categories: [],
      error: err instanceof Error ? err.message : '搜索失败'
    }
  }
}

/** 短剧搜索：搜索页只有一页结果，翻页参数会被忽略 */
export async function shuangkanSeriesSearch(
  keyword: string,
  page: number,
  baseUrl?: string,
  adapter: SkAdapter = 'rou07'
): Promise<SkCatalogResponse> {
  return shuangkanSearch('series', keyword, page, baseUrl, adapter)
}

/* ---------------- 详情 / 播放 ---------------- */

function playUrlOf(html: string, base: string): string {
  const matched = /ev:\$R\[\d+\]=\{d:"([^"]+)",k:(\d+)\}/.exec(html)
  if (!matched) return ''
  try {
    const raw = Buffer.from(matched[1], 'base64')
    const shift = Number(matched[2])
    const bytes = Buffer.from(Array.from(raw, (byte) => byte - shift))
    const payload = JSON.parse(bytes.toString('utf8')) as { videoUrl?: string }
    return absoluteUrl(String(payload.videoUrl ?? ''), base)
  } catch {
    return ''
  }
}

function metaParts(box: HTMLElement): string[] {
  const meta = box
    .querySelectorAll('div')
    .find(
      (div) =>
        String(div.getAttribute('class') ?? '').includes('text-dim') &&
        text(div.text).includes('次觀看')
    )
  if (!meta) return []
  return meta.childNodes
    .filter((node) => node.nodeType === 1)
    .map((node) => text(node.text).replace(/^·\s*/, ''))
    .filter((value) => value && value !== '·')
}

function tagsOf(box: HTMLElement): string[] {
  const out: string[] = []
  for (const anchor of box.querySelectorAll('a[href^="/t/"]')) {
    const tag = text(anchor.text).replace(/^#\s*/, '')
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out
}

export async function shuangkanDetail(
  source: SkContent,
  id: string,
  baseUrl?: string,
  adapter: SkAdapter = 'rou07'
): Promise<SkDetailResponse> {
  if (adapter !== 'rou07') {
    if (source !== 'video') return { ok: false, error: '该源不支持短剧' }
    if (adapter === 'pornhub') return pornhubDetail(id, baseUrl)
    if (adapter === 'xvid') return xvidDetail(id, baseUrl)
    if (adapter === 'xhamster') return xhamsterDetail(id, baseUrl)
    return pppDetail(id, baseUrl)
  }
  if (!/^[A-Za-z0-9]{6,64}$/.test(id)) return { ok: false, error: '无效的内容 ID' }
  try {
    const { html, base } = await request(`/${source === 'video' ? 'v' : 's'}/${id}`, baseUrl)
    const root = parse(html)
    const heading = root.querySelector('h1')
    const title = text(heading?.text)
    if (!title) return { ok: false, error: '内容不存在或已下架' }
    const box = heading?.parentNode ?? root
    const meta = metaParts(box)
    const rawCover =
      attr(root.querySelector('video[poster]'), 'poster') ||
      attr(root.querySelector('meta[property="og:image"]'), 'content')
    const coverUrl = rawCover ? absoluteUrl(rawCover, base) : ''
    if (coverUrl) trackImages([coverUrl], base)
    const duration =
      meta.find((value) => /^(\d+小時\d+分\d+秒|\d+分\d+秒|\d+秒)$/.test(value)) ?? ''
    if (source === 'video') {
      const playUrl = playUrlOf(html, base)
      if (!playUrl) return { ok: false, error: '没有解析到播放地址，可能需要在浏览器里观看' }
      // 详情里的播放地址只做存在性校验：带短时效签名，IPC 层会剥掉，
      // 实际播放统一走 shuangkan:play 现取（那里才做 UA 探测）
      return {
        ok: true,
        detail: {
          id,
          source,
          title,
          cover: coverUrl,
          intro: '',
          tags: tagsOf(box),
          meta,
          duration,
          episodes: [],
          playUrl
        }
      }
    }
    const episodes: SkEpisode[] = []
    const seen = new Set<string>()
    for (const anchor of root.querySelectorAll('a[href^="/v/"]')) {
      const href = attr(anchor, 'href')
      const episodeId = href.slice(3).split(/[?#]/)[0]
      const label = text(anchor.text)
      const matched = /^第\s*(\d+)\s*集/.exec(label)
      if (!matched || !episodeId || seen.has(episodeId)) continue
      seen.add(episodeId)
      const index = Number(matched[1])
      episodes.push({
        id: episodeId,
        index,
        name: `第 ${index} 集`,
        duration: label.replace(/^第\s*\d+\s*集\s*/, '')
      })
    }
    episodes.sort((a, b) => a.index - b.index)
    const intro = text(box.querySelectorAll('p')[0]?.text)
    return {
      ok: true,
      detail: {
        id,
        source,
        title,
        cover: coverUrl,
        intro,
        tags: tagsOf(box),
        meta,
        duration,
        episodes,
        playUrl: null
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '加载失败' }
  }
}

export async function shuangkanPlay(
  id: string,
  baseUrl?: string,
  adapter: SkAdapter = 'rou07'
): Promise<SkPlayResponse> {
  if (adapter !== 'rou07') {
    if (adapter === 'pornhub') return pornhubPlay(id, baseUrl)
    if (adapter === 'xvid') return xvidPlay(id, baseUrl)
    if (adapter === 'xhamster') return xhamsterPlay(id, baseUrl)
    return pppPlay(id, baseUrl)
  }
  if (!/^[A-Za-z0-9]{6,64}$/.test(id)) return { ok: false, error: '无效的视频 ID' }
  try {
    const { html, base } = await request(`/v/${id}`, baseUrl)
    const url = playUrlOf(html, base)
    if (!url) return { ok: false, error: '没有解析到播放地址，可能需要在浏览器里观看' }
    return { ok: true, url: await resolveRou07Play(url) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '播放失败' }
  }
}
