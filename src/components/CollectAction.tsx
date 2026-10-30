import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2 } from 'lucide-react'
import type { CollectionItem, ItemList } from '../shared/types'
import { useData } from '../state/DataContext'
import { listNamesOfItem, nextId } from '../utils/data'
import { ConfirmDialog, Modal } from './ui'

/**
 * 条目详情右上角的收藏状态与操作：
 * - 未收藏：显示「加入清单」，可选任意清单 / 子清单；
 * - 已收藏：显示所在清单，并可「从清单移除」。
 * 用于人物作品等由详情内部再打开、外层没有单独传 actions 的页面。
 */
export function CollectAction({
  item,
  onNotice
}: {
  item: CollectionItem
  onNotice: (text: string) => void
}) {
  const { data, update } = useData()
  const [picking, setPicking] = useState(false)
  const [removing, setRemoving] = useState(false)

  const saved = useMemo(
    () => data.items.find((row) => row.category === item.category && row.doubanId === item.doubanId),
    [data.items, item.category, item.doubanId]
  )
  const names = useMemo(
    () => (saved ? listNamesOfItem(data, saved.id) : []),
    [data, saved]
  )

  const listOptions = useMemo(() => {
    const out: { list: ItemList; depth: number }[] = []
    const walk = (parentId: number | null, depth: number): void => {
      data.lists
        .filter((list) => list.parentId === parentId)
        .sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt)
        .forEach((list) => {
          out.push({ list, depth })
          walk(list.id, depth + 1)
        })
    }
    walk(null, 0)
    return out
  }, [data.lists])

  const addToList = (list: ItemList) => {
    const now = Date.now()
    update((d) => {
      const existing = d.items.find(
        (row) => row.category === item.category && row.doubanId === item.doubanId
      )
      const itemId = existing?.id ?? nextId(d.items)
      const items = existing
        ? d.items
        : [
            ...d.items,
            {
              ...item,
              id: itemId,
              createdAt: item.createdAt || now,
              updatedAt: now
            }
          ]
      if (d.listItems.some((row) => row.listId === list.id && row.itemId === itemId)) {
        return { ...d, items }
      }
      const orderIndex =
        d.listItems
          .filter((row) => row.listId === list.id)
          .reduce((max, row) => Math.max(max, row.orderIndex), -1) + 1
      return { ...d, items, listItems: [...d.listItems, { listId: list.id, itemId, orderIndex }] }
    })
    setPicking(false)
    onNotice(`已加入「${list.name}」`)
  }

  const removeCollected = () => {
    if (!saved) return
    update((d) => ({
      ...d,
      listItems: d.listItems.filter((row) => row.itemId !== saved.id),
      items: d.items.filter((row) => row.id !== saved.id)
    }))
    setRemoving(false)
    onNotice(`已从清单移除「${item.title}」`)
  }

  return (
    <>
      {saved ? (
        <>
          <span className="page-desc">
            {names.length ? `已收藏在「${names.join('、')}」` : '已收藏'}
          </span>
          <button className="btn danger" onClick={() => setRemoving(true)}>
            <Trash2 size={14} /> 从清单移除
          </button>
        </>
      ) : (
        <button className="btn primary" onClick={() => setPicking(true)}>
          <Plus size={14} /> 加入清单
        </button>
      )}

      {/* 详情头是 sticky + backdrop-filter，弹层挂到 body 才不会被裁剪 */}
      {picking
        ? createPortal(
            <Modal
              title={`加入清单 · ${item.title}`}
              onClose={() => setPicking(false)}
              footer={
                <button className="btn ghost" onClick={() => setPicking(false)}>
                  取消
                </button>
              }
            >
              {listOptions.length === 0 ? (
                <p>还没有清单，先到「清单」页新建一个再回来。</p>
              ) : (
                <div className="list-picker">
                  {listOptions.map(({ list, depth }) => (
                    <button
                      key={list.id}
                      className="list-option"
                      style={{ paddingLeft: 10 + depth * 18 }}
                      onClick={() => addToList(list)}
                    >
                      <span>{list.name}</span>
                      {depth > 0 ? <span className="sub">子清单</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </Modal>,
            document.body
          )
        : null}

      {removing
        ? createPortal(
            <ConfirmDialog
              title="从清单移除"
              message={`确定把「${item.title}」从所有清单中移除吗？会同时删除这条收藏（清单本身不受影响）。`}
              confirmText="移除"
              danger
              onConfirm={removeCollected}
              onCancel={() => setRemoving(false)}
            />,
            document.body
          )
        : null}
    </>
  )
}
