import {
  type MeituAlbum,
  type MeituAlbumDetail,
  type MeituCategoriesResponse,
  type MeituCategory,
  type MeituDetailResponse,
  type MeituImage,
  type MeituListResponse,
  type MeituSourceRef,
  type MeituStar
} from '../src/shared/meitu'

/**
 * 美图模块：两个站点都是服务端渲染页面，直接解析 HTML。
 * - 魅影画廊（jb9）：入口是线路跳转页，需要先解析出可用镜像站
 * - 雪月映画（taoo）：列表/详情都在同一域名，详情图集在 JSON script 里
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const REQUEST_TIMEOUT = 20_000
const JB9_MIRROR_TTL = 30 * 60 * 1000

const jb9MirrorCache = new Map<string, { base: string; at: number }>()

function baseOf(source: MeituSourceRef): string {
  return source.baseUrl.replace(/\/+$/, '')
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => {
      const value = Number(code)
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : ''
    })
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function stripTags(text: string): string {
  return decodeEntities(text.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function slugId(pageUrl: string): string {
  try {
    const path = decodeURIComponent(new URL(pageUrl).pathname).replace(/\/+$/, '')
    const last = path.split('/').filter(Boolean).pop() || path
    return last.replace(/\|/g, '_').slice(0, 160)
  } catch {
    return pageUrl.replace(/\|/g, '_').slice(0, 160)
  }
}

function numericId(raw: string): number {
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : 0
}

function firstNumber(text: string): number {
  const value = text.match(/\d+/)
  return value ? numericId(value[0]) : 0
}

async function fetchHtml(url: string): Promise<{ text: string; url: string }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return { text: await res.text(), url: res.url }
}

/** 魅影画廊是否是正常站点页面（而不是线路跳转页） */
function isJb9Site(html: string): boolean {
  return (
    html.includes('魅影画廊') ||
    html.includes('<div class="post grid') ||
    /\/wp-content\/uploads\//.test(html)
  )
}

/** 解析 jb9.es 跳转页里的备用线路 */
function jb9Targets(html: string): string[] {
  const targets: string[] = []
  for (const match of html.matchAll(/["'](https?:\/\/[^"']+)["']/g)) {
    const url = match[1]
    if (url.includes('jb9.es')) continue
    if (!/^https?:\/\//i.test(url)) continue
    targets.push(url)
  }
  return Array.from(new Set(targets)).slice(0, 6)
}

/** 解析出当前可用的魅影画廊镜像站 */
async function jb9Base(source: MeituSourceRef): Promise<string> {
  const key = baseOf(source)
  const cached = jb9MirrorCache.get(key)
  if (cached && Date.now() - cached.at < JB9_MIRROR_TTL) return cached.base
  const landing = await fetchHtml(key)
  if (isJb9Site(landing.text)) {
    const base = baseOf({ ...source, baseUrl: landing.url })
    jb9MirrorCache.set(key, { base, at: Date.now() })
    return base
  }
  for (const target of jb9Targets(landing.text)) {
    try {
      const probe = await fetchHtml(target)
      if (isJb9Site(probe.text)) {
        const base = baseOf({ ...source, baseUrl: probe.url })
        jb9MirrorCache.set(key, { base, at: Date.now() })
        return base
      }
    } catch {
      // 线路失效时继续尝试下一条
    }
  }
  throw new Error('没有找到可用线路')
}

function isJb9PageUrl(url: string, base: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    const baseHost = new URL(base).hostname.toLowerCase()
    return (
      host === baseHost ||
      host === 'jb9.es' ||
      host.endsWith('.jb9.es') ||
      /^tk\d*\.myhl\d*\.(sbs|top|cc|com)$/.test(host)
    )
  } catch {
    return false
  }
}

function isTaooPageUrl(url: string, base: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    const baseHost = new URL(base).hostname.toLowerCase()
    return host === baseHost
  } catch {
    return false
  }
}

// ---------- 魅影画廊（jb9） ----------

const JB9_DEFAULT_CATEGORIES: MeituCategory[] = [
  { id: 'c14', label: '大尺度' },
  { id: 'c3', label: '人体套图' },
  { id: 'c5', label: '秀人网' },
  { id: 'c39', label: '工作室出品' }
]

/** 热门明星不是分类，是站点单独一页的作者榜 */
const JB9_STARS_ID = '@stars'
const JB9_STARS_LABEL = '热门明星'
const JB9_CATEGORY_TTL = 6 * 60 * 60 * 1000
const JB9_POSTS_PER_PAGE = 12

