import { app, safeStorage } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  SyncActionResult,
  SyncConfigInput,
  SyncConfigView
} from '../src/shared/sync'
import type { AppData } from '../src/shared/types'
import { normalizeData } from '../src/shared/types'

/**
 * WebDAV 云同步（坚果云等）：手动上传 / 下载 data.json。
 * 账号密码只存本机 userData/sync.json（密码用 safeStorage 加密），不写入备份。
 *
 * 常见 404 原因：地址填的是网盘里还没创建的子目录。
 * 上传前会先 PROPFIND 目标目录，缺失时逐级 MKCOL 建好再 PUT。
 */

interface StoredSyncConfig {
  url: string
  username: string
  /** safeStorage 加密后的 base64；系统不支持时退回 base64 明文并标记 */
  password: string
  plain: boolean
}

function configPath(): string {
  return join(app.getPath('userData'), 'sync.json')
}

function encrypt(password: string): { value: string; plain: boolean } {
  if (safeStorage.isEncryptionAvailable()) {
    return { value: safeStorage.encryptString(password).toString('base64'), plain: false }
  }
  return { value: Buffer.from(password, 'utf8').toString('base64'), plain: true }
}

function decrypt(stored: StoredSyncConfig): string {
  try {
    const buf = Buffer.from(stored.password, 'base64')
    if (stored.plain) return buf.toString('utf8')
    return safeStorage.decryptString(buf)
  } catch {
    return ''
  }
}

async function readStored(): Promise<StoredSyncConfig | null> {
  try {
    const raw = JSON.parse(await readFile(configPath(), 'utf8')) as Partial<StoredSyncConfig>
    if (!raw.url) return null
    return {
      url: raw.url,
      username: raw.username ?? '',
      password: raw.password ?? '',
      plain: !!raw.plain
    }
  } catch {
    return null
  }
}

async function writeStored(config: StoredSyncConfig): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  const tmp = `${configPath()}.tmp`
  await writeFile(tmp, JSON.stringify(config, null, 2), 'utf8')
  await rename(tmp, configPath())
}

export async function getSyncConfig(): Promise<SyncConfigView> {
  const stored = await readStored()
  return {
    url: stored?.url ?? '',
    username: stored?.username ?? '',
    hasPassword: !!stored?.password
  }
}

export async function saveSyncConfig(input: SyncConfigInput): Promise<SyncConfigView> {
  const url = input.url.trim()
  const username = input.username.trim()
  const old = await readStored()
  let password = old?.password ?? ''
  let plain = old?.plain ?? false
  if (input.password) {
    const enc = encrypt(input.password)
    password = enc.value
    plain = enc.plain
  }
  if (!url) {
    // 清空配置
    await writeStored({ url: '', username: '', password: '', plain: false })
    return { url: '', username: '', hasPassword: false }
  }
  await writeStored({ url, username, password, plain })
  return { url, username, hasPassword: !!password }
}

function authHeader(config: StoredSyncConfig): Record<string, string> {
  if (!config.username) return {}
  const pass = decrypt(config)
  return {
    Authorization: `Basic ${Buffer.from(`${config.username}:${pass}`, 'utf8').toString('base64')}`
  }
}

/** 坚果云 / 多数 WebDAV 的根目录只允许列目录，不能直接写文件：根目录自动改用这个子目录 */
const ROOT_FOLDER = '老郑分享'

/** 去掉首尾空白；如果填的是完整 data.json 地址，取它所在目录作为同步目录 */
function normalizeBase(rawUrl: string): string {
  const base = rawUrl.trim()
  if (!base) throw new Error('还没有填写 WebDAV 地址')
  if (!/^https?:\/\//i.test(base)) throw new Error('WebDAV 地址必须以 http(s):// 开头')
  if (/\.json$/i.test(base)) {
    return base.replace(/\/[^/]+$/i, '/')
  }
  return base.endsWith('/') ? base : `${base}/`
}

/** 根目录（/ 或 /dav）自动落到「老郑分享」子目录，否则直接用用户填的目录 */
function syncBase(rawUrl: string): string {
  const base = normalizeBase(rawUrl)
  const parsed = new URL(base)
  const path = parsed.pathname.replace(/\/+$/, '')
  if (path === '' || path === '/' || path === '/dav') {
    return new URL(`${ROOT_FOLDER}/`, base).toString()
  }
  return base
}

function fileUrl(rawUrl: string): string {
  return `${syncBase(rawUrl)}data.json`
}

async function requireConfig(): Promise<StoredSyncConfig> {
  const stored = await readStored()
  if (!stored?.url) throw new Error('还没有配置 WebDAV，先填写地址并保存')
  return stored
}

async function propfind(url: string, config: StoredSyncConfig): Promise<number> {
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: { ...authHeader(config), Depth: '0' },
    signal: AbortSignal.timeout(15_000)
  })
  return res.status
}

