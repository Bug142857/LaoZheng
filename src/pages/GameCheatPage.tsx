import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  Download,
  ExternalLink,
  Heart,
  ShieldAlert,
  Wand2
} from 'lucide-react'
import { useData } from '../state/DataContext'
import {
  EmptyState,
  LoadingBlock,
  ModuleShortcuts,
  Pagination
} from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { loadCache, saveCache } from '../utils/cache'
import type {
  InstalledTrainer,
  TrainerDetail,
  TrainerListItem,
  TrainerSourceInput
} from '../shared/trainers'

/**
 * 修改器：多源在线训练器（风灵月影 / 3DM / 游民星空 / 游侠网）搜索 / 详情 / 下载。
 * 源配置在片源管理里维护；下载进下载管理的「修改器」分区。
 */

export interface GameCheatFocus {
  url: string
  sourceId: string
  title: string
  cover: string | null
  version?: string
}

interface CheatCache {
  sourceId: string
  query: string
  page: number
  items: TrainerListItem[]
  hasMore: boolean
}

const EMPTY_CACHE: CheatCache = {
  sourceId: 'all',
  query: '',
  page: 1,
  items: [],
  hasMore: false
}

const cache: CheatCache = (() => {
  const cached = loadCache<CheatCache>('cheat', EMPTY_CACHE)
  // 每次打开应用回到「全部源 + 最新列表」；搜索状态不跨重启保留
  if (cached.sourceId !== 'all' || cached.query || cached.page !== 1) return { ...EMPTY_CACHE }
  return cached
})()

