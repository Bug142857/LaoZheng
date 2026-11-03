import { app, BrowserWindow, dialog, session, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  MagnetItem,
  MagnetOptions,
  MagnetSearchResponse,
  MagnetSource,
  MagnetSourcesImportResult,
  MagnetState,
  MagnetTestResult
} from '../src/shared/magnet'
import { DEFAULT_MAGNET_OPTIONS } from '../src/shared/magnet'
import type { SourcesExportResult } from '../src/shared/types'
import { cloneDefaultMagnetSources } from '../src/shared/magnetDefaults'
import { lastDialogDir, rememberDialogDir } from './settings'
import type { ParsedMagnetItem } from './magnetParse'
import {
  buildSearchUrl,
  cleanupTitle,
  extractMagnetFromHtml,
  formatSize,
  hasAnyWord,
  magnetHash,
  parseApiPage,
  parseDateToMs,
  parseDetailMeta,
  parseHtmlPage,
  parseSizeToBytes,
  stripTags
} from './magnetParse'

/**
 * 磁力搜索（一期）：只搜索第三方资源库并返回磁链，
 * 不内置 BT 引擎、不内置代理；打开磁链交给系统关联的下载器。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const LIST_TIMEOUT = 20_000
const DETAIL_TIMEOUT = 10_000
const WEBVIEW_TIMEOUT = 22_000
const MAX_DETAIL_FETCH = 24
const SOURCE_SEARCH_BUDGET = 45_000
const ALL_SEARCH_BUDGET = 30_000
const TEST_BUDGET = 45_000
const STATE_VERSION = 4

const FALLBACK_AD_WORDS = [
  '最新地址',
  '永久地址',
  '发布页',
  '备用网址',
  '收藏本站',
  '请牢记',
  '本站网址',
  '点击进入',
  '广告'
]

let stateCache: MagnetState | null = null
let filterCache: { ad: string[]; smart: string[] } | null = null

function statePath(): string {
  return join(app.getPath('userData'), 'magnet-sources.json')
}

function logPath(): string {
  return join(app.getPath('userData'), 'magnet-test.log')
}

function logTime(): string {
  const date = new Date()
  const p = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(
    date.getHours()
  )}:${p(date.getMinutes())}:${p(date.getSeconds())}`
}

/** 测试 / 搜索失败日志：只记资源库、地址和错误，不记任何账号信息 */
function appendMagnetLog(tag: string, message: string): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    appendFileSync(logPath(), `[${logTime()}] ${tag} ${message.replace(/\s+/g, ' ')}\n`, 'utf8')
  } catch {
    // 日志失败不影响搜索
  }
}

function stamp(): string {
  const date = new Date()
  const p = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(
    date.getMinutes()
  )}${p(date.getSeconds())}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return '请求超时'
    return err.message
  }
  return String(err)
}

function normalizeOptions(raw: unknown): MagnetOptions {
  const value = raw && typeof raw === 'object' ? (raw as Partial<MagnetOptions>) : {}
  return {
    blockAds:
      typeof value.blockAds === 'boolean' ? value.blockAds : DEFAULT_MAGNET_OPTIONS.blockAds,
    smartSearch:
      typeof value.smartSearch === 'boolean'
        ? value.smartSearch
        : DEFAULT_MAGNET_OPTIONS.smartSearch,
    dedupe: typeof value.dedupe === 'boolean' ? value.dedupe : DEFAULT_MAGNET_OPTIONS.dedupe
  }
}

