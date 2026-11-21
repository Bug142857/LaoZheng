/** 源测试结果的延迟显示与测速封装，供 SourceSettings 与各源弹窗共用 */

/** 测试结果后追加真实访问延迟（ms）；测不到延迟时只显示测试结果，不写「超时」误导 */
export function withMs(message: string, ms: number | null | undefined): string {
  return ms != null ? `${message} · ${Math.max(1, Math.round(ms))}ms` : message
}

/** 旧版本写进数据的「· 超时」在展示时去掉，避免测试成功却显示超时 */
export function testMsgText(message?: string | null): string {
  return (message ?? '未测试').replace(/\s*·\s*超时\s*$/, '')
}

/** 测试是否成功：不同模块字段不统一，统一按 ok / status 判断 */
export function sourceTestOk(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const o = result as Record<string, unknown>
  return o.ok === true && o.status !== 'dead' && o.status !== 'proxy'
}

/** 失败原因像不像瞬时问题（超时 / 网络 / 5xx / 页面没返回），值得自动再试一次 */
function transientTestFailure(result: unknown): boolean {
  if (sourceTestOk(result)) return false
  if (!result || typeof result !== 'object') return true
  const o = result as Record<string, unknown>
  const text = `${String(o.error ?? '')} ${String(o.message ?? '')}`
  // 「需外网」是站点稳定状态，不是瞬时失败；重试只会白等一个超时
  if (/需外网/.test(text)) return false
  if (o.status === 'proxy') return true
  return /超时|连接|网络|timeout|econn|etimedout|http 5\d\d|\b5\d\d\b|失败|无法解析|没有返回|没有解析到|不可用|风控|验证/i.test(
    text
  )
}

export interface SourceTestRun<T> {
  result: T
  /** 本次测试实际耗时（含重试）；直接当作延迟显示，不再额外发探测请求 */
  ms: number
  retried: boolean
}

/** 被测模块：决定测试期间只旁路哪些接口缓存 key（避免拖慢同时浏览的其他模块） */
export type SourceTestModule =
  | 'vod'
  | 'drama'
  | 'novel'
  | 'comic'
  | 'trainer'
  | 'music'
  | 'live'
  | 'magnet'
  | 'wallpaper'
  | 'meitu'
  | 'shuangkan'

const TEST_CACHE_PREFIXES: Record<SourceTestModule, string[]> = {
  vod: ['vod:'],
  drama: ['drama:'],
  novel: ['novel:'],
  comic: ['comic:', 'bika:', 'komiic:', 'yumanhua:', 'bikahub:', 'tptoon:', 'jmcomic:'],
  trainer: ['trainers:'],
  music: ['music:'],
  live: ['live:'],
  magnet: ['magnet:'],
  wallpaper: ['wallpaper:'],
  meitu: ['meitu:'],
  shuangkan: ['shuangkan:']
}

/**
 * 执行一次源测试：
 * - 用测试请求本身的耗时作为延迟，避免每个源额外发一次最多 6 秒的探测请求；
 * - 第一次失败且像瞬时问题时自动等 500ms 再试一次，解决“再测一遍就有效”。
 */
export async function runSourceTest<T>(
  run: () => Promise<T>,
  okOf: (result: T) => boolean = sourceTestOk,
  module?: SourceTestModule
): Promise<SourceTestRun<T>> {
  const started = Date.now()
  const attempt = async (): Promise<T> => {
    // 每次测试前打开 15 秒缓存旁路：不读旧缓存，失败也不回退旧成功结果
    await window.laozheng
      .beginSourceTest(module ? TEST_CACHE_PREFIXES[module] : undefined)
      .catch(() => undefined)
    return run()
  }
  let first: T
  try {
    first = await attempt()
  } catch (err) {
    // 第一次直接异常也按瞬时失败处理，再给一次机会；第二次仍失败则交给调用方 catch
    await new Promise((resolve) => setTimeout(resolve, 500))
    const retried = await attempt()
    return { result: retried, ms: Date.now() - started, retried: true }
  }
  if (okOf(first) || !transientTestFailure(first)) {
    return { result: first, ms: Date.now() - started, retried: false }
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
  const second = await attempt()
  return { result: second, ms: Date.now() - started, retried: true }
}