interface DetailState {
  item: TrainerListItem
  source: TrainerSourceInput
  trainer: TrainerDetail | null
  loading: boolean
  error: string | null
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function GameCheatPage({
  onNotice,
  resetSignal,
  focus,
  onExit,
  onOpenFavorites,
  onOpenDownloads
}: {
  onNotice: (text: string) => void
  resetSignal?: number
  focus?: GameCheatFocus
  onExit?: () => void
  onOpenFavorites?: () => void
  onOpenDownloads?: () => void
}) {
  const { data, update } = useData()
  const sources = useMemo(() => data.trainerSources, [data.trainerSources])
  const enabledSources = useMemo(() => sources.filter((s) => s.enabled), [sources])

  const [sourceId, setSourceId] = useState(cache.sourceId)
  const [query, setQuery] = useState(cache.query)
  const [input, setInput] = useState(cache.query)
  const [page, setPage] = useState(cache.page)
  const [hasMore, setHasMore] = useState(cache.hasMore)
  const [items, setItems] = useState<TrainerListItem[]>(cache.items)
  const [loading, setLoading] = useState(!cache.items.length)
  const [error, setError] = useState<string | null>(null)
  const [translatedTo, setTranslatedTo] = useState('')
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [showAllOptions, setShowAllOptions] = useState(false)
  const [showAllShots, setShowAllShots] = useState(false)

  const requestSeq = useRef(0)
  const detailSeq = useRef(0)

  /** 当前过滤条件下要查询的源；全部源 = 所有已启用源 */
  const sourceInputs = (filter: string): TrainerSourceInput[] => {
    const list = filter === 'all' ? enabledSources : enabledSources.filter((s) => s.id === filter)
    return list.map((s) => ({
      id: s.id,
      type: s.type,
      baseUrl: s.baseUrl,
      name: s.name
    }))
  }

  const load = async (filter: string, keyword: string, nextPage: number) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    setTranslatedTo('')
    // 失败时也记住本次关键词，重试 / 翻页不会退回上一次的搜索词
    setQuery(keyword)
    const inputs = sourceInputs(filter)
    if (!inputs.length) {
      setItems([])
      setHasMore(false)
      setLoading(false)
      setError('没有启用的补丁源')
      return
    }
    try {
      const res = await window.laozheng.searchTrainers(inputs, keyword, nextPage)
      if (seq !== requestSeq.current) return
      if (!res.ok) {
        setItems([])
        setHasMore(false)
        setError(res.error ?? '加载失败')
        return
      }
      setItems(res.items)
      setPage(res.page)
      setHasMore(res.hasMore)
      setSourceId(filter)
      setTranslatedTo(res.translatedTo ?? '')
      Object.assign(cache, {
        sourceId: filter,
        query: keyword,
        page: res.page,
        items: res.items,
        hasMore: res.hasMore
      })
      saveCache('cheat', { ...cache })
    } catch (err) {
      if (seq !== requestSeq.current) return
      setItems([])
      setHasMore(false)
      setError((err as Error).message)
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }

  useEffect(() => {
    detailSeq.current += 1
    setDetail(null)
    setShowAllOptions(false)
    setShowAllShots(false)
    setInput('')
    setSourceId('all')
    void load('all', '', 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal])

  // 当前选中的源被停用 / 删除后回到全部源
  useEffect(() => {
    if (sourceId === 'all') return
    if (sources.some((s) => s.id === sourceId && s.enabled)) return
    setSourceId('all')
    void load('all', query, 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources])

  // 从收藏进入：直接打开对应详情
  useEffect(() => {
    if (!focus) return
    const source = resolveSource(focus.sourceId, focus.url)
    if (!source) {
      onNotice('找不到对应的补丁源，请先在「设置 → 片源管理」启用')
      return
    }
    const item: TrainerListItem = {
      id: focus.url,
      title: focus.title,
      url: focus.url,
      cover: focus.cover,
      date: '',
      sourceId: source.id,
      sourceName: source.name ?? ''
    }
    void openDetail(item, source)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const resolveSource = (id: string, url: string): TrainerSourceInput | null => {
    const found = sources.find((s) => s.id === id && s.enabled)
    if (found) {
      return { id: found.id, type: found.type, baseUrl: found.baseUrl, name: found.name }
    }
    const host = hostOf(url)
    const byHost = sources.find(
      (s) => s.enabled && hostOf(s.baseUrl) && host.endsWith(hostOf(s.baseUrl))
    )
    if (byHost) {
      return { id: byHost.id, type: byHost.type, baseUrl: byHost.baseUrl, name: byHost.name }
    }
    return null
  }

  const submitSearch = () => {
    const keyword = input.trim()
    setDetail(null)
    void load(sourceId, keyword, 1)
  }

  const clearSearch = () => {
    setInput('')
    void load(sourceId, '', 1)
  }

  const changeSource = (next: string) => {
    if (next === sourceId) return
    setSourceId(next)
    setDetail(null)
    void load(next, query, 1)
  }

  const openDetail = async (item: TrainerListItem, source: TrainerSourceInput) => {
    const seq = ++detailSeq.current
    setDetail({ item, source, trainer: null, loading: true, error: null })
    try {
      const res = await window.laozheng.trainerDetail(source, item.url)
      if (seq !== detailSeq.current) return
      if (!res.ok || !res.trainer) {
        setDetail({ item, source, trainer: null, loading: false, error: res.error ?? '没有拿到详情' })
        return
      }
      setDetail({ item, source, trainer: res.trainer, loading: false, error: null })
      setShowAllOptions(false)
      setShowAllShots(false)
    } catch (err) {
      if (seq !== detailSeq.current) return
      setDetail({ item, source, trainer: null, loading: false, error: (err as Error).message })
    }
  }

  const openItemDetail = (item: TrainerListItem) => {
    const source = resolveSource(item.sourceId, item.url)
    if (!source) {
      onNotice('找不到对应的补丁源，请先在「设置 → 片源管理」启用')
      return
    }
    void openDetail(item, source)
  }

  const backToList = () => {
    detailSeq.current += 1
    setDetail(null)
  }

  const mergeRecord = (record: InstalledTrainer) => {
    update((d) => {
      const list = (d.installedTrainers ?? []).filter((t) => t.folder !== record.folder)
      return { ...d, installedTrainers: [record, ...list] }
    })
  }

  const download = async (url: string) => {
    if (!detail?.trainer || downloading) return
    const trainer = detail.trainer
    setDownloading(url)
    onNotice(`开始下载：${trainer.title}`)
    try {
      const res = await window.laozheng.downloadTrainer({
        url,
        title: trainer.title,
        version: trainer.version,
        pageUrl: trainer.url,
        sourceType: detail.source.type,
        sourceBaseUrl: detail.source.baseUrl,
        sourceId: detail.source.id,
        sourceName: trainer.sourceName,
        cover: trainer.cover
      })
      if (!res.ok || !res.trainer) {
        onNotice(`下载失败：${res.error ?? '未知错误'}`)
        return
      }
      mergeRecord(res.trainer)
      backToList()
      onNotice(res.note ?? `已下载：${res.trainer.title}（可在下载管理里查看）`)
    } catch (err) {
      onNotice(`下载失败：${(err as Error).message}`)
    } finally {
      setDownloading(null)
    }
  }

  const favOf = (url: string): boolean =>
    data.innerFavs.some((f) => f.module === 'trainer' && f.id === url)

  const toggleFav = (target: {
    url: string
    title: string
    cover: string | null
    sourceId: string
    sourceName: string
    version?: string
  }) => {
    const exists = favOf(target.url)
    update((d) => {
      if (exists) {
        return {
          ...d,
          innerFavs: d.innerFavs.filter((f) => !(f.module === 'trainer' && f.id === target.url))
        }
      }
      return {
        ...d,
        innerFavs: [
          ...d.innerFavs,
          {
            module: 'trainer',
            id: target.url,
            title: target.title,
            subtitle: [target.sourceName, target.version].filter(Boolean).join(' · '),
            cover: target.cover,
            savedAt: Date.now(),
            videoUrl: null,
            mediaId: 0,
            durationSec: 0,
            tweetUrl: null,
            payload: JSON.stringify({
              url: target.url,
              sourceId: target.sourceId,
              version: target.version
            })
          }
        ]
      }
    })
    onNotice(exists ? '已取消收藏' : '已收藏，可在「收藏」页查看')
  }

  if (detail) {
    const trainer = detail.trainer
    const options = trainer?.options ?? []
    const shownOptions = showAllOptions ? options : options.slice(0, 12)
    const shots = trainer?.screenshots ?? []
    const shownShots = showAllShots ? shots : shots.slice(0, 6)
    const fav = trainer ? favOf(trainer.url) : false
    return (
      <>
        <header className="page-header">
          <button
            className="btn ghost"
            onClick={() => {
              if (focus && onExit) {
                onExit()
                return
              }
              backToList()
            }}
          >
            <ChevronLeft size={15} /> {focus && onExit ? '返回' : '返回列表'}
          </button>
          <h1 className="page-title">{trainer?.title ?? detail.item.title}</h1>
          <div className="page-actions">
            {trainer ? (
              <button className={`btn ${fav ? 'primary' : ''}`} onClick={() => toggleFav(trainer)}>
                <Heart size={14} fill={fav ? 'currentColor' : 'none'} /> {fav ? '已收藏' : '收藏'}
              </button>
            ) : null}
          </div>
        </header>

        {detail.loading ? (
          <LoadingBlock text="正在加载补丁详情…" />
        ) : detail.error || !trainer ? (
          <EmptyState
            title="加载失败"
            desc={detail.error ?? '没有拿到详情'}
            action={
              <button className="btn" onClick={() => void openDetail(detail.item, detail.source)}>
                重试
              </button>
            }
          />
        ) : (
          <>
            <div className="comic-detail">
              <div className="comic-detail-cover cheat-detail-cover">
                {trainer.cover ? <img src={trainer.cover} alt="" /> : null}
              </div>
              <div className="comic-detail-info">
                <div className="row-title" style={{ whiteSpace: 'normal' }}>
                  {trainer.title}
                </div>
                <div className="comic-tags">
                  <span className="badge brand">{trainer.sourceName}</span>
                  {trainer.version ? (
                    <span className="badge">游戏版本 {trainer.version}</span>
                  ) : null}
                  {trainer.optionsCount > 0 ? (
                    <span className="badge">{trainer.optionsCount} 项功能</span>
                  ) : null}
                  {trainer.updatedAt ? (
                    <span className="badge">更新 {trainer.updatedAt}</span>
                  ) : null}
                </div>
                {trainer.summary ? (
                  <p className="comic-desc">{trainer.summary}</p>
                ) : (
                  <p className="comic-desc">
                    下载后自动解压到「下载目录 / 修改器」，启动时会请求管理员权限。
                  </p>
                )}
              </div>
            </div>

            <section className="settings-card">
              <h3>下载</h3>
              {trainer.downloads.length === 0 ? (
                <div className="settings-hint">这个页面没有可直接下载的文件，请打开原网页查看。</div>
              ) : (
                <div className="cheat-files">
                  {trainer.downloads.map((file) => (
                    <div className="cheat-file-row" key={file.url}>
                      <div className="cheat-file-main">
                        <div className="cheat-file-name" title={file.name}>
                          {file.name}
                        </div>
                        <div className="cheat-file-meta">
                          {[file.date, file.size].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </div>
                      {file.external ? (
                        <button
                          className="btn"
                          onClick={() => void window.laozheng.openExternal(file.url)}
                        >
                          <ExternalLink size={14} />
                          打开链接
                        </button>
                      ) : (
                        <button
                          className="btn primary"
                          disabled={downloading !== null}
                          onClick={() => void download(file.url)}
                        >
                          <Download size={14} />
                          {downloading === file.url ? '下载中…' : '下载并解压'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {options.length ? (
              <section className="settings-card" style={{ marginTop: 16 }}>
                <h3>修改项（{trainer.optionsCount || options.length}）</h3>
                <div className="cheat-options">
                  {shownOptions.map((option, index) => (
                    <div className="cheat-option" key={`${option}-${index}`}>
                      {option}
                    </div>
                  ))}
                </div>
                {options.length > 12 ? (
                  <div className="detail-collapse-line">
                    <button
                      className="btn section-more"
                      onClick={() => setShowAllOptions((v) => !v)}
                    >
                      {showAllOptions ? '收起' : `查看全部（${options.length} 项）`}
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}

            {trainer.notes.length ? (
              <section className="cheat-warning">
                <div className="cheat-warning-head">
                  <ShieldAlert size={16} /> 使用说明 / 反作弊提示
                </div>
                {trainer.notes.map((note, index) => (
                  <p key={`${note}-${index}`}>{note}</p>
                ))}
              </section>
            ) : null}

            {shots.length ? (
              <section style={{ marginTop: 18 }}>
                <h3 className="melon-heading">补丁截图</h3>
                <div className="game-shots">
                  {shownShots.map((src) => (
                    <img key={src} src={src} alt="" loading="lazy" />
                  ))}
                </div>
                {shots.length > 6 ? (
                  <div className="detail-collapse-line">
                    <button className="btn section-more" onClick={() => setShowAllShots((v) => !v)}>
                      {showAllShots ? '收起' : `查看全部（${shots.length} 张）`}
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">补丁</h1>
        <div className="page-actions">
          <ModuleShortcuts
            onOpenFavorites={onOpenFavorites}
            onOpenDownloads={onOpenDownloads}
          />
        </div>
      </header>

      {translatedTo ? (
        <div className="result-hint">中文名已自动按「{translatedTo}」搜索</div>
      ) : null}
      <SearchBar
        value={input}
        onChange={setInput}
        onSubmit={submitSearch}
        onClear={clearSearch}
        placeholder="搜索游戏名（中英文均可）…"
        disabled={loading}
        onRefresh={() => void load(sourceId, query, 1)}
        refreshing={loading}
        leading={
          <select
            className="select-inline"
            value={sourceId}
            disabled={loading}
            title="补丁源"
            onChange={(e) => changeSource(e.target.value)}
          >
            <option value="all">全部源（{enabledSources.length}）</option>
            {enabledSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        }
      />

      {loading && !items.length ? (
        <LoadingBlock text="正在加载补丁…" />
      ) : !items.length ? (
        <EmptyState
          title={error ?? '没有找到补丁'}
          desc={
            error === '没有找到匹配的补丁'
              ? '换个中文名或英文名再试试'
              : error
                ? '检查网络或到「设置 → 片源管理」里启停补丁源'
                : undefined
          }
          action={
            <button className="btn" onClick={() => void load(sourceId, query, 1)}>
              重试
            </button>
          }
        />
      ) : (
        <div className="cheat-grid">
          {items.map((item) => {
            const fav = favOf(item.url)
            return (
              <button
                key={item.url}
                className="media-card cheat-card"
                onClick={() => openItemDetail(item)}
              >
                <span className="media-thumb cheat-thumb">
                  {item.cover ? (
                    <img src={item.cover} alt="" loading="lazy" />
                  ) : (
                    <span className="cheat-cover-fallback">
                      <Wand2 size={22} />
                    </span>
                  )}
                  <span
                    className={`fav-heart ${fav ? 'on' : ''}`}
                    role="button"
                    title={fav ? '取消收藏' : '收藏'}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFav(item)
                    }}
                  >
                    <Heart size={15} fill={fav ? 'currentColor' : 'none'} />
                  </span>
                </span>
                <div className="media-title">{item.title}</div>
                <div className="media-meta">
                  {[item.sourceName, item.date].filter(Boolean).join(' · ')}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {items.length ? (
        <Pagination
          page={page}
          hasMore={hasMore}
          disabled={loading}
          showLast={false}
          onChange={(next) => void load(sourceId, query, next)}
        />
      ) : null}
    </>
  )
}