function normalizeSource(raw: unknown): MagnetSource | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<MagnetSource>
  if (typeof value.id !== 'string' || !value.id.trim()) return null
  if (typeof value.name !== 'string' || !value.name.trim()) return null
  if (typeof value.searchUrl !== 'string' || !/^https?:\/\//i.test(value.searchUrl)) return null
  if (!value.searchUrl.includes('{keyword}')) return null
  return {
    id: value.id.trim(),
    name: value.name.trim(),
    enabled: value.enabled !== false,
    needProxy: value.needProxy === true,
    searchUrl: value.searchUrl.trim(),
    separator: typeof value.separator === 'string' ? value.separator : '',
    nextPageIndicator:
      typeof value.nextPageIndicator === 'string' ? value.nextPageIndicator : '',
    useWebView2: value.useWebView2 === true,
    directNavigate: value.directNavigate === true,
    encodeType:
      value.encodeType === 'Base64UrlSafe' || value.encodeType === 'Hex' || value.encodeType === 'Raw'
        ? value.encodeType
        : 'UrlEncode',
    isApi: value.isApi === true,
    navigationPage: typeof value.navigationPage === 'string' ? value.navigationPage : '',
    fixedRules: value.fixedRules === true,
    api:
      value.api && typeof value.api === 'object'
        ? {
            listPath: String(value.api.listPath ?? ''),
            titleField: String(value.api.titleField ?? ''),
            sizeField: String(value.api.sizeField ?? ''),
            hashField: String(value.api.hashField ?? ''),
            dateField: String(value.api.dateField ?? ''),
            totalField: String(value.api.totalField ?? ''),
            codeField: String(value.api.codeField ?? ''),
            successValue: String(value.api.successValue ?? ''),
            pageSize: Number(value.api.pageSize) || 20,
            idField: String(value.api.idField ?? ''),
            detailUrlTemplate: String(value.api.detailUrlTemplate ?? '')
          }
        : null,
    testStatus: value.testStatus === 'ok' || value.testStatus === 'failed' ? value.testStatus : null,
    testMsg: typeof value.testMsg === 'string' ? value.testMsg : null,
    testAt: typeof value.testAt === 'number' ? value.testAt : 0
  }
}

function normalizeSources(raw: unknown): MagnetSource[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw
    .map((entry) => normalizeSource(entry))
    .filter((source): source is MagnetSource => {
      if (!source) return false
      if (seen.has(source.id)) return false
      seen.add(source.id)
      return true
    })
}

async function persist(state: MagnetState): Promise<void> {
  const target = statePath()
  const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
  await rename(tmp, target)
  stateCache = state
}

export async function loadMagnetState(): Promise<MagnetState> {
  if (stateCache) return stateCache
  let saved: Partial<MagnetState> = {}
  let loaded = false
  try {
    saved = JSON.parse(await readFile(statePath(), 'utf8')) as Partial<MagnetState>
    loaded = true
  } catch {
    // 首次启动或文件损坏时使用内置配置
  }
  const loadedVersion =
    typeof saved.configVersion === 'number' ? saved.configVersion : 1
  let sources = loaded ? normalizeSources(saved.sources) : cloneDefaultMagnetSources()
  if (loaded && loadedVersion < STATE_VERSION) {
    // v0.56：默认资源库改为用户 2026-11-02 重新导出的 18 个可用源，旧配置一次性对齐
    sources = cloneDefaultMagnetSources()
  }
  stateCache = {
    // 用户保存过资源库后，以文件为准：支持新增 / 修改 / 删除，不会在重启时被默认列表覆盖
    sources,
    options: normalizeOptions(saved.options),
    configVersion: STATE_VERSION
  }
  if (loaded && loadedVersion < STATE_VERSION) await persist(stateCache)
  return stateCache
}

export async function saveMagnetSources(raw: MagnetSource[]): Promise<MagnetState> {
  const state = await loadMagnetState()
  const next: MagnetState = {
    ...state,
    sources: normalizeSources(raw),
    configVersion: STATE_VERSION
  }
  await persist(next)
  return next
}

export async function resetMagnetSources(): Promise<MagnetState> {
  const state = await loadMagnetState()
  const next: MagnetState = {
    ...state,
    sources: cloneDefaultMagnetSources(),
    configVersion: STATE_VERSION
  }
  await persist(next)
  return next
}

