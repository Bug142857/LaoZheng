import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'

export interface VirtualMasonryItem {
  key: string
  node: ReactNode
  /** 图片原始尺寸：有值时按真实比例估算卡片高度，否则用 aspectRatio 兜底 */
  width?: number
  height?: number
}

interface LayoutItem {
  key: string
  top: number
  left: number
  width: number
  height: number
}

interface Layout {
  columns: number
  totalHeight: number
  items: LayoutItem[]
}

/**
 * 虚拟化瀑布流：按最短列分配卡片，只渲染视口附近的条目。
 * 条目不足 threshold 时退回普通 CSS 多列布局，保持小列表原有外观。
 */
export function VirtualMasonry({
  items,
  className,
  minColumnWidth = 230,
  gap = 14,
  aspectRatio = 9 / 16,
  footerHeight = 74,
  threshold = 40,
  overscan = 400
}: {
  items: VirtualMasonryItem[]
  className: string
  minColumnWidth?: number
  gap?: number
  /** 图片高度 / 宽度，没有原始尺寸时使用 */
  aspectRatio?: number
  /** 图片下方标题 / 信息区的估算高度 */
  footerHeight?: number
  threshold?: number
  overscan?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const [enabled, setEnabled] = useState(false)
  const [layout, setLayout] = useState<Layout>({ columns: 0, totalHeight: 0, items: [] })
  const [visible, setVisible] = useState({ start: 0, end: items.length })

  /**
   * 布局签名只由顺序、key 与图片尺寸决定：心形收藏、图片加载状态等节点变化
   * 不会改变签名，因此不必每次重渲染都重算整份瀑布流几何。
   * 几何数据与 items 按下标一一对应，渲染时直接取当前节点，不会用到旧节点。
   */
  const layoutKey = items
    .map((item) => `${item.key}:${item.width ?? 0}x${item.height ?? 0}`)
    .join('|')

  const buildLayout = useCallback(
    (list: VirtualMasonryItem[], width: number): Layout => {
      const columns = Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)))
      const columnWidth = Math.max(1, (width - gap * (columns - 1)) / columns)
      const tops = Array.from({ length: columns }, () => 0)
      const placed: LayoutItem[] = []
      for (const item of list) {
        const ratio =
          item.width && item.height && item.width > 0 && item.height > 0
            ? item.height / item.width
            : aspectRatio
        const height = Math.max(40, columnWidth * ratio + footerHeight)
        let column = 0
        for (let i = 1; i < columns; i += 1) {
          if (tops[i] < tops[column]) column = i
        }
        placed.push({
          key: item.key,
          top: tops[column],
          left: column * (columnWidth + gap),
          width: columnWidth,
          height
        })
        tops[column] += height + gap
      }
      return {
        columns,
        totalHeight: Math.max(0, Math.max(...tops) - gap),
        items: placed
      }
    },
    [aspectRatio, footerHeight, gap, minColumnWidth]
  )

  const computeVisible = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const scroller = el.closest('.content') as HTMLElement | null
    if (!scroller) return
    const scrollerRect = scroller.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const offset = elRect.top - scrollerRect.top + scroller.scrollTop
    const viewTop = scroller.scrollTop - offset
    const viewBottom = viewTop + scroller.clientHeight
    let start = 0
    let end = 0
    for (let i = 0; i < layout.items.length; i += 1) {
      const item = layout.items[i]
      if (item.top + item.height >= viewTop - overscan) {
        if (!end) start = i
        if (item.top <= viewBottom + overscan) end = i + 1
      }
    }
    if (!end && layout.items.length) {
      start = Math.max(0, layout.items.length - 1)
      end = layout.items.length
    }
    setVisible((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [layout.items, overscan])

  useLayoutEffect(() => {
    if (items.length <= threshold) {
      setEnabled(false)
      setLayout({ columns: 0, totalHeight: 0, items: [] })
      setVisible({ start: 0, end: items.length })
      return
    }
    const el = containerRef.current
    if (!el) return
    const width = el.clientWidth
    if (width <= 0) return
    setEnabled(true)
    setLayout(buildLayout(itemsRef.current, width))
    // items 每次渲染都是新数组，只按布局签名判断是否需要重建几何
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildLayout, layoutKey, items.length, threshold])

  useEffect(() => {
    if (!enabled) return
    const el = containerRef.current
    if (!el) return
    computeVisible()
    const scroller = el.closest('.content') as HTMLElement | null
    const onScroll = (): void => computeVisible()
    scroller?.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth
      if (width > 0) setLayout(buildLayout(itemsRef.current, width))
    })
    observer.observe(el)
    return () => {
      scroller?.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [buildLayout, computeVisible, enabled])

  return (
    <div
      ref={containerRef}
      className={enabled ? 'virtual-masonry' : className}
      style={enabled ? { height: layout.totalHeight } : undefined}
    >
      {enabled
        ? items.slice(visible.start, visible.end).map((item, offset) => {
            const geo = layout.items[visible.start + offset]
            if (!geo) return null
            return (
              <div
                key={item.key}
                className="virtual-masonry-item"
                style={{
                  top: geo.top,
                  left: geo.left,
                  width: geo.width,
                  height: geo.height
                }}
              >
                {item.node}
              </div>
            )
          })
        : items.map((item) => <Fragment key={item.key}>{item.node}</Fragment>)}
    </div>
  )
}
