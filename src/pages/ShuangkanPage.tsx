import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Download, Heart, Play } from 'lucide-react'
import { EmptyState, LoadingBlock, ModuleShortcuts, Pagination } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { VideoPlayer } from '../components/VideoPlayer'
import { useData } from '../state/DataContext'
import { loadCache, saveCache } from '../utils/cache'
import { requestDownload } from '../utils/download'
import {
  SK_SORT_OPTIONS,
  defaultSkSort,
  inferSkAdapter,
  toShuangkanSourceRef,
  type SkAdapter,
  type SkCategory,
  type SkContent,
  type SkDetail,
  type SkEpisode,
  type SkItem,
  type SkSort,
  type ShuangkanFocus,
  type ShuangkanSource
} from '../shared/shuangkan'
import type { InnerFav } from '../shared/types'

const FAV_MODULE = 'shuangkan'

interface SkCache {
  category: string
  subCategory: string
  /** 镜像源的信息流：推荐 / 最新 / 热门 */
  sort: SkSort
  page: number
  lastPage: number
  items: SkItem[]
  /** 视频库的一级分类（未选分类时站点返回的那几个） */
  categories: SkCategory[]
}

const EMPTY_CACHE: SkCache = {
  category: '',
  subCategory: '',
  sort: 'latest',
  page: 1,
  lastPage: 0,
  items: [],
  categories: []
}

const cacheKeyOf = (sourceId: string): string => `shuangkan_v4_${sourceId}`

function contentLabelOf(content: SkContent): string {
  return content === 'series' ? '短剧库' : '视频库'
}

function formatCount(count?: number): string {
  if (!count || count < 0) return ''
  return count.toLocaleString('zh-CN')
}