export async function exportMagnetSources(raw: MagnetSource[]): Promise<SourcesExportResult> {
  const sources = normalizeSources(raw).map((source) => ({
    ...source,
    testStatus: null,
    testMsg: null,
    testAt: 0
  }))
  if (!sources.length) return { canceled: false, error: '没有可导出的资源库' }
  const result = await dialog.showSaveDialog({
    title: '导出磁力资源库',
    defaultPath: join(
      lastDialogDir('magnet', app.getPath('documents')),
      `老郑分享-磁力源-${stamp()}.json`
    ),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await rememberDialogDir('magnet', result.filePath)
  try {
    await writeFile(
      result.filePath,
      JSON.stringify({ version: 1, sources }, null, 2),
      'utf8'
    )
    return { canceled: false, path: result.filePath, count: sources.length }
  } catch (err) {
    return { canceled: false, error: errorText(err) }
  }
}

export async function importMagnetSources(): Promise<MagnetSourcesImportResult> {
  const result = await dialog.showOpenDialog({
    title: '导入磁力资源库',
    defaultPath: lastDialogDir('magnet', app.getPath('documents')),
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true }
  await rememberDialogDir('magnet', result.filePaths[0])
  try {
    const raw = JSON.parse(await readFile(result.filePaths[0], 'utf8')) as unknown
    const list =
      Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object'
          ? (raw as { sources?: unknown }).sources
          : null
    const sources = normalizeSources(list).map((source) => ({
      ...source,
      testStatus: null,
      testMsg: null,
      testAt: 0
    }))
    if (!sources.length) return { canceled: false, error: '文件里没有有效的磁力资源库' }
    return { canceled: false, sources }
  } catch (err) {
    return { canceled: false, error: `读取失败：${errorText(err)}` }
  }
}

export async function openMagnetLog(): Promise<void> {
  const file = logPath()
  if (!existsSync(file)) {
    await writeFile(file, '# 老郑分享磁力测试日志\n', 'utf8')
  }
  shell.showItemInFolder(file)
}

function filterWordFiles(): string[] {
  return [
    join(process.resourcesPath, 'magnet-filter-words.txt'),
    join(app.getAppPath(), 'resources', 'magnet-filter-words.txt'),
    join(__dirname, '../../resources/magnet-filter-words.txt')
  ]
}

function splitWords(line: string): string[] {
  const index = line.indexOf('=')
  if (index < 0) return []
  return line
    .slice(index + 1)
    .split(',')
    .map((word) => word.trim())
    .filter(Boolean)
}

async function loadFilterWords(): Promise<{ ad: string[]; smart: string[] }> {
  if (filterCache) return filterCache
  let text = ''
  for (const file of filterWordFiles()) {
    try {
      text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '')
      if (text) break
    } catch {
      // 继续尝试下一个位置
    }
  }
  const ad: string[] = []
  const smart: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('广告词=')) ad.push(...splitWords(line))
    else if (line.startsWith('智能滤=') || line.startsWith('女优=')) smart.push(...splitWords(line))
  }
  filterCache = {
    ad: ad.length ? ad : FALLBACK_AD_WORDS,
    smart
  }
  return filterCache
}

function magnetSession() {
  return session.fromPartition('persist:magnet')
}

function decodeBuffer(buffer: Buffer, contentType: string): string {
  let charset = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? ''
  if (!charset) {
    const head = buffer.subarray(0, 4096).toString('latin1')
    charset = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8'
  }
  try {
    return new TextDecoder(charset).decode(buffer)
  } catch {
    return buffer.toString('utf8')
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1500, timeoutMs))
  try {
    const origin = new URL(url).origin
    const res = await magnetSession().fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: `${origin}/`,
        'Cache-Control': 'no-cache'
      },
      redirect: 'follow',
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return decodeBuffer(Buffer.from(await res.arrayBuffer()), res.headers.get('content-type') ?? '')
  } finally {
    clearTimeout(timer)
  }
}

function isRetryableNetworkError(err: unknown): boolean {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return true
  }
  const message = errorText(err)
  return /ERR_|timed? ?out|fetch failed|连接|超时|HTTP 5\d\d/i.test(message)
}

/** 超时 / 网络错误重试一次；403、404 等明确状态不重试 */
async function fetchTextWithRetry(url: string, timeoutMs: number): Promise<string> {
  try {
    return await fetchText(url, timeoutMs)
  } catch (err) {
    if (!isRetryableNetworkError(err)) throw err
    await delay(600)
    return fetchText(url, timeoutMs)
  }
}

