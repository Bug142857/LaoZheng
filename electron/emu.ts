import { BrowserWindow, session } from 'electron'
import { parse } from 'node-html-parser'
import {
  EMU_DEFAULT_COVER,
  EMU_PLATFORMS,
  type EmuGameItem,
  type EmuListResponse,
  type EmuOpenResponse,
  type EmuPlatformId,
  type EmuSearchResponse,
  type EmuTag
} from '../src/shared/emu'

/**
 * 模拟模块：解析 yikm.net（易快玩）的小霸王 / GBA / 街机 / SFC / MD 游戏目录，
 * 点击后在新窗口打开站点自带的播放器（暂停 / 存档 / 金手指 / 滤镜 / 按键 / 快进 / 全屏都由站点提供）。
 *
 * 站点没有 API：列表与搜索都是服务端渲染的 HTML；搜索走 `/search?name=` 且 page 参数无效，
 * 结果一次性返回；目录翻页只能靠 page 参数，且不公开真实末页，所以用「下一页」是否可点判断 hasMore。
 */

const BASE = 'https://www.yikm.net'
const PARTITION = 'persist:yikm'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** 播放页里可能出现的广告位（站点目前只挂了 AdSense 脚本，仍兜底隐藏） */
const AD_CSS = `
  ins.adsbygoogle,
  iframe[src*="googlesyndication"],
  iframe[src*="doubleclick"] { display: none !important; }
`

/** 平台卡片上的平台标签，解析分类时剔除 */
const PLATFORM_LABELS = new Set([
  'Java',
  'FC',
  'SFC',
  '街机',
  'GBA',
  'NDS',
  'MD',
  'DOS',
  'dos',
  'Flash',
  '小霸王'
])

/** 搜索结果里标签不一定可靠（MD 结果没有标签），再按封面路径兜底 */
const PLATFORM_BY_LABEL = new Map<string, EmuPlatformId>([
  ['Java', 'java'],
  ['FC', 'fc'],
  ['小霸王', 'fc'],
  ['SFC', 'sfc'],
  ['街机', 'arcade'],
  ['GBA', 'gba'],
  ['NDS', 'nds'],
  ['MD', 'md'],
  ['DOS', 'dos'],
  ['dos', 'dos'],
  ['Flash', 'flash']
])

let emuWindow: BrowserWindow | null = null
let sessionReady = false

function emuSession() {
  return session.fromPartition(PARTITION)
}

function platformOf(id: EmuPlatformId) {
  return EMU_PLATFORMS.find((item) => item.id === id) ?? EMU_PLATFORMS[0]
}

function platformFromLabel(labels: string[]): EmuPlatformId | null {
  for (const label of labels) {
    const platform = PLATFORM_BY_LABEL.get(label)
    if (platform) return platform
  }
  return null
}

