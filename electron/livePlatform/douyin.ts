import { BrowserWindow } from 'electron'
import {
  DOUYIN_UA,
  absoluteUrl,
  asArray,
  asRecord,
  asString,
  cached,
  decodeHtml
} from './common'
import { LIVE_PARTITION, liveSession } from './session'
import type {
  LiveCategoriesResult,
  LiveCategoryArea,
  LiveListResult,
  LivePlayLine,
  LiveRoom,
  LiveRoomDetail,
  LiveRoomPlayback
} from '../../src/shared/livePlatform'

/**
 * 抖音没有稳定的公开取流接口（a_bogus 签名更新频繁），
 * 这里用隐藏浏览器打开直播间，直接抓页面自己发出的 m3u8 / flv 请求。
 * 登录、抓流、播放共用 persist:laozheng-live 分区。
 */

interface Collector {
  hls: Set<string>
  flv: Set<string>
}

let activeCollector: Collector | null = null
let listenerInstalled = false

function installMediaListener(): void {
  if (listenerInstalled) return
  listenerInstalled = true
  liveSession().webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const url = details.url
    if (activeCollector) {
      if (/\.m3u8(\?|$)/i.test(url)) activeCollector.hls.add(url)
      else if (/\.flv(\?|$)/i.test(url)) activeCollector.flv.add(url)
    }
    callback({})
  })
}

let queue: Promise<unknown> = Promise.resolve()

function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.catch(() => undefined).then(task)
  queue = run.catch(() => undefined)
  return run
}

async function withHiddenPage<T>(
  url: string,
  task: (win: BrowserWindow, collector: Collector) => Promise<T>
): Promise<T> {
  installMediaListener()
  const collector: Collector = { hls: new Set(), flv: new Set() }
  activeCollector = collector
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      partition: LIVE_PARTITION,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await Promise.race([
      win.loadURL(url, { userAgent: DOUYIN_UA }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 15_000))
    ])
    return await task(win, collector)
  } finally {
    activeCollector = null
    if (!win.isDestroyed()) win.destroy()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 抖音页面偶尔会卡住（登录弹层 / 风控脚本不返回），
 * executeJavaScript 必须带硬超时，否则会把后面的抖音请求一起堵死。
 */
async function runScript<T>(
  win: BrowserWindow,
  script: string,
  timeoutMs = 6000
): Promise<T | null> {
  try {
    const running = win.webContents.executeJavaScript(script) as Promise<T>
    return await Promise.race([
      running.catch(() => null),
      sleep(timeoutMs).then(() => null)
    ])
  } catch {
    return null
  }
}

async function waitForStream(collector: Collector, timeoutMs: number): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (collector.hls.size || collector.flv.size) return
    await sleep(300)
  }
}

interface PageMeta {
  title: string
  anchor: string
  cover: string
  avatar: string
  offline: boolean
}

async function readPageMeta(win: BrowserWindow): Promise<PageMeta> {
  const script = `(() => {
    const meta = (name) => {
      const el = document.querySelector('meta[property="' + name + '"]') || document.querySelector('meta[name="' + name + '"]');
      return el ? (el.getAttribute('content') || '') : '';
    };
    const text = (selectors) => {
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        const value = el && el.textContent ? el.textContent.trim() : '';
        if (value) return value;
      }
      return '';
    };
    const body = document.body ? document.body.innerText.slice(0, 4000) : '';
    const title = (meta('og:title') || document.title || '').replace(/\\s*-\\s*抖音直播.*$/, '').trim();
    let anchor = text(['[data-e2e="live-room-anchor-name"]', '[class*="anchorName"]', '[class*="anchor-name"]']);
    if (!anchor) {
      anchor = title.replace(/的抖音直播间$/, '').replace(/正在直播.*$/, '').trim();
    }
    const cover = meta('og:image') || '';
    const avatarEl = document.querySelector('[class*="avatar"] img') || document.querySelector('img');
    const avatar = avatarEl ? (avatarEl.getAttribute('src') || '') : '';
    const offline = /直播已结束|未开播|暂未开播/.test(body);
    return { title, anchor, cover, avatar, offline };
  })()`
  try {
    const result = await runScript<PageMeta>(win, script, 6000)
    return result ?? { title: '', anchor: '', cover: '', avatar: '', offline: false }
  } catch {
    return { title: '', anchor: '', cover: '', avatar: '', offline: false }
  }
}

function qualityLabel(url: string): string {
  const value = url.toLowerCase()
  if (/uhd|origin|bd/.test(value)) return '超清'
  if (/hd|high/.test(value)) return '高清'
  if (/sd|low/.test(value)) return '标清'
  return '默认'
}

function linesOf(collector: Collector): LivePlayLine[] {
  const lines: LivePlayLine[] = []
  const seen = new Set<string>()
  const add = (url: string, format: 'hls' | 'flv'): void => {
    if (seen.has(url)) return
    seen.add(url)
    lines.push({
      id: `${format}|${new URL(url).host}|${lines.length}`,
      qualityId: `${format}-${lines.length}`,
      qualityLabel: qualityLabel(url),
      format,
      url
    })
  }
  for (const url of collector.hls) {
    if (lines.length >= 6) break
    add(url, 'hls')
  }
  if (lines.length < 6) {
    for (const url of collector.flv) {
      if (lines.length >= 6) break
      add(url, 'flv')
    }
  }
  return lines
}

