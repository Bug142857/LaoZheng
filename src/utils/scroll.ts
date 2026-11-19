import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * 模块内「列表 → 详情」的滚动位置记忆。
 *
 * 全局返回栈只处理模块之间的跳转；各模块的列表 / 详情切换是页内状态，
 * 详情内容通常比列表短，浏览器会把 main.content 的 scrollTop 收敛到 0，
 * 返回列表时就丢了原来的位置。
 *
 * 列表可见期间持续记录滚动位置；详情打开时立即停止记录（避免把详情页的
 * 滚动写进来），关闭详情后等列表重新渲染再把位置恢复回去。
 */
export function useDetailScrollRestore(open: boolean, slotKey?: string): void {
  const savedRef = useRef(0)
  const wasOpenRef = useRef(open)

  /**
   * App 切回本模块时会把滚动位置重置为 0 / 上次位置，但浏览器有时不会派发
   * scroll 事件（滚动高度变化被静默夹取），只靠 scroll 会留下旧位置。
   * 这里始终监听 App 的恢复事件，即使详情正打开也同步：
   * 快速切走再回来时，详情关闭后应该恢复到重新进入的位置（通常是 0）。
   */
  useEffect(() => {
    const onRestored = (event: Event): void => {
      const detail = (event as CustomEvent<{ key?: string; top?: number }>).detail
      if (slotKey && detail?.key !== slotKey) return
      const owner = slotKey
        ? document.querySelector<HTMLElement>(`[data-page-slot="${slotKey}"]`)
        : null
      if (owner && owner.style.display === 'none') return
      const el = document.querySelector<HTMLElement>('main.content')
      if (!el) return
      savedRef.current = typeof detail?.top === 'number' ? detail.top : el.scrollTop
    }
    window.addEventListener('laozheng:page-scroll-restored', onRestored)
    return () => window.removeEventListener('laozheng:page-scroll-restored', onRestored)
  }, [slotKey])

  useLayoutEffect(() => {
    if (open) return
    const el = document.querySelector<HTMLElement>('main.content')
    if (!el) return
    // 常驻挂载的页面被切走后仍在 DOM 里：如果不过滤，
    // 其他模块滚动时会把位置记进本页，返回后再打开详情就恢复到错误位置
    const owner = slotKey
      ? document.querySelector<HTMLElement>(`[data-page-slot="${slotKey}"]`)
      : null
    const onScroll = (): void => {
      if (owner && owner.style.display === 'none') return
      savedRef.current = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [open, slotKey])

  useLayoutEffect(() => {
    if (open) {
      wasOpenRef.current = true
      return
    }
    if (!wasOpenRef.current) return
    wasOpenRef.current = false
    const top = savedRef.current
    const owner = slotKey
      ? document.querySelector<HTMLElement>(`[data-page-slot="${slotKey}"]`)
      : null
    const startedAt = Date.now()
    let timer = 0
    const restore = (): void => {
      timer = 0
      // 页面已经被切走时停止重试，避免抢写新页面的滚动位置
      if (owner && owner.style.display === 'none') return
      const target = document.querySelector<HTMLElement>('main.content')
      if (!target) return
      target.scrollTop = top
      // 列表异步重新加载时内容高度还不够，短时间内重试几次
      if (Math.abs(target.scrollTop - top) > 2 && Date.now() - startedAt < 800) {
        timer = window.setTimeout(restore, 60)
      }
    }
    restore()
    return () => {
      if (timer) window.clearTimeout(timer)
    }
  }, [open, slotKey])
}
