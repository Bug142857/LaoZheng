import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Download, Heart, Lock, Play } from 'lucide-react'
import { EmptyState, LoadingBlock, ModuleShortcuts, Pagination } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { VideoPlayer } from '../components/VideoPlayer'
import { useData } from '../state/DataContext'
import { loadCache, saveCache } from '../utils/cache'
import { requestDownload } from '../utils/download'
import {
  XIFAN_DRAMA_SOURCE_ID,
  type DramaCatalogResponse,
  type DramaCategory,
  type DramaDetail,
  type DramaEpisode,
  type DramaItem,
  type DramaSource,
  type DramaSourceInput
} from '../shared/drama'
import type { InnerFav } from '../shared/types'

interface DramaCache {
  genre: string
  items: DramaItem[]
  categories: DramaCategory[]
  page: number
  pageCount: number
  hasMore: boolean
}

const EMPTY_CACHE: DramaCache = {
  genre: '',
  items: [],
  categories: [],
  page: 1,
  pageCount: 0,
  hasMore: false
}

/** 从收藏进入：带片源信息时直接打开对应剧集 */
export interface DramaFocus {
  sourceId: string
  sourceName?: string
  baseUrl?: string
  seriesId: string
  title: string
}

const FAV_MODULE = 'drama'

function inputFor(source: DramaSource): DramaSourceInput | null {
  if (source.id === XIFAN_DRAMA_SOURCE_ID) {
    return {
      id: source.id,
      name: source.name,
      ...(source.baseUrl ? { baseUrl: source.baseUrl } : {})
    }
  }
  if (!source.baseUrl) return null
  return { id: source.id, name: source.name, baseUrl: source.baseUrl }
}

function cacheKeyOf(scope: string): string {
  return `drama_${scope || 'all'}`
}

function failedCatalog(page: number, error: string): DramaCatalogResponse {
  return { ok: false, items: [], page, pageCount: 0, hasMore: false, categories: [], error }
}

/**
 * 短剧：内置西饭短剧 + 用户添加的苹果CMS 短剧源。
 * 目录与详情走主进程；默认列表写 localStorage，切模块 / 重开应用先显示上次内容。
 */
