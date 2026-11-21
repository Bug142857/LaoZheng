import { useEffect, useState } from 'react'
import { AppWindow, FileText, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import type { LocalShortcut } from '../shared/types'
import { useData } from '../state/DataContext'
import { ConfirmDialog, Modal } from './ui'

const KIND_ICONS = {
  app: AppWindow,
  folder: FolderOpen,
  file: FileText
} as const

/** 本机图标按路径缓存（含读取失败），切换模块 / 重渲染不重复取 */
const iconCache = new Map<string, string | null>()

/** 优先用系统真实图标，取不到时回退到类型图标；文件夹图标系统返回不可靠（常变成盘符 / 空文件图标），统一用类型图标 */
function ShortcutIcon({ item }: { item: LocalShortcut }) {
  const [icon, setIcon] = useState<string | null>(() =>
    item.kind === 'folder' ? null : (iconCache.get(item.path) ?? null)
  )

  useEffect(() => {
    // 文件夹不走系统图标：Windows 下 app.getFileIcon 对目录经常返回盘符或空白文件图标
    if (item.kind === 'folder') {
      setIcon(null)
      return
    }
    const cached = iconCache.get(item.path)
    if (cached !== undefined) {
      setIcon(cached)
      return
    }
    let alive = true
    setIcon(null)
    void window.laozheng
      .fileIcon(item.path)
      .then((res) => {
        const next = res.ok && res.icon ? res.icon : null
        iconCache.set(item.path, next)
        if (alive) setIcon(next)
      })
      .catch(() => {
        iconCache.set(item.path, null)
      })
    return () => {
      alive = false
    }
  }, [item.path, item.kind])

  const Icon = KIND_ICONS[item.kind] ?? FolderOpen
  return (
    <span
      className={`local-shortcut-icon ${
        item.kind === 'app' ? 'kind-app' : item.kind
      }${icon ? ' has-image' : ''}`}
    >
      {icon ? <img src={icon} alt="" draggable={false} /> : <Icon size={26} />}
    </span>
  )
}

function baseName(target: string): string {
  return target.split(/[\\/]/).filter(Boolean).pop() ?? target
}

/** 可按应用方式打开的可执行 / 快捷方式后缀 */
function isAppPath(target: string): boolean {
  return /\.(exe|lnk|bat|cmd|msi|url|com|ps1)$/i.test(baseName(target))
}

function guessKind(target: string): LocalShortcut['kind'] {
  const trimmed = target.trim()
  // 以分隔符结尾一定是文件夹
  if (/[\\/]$/.test(trimmed)) return 'folder'
  if (isAppPath(trimmed)) return 'app'
  // 只有「点 + 2~8 位扩展名」才当文件；D:\项目\v1.2 这类带点的目录仍按文件夹处理
  return /\.([A-Za-z0-9]{2,8})$/.test(baseName(trimmed)) ? 'file' : 'folder'
}

/**
 * 主页「本地」快捷入口：把本机应用 / 文件夹 / 文件路径放到主页，
 * 点卡片用系统默认方式打开；路径随 data.json 进备份与云同步。
 */
export function LocalShortcutsSection({ onNotice }: { onNotice: (text: string) => void }) {
  const { data, update } = useData()
  const items = data.localShortcuts
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<LocalShortcut | null>(null)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<LocalShortcut | null>(null)

  const closeDraft = () => {
    setDraft(null)
    setEditingId(null)
    setError('')
  }

  const startAdd = () => {
    setEditingId(null)
    setDraft({
      id: `local_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: '',
      path: '',
      kind: 'folder'
    })
    setError('')
  }

  const startEdit = (item: LocalShortcut) => {
    setEditingId(item.id)
    setDraft({ ...item })
    setError('')
  }

  const pick = async (mode: 'file' | 'folder'): Promise<void> => {
    try {
      const res = await window.laozheng.pickLocalPath(mode)
      const target = res.path
      if (res.canceled || !target) return
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              path: target,
              name: prev.name.trim() ? prev.name : baseName(target),
              // 用「选择应用或文件」时明确是文件，不能再按扩展名猜成文件夹（如无后缀文件）
              kind: mode === 'folder' ? 'folder' : isAppPath(target) ? 'app' : 'file'
            }
          : prev
      )
    } catch {
      onNotice('选择路径失败')
    }
  }

  const save = () => {
    if (!draft) return
    const name = draft.name.trim()
    const target = draft.path.trim()
    if (!name) {
      setError('请填写名称')
      return
    }
    if (!target) {
      setError('请选择或填写路径')
      return
    }
    const item: LocalShortcut = { ...draft, name: name.slice(0, 60), path: target }
    update((d) => ({
      ...d,
      localShortcuts: editingId
        ? d.localShortcuts.map((entry) => (entry.id === editingId ? item : entry))
        : [...d.localShortcuts, item]
    }))
    closeDraft()
  }

  const open = async (item: LocalShortcut): Promise<void> => {
    try {
      const res = await window.laozheng.openLocalPath(item.path)
      if (!res.ok) onNotice(res.error ?? '打开失败，路径可能已被移动')
    } catch {
      onNotice('打开失败')
    }
  }

  const remove = () => {
    if (!removing) return
    update((d) => ({
      ...d,
      localShortcuts: d.localShortcuts.filter((entry) => entry.id !== removing.id)
    }))
    setRemoving(null)
  }

  return (
    <>
      <section className="tool-group">
        <div className="tool-group-head">
          <FolderOpen size={15} />
          <h2>本地</h2>
          <span className="tool-group-count">{items.length}</span>
          <div className="home-fav-actions">
            <button className="btn ghost home-fav-more" onClick={startAdd}>
              <Plus size={14} /> 添加
            </button>
          </div>
        </div>
        {items.length ? (
          <div className="local-shortcut-grid">
            {items.map((item) => (
              <div
                key={item.id}
                className="local-shortcut-item"
                title={item.path}
                onClick={() => void open(item)}
              >
                <ShortcutIcon item={item} />
                <span className="local-shortcut-name">{item.name}</span>
                <div className="local-shortcut-actions">
                  <button
                    className="icon-btn"
                    title="编辑"
                    onClick={(e) => {
                      e.stopPropagation()
                      startEdit(item)
                    }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title="删除"
                    onClick={(e) => {
                      e.stopPropagation()
                      setRemoving(item)
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="settings-hint">
            还没有本地快捷方式，点右上角「添加」把常用应用或文件夹放进来。
          </div>
        )}
      </section>

      {draft ? (
        <Modal
          title={editingId ? '编辑本地快捷方式' : '添加本地快捷方式'}
          onClose={closeDraft}
          footer={
            <>
              <button className="btn ghost" onClick={closeDraft}>
                取消
              </button>
              <button className="btn primary" onClick={save}>
                保存
              </button>
            </>
          }
        >
          <div className="local-shortcut-form">
            <label>
              <span>名称</span>
              <input
                autoFocus
                value={draft.name}
                placeholder="例如：微信 / 工作文件夹"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              <span>路径</span>
              <input
                value={draft.path}
                placeholder="C:\Program Files\…"
                onChange={(e) =>
                  setDraft({ ...draft, path: e.target.value, kind: guessKind(e.target.value) })
                }
              />
            </label>
            <div className="local-shortcut-picks">
              <button className="btn ghost" onClick={() => void pick('file')}>
                <AppWindow size={14} /> 选择应用或文件
              </button>
              <button className="btn ghost" onClick={() => void pick('folder')}>
                <FolderOpen size={14} /> 选择文件夹
              </button>
            </div>
            {error ? <div className="local-shortcut-error">{error}</div> : null}
          </div>
        </Modal>
      ) : null}

      {removing ? (
        <ConfirmDialog
          title="删除本地快捷方式"
          message={`确定删除「${removing.name}」？只会删除这里的入口，不会删除本机文件。`}
          confirmText="删除"
          danger
          onConfirm={remove}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </>
  )
}
