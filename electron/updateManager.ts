import { app, BrowserWindow } from 'electron'
import { createReadStream, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setUpdatesDownloadActive, updatesDir } from './cacheManager'
import { compareVersions } from '../src/shared/update'
import type { UpdateCheckResult, UpdateDownloadResult, UpdateProgress } from '../src/shared/update'

/** electron-builder 要求三段式版本，对外显示与安装包名去掉末尾的 .0（0.5.0 → 0.5） */
export function displayVersion(): string {
  return app.getVersion().replace(/\.0$/, '')
}

const UPDATE_GIST_ID = '802551160083623580189fc536724d65'
const UPDATE_MANIFEST_URL = `https://gist.githubusercontent.com/Bug142857/${UPDATE_GIST_ID}/raw/update.json`
const UPDATE_GIST_API_URL = `https://api.github.com/gists/${UPDATE_GIST_ID}`

/** 更新线路：直连 + 实测可用的 GitHub 镜像（与手机端一致，先测速再选线） */
const UPDATE_LINES: Array<{ name: string; prefix: string }> = [
  { name: '直连', prefix: '' },
  { name: 'gh-proxy', prefix: 'https://gh-proxy.com/' },
  { name: 'ghproxy', prefix: 'https://ghproxy.net/' }
]

const GITHUB_URL_RE =
  /^https:\/\/(?:api\.github\.com|github\.com|gist\.github\.com|gist\.githubusercontent\.com|raw\.githubusercontent\.com|objects\.githubusercontent\.com)\//i

/** 同一资源在各条线路上的地址；非 GitHub 地址没有镜像，只能直连 */
function updateLineCandidates(url: string): Array<{ name: string; url: string }> {
  if (!GITHUB_URL_RE.test(url)) return [{ name: '直连', url }]
  return UPDATE_LINES.map((line) => ({ name: line.name, url: `${line.prefix}${url}` }))
}

/** 单线路测速：拉一小段真实数据（128KB），同时得到延迟与下载速度 */
async function probeUpdateLine(
  url: string,
  timeoutMs: number
): Promise<{ latency: number; speed: number } | null> {
  const startedAt = Date.now()
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'laozheng-pc', Range: 'bytes=0-131071' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok && res.status !== 206) {
      await res.body?.cancel().catch(() => undefined)
      return null
    }
    let bytes = 0
    const reader = res.body?.getReader()
    if (reader) {
      while (bytes < 128 * 1024) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value?.length ?? 0
      }
      await reader.cancel().catch(() => undefined)
    }
    const latency = Math.max(1, Date.now() - startedAt)
    return { latency, speed: (bytes * 1000) / latency }
  } catch {
    return null
  }
}

/** 先看哪条线通、哪条最快：可用线路按实际下载速度降序，速度相同再按延迟，不可用线路留作兜底 */
async function rankUpdateLines(
  url: string,
  timeoutMs: number
): Promise<Array<{ name: string; url: string }>> {
  const candidates = updateLineCandidates(url)
  if (candidates.length === 1) return candidates
  const probed = await Promise.all(
    candidates.map(async (line) => {
      const result = await probeUpdateLine(line.url, timeoutMs)
      return {
        ...line,
        latency: result?.latency ?? null,
        speed: result?.speed ?? 0
      }
    })
  )
  const alive = probed
    .filter((line) => line.latency !== null)
    .sort((a, b) => b.speed - a.speed || (a.latency ?? 0) - (b.latency ?? 0))
  const dead = probed.filter((line) => line.latency === null)
  return [...alive, ...dead].map(({ name, url: lineUrl }) => ({ name, url: lineUrl }))
}