const jb9CategoryCache = new Map<string, { categories: MeituCategory[]; at: number }>()

function jb9StarsUrl(base: string): string {
  return joinUrl(base, `/${encodeURIComponent(JB9_STARS_LABEL)}/`)
}

function jb9FallbackCategories(): MeituCategory[] {
  return [
    { id: '', label: '全部' },
    ...JB9_DEFAULT_CATEGORIES,
    { id: JB9_STARS_ID, label: JB9_STARS_LABEL }
  ]
}

function jb9PostCount(html: string): number {
  return (html.match(/<div class="post grid/g) || []).length
}

/** 站点不直接给总数：用「首页 + 末页」折算出该分类的图集数量 */
async function jb9CategoryCount(base: string, category: string): Promise<number> {
  const first = await fetchHtml(jb9ListUrl(base, category, 1, ''))
  const firstPosts = jb9PostCount(first.text)
  const lastPage = lastPageFromHtml(first.text, 1, false)
  if (lastPage <= 1) return firstPosts
  const last = await fetchHtml(jb9ListUrl(base, category, lastPage, ''))
  const perPage = firstPosts || JB9_POSTS_PER_PAGE
  return (lastPage - 1) * perPage + jb9PostCount(last.text)
}

/** 站点顶部导航里的全部分类（含下拉里的细分），跳过深夜电台 */
function parseJb9NavCategories(html: string): MeituCategory[] {
  const start = html.indexOf('<ul class="nav-main">')
  if (start < 0) return []
  let depth = 0
  let end = html.length
  const tagRe = /<\/?ul\b/gi
  tagRe.lastIndex = start
  for (let match = tagRe.exec(html); match; match = tagRe.exec(html)) {
    depth += match[0].startsWith('</') ? -1 : 1
    if (depth === 0) {
      end = match.index
      break
    }
  }
  const block = html.slice(start, end)
  const categories: MeituCategory[] = []
  const labels = new Set<string>()
  for (const match of block.matchAll(
    /<a[^>]*href="([^"]*\/category\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi
  )) {
    const label = stripTags(match[2])
    if (!label || label.length > 20 || label.includes('深夜电台') || labels.has(label)) continue
    const slug = match[1].match(/\/category\/([^"#?]+?)\/?$/i)?.[1] || ''
    if (!slug || /^diantai(\/|$)/i.test(slug)) continue
    labels.add(label)
    categories.push({ id: slug, label })
  }
  return categories
}

async function jb9Categories(source: MeituSourceRef): Promise<MeituCategoriesResponse> {
  try {
    const base = await jb9Base(source)
    const cached = jb9CategoryCache.get(base)
    if (cached && Date.now() - cached.at < JB9_CATEGORY_TTL) {
      return { ok: true, categories: cached.categories }
    }
    const { text } = await fetchHtml(joinUrl(base, '/all/'))
    // 分类口径：站点导航的全部分类（保留以前下拉里的细分），不再使用 /all 筛选条
    const nav = parseJb9NavCategories(text)
    const categories: MeituCategory[] = [{ id: '', label: '全部' }]
    categories.push(...(nav.length ? nav : JB9_DEFAULT_CATEGORIES))
    categories.push({ id: JB9_STARS_ID, label: JB9_STARS_LABEL })
    // 数量：每个分类并发抓首页 + 末页（4 个并发，失败不影响分类展示）
    const targets = categories.filter((entry) => entry.id !== JB9_STARS_ID)
    let cursor = 0
    const workers = Array.from({ length: Math.min(4, targets.length) }, async () => {
      while (cursor < targets.length) {
        const entry = targets[cursor++]
        try {
          entry.count = await jb9CategoryCount(base, entry.id)
        } catch {
          // 某个分类数量抓取失败时留空
        }
      }
    })
    await Promise.all(workers)
    jb9CategoryCache.set(base, { categories, at: Date.now() })
    return { ok: true, categories }
  } catch (err) {
    return {
      ok: true,
      categories: jb9FallbackCategories(),
      error: (err as Error).message
    }
  }
}

function jb9ListUrl(base: string, category: string, page: number, keyword: string): string {
  if (keyword) {
    return page > 1
      ? joinUrl(base, `/page/${page}/?s=${encodeURIComponent(keyword)}`)
      : joinUrl(base, `/?s=${encodeURIComponent(keyword)}`)
  }
  if (category === JB9_STARS_ID) {
    return page > 1
      ? joinUrl(base, `/${encodeURIComponent(JB9_STARS_LABEL)}/page/${page}/`)
      : jb9StarsUrl(base)
  }
  if (category.startsWith('@author:')) {
    const slug = category.slice('@author:'.length).replace(/^\/+|\/+$/g, '')
    if (!slug) return joinUrl(base, '/all/')
    return page > 1
      ? joinUrl(base, `/author/${slug}/page/${page}/`)
      : joinUrl(base, `/author/${slug}/`)
  }
  if (/^c\d+$/.test(category)) {
    const query = `c=${category.slice(1)}&c2&c3&c4&t`
    return page > 1
      ? joinUrl(base, `/all/page/${page}/?${query}`)
      : joinUrl(base, `/all/?${query}`)
  }
  if (category) {
    const paged = page > 1 ? `page/${page}/` : ''
    return joinUrl(base, `/category/${category.replace(/^\/+|\/+$/g, '')}/${paged}`)
  }
  return page > 1 ? joinUrl(base, `/all/page/${page}/`) : joinUrl(base, '/all/')
}

function parseJb9Items(html: string, base: string, source: string): MeituAlbum[] {
  const items: MeituAlbum[] = []
  const blocks = html.split('<div class="post grid').slice(1)
  for (const block of blocks) {
    const head = block.slice(0, 400)
    const href =
      block.match(/<div class="img">\s*<a[^>]*href="([^"]+)"/i)?.[1] ||
      head.match(/<a[^>]*href="([^"]+)"/i)?.[1] ||
      ''
    if (!href) continue
    let pageUrl = ''
    try {
      pageUrl = new URL(href, base).toString()
    } catch {
      continue
    }
    if (!isJb9PageUrl(pageUrl, base)) continue
    const cover = block.match(/<img[^>]+src="([^"]+)"/i)?.[1] || ''
    const title =
      stripTags(
        block.match(/<h3[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ||
          block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ||
          ''
      ) || '未命名图集'
    const count = firstNumber(block.match(/<div class="num">([\s\S]*?)<\/div>/i)?.[1] || '')
    const tagBlock = block.match(/<div class="tag">([\s\S]*?)<\/div>/i)?.[1] || ''
    const tags = Array.from(tagBlock.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi))
      .map((match) => stripTags(match[1]))
      .filter((tag) => tag && tag.length <= 20)
    const timeText = stripTags(
      block.match(/<span class="time">([\s\S]*?)<\/span>/i)?.[1] ||
        block.match(/<div class="grid-meta">[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
        ''
    )
    const rawId = block.match(/data-id="(\d+)"/)?.[1]
    items.push({
      source,
      id: rawId || slugId(pageUrl),
      title,
      cover,
      pageUrl,
      imageCount: count,
      tags,
      timeText
    })
  }
  return items
}

/** 站点数字可能带千分位（阅读量 700,923） */
function metricNumber(raw: string): number {
  const digits = raw.replace(/[^\d]/g, '')
  return digits ? numericId(digits) : 0
}

/** 热门明星页：作者榜卡片（头像 / 名字 / 文章数 / 阅读量） */
function parseJb9Stars(html: string, base: string, source: string): MeituStar[] {
  const stars: MeituStar[] = []
  const seen = new Set<string>()
  for (const block of html.split('<div class="author-item"').slice(1)) {
    const href =
      block.match(/class="author-avatar"[\s\S]{0,400}?href="([^"]+)"/i)?.[1] ||
      block.match(/href="([^"]*\/author\/[^"]+)"/i)?.[1] ||
      ''
    if (!href) continue
    let authorUrl = ''
    try {
      authorUrl = new URL(href, base).toString()
    } catch {
      continue
    }
    if (!isJb9PageUrl(authorUrl, base)) continue
    let slug = ''
    try {
      slug =
        decodeURIComponent(new URL(authorUrl).pathname)
          .replace(/\/+$/, '')
          .split('/')
          .filter(Boolean)
          .pop() || ''
    } catch {
      slug = ''
    }
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    const name =
      stripTags(
        block.match(/<span class="author-name">([\s\S]*?)<\/span>/i)?.[1] ||
          block.match(/<h4 class="name">[\s\S]{0,300}?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ||
          ''
      ) || slug
    // 站点会把 JVID 之类的厂牌混进作者 / 明星榜，按要求不展示
    if (/jvid/i.test(name) || /jvid/i.test(slug)) continue
    const avatar =
      block.match(/<img[^>]+src="([^"]+)"[^>]*class="[^"]*avatar/i)?.[1] ||
      block.match(/class="author-avatar"[\s\S]{0,400}?<img[^>]+src="([^"]+)"/i)?.[1] ||
      ''
    const metaBlock = block.match(/<ul class="meta">([\s\S]*?)<\/ul>/i)?.[1] || ''
    const articles = metricNumber(
      metaBlock.match(/文章数[\s\S]{0,200}?<span>([^<]*)<\/span>/i)?.[1] || ''
    )
    const reads = metricNumber(
      metaBlock.match(/阅读量[\s\S]{0,200}?<span>([^<]*)<\/span>/i)?.[1] || ''
    )
    const desc = stripTags(
      block.match(/<p class="author-description">([\s\S]*?)<\/p>/i)?.[1] || ''
    )
    stars.push({
      source,
      slug,
      name,
      avatar: decodeEntities(avatar),
      authorUrl,
      articles,
      reads,
      desc
    })
  }
  return stars
}

function lastPageFromHtml(html: string, page: number, fallbackStep: boolean): number {
  let max = 0
  for (const match of html.matchAll(/\/page\/(\d+)\//g)) {
    const value = numericId(match[1])
    if (value > max) max = value
  }
  if (max > 0) return max
  return fallbackStep ? page + 1 : page
}

async function jb9List(
  source: MeituSourceRef,
  category: string,
  page: number,
  keyword: string
): Promise<MeituListResponse> {
  const base = await jb9Base(source)
  const url = jb9ListUrl(base, category, page, keyword)
  let html = ''
  try {
    html = (await fetchHtml(url)).text
  } catch (err) {
    // 站点对超出范围的页码回 404/410：当作已到最后一页；其它网络错误要如实报给页面
    if (page > 1 && /HTTP (404|410)/.test((err as Error).message)) {
      return {
        ok: true,
        page: {
          source: source.id,
          category,
          keyword,
          page,
          lastPage: page - 1,
          total: 0,
          items: []
        }
      }
    }
    return { ok: false, error: (err as Error).message }
  }
  const items = parseJb9Items(html, base, source.id)
  const lastPage = lastPageFromHtml(html, page, !keyword && items.length >= 20)
  const stars = category === JB9_STARS_ID && !keyword ? parseJb9Stars(html, base, source.id) : []
  return {
    ok: true,
    page: {
      source: source.id,
      category,
      keyword,
      page,
      lastPage,
      total: stars.length ? stars.length : items.length,
      items,
      ...(stars.length ? { stars } : {})
    }
  }
}

async function jb9Detail(
  source: MeituSourceRef,
  pageUrl: string
): Promise<MeituDetailResponse> {
  const base = await jb9Base(source)
  if (!isJb9PageUrl(pageUrl, base)) return { ok: false, error: '图集地址无效' }
  const { text } = await fetchHtml(pageUrl)
  const title =
    stripTags(text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '') ||
    stripTags(text.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').replace(
      /\s*[-_|].*$/,
      ''
    ) ||
    '图集'
  const images: MeituImage[] = []
  const seen = new Set<string>()
  const push = (url: string, thumb?: string) => {
    const textUrl = decodeEntities(url).trim()
    if (!/^https?:\/\//i.test(textUrl) || seen.has(textUrl)) return
    if (!/\.(jpe?g|png|webp|gif)(\?|$)/i.test(textUrl)) return
    if (/logo|avatar|placeholder|loading/i.test(textUrl)) return
    seen.add(textUrl)
    images.push({ url: textUrl, thumb: thumb ? decodeEntities(thumb) : undefined })
  }
  const galleryRe =
    /<a[^>]+href=["']([^"']+\.(?:jpe?g|png|webp|gif)(?:\?[^"']*)?)["'][^>]*>[\s\S]{0,400}?<img[^>]+src=["']([^"']+)["']/gi
  for (const match of text.matchAll(galleryRe)) {
    const full = match[1]
    if (/\/(?:logo|avatar)|\d+x\d+\.(?:jpe?g|png)$/i.test(full)) continue
    push(full, match[2])
  }
  if (!images.length) {
    for (const match of text.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
      push(match[1])
    }
  }
  if (!images.length) return { ok: false, error: '没有解析到图片' }
  const tags = Array.from(
    (text.match(/class="[^"]*article-tags[^"]*"[\s\S]{0,2000}?<\/div>/i)?.[0] || '').matchAll(
      /<a[^>]*>([\s\S]*?)<\/a>/gi
    )
  )
    .map((match) => stripTags(match[1]))
    .filter(Boolean)
  const album: MeituAlbumDetail = {
    source: source.id,
    id: slugId(pageUrl),
    title: title.slice(0, 200),
    pageUrl,
    images,
    tags
  }
  return { ok: true, album }
}

// ---------- 雪月映画（taoo） ----------

const TAOO_DEFAULT_CATEGORIES: MeituCategory[] = [
  { id: 'r18', label: 'R18' },
  { id: 'r15', label: 'R15' }
]

async function taooCategories(source: MeituSourceRef): Promise<MeituCategoriesResponse> {
  try {
    const base = baseOf(source)
    const { text } = await fetchHtml(`${base}/`)
    const categories: MeituCategory[] = []
    const seen = new Set<string>()
    for (const match of text.matchAll(
      /href="([^"]*\/category\/([^"/]+)\/?)"[^>]*>([\s\S]*?)<\/a>/gi
    )) {
      const slug = decodeURIComponent(match[2])
      const label = stripTags(match[3])
      if (!slug || !label || label.length > 30 || seen.has(slug)) continue
      seen.add(slug)
      categories.push({ id: slug, label })
    }
    if (!categories.length) {
      return { ok: true, categories: [{ id: '', label: '全部' }, ...TAOO_DEFAULT_CATEGORIES] }
    }
    return { ok: true, categories: [{ id: '', label: '全部' }, ...categories] }
  } catch (err) {
    return {
      ok: true,
      categories: [{ id: '', label: '全部' }, ...TAOO_DEFAULT_CATEGORIES],
      error: (err as Error).message
    }
  }
}

function taooListUrl(base: string, category: string, page: number): string {
  if (category) {
    const root = joinUrl(base, `/category/${category.replace(/^\/+|\/+$/g, '')}/`)
    return page > 1 ? joinUrl(root, `${page}/`) : root
  }
  return page > 1 ? joinUrl(base, `/page/${page}/`) : `${base}/`
}

function parseTaooItems(html: string, base: string, source: string): MeituAlbum[] {
  const items: MeituAlbum[] = []
  for (const block of html.split('class="item col-xs-6').slice(1)) {
    const href = block.match(/<a class="item-link" href="([^"]+)"/i)?.[1] || ''
    if (!href) continue
    let pageUrl = ''
    try {
      pageUrl = new URL(href, base).toString()
    } catch {
      continue
    }
    if (!isTaooPageUrl(pageUrl, base)) continue
    const cover =
      decodeEntities(
        block.match(/data-original="([^"]+)"/i)?.[1] ||
          block.match(/data-full-original="([^"]+)"/i)?.[1] ||
          ''
      ) || ''
    const title =
      stripTags(block.match(/<div class="item-link-text">([\s\S]*?)<\/div>/i)?.[1] || '') ||
      '未命名图集'
    const sort = stripTags(block.match(/<span class="item-sort">([\s\S]*?)<\/span>/i)?.[1] || '')
    const numText = block.match(/<span class="item-num">([\s\S]*?)<\/span>/i)?.[1] || ''
    let imageCount = firstNumber(numText)
    if (!imageCount) {
      const preview = block.match(/data-gallery-preview-paths="([^"]+)"/i)?.[1]
      if (preview) {
        try {
          const parsed = JSON.parse(decodeEntities(preview)) as unknown
          imageCount = Array.isArray(parsed) ? parsed.length : 0
        } catch {
          imageCount = 0
        }
      }
    }
    items.push({
      source,
      id: slugId(pageUrl),
      title,
      cover,
      pageUrl,
      imageCount,
      tags: sort ? [sort] : [],
      timeText: sort
    })
  }
  return items
}

