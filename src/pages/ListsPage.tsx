import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { ItemList } from '../shared/types'
import { useData } from '../state/DataContext'
import {
  countItems,
  descendantIds,
  listCovers,
  nextId,
  rootLists
} from '../utils/data'
import { ConfirmDialog, EmptyState, ListCoverMosaic, PromptDialog } from '../components/ui'
import { SearchPage } from './SearchPage'

export function ListsPage({
  onOpenList,
  onNotice,
  resetSignal
}: {
  onOpenList: (id: number) => void
  onNotice: (text: string) => void
  /** 点侧栏进入清单时回到清单首页 */
  resetSignal?: number
}) {
  const { data, update } = useData()
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<ItemList | null>(null)
  const [deleting, setDeleting] = useState<ItemList | null>(null)
  /** 搜索结果打开了详情 / 人物页：隐藏「我的清单」，让详情独占整页 */
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => {
    if (resetSignal === undefined) return
    setDetailOpen(false)
    setCreating(false)
    setRenaming(null)
    setDeleting(null)
  }, [resetSignal])

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
      {detailOpen ? null : (
        <header className="page-header">
          <h1 className="page-title">清单</h1>
          <div className="page-actions">
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> 新建清单
            </button>
          </div>
        </header>
      )}

      <SearchPage
        embedded
        onNotice={onNotice}
        onImmersiveChange={setDetailOpen}
        resetSignal={resetSignal}
      />

      {detailOpen ? null : (
        <>
      <div className="page-desc" style={{ marginBottom: 10 }}>
        我的清单 · {lists.length} 个
      </div>

      {lists.length === 0 ? (
        <EmptyState
          title="还没有清单"
          desc="先新建一个清单，再用上面的搜索把条目加进来；导入备份后这里会自动显示。"
          action={
            <button className="btn" onClick={() => setCreating(true)}>
              新建清单
            </button>
          }
        />
      ) : (
        <div className="tile-grid">
          {lists.map((list) => {
            const covers = listCovers(data, list.id)
            const subCount = data.lists.filter((l) => l.parentId === list.id).length
            return (
              <div key={list.id} className="tile" onClick={() => onOpenList(list.id)}>
                <ListCoverMosaic covers={covers} name={list.name} />
                <span style={{ minWidth: 0 }}>
                  <div className="tile-name">{list.name}</div>
                  <div className="tile-meta">
                    {countItems(data, list.id)} 件
                    {subCount > 0 ? ` · ${subCount} 个子清单` : ''}
                  </div>
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
            )
          })}
        </div>
      )}
        </>
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
