import { app, BrowserWindow, safeStorage } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AccountSite,
  AccountState,
  AccountStatus,
  AccountsView
} from '../src/shared/accounts'
import { ACCOUNT_SITE_META } from '../src/shared/accounts'

/**
 * 站点账号仓库。
 * - 账密与 token 用 Electron safeStorage（Windows 下 DPAPI）加密后存 userData/accounts.json；
 * - 首次启动从内置种子（.secrets/accounts.json 或安装包 resources/accounts.seed.json）导入，
 *   之后完全离线自持，不再需要任何手动登录；
 * - 种子文件在 .gitignore 中，代码与文档里不出现明文密码。
 */

interface StoredEntry {
  username: string
  password: string
  token?: string
  tokenAt?: number
}

interface StoredStatus {
  status: AccountState
  message: string
  updatedAt: number
}

interface StoredFile {
  v: 1
  accounts: Partial<Record<AccountSite, StoredEntry>>
  status: Partial<Record<AccountSite, StoredStatus>>
}

const SITES: AccountSite[] = ['bika', 'komiic', 'wygamer']

let store: StoredFile = { v: 1, accounts: {}, status: {} }
let loaded = false
let writeChain: Promise<void> = Promise.resolve()

export function accountsFilePath(): string {
  return join(app.getPath('userData'), 'accounts.json')
}

function encryptValue(value: string): string {
  if (!value) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(value).toString('base64')}`
  }
  return `raw:${Buffer.from(value, 'utf8').toString('base64')}`
}

function decryptValue(value: string | undefined): string {
  if (!value) return ''
  try {
    if (value.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
    }
    if (value.startsWith('raw:')) return Buffer.from(value.slice(4), 'base64').toString('utf8')
  } catch (err) {
    console.error('[accounts] 解密失败', err)
  }
  return ''
}

function readFileStore(): StoredFile | null {
  const file = accountsFilePath()
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredFile>
    return {
      v: 1,
      accounts: raw.accounts && typeof raw.accounts === 'object' ? raw.accounts : {},
      status: raw.status && typeof raw.status === 'object' ? raw.status : {}
    }
  } catch (err) {
    console.error('[accounts] 读取账号文件失败', err)
    return null
  }
}

function seedPaths(): string[] {
  return [
    join(app.getPath('userData'), 'accounts.seed.json'),
    join(process.resourcesPath, 'accounts.seed.json'),
    join(app.getAppPath(), '.secrets', 'accounts.json'),
    join(process.cwd(), '.secrets', 'accounts.json')
  ]
}

interface SeedEntry {
  username?: unknown
  password?: unknown
}

function readSeed(): Partial<Record<AccountSite, SeedEntry>> {
  for (const file of seedPaths()) {
    if (!existsSync(file)) continue
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      const out: Partial<Record<AccountSite, SeedEntry>> = {}
      for (const site of SITES) {
        const entry = raw[site]
        if (entry && typeof entry === 'object') out[site] = entry as SeedEntry
      }
      if (Object.keys(out).length) return out
    } catch (err) {
      console.error('[accounts] 读取种子账号失败', file, err)
    }
  }
  return {}
}

function fromSeed(seed: SeedEntry | undefined): StoredEntry | null {
  if (!seed) return null
  const username = typeof seed.username === 'string' ? seed.username.trim() : ''
  const password = typeof seed.password === 'string' ? seed.password : ''
  if (!username || !password) return null
  return { username, password: encryptValue(password) }
}

/** 启动时调用：加载账号文件、按需从种子补齐，任何异常都不阻断应用启动 */
export function initAccounts(): void {
  if (loaded) return
  loaded = true
  const loadedStore = readFileStore()
  if (loadedStore) store = loadedStore

  const seed = readSeed()
  let changed = !loadedStore
  for (const site of SITES) {
    const current = store.accounts[site]
    const hasPassword = current ? !!decryptValue(current.password) : false
    if (!current || !current.username || !hasPassword) {
      const seeded = fromSeed(seed[site])
      if (seeded) {
        store.accounts[site] = { ...seeded, token: current?.token, tokenAt: current?.tokenAt }
        changed = true
      }
    }
  }

  if (changed) {
    const initial = store.status.bika
    if (!initial) setStatusMemory('bika', 'unknown', '等待首次自动登录')
    if (!store.status.komiic) setStatusMemory('komiic', 'unknown', '等待首次自动登录')
    if (!store.status.wygamer) setStatusMemory('wygamer', 'unknown', '等待会话恢复')
    void persist()
  }
}

function setStatusMemory(site: AccountSite, status: AccountState, message: string): void {
  store.status[site] = { status, message, updatedAt: Date.now() }
}

async function persist(): Promise<void> {
  const payload = JSON.stringify(store, null, 2)
  writeChain = writeChain
    .then(async () => {
      await mkdir(app.getPath('userData'), { recursive: true })
      const target = accountsFilePath()
      const tmp = `${target}.tmp`
      await writeFile(tmp, payload, 'utf8')
      await rename(tmp, target)
    })
    .catch((err) => console.error('[accounts] 保存账号文件失败', err))
  await writeChain
}

export function hasCredentials(site: AccountSite): boolean {
  const entry = store.accounts[site]
  return !!entry?.username && !!decryptValue(entry.password)
}

export function getCredentials(site: AccountSite): { username: string; password: string } | null {
  const entry = store.accounts[site]
  if (!entry) return null
  const password = decryptValue(entry.password)
  if (!entry.username || !password) return null
  return { username: entry.username, password }
}

export function getToken(site: AccountSite): string {
  return decryptValue(store.accounts[site]?.token)
}

export function getTokenAt(site: AccountSite): number {
  return store.accounts[site]?.tokenAt ?? 0
}

export function setToken(site: AccountSite, token: string): void {
  const entry = store.accounts[site]
  if (!entry) return
  entry.token = encryptValue(token)
  entry.tokenAt = Date.now()
  void persist()
}

export function clearToken(site: AccountSite): void {
  const entry = store.accounts[site]
  if (!entry) return
  delete entry.token
  delete entry.tokenAt
  void persist()
}

export function setAccountStatus(site: AccountSite, status: AccountState, message: string): void {
  setStatusMemory(site, status, message)
  void persist()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('accounts:changed')
  }
}

export function listAccounts(): AccountsView {
  const items: AccountStatus[] = SITES.map((site) => {
    const meta = ACCOUNT_SITE_META[site]
    const entry = store.accounts[site]
    const st = store.status[site]
    const configured = !!entry?.username && !!decryptValue(entry.password)
    return {
      site,
      title: meta.title,
      username: entry?.username ?? '',
      status: configured ? (st?.status ?? 'unknown') : 'failed',
      message: configured ? (st?.message ?? '等待登录') : '未内置账号，请在 .secrets/accounts.json 配置',
      updatedAt: st?.updatedAt ?? 0,
      automatic: meta.automatic
    }
  })
  return { items }
}
