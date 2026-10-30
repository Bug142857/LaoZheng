import type { ReactNode } from 'react'
import { Search, X } from 'lucide-react'

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
  extra
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
  extra?: ReactNode
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
      {extra}
    </form>
  )
}
