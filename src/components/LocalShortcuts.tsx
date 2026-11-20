import { useState } from 'react'
import { AppWindow, FileText, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import type { LocalShortcut } from '../shared/types'
import { useData } from '../state/DataContext'
import { ConfirmDialog, Modal } from './ui'

const KIND_ICONS = {
  app: AppWindow,
  folder: FolderOpen,
  file: FileText
} as const

function baseName(target: string): string {
  return target.split(/[\\/]/).filter(Boolean).pop() ?? target
}

function guessKind(target: string): LocalShortcut['kind'] {
  const name = baseName(target)
  if (/\.(exe|lnk|bat|cmd|msi|url)$/i.test(name)) return 'app'
  return name.includes('.') ? 'file' : 'folder'
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
              kind: mode === 'folder' ? 'folder' : guessKind(target)
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
          <div className="tile-grid">
            {items.map((item) => {
              const Icon = KIND_ICONS[item.kind] ?? FolderOpen
              return (
                <div
                  key={item.id}
                  className="tile local-shortcut"
                  title={item.path}
                  onClick={() => void open(item)}
                >
                  <span className={`local-shortcut-icon ${item.kind}`}>
                    <Icon size={20} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <div className="tile-name">{item.name}</div>
                    <div className="tile-meta local-shortcut-path">{item.path}</div>
                  </span>
                  <div className="tile-actions">
                    <button
                      className="icon-btn"
                      title="编辑"
                      onClick={(e) => {
                        e.stopPropagation()
                        startEdit(item)
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRemoving(item)
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
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