/** 逐级 MKCOL；已存在（405 / 301 / 409 且父级已建）时跳过 */
async function mkcolChain(base: string, config: StoredSyncConfig): Promise<void> {
  const parsed = new URL(base)
  const segments = parsed.pathname.split('/').filter(Boolean)
  let path = ''
  for (const segment of segments) {
    path += `/${segment}`
    const url = `${parsed.origin}${path}/`
    const res = await fetch(url, {
      method: 'MKCOL',
      headers: authHeader(config),
      signal: AbortSignal.timeout(15_000)
    })
    // 201 创建成功；405 已存在；其余（如 403 只读根目录）继续下一级尝试
    if (res.status >= 400 && res.status !== 405 && res.status !== 409) {
      if (res.status === 401) throw new Error('认证失败：请检查账号与密码（坚果云需用应用密码）')
    }
  }
}

/** 确保同步目录存在：缺失时自动创建（解决「测试连接成功但上传 404」） */
async function ensureRemoteDir(config: StoredSyncConfig): Promise<string> {
  const base = syncBase(config.url)
  const status = await propfind(base, config)
  if (status === 207 || status === 200) return base
  if (status === 401) throw new Error('认证失败：请检查账号与密码（坚果云需用应用密码）')
  if (status === 403) throw new Error('没有写入权限：请检查账号是否被允许写入该目录')
  if (status === 404 || status === 409) {
    await mkcolChain(base, config)
    const retry = await propfind(base, config)
    if (retry === 207 || retry === 200) return base
    throw new Error(`目录创建失败（HTTP ${retry}）：请先在网盘里手动创建该目录`)
  }
  throw new Error(`目录不可用：HTTP ${status}`)
}

export async function testSync(): Promise<SyncActionResult> {
  try {
    const config = await requireConfig()
    const base = await ensureRemoteDir(config)
    let folder = base
    try {
      folder = decodeURIComponent(new URL(base).pathname)
    } catch {
      // 保留原始地址
    }
    return { ok: true, message: `连接成功（同步目录：${folder}）` }
  } catch (err) {
    return { ok: false, message: errorText(err) }
  }
}

export async function uploadSync(data: AppData): Promise<SyncActionResult> {
  try {
    const config = await requireConfig()
    const base = await ensureRemoteDir(config)
    const url = fileUrl(config.url)
    const send = async (): Promise<Response> =>
      fetch(url, {
        method: 'PUT',
        headers: {
          ...authHeader(config),
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(
          { ...data, version: 1, exportAt: new Date().toISOString() },
          null,
          2
        ),
        signal: AbortSignal.timeout(60_000)
      })
    let res = await send()
    // 目录刚建好仍可能被网盘缓存成 404/409：再补一次 MKCOL 后重试
    if (res.status === 404 || res.status === 409) {
      await mkcolChain(base, config)
      res = await send()
    }
    if (!res.ok) {
      if (res.status === 401) return { ok: false, message: '认证失败：账号或密码不对' }
      if (res.status === 403) return { ok: false, message: '没有写入权限：请检查网盘目录权限' }
      return { ok: false, message: `上传失败：HTTP ${res.status}（${url}）` }
    }
    return { ok: true, message: '已上传到云端' }
  } catch (err) {
    return { ok: false, message: errorText(err) }
  }
}

export async function downloadSync(): Promise<SyncActionResult> {
  try {
    const config = await requireConfig()
    const url = fileUrl(config.url)
    // 旧版本可能把 data.json 直接放在根目录：新目录找不到时回退根目录
    const legacy = `${normalizeBase(config.url)}data.json`
    const candidates = legacy !== url ? [url, legacy] : [url]
    let lastStatus = 0
    for (const candidate of candidates) {
      const res = await fetch(candidate, {
        headers: authHeader(config),
        signal: AbortSignal.timeout(60_000)
      })
      lastStatus = res.status
      if (res.status === 404) continue
      if (res.status === 401) return { ok: false, message: '认证失败：账号或密码不对' }
      if (!res.ok) return { ok: false, message: `下载失败：HTTP ${res.status}` }
      const raw = (await res.json()) as Record<string, unknown>
      if (!('items' in raw) || !('lists' in raw) || !('listItems' in raw)) {
        return { ok: false, message: '云端文件不是有效的备份（缺少 items / lists / listItems）' }
      }
      return {
        ok: true,
        message: candidate === url ? '已下载云端备份' : '已下载云端备份（旧版根目录）',
        data: normalizeData(raw)
      }
    }
    return {
      ok: false,
      message: lastStatus === 404 ? '云端还没有备份文件，先上传一次' : `下载失败：HTTP ${lastStatus}`
    }
  } catch (err) {
    return { ok: false, message: errorText(err) }
  }
}

function errorText(err: unknown): string {
  if (!(err instanceof Error)) return '同步失败'
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return '连接超时，请稍后重试'
  if (err.message.includes('fetch failed')) return '网络不可用，检查网络或 WebDAV 地址'
  return err.message
}