/** JS 站点：用一个隐藏窗口渲染后取 outerHTML，和豆瓣 / Z-Library 的做法一致 */
function fetchHtmlViaWindow(
  source: MagnetSource,
  url: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
      webPreferences: {
        partition: 'persist:magnet',
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
    const timer = setTimeout(() => finish(new Error('页面加载超时')), Math.max(2000, timeoutMs))

    const finish = (err: Error | null, html = ''): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        win.destroy()
      } catch {
        // 窗口可能已被销毁
      }
      if (err) reject(err)
      else resolve(html)
    }

    win.webContents.setUserAgent(UA)
    void (async () => {
      try {
        if (source.navigationPage && !source.directNavigate) {
          await win.loadURL(source.navigationPage).catch(() => undefined)
          await delay(700)
        }
        try {
          await win.loadURL(url)
        } catch (err) {
          // 反爬站点会先用 JS 跳到验证页，Chromium 把首次导航标记为 ERR_ABORTED；
          // 这里继续等最终页面，不要直接判失败。
          if (!isAbortNavigationError(err)) throw err
        }
        await delay(1800)
        if (win.webContents.getURL().startsWith('chrome-error://')) {
          throw new Error('页面加载失败')
        }
        const html = await readWindowHtml(win)
        finish(null, html)
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)))
      }
    })()
  })
}

function isAbortNavigationError(err: unknown): boolean {
  return /ERR_ABORTED|\(-3\)/i.test(errorText(err))
}

async function readWindowHtml(win: BrowserWindow): Promise<string> {
  const script = 'document.documentElement.outerHTML'
  try {
    return String((await win.webContents.executeJavaScript(script, true)) ?? '')
  } catch {
    await delay(1000)
    return String((await win.webContents.executeJavaScript(script, true)) ?? '')
  }
}

async function fetchHtmlViaWindowWithRetry(
  source: MagnetSource,
  url: string,
  timeoutMs: number
): Promise<string> {
  try {
    return await fetchHtmlViaWindow(source, url, timeoutMs)
  } catch (err) {
    if (!isRetryableNetworkError(err) && !isAbortNavigationError(err)) throw err
    await delay(800)
    return fetchHtmlViaWindow(source, url, timeoutMs)
  }
}

function remaining(deadline: number, fallback: number): number {
  return Math.max(1500, Math.min(fallback, deadline - Date.now()))
}

/** 识别反爬验证页 / 域名被占用，给出比「0 条」更准确的错误 */
function detectBlockedPage(html: string, source: MagnetSource): string {
  if (!html) return ''
  if (/网址安全中心|Recaptcha|Bot Challenge|reCAPTCHA|人机验证|captcha/i.test(html)) {
    return '站点需要人机验证，暂不支持自动搜索'
  }
  if (source.id === 'skrbt' && /张旭鑫|鑫空间|个人主页/.test(html)) {
    return '站点域名已失效（已变成其他网站）'
  }
  return ''
}

async function fetchAndParse(
  source: MagnetSource,
  keyword: string,
  page: number,
  deadline: number
) {
  const url = buildSearchUrl(source, keyword, page)
  if (!/^https?:\/\//i.test(url)) throw new Error('资源库地址无效')

  if (source.isApi) {
    const body = await fetchTextWithRetry(url, remaining(deadline, LIST_TIMEOUT))
    return parseApiPage(body, source, page)
  }

  let html = ''
  if (source.useWebView2) {
    try {
      html = await fetchHtmlViaWindowWithRetry(
        source,
        url,
        remaining(deadline, WEBVIEW_TIMEOUT)
      )
    } catch (err) {
      const message = errorText(err)
      if (source.id === 'skrbt' && /ERR_FAILED|ERR_CONNECTION|ERR_NAME|ERR_TIMED_OUT/i.test(message)) {
        throw new Error('站点域名已失效或无法访问')
      }
      throw err
    }
  } else {
    html = await fetchTextWithRetry(url, remaining(deadline, LIST_TIMEOUT))
  }
  const blocked = detectBlockedPage(html, source)
  if (blocked) throw new Error(blocked)
  return parseHtmlPage(html, source, url, page)
}

async function hydrateItems(
  items: ParsedMagnetItem[],
  source: MagnetSource,
  deadline: number
): Promise<ParsedMagnetItem[]> {
  const output: (ParsedMagnetItem | null)[] = new Array(items.length).fill(null)
  const pending: { item: ParsedMagnetItem; index: number }[] = []

  items.forEach((item, index) => {
    if (item.magnet) {
      output[index] = item
      return
    }
    if (item.detailUrl && pending.length < MAX_DETAIL_FETCH) pending.push({ item, index })
  })

  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const next = pending[cursor++]
      if (!next || Date.now() >= deadline) return
      try {
        const html = await fetchTextWithRetry(
          next.item.detailUrl,
          remaining(deadline, DETAIL_TIMEOUT)
        )
        const magnet = extractMagnetFromHtml(html)
        if (!magnet) {
          appendMagnetLog(
            'DETAIL',
            `source=${source.name} url=${next.item.detailUrl} error=详情页没有找到磁链`
          )
          continue
        }
        const meta = parseDetailMeta(html)
        output[next.index] = {
          ...next.item,
          magnet,
          hash: magnetHash(magnet),
          size: next.item.size || meta.size,
          time: next.item.time || meta.time
        }
      } catch (err) {
        appendMagnetLog(
          'DETAIL',
          `source=${source.name} url=${next.item.detailUrl} error=${errorText(err)}`
        )
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(2, pending.length) }, worker))
  return output.filter((item): item is ParsedMagnetItem => !!item)
}

