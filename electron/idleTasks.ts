import { net } from 'electron'
import { bikaEnsureLogin } from './bika'
import { komiicEnsureLogin } from './komiic'
import { wygamerEnsureLogin } from './wygamer'
import { autoZlibLogin } from './zlib'

/**
 * 启动流程拆分：内置账号的静默登录不阻塞首屏。
 * 延迟 10 秒空闲执行；离线时直接跳过，避免反复创建隐藏窗口并等待超时。
 * 用户真正进入对应模块时，各页面仍会自行触发登录。
 */
export function scheduleIdleAccountChecks(delayMs = 10_000): NodeJS.Timeout {
  const timer = setTimeout(() => {
    if (!net.isOnline()) {
      console.log('[app] 当前离线，跳过启动后的账号静默登录')
      return
    }
    void bikaEnsureLogin().catch((err) => console.error('[app] 哔咔静默登录失败', err))
    void komiicEnsureLogin().catch((err) => console.error('[app] Komiic 静默登录失败', err))
    void wygamerEnsureLogin().catch((err) => console.error('[app] 无忧静默登录失败', err))
    // Z-Library：有保存账密时静默自动登录（失败不打扰用户）
    void autoZlibLogin().catch((err) => console.error('[app] Z-Library 静默登录失败', err))
  }, delayMs)
  timer.unref?.()
  return timer
}