export async function douyinRoom(roomId: string): Promise<LiveRoomPlayback> {
  const webRid = roomId.trim()
  if (!/^\d{3,20}$/.test(webRid)) {
    return emptyPlayback('请输入抖音直播间号或 live.douyin.com 链接')
  }
  try {
    const result = await Promise.race([
      exclusive(() =>
        withHiddenPage(`https://live.douyin.com/${webRid}`, async (win, collector) => {
          await waitForStream(collector, 12_000)
          const meta = await readPageMeta(win)
          return { conn: { hls: [...collector.hls], flv: [...collector.flv] }, meta }
        })
      ),
      sleep(40_000).then(() => null)
    ])
    if (!result) {
      return emptyPlayback('获取直播间超时：可能未开播、页面被风控，或平台限制了网页播放')
    }
    const collector: Collector = {
      hls: new Set(result.conn.hls),
      flv: new Set(result.conn.flv)
    }
    const lines = linesOf(collector)
    const detail: LiveRoomDetail = {
      platform: 'douyin',
      roomId: webRid,
      title: decodeHtml(result.meta.title) || `抖音直播间 ${webRid}`,
      anchor: decodeHtml(result.meta.anchor),
      cover: absoluteUrl(result.meta.cover, 'https://live.douyin.com/'),
      area: '',
      watching: '',
      status: lines.length ? 'living' : result.meta.offline ? 'offline' : 'unknown',
      statusText: lines.length ? undefined : result.meta.offline ? '未开播' : '未获取到直播流',
      avatar: absoluteUrl(result.meta.avatar, 'https://live.douyin.com/'),
      link: `https://live.douyin.com/${webRid}`
    }
    return {
      detail,
      qualities: [],
      lines,
      error: lines.length
        ? undefined
        : '没有抓到直播流：可能未开播、需要登录，或平台限制了网页播放'
    }
  } catch (err) {
    return emptyPlayback(errorText(err))
  }
}

interface ScrapedCard {
  roomId: string
  title: string
  anchor: string
  cover: string
}

/**
 * 抖音直播卡片没有 <img> 封面，封面是 DIV 的 CSS background-image；
 * 同一个房间还可能同时有「点击进入直播间」遮罩链接，所以按房间聚合后取信息最全的一条。
 */
const SCRAPE_SCRIPT = `(() => {
  const best = new Map();
  document.querySelectorAll('a[href]').forEach((a) => {
    let roomId = '';
    try {
      const target = new URL(a.getAttribute('href') || '', location.origin);
      if (target.hostname === 'live.douyin.com') {
        const match = target.pathname.match(/^\\/(\\d{6,})/);
        if (match) roomId = match[1];
      }
    } catch {}
    if (!roomId) return;
    const titleEl = a.querySelector('[data-e2e="livecard-title"]');
    const metaEl = a.querySelector('[data-e2e="livecard-metatext"]');
    const lines = (a.innerText || '').split('\\n').map((line) => line.trim()).filter(Boolean);
    let title = titleEl ? (titleEl.textContent || '').trim() : (lines[0] || '');
    if (title === '点击进入直播间') title = '';
    let anchor = metaEl
      ? (metaEl.textContent || '').trim()
      : (lines.find((line) => line.startsWith('@')) || '');
    anchor = anchor.replace(/^@/, '').trim();
    let cover = '';
    const nodes = [a].concat(Array.from(a.querySelectorAll('*')));
    for (const el of nodes) {
      let bg = '';
      try {
        bg = getComputedStyle(el).backgroundImage || '';
      } catch {}
      const match = bg.match(/url\\((['"]?)(.*?)\\1\\)/);
      if (match && match[2] && /^https?:/i.test(match[2])) {
        cover = match[2];
        if (/webcast-cover|douyinpic/i.test(match[2])) break;
      }
    }
    if (!cover) {
      const img = a.querySelector('img');
      if (img) {
        const raw = img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (/^https?:/i.test(raw)) cover = raw;
      }
    }
    if (!cover) {
      const video = a.querySelector('video[poster]');
      if (video) cover = video.getAttribute('poster') || '';
    }
    const score =
      (cover ? 4 : 0) +
      (title ? 3 : 0) +
      (anchor ? 1 : 0) +
      Math.min(3, (a.innerText || '').length / 40);
    const prev = best.get(roomId);
    if (!prev || score > prev.score) best.set(roomId, { roomId, title, anchor, cover, score });
  });
  return Array.from(best.values()).slice(0, 40).map(({ score, ...card }) => card);
})()`