/** 多线路并发取同一份 JSON：谁最先完整返回用谁（即最快线路），全失败返回 null */
async function fetchJsonFastest<T>(
  url: string,
  timeoutMs: number
): Promise<{ data: T; line: string } | null> {
  const candidates = updateLineCandidates(url)
  return await new Promise((resolve) => {
    let remaining = candidates.length
    let settled = false
    const finish = (value: { data: T; line: string } | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    for (const candidate of candidates) {
      void fetch(candidate.url, {
        headers: { 'User-Agent': 'laozheng-pc', Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs)
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          finish({ data: (await res.json()) as T, line: candidate.name })
        })
        .catch(() => undefined)
        .finally(() => {
          remaining -= 1
          if (remaining === 0) finish(null)
        })
    }
  })
}

/** 检查更新：公开仓库优先走 GitHub API（能拿到 exe 资产直链），失败再读公开清单 */
export async function checkUpdateInternal(): Promise<UpdateCheckResult> {
  const current = displayVersion()
  const api = await checkViaGithubApi(current)
  if (api) return api
  const manifest = await checkViaManifest(current)
  if (manifest) return manifest
  return { ok: false, current, error: '检查更新失败：直连与镜像线路都不可用，请检查网络后重试' }
}

interface GithubAsset {
  name?: string
  size?: number
  browser_download_url?: string
  /** GitHub 新版 Release API 返回的 sha256:... 摘要 */
  digest?: string
}

/** 从 GitHub digest / 更新清单里取出合法 SHA256 */
function parseSha256(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const raw = value.trim().replace(/^sha256:/i, '')
  return /^[a-f0-9]{64}$/i.test(raw) ? raw.toLowerCase() : undefined
}

/** 流式计算文件 SHA256，避免把 100MB 安装包整份读进内存 */
function fileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/** GitHub Releases API（仓库公开后匿名可用，能直接拿到安装包地址） */
async function checkViaGithubApi(current: string): Promise<UpdateCheckResult | null> {
  const fetched = await fetchJsonFastest<{
    tag_name?: string
    html_url?: string
    body?: string
    assets?: GithubAsset[]
  }>('https://api.github.com/repos/Bug142857/LaoZheng/releases/latest', 12_000)
  if (!fetched) return null
  const json = fetched.data
  const tag = typeof json.tag_name === 'string' ? json.tag_name.trim() : ''
  if (!tag) return null
  const latest = tag.replace(/^v/i, '')
  const assets = Array.isArray(json.assets) ? json.assets : []
  const exe = assets.find(
    (a) =>
      typeof a.browser_download_url === 'string' &&
      /\.exe$/i.test(a.name ?? '') &&
      !/\.blockmap$/i.test(a.name ?? '')
  )
  return {
    ok: true,
    current,
    latest,
    hasUpdate: compareVersions(latest, current) > 0,
    url: typeof json.html_url === 'string' ? json.html_url : undefined,
    downloadUrl: exe?.browser_download_url,
    sha256: parseSha256(exe?.digest),
    notes: typeof json.body === 'string' ? json.body.slice(0, 2000) : undefined,
    line: fetched.line
  }
}

/**
 * Gist 的 raw 地址会走 CDN 缓存，刚补上的 sha256 可能短时间读不到。
 * 清单缺少 sha256 时再查一次 Gist API 内容，能拿到就立即用上。
 */
async function fetchGistApiSha256(): Promise<string | undefined> {
  const fetched = await fetchJsonFastest<{
    files?: Record<string, { content?: string }>
  }>(UPDATE_GIST_API_URL, 12_000)
  const content = fetched?.data.files?.['update.json']?.content
  if (!content) return undefined
  try {
    const parsed = JSON.parse(content) as { sha256?: unknown }
    return parseSha256(parsed.sha256)
  } catch {
    return undefined
  }
}

/** 公开清单兜底（GitHub API 被墙 / 限流时） */
async function checkViaManifest(current: string): Promise<UpdateCheckResult | null> {
  const fetched = await fetchJsonFastest<{
    version?: string
    url?: string
    exe?: string
    downloadUrl?: string
    sha256?: string
    notes?: string
  }>(UPDATE_MANIFEST_URL, 12_000)
  if (!fetched) return null
  const json = fetched.data
  const latest =
    typeof json.version === 'string' ? json.version.trim().replace(/^v/i, '') : ''
  if (!latest) return null
  const exe =
    typeof json.exe === 'string'
      ? json.exe.trim()
      : typeof json.downloadUrl === 'string'
        ? json.downloadUrl.trim()
        : ''
  const sha256 = parseSha256(json.sha256) ?? (await fetchGistApiSha256())
  return {
    ok: true,
    current,
    latest,
    hasUpdate: compareVersions(latest, current) > 0,
    url: typeof json.url === 'string' ? json.url : undefined,
    downloadUrl: /^https:\/\//i.test(exe) ? exe : undefined,
    sha256,
    notes: typeof json.notes === 'string' ? json.notes.slice(0, 2000) : undefined,
    line: fetched.line
  }
}

function broadcastUpdateProgress(progress: UpdateProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update:progress', progress)
    // 同步到任务栏：结束 / 失败时清除，大小未知时用不确定态
    if (progress.error || progress.percent >= 1) {
      win.setProgressBar(-1)
    } else if (progress.total > 0) {
      win.setProgressBar(Math.max(0.01, progress.percent))
    } else {
      win.setProgressBar(2)
    }
  }
}

