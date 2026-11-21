import { app, session } from 'electron'
import { ProxyAgent, Socks5ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici'

/**
 * 主进程网络请求跟随系统代理。
 *
 * Electron 主进程的全局 fetch 走 Node 网络栈，不读 Windows「系统代理」，
 * 所以只开系统代理（没有 TUN / 虚拟网卡）时浏览器能打开的站点软件会报连不上。
 * 这里用 Chromium 的 resolveProxy 结果（含系统代理、PAC、例外列表）按域名选代理：
 * - 命中直连：仍用原来的 Node fetch，行为完全不变；
 * - 命中代理：改走 undici fetch + ProxyAgent / Socks5ProxyAgent，支持 PAC 返回多条线路；
 * - 代理连接失败时依次尝试下一条，全部失败后清缓存重新解析一次（系统代理可能刚切换）。
 * 代理结果按 origin 缓存 15 秒，系统代理切换后很快生效。
 */

const RESOLVE_TTL_MS = 15_000

/** resolveProxy 结果：按顺序尝试的代理线路 + PAC 是否明确允许直连 */
interface ProxyPlan {
  dispatchers: Dispatcher[]
  direct: boolean
}

const agents = new Map<string, Dispatcher>()
const originCache = new Map<string, { at: number; plan: ProxyPlan }>()
const nodeFetch = globalThis.fetch.bind(globalThis)
let installed = false

function urlOf(input: string | URL | Request | unknown): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  if (input && typeof input === 'object' && 'url' in input) return String((input as Request).url)
  return ''
}

/** 本机 / 回环地址始终直连，不能交给代理，避免把本地媒体服务转发出去 */
function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1' || host === '0.0.0.0' || /^127\./.test(host)
}

/** "PROXY host:port" 里的账号密码（少数 PAC 会返回）转成 undici 的认证参数 */
function proxyAuth(url: URL): { token?: string; username?: string; password?: string } {
  if (!url.username && !url.password) return {}
  const username = decodeURIComponent(url.username)
  const password = decodeURIComponent(url.password)
  return {
    token: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    username,
    password
  }
}

function proxyDispatcher(scheme: string, address: string): Dispatcher {
  const lower = scheme.toLowerCase()
  const isSocks = lower === 'socks5' || lower === 'socks'
  const key = isSocks ? `socks5://${address}` : `${lower === 'https' ? 'https' : 'http'}://${address}`
  let agent = agents.get(key)
  if (!agent) {
    const parsed = new URL(key)
    const auth = proxyAuth(parsed)
    // 去掉 URL 里的账号密码，统一走 token / username / password，避免不同版本行为不一致
    parsed.username = ''
    parsed.password = ''
    if (isSocks) {
      agent = new Socks5ProxyAgent(parsed.toString(), {
        ...(auth.username ? { username: auth.username } : {}),
        ...(auth.password ? { password: auth.password } : {})
      })
    } else {
      agent = new ProxyAgent({
        uri: parsed.toString(),
        ...(auth.token ? { token: auth.token } : {})
      })
    }
    agents.set(key, agent)
  }
  return agent
}

/** "PROXY 127.0.0.1:7890; DIRECT" / "SOCKS5 127.0.0.1:1080" → 按顺序返回可用线路，并记下 DIRECT 兜底 */
function parseProxies(proxyText: string): ProxyPlan {
  const dispatchers: Dispatcher[] = []
  const seen = new Set<string>()
  let direct = false
  for (const part of proxyText.split(';')) {
    const token = part.trim()
    if (!token) continue
    // PAC 明确给了 DIRECT：代理线路全部失败时按规则回落直连，而不是直接报错
    if (token.toUpperCase() === 'DIRECT') {
      direct = true
      continue
    }
    const match = /^(PROXY|HTTPS|SOCKS5|SOCKS)\s+(\S+)$/i.exec(token)
    if (!match) continue
    const key = `${match[1].toUpperCase()} ${match[2]}`
    if (seen.has(key)) continue
    seen.add(key)
    try {
      dispatchers.push(proxyDispatcher(match[1], match[2]))
    } catch {
      // 单条代理地址解析失败时跳过，继续尝试下一条
    }
  }
  return { dispatchers, direct }
}

async function planFor(url: string): Promise<ProxyPlan> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { dispatchers: [], direct: true }
  }
  const key = parsed.origin
  const hit = originCache.get(key)
  if (hit && Date.now() - hit.at < RESOLVE_TTL_MS) return hit.plan
  let plan: ProxyPlan = { dispatchers: [], direct: true }
  try {
    if (!app.isReady()) await app.whenReady()
    plan = parseProxies(await session.defaultSession.resolveProxy(url))
  } catch {
    plan = { dispatchers: [], direct: true }
  }
  originCache.set(key, { at: Date.now(), plan })
  return plan
}

/** 替换主进程全局 fetch：直连沿用 Node 原实现，只有命中系统代理才换 dispatcher */
export function installSystemProxyFetch(): void {
  if (installed) return
  installed = true
  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ) => {
    const url = urlOf(input)
    if (!url) return nodeFetch(input, init)
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return nodeFetch(input, init)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return nodeFetch(input, init)
    if (isLocalHost(parsed.hostname)) return nodeFetch(input, init)

    const key = parsed.origin
    let plan = await planFor(url)
    let lastError: unknown = null

    const run = async (list: Dispatcher[]): Promise<Response | null> => {
      for (const dispatcher of list) {
        try {
          const response = (await undiciFetch(input as never, {
            ...(init ?? {}),
            dispatcher
          } as never)) as unknown as Response
          // 407 = 代理要认证且当前线路凭证不可用：换下一条代理，而不是把 407 当成业务响应
          if (response.status === 407) {
            await response.body?.cancel().catch(() => undefined)
            lastError = new Error('代理认证失败')
            continue
          }
          return response
        } catch (err) {
          lastError = err
        }
      }
      return null
    }

    let response = await run(plan.dispatchers)
    if (response) return response
    if (plan.dispatchers.length) {
      // 系统代理刚切换 / 某条线路暂时不可用：清缓存重新解析后再试一轮
      originCache.delete(key)
      plan = await planFor(url)
      response = await run(plan.dispatchers)
      if (response) return response
      // PAC 写了 DIRECT（或重新解析后已无代理）：按规则回落直连
      if (plan.direct || plan.dispatchers.length === 0) return nodeFetch(input, init)
      // 只剩代理线路且全部失败：保留原始错误，避免静默绕过代理
      if (lastError) throw lastError
    }
    return nodeFetch(input, init)
  }) as typeof fetch
}
