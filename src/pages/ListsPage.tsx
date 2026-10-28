import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { ItemList } from '../shared/types'
import { useData } from '../state/DataContext'
import { countItems, descendantIds, nextId, rootLists, tileGradient } from '../utils/data'
import { ConfirmDialog, EmptyState, PromptDialog } from '../components/ui'

export function ListsPage({
  onOpenList,
  onNotice
}: {
  onOpenList: (id: number) => void
  onNotice: (text: string) => void
}) {
  const { data, update } = useData()
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<ItemList | null>(null)
  const [deleting, setDeleting] = useState<ItemList | null>(null)

  const lists = useMemo(() => rootLists(data), [data])

  const createList = (name: string) => {
    update((d) => ({
      ...d,
      lists: [
        ...d.lists,
        {
          id: nextId(d.lists),
          name,
          description: '',
          coverUrl: null,
          parentId: null,
          sortIndex: rootLists(d).length,
          world: 0,
          musicList: false,
          createdAt: Date.now()
        }
      ]
    }))
    setCreating(false)
    onNotice(`已创建清单「${name}」`)
  }

  const renameList = (name: string) => {
    if (!renaming) return
    update((d) => ({
      ...d,
      lists: d.lists.map((l) => (l.id === renaming.id ? { ...l, name } : l))
    }))
    setRenaming(null)
  }

  const deleteList = () => {
    if (!deleting) return
    const ids = descendantIds(data, deleting.id)
    const name = deleting.name
    update((d) => ({
      ...d,
      lists: d.lists.filter((l) => !ids.has(l.id)),
      listItems: d.listItems.filter((r) => !ids.has(r.listId))
    }))
    setDeleting(null)
    onNotice(`已删除清单「${name}」`)
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">清单</h1>
        <span className="page-desc">
          共 {lists.length} 个根清单 · 与手机端共用 items / lists / listItems 数据结构
        </span>
        <div className="page-actions">
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> 新建清单
          </button>
        </div>
      </header>

      {lists.length === 0 ? (
        <EmptyState
          title="还没有清单"
          desc="在手机端搜索收藏内容，或直接新建一个空清单；导入备份后这里会自动显示。"
          action={
            <button className="btn" onClick={() => setCreating(true)}>
              新建清单
            </button>
          }
        />
      ) : (
        <div className="tile-grid">
          {lists.map((list) => (
            <div key={list.id} className="tile" onClick={() => onOpenList(list.id)}>
              <span className="tile-cover" style={{ background: tileGradient(list.name) }}>
                {list.name.slice(0, 4)}
              </span>
              <span style={{ minWidth: 0 }}>
                <div className="tile-name">{list.name}</div>
                <div className="tile-meta">{countItems(data, list.id)} 件</div>
              </span>
              <span className="tile-actions">
                <button
                  className="icon-btn"
                  title="重命名"
                  onClick={(e) => {
                    e.stopPropagation()
                    setRenaming(list)
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn danger"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleting(list)
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <PromptDialog
          title="新建清单"
          placeholder="清单名称"
          confirmText="创建"
          onConfirm={createList}
          onCancel={() => setCreating(false)}
        />
      )}

      {renaming && (
        <PromptDialog
          title="重命名清单"
          initial={renaming.name}
          confirmText="保存"
          onConfirm={renameList}
          onCancel={() => setRenaming(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="删除清单"
          message={
            descendantIds(data, deleting.id).size > 1
              ? `「${deleting.name}」下还有子清单，删除后子清单与条目关联会一起移除，条目本身保留。`
              : `确定删除清单「${deleting.name}」吗？条目本身会保留，只移除清单关联。`
          }
          confirmText="删除"
          danger
          onConfirm={deleteList}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}