async function scrapeCards(url: string): Promise<LiveListResult> {
  return exclusive(() =>
    withHiddenPage(url, async (win) => {
      let cards: ScrapedCard[] = []
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await sleep(attempt === 0 ? 3000 : 700)
        const result = await runScript<ScrapedCard[]>(win, SCRAPE_SCRIPT, 6000)
        cards = Array.isArray(result) ? result : []
        if (cards.some((card) => card.cover)) break
      }
      try {
        const items: LiveRoom[] = asArray(cards)
          .map((raw): LiveRoom | null => {
            const card = asRecord(raw)
            const roomId = asString(card.roomId)
            if (!roomId) return null
            return {
              platform: 'douyin',
              roomId,
              title: decodeHtml(card.title),
              anchor: decodeHtml(card.anchor),
              cover: absoluteUrl(card.cover, 'https://live.douyin.com/'),
              area: '',
              watching: '',
              status: 'living',
              link: `https://live.douyin.com/${roomId}`
            }
          })
          .filter((room): room is LiveRoom => !!room && !!(room.title || room.cover))
        return {
          items,
          hasMore: false,
          error: items.length ? undefined : '抖音页面没有解析到直播间，可能需要登录或平台风控'
        }
      } catch {
        return { items: [], hasMore: false, error: '抖音页面解析失败' }
      }
    })
  )
}

interface ScrapedCategory {
  id: string
  name: string
}

/** 抖音首页顶部导航里的直播分区（/categorynew/4_101 这种） */
const CATEGORY_SCRIPT = `(() => {
  const seen = new Set();
  const out = [];
  document.querySelectorAll('a[href*="/categorynew/"]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    const match = href.match(/\\/categorynew\\/([\\w-]+)/);
    if (!match || seen.has(match[1])) return;
    const name = (a.innerText || a.textContent || '').trim();
    if (!name) return;
    seen.add(match[1]);
    out.push({ id: match[1], name });
  });
  return out;
})()`

export async function douyinCategories(): Promise<LiveCategoriesResult> {
  try {
    const rows = await cached('douyin:categories', 30 * 60 * 1000, () =>
      exclusive(() =>
        withHiddenPage('https://live.douyin.com/', async (win) => {
          let categories: ScrapedCategory[] = []
          for (let attempt = 0; attempt < 10; attempt += 1) {
            await sleep(attempt === 0 ? 3000 : 700)
            const result = await runScript<ScrapedCategory[]>(win, CATEGORY_SCRIPT, 6000)
            categories = Array.isArray(result) ? result : []
            if (categories.length) break
          }
          return categories
        })
      )
    )
    const areas: LiveCategoryArea[] = asArray(rows)
      .map((raw): LiveCategoryArea | null => {
        const row = asRecord(raw)
        const id = asString(row.id)
        const name = decodeHtml(row.name)
        if (!id || !name) return null
        return { id, name, parentId: 'douyin' }
      })
      .filter((area): area is LiveCategoryArea => !!area)
    return {
      groups: areas.length ? [{ id: 'douyin', name: '分类', areas }] : [],
      error: areas.length ? undefined : '抖音页面没有解析到直播分类'
    }
  } catch (err) {
    return { groups: [], error: errorText(err) }
  }
}

export async function douyinCategoryRooms(areaId: string, page = 1): Promise<LiveListResult> {
  const id = areaId.trim()
  if (!/^[\w-]+$/.test(id)) {
    return { items: [], hasMore: false, error: '抖音分类参数无效' }
  }
  if (page > 1) return { items: [], hasMore: false }
  try {
    return await scrapeCards(`https://live.douyin.com/categorynew/${id}`)
  } catch (err) {
    return { items: [], hasMore: false, error: errorText(err) }
  }
}

export async function douyinRecommend(): Promise<LiveListResult> {
  try {
    return await scrapeCards('https://live.douyin.com/')
  } catch (err) {
    return { items: [], hasMore: false, error: errorText(err) }
  }
}

export async function douyinSearch(keyword: string, page = 1): Promise<LiveListResult> {
  const text = keyword.trim()
  if (!text) return { items: [], hasMore: false }
  if (page > 1) return { items: [], hasMore: false, error: '抖音搜索暂只支持第一页' }
  try {
    return await scrapeCards(`https://live.douyin.com/search/${encodeURIComponent(text)}`)
  } catch (err) {
    return { items: [], hasMore: false, error: errorText(err) }
  }
}

function emptyPlayback(error: string): LiveRoomPlayback {
  return {
    detail: {
      platform: 'douyin',
      roomId: '',
      title: '',
      anchor: '',
      cover: '',
      area: '',
      watching: '',
      status: 'unknown'
    },
    qualities: [],
    lines: [],
    error
  }
}

export function parseDouyinRoomId(input: string): string {
  const text = input.trim()
  if (!text) return ''
  if (/^\d{3,20}$/.test(text)) return text
  const match = text.match(/live\.douyin\.com\/(\d{3,20})/i)
  if (match?.[1]) return match[1]
  const loose = text.match(/(\d{6,20})/)
  return loose?.[1] ?? ''
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return '请求超时，请重试'
    return err.message
  }
  return '请求失败，请重试'
}

export function douyinPageUrl(roomId: string): string {
  return `https://live.douyin.com/${roomId}`
}

export function douyinRoomIdOfUrl(url: string): string {
  return parseDouyinRoomId(url)
}