async function finalizeItems(
  raw: ParsedMagnetItem[],
  source: MagnetSource,
  options: MagnetOptions
): Promise<MagnetItem[]> {
  const { ad, smart } = await loadFilterWords()
  const output: MagnetItem[] = []

  for (const item of raw) {
    if (!item.magnet) continue
    const originalTitle = stripTags(item.title)
    const title = options.blockAds ? cleanupTitle(originalTitle, ad) : originalTitle
    const finalTitle = title || originalTitle
    if (options.smartSearch && hasAnyWord(finalTitle, smart)) continue

    const hash = item.hash || magnetHash(item.magnet)
    const sizeBytes = parseSizeToBytes(item.size)
    output.push({
      id: `${source.id}:${hash || item.magnet || finalTitle}:${output.length}`,
      title: finalTitle || '(无标题)',
      magnet: item.magnet,
      hash,
      size: item.size || formatSize(sizeBytes),
      sizeBytes,
      time: item.time,
      timeMs: parseDateToMs(item.time),
      sourceId: source.id,
      sourceName: source.name,
      detailUrl: item.detailUrl
    })
  }
  return output
}

export function dedupeMagnetItems(items: MagnetItem[]): MagnetItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = (item.hash || item.magnet).toLowerCase()
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isValidSource(source: unknown): source is MagnetSource {
  if (!source || typeof source !== 'object') return false
  const value = source as Partial<MagnetSource>
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.searchUrl === 'string' &&
    /^https?:\/\//i.test(value.searchUrl) &&
    value.searchUrl.includes('{keyword}')
  )
}

function failure(message: string, page: number, sourceId: string | null): MagnetSearchResponse {
  return {
    ok: false,
    items: [],
    hasNext: false,
    page,
    sourceId,
    errors: [],
    error: message
  }
}

export async function searchMagnetSource(
  source: MagnetSource,
  keyword: string,
  page: number,
  rawOptions: MagnetOptions,
  budgetMs = SOURCE_SEARCH_BUDGET
): Promise<MagnetSearchResponse> {
  if (!isValidSource(source)) {
    appendMagnetLog(
      'SEARCH',
      `source=${(source as Partial<MagnetSource> | null)?.name ?? '?'} error=资源库参数无效`
    )
    return failure('资源库参数无效', 1, null)
  }
  const cleanKeyword = keyword.trim()
  const safePage = Math.max(1, Math.min(100, Math.floor(page || 1)))
  if (!cleanKeyword || cleanKeyword.length > 80) {
    return failure('请输入 1–80 个字符的关键词', safePage, source.id)
  }
  const options = normalizeOptions(rawOptions)
  const deadline = Date.now() + Math.max(5000, budgetMs)
  const started = Date.now()
  let logUrl = source.searchUrl
  try {
    logUrl = buildSearchUrl(source, cleanKeyword, safePage)
    const parsed = await fetchAndParse(source, cleanKeyword, safePage, deadline)
    if (parsed.error) {
      appendMagnetLog(
        'SEARCH',
        `source=${source.name} page=${safePage} url=${logUrl} ms=${Date.now() - started} error=${parsed.error}`
      )
      return failure(parsed.error, safePage, source.id)
    }
    const hydrated = await hydrateItems(parsed.items, source, deadline)
    let items = await finalizeItems(hydrated, source, options)
    if (options.dedupe) items = dedupeMagnetItems(items)
    if (items.length === 0) {
      appendMagnetLog(
        'SEARCH',
        `source=${source.name} page=${safePage} url=${logUrl} ms=${Date.now() - started} ok=true items=0（列表 ${parsed.items.length} 条，详情后无磁链）`
      )
    }
    return {
      ok: true,
      items,
      hasNext: parsed.hasNext,
      page: safePage,
      sourceId: source.id,
      errors: []
    }
  } catch (err) {
    appendMagnetLog(
      'SEARCH',
      `source=${source.name} page=${safePage} url=${logUrl} ms=${Date.now() - started} error=${errorText(err)}`
    )
    return failure(errorText(err), safePage, source.id)
  }
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0
  const run = async (): Promise<void> => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
}

