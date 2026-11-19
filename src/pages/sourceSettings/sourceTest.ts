/** 源测试结果的延迟显示与测速封装，供 SourceSettings 与各源弹窗共用 */

/** 测试结果后追加真实访问延迟（ms）；测不到延迟时只显示测试结果，不写「超时」误导 */
export function withMs(message: string, ms: number | null | undefined): string {
  return ms != null ? `${message} · ${Math.max(1, Math.round(ms))}ms` : message
}

/** 旧版本写进数据的「· 超时」在展示时去掉，避免测试成功却显示超时 */
export function testMsgText(message?: string | null): string {
  return (message ?? '未测试').replace(/\s*·\s*超时\s*$/, '')
}

export function probeLatency(url?: string | null): Promise<number | null | undefined> {
  if (!url || !/^https?:\/\//i.test(url)) return Promise.resolve(undefined)
  return window.laozheng.probeSourceLatency(url).catch(() => null)
}
