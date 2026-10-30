import { useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Download, Heart } from 'lucide-react'
import { tileGradient } from '../utils/data'

export function EmptyState({
  title,
  desc,
  action
}: {
  title: string
  desc?: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {desc ? <div className="empty-desc">{desc}</div> : null}
      {action}
    </div>
  )
}

/** 清单封面：内部封面拼图（1 张铺满，2/3/4 张分格），没有封面时退回名称色块 */
export function ListCoverMosaic({
  covers,
  name,
  className = ''
}: {
  covers: string[]
  name: string
  className?: string
}) {
  if (!covers.length) {
    return (
      <span className={`tile-cover ${className}`} style={{ background: tileGradient(name) }}>
        {name.slice(0, 4)}
      </span>
    )
  }
  const shown = covers.slice(0, 4)
  return (
    <span className={`tile-cover mosaic mosaic-${shown.length} ${className}`}>
      {shown.map((src, index) => (
        <img key={`${src}-${index}`} src={src} alt="" loading="lazy" />
      ))}
    </span>
  )
}

/**
 * 模块右上角的「收藏 / 下载」快捷入口：
 * 除了首页、清单、设置，其余模块都通过它跳到对应模块的收藏与下载分区。
 */
export function ModuleShortcuts({
  onOpenFavorites,
  onOpenDownloads
}: {
  onOpenFavorites?: () => void
  onOpenDownloads?: () => void
}) {
  if (!onOpenFavorites && !onOpenDownloads) return null
  return (
    <>
      {onOpenFavorites ? (
        <button className="icon-btn header-shortcut" title="打开对应收藏" onClick={onOpenFavorites}>
          <Heart size={17} />
        </button>
      ) : null}
      {onOpenDownloads ? (
        <button className="icon-btn header-shortcut" title="打开对应下载" onClick={onOpenDownloads}>
          <Download size={17} />
        </button>
      ) : null}
    </>
  )
}

/** 切换分类 / 翻页时的「请稍等」动画，界面还没变化前先给反馈 */
export function LoadingBlock({ text = '请稍等…' }: { text?: string }) {
  return (
    <div className="loading-block">
      <span className="spinner" />
      <span>{text}</span>
    </div>
  )
}

/**
 * 通用分页器：当前页附近最多 5 个可直接点的页码，支持首页 / 尾页与手填跳转。
 * lastPage = 0 表示站点没有可靠的末页（如 P站），此时隐藏尾页。
 */
export function Pagination({
  page,
  lastPage = 0,
  hasMore,
  disabled = false,
  showLast = true,
  onLast,
  onChange
}: {
  page: number
  lastPage?: number
  hasMore?: boolean
  disabled?: boolean
  showLast?: boolean
  /** 末页未知时（如漫画最近/热门）由调用方探测最后一页 */
  onLast?: () => void
  onChange: (page: number) => void
}) {
  const [jump, setJump] = useState('')
  const total = lastPage > 0 ? lastPage : 0

  const pages = useMemo(() => {
    const current = Math.max(1, page)
    let start = Math.max(1, current - 2)
    let end = start + 4
    if (total > 0) {
      end = Math.min(total, end)
      start = Math.max(1, end - 4)
    }
    const out: number[] = []
    for (let i = start; i <= end; i++) out.push(i)
    return out
  }, [page, total])

  /** 翻页后立刻回到顶部（内容区是 .content；再补两帧，避免列表重渲染把位置带回去） */
  const scrollToTop = () => {
    const scroller = document.querySelector<HTMLElement>('.content')
    const apply = () => {
      if (scroller) scroller.scrollTop = 0
      if (window.scrollY) window.scrollTo(0, 0)
    }
    apply()
    window.setTimeout(apply, 0)
    window.setTimeout(apply, 120)
  }

  const go = (next: number) => {
    if (disabled) return
    const target = Math.max(1, total > 0 ? Math.min(total, next) : next)
    if (target !== page) {
      onChange(target)
      scrollToTop()
    }
  }

  const submitJump = () => {
    const value = Number.parseInt(jump, 10)
    if (!Number.isFinite(value) || value < 1) return
    go(value)
    setJump('')
  }

  const nextDisabled = disabled || (total > 0 ? page >= total : hasMore === false)

  return (
    <div className="pagination">
      <button className="btn" disabled={disabled || page <= 1} onClick={() => go(1)}>
        首页
      </button>
      <button
        className="icon-btn page-step"
        title="上一页"
        disabled={disabled || page <= 1}
        onClick={() => go(page - 1)}
      >
        <ChevronLeft size={15} />
      </button>
      {pages.map((n) => (
        <button
          key={n}
          className={`chip page-num ${n === page ? 'active' : ''}`}
          disabled={disabled}
          onClick={() => go(n)}
        >
          {n}
        </button>
      ))}
      <button
        className="icon-btn page-step"
        title="下一页"
        disabled={nextDisabled}
        onClick={() => go(page + 1)}
      >
        <ChevronRight size={15} />
      </button>
      {showLast && (total > 0 || onLast) ? (
        <button
          className="btn"
          disabled={disabled || (total > 0 && page >= total)}
          onClick={() => {
            if (onLast) {
              onLast()
              scrollToTop()
            } else {
              go(total)
            }
          }}
        >
          尾页
        </button>
      ) : null}
      <span className="page-jump">
        第 {page} 页{total > 0 ? ` / 共 ${total} 页` : ''}
      </span>
      <span className="page-jump-box">
        <input
          type="number"
          min={1}
          max={total > 0 ? total : undefined}
          value={jump}
          placeholder="页码"
          onChange={(e) => setJump(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitJump()
          }}
        />
        <button className="btn" disabled={disabled || !jump.trim()} onClick={submitJump}>
          跳转
        </button>
      </span>
    </div>
  )
}

export function Modal({
  title,
  children,
  onClose,
  footer
}: {
  title: string
  children?: ReactNode
  onClose: () => void
  footer: ReactNode
}) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
        <div className="modal-actions">{footer}</div>
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmText = '确定',
  danger = false,
  onConfirm,
  onCancel
}: {
  title: string
  message: string
  confirmText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn ghost" onClick={onCancel}>
            取消
          </button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {confirmText}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  )
}

export function PromptDialog({
  title,
  placeholder,
  initial = '',
  confirmText = '确定',
  onConfirm,
  onCancel
}: {
  title: string
  placeholder?: string
  initial?: string
  confirmText?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const submit = () => {
    const v = value.trim()
    if (v) onConfirm(v)
  }
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn ghost" onClick={onCancel}>
            取消
          </button>
          <button className="btn primary" disabled={!value.trim()} onClick={submit}>
            {confirmText}
          </button>
        </>
      }
    >
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onCancel()
        }}
      />
    </Modal>
  )
}
