/** 更新检查结果（公开更新清单 / GitHub Releases） */
export interface UpdateCheckResult {
  ok: boolean
  current: string
  latest?: string
  hasUpdate?: boolean
  url?: string
  /** 安装包直链（清单里给出时支持应用内静默下载安装） */
  downloadUrl?: string
  notes?: string
  error?: string
  /** 本次实际走通的线路名（直连 / gh-proxy / ghproxy） */
  line?: string
}

export interface UpdateProgress {
  received: number
  total: number
  percent: number
  /** 当前下载使用的线路名 */
  line?: string
  /** 实时下载速度（字节 / 秒）；测速、暂停、完成时为 0 */
  speed?: number
  /** selecting = 正在测速选线，downloading = 已选定线路开始下载 */
  phase?: 'selecting' | 'downloading'
  /** 是否处于暂停状态（暂停时进度条保留，可继续 / 取消） */
  paused?: boolean
  /** 下载失败 / 已取消原因；有值表示本条是结束事件，界面应隐藏进度条 */
  error?: string
}

/** 更新包下载速度文案 */
export function formatUpdateSpeed(speed?: number): string {
  if (!speed || !Number.isFinite(speed) || speed <= 0) return ''
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let value = speed
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[index]}`
}

export interface UpdateDownloadResult {
  ok: boolean
  path?: string
  error?: string
  /** 用户主动取消下载（不算失败，不弹错误框） */
  canceled?: boolean
}

/** 语义化版本比较：a > b 返回 1，相等 0，小于 -1 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/i, '')
      .split(/[.-]/)
      .map((p) => Number.parseInt(p, 10))
      .map((n) => (Number.isFinite(n) ? n : 0))
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const xi = x[i] ?? 0
    const yi = y[i] ?? 0
    if (xi > yi) return 1
    if (xi < yi) return -1
  }
  return 0
}
