import {
  type WallpaperCategoriesResponse,
  type WallpaperCategory,
  type WallpaperDevice,
  type WallpaperItem,
  type WallpaperListResponse,
  type WallpaperPage,
  type WallpaperResolveResponse,
  type WallpaperSourceRef
} from '../src/shared/wallpaper'

/**
 * 壁纸模块：壁纸源都是服务端渲染页面，这里直接解析 HTML。
 * 列表结果统一成 WallpaperItem，渲染层不关心站点差异。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const REQUEST_TIMEOUT = 20_000

const BIZHIMI_PC_CAT = '34'
const BIZHIMI_MOBILE_CAT = '5626'

function baseOf(source: WallpaperSourceRef): string {
  return source.baseUrl.replace(/\/+$/, '')
}

function siteHost(source: WallpaperSourceRef): string {
  try {
    return new URL(source.baseUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const text = buf.toString('utf8')
  if (!text.trim()) throw new Error('站点返回空内容')
  return text
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

function positiveInt(value: unknown): number {
  const num = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 0
}

function cleanTitle(raw: string): string {
  return raw.replace(/^图片\s*/u, '').replace(/\s+/g, ' ').trim()
}

/** 从 HTML 里取 `window.xxx = {...}` 的 JSON（处理字符串里的花括号与转义） */
function grabWindowJson(html: string, name: string): Record<string, unknown> | null {
  const marker = `window.${name} = `
  const start = html.indexOf(marker)
  if (start < 0) return null
  const from = html.indexOf('{', start)
  if (from < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = from; i < html.length; i += 1) {
    const char = html[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          const parsed = JSON.parse(html.slice(from, i + 1)) as unknown
          return parsed && typeof parsed === 'object'
            ? (parsed as Record<string, unknown>)
            : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 分类 id 里可能带 `genre/for_desktop` 这样的斜杠，逐段编码后再拼回 */
function encodePath(value: string): string {
  return value
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/** 简单并发控制：分类数量需要多次请求，避免一次打满站点 */
async function mapLimit<T, R>(
  list: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(list.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++
      if (index >= list.length) return
      results[index] = await fn(list[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker))
  return results
}

// ---------- Wallspic ----------

function wallspicUrl(
  source: WallpaperSourceRef,
  category: string,
  page: number,
  keyword: string
): string {
  const base = baseOf(source)
  if (keyword) {
    const path = `${base}/search/${encodeURIComponent(keyword)}`
    return page > 1 ? `${path}?page=${page}` : path
  }
  const album = category.trim() || 'for_desktop'
  const path = `${base}/album/${encodePath(album)}`
  return page > 1 ? `${path}?page=${page}` : path
}

function parseWallspicList(
  html: string,
  sourceId: string,
  category: string,
  keyword: string,
  page: number
): WallpaperPage {
  const target = grabWindowJson(html, 'mainGalleryTarget') ?? {}
  const gallery = grabWindowJson(html, 'mainAdaptiveGallery') ?? {}
  const items: WallpaperItem[] = []

  for (const raw of asArray(gallery.list)) {
    const record = asRecord(raw)
    if (!record) continue
    const id = String(record.id ?? '')
    const original = asRecord(record.original)
    const thumbnail = asRecord(record.thumbnail)
    const labels = asRecord(record.labels)
    const link = asString(original?.link)
    const thumb = asString(thumbnail?.link)
    if (!id || !link || !thumb) continue
    const tags = asString(labels?.href_title)
      .split(/[,，]/u)
      .map((tag) => tag.trim())
      .filter(Boolean)
    items.push({
      source: sourceId,
      id,
      title: cleanTitle(asString(labels?.title)) || `壁纸 ${id}`,
      thumb,
      pageUrl: link,
      width: positiveInt(original?.width),
      height: positiveInt(original?.height),
      fullUrl: null,
      previewUrl: thumb,
      sizeText: '',
      tags
    })
  }

  return {
    source: sourceId,
    category,
    keyword,
    page,
    lastPage: positiveInt(target.pages) || 1,
    total: positiveInt(target.total),
    items
  }
}

async function wallspicAlbumTotal(source: WallpaperSourceRef, slug: string): Promise<number> {
  const html = await fetchHtml(`${baseOf(source)}/album/${encodePath(slug)}`)
  const target = grabWindowJson(html, 'mainGalleryTarget') ?? {}
  return positiveInt(target.total)
}

async function wallspicCategories(
  source: WallpaperSourceRef,
  device: WallpaperDevice
): Promise<WallpaperCategory[]> {
  const album = device === 'pc' ? 'for_desktop' : 'for_mobile'
  const html = await fetchHtml(`${baseOf(source)}/album/${album}`)
  const start = html.indexOf('sidepanel-shortnav__field')
  const end = start >= 0 ? html.indexOf('</select>', start) : -1
  // 只取「种类」下拉本身，后面还有分辨率 / 手机尺寸等 select，不能一起抓
  const block = start >= 0 && end > start ? html.slice(start, end) : ''
  const re = /value="([^"]*\/album\/([^"]+))"[^>]*>\s*([^<]+?)\s*<\/option>/g
  let match: RegExpExecArray | null
  const entries: WallpaperCategory[] = []
  const seen = new Set<string>()
  while ((match = re.exec(block))) {
    const id = match[2].trim()
    const label = decodeEntities(match[3]).trim()
    if (!id || !label || seen.has(id)) continue
    seen.add(id)
    // 第一项是站点的「所有类型」，按设备统一叫「全部」
    entries.push({ id, label: entries.length === 0 ? '全部' : label })
  }
  if (!entries.length) throw new Error('分类数据为空')

  const totals = await mapLimit(entries, 4, (entry) =>
    wallspicAlbumTotal(source, entry.id).catch(() => 0)
  )
  return entries.map((entry, index) => ({ ...entry, count: totals[index] || 0 }))
}

export async function resolveWallspic(
  pageUrl: string,
  width: number,
  height: number
): Promise<WallpaperResolveResponse> {
  const html = await fetchHtml(pageUrl)
  // 详情页「下载」按钮指向 attachments/originals，这是站点提供的原图
  const original = html.match(
    /href="(https:\/\/img\d+\.wallspic\.com\/attachments\/originals\/[^"]+)"[^>]*class="[^"]*wallpaper__download/u
  )
  if (original) {
    return {
      ok: true,
      url: original[1],
      width,
      height,
      sizeText: ''
    }
  }
  const page = grabWindowJson(html, 'page')
  const image = asArray(page?.metaObjects)
    .map((entry) => asRecord(entry))
    .find(
      (entry) => entry?.['@type'] === 'ImageObject' && typeof entry.contentUrl === 'string'
    )
  if (image) {
    return {
      ok: true,
      url: String(image.contentUrl),
      width: positiveInt(image.width) || width,
      height: positiveInt(image.height) || height,
      sizeText: ''
    }
  }
  const fallback = html.match(
    /https:\/\/img\d+\.wallspic\.com\/(?:attachments\/)?crops\/[^"'\s\\]+?-(\d+)x(\d+)\.jpg/u
  )
  if (!fallback) return { ok: false, error: '没有找到可下载的图片地址' }
  return {
    ok: true,
    url: fallback[0],
    width: positiveInt(fallback[1]),
    height: positiveInt(fallback[2]),
    sizeText: ''
  }
}

// ---------- 壁纸迷 ----------

function bizhimiCatId(category: string): string {
  return /^\d+$/.test(category) ? category : ''
}

function bizhimiUrl(
  source: WallpaperSourceRef,
  category: string,
  page: number,
  keyword: string
): string {
  const base = baseOf(source)
  if (keyword) {
    const search = `?s=${encodeURIComponent(keyword)}`
    return page > 1 ? `${base}/page/${page}${search}` : `${base}/${search}`
  }
  const text = category.trim()
  // 手机壁纸的内容分类是站点标签（tag:xxx），走手机分区 + tag 查询
  if (text.startsWith('tag:')) {
    const tag = encodeURIComponent(text.slice(4))
    return page > 1
      ? `${base}/wallpaper/mobile-wallpaper/page/${page}?tag=${tag}`
      : `${base}/wallpaper/mobile-wallpaper?tag=${tag}`
  }
  // 手机壁纸「全部」：站点独立分区
  if (text === BIZHIMI_MOBILE_CAT) {
    return page > 1
      ? `${base}/wallpaper/mobile-wallpaper/page/${page}`
      : `${base}/wallpaper/mobile-wallpaper`
  }
  const cat = bizhimiCatId(text) || BIZHIMI_PC_CAT
  if (cat) {
    return page > 1 ? `${base}/page/${page}/?cat=${cat}` : `${base}/?cat=${cat}`
  }
  // 导航里的内容分类（photo/ziran 等路径）
  const path = `${base}/wallpaper/${encodePath(text)}`
  return page > 1 ? `${path}/page/${page}` : path
}

function bizhimiLastPage(html: string): number {
  const pages = [...html.matchAll(/\/page\/(\d+)/g)].map((match) => positiveInt(match[1]))
  return pages.length ? Math.max(...pages) : 1
}

/** 缩略图升级：堆糖换 2000 尺寸；imgtu 原图通常只有几百 KB，直接当预览图 */
function bizhimiPreview(thumb: string, full: string): string {
  try {
    const host = new URL(thumb).hostname.toLowerCase()
    if (/(^|\.)(dtstatic|duitang)\.com$/.test(host)) {
      return thumb.replace(/\.thumb\.\d+_0\./, '.thumb.2000_0.')
    }
    if (/(^|\.)imgtu\.bzee\.cn$/.test(host) && full) return full
  } catch {
    // 非法地址忽略
  }
  return ''
}

function parseBizhimiList(
  html: string,
  sourceId: string,
  category: string,
  keyword: string,
  page: number
): WallpaperPage {
  const items: WallpaperItem[] = []
  const seen = new Set<string>()
  const re = /data-img-info='([^']+)'/g
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    let info: Record<string, unknown> | null = null
    try {
      info = asRecord(JSON.parse(decodeEntities(match[1])))
    } catch {
      info = null
    }
    if (!info) continue
    const id = String(info.id ?? '')
    const thumb = asString(info.url)
    if (!id || !thumb || seen.has(id)) continue
    seen.add(id)
    const stats = asRecord(info.stats)
    const dimensions = asString(stats?.dimensions)
    const dim = dimensions.match(/(\d+)\s*x\s*(\d+)/)
    const tags = asArray(info.tags)
      .map((tag) => asString(asRecord(tag)?.name))
      .filter(Boolean)
    const full = asString(info.largeUrl)
    items.push({
      source: sourceId,
      id,
      title: cleanTitle(asString(info.title)) || `壁纸 ${id}`,
      thumb,
      pageUrl: asString(info.link),
      width: dim ? positiveInt(dim[1]) : 0,
      height: dim ? positiveInt(dim[2]) : 0,
      fullUrl: full || thumb,
      previewUrl: bizhimiPreview(thumb, full) || thumb,
      sizeText: '',
      tags
    })
  }

  return {
    source: sourceId,
    category,
    keyword,
    page,
    lastPage: bizhimiLastPage(html),
    total: 0,
    items
  }
}

function parseBizhimiFilters(html: string): WallpaperCategory[] {
  const entries: WallpaperCategory[] = []
  const re =
    /data-filter-option\s+data-target="filter-cat"\s+data-value="(\d+)"\s+data-label="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const id = match[1]
    if (id === '0') continue
    const label = decodeEntities(match[2]).trim()
    const parsed = label.match(/^(.*?)\s*\(([\d,]+)\)$/)
    const name = (parsed ? parsed[1] : label).trim()
    const count = parsed ? positiveInt(parsed[2].replace(/,/g, '')) : 0
    if (name) entries.push({ id, label: name, count })
  }
  return entries
}

/** 手机壁纸页的分类来自站点导航（通用 / 自然风景 / 卡通动漫 …） */
function parseBizhimiNav(html: string): WallpaperCategory[] {
  const entries: WallpaperCategory[] = []
  const seen = new Set<string>()
  const re =
    /<a href="[^"]*\/wallpaper\/([^"]+)"[^>]*><span class="nav-category-name">([^<]+)<\/span>\s*<span class="nav-category-count">([^<]+)<\/span><\/a>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const id = match[1].replace(/\/+$/, '')
    const label = decodeEntities(match[2]).trim()
    const count = positiveInt(decodeEntities(match[3]).replace(/,/g, ''))
    if (!id || !label || seen.has(id)) continue
    seen.add(id)
    entries.push({ id, label, count })
  }
  return entries
}

interface BizhimiTag {
  slug: string
  label: string
  tagId: string
}

/** 手机壁纸页的分类来自站点「标签」区（archive-tags） */
function parseBizhimiTags(html: string): BizhimiTag[] {
  const entries: BizhimiTag[] = []
  const seen = new Set<string>()
  const re = /<a\b([^>]*class="[^"]*bc-tag[^"]*"[^>]*)>([\s\S]*?)<\/a>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const attrs = match[1]
    const href = attrs.match(/href="([^"]+)"/)?.[1] ?? ''
    const slug = href.match(/\/tag\/([^"/?]+)/)?.[1] ?? ''
    const tagId = attrs.match(/data-tag-id="(\d+)"/)?.[1] ?? ''
    const label = decodeEntities(match[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    if (!slug || !label || !tagId || seen.has(slug)) continue
    seen.add(slug)
    entries.push({ slug, label, tagId })
  }
  return entries
}

/** 手机壁纸 + 标签的准确数量：WordPress REST 的 X-WP-Total */
async function bizhimiTagTotal(base: string, tagId: string): Promise<number> {
  const res = await fetch(
    `${base}/wp-json/wp/v2/posts?categories=${BIZHIMI_MOBILE_CAT}&tags=${encodeURIComponent(
      tagId
    )}&per_page=1`,
    {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT)
    }
  )
  if (!res.ok) return 0
  return positiveInt(res.headers.get('x-wp-total'))
}

async function bizhimiCategories(
  source: WallpaperSourceRef,
  device: WallpaperDevice
): Promise<WallpaperCategory[]> {
  const base = baseOf(source)
  if (device === 'mobile') {
    const html = await fetchHtml(`${base}/wallpaper/mobile-wallpaper`)
    const tags = parseBizhimiTags(html)
    if (!tags.length) throw new Error('分类数据为空')
    const nav = parseBizhimiNav(html).find((entry) => entry.id === 'mobile-wallpaper')
    const totals = await mapLimit(tags, 4, (tag) =>
      bizhimiTagTotal(base, tag.tagId).catch(() => 0)
    )
    return [
      { id: BIZHIMI_MOBILE_CAT, label: '全部', count: nav?.count ?? 0 },
      ...tags.map((tag, index) => ({
        id: `tag:${tag.slug}`,
        label: tag.label,
        ...(totals[index] > 0 ? { count: totals[index] } : {})
      }))
    ]
  }

  const entries = parseBizhimiFilters(await fetchHtml(`${base}/`))
  if (!entries.length) throw new Error('分类数据为空')
  const pc = entries.find((entry) => entry.id === BIZHIMI_PC_CAT)
  const rest = entries.filter(
    (entry) => entry.id !== BIZHIMI_PC_CAT && entry.id !== BIZHIMI_MOBILE_CAT
  )
  return [{ id: BIZHIMI_PC_CAT, label: '全部', count: pc?.count ?? 0 }, ...rest]
}

// ---------- 对外接口 ----------

function clampPage(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(100_000, Math.max(1, Math.round(value)))
}

export async function wallpaperList(
  source: WallpaperSourceRef,
  category: string,
  page: number,
  keyword: string
): Promise<WallpaperListResponse> {
  const safeCategory = typeof category === 'string' ? category.slice(0, 80) : ''
  const safeKeyword = typeof keyword === 'string' ? keyword.trim().slice(0, 80) : ''
  const safePage = clampPage(page)
  try {
    if (source.template === 'wallspic') {
      const html = await fetchHtml(wallspicUrl(source, safeCategory, safePage, safeKeyword))
      return {
        ok: true,
        page: parseWallspicList(html, source.id, safeCategory, safeKeyword, safePage)
      }
    }
    const html = await fetchHtml(bizhimiUrl(source, safeCategory, safePage, safeKeyword))
    return {
      ok: true,
      page: parseBizhimiList(html, source.id, safeCategory, safeKeyword, safePage)
    }
  } catch (err) {
    const message = (err as Error).message || '网络请求失败'
    return { ok: false, error: `加载失败：${message}` }
  }
}

export async function wallpaperCategories(
  source: WallpaperSourceRef,
  device: WallpaperDevice
): Promise<WallpaperCategoriesResponse> {
  const safeDevice: WallpaperDevice = device === 'mobile' ? 'mobile' : 'pc'
  try {
    if (source.template === 'wallspic') {
      return { ok: true, categories: await wallspicCategories(source, safeDevice) }
    }
    return { ok: true, categories: await bizhimiCategories(source, safeDevice) }
  } catch (err) {
    const message = (err as Error).message || '网络请求失败'
    return { ok: false, error: `加载分类失败：${message}` }
  }
}

function hostAllowed(source: WallpaperSourceRef, rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '')
    return host === siteHost(source)
  } catch {
    return false
  }
}

export async function wallpaperResolve(
  source: WallpaperSourceRef,
  pageUrl: string,
  width: number,
  height: number
): Promise<WallpaperResolveResponse> {
  if (typeof pageUrl !== 'string' || pageUrl.length > 600 || !hostAllowed(source, pageUrl)) {
    return { ok: false, error: '壁纸地址无效' }
  }
  try {
    if (source.template === 'wallspic') {
      return await resolveWallspic(pageUrl, positiveInt(width), positiveInt(height))
    }
    // 壁纸迷列表里已经带原图地址，正常不会走到这里
    return { ok: false, error: '壁纸迷无需解析原图' }
  } catch (err) {
    const message = (err as Error).message || '网络请求失败'
    return { ok: false, error: `获取原图失败：${message}` }
  }
}