export function DramaPage({
  onNotice,
  resetSignal,
  focus,
  onExit,
  onOpenFavorites,
  onOpenDownloads
}: {
  onNotice: (text: string) => void
  resetSignal?: number
  focus?: DramaFocus
  onExit?: () => void
  onOpenFavorites?: () => void
  onOpenDownloads?: () => void
}) {
  const { data, update } = useData()
  const sources = data.dramaSources

  const available = useMemo(
    () => sources.filter((source) => source.enabled && (source.id === XIFAN_DRAMA_SOURCE_ID || !!source.baseUrl)),
    [sources]
  )
  const availableKey = available
    .map((source) => `${source.id}:${source.baseUrl ?? ''}`)
    .join(',')

  const initialCache = useMemo(() => loadCache<DramaCache>(cacheKeyOf(''), EMPTY_CACHE), [])

  /** 空字符串 = 全部源（和观影一致，默认全部源） */
  const [sourceId, setSourceId] = useState('')
  const [genre, setGenre] = useState(initialCache.genre)
  const [categories, setCategories] = useState<DramaCategory[]>(initialCache.categories)
  const [genreCounts, setGenreCounts] = useState<Record<string, number>>({})
  const [items, setItems] = useState<DramaItem[]>(initialCache.items)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(initialCache.page)
  const [pageCount, setPageCount] = useState(initialCache.pageCount)
  const [hasMore, setHasMore] = useState(initialCache.hasMore)
  const [input, setInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detailSource, setDetailSource] = useState<DramaSource | null>(null)
  const [detail, setDetail] = useState<DramaDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [playing, setPlaying] = useState<{ episode: DramaEpisode; url: string } | null>(null)
  const [playLoading, setPlayLoading] = useState(false)
  const seqRef = useRef(0)
  const detailSeqRef = useRef(0)
  const handledFocusRef = useRef('')
  /** 源地址 / 启停变化时强制重新拉列表，避免继续显示旧地址的缓存 */
  const lastAvailableKeyRef = useRef(availableKey)

  const singleSource = useMemo(() => {
    const targets = sourceId
      ? available.filter((source) => source.id === sourceId)
      : available
    return targets.length === 1 ? targets[0] : null
  }, [available, sourceId])

  const favOf = (ownerId: string, seriesId: string): InnerFav | undefined =>
    data.innerFavs.find((f) => f.module === FAV_MODULE && f.id === `${ownerId}|${seriesId}`)

  const toggleFav = (source: DramaSource, item: DramaItem | DramaDetail): void => {
    const favId = `${source.id}|${item.seriesId}`
    const exists = data.innerFavs.some((f) => f.module === FAV_MODULE && f.id === favId)
    update((d) => {
      if (exists) {
        return { ...d, innerFavs: d.innerFavs.filter((f) => !(f.module === FAV_MODULE && f.id === favId)) }
      }
      const fav: InnerFav = {
        module: FAV_MODULE,
        id: favId,
        title: item.title,
        subtitle: [source.name, ...item.tags.slice(0, 2)].filter(Boolean).join(' · ') || '短剧',
        cover: item.cover || null,
        savedAt: Date.now(),
        videoUrl: null,
        mediaId: 0,
        durationSec: 0,
        tweetUrl: null,
        payload: JSON.stringify({
          sourceId: source.id,
          sourceName: source.name,
          baseUrl: source.baseUrl ?? '',
          seriesId: item.seriesId
        })
      }
      return { ...d, innerFavs: [...d.innerFavs, fav] }
    })
    onNotice(exists ? '已取消收藏' : '已收藏，可在「收藏」页查看')
  }

  /** 一次加载一个源或多个源（全部源），结果合并去重 */
  async function load(
    scope: string,
    nextGenre: string,
    nextPage: number,
    kw: string
  ): Promise<void> {
    const targets = scope ? available.filter((source) => source.id === scope) : available
    const inputs = targets
      .map((source) => inputFor(source))
      .filter((input): input is DramaSourceInput => !!input)
    if (!inputs.length) {
      onNotice('还没有可用的短剧源')
      return
    }
    const seq = ++seqRef.current
    setLoading(true)
    setError('')
    // 多个源分类体系不同：全部源时不带分类
    const genreFor = inputs.length === 1 ? nextGenre : ''
    try {
      const results = await Promise.all(
        inputs.map((input) =>
          window.laozheng
            .dramaCatalog(input, genreFor, nextPage, kw)
            .catch((err: unknown) => failedCatalog(nextPage, (err as Error).message))
        )
      )
      if (seq !== seqRef.current) return
      setLoading(false)
      const okResults = results.filter((result) => result.ok)
      if (!okResults.length) {
        setError(results[0]?.error ?? '加载失败')
        if (nextPage === 1) {
          setItems([])
          setTotal(0)
          setPageCount(0)
          setHasMore(false)
        }
        return
      }

      const merged: DramaItem[] = []
      const seen = new Set<string>()
      for (const result of okResults) {
        for (const item of result.items) {
          const key = `${item.sourceId}|${item.seriesId}`
          if (seen.has(key)) continue
          seen.add(key)
          merged.push(item)
        }
      }

      const nextCategories = inputs.length === 1 ? okResults[0]?.categories ?? [] : []
      if (nextCategories.length) setCategories(nextCategories)
      else if (inputs.length > 1) setCategories([])

      // 西饭第一次进入没有指定分类：用接口返回的第一个分类作为当前分类
      let resolvedGenre = nextGenre
      if (
        inputs.length === 1 &&
        targets[0]?.id === XIFAN_DRAMA_SOURCE_ID &&
        !nextGenre &&
        nextCategories.length
      ) {
        resolvedGenre = nextCategories[0].slug
        setGenre(resolvedGenre)
      }

      const resolvedPage = Math.max(...okResults.map((result) => result.page || nextPage))
      const resolvedPageCount = Math.max(
        ...okResults.map((result) => result.pageCount || 0)
      )
      const resolvedHasMore = okResults.some((result) => result.hasMore)
      setItems(merged)
      setPage(resolvedPage)
      setPageCount(resolvedPageCount)
      setHasMore(resolvedHasMore)
      setTotal(okResults.reduce((sum, result) => sum + (result.total ?? 0), 0))
      if (nextPage === 1 && !kw) {
        saveCache<DramaCache>(cacheKeyOf(scope), {
          genre: resolvedGenre,
          items: merged,
          categories: nextCategories,
          page: resolvedPage,
          pageCount: resolvedPageCount,
          hasMore: resolvedHasMore
        })
      }
    } catch (err) {
      if (seq !== seqRef.current) return
      setLoading(false)
      setError((err as Error).message || '加载失败')
    }
  }

  // 点侧栏退出：回到列表并作废未完成的详情 / 播放请求。
  // 必须放在首次加载 effect 之前：组件挂载时 resetSignal 已有值，若排在后面会把刚发出的请求作废。
  useEffect(() => {
    if (resetSignal === undefined) return
    seqRef.current += 1
    detailSeqRef.current += 1
    setLoading(false)
    setError('')
    setDetail(null)
    setDetailSource(null)
    setPlaying(null)
    setDetailLoading(false)
    setPlayLoading(false)
  }, [resetSignal])

  // 切换短剧源：恢复该源上次的默认列表；没有缓存才请求
  useEffect(() => {
    if (!available.length) return
    if (sourceId && !available.some((source) => source.id === sourceId)) {
      setSourceId('')
      return
    }
    const sourcesChanged = lastAvailableKeyRef.current !== availableKey
    lastAvailableKeyRef.current = availableKey
    seqRef.current += 1
    detailSeqRef.current += 1
    setLoading(false)
    setDetail(null)
    setDetailSource(null)
    setPlaying(null)
    setDetailLoading(false)
    setPlayLoading(false)
    setKeyword('')
    setInput('')
    setError('')
    const cached = loadCache<DramaCache>(cacheKeyOf(sourceId), EMPTY_CACHE)
    const nextGenre = sourcesChanged ? '' : cached.genre
    setGenre(nextGenre)
    setCategories(cached.categories)
    setItems(cached.items)
    setPage(cached.page)
    setPageCount(cached.pageCount)
    setHasMore(cached.hasMore)
    if (sourcesChanged || !cached.items.length) void load(sourceId, nextGenre, 1, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, availableKey])

  // 分类数量：只有苹果CMS 源能拿到精确总数，西饭接口不返回总数就不显示
  const countsKey = `${sourceId}|${categories.map((category) => category.slug).join('|')}`
  useEffect(() => {
    setGenreCounts({})
    const input = singleSource ? inputFor(singleSource) : null
    if (!input || !categories.length) return
    if (singleSource?.id === XIFAN_DRAMA_SOURCE_ID) return
    let alive = true
    const queue = [...categories.map((category) => category.slug)]
    const worker = async (): Promise<void> => {
      for (;;) {
        const slug = queue.shift()
        if (!slug || !alive) return
        try {
          const res = await window.laozheng.dramaCatalog(input, slug, 1, '')
          if (!alive || !res.ok) continue
          const count = res.total ?? res.items.length
          setGenreCounts((prev) => ({ ...prev, [slug]: count }))
        } catch {
          // 单个分类失败不影响页面
        }
      }
    }
    void Promise.all(Array.from({ length: 3 }, worker))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countsKey])

  const openDetailByInput = async (
    input: DramaSourceInput,
    source: DramaSource,
    seriesId: string
  ): Promise<void> => {
    const seq = ++detailSeqRef.current
    setDetailLoading(true)
    setPlaying(null)
    setError('')
    try {
      const res = await window.laozheng.dramaDetail(input, seriesId)
      if (seq !== detailSeqRef.current) return
      setDetailLoading(false)
      if (!res.ok || !res.detail) {
        onNotice(res.error ?? '打开短剧失败')
        return
      }
      setDetail(res.detail)
      setDetailSource(source)
    } catch (err) {
      if (seq !== detailSeqRef.current) return
      setDetailLoading(false)
      onNotice(`打开短剧失败：${(err as Error).message}`)
    }
  }

  const openDetail = async (item: DramaItem): Promise<void> => {
    const source =
      available.find((entry) => entry.id === item.sourceId) ?? singleSource ?? available[0]
    if (!source) return
    const input = inputFor(source)
    if (!input) return
    await openDetailByInput(input, source, item.seriesId)
  }

  // 收藏入口：带着片源信息直接打开剧集
  useEffect(() => {
    if (!focus) {
      handledFocusRef.current = ''
      return
    }
    const key = `${focus.sourceId}|${focus.seriesId}|${focus.title}`
    if (handledFocusRef.current === key) return
    handledFocusRef.current = key
    const configured = data.dramaSources.find((source) => source.id === focus.sourceId)
    const baseUrl = configured?.baseUrl ?? focus.baseUrl ?? ''
    const source: DramaSource = {
      id: focus.sourceId,
      name: focus.sourceName || configured?.name || '短剧',
      enabled: true,
      builtin: focus.sourceId === XIFAN_DRAMA_SOURCE_ID,
      ...(baseUrl ? { baseUrl } : {})
    }
    const input = inputFor(source)
    if (!input) {
      onNotice('该短剧源已不可用，无法打开收藏')
      return
    }
    void openDetailByInput(input, source, focus.seriesId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.sourceId, focus?.seriesId, focus?.title])

  const playEpisode = async (episode: DramaEpisode) => {
    if (!detail || !detailSource) return
    if (episode.locked) {
      onNotice(episode.lockedReason || '该集暂不可播放')
      return
    }
    const input = inputFor(detailSource)
    if (!input) return
    setPlayLoading(true)
    try {
      const res = await window.laozheng.dramaPlay(input, detail.seriesId, episode.id)
      setPlayLoading(false)
      if (!res.ok || !res.url) {
        onNotice(res.error ?? '取播放地址失败')
        return
      }
      setPlaying({ episode, url: res.url })
    } catch (err) {
      setPlayLoading(false)
      onNotice(`取播放地址失败：${(err as Error).message}`)
    }
  }

  const backToList = () => {
    detailSeqRef.current += 1
    setDetail(null)
    setDetailSource(null)
    setPlaying(null)
    setDetailLoading(false)
    setPlayLoading(false)
  }

  const submitSearch = () => {
    const kw = input.trim()
    setKeyword(kw)
    void load(sourceId, genre, 1, kw)
  }

  const clearSearch = () => {
    setKeyword('')
    setInput('')
    void load(sourceId, genre, 1, '')
  }

  const changeGenre = (next: string) => {
    setGenre(next)
    void load(sourceId, next, 1, keyword)
  }

  const shortcuts = (
    <div className="page-actions">
      <ModuleShortcuts
        onOpenFavorites={onOpenFavorites}
        onOpenDownloads={onOpenDownloads}
      />
    </div>
  )

  if (playing && detail) {
    const fav = detailSource ? favOf(detailSource.id, detail.seriesId) : undefined
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={() => setPlaying(null)}>
            <ChevronLeft size={15} /> 返回选集
          </button>
          <h1 className="page-title">
            {detail.title} · {playing.episode.name}
          </h1>
          <div className="page-actions">
            <button
              className="btn"
              onClick={() =>
                requestDownload({
                  title: `${detail.title} ${playing.episode.name}`.trim().slice(0, 120),
                  url: playing.url,
                  kind: 'video',
                  coverUrl: detail.cover || '',
                  sourceName: detailSource?.name
                })
              }
            >
              <Download size={15} /> 下载本集
            </button>
            {detailSource ? (
              <button className="btn" onClick={() => toggleFav(detailSource, detail)}>
                <Heart size={15} fill={fav ? 'currentColor' : 'none'} /> {fav ? '已收藏' : '收藏'}
              </button>
            ) : null}
          </div>
        </header>

        <VideoPlayer
          src={playing.url}
          resumeKey={`drama|${detailSource?.id ?? detail.sourceId}|${detail.seriesId}|${playing.episode.index}`}
          onFail={onNotice}
        />

        <div className="detail-section">
          <div className="detail-section-head">
            <h3 className="melon-heading">选集</h3>
          </div>
          <div className="episode-grid">
            {detail.episodes.map((episode) => (
              <button
                key={episode.id}
                className={`episode ${episode.index === playing.episode.index ? 'active' : ''} ${
                  episode.locked ? 'locked' : ''
                }`}
                title={episode.lockedReason || episode.name}
                onClick={() => void playEpisode(episode)}
              >
                {episode.locked ? <Lock size={11} /> : null}
                {episode.name}
              </button>
            ))}
          </div>
        </div>
      </>
    )
  }

  if (detail) {
    const fav = detailSource ? favOf(detailSource.id, detail.seriesId) : undefined
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={backToList}>
            <ChevronLeft size={15} /> 返回短剧
          </button>
          <h1 className="page-title">{detail.title}</h1>
          {shortcuts}
        </header>

        <div className="detail-head">
          <div className="detail-cover">
            {detail.cover ? <img src={detail.cover} alt="" /> : null}
          </div>
          <div className="detail-meta">
            <div>
              {detail.sourceName} · 共 {detail.episodes.length} 集
              {detail.publicEpisodes && detail.publicEpisodes < detail.episodes.length
                ? ` · 公开 ${detail.publicEpisodes} 集`
                : ''}
            </div>
            {detail.tags.length ? <div>{detail.tags.join(' · ')}</div> : null}
            {detail.intro ? <div>{detail.intro}</div> : null}
            <div className="detail-actions">
              <button
                className="btn primary"
                disabled={playLoading}
                onClick={() => {
                  const firstPlayable =
                    detail.episodes.find((episode) => !episode.locked) ?? detail.episodes[0]
                  if (firstPlayable) void playEpisode(firstPlayable)
                }}
              >
                <Play size={14} /> {playLoading ? '取地址中…' : '播放'}
              </button>
              {detailSource ? (
                <button className="btn" onClick={() => toggleFav(detailSource, detail)}>
                  <Heart size={14} fill={fav ? 'currentColor' : 'none'} /> {fav ? '已收藏' : '收藏'}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-section-head">
            <h3 className="melon-heading">选集</h3>
            {detail.publicEpisodes && detail.publicEpisodes < detail.episodes.length ? (
              <span className="settings-value">
                红果网页仅公开前 {detail.publicEpisodes} 集，其余请在官方 App 观看
              </span>
            ) : null}
          </div>
          <div className="episode-grid">
            {detail.episodes.map((episode) => (
              <button
                key={episode.id}
                className={`episode ${episode.locked ? 'locked' : ''}`}
                title={episode.lockedReason || episode.name}
                onClick={() => void playEpisode(episode)}
              >
                {episode.locked ? <Lock size={11} /> : null}
                {episode.name}
              </button>
            ))}
          </div>
        </div>
      </>
    )
  }

  if (detailLoading) {
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={backToList}>
            <ChevronLeft size={15} /> 返回短剧
          </button>
          <h1 className="page-title">正在打开短剧…</h1>
        </header>
        <LoadingBlock text="正在读取剧集信息，请稍等…" />
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        {focus && onExit ? (
          <button className="btn ghost" onClick={onExit}>
            <ChevronLeft size={15} /> 返回
          </button>
        ) : null}
        <h1 className="page-title">短剧</h1>
        {shortcuts}
      </header>

      {!available.length ? (
        <EmptyState
          title="没有启用的短剧源"
          desc="到「配置管理 → 片源管理 → 短剧源」添加或启用短剧源。"
        />
      ) : (
        <>
          <SearchBar
            value={input}
            onChange={setInput}
            onSubmit={submitSearch}
            onCancel={() => {
              seqRef.current += 1
              setLoading(false)
            }}
            onClear={clearSearch}
            searching={loading}
            placeholder="输入剧名，回车搜索"
            leading={
              <select
                className="select-inline"
                value={sourceId}
                onChange={(event) => {
                  seqRef.current += 1
                  setLoading(false)
                  setSourceId(event.target.value)
                }}
                title="选择短剧源"
                style={{ maxWidth: 160 }}
              >
                <option value="">全部源（{available.length}）</option>
                {available.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            }
          />

          {!keyword && categories.length ? (
            <div className="toolbar">
              {singleSource && singleSource.id !== XIFAN_DRAMA_SOURCE_ID ? (
                <button className={`chip ${!genre ? 'active' : ''}`} onClick={() => changeGenre('')}>
                  全部
                  {total > 0 ? <span className="chip-count">{total}</span> : null}
                </button>
              ) : null}
              {categories.map((category) => {
                const count = genreCounts[category.slug]
                return (
                  <button
                    key={category.slug}
                    className={`chip ${genre === category.slug ? 'active' : ''}`}
                    onClick={() => changeGenre(category.slug)}
                  >
                    {category.label}
                    {count > 0 ? <span className="chip-count">{count}</span> : null}
                  </button>
                )
              })}
            </div>
          ) : null}

          {loading && items.length > 0 ? <LoadingBlock text="正在切换，请稍等…" /> : null}

          {error && items.length === 0 ? (
            <EmptyState
              title="加载失败"
              desc={error}
              action={
                <button className="btn" onClick={() => void load(sourceId, genre, 1, keyword)}>
                  重试
                </button>
              }
            />
          ) : loading && items.length === 0 ? (
            <LoadingBlock text="正在加载短剧…" />
          ) : items.length === 0 ? (
            <EmptyState
              title={keyword ? `没有找到「${keyword}」` : '暂无短剧'}
              desc={keyword ? '换个关键词再试。' : '可以切换短剧源或分类再看看。'}
            />
          ) : (
            <>
              <div className="comic-grid">
                {items.map((item) => {
                  const owner = available.find((source) => source.id === item.sourceId) ?? singleSource
                  const fav = favOf(owner?.id ?? item.sourceId, item.seriesId)
                  return (
                    <div key={`${item.sourceId}-${item.seriesId}`} className="comic-card">
                      <button className="comic-cover" onClick={() => void openDetail(item)}>
                        {item.cover ? <img src={item.cover} alt="" loading="lazy" /> : null}
                        {item.remarks ? <span className="comic-badge">{item.remarks}</span> : null}
                        {item.episodeCount > 0 ? (
                          <span className="media-duration">{item.episodeCount} 集</span>
                        ) : null}
                        {owner ? (
                          <span
                            className={`fav-heart ${fav ? 'on' : ''}`}
                            role="button"
                            title={fav ? '取消收藏' : '收藏'}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleFav(owner, item)
                            }}
                          >
                            <Heart size={15} fill={fav ? 'currentColor' : 'none'} />
                          </span>
                        ) : null}
                      </button>
                      <div className="comic-title" title={item.title}>
                        {item.title}
                      </div>
                      <div className="comic-sub">
                        {[item.sourceName, ...item.tags.slice(0, 3)].filter(Boolean).join(' · ') ||
                          '—'}
                      </div>
                    </div>
                  )
                })}
              </div>

              <Pagination
                page={page}
                lastPage={pageCount}
                hasMore={hasMore}
                disabled={loading}
                onChange={(next) => void load(sourceId, genre, next, keyword)}
              />
            </>
          )}
        </>
      )}
    </>
  )
}