export function ShuangkanPage({
  onNotice,
  resetSignal,
  focus,
  onExit,
  onOpenFavorites,
  onOpenDownloads
}: {
  onNotice: (text: string) => void
  resetSignal?: number
  focus?: ShuangkanFocus
  onExit?: () => void
  onOpenFavorites?: () => void
  onOpenDownloads?: () => void
}) {
  const { data, update } = useData()
  const sources = useMemo(
    () => data.shuangkanSources.filter((entry) => entry.enabled),
    [data.shuangkanSources]
  )
  const [initial] = useState(() => {
    const first = sources[0]
    const adapter: SkAdapter = first
      ? first.adapter ?? inferSkAdapter(first.baseUrl)
      : 'rou07'
    const cached = first
      ? loadCache<SkCache>(cacheKeyOf(first.id), EMPTY_CACHE)
      : { ...EMPTY_CACHE }
    const sort = SK_SORT_OPTIONS[adapter].some((entry) => entry.key === cached.sort)
      ? cached.sort
      : defaultSkSort(adapter)
    return {
      sourceId: first?.id ?? '',
      ...cached,
      sort
    }
  })
  const [sourceId, setSourceId] = useState(initial.sourceId)
  const [category, setCategory] = useState(initial.category)
  const [subCategory, setSubCategory] = useState(initial.subCategory)
  const [sort, setSort] = useState<SkSort>(initial.sort)
  const [page, setPage] = useState(initial.page)
  const [lastPage, setLastPage] = useState(initial.lastPage)
  const [items, setItems] = useState<SkItem[]>(initial.items)
  const [primaryCategories, setPrimaryCategories] = useState<SkCategory[]>(initial.categories)
  const [subCategories, setSubCategories] = useState<SkCategory[]>([])
  const [input, setInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [detailSource, setDetailSource] = useState<ShuangkanSource | null>(null)
  const [detail, setDetail] = useState<SkDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<{ episode: SkEpisode | null; url: string } | null>(null)
  const [playLoading, setPlayLoading] = useState(false)
  /** 取播放地址失败的具体原因（站点侧过期 / 风控等），不要笼统显示「解析失败」 */
  const [playError, setPlayError] = useState<string | null>(null)
  /** 从收藏直接打开时，返回按钮应该回收藏页而不是列表 */
  const [detailFromFocus, setDetailFromFocus] = useState(false)

  const requestSeq = useRef(0)
  const detailSeq = useRef(0)
  const handledFocusRef = useRef('')
  /** 已按哪个源完成过首次加载；源被停用 / 删除切到别的源时要重新加载 */
  const bootedSourceRef = useRef('')

  const activeSource = useMemo(
    () => sources.find((entry) => entry.id === sourceId) ?? sources[0] ?? null,
    [sources, sourceId]
  )

  const activeAdapter = useMemo<SkAdapter>(
    () => (activeSource ? activeSource.adapter ?? inferSkAdapter(activeSource.baseUrl) : 'rou07'),
    [activeSource]
  )

  const sortOptions = SK_SORT_OPTIONS[activeAdapter]

  useEffect(() => {
    if (!activeSource) return
    const previous = bootedSourceRef.current
    if (previous === activeSource.id) return
    bootedSourceRef.current = activeSource.id
    const switched = previous !== ''
    // 从收藏直接打开时先展示详情，列表不用急着加载
    if (focus && !switched) return
    // 缓存里只有列表、没有分类时（旧缓存 / 上次被中断），重新拉一次补全下拉
    if (!switched && initial.items.length && initial.categories.length) {
      void window.laozheng.trackShuangkanImages(
        initial.items.map((item) => item.cover).filter(Boolean),
        activeSource.baseUrl
      )
      return
    }
    // 切源（原源被停用 / 删除）时不沿用旧源的分类与页码，直接回默认首页
    void load({
      sourceId: activeSource.id,
      category: switched ? '' : initial.category,
      subCategory: switched ? '' : initial.subCategory,
      page: switched ? 1 : initial.page,
      keyword: '',
      sort: switched
        ? defaultSkSort(activeSource.adapter ?? inferSkAdapter(activeSource.baseUrl))
        : initial.sort
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource?.id])

  useEffect(() => {
    if (resetSignal === undefined) return
    // 只清理详情 / 播放状态，不要打断列表请求：
    // 点侧栏进入模块时 navEpoch 会 +1，首次进入如果在这里自增 requestSeq，
    // 会把首屏那次加载的响应丢掉，分类和列表就一直是空的
    detailSeq.current += 1
    setDetail(null)
    setDetailSource(null)
    setDetailLoading(false)
    setDetailError(null)
    setPlaying(null)
    setPlayLoading(false)
    setPlayError(null)
  }, [resetSignal])

  // 收藏入口：按收藏里的源信息直接打开详情
  useEffect(() => {
    if (!focus) {
      handledFocusRef.current = ''
      return
    }
    const key = `${focus.sourceId}|${focus.content}|${focus.id}`
    if (handledFocusRef.current === key) return
    handledFocusRef.current = key
    const configured = data.shuangkanSources.find((entry) => entry.id === focus.sourceId)
    const baseUrl = configured?.baseUrl || focus.baseUrl || ''
    if (!baseUrl) {
      onNotice('这个皇片源已被删除，无法打开收藏')
      return
    }
    const source: ShuangkanSource = {
      id: focus.sourceId,
      name: focus.sourceName || configured?.name || '皇片',
      baseUrl,
      enabled: true,
      builtin: configured?.builtin,
      testStatus: null,
      testMsg: null,
      testAt: 0
    }
    setSourceId(source.id)
    setCategory('')
    setSubCategory('')
    setSort(
      defaultSkSort(configured?.adapter ?? inferSkAdapter(baseUrl))
    )
    setKeyword('')
    setInput('')
    setPage(1)
    void openDetail(source, focus.content, { id: focus.id, title: focus.title }, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.sourceId, focus?.content, focus?.id, focus?.title])

  useEffect(() => {
    if (detail || detailLoading) {
      document.querySelector<HTMLElement>('.content')?.scrollTo({ top: 0 })
    }
  }, [detail, detailLoading])

  const load = async (next: {
    sourceId?: string
    category?: string
    subCategory?: string
    page?: number
    keyword?: string
    sort?: SkSort
  }): Promise<void> => {
    const source = sources.find((entry) => entry.id === (next.sourceId ?? sourceId)) ?? activeSource
    if (!source) return
    const nextCategory = next.category ?? category
    const nextSubCategory = next.subCategory ?? subCategory
    const nextPage = next.page ?? page
    const nextKeyword = next.keyword ?? keyword
    const nextSort = next.sort ?? sort
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    const ref = toShuangkanSourceRef(source)
    const res = nextKeyword
      ? await window.laozheng.shuangkanSearch(ref, 'video', nextKeyword, nextPage)
      : await window.laozheng.shuangkanCatalog(
          ref,
          'video',
          nextSubCategory || nextCategory,
          nextPage,
          nextSort
        )
    if (seq !== requestSeq.current) return
    setLoading(false)
    if (!res.ok) {
      setError(res.error ?? '加载失败')
      setItems([])
      return
    }
    markSourceAvailable(source)
    setSourceId(source.id)
    setCategory(nextCategory)
    setSubCategory(nextSubCategory)
    setSort(nextSort)
    setPage(res.page)
    setLastPage(res.lastPage)
    setItems(res.items)
    // 搜索结果不返回分类，保留原分类下拉，清空搜索后还能继续用
    if (!nextKeyword) {
      if (!nextCategory) {
        // 视频库首页返回的就是一级分类
        setPrimaryCategories(res.categories)
        setSubCategories([])
      } else if (!nextSubCategory) {
        // 选中一级分类后，站点额外返回的标签就是它下面的二级分类
        const base = new Set(primaryCategories.map((entry) => entry.slug))
        setSubCategories(
          res.categories.filter((entry) => !base.has(entry.slug) && entry.slug !== nextCategory)
        )
      }
    }
    void window.laozheng.trackShuangkanImages(
      res.items.map((item) => item.cover).filter(Boolean),
      source.baseUrl
    )
    // 只缓存「默认浏览态」：无分类、无搜索、第一页
    if (!nextKeyword && !nextCategory && !nextSubCategory && res.page === 1) {
      saveCache<SkCache>(cacheKeyOf(source.id), {
        category: '',
        subCategory: '',
        sort: nextSort,
        page: 1,
        lastPage: res.lastPage,
        items: res.items,
        categories: res.categories
      })
    }
  }

  const openDetail = async (
    source: ShuangkanSource,
    kind: SkContent,
    item: Pick<SkItem, 'id' | 'title'>,
    fromFocus = false
  ): Promise<void> => {
    const seq = ++detailSeq.current
    setDetailSource(source)
    setDetailFromFocus(fromFocus)
    setDetailLoading(true)
    setDetailError(null)
    setDetail(null)
    setPlaying(null)
    setPlayLoading(false)
    setPlayError(null)
    const res = await window.laozheng.shuangkanDetail(
      toShuangkanSourceRef(source),
      kind,
      item.id
    )
    if (seq !== detailSeq.current) return
    setDetailLoading(false)
    if (!res.ok || !res.detail) {
      setDetailError(res.error ?? '加载失败')
      return
    }
    markSourceAvailable(source)
    // 单集视频先点亮「正在取播放地址」，再渲染详情：
    // 否则会闪一帧「没有解析到播放地址」，实际只是还在取地址
    const single = !res.detail.episodes.length
    if (single) setPlayLoading(true)
    setDetail(res.detail)
    if (res.detail.cover) {
      void window.laozheng.trackShuangkanImages([res.detail.cover], source.baseUrl)
    }
    // v0.122：详情缓存里不再带播放地址（签名短时效，跟着 6 小时缓存会过期成 410），
    // 打开详情后单独取一次最新播放地址
    if (single) {
      const playRes = await window.laozheng.shuangkanPlay(toShuangkanSourceRef(source), item.id)
      if (seq !== detailSeq.current) return
      setPlayLoading(false)
      if (playRes.ok && playRes.url) {
        setPlaying({ episode: null, url: playRes.url })
        return
      }
      // 站点侧过期 / 风控要如实告诉用户，不要退化成「没有解析到播放地址」
      if (!playRes.ok) setPlayError(playRes.error ?? '取播放地址失败')
    }
  }

  const backToList = (): void => {
    detailSeq.current += 1
    setDetail(null)
    setDetailSource(null)
    setDetailFromFocus(false)
    setDetailLoading(false)
    setDetailError(null)
    setPlaying(null)
    setPlayLoading(false)
    setPlayError(null)
    if (detailFromFocus && onExit) {
      onExit()
      return
    }
    if (activeSource) {
      void load({
        sourceId: activeSource.id,
        category,
        subCategory,
        page,
        keyword
      })
    }
  }

  const pickSource = (next: string): void => {
    if (next === activeSource?.id) return
    const source = sources.find((entry) => entry.id === next)
    if (!source) return
    // 标记这次切换已由下面的 load 处理，避免首屏 effect 再重复加载一次
    bootedSourceRef.current = next
    const nextSort = defaultSkSort(source.adapter ?? inferSkAdapter(source.baseUrl))
    setSourceId(next)
    setInput('')
    setKeyword('')
    setCategory('')
    setSubCategory('')
    setSort(nextSort)
    setPage(1)
    setItems([])
    setPrimaryCategories([])
    setSubCategories([])
    void load({ sourceId: next, category: '', subCategory: '', page: 1, keyword: '', sort: nextSort })
  }

  const pickSort = (next: SkSort): void => {
    if (next === sort) return
    setSort(next)
    setPage(1)
    void load({ sort: next, page: 1 })
  }

  const pickCategory = (next: string): void => {
    if (next === category) return
    setCategory(next)
    setSubCategory('')
    setInput('')
    setKeyword('')
    setPage(1)
    setSubCategories([])
    void load({ category: next, subCategory: '', page: 1, keyword: '' })
  }

  const pickSubCategory = (next: string): void => {
    if (next === subCategory) return
    setSubCategory(next)
    setInput('')
    setKeyword('')
    setPage(1)
    void load({ subCategory: next, page: 1, keyword: '' })
  }

  const submitSearch = (): void => {
    const kw = input.trim()
    setKeyword(kw)
    setPage(1)
    void load({ keyword: kw, page: 1 })
  }

  const clearSearch = (): void => {
    setKeyword('')
    setInput('')
    setPage(1)
    void load({ keyword: '', page: 1 })
  }

  const goPage = (next: number): void => {
    setPage(next)
    void load({ page: next })
  }

  /** 曾经测试失败 / 显示 500 的源，请求恢复成功后自动标记回可用 */
  const markSourceAvailable = (source: ShuangkanSource): void => {
    if (source.testStatus !== 'bad') return
    update((current) => ({
      ...current,
      shuangkanSources: current.shuangkanSources.map((entry) =>
        entry.id === source.id
          ? { ...entry, testStatus: 'ok', testMsg: '自动恢复', testAt: Date.now() }
          : entry
      )
    }))
    onNotice(`${source.name} 已恢复可用`)
  }

  const favIdOf = (ownerId: string, kind: SkContent, id: string): string =>
    `${ownerId}|${kind}|${id}`

  const isFav = (favId: string): boolean =>
    data.innerFavs.some((fav) => fav.module === FAV_MODULE && fav.id === favId)

  const toggleFav = (
    source: ShuangkanSource,
    kind: SkContent,
    item: Pick<SkItem, 'id' | 'title' | 'cover' | 'meta'>
  ): void => {
    const favId = favIdOf(source.id, kind, item.id)
    const exists = isFav(favId)
    update((current) => {
      if (exists) {
        return {
          ...current,
          innerFavs: current.innerFavs.filter(
            (fav) => !(fav.module === FAV_MODULE && fav.id === favId)
          )
        }
      }
      const fav: InnerFav = {
        module: FAV_MODULE,
        id: favId,
        title: item.title,
        subtitle: [source.name, contentLabelOf(kind), ...item.meta.slice(0, 1)]
          .filter(Boolean)
          .join(' · '),
        cover: item.cover || null,
        savedAt: Date.now(),
        videoUrl: null,
        mediaId: 0,
        durationSec: 0,
        tweetUrl: null,
        payload: JSON.stringify({
          sourceId: source.id,
          sourceName: source.name,
          baseUrl: source.baseUrl,
          content: kind,
          id: item.id,
          title: item.title
        })
      }
      return { ...current, innerFavs: [...current.innerFavs, fav] }
    })
    onNotice(exists ? '已取消收藏' : '已收藏，可在「收藏」页查看')
  }

  const playEpisode = async (episode: SkEpisode): Promise<void> => {
    if (!detail || !detailSource) return
    const seq = ++detailSeq.current
    setPlayLoading(true)
    const res = await window.laozheng.shuangkanPlay(
      toShuangkanSourceRef(detailSource),
      episode.id
    )
    if (seq !== detailSeq.current) return
    setPlayLoading(false)
    if (!res.ok || !res.url) {
      onNotice(res.error ?? '取播放地址失败')
      return
    }
    setPlaying({ episode, url: res.url })
  }

  const download = (): void => {
    if (!detail || !detailSource || !playing) return
    requestDownload({
      title: [detail.title, playing.episode?.name].filter(Boolean).join(' ').slice(0, 120),
      url: playing.url,
      kind: 'video',
      coverUrl: detail.cover || '',
      sourceName: detailSource.name,
      ...(detailSource.baseUrl
        ? { referer: `${detailSource.baseUrl.replace(/\/+$/, '')}/` }
        : {})
    })
  }

  const shortcuts = (
    <div className="page-actions">
      <ModuleShortcuts onOpenFavorites={onOpenFavorites} onOpenDownloads={onOpenDownloads} />
    </div>
  )

  if (detailLoading || detailError) {
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={backToList}>
            <ChevronLeft size={15} /> 返回
          </button>
          <h1 className="page-title">皇片</h1>
          {shortcuts}
        </header>
        {detailLoading ? (
          <EmptyState title="正在打开…" desc="正在解析内容，请稍等。" />
        ) : (
          <EmptyState
            title="打开失败"
            desc={detailError ?? '请稍后重试'}
            action={
              <button className="btn" onClick={backToList}>
                返回列表
              </button>
            }
          />
        )}
      </>
    )
  }

  if (detail && detailSource) {
    const detailFavId = favIdOf(detailSource.id, detail.source, detail.id)
    const fav = isFav(detailFavId)
    const currentEpisode = playing?.episode ?? null
    const playingIndex = currentEpisode?.index ?? 0
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={backToList}>
            <ChevronLeft size={15} /> {detailFromFocus ? '返回' : '返回皇片'}
          </button>
          <h1 className="page-title">
            {detail.title}
            {playing?.episode ? ` · ${playing.episode.name}` : ''}
          </h1>
          <div className="page-actions">
            {playing ? (
              <button className="btn" onClick={download}>
                <Download size={15} /> {detail.episodes.length ? '下载本集' : '下载'}
              </button>
            ) : null}
            <button
              className="btn"
              onClick={() => toggleFav(detailSource, detail.source, detail)}
            >
              <Heart size={15} fill={fav ? 'currentColor' : 'none'} /> {fav ? '已收藏' : '收藏'}
            </button>
          </div>
        </header>

        <div className="detail-head">
          <div className="detail-cover">
            {detail.cover ? <img src={detail.cover} alt="" /> : null}
          </div>
          <div className="detail-meta" style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15, color: 'var(--text)' }}>{detail.title}</strong>
            <div>
              {detailSource.name} · {contentLabelOf(detail.source)}
              {detail.duration ? ` · ${detail.duration}` : ''}
            </div>
            {detail.meta.length ? <div>{detail.meta.join(' · ')}</div> : null}
            {detail.tags.length ? <div>#{detail.tags.join(' #')}</div> : null}
            {detail.intro ? <div>{detail.intro}</div> : null}
            {detail.episodes.length ? (
              <div className="detail-actions">
                <button
                  className="btn primary"
                  disabled={playLoading}
                  onClick={() => {
                    const first = detail.episodes[0]
                    if (first) void playEpisode(first)
                  }}
                >
                  <Play size={14} /> {playLoading ? '取地址中…' : '播放'}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {playing ? (
          <VideoPlayer
            src={playing.url}
            resumeKey={`shuangkan|${detailSource.id}|${detail.id}|${playingIndex}`}
            onFail={onNotice}
            // v0.122：网关节点会随机失效、播放地址签名也会过期，
            // 播放器致命错误时重新向主进程要一次最新地址（主进程会重新探测可用链路）
            onRetrySrc={async () => {
              const id = playing.episode?.id ?? detail.id
              const res = await window.laozheng.shuangkanPlay(
                toShuangkanSourceRef(detailSource),
                id
              )
              return res.ok ? res.url ?? null : null
            }}
            onEnded={
              detail.episodes.length && currentEpisode
                ? () => {
                    const next = detail.episodes.find(
                      (episode) => episode.index === currentEpisode.index + 1
                    )
                    if (next) {
                      void playEpisode(next)
                      onNotice(`自动播放下一集：${next.name}`)
                    }
                  }
                : undefined
            }
          />
        ) : null}

        {!playing && !detail.episodes.length ? (
          playLoading ? (
            <LoadingBlock text="正在加载播放地址…" />
          ) : (
            <EmptyState
              title={playError ? '这个视频暂时不能播放' : '没有解析到播放地址'}
              desc={playError ?? '可能需要在浏览器里观看。'}
            />
          )
        ) : null}

        {detail.episodes.length ? (
          <div className="detail-section">
            <div className="detail-section-head">
              <h3 className="melon-heading">选集</h3>
            </div>
            <div className="episode-grid">
              {detail.episodes.map((episode) => (
                <button
                  key={episode.id}
                  className={`episode ${episode.index === playingIndex ? 'active' : ''}`}
                  title={episode.duration || episode.name}
                  onClick={() => void playEpisode(episode)}
                >
                  {episode.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </>
    )
  }

  if (!activeSource) {
    return (
      <>
        <header className="page-header">
          {focus && onExit ? (
            <button className="btn ghost" onClick={onExit}>
              <ChevronLeft size={15} /> 返回
            </button>
          ) : null}
          <h1 className="page-title">皇片</h1>
          {shortcuts}
        </header>
        <EmptyState
          title="还没有皇片源"
          desc="打开 设置 → 片源管理 → 皇片源，添加或启用皇片源后就能浏览了。"
        />
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
        <h1 className="page-title">皇片</h1>
        {shortcuts}
      </header>

      <SearchBar
        value={input}
        onChange={setInput}
        onSubmit={submitSearch}
        onClear={clearSearch}
        placeholder={`在 ${activeSource.name} 搜索…`}
        onRefresh={() => {
          void window.laozheng.forceRefresh('shuangkan').catch(() => {})
          void load({ page: 1 })
        }}
        refreshing={loading}
        leading={
          <select
            className="select-inline wallpaper-select"
            value={activeSource.id}
            title="皇片源"
            onChange={(event) => pickSource(event.target.value)}
          >
            {sources.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        }
      />

      {activeAdapter === 'rou07' ? (
        <div className="toolbar">
          <select
            className="select-inline wallpaper-category-select"
            value={category}
            title="一级分类"
            onChange={(event) => pickCategory(event.target.value)}
          >
            <option value="">全部分类</option>
            {primaryCategories.map((entry) => (
              <option key={entry.slug} value={entry.slug}>
                {entry.label}
                {entry.count ? ` (${formatCount(entry.count)})` : ''}
              </option>
            ))}
          </select>
          <select
            className="select-inline wallpaper-category-select"
            value={subCategory}
            title="二级分类"
            disabled={!category || subCategories.length === 0}
            onChange={(event) => pickSubCategory(event.target.value)}
          >
            <option value="">全部子分类</option>
            {subCategories.map((entry) => (
              <option key={entry.slug} value={entry.slug}>
                {entry.label}
                {entry.count ? ` (${formatCount(entry.count)})` : ''}
              </option>
            ))}
          </select>
        </div>
      ) : (
        // 镜像源只有一级分类，直接铺成标签，不用下拉
        <div className="toolbar">
          {sortOptions.map((option) => (
            <button
              key={option.key}
              className={`chip${sort === option.key ? ' active' : ''}`}
              onClick={() => pickSort(option.key)}
            >
              {option.label}
            </button>
          ))}
          <button
            className={`chip${category === '' ? ' active' : ''}`}
            onClick={() => pickCategory('')}
          >
            全部
          </button>
          {primaryCategories.map((entry) => (
            <button
              key={entry.slug}
              className={`chip${category === entry.slug ? ' active' : ''}`}
              onClick={() => pickCategory(entry.slug)}
            >
              {entry.label}
              {entry.count ? <span className="chip-count">{formatCount(entry.count)}</span> : null}
            </button>
          ))}
        </div>
      )}

      {loading && items.length > 0 ? (
        <LoadingBlock text="正在切换，请稍等…" />
      ) : null}

      {error && items.length === 0 ? (
        <EmptyState
          title="加载失败"
          desc={error}
          action={
            <button className="btn" onClick={() => void load({ page })}>
              重试
            </button>
          }
        />
      ) : loading && items.length === 0 ? (
        <LoadingBlock text="正在加载皇片…" />
      ) : items.length === 0 ? (
        <EmptyState
          title={keyword ? '没有找到匹配的内容' : '这里暂时没有内容'}
          desc={keyword ? '换一个关键词再试。' : '换一个分类或皇片源看看。'}
        />
      ) : (
        <>
          <div className="media-grid">
            {items.map((item) => {
              const favId = favIdOf(activeSource.id, 'video', item.id)
              const fav = isFav(favId)
              return (
                <div
                  key={item.id}
                  className="media-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => void openDetail(activeSource, 'video', item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      void openDetail(activeSource, 'video', item)
                    }
                  }}
                >
                  <span className="media-thumb">
                    {item.cover ? <img src={item.cover} alt="" loading="lazy" /> : null}
                    {item.duration ? (
                      <span className="media-duration">{item.duration}</span>
                    ) : null}
                    <button
                      className={`fav-heart ${fav ? 'on' : ''}`}
                      title={fav ? '取消收藏' : '收藏'}
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleFav(activeSource, 'video', item)
                      }}
                    >
                      <Heart size={14} fill={fav ? 'currentColor' : 'none'} />
                    </button>
                  </span>
                  <span className="media-title">{item.title}</span>
                  <span className="media-meta">{item.meta.join(' · ')}</span>
                </div>
              )
            })}
          </div>

          <Pagination page={page} lastPage={lastPage} disabled={loading} onChange={goPage} />
        </>
      )}
    </>
  )
}
