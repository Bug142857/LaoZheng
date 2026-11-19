import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'

export interface VirtualRowItem {
  key: string
  node: ReactNode
}

/**
 * 固定行高的窗口化列表：只渲染视口附近的若干行，
 * 通过上下 padding 撑出完整滚动高度，长清单不会把几千条全部挂到 DOM。
 * 行高与 `.row`（10px 上下内边距 + 56px 封面 + 1px 边框）保持一致。
 */
export function VirtualRows({
  items,
  className,
  rowHeight = 77,
  overscan = 6,
  threshold = 80
}: {
  items: VirtualRowItem[]
  className?: string
  rowHeight?: number
  overscan?: number
  /** 少于该条数时不做窗口化，避免小列表出现空白跳动 */
  threshold?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const enabledRef = useRef(false)
  const [enabled, setEnabled] = useState(false)
  const [range, setRange] = useState({ start: 0, end: items.length })
  const rangeRef = useRef(range)
  rangeRef.current = range

  const compute = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (!items.length) {
      setRange((prev) => (prev.start === 0 && prev.end === 0 ? prev : { start: 0, end: 0 }))
      return
    }
    const scroller = el.closest('.content') as HTMLElement | null
    if (!scroller) return
    const scrollerRect = scroller.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const top = elRect.top - scrollerRect.top + scroller.scrollTop
    const viewTop = scroller.scrollTop
    const viewBottom = viewTop + scroller.clientHeight
    let start = Math.floor((viewTop - top) / rowHeight) - overscan
    let end = Math.ceil((viewBottom - top) / rowHeight) + overscan
    // 列表缩短后旧滚动位置可能落在末尾之外：把窗口夹回合法范围，避免空白
    start = Math.max(0, Math.min(start, items.length - 1))
    end = Math.min(items.length, Math.max(start + 1, end))
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [items.length, overscan, rowHeight])

  useLayoutEffect(() => {
    if (items.length > threshold) {
      if (!enabledRef.current) {
        enabledRef.current = true
        setEnabled(true)
        // 首次启用先给一小段窗口，避免先整表渲染一帧
        setRange({ start: 0, end: Math.min(items.length, 60) })
        return
      }
      // 已经启用时条目增减不要跳回顶部：按当前滚动位置重算窗口，
      // 否则追加数据 / 新增条目会把正在浏览的位置打断
      if (items.length <= rangeRef.current.start) {
        // 列表大幅缩短（筛选 / 删除）后原窗口已越界，回到顶部重新开始
        setRange({ start: 0, end: Math.min(items.length, 60) })
        return
      }
      compute()
    } else {
      enabledRef.current = false
      setEnabled(false)
      setRange({ start: 0, end: items.length })
    }
  }, [items.length, threshold, compute])

  useEffect(() => {
    if (!enabled) return
    const el = containerRef.current
    const scroller = el?.closest('.content') as HTMLElement | null
    if (!scroller) return
    compute()
    scroller.addEventListener('scroll', compute, { passive: true })
    const observer = new ResizeObserver(compute)
    observer.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', compute)
      observer.disconnect()
    }
  }, [enabled, compute])

  if (!enabled) {
    return (
      <div className={className}>
        {items.map((item) => (
          <Fragment key={item.key}>{item.node}</Fragment>
        ))}
      </div>
    )
  }

  const before = range.start * rowHeight
  const after = Math.max(0, (items.length - range.end) * rowHeight)
  return (
    <div ref={containerRef} className={className}>
      <div style={{ height: before }} aria-hidden />
      {items.slice(range.start, range.end).map((item) => (
        <div key={item.key} className="virtual-row" style={{ height: rowHeight }}>
          {item.node}
        </div>
      ))}
      <div style={{ height: after }} aria-hidden />
    </div>
  )
}
