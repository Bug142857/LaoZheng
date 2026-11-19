/** 优选地址延迟缓存：测过一次后重开弹窗直接显示上次的 ms，不再自动测速 */

export interface MirrorLatencyEntry {
  at: number
  mirrors: { url: string; ms: number | null }[]
}

const MIRROR_LATENCY_KEY = 'lz_mirror_latency_v1'

export function readMirrorLatency(key: string): MirrorLatencyEntry | null {
  try {
    const raw = localStorage.getItem(MIRROR_LATENCY_KEY)
    if (!raw) return null
    const all = JSON.parse(raw) as Record<string, MirrorLatencyEntry>
    const entry = all[key]
    return entry && Array.isArray(entry.mirrors) && entry.mirrors.length ? entry : null
  } catch {
    return null
  }
}

export function writeMirrorLatency(
  key: string,
  mirrors: { url: string; ms: number | null }[]
): void {
  try {
    const raw = localStorage.getItem(MIRROR_LATENCY_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, MirrorLatencyEntry>) : {}
    all[key] = { at: Date.now(), mirrors }
    localStorage.setItem(MIRROR_LATENCY_KEY, JSON.stringify(all))
  } catch {
    // 缓存失败不影响选择
  }
}
