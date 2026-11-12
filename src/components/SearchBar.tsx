import type { ReactNode } from 'react'
import { RefreshCw, Search, X } from 'lucide-react'

/**
 * 统一的搜索栏：
 * - 有内容时输入框右侧出现 ✕，点一下清空并恢复默认列表；
 * - 正在搜索时按钮变成「取消」，再点一次就停止本次搜索。
 */
export function SearchBar({
  value,
  onChange,
  onSubmit,
  onCancel,
  onClear,
  searching = false,
  placeholder = '搜索…',
  disabled = false,
  submitLabel = '搜索',
  leading,
  extra,
  onRefresh,
  refreshing = false,
  refreshDisabled = false
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel?: () => void
  onClear?: () => void
  searching?: boolean
  placeholder?: string
  disabled?: boolean
  submitLabel?: string
  /** 搜索框前面的附加控件，例如片源 / 资源库选择 */
  leading?: ReactNode
  extra?: ReactNode
  /** 搜索栏右侧的刷新按钮：重新拉取当前页面的最新资源 */
  onRefresh?: () => void
  refreshing?: boolean
  refreshDisabled?: boolean
}) {
  return (
    <form
      className="toolbar"
      onSubmit={(e) => {
        e.preventDefault()
        if (searching) {
          onCancel?.()
          return
        }
        onSubmit()
      }}
    >
      {leading}
      <label className="search">
        <Search size={16} />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        {value ? (
          <button
            type="button"
            className="search-clear"
            title="清空"
            onClick={() => {
              onChange('')
              onClear?.()
            }}
          >
            <X size={14} />
          </button>
        ) : null}
      </label>
      <button
        className={`btn ${searching ? '' : 'primary'}`}
        type="submit"
        disabled={disabled || (!searching && !value.trim())}
      >
        {searching ? (onCancel ? '取消搜索' : '搜索中…') : submitLabel}
      </button>
      {onRefresh ? (
        <button
          className="btn btn-sq"
          type="button"
          title="刷新到最新资源"
          aria-label="刷新到最新资源"
          disabled={refreshing || refreshDisabled}
          onClick={onRefresh}
        >
          <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
        </button>
      ) : null}
      {extra}
    </form>
  )
}