/** 同一时间只允许一个更新包下载：启动静默下载和手动点击可能撞在一起，共用 .part 会互相覆盖 */
let updateDownloading = false

/** 更新下载任务：支持暂停 / 继续 / 取消 */
interface UpdateDownloadTask {
  paused: boolean
  canceled: boolean
  wake: (() => void) | null
  controller: AbortController | null
  progress: UpdateProgress | null
}

let updateTask: UpdateDownloadTask | null = null

/** 启动时检查到的新版本：渲染层可能还没挂载完，先存一份等它主动来取 */
let pendingUpdateNotice: UpdateCheckResult | null = null

function broadcastUpdateState(task: UpdateDownloadTask): void {
  if (!task.progress) return
  broadcastUpdateProgress({ ...task.progress, paused: task.paused, speed: 0 })
}

export async function downloadUpdateInstaller(
  url: string,
  sha256?: string
): Promise<UpdateDownloadResult> {
  const expectedSha256 = parseSha256(sha256)
  // 更新清单 / Release 没给校验值时不再允许下载：宁可让用户手动去 Release 下载，也不装未校验的包
  if (!expectedSha256) {
    return {
      ok: false,
      error: '更新清单缺少 SHA256 校验值，已停止下载；请稍后重试或到 GitHub Release 页面手动下载'
    }
  }
  if (updateDownloading) return { ok: false, error: '更新安装包正在下载，请稍候' }
  updateDownloading = true
  // 下载期间清理缓存不能删 updates 里的 .part
  setUpdatesDownloadActive(true)
  const task: UpdateDownloadTask = {
    paused: false,
    canceled: false,
    wake: null,
    controller: null,
    progress: null
  }
  updateTask = task
  // 先推一条 0% 让界面立即出现进度条（测速选线期间显示「正在测速选择最快线路」）
  const initial: UpdateProgress = {
    received: 0,
    total: 0,
    percent: 0,
    speed: 0,
    phase: 'selecting'
  }
  task.progress = initial
  broadcastUpdateProgress(initial)
  try {
    const result = await downloadUpdateInstallerInner(url, task, expectedSha256)
    // 失败 / 取消时主动结束进度条，避免顶部浮条停在 0% 或最后一段
    if (!result.ok) {
      broadcastUpdateProgress({
        received: 0,
        total: 0,
        percent: 0,
        error: result.canceled ? '已取消下载' : result.error ?? '下载失败'
      })
    }
    return result
  } finally {
    updateTask = null
    updateDownloading = false
    setUpdatesDownloadActive(false)
  }
}

