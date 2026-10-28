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
}

export interface UpdateProgress {
  received: number
  total: number
  percent: number
}

export interface UpdateDownloadResult {
  ok: boolean
  path?: string
  error?: string
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
