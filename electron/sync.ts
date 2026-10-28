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

function fileUrl(rawUrl: string): string {
  const base = rawUrl.trim().replace(/\s+/g, '')
  if (!base) throw new Error('还没有填写 WebDAV 地址')
  if (!/^https?:\/\//i.test(base)) throw new Error('WebDAV 地址必须以 http(s):// 开头')
  return base.endsWith('/') ? `${base}data.json` : `${base}/data.json`
}

async function requireConfig(): Promise<StoredSyncConfig> {
  const stored = await readStored()
  if (!stored?.url) throw new Error('还没有配置 WebDAV，先填写地址并保存')
  return stored
}

export async function testSync(): Promise<SyncActionResult> {
  try {
    const config = await requireConfig()
    const base = config.url.endsWith('/') ? config.url : `${config.url}/`
    const res = await fetch(base, {
      method: 'PROPFIND',
      headers: { ...authHeader(config), Depth: '0' },
      signal: AbortSignal.timeout(15_000)
    })
    if (res.status === 207 || res.status === 200) {
      return { ok: true, message: '连接成功' }
    }
    if (res.status === 401) return { ok: false, message: '认证失败：请检查账号与密码（坚果云需用应用密码）' }
    if (res.status === 404) return { ok: false, message: '目录不存在：请先在网盘里创建该目录' }
    return { ok: false, message: `连接失败：HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, message: errorText(err) }
  }
}

export async function uploadSync(data: AppData): Promise<SyncActionResult> {
  try {
    const config = await requireConfig()
    const url = fileUrl(config.url)
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        ...authHeader(config),
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({ ...data, version: 1, exportAt: new Date().toISOString() }, null, 2),
      signal: AbortSignal.timeout(60_000)
    })
    if (!res.ok) {
      return { ok: false, message: res.status === 401 ? '认证失败：账号或密码不对' : `上传失败：HTTP ${res.status}` }
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
    const res = await fetch(url, {
      headers: authHeader(config),
      signal: AbortSignal.timeout(60_000)
    })
    if (res.status === 404) return { ok: false, message: '云端还没有备份文件，先上传一次' }
    if (!res.ok) return { ok: false, message: `下载失败：HTTP ${res.status}` }
    const raw = (await res.json()) as Record<string, unknown>
    if (!('items' in raw) || !('lists' in raw) || !('listItems' in raw)) {
      return { ok: false, message: '云端文件不是有效的备份（缺少 items / lists / listItems）' }
    }
    return { ok: true, message: '已下载云端备份', data: normalizeData(raw) }
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