export async function searchMagnetAll(
  sources: MagnetSource[],
  keyword: string,
  rawOptions: MagnetOptions
): Promise<MagnetSearchResponse> {
  const cleanKeyword = keyword.trim()
  if (!cleanKeyword || cleanKeyword.length > 80) {
    return failure('请输入 1–80 个字符的关键词', 1, null)
  }
  const enabled = (Array.isArray(sources) ? sources : []).filter(
    (source) => source && source.enabled && isValidSource(source)
  )
  if (!enabled.length) return failure('没有启用的资源库', 1, null)

  const options = normalizeOptions(rawOptions)
  const errors: string[] = []
  const collected: MagnetItem[] = []
  const httpSources = enabled.filter((source) => !source.useWebView2)
  const windowSources = enabled.filter((source) => source.useWebView2)

  const runSource = async (source: MagnetSource): Promise<void> => {
    const result = await searchMagnetSource(
      source,
      cleanKeyword,
      1,
      options,
      ALL_SEARCH_BUDGET
    )
    if (result.ok) collected.push(...result.items)
    else errors.push(`${source.name}：${result.error ?? '搜索失败'}`)
  }

  await runPool(httpSources, 8, runSource)
  for (const source of windowSources) await runSource(source)

  let items = collected
  if (options.dedupe) items = dedupeMagnetItems(items)
  appendMagnetLog(
    'ALL',
    `keyword=${cleanKeyword} sources=${enabled.length} failed=${errors.length} items=${items.length}`
  )
  return {
    ok: true,
    items,
    hasNext: false,
    page: 1,
    sourceId: null,
    errors
  }
}

export async function testMagnetSource(source: MagnetSource): Promise<MagnetTestResult> {
  const testAt = Date.now()
  const started = Date.now()
  if (!isValidSource(source)) {
    appendMagnetLog(
      'TEST',
      `name=${(source as Partial<MagnetSource> | null)?.name ?? '?'} ok=false message=资源库参数无效`
    )
    return { ok: false, count: 0, message: '资源库参数无效', testAt }
  }
  try {
    const result = await searchMagnetSource(
      source,
      'saw',
      1,
      { blockAds: false, smartSearch: false, dedupe: true },
      TEST_BUDGET
    )
    const message = result.ok
      ? result.items.length > 0
        ? `可用 · ${result.items.length} 条`
        : '可用 · 0 条（可能被反爬或站点改版）'
      : result.error ?? '测试失败'
    appendMagnetLog(
      'TEST',
      `name=${source.name} url=${source.searchUrl} ok=${result.ok} count=${result.items.length} ms=${
        Date.now() - started
      } message=${message}`
    )
    return { ok: result.ok, count: result.items.length, message, testAt }
  } catch (err) {
    const message = errorText(err)
    appendMagnetLog(
      'TEST',
      `name=${source.name} url=${source.searchUrl} ok=false count=0 ms=${
        Date.now() - started
      } message=${message}`
    )
    return { ok: false, count: 0, message, testAt }
  }
}

export async function openMagnet(magnet: string): Promise<void> {
  if (typeof magnet !== 'string') throw new Error('磁力链接无效')
  let url: URL
  try {
    url = new URL(magnet)
  } catch {
    throw new Error('磁力链接无效')
  }
  if (url.protocol !== 'magnet:') throw new Error('磁力链接无效')
  const xt = url.searchParams.get('xt') ?? ''
  if (!/^urn:btih:[a-z0-9]{32,40}$/i.test(xt)) throw new Error('磁力链接缺少有效 hash')
  await shell.openExternal(magnet)
}