function platformFromCover(url: string): EmuPlatformId | null {
  if (/\/jarimgs\//i.test(url)) return 'java'
  if (/\/gbapic\//i.test(url)) return 'gba'
  if (/\/ndspic\//i.test(url)) return 'nds'
  if (/\/dospic\//i.test(url)) return 'dos'
  if (/\/mdpic\//i.test(url)) return 'md'
  if (/\/sfcpic\//i.test(url)) return 'sfc'
  if (/\/arcadepic\//i.test(url)) return 'arcade'
  if (/\/flashpic\//i.test(url)) return 'flash'
  if (/\/fcpic\//i.test(url)) return 'fc'
  return null
}

function absUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  try {
    return new URL(value, `${BASE}/`).toString()
  } catch {
    return null
  }
}

/**
 * 解析卡片列表。
 * platform 传具体值时用于目录页；传 'auto' 时用于搜索结果（按标签 / 封面路径推断平台）。
 */
function collectCards(doc: ReturnType<typeof parse>, platform: EmuPlatformId | 'auto'): EmuGameItem[] {
  const items: EmuGameItem[] = []
  const seen = new Set<string>()

  for (const card of doc.querySelectorAll('.card.card-blog')) {
    const link = card.querySelector('a[href*="/play?id="]')
    const href = link?.getAttribute('href') ?? ''
    const matched = href.match(/\/play\?id=(\d+)/)
    if (!matched) continue
    const id = matched[1]
    if (seen.has(id)) continue

    const title =
      (card.querySelector('.card-caption a')?.text ?? '').trim() ||
      (card.querySelector('.card-image img')?.getAttribute('alt') ?? '').trim()
    if (!title) continue

    const rawCover = card.querySelector('.card-image img')?.getAttribute('src') ?? ''
    const cover =
      !rawCover || /nopic\.png/i.test(rawCover) ? EMU_DEFAULT_COVER : absUrl(rawCover) ?? EMU_DEFAULT_COVER
    const labels = card
      .querySelectorAll('.label.label-success')
      .map((el) => el.text.trim())
      .filter(Boolean)
    const resolved =
      platform === 'auto'
        ? platformFromLabel(labels) ?? platformFromCover(rawCover) ?? 'fc'
        : platform

    seen.add(id)
    items.push({
      id,
      title,
      cover,
      category: labels.filter((label) => !PLATFORM_LABELS.has(label)).join(' · '),
      platform: resolved
    })
  }

  return items
}

function buildListUrl(platform: EmuPlatformId, tag: string, page: number): string {
  const def = platformOf(platform)
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('tag', tag || def.tag)
  if (def.e) params.set('e', def.e)
  return `${BASE}/nes?${params.toString()}`
}

async function fetchHtml(url: string): Promise<string> {
  const res = await emuSession().fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    },
    signal: AbortSignal.timeout(25_000)
  })
  if (!res.ok) throw new Error(`站点返回 HTTP ${res.status}`)
  const html = await res.text()
  if (!html.trim()) throw new Error('站点返回空内容')
  return html
}

/** 解析目录页：卡片、分类标签、是否还有下一页 */
function parseList(
  html: string,
  platform: EmuPlatformId
): { items: EmuGameItem[]; hasMore: boolean; tags: EmuTag[] } {
  const doc = parse(html)
  const items = collectCards(doc, platform)

  let hasMore = false
  for (const li of doc.querySelectorAll('nav ul.pager li')) {
    if (!li.text.includes('下一页')) continue
    hasMore = !(li.getAttribute('class') ?? '').includes('disabled')
    break
  }

  const tags: EmuTag[] = []
  const def = platformOf(platform)
  // 街机页顶部残留的是 FC 分类标签，不是街机分类；直接不展示
  if (def.e) {
    for (const a of doc.querySelectorAll('a.fa.fa-tag.tag-type')) {
      const href = a.getAttribute('href') ?? ''
      try {
        const url = new URL(href, `${BASE}/`)
        const value = url.searchParams.get('tag') ?? ''
        const e = url.searchParams.get('e') ?? ''
        if (!value || e !== def.e) continue
        const name = a.text.trim()
        if (!name || tags.some((tag) => tag.value === value)) continue
        tags.push({ name, value })
      } catch {
        // 忽略坏链接
      }
    }
  }

  return { items, hasMore, tags }
}

export async function emuList(
  platform: EmuPlatformId,
  tag: string,
  page: number
): Promise<EmuListResponse> {
  try {
    const html = await fetchHtml(buildListUrl(platform, tag, page))
    const parsed = parseList(html, platform)
    return {
      ok: true,
      items: parsed.items,
      page,
      lastPage: 0,
      hasMore: parsed.hasMore,
      tags: parsed.tags
    }
  } catch (err) {
    return {
      ok: false,
      items: [],
      page,
      lastPage: 0,
      hasMore: false,
      error: (err as Error).message
    }
  }
}

/** 站点搜索：`/search?name=关键词`，全部结果一页返回 */
export async function emuSearch(keyword: string): Promise<EmuSearchResponse> {
  try {
    const html = await fetchHtml(`${BASE}/search?name=${encodeURIComponent(keyword)}`)
    return { ok: true, items: collectCards(parse(html), 'auto') }
  } catch (err) {
    return { ok: false, items: [], error: (err as Error).message }
  }
}

/** 首次打开游戏窗口前准备独立会话：屏蔽广告域名、拒绝权限申请、统一 UA */
function prepareSession(): void {
  if (sessionReady) return
  sessionReady = true
  const ses = emuSession()
  ses.setUserAgent(UA)
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'fullscreen')
  })
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen')
  ses.webRequest.onBeforeRequest(
    {
      urls: [
        '*://*.googlesyndication.com/*',
        '*://*.doubleclick.net/*',
        '*://*.google-analytics.com/*',
        '*://*.googletagmanager.com/*'
      ]
    },
    (_details, callback) => callback({ cancel: true })
  )
}

function isYikmUrl(target: string): boolean {
  return /^https:\/\/(www\.)?yikm\.net(\/|$)/i.test(target)
}

/** 打开 / 切换模拟游戏窗口（单窗口复用，同一游戏只聚焦不重载，避免丢进度） */
export async function openEmuGame(id: string): Promise<EmuOpenResponse> {
  try {
    prepareSession()
    const url = `${BASE}/play?id=${id}`

    if (emuWindow && !emuWindow.isDestroyed()) {
      if (emuWindow.webContents.getURL() !== url) {
        await emuWindow.loadURL(url)
      }
      if (emuWindow.isMinimized()) emuWindow.restore()
      emuWindow.show()
      emuWindow.focus()
      return { ok: true }
    }

    const win = new BrowserWindow({
      width: 1120,
      height: 880,
      minWidth: 760,
      minHeight: 560,
      show: false,
      title: '模拟 · 老郑分享',
      backgroundColor: '#101014',
      autoHideMenuBar: true,
      fullscreenable: true,
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        spellcheck: false,
        // 切到后台时游戏继续跑，避免定时器被 Chromium 节流
        backgroundThrottling: false
      }
    })
    emuWindow = win
    win.setMenu(null)

    win.on('closed', () => {
      if (emuWindow === win) emuWindow = null
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const blockNavigation = (event: Electron.Event, target: string): void => {
      if (!isYikmUrl(target)) event.preventDefault()
    }
    win.webContents.on('will-navigate', blockNavigation)
    win.webContents.on('will-redirect', blockNavigation)
    win.webContents.on('did-finish-load', () => {
      void win.webContents.insertCSS(AD_CSS).catch(() => {})
    })
    win.once('ready-to-show', () => win.show())

    await win.loadURL(url)
    win.show()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