/** 下载安装包到 userData/updates：先测速选线，再按「最快 → 兜底」顺序下载；仅接受 https 直链 */
async function downloadUpdateInstallerInner(
  url: string,
  task: UpdateDownloadTask,
  expectedSha256?: string
): Promise<UpdateDownloadResult> {
  let target: string
  let base: string
  try {
    const dir = updatesDir()
    await mkdir(dir, { recursive: true })
    const raw = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
    base = (raw || `laozheng-update-${Date.now()}.exe`).replace(/[\\/:*?"<>|]/g, '_')
    target = join(dir, base.toLowerCase().endsWith('.exe') ? base : `${base}.exe`)
  } catch {
    return { ok: false, error: '更新地址无效' }
  }

  // 先看哪条线通、哪条最快，避免直连被墙时一直等到超时
  const channels = await rankUpdateLines(url, 5_000)
  if (task.canceled) return { ok: false, canceled: true, error: '已取消下载' }
  // 选线完成后先把最快线路显示出来，下载一开始就能看到走的是哪条线
  const selected: UpdateProgress = {
    received: 0,
    total: 0,
    percent: 0,
    speed: 0,
    line: channels[0]?.name,
    phase: 'downloading'
  }
  task.progress = selected
  broadcastUpdateProgress(selected)
  let lastError = '下载更新失败'
  for (const channel of channels) {
    if (task.canceled) return { ok: false, canceled: true, error: '已取消下载' }
    const tmp = `${target}.part`
    try {
      const controller = new AbortController()
      task.controller = controller
      const res = await fetch(channel.url, {
        headers: { 'User-Agent': 'laozheng-pc', Accept: '*/*' },
        redirect: 'follow',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60 * 1000)])
      })
      if (!res.ok || !res.body) {
        lastError = `下载失败 HTTP ${res.status}`
        continue
      }
      const type = res.headers.get('content-type') ?? ''
      if (type.includes('text/html')) {
        lastError = '下载线路返回了网页而不是安装包'
        continue
      }
      const total = Number(res.headers.get('content-length') ?? 0) || 0
      let received = 0
      let lastAt = Date.now()
      let lastReceived = 0
      let speed = 0
      const meter = new Transform({
        async transform(chunk, _enc, cb) {
          // 暂停时先卡住数据（不读网络，靠背压停住连接），继续或取消后再放行
          while (task.paused && !task.canceled) {
            await new Promise<void>((resolve) => {
              task.wake = resolve
            })
          }
          if (task.canceled) {
            cb(new Error('已取消下载'))
            return
          }
          received += chunk.length
          const now = Date.now()
          if (now - lastAt > 200) {
            const elapsed = Math.max(1, now - lastAt)
            const instant = ((received - lastReceived) * 1000) / elapsed
            // 指数平滑，避免速度数字乱跳
            speed = speed > 0 ? speed * 0.6 + instant * 0.4 : instant
            lastAt = now
            lastReceived = received
            const progress: UpdateProgress = {
              received,
              total,
              percent: total > 0 ? received / total : 0,
              line: channel.name,
              speed,
              phase: 'downloading'
            }
            task.progress = progress
            broadcastUpdateProgress(progress)
          }
          cb(null, chunk)
        }
      })
      await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(tmp))
      task.controller = null
      await rename(tmp, target)
      // 有 SHA256 时必须校验：镜像返回错包 / 被替换的安装包直接删除并换下一条线路
      if (expectedSha256) {
        const actual = await fileSha256(target).catch(() => '')
        if (actual !== expectedSha256) {
          await unlink(target).catch(() => undefined)
          lastError = '安装包校验失败（SHA256 不一致），已删除，请稍后重试'
          continue
        }
      }
      const done: UpdateProgress = {
        received,
        total: total || received,
        percent: 1,
        line: channel.name,
        speed: 0,
        phase: 'downloading'
      }
      task.progress = done
      broadcastUpdateProgress(done)
      return { ok: true, path: target }
    } catch (err) {
      task.controller = null
      await unlink(tmp).catch(() => undefined)
      if (task.canceled) return { ok: false, canceled: true, error: '已取消下载' }
      lastError = err instanceof Error ? err.message : '下载更新失败'
    }
  }
  return { ok: false, error: lastError }
}

/**
 * 安装更新：直接拉起 NSIS 安装向导（与手机端点「安装」一致），
 * 应用先退出，安装器接管文件替换。
 */
export async function installUpdateInstaller(path: string): Promise<void> {
  const abs = resolve(path)
  const dir = resolve(updatesDir())
  if (!abs.startsWith(dir + sep)) throw new Error('安装包路径无效')
  if (!abs.toLowerCase().endsWith('.exe')) throw new Error('安装包格式无效')
  await stat(abs)
  const child = spawn(abs, [], { detached: true, stdio: 'ignore' })
  // 安装包被杀软拦截 / 没有执行权限时 spawn 会异步抛 error，不处理会直接崩主进程
  const spawnError = await new Promise<Error | null>((resolveError) => {
    child.once('error', (err) => resolveError(err))
    setTimeout(() => resolveError(null), 500)
  })
  if (spawnError) throw new Error(`无法启动安装程序：${spawnError.message}`)
  child.unref()
  setTimeout(() => app.quit(), 900)
}

/** 启动后检查更新：只做检查并通知渲染层，由应用内弹窗确认后才下载 */
export async function autoUpdateCheck(win: BrowserWindow): Promise<void> {
  const info = await checkUpdateInternal()
  if (!info.ok || !info.hasUpdate) return
  if (win.isDestroyed()) return
  pendingUpdateNotice = info
  win.webContents.send('update:available', info)
}

/** 取出启动时检查到的新版本（取完即清空） */
export function takePendingUpdateNotice(): UpdateCheckResult | null {
  const info = pendingUpdateNotice
  pendingUpdateNotice = null
  return info
}

export function pauseUpdateDownload(): void {
  if (!updateTask) return
  updateTask.paused = true
  broadcastUpdateState(updateTask)
}

export function resumeUpdateDownload(): void {
  if (!updateTask) return
  updateTask.paused = false
  const wake = updateTask.wake
  updateTask.wake = null
  wake?.()
  broadcastUpdateState(updateTask)
}

export function cancelUpdateDownload(): void {
  const task = updateTask
  if (!task) return
  task.canceled = true
  task.paused = false
  const wake = task.wake
  task.wake = null
  wake?.()
  task.controller?.abort()
  // 立即通知界面收起进度条，不等下载循环退出
  broadcastUpdateProgress({ received: 0, total: 0, percent: 0, error: '已取消下载' })
}
