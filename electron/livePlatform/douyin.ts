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
    x: -10_000,
    y: -10_000,
    skipTaskbar: true,
    width: 1280,
    height: 800,
    webPreferences: {
      partition: LIVE_PARTITION,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      // 部分直播间只有视频真正开始播放时才会发出 m3u8 / flv 请求
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // 隐藏窗口里的 video 有时不会自动开始；窗口放到屏幕外但仍算“可见”
  win.showInactive()
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
    const pageUrl = `https://live.douyin.com/${webRid}`
    const result = await Promise.race([
      exclusive(() =>
        withHiddenPage(pageUrl, async (win, collector) => {
          await waitForStream(collector, 12_000)
          // 有些直播间首屏不会自动起播：重新加载一次再等
          if (!collector.hls.size && !collector.flv.size) {
            try {
              await win.loadURL(pageUrl, { userAgent: DOUYIN_UA })
            } catch {
              // 重载失败就按页面现状继续
            }
            await waitForStream(collector, 10_000)
          }
          const meta = await readPageMeta(win)
          return { conn: { hls: [...collector.hls], flv: [...collector.flv] }, meta }
        })
      ),
      sleep(60_000).then(() => null)
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
  watching?: string
}

interface ScrapeGather {
  cards: ScrapedCard[]
  loginRequired: boolean
  atBottom: boolean
}

/**
 * 抖音直播卡片有两种封面：多数是 DIV 的 CSS background-image；
 * 少数是「视频预览」卡片（卡片里直接是 <video>，没有静态封面），在页面里截当前帧当封面。
 * 搜索页是无限滚动 + 懒加载：卡片要逐屏滚过才会写入封面，所以抓取时按屏下滚。
 * 搜索页在 www.douyin.com/search/<kw>?type=live，卡片链接可能是 live.douyin.com/<id>
 * 或 www.douyin.com/live/<id>，两种都认。
 */
function buildScrapeScript(): string {
  return `(() => {
  const norm = (value) => {
    let url = (value || '').trim();
    if (!url) return '';
    if (url.startsWith('//')) url = 'https:' + url;
    return /^https?:\\/\\//i.test(url) ? url : '';
  };
  const srcsetUrl = (value) => {
    const parts = (value || '').split(',').map((part) => part.trim().split(/\\s+/)[0]).filter(Boolean);
    return norm(parts[parts.length - 1]);
  };
  const bgUrl = (el) => {
    let bg = '';
    try {
      bg = getComputedStyle(el).backgroundImage || '';
    } catch {}
    const match = bg.match(/url\\((['"]?)(.*?)\\1\\)/);
    return match ? norm(match[2]) : '';
  };
  // 宿主的封面 CDN；命中这些关键字优先当封面，避免误取头像 / 图标
  const COVER_HINT = /webcast-cover|douyinpic|ibytedtos|byteimg|douyincdn/i;
  const roomIdOf = (a) => {
    let roomId = '';
    try {
      const target = new URL(a.getAttribute('href') || '', location.origin);
      if (/(^|\\.)live\\.douyin\\.com$/i.test(target.hostname)) {
        const match = target.pathname.match(/^\\/(\\d{6,})/);
        if (match) roomId = match[1];
      } else if (/(^|\\.)douyin\\.com$/i.test(target.hostname)) {
        const match = target.pathname.match(/^\\/(?:live|follow\\/live)\\/(\\d{6,})/);
        if (match) roomId = match[1];
      }
    } catch {}
    return roomId;
  };
  // 视频预览卡：截当前帧当封面（canvas 被污染时 toDataURL 会抛错，直接跳过）
  let shots = 0;
  const shotOf = (scope) => {
    if (shots >= 12) return '';
    const video = scope.querySelector('video');
    if (!video || !video.videoWidth || !video.videoHeight) return '';
    try {
      const width = 400;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width));
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', 0.62);
      if (url.length < 2000) return '';
      shots += 1;
      return url;
    } catch {
      return '';
    }
  };
  const best = new Map();
  document.querySelectorAll('a[href]').forEach((a) => {
    const roomId = roomIdOf(a);
    if (!roomId) return;
    const titleEl =
      a.querySelector('[data-e2e="livecard-title"]') ||
      a.querySelector('[data-e2e="live-card-title"]') ||
      a.querySelector('h2,h3');
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
      let url = '';
      if (el.tagName === 'IMG') {
        url =
          norm(el.currentSrc) ||
          norm(el.getAttribute('src')) ||
          norm(el.getAttribute('data-src')) ||
          norm(el.getAttribute('data-original')) ||
          srcsetUrl(el.getAttribute('srcset')) ||
          srcsetUrl(el.getAttribute('data-srcset'));
      } else if (el.tagName === 'VIDEO') {
        url = norm(el.getAttribute('poster'));
      }
      if (!url) url = bgUrl(el);
      if (!url) continue;
      if (!cover) cover = url;
      if (COVER_HINT.test(url)) {
        cover = url;
        break;
      }
    }
    if (!cover) cover = shotOf(a);
    // 卡片上的在线人数用来按热度排序（有就排，没有就保持站点顺序）
    const text = a.innerText || '';
    let watching = '';
    let hot = 0;
    const watchMatch = text.match(/([\\d.]+)\\s*(万|亿)?\\s*(?:人)?\\s*(?:在)?观看/);
    if (watchMatch) {
      const num = parseFloat(watchMatch[1]);
      const unit = watchMatch[2] === '万' ? 10000 : watchMatch[2] === '亿' ? 100000000 : 1;
      if (Number.isFinite(num)) {
        hot = num * unit;
        watching = watchMatch[0].replace(/\\s+/g, '');
      }
    }
    const score =
      (cover ? 4 : 0) +
      (title ? 3 : 0) +
      (anchor ? 1 : 0) +
      (watching ? 2 : 0) +
      Math.min(3, text.length / 40);
    const prev = best.get(roomId);
    if (!prev || score > prev.score) {
      best.set(roomId, { roomId, title, anchor, cover, watching, hot, score });
    }
  });
  const loginRequired = /登录后即可搜索|登录后查看更多/.test(
    document.body ? document.body.innerText : ''
  );
  const scroller = document.scrollingElement || document.documentElement;
  const atBottom = scroller
    ? scroller.scrollTop + window.innerHeight >= scroller.scrollHeight - 120
    : false;
  const cards = Array.from(best.values())
    .sort((a, b) => b.hot - a.hot)
    .slice(0, 300)
    .map(({ score, hot, ...card }) => card);
  return { cards, loginRequired, atBottom };
})()`
}

/** 逐屏下滚：卡片懒加载，必须让每张卡进入视口才会写入封面 */
const SCROLL_STEP_SCRIPT = `(() => {
  let moved = false;
  const step = (el) => {
    if (!el) return;
    try {
      const before = el.scrollTop;
      el.scrollTop = before + Math.round((el.clientHeight || window.innerHeight) * 0.75);
      if (el.scrollTop > before) moved = true;
    } catch {}
  };
  step(document.scrollingElement);
  step(document.documentElement);
  step(document.body);
  document.querySelectorAll('div').forEach((el) => {
    if (el.scrollHeight > el.clientHeight + 400 && el.clientHeight > 300) step(el);
  });
  return moved;
})()`

async function gatherCards(win: BrowserWindow): Promise<ScrapeGather> {
  const result = await runScript<ScrapeGather>(win, buildScrapeScript(), 8000)
  return {
    cards: Array.isArray(result?.cards) ? result.cards : [],
    loginRequired: result?.loginRequired === true,
    atBottom: result?.atBottom === true
  }
}

interface CollectOptions {
  /** 目标条数（按有封面的卡片算） */
  target: number
  /** 已经展示过的房间，不再返回，但要照样算「页面有没有新内容」 */
  exclude?: Set<string>
  /** 首屏等待时间：新开页面要等卡片渲染，同一页面续抓可以短一些 */
  settleMs: number
  /** 最多滚多少屏 */
  maxSteps: number
}

/**
 * 逐屏下滚并合并卡片：每滚一屏抓一次，后一次补齐前一次没拿到的封面，
 * 只把真正有封面的卡片返回给界面，避免出现空白封面。
 */
async function collectCards(
  win: BrowserWindow,
  options: CollectOptions
): Promise<{ cards: ScrapedCard[]; loginRequired: boolean; exhausted: boolean }> {
  const collect = new Map<string, ScrapedCard>()
  const pageSeen = new Set<string>()
  const exclude = options.exclude ?? new Set<string>()
  let loginRequired = false
  let idle = 0
  let atBottom = false
  const merge = (card: ScrapedCard): void => {
    const prev = collect.get(card.roomId)
    if (!prev) {
      collect.set(card.roomId, { ...card })
      return
    }
    collect.set(card.roomId, {
      roomId: prev.roomId,
      title: prev.title || card.title,
      anchor: prev.anchor || card.anchor,
      cover: prev.cover || card.cover,
      watching: prev.watching || card.watching
    })
  }
  const readyCount = (): number =>
    Array.from(collect.values()).filter((card) => !!card.cover).length
  await sleep(options.settleMs)
  for (let step = 0; step < options.maxSteps; step += 1) {
    const gather = await gatherCards(win)
    loginRequired = gather.loginRequired
    atBottom = atBottom || gather.atBottom
    if (loginRequired) break
    let grew = false
    for (const card of gather.cards) {
      if (!card.roomId) continue
      if (!pageSeen.has(card.roomId)) {
        pageSeen.add(card.roomId)
        grew = true
      }
      if (exclude.has(card.roomId)) continue
      merge(card)
    }
    idle = grew ? 0 : idle + 1
    if (readyCount() >= options.target) break
    // 到底后连续几屏没有新卡片才认为没有更多（结果加载有延迟，不能太早收手）
    if (atBottom && idle >= 3) break
    if (idle >= 5) break
    const moved = await runScript<boolean>(win, SCROLL_STEP_SCRIPT, 4000)
    if (moved === false) atBottom = true
    await sleep(1200)
  }
  // 收尾再抓一次：最后一批卡片的封面 / 视频首帧可能刚写进去
  await sleep(600)
  const last = await gatherCards(win)
  loginRequired = loginRequired || last.loginRequired
  for (const card of last.cards) {
    if (!card.roomId || exclude.has(card.roomId)) continue
    merge(card)
  }
  return {
    cards: Array.from(collect.values()),
    loginRequired,
    // 登录态拿不到结果时不算「到底」，登录后还能继续
    exhausted: !loginRequired && ((atBottom && idle >= 3) || idle >= 5)
  }
}

function toLiveRooms(cards: ScrapedCard[]): LiveRoom[] {
  return cards
    .map((raw): LiveRoom | null => {
      const card = asRecord(raw)
      const roomId = asString(card.roomId)
      // 没有封面的卡片不展示，避免列表里出现空白封面
      const cover = asString(card.cover)
      if (!roomId || !cover) return null
      return {
        platform: 'douyin',
        roomId,
        title: decodeHtml(card.title),
        anchor: decodeHtml(card.anchor),
        cover: absoluteUrl(cover, 'https://live.douyin.com/'),
        area: '',
        watching: asString(card.watching),
        status: 'living',
        link: `https://live.douyin.com/${roomId}`
      }
    })
    .filter((room): room is LiveRoom => !!room)
}

async function scrapeCards(url: string): Promise<LiveListResult> {
  return exclusive(() =>
    withHiddenPage(url, async (win) => {
      const result = await collectCards(win, { target: 40, settleMs: 3000, maxSteps: 8 })
      const items = toLiveRooms(result.cards)
      return {
        items,
        hasMore: false,
        error: items.length
          ? undefined
          : result.loginRequired
            ? '抖音搜索需要先登录：点右上角「扫码登录」完成抖音登录后再搜'
            : '抖音页面没有解析到直播间，可能需要登录或平台风控'
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

interface SearchSession {
  key: string
  win: BrowserWindow
  idle: NodeJS.Timeout | null
  exhausted: boolean
}

/** 抖音搜索窗口常驻：点「展示更多」时在同一页面继续下滚，不用重新加载整页 */
let searchSession: SearchSession | null = null

function closeSearchSession(): void {
  const session = searchSession
  searchSession = null
  if (!session) return
  if (session.idle) clearTimeout(session.idle)
  if (!session.win.isDestroyed()) session.win.destroy()
}

function touchSearchSession(session: SearchSession): void {
  if (session.idle) clearTimeout(session.idle)
  session.idle = setTimeout(() => {
    if (searchSession === session) closeSearchSession()
  }, 120_000)
}

async function openSearchWindow(url: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    show: false,
    x: -10_000,
    y: -10_000,
    skipTaskbar: true,
    width: 1280,
    height: 800,
    webPreferences: {
      partition: LIVE_PARTITION,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.showInactive()
  await Promise.race([
    win.loadURL(url, { userAgent: DOUYIN_UA }).catch(() => undefined),
    sleep(15_000)
  ])
  return win
}

export async function douyinSearch(
  keyword: string,
  page = 1,
  excludeIds: string[] = []
): Promise<LiveListResult> {
  const text = keyword.trim()
  if (!text) return { items: [], hasMore: false }
  try {
    // live.douyin.com/search/<kw> 是 404；直播搜索在 www.douyin.com/search/<kw>?type=live
    // sort_type=1 = 最多点赞（热度优先）。抖音搜索没有翻页，只有无限滚动：
    // 首次返回一批，界面点「展示更多」时在同一窗口继续下滚，跳过已展示过的房间。
    return await exclusive(async () => {
      const url = `https://www.douyin.com/search/${encodeURIComponent(text)}?type=live&sort_type=1`
      let session = searchSession
      let fresh = false
      if (page <= 1 || !session || session.key !== text || session.win.isDestroyed()) {
        closeSearchSession()
        const win = await openSearchWindow(url)
        session = { key: text, win, idle: null, exhausted: false }
        searchSession = session
        fresh = true
      }
      const active = session
      touchSearchSession(active)
      const result = await collectCards(active.win, {
        target: page <= 1 ? 30 : 20,
        exclude: new Set(excludeIds.filter(Boolean)),
        settleMs: page <= 1 || fresh ? 2600 : 700,
        maxSteps: page <= 1 || fresh ? 10 : 8
      })
      const items = toLiveRooms(result.cards)
      if (result.exhausted) active.exhausted = true
      return {
        items,
        hasMore: !active.exhausted && !result.loginRequired && items.length > 0,
        error: items.length
          ? undefined
          : result.loginRequired
            ? '抖音搜索需要先登录：点右上角「扫码登录」完成抖音登录后再搜'
            : page > 1
              ? undefined
              : '抖音页面没有解析到直播间，可能需要登录或平台风控'
      }
    })
  } catch (err) {
    closeSearchSession()
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