function taooLastPage(html: string, page: number, items: number, isSearch: boolean): number {
  if (isSearch) return 1
  let max = 0
  for (const match of html.matchAll(
    /(?:page|search\/[^"/]+|category\/[^"/]+)\/(\d+)\//g
  )) {
    const value = numericId(match[1])
    if (value > max) max = value
  }
  for (const match of html.matchAll(/[?&]page=(\d+)/g)) {
    const value = numericId(match[1])
    if (value > max) max = value
  }
  if (max > 0) return max
  return items >= 20 ? page + 1 : page
}

async function taooList(
  source: MeituSourceRef,
  category: string,
  page: number,
  keyword: string
): Promise<MeituListResponse> {
  const base = baseOf(source)
  const url = keyword
    ? joinUrl(base, `/search/${encodeURIComponent(keyword)}/`)
    : taooListUrl(base, category, page)
  let html = ''
  try {
    html = (await fetchHtml(url)).text
  } catch (err) {
    // 站点对超出范围的页码回 404/410：当作已到最后一页；其它网络错误要如实报给页面
    if (page > 1 && /HTTP (404|410)/.test((err as Error).message)) {
      return {
        ok: true,
        page: {
          source: source.id,
          category,
          keyword,
          page,
          lastPage: page - 1,
          total: 0,
          items: []
        }
      }
    }
    return { ok: false, error: (err as Error).message }
  }
  const items = parseTaooItems(html, base, source.id)
  return {
    ok: true,
    page: {
      source: source.id,
      category,
      keyword,
      page,
      lastPage: taooLastPage(html, page, items.length, !!keyword),
      total: items.length,
      items
    }
  }
}

