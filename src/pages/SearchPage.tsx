import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useData } from '../state/DataContext'
import { listNamesOfItem, nextId } from '../utils/data'
import { ConfirmDialog, EmptyState, Modal } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { ItemDetail } from '../components/ItemDetail'
import { PersonDetail, personWorkToItem } from '../components/PersonDetail'
import {
  KIND_LABELS,
  SEARCH_CATEGORIES,
  type PersonWork,
  type SearchCategory,
  type SubjectDetail,
  type SubjectSearchItem
} from '../shared/douban'
import type { CollectionItem, ItemList } from '../shared/types'

/** 已落库条目转回搜索结果结构，详情页里也能复用「加入清单」选择器 */
function toSearchItem(item: CollectionItem): SubjectSearchItem {
  return {
    kind: item.category.includes('书')
      ? 'book'
      : item.category.includes('游戏')
        ? 'game'
        : item.category.includes('电影')
          ? 'movie'
          : 'tv',
    id: item.doubanId,
    title: item.title,
    subTitle: item.subTitle,
    year: item.year,
    coverUrl: item.coverUrl,
    rating: item.doubanRating,
    intro: item.summary,
    url: item.doubanUrl ?? ''
  }
}

/** 搜索结果还没落库，先按条目结构转一份给详情页展示 */
function toCollectionItem(item: SubjectSearchItem): CollectionItem {
  return {
    id: 0,
    category: KIND_LABELS[item.kind],
    doubanId: item.id,
    title: item.title,
    subTitle: item.subTitle,
    year: item.year,
    doubanRating: item.rating,
    coverUrl: item.coverUrl,
    summary: item.intro,
    info: '',
    directors: '',
    casts: '',
    genres: '',
    doubanUrl: item.url,
    status: '',
    myRating: 0,
    note: '',
    createdAt: 0,
    updatedAt: 0
  }
}

