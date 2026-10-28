import { useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { useData } from '../state/DataContext'
import { listNamesOfItem } from '../utils/data'
import { EmptyState, Modal } from '../components/ui'
import type { CollectionItem, ItemList } from '../shared/types'

/** 图书 / 游戏模块：展示已收藏的对应分类条目，并可加入更多清单 */
export function CollectionPage({
  category,
  title,
  desc,
  onNotice,
  onGoSearch,
  embedded = false
}: {
  category: string
  title: string
  desc: string
  onNotice: (text: string) => void
  onGoSearch: () => void
  /** 嵌入其他模块时隐藏页头（由外层提供标题与切换） */
  embedded?: boolean
}) {
  const { data, update } = useData()
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<CollectionItem | null>(null)

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.items
      .filter((i) => i.category === category)
      .filter(
        (i) =>
          !q ||
          i.title.toLowerCase().includes(q) ||
          i.subTitle.toLowerCase().includes(q) ||
          i.directors.toLowerCase().includes(q) ||
          i.casts.toLowerCase().includes(q)
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [data.items, category, query])

  const listOptions = useMemo(() => {
    const out: { list: ItemList; depth: number }[] = []
    const walk = (parentId: number | null, depth: number): void => {
      data.lists
        .filter((l) => l.parentId === parentId)
        .sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt)
        .forEach((list) => {
          out.push({ list, depth })
          walk(list.id, depth + 1)
        })
    }
    walk(null, 0)
    return out
  }, [data.lists])

  const addToList = (listId: number, listName: string) => {
    if (!adding) return
    const itemId = adding.id
    update((d) => {
      if (d.listItems.some((r) => r.listId === listId && r.itemId === itemId)) return d
      const orderIndex =
        d.listItems
          .filter((r) => r.listId === listId)
          .reduce((max, r) => Math.max(max, r.orderIndex), -1) + 1
      return { ...d, listItems: [...d.listItems, { listId, itemId, orderIndex }] }
    })
    onNotice(`已加入「${listName}」`)
    setAdding(null)
  }

  return (
    <>
      {embedded ? null : (
        <header className="page-header">
          <h1 className="page-title">{title}</h1>
          <span className="page-desc">{desc} · 共 {items.length} 条</span>
          <div className="page-actions">
            <button className="btn" onClick={onGoSearch}>
              <Plus size={15} /> 去搜索添加
            </button>
          </div>
        </header>
      )}

      <div className="toolbar">
        <label className="search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`在已收藏的${title}里搜索…`}
          />
        </label>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title={`还没有收藏${title}`}
          desc={`在「搜索」里选择${category}分类，找到条目后加入清单即可；手机端收藏的条目导入后也会出现在这里。`}
          action={
            <button className="btn" onClick={onGoSearch}>
              去搜索
            </button>
          }
        />
      ) : (
        <div className="rows">
          {items.map((item) => {
            const lists = listNamesOfItem(data, item.id)
            return (
              <div key={item.id} className="row">
                <div className="row-cover">
                  {item.coverUrl ? <img src={item.coverUrl} alt="" loading="lazy" /> : category.slice(0, 2)}
                </div>
                <div className="row-main">
                  <div className="row-title">{item.title || '未命名条目'}</div>
                  <div className="row-meta">
                    {[item.year, item.subTitle, item.doubanRating ? `评分 ${item.doubanRating}` : '']
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </div>
                  {lists.length > 0 ? (
                    <div className="row-meta">已收藏在「{lists.join('、')}」</div>
                  ) : null}
                </div>
                <button className="btn" onClick={() => setAdding(item)}>
                  <Plus size={14} /> 加入清单
                </button>
              </div>
            )
          })}
        </div>
      )}

      {adding && (
        <Modal
          title={`加入清单 · ${adding.title}`}
          onClose={() => setAdding(null)}
          footer={
            <button className="btn ghost" onClick={() => setAdding(null)}>
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
                  onClick={() => addToList(list.id, list.name)}
                >
                  <span>{list.name}</span>
                  {depth > 0 ? <span className="sub">子清单</span> : null}
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
