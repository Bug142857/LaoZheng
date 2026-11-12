/** 硬件（原「电脑信息」）——主进程采集后按条目返回给渲染进程 */
export interface SystemInfoEntry {
  key: string
  label: string
  lines: string[]
}

export interface SystemInfoResult {
  ok: boolean
  entries: SystemInfoEntry[]
  error?: string
  collectedAt: number
}