export function SearchPage({
  onNotice,
  embedded = false,
  onImmersiveChange,
  resetSignal
}: {
  onNotice: (text: string) => void
  /** 嵌在「清单」页里时不再重复页面标题 */
  embedded?: boolean
  /** 详情 / 人物页打开时通知外层隐藏「我的清单」等列表内容 */
  onImmersiveChange?: (open: boolean) => void
  /** 点侧栏重新进入清单时关闭详情页 */
  resetSignal?: number
}) {
  const { data, update } = useData()
  const [category, setCategory] = useState<SearchCategory>('video')
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<SubjectSearchItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [pending, setPending] = useState<SubjectSearchItem | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [detail, setDetail] = useState<CollectionItem | null>(null)
  /** 详情从哪条搜索结果打开：加入清单时复用原结果 */
  const [detailSource, setDetailSource] = useState<SubjectSearchItem | null>(null)
  const [removingDetail, setRemovingDetail] = useState<CollectionItem | null>(null)
  const [personDetail, setPersonDetail] = useState<{
    id: string
    name: string
    avatar: string | null
  } | null>(null)
  /** 人物页里点开的作品详情 */
  const [personWork, setPersonWork] = useState<PersonWork | null>(null)
  const seqRef = useRef(0)

  const immersive = !!detail || !!personDetail || !!personWork
  useEffect(() => {
    onImmersiveChange?.(immersive)
  }, [immersive, onImmersiveChange])
  useEffect(() => () => onImmersiveChange?.(false), [onImmersiveChange])

  useEffect(() => {
    if (resetSignal === undefined) return
    setDetail(null)
    setDetailSource(null)
    setPersonDetail(null)
    setPersonWork(null)
    setRemovingDetail(null)
  }, [resetSignal])

  /** (category|doubanId) → 所在清单名；存在但空数组表示已收藏但不在清单里 */
  const savedMap = useMemo(() => {
    const out = new Map<string, string[]>()
    const idByKey = new Map<string, number>()
    for (const item of data.items) {
      idByKey.set(`${item.category}|${item.doubanId}`, item.id)
    }
    for (const [key, id] of idByKey) out.set(key, listNamesOfItem(data, id))
    return out
  }, [data])

  /** 清单选择器：根清单 + 递归子清单，按层级缩进 */
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

  const switchCategory = (next: SearchCategory) => {
    if (next === category) return
    setCategory(next)
    setItems([])
    setError(null)
    setWarning(null)
    setSearched(false)
  }

  const runSearch = async () => {
    const q = query.trim()
    if (!q || loading) return
    const seq = ++seqRef.current
    setLoading(true)
    setSearched(true)
    setError(null)
    setWarning(null)
    setItems([])
    try {
      const res = await window.laozheng.searchSubjects(category, q)
      if (seq !== seqRef.current) return
      if (!res.ok) {
        setError(res.error ?? '搜索失败，请稍后重试')
        return
      }
      setItems(res.items)
      setWarning(res.warning ?? null)
      setSubmitted(q)
    } catch (err) {
      if (seq !== seqRef.current) return
      setError((err as Error).message)
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }

  const addToList = async (listId: number, listName: string) => {
    const target = pending
    if (!target) return
    const key = `${target.kind}|${target.id}`
    setPending(null)
    setBusyKey(key)

    let detail: SubjectDetail | null = null
    if (target.kind !== 'person') {
      try {
        const res = await window.laozheng.fetchSubjectDetail(target.kind, target.id)
        if (res.ok && res.detail) detail = res.detail
      } catch {
        detail = null
      }
    }

    const categoryLabel = KIND_LABELS[target.kind]
    const now = Date.now()
    update((d) => {
      const existing = d.items.find(
        (i) => i.category === categoryLabel && i.doubanId === target.id
      )
      let items = d.items
      let itemId: number

      if (existing) {
        itemId = existing.id
        if (detail) {
          items = d.items.map((i) =>
            i.id === existing.id
              ? {
                  ...i,
                  title: detail.title || i.title,
                  doubanRating: detail.rating ?? i.doubanRating,
                  coverUrl: detail.coverUrl || i.coverUrl,
                  summary: detail.summary || i.summary,
                  info: detail.info || i.info,
                  directors: detail.directors || i.directors,
                  casts: detail.casts || i.casts,
                  genres: detail.genres || i.genres,
                  updatedAt: now
                }
              : i
          )
        }
      } else {
        itemId = nextId(d.items)
        const created: CollectionItem = {
          id: itemId,
          category: categoryLabel,
          doubanId: target.id,
          title: detail?.title || target.title,
          subTitle:
            categoryLabel === '图书' ? detail?.info || target.subTitle : target.subTitle,
          year: target.year,
          doubanRating: detail?.rating ?? target.rating,
          coverUrl: detail?.coverUrl || target.coverUrl,
          summary: detail?.summary || target.intro,
          info: detail?.info || '',
          directors: detail?.directors || '',
          casts: detail?.casts || '',
          genres: detail?.genres || '',
          doubanUrl: target.url,
          status: '',
          myRating: 0,
          note: '',
          createdAt: now,
          updatedAt: now
        }
        items = [...d.items, created]
      }

      if (d.listItems.some((r) => r.listId === listId && r.itemId === itemId)) {
        return { ...d, items }
      }
      const orderIndex =
        d.listItems
          .filter((r) => r.listId === listId)
          .reduce((max, r) => Math.max(max, r.orderIndex), -1) + 1
      return { ...d, items, listItems: [...d.listItems, { listId, itemId, orderIndex }] }
    })

    setBusyKey(null)
    onNotice(detail ? `已加入「${listName}」` : `已加入「${listName}」，详情暂未补全`)
  }

  const savedLabel = (item: SubjectSearchItem): string | null => {
    if (item.kind === 'person') return null
    const names = savedMap.get(`${KIND_LABELS[item.kind]}|${item.id}`)
    if (!names) return null
    return names.length > 0 ? `已收藏在「${names.join('、')}」` : '已收藏'
  }

  /** 详情里的条目是否已经落库（收藏过） */
  const savedItemOf = (item: CollectionItem): CollectionItem | undefined =>
    data.items.find((row) => row.category === item.category && row.doubanId === item.doubanId)

  /** 取消收藏：从所有清单移除，并删掉条目本身 */
  const removeCollected = () => {
    const target = removingDetail
    if (!target) return
    update((d) => ({
      ...d,
      listItems: d.listItems.filter((r) => r.itemId !== target.id),
      items: d.items.filter((i) => i.id !== target.id)
    }))
    setRemovingDetail(null)
    onNotice(`已从清单移除「${target.title}」`)
  }

  const listPicker = pending ? (
    <Modal
      title={`加入清单 · ${pending.title}`}
      onClose={() => setPending(null)}
      footer={
        <button className="btn ghost" onClick={() => setPending(null)}>
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
              onClick={() => void addToList(list.id, list.name)}
            >
              <span>{list.name}</span>
              {depth > 0 ? <span className="sub">子清单</span> : null}
            </button>
          ))}
        </div>
      )}
    </Modal>
  ) : null

  const removeConfirm = removingDetail ? (
    <ConfirmDialog
      title="从清单移除"
      message={`确定把「${removingDetail.title}」从所有清单中移除吗？会同时删除这条收藏（片源与清单本身不受影响）。`}
      confirmText="移除"
      danger
      onConfirm={removeCollected}
      onCancel={() => setRemovingDetail(null)}
    />
  ) : null

  if (personWork) {
    const workItem = personWorkToItem(personWork)
    const collected = savedItemOf(workItem)
    return (
      <>
        <ItemDetail
          item={workItem}
          onBack={() => setPersonWork(null)}
          onNotice={onNotice}
          actions={
            collected ? (
              <button className="btn danger" onClick={() => setRemovingDetail(collected)}>
                <Trash2 size={14} /> 从清单移除
              </button>
            ) : (
              <button
                className="btn primary"
                onClick={() => setPending(toSearchItem(workItem))}
              >
                <Plus size={14} /> 加入清单
              </button>
            )
          }
        />
        {listPicker}
        {removeConfirm}
      </>
    )
  }

  if (personDetail) {
    return (
      <PersonDetail
        personId={personDetail.id}
        fallbackName={personDetail.name}
        fallbackAvatar={personDetail.avatar}
        onBack={() => {
          setPersonDetail(null)
          setPersonWork(null)
        }}
        onOpenWork={(work) => setPersonWork(work)}
      />
    )
  }

  if (detail) {
    const collected = savedItemOf(detail)
    const names = collected ? listNamesOfItem(data, collected.id) : []
    return (
      <>
        <ItemDetail
          item={detail}
          onBack={() => {
            setDetail(null)
            setDetailSource(null)
          }}
          onNotice={onNotice}
          actions={
            collected ? (
              <>
                <span className="page-desc">
                  {names.length ? `已收藏在「${names.join('、')}」` : '已收藏'}
                </span>
                <button className="btn danger" onClick={() => setRemovingDetail(collected)}>
                  <Trash2 size={14} /> 从清单移除
                </button>
              </>
            ) : (
              <button
                className="btn primary"
                onClick={() => setPending(detailSource ?? toSearchItem(detail))}
              >
                <Plus size={14} /> 加入清单
              </button>
            )
          }
        />
        {listPicker}
        {removeConfirm}
      </>
    )
  }

  const openResult = (item: SubjectSearchItem) => {
    if (item.kind === 'person') {
      setPersonWork(null)
      setPersonDetail({ id: item.id, name: item.title, avatar: item.coverUrl })
      return
    }
    setDetailSource(item)
    setDetail(toCollectionItem(item))
  }

  return (
    <>
      {embedded ? null : (
        <header className="page-header">
          <h1 className="page-title">搜索</h1>
        </header>
      )}

      <div className="toolbar">
        {SEARCH_CATEGORIES.map((c) => (
          <button
            key={c.key}
            className={`chip ${category === c.key ? 'active' : ''}`}
            onClick={() => switchCategory(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <SearchBar
        value={query}
        onChange={setQuery}
        onSubmit={() => void runSearch()}
        onCancel={() => {
          seqRef.current += 1
          setLoading(false)
        }}
        onClear={() => {
          setQuery('')
          setItems([])
          setSearched(false)
          setError(null)
          setWarning(null)
        }}
        searching={loading}
        placeholder={`在「${SEARCH_CATEGORIES.find((c) => c.key === category)?.label}」分类下搜索…`}
      />

      {warning ? <div className="result-hint">{warning}</div> : null}

      {loading ? (
        <EmptyState title="正在搜索…" desc="影视会同时查询电影与剧集，稍等片刻。" />
      ) : error ? (
        <EmptyState
          title="搜索失败"
          desc={error}
          action={
            <button className="btn" onClick={() => void runSearch()}>
              重试
            </button>
          }
        />
      ) : !searched ? (
        <EmptyState
          title="输入关键词开始搜索"
          desc="先选分类再搜索，避免不同分类的结果互相干扰。人物结果只展示资料，不提供收藏。"
        />
      ) : items.length === 0 ? (
        <EmptyState title="没有找到结果" desc="换个关键词，或切换分类再试试。" />
      ) : (
        <>
          <div className="page-desc" style={{ marginBottom: 10 }}>
            「{submitted}」找到 {items.length} 条
          </div>
          <div className="rows">
            {items.map((item) => {
              const key = `${item.kind}|${item.id}`
              const saved = savedLabel(item)
              const isPerson = item.kind === 'person'
              return (
                <div key={key} className="row clickable" onClick={() => openResult(item)}>
                  <div className="row-cover">
                    {item.coverUrl ? (
                      <img src={item.coverUrl} alt="" loading="lazy" />
                    ) : (
                      KIND_LABELS[item.kind].slice(0, 2)
                    )}
                  </div>
                  <div className="row-main">
                    <div className="row-title">{item.title}</div>
                    <div className="row-meta">
                      {[KIND_LABELS[item.kind], item.year, item.subTitle]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  {item.rating != null ? (
                    <span className="badge">{item.rating.toFixed(1)} 分</span>
                  ) : null}
                  {saved ? (
                    <span className="badge brand">{saved}</span>
                  ) : isPerson ? (
                    <span className="badge">资料</span>
                  ) : (
                    <button
                      className="btn"
                      disabled={busyKey !== null}
                      onClick={(e) => {
                        e.stopPropagation()
                        setPending(item)
                      }}
                    >
                      <Plus size={14} />
                      {busyKey === key ? '加入中…' : '加入清单'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {listPicker}
      {removeConfirm}
    </>
  )
}
