import { useState, type ReactNode } from 'react'

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
