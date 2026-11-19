import type { ReactNode } from 'react'
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react'

/** 源配置卡片与优选排序的共用小组件 / 函数 */

export function sourceSummary(
  total: number,
  enabled: number,
  ok: number,
  bad: number
): string {
  return `共 ${total} 个 · 启用 ${enabled} · 有效 ${ok} · 无效 ${bad}`
}

/** 从测试文案末尾解析延迟（123ms）；没有测速结果返回 null */
export function sourceMs(source: { testMsg?: string | null }): number | null {
  const matched = /·\s*(\d+)ms\s*$/.exec(source.testMsg ?? '')
  return matched ? Number(matched[1]) : null
}

/** 0 = 有效（ok），1 = 未测试，2 = 无效；优选排序时无效源统一放最后 */
export function sourceGroup(source: { testStatus?: string | null }): number {
  if (source.testStatus === 'ok') return 0
  if (
    source.testStatus === 'bad' ||
    source.testStatus === 'failed' ||
    source.testStatus === 'dead'
  ) {
    return 2
  }
  return 1
}

/** 有效的源按测速延迟升序；未测试 / 无效的源保持原相对顺序排后面 */
export function byPreferredOrder<
  T extends { testMsg?: string | null; testStatus?: string | null }
>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const group = sourceGroup(a) - sourceGroup(b)
    if (group !== 0) return group
    if (sourceGroup(a) !== 0) return 0
    return (sourceMs(a) ?? Number.MAX_SAFE_INTEGER) - (sourceMs(b) ?? Number.MAX_SAFE_INTEGER)
  })
}

export function PreferredSortButton({
  disabled,
  onSort
}: {
  disabled?: boolean
  onSort: () => void
}) {
  return (
    <button
      className="btn"
      disabled={disabled}
      onClick={onSort}
      title="有效的源按测速延迟从快到慢排列，无效的排后面；对应模块的源下拉同步生效"
    >
      <ArrowUpDown size={15} /> 优选排序
    </button>
  )
}

/** 可折叠的源配置卡片：标题右侧统一显示 共 / 启用 / 有效 / 无效 */
export function SourceCard({
  title,
  summary,
  open,
  onToggle,
  children
}: {
  title: string
  summary: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className="settings-card">
      <button
        type="button"
        className="settings-card-toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        <h3>{title}</h3>
        <span className="settings-value">{summary}</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open ? <div style={{ marginTop: 10 }}>{children}</div> : null}
    </section>
  )
}
