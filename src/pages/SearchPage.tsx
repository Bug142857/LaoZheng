import { useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { useData } from '../state/DataContext'
import { listNamesOfItem, nextId } from '../utils/data'
import { EmptyState, Modal } from '../components/ui'
import {
  KIND_LABELS,
  SEARCH_CATEGORIES,
  type SearchCategory,
  type SubjectDetail,
  type SubjectSearchItem
} from '../shared/douban'
import type { CollectionItem, ItemList } from '../shared/types'

export function SearchPage({ onNotice }: { onNotice: (text: string) => void }) {
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
    setLoading(true)
    setSearched(true)
    setError(null)
    setWarning(null)
    setItems([])
    try {
      const res = await window.laozheng.searchSubjects(category, q)
      if (!res.ok) {
        setError(res.error ?? '搜索失败，请稍后重试')
        return
      }
      setItems(res.items)
      setWarning(res.warning ?? null)
      setSubmitted(q)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
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

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">搜索</h1>
        <span className="page-desc">
          影视 / 图书 / 游戏 / 人物 · 搜索结果可加入清单，条目与手机端互通
        </span>
      </header>

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

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          void runSearch()
        }}
      >
        <label className="search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`在「${SEARCH_CATEGORIES.find((c) => c.key === category)?.label}」分类下搜索…`}
          />
        </label>
        <button className="btn primary" type="submit" disabled={!query.trim() || loading}>
          {loading ? '搜索中…' : '搜索'}
        </button>
      </form>

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
                <div key={key} className="row">
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
                      onClick={() => setPending(item)}
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

      {pending && (
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
      )}
    </>
  )
}