async function taooDetail(
  source: MeituSourceRef,
  pageUrl: string
): Promise<MeituDetailResponse> {
  const base = baseOf(source)
  if (!isTaooPageUrl(pageUrl, base)) return { ok: false, error: '图集地址无效' }
  const { text } = await fetchHtml(pageUrl)
  const images: MeituImage[] = []
  const seen = new Set<string>()
  const push = (url: string, thumb?: string) => {
    const textUrl = decodeEntities(url).trim()
    if (!/^https?:\/\//i.test(textUrl) || seen.has(textUrl)) return
    seen.add(textUrl)
    images.push({ url: textUrl, thumb: thumb ? decodeEntities(thumb) : undefined })
  }
  const raw = text.match(
    /<script[^>]+id=["']virtual-gallery-data["'][^>]*>([\s\S]*?)<\/script>/i
  )?.[1]
  if (raw) {
    try {
      const parsed = JSON.parse(decodeEntities(raw)) as {
        items?: { original?: string; display?: string; thumb?: string }[]
      }
      for (const item of parsed.items || []) {
        if (typeof item.original === 'string' && item.original) {
          push(item.original, typeof item.display === 'string' ? item.display : undefined)
        }
      }
    } catch {
      // 解析失败时走下面的预览路径兜底
    }
  }
  if (!images.length) {
    for (const match of text.matchAll(/data-gallery-preview-paths="([^"]+)"/gi)) {
      try {
        const parsed = JSON.parse(decodeEntities(match[1])) as unknown
        if (Array.isArray(parsed)) {
          for (const path of parsed) {
            if (typeof path === 'string' && path) {
              push(`https://xyyimg.com/images/${path.replace(/^\/+/, '')}`)
            }
          }
        }
      } catch {
        // 忽略损坏的 JSON
      }
    }
  }
  if (!images.length) return { ok: false, error: '没有解析到图片' }
  const title =
    stripTags(text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '') ||
    stripTags(text.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').replace(
      /\s*[-_|].*$/,
      ''
    ) ||
    '图集'
  const tags = Array.from(new Set(
    Array.from(text.matchAll(/href="[^"]*\/category\/([^"/]+)\/?"/gi)).map((match) =>
      decodeURIComponent(match[1])
    )
  ))
  const album: MeituAlbumDetail = {
    source: source.id,
    id: slugId(pageUrl),
    title: title.slice(0, 200),
    pageUrl,
    images,
    tags
  }
  return { ok: true, album }
}

// ---------- 对外入口 ----------

export async function meituList(
  source: MeituSourceRef,
  category: string,
  page: number,
  keyword: string
): Promise<MeituListResponse> {
  try {
    const safePage = Math.max(1, Math.round(page) || 1)
    return source.template === 'jb9'
      ? await jb9List(source, category, safePage, keyword)
      : await taooList(source, category, safePage, keyword)
  } catch (err) {
    return { ok: false, error: (err as Error).message || '加载失败' }
  }
}

export async function meituCategories(
  source: MeituSourceRef
): Promise<MeituCategoriesResponse> {
  try {
    return source.template === 'jb9' ? await jb9Categories(source) : await taooCategories(source)
  } catch (err) {
    return { ok: false, error: (err as Error).message || '加载分类失败' }
  }
}

export async function meituDetail(
  source: MeituSourceRef,
  pageUrl: string
): Promise<MeituDetailResponse> {
  try {
    return source.template === 'jb9'
      ? await jb9Detail(source, pageUrl)
      : await taooDetail(source, pageUrl)
  } catch (err) {
    return { ok: false, error: (err as Error).message || '加载图集失败' }
  }
}
