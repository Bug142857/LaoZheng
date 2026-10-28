import { useMemo, useState } from 'react'
import { ChevronLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import type { ItemList } from '../shared/types'
import { useData } from '../state/DataContext'
import {
  childrenOf,
  countItems,
  descendantIds,
  itemsOf,
  nextId,
  tileGradient
} from '../utils/data'
import { ConfirmDialog, EmptyState, PromptDialog } from '../components/ui'

export function ListDetailPage({
  listId,
  onBack,
  onOpenList,
  onNotice
}: {
  listId: number
  onBack: () => void
  onOpenList: (id: number) => void
  onNotice: (text: string) => void
}) {
  const { data, update } = useData()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [creatingChild, setCreatingChild] = useState(false)
  const [removing, setRemoving] = useState<number | null>(null)

  const list = data.lists.find((l) => l.id === listId)
  const children = useMemo(() => childrenOf(data, listId), [data, listId])
  const items = useMemo(() => itemsOf(data, listId), [data, listId])

  if (!list) {
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={onBack}>
            <ChevronLeft size={15} /> 返回清单
          </button>
        </header>
        <EmptyState title="清单不存在" desc="它可能已在其他端被删除。" />
      </>
    )
  }

  const rename = (name: string) => {
    update((d) => ({
      ...d,
      lists: d.lists.map((l) => (l.id === listId ? { ...l, name } : l))
    }))
    setRenaming(false)
  }

  const createChild = (name: string) => {
    update((d) => ({
      ...d,
      lists: [
        ...d.lists,
        {
          id: nextId(d.lists),
          name,
          description: '',
          coverUrl: null,
          parentId: listId,
          sortIndex: childrenOf(d, listId).length,
          world: list.world,
          musicList: false,
          createdAt: Date.now()
        }
      ]
    }))
    setCreatingChild(false)
    onNotice(`已创建子清单「${name}」`)
  }

  const remove = () => {
    if (!list) return
    const ids = descendantIds(data, listId)
    update((d) => ({
      ...d,
      lists: d.lists.filter((l) => !ids.has(l.id)),
      listItems: d.listItems.filter((r) => !ids.has(r.listId))
    }))
    onBack()
    onNotice(`已删除清单「${list.name}」`)
  }

  const removeItem = (itemId: number) => {
    update((d) => ({
      ...d,
      listItems: d.listItems.filter((r) => !(r.listId === listId && r.itemId === itemId))
    }))
    setRemoving(null)
  }

  return (
    <>
      <header className="page-header">
        <button className="btn ghost" onClick={onBack}>
          <ChevronLeft size={15} /> 清单
        </button>
        <h1 className="page-title">{list.name}</h1>
        <span className="page-desc">
          {countItems(data, list.id)} 件 · 含子清单
        </span>
        <div className="page-actions">
          <button className="btn" onClick={() => setCreatingChild(true)}>
            <Plus size={15} /> 子清单
          </button>
          <button className="btn" onClick={() => setRenaming(true)}>
            <Pencil size={15} /> 重命名
          </button>
          <button className="btn danger" onClick={() => setDeleting(true)}>
            <Trash2 size={15} /> 删除
          </button>
        </div>
      </header>

      {children.length > 0 && (
        <div className="tile-grid" style={{ marginBottom: 16 }}>
          {children.map((child: ItemList) => (
            <div key={child.id} className="tile" onClick={() => onOpenList(child.id)}>
              <span className="tile-cover" style={{ background: tileGradient(child.name) }}>
                {child.name.slice(0, 4)}
              </span>
              <span style={{ minWidth: 0 }}>
                <div className="tile-name">{child.name}</div>
                <div className="tile-meta">{countItems(data, child.id)} 件</div>
              </span>
            </div>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="这个清单还没有条目"
          desc="条目来自手机端的搜索收藏；PC 端搜索模块接入后会支持在这里直接添加。"
        />
      ) : (
        <div className="rows">
          {items.map((item) => (
            <div key={item.id} className="row">
              <div className="row-cover">
                {item.coverUrl ? (
                  <img src={item.coverUrl} alt="" loading="lazy" />
                ) : (
                  (item.category || '条目').slice(0, 2)
                )}
              </div>
              <div className="row-main">
                <div className="row-title">{item.title || '未命名条目'}</div>
                <div className="row-meta">
                  {[item.subTitle, item.year, item.doubanRating ? `豆瓣 ${item.doubanRating}` : '']
                    .filter(Boolean)
                    .join(' · ') || item.category || '—'}
                </div>
              </div>
              {item.status ? <span className="badge">{item.status}</span> : null}
              <button
                className="icon-btn danger"
                title="从清单移除"
                onClick={() => setRemoving(item.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {renaming && (
        <PromptDialog
          title="重命名清单"
          initial={list.name}
          confirmText="保存"
          onConfirm={rename}
          onCancel={() => setRenaming(false)}
        />
      )}

      {creatingChild && (
        <PromptDialog
          title="新建子清单"
          placeholder="子清单名称"
          confirmText="创建"
          onConfirm={createChild}
          onCancel={() => setCreatingChild(false)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="删除清单"
          message={`确定删除「${list.name}」吗？子清单与条目关联会一起移除，条目本身保留。`}
          confirmText="删除"
          danger
          onConfirm={remove}
          onCancel={() => setDeleting(false)}
        />
      )}

      {removing != null && (
        <ConfirmDialog
          title="移出清单"
          message="只移除这条清单关联，收藏条目本身仍保留在数据里。"
          confirmText="移除"
          danger
          onConfirm={() => removeItem(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </>
  )
}
