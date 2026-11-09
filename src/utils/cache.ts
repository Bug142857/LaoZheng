/**
 * 模块列表缓存：把各模块的列表数据落到 localStorage，
 * 下次打开应用 / 切回模块时先显示上次内容，不再每次都重新请求。
 * 只缓存列表与分类这类可重建的数据，不碰收藏、清单等用户数据。
 */

const PREFIX = 'laozheng.cache.v1.'

export function loadCache<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(fallback)) {
      return (Array.isArray(parsed) ? parsed : fallback) as T
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      fallback &&
      typeof fallback === 'object' &&
      !Array.isArray(fallback)
    ) {
      // 按 fallback 逐字段校验类型：旧版本 / 损坏缓存里的 items 不是数组时直接丢弃该字段
      const base: Record<string, unknown> = { ...(fallback as Record<string, unknown>) }
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!(key in base)) {
          base[key] = value
          continue
        }
        const expected = base[key]
        if (Array.isArray(expected)) {
          if (Array.isArray(value)) base[key] = value
        } else if (expected === null || expected === undefined) {
          base[key] = value
        } else if (typeof expected === typeof value) {
          base[key] = value
        }
      }
      return base as T
    }
    return fallback
  } catch {
    return fallback
  }
}

export function saveCache<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // 存储空间不足 / 隐私模式时静默跳过
  }
}

/** 删除单个模块的列表缓存（点页面标题刷新时回到真正的默认页） */
export function clearCache(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key)
  } catch {
    // localStorage 不可用时忽略
  }
}

/** 清理缓存：把各模块落地的列表缓存一起清掉，下次进入重新请求 */
export function clearModuleCaches(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    for (const key of keys) window.localStorage.removeItem(key)
  } catch {
    // localStorage 不可用时忽略
  }
}
