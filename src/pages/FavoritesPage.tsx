import { useMemo, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { useData } from '../state/DataContext'
import { favModuleLabel, filterFavs, formatTime } from '../utils/data'
import { EmptyState } from '../components/ui'
import type { InnerFav } from '../shared/types'

export function FavoritesPage({ onOpen }: { onOpen: (fav: InnerFav) => void }) {
  const { data } = useData()
  const [query, setQuery] = useState('')
  const [moduleKey, setModuleKey] = useState('all')

  const modules = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of data.innerFavs) counts.set(f.module, (counts.get(f.module) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [data.innerFavs])

  const favs = useMemo(() => {
    const base =
      moduleKey === 'all' ? data.innerFavs : data.innerFavs.filter((f) => f.module === moduleKey)
    return filterFavs(base, query).sort((a, b) => b.savedAt - a.savedAt)
  }, [data.innerFavs, moduleKey, query])

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">收藏</h1>
        <span className="page-desc">共 {data.innerFavs.length} 条爱心收藏 · 与手机端 innerFavs 同步</span>
      </header>

      {data.innerFavs.length === 0 ? (
        <EmptyState
          title="还没有收藏"
          desc="在手机端各模块列表卡片点爱心收藏，导出备份后即可在这里看到。"
        />
      ) : (
        <>
          <div className="toolbar">
            <label className="search">
              <Search size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索标题或作者…"
              />
            </label>
            <button
              className={`chip ${moduleKey === 'all' ? 'active' : ''}`}
              onClick={() => setModuleKey('all')}
            >
              全部 {data.innerFavs.length}
            </button>
            {modules.map(([key, count]) => (
              <button
                key={key}
                className={`chip ${moduleKey === key ? 'active' : ''}`}
                onClick={() => setModuleKey(key)}
              >
                {favModuleLabel(key)} {count}
              </button>
            ))}
          </div>

          {favs.length === 0 ? (
            <EmptyState title="没有找到匹配的收藏" desc="换一个关键词，或点「全部」恢复。" />
          ) : (
            <div className="rows">
              {favs.map((f) => (
                <div
                  key={`${f.module}-${f.id}`}
                  className="row clickable"
                  role="button"
                  tabIndex={0}
                  title="打开对应模块"
                  onClick={() => onOpen(f)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onOpen(f)
                  }}
                >
                  <div className="row-cover">
                    {f.cover ? (
                      <img src={f.cover} alt="" loading="lazy" />
                    ) : (
                      favModuleLabel(f.module).slice(0, 2)
                    )}
                  </div>
                  <div className="row-main">
                    <div className="row-title">{f.title}</div>
                    <div className="row-meta">
                      {[f.subtitle, formatTime(f.savedAt)].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <span className="badge brand">{favModuleLabel(f.module)}</span>
                  <ChevronRight size={15} className="row-arrow" />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
