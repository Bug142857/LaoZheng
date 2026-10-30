import { useMemo, useState } from 'react'
import { ChevronLeft, Grid2X2, List, Pencil, Plus, Search, Star, Trash2, X } from 'lucide-react'
import type { CollectionItem, ItemList } from '../shared/types'
import { useData } from '../state/DataContext'
import {
  childrenOf,
  countItems,
  descendantIds,
  itemsOf,
  listCovers,
  nextId
} from '../utils/data'
import { ConfirmDialog, EmptyState, ListCoverMosaic, PromptDialog } from '../components/ui'
import { ItemDetail } from '../components/ItemDetail'

type ViewMode = 'grid' | 'list'

export function ListDetailPage({
  listId,
  onBack,
  onOpenList,
  onNotice,
  onWatch
}: {
  listId: number
  onBack: () => void
  onOpenList: (id: number) => void
  onNotice: (text: string) => void
  onWatch?: (title: string) => void
}) {
  const { data, update } = useData()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [creatingChild, setCreatingChild] = useState(false)
  const [removing, setRemoving] = useState<number | null>(null)
  const [view, setView] = useState<ViewMode>('grid')
  const [detail, setDetail] = useState<CollectionItem | null>(null)
  const [query, setQuery] = useState('')

  const list = data.lists.find((l) => l.id === listId)
  const children = useMemo(() => childrenOf(data, listId), [data, listId])
  const items = useMemo(() => itemsOf(data, listId), [data, listId])
  const keyword = query.trim().toLowerCase()
  const visibleChildren = useMemo(
    () => (keyword ? children.filter((c) => c.name.toLowerCase().includes(keyword)) : children),
    [children, keyword]
  )
  const visibleItems = useMemo(
    () =>
      keyword
        ? items.filter((item) =>
            [item.title, item.subTitle, item.category, item.year]
              .filter(Boolean)
              .some((text) => text!.toLowerCase().includes(keyword))
          )
        : items,
    [items, keyword]
  )

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
    setDetail(null)
  }

  /** 弹窗放在两个分支外面，否则详情页里点「从清单移除」要等返回后才弹出 */
  const dialogs = (
    <>
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

  if (detail) {
    return (
      <>
        <ItemDetail
          item={detail}
          onBack={() => setDetail(null)}
          onNotice={onNotice}
          onWatch={onWatch}
          actions={
            <button className="btn danger" onClick={() => setRemoving(detail.id)}>
              <Trash2 size={14} /> 从清单移除
            </button>
          }
        />
        {dialogs}
      </>
    )
  }

  const childCard = (child: ItemList) => {
    const covers = listCovers(data, child.id)
    return (
      <div
        key={`child-${child.id}`}
        className="item-card"
        role="button"
        tabIndex={0}
        onClick={() => onOpenList(child.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onOpenList(child.id)
        }}
      >
        <ListCoverMosaic covers={covers} name={child.name} className="item-card-cover" />
        <span className="item-card-main">
          <span className="item-card-title">{child.name}</span>
          <span className="item-card-meta">子清单 · {countItems(data, child.id)} 件</span>
        </span>
      </div>
    )
  }

  const itemCard = (item: CollectionItem) => (
    <div
      key={`item-${item.id}`}
      className="item-card"
      role="button"
      tabIndex={0}
      onClick={() => setDetail(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') setDetail(item)
      }}
    >
      <span className="item-card-cover">
        {item.coverUrl ? (
          <img src={item.coverUrl} alt="" loading="lazy" />
        ) : (
          (item.category || '条目').slice(0, 2)
        )}
      </span>
      <span className="item-card-main">
        <span className="item-card-title">{item.title || '未命名条目'}</span>
        <span className="item-card-meta">
          {[item.category, item.year].filter(Boolean).join(' · ') || item.subTitle || '—'}
        </span>
        {item.doubanRating ? (
          <span className="item-card-rating">
            <Star size={11} fill="#f5c518" stroke="#f5c518" /> {item.doubanRating.toFixed(1)}
          </span>
        ) : null}
      </span>
      <button
        className="icon-btn danger item-card-remove"
        title="从清单移除"
        onClick={(e) => {
          e.stopPropagation()
          setRemoving(item.id)
        }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  )

  return (
    <>
      <header className="page-header">
        <button className="btn ghost" onClick={onBack}>
          <ChevronLeft size={15} /> 清单
        </button>
        <h1 className="page-title">{list.name}</h1>
        <div className="page-actions">
          <div className="view-toggle">
            <button
              className={`icon-btn ${view === 'grid' ? 'active' : ''}`}
              title="网格显示"
              onClick={() => setView('grid')}
            >
              <Grid2X2 size={15} />
            </button>
            <button
              className={`icon-btn ${view === 'list' ? 'active' : ''}`}
              title="列表显示"
              onClick={() => setView('list')}
            >
              <List size={15} />
            </button>
          </div>
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

      <div className="toolbar">
        <label className="search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`在「${list.name}」里搜索条目或子清单…`}
          />
          {query ? (
            <button type="button" className="search-clear" title="清空搜索" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          ) : null}
        </label>
      </div>

      {children.length === 0 && items.length === 0 ? null : keyword &&
        visibleChildren.length === 0 &&
        visibleItems.length === 0 ? (
        <EmptyState title="没有找到匹配的条目" desc="换个关键词再试。" />
      ) : view === 'grid' ? (
        <div className="item-grid">
          {visibleChildren.map(childCard)}
          {visibleItems.map(itemCard)}
        </div>
      ) : (
        <div className="rows">
          {visibleChildren.map((child) => (
            <div key={`child-${child.id}`} className="row clickable" onClick={() => onOpenList(child.id)}>
              <ListCoverMosaic
                covers={listCovers(data, child.id)}
                name={child.name}
                className="row-cover"
              />
              <div className="row-main">
                <div className="row-title">{child.name}</div>
                <div className="row-meta">子清单 · {countItems(data, child.id)} 件</div>
              </div>
            </div>
          ))}
          {visibleItems.map((item) => (
            <div
              key={`item-${item.id}`}
              className="row clickable"
              onClick={() => setDetail(item)}
            >
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
                  {[item.subTitle, item.year, item.doubanRating ? `评分 ${item.doubanRating}` : '']
                    .filter(Boolean)
                    .join(' · ') || item.category || '—'}
                </div>
              </div>
              <button
                className="icon-btn danger"
                title="从清单移除"
                onClick={(e) => {
                  e.stopPropagation()
                  setRemoving(item.id)
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {dialogs}
    </>
  )
}
