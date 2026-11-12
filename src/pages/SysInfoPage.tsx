import { useEffect, useRef, useState } from 'react'
import {
  CircuitBoard,
  Computer,
  Cpu,
  HardDrive,
  Laptop,
  MemoryStick,
  Monitor,
  MonitorCog,
  Volume2,
  Wifi,
  type LucideIcon
} from 'lucide-react'
import { EmptyState, LoadingBlock } from '../components/ui'
import type { SystemInfoResult } from '../shared/sysinfo'

const ICONS: Record<string, LucideIcon> = {
  model: Computer,
  os: Laptop,
  cpu: Cpu,
  board: CircuitBoard,
  memory: MemoryStick,
  gpu: MonitorCog,
  monitor: Monitor,
  disk: HardDrive,
  audio: Volume2,
  network: Wifi
}

export function SysInfoPage({
  onNotice,
  resetSignal,
  forceSignal
}: {
  onNotice: (text: string) => void
  resetSignal?: number
  /** 点页面标题时递增：忽略缓存重新采集 */
  forceSignal?: number
}) {
  const [result, setResult] = useState<SystemInfoResult | null>(null)
  const [loading, setLoading] = useState(true)
  const lastForce = useRef(0)

  const load = (force = false) => {
    setLoading(true)
    window.laozheng
      .systemInfo(force)
      .then((value) => {
        setResult(value)
        if (!value.ok) onNotice(`读取硬件信息失败：${value.error ?? '未知错误'}`)
      })
      .catch((err: unknown) => {
        const message = (err as Error).message
        setResult({ ok: false, entries: [], error: message, collectedAt: Date.now() })
        onNotice(`读取硬件信息失败：${message}`)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const force = (forceSignal ?? 0) !== lastForce.current
    lastForce.current = forceSignal ?? 0
    load(force)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal, forceSignal])

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">硬件</h1>
      </header>

      {loading ? (
        <LoadingBlock text="正在读取本机硬件信息…" />
      ) : !result?.ok ? (
        <EmptyState
          title="读取硬件信息失败"
          desc={result?.error ?? '请稍后重试'}
          action={
            <button className="btn" onClick={() => load(true)}>
              重试
            </button>
          }
        />
      ) : (
        <div className="sysinfo-grid">
          {result.entries.map((entry) => {
            const Icon = ICONS[entry.key] ?? Computer
            return (
              <section className="sysinfo-card" key={entry.key}>
                <div className="sysinfo-card-head">
                  <span className="sysinfo-card-icon">
                    <Icon size={18} strokeWidth={1.9} />
                  </span>
                  <span className="sysinfo-card-label">{entry.label}</span>
                </div>
                <div className="sysinfo-card-lines">
                  {entry.lines.map((line, index) => (
                    <div className="sysinfo-line" key={`${entry.key}-${index}`}>
                      {line}
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
