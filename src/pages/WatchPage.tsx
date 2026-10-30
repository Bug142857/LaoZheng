import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Download, Heart } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, ModuleShortcuts, Pagination } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { VideoPlayer } from '../components/VideoPlayer'
import { loadCache, saveCache } from '../utils/cache'
import { requestDownload } from '../utils/download'
import {
  h1FixedSource,
  parsePlayGroups,
  type VodCategory,
  type VodEpisode,
  type VodItem,
  type VodPlayGroup
} from '../shared/vod'
import type { InnerFav, VodSource } from '../shared/types'

type WatchResult = VodItem & { sourceId: string; sourceName: string; score: number }

interface Playback {
  source: VodSource
  item: VodItem
  groups: VodPlayGroup[]
  groupIndex: number
  episodeIndex: number
  url: string
}

/** 从收藏进入：带片源信息时直接解析出全部分集 */
export interface WatchFocus {
  url?: string
  title: string
  sourceId?: string
  sourceName?: string
  vodId?: number
  groupName?: string
}

function toInput(source: VodSource): { id: string; name: string; baseUrl: string } {
  return { id: source.id, name: source.name, baseUrl: source.baseUrl }
}

/** 番1~番4 固定片源（与手机端 v0.325 一致，不读片源管理配置） */
function fixedSource(index: number): VodSource | null {
  const input = h1FixedSource(index)
  if (!input) return null
  return {
    id: input.id,
    name: input.name,
    baseUrl: input.baseUrl,
    enabled: true,
    region: 'proxy',
    regionManual: true,
    testStatus: null,
    testMsg: null,
    testAt: 0
  }
}

const CONCURRENCY = 6

interface H1Cache {
  items: VodItem[]
  total: number
  page: number
  pageCount: number
  categories: VodCategory[]
  /** 只缓存默认分类第一页，避免重开应用后停在别的分类 */
  typeId?: number
}

const EMPTY_H1: H1Cache = { items: [], total: 0, page: 1, pageCount: 1, categories: [], typeId: 0 }

/** 记录收藏里上次看到哪一集：readProgress 里按片源 + 条目存集名 */
function episodeProgressKey(sourceId: string, vodId: number): string {
  return `vodEp|${sourceId}|${vodId}`
}

/** 采集站偶尔把时长写成 0 / HD / 空，只有真正的时间才展示 */
function hasDuration(value: string | undefined): boolean {
  const text = (value ?? '').trim()
  if (!text) return false
  if (/^\d{1,3}:\d{2}(:\d{2})?$/.test(text)) return true
  return /^\d+\s*(分钟|分|min|mins|minutes)$/i.test(text)
}

export function WatchPage({
  onNotice,
  variant,
  focus,
  searchTitle,
  resetSignal,
  onExit,
  onOpenFavorites,
  onOpenDownloads
}: {
  onNotice: (text: string) => void
  /** 番1~番4：固定绑定第 index 个片源，整站浏览 */
  variant?: { label: string; index: number }
  /** 从收藏进入：尽量直接续播并显示集数 */
  focus?: WatchFocus
  /** 清单条目「在线观看」：按片名自动搜源 */
  searchTitle?: string
  /** 点侧栏进入模块时回到列表（不保留上次播放页） */
  resetSignal?: number
  /** 从收藏 / 清单进入时，播放页返回要走全局上一页 */
  onExit?: () => void
  onOpenFavorites?: () => void
  onOpenDownloads?: () => void
}) {
  const { data, update } = useData()
  const favModule = variant ? 'h1' : 'watch'
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<WatchResult[]>([])
  const [sourceErrors, setSourceErrors] = useState<{ name: string; error: string }[]>([])
  const [playback, setPlayback] = useState<Playback | null>(null)
  /** 当前播放页是不是从收藏 / 清单外部入口进来的：是则返回走上一页 */
  const [externalPlayback, setExternalPlayback] = useState(false)
  const [episodeAsc, setEpisodeAsc] = useState(false)
  const [loadingName, setLoadingName] = useState<string | null>(null)
  const [focusLoading, setFocusLoading] = useState(false)
  const seqRef = useRef(0)
  const handledFocusRef = useRef('')
  const handledSearchRef = useRef('')
  const playbackRef = useRef<HTMLDivElement | null>(null)
  /** 播放失败时只自动往上一集降一次，避免连续失败一路跳到底 */
  const downgradedRef = useRef(false)

  // 番号（固定片源）的整站浏览状态（每个番号独立缓存）
  const h1Source = useMemo(() => (variant ? fixedSource(variant.index) : null), [variant])
  const h1CacheKey = `h1_${variant?.index ?? 0}`
  const h1Initial = useMemo(() => {
    const cached = loadCache<H1Cache>(h1CacheKey, EMPTY_H1)
    // 只接受「默认分类 + 第一页」的缓存，旧缓存里可能是别的分类
    if (cached.page !== 1 || (cached.typeId ?? 0) !== 0) return EMPTY_H1
    return cached
  }, [h1CacheKey])
  const [h1Keyword, setH1Keyword] = useState('')
  const [h1Input, setH1Input] = useState('')
  const [h1Items, setH1Items] = useState<VodItem[]>(h1Initial.items)
  const [h1Total, setH1Total] = useState(h1Initial.total)
  const [h1Page, setH1Page] = useState(h1Initial.page)
  const [h1PageCount, setH1PageCount] = useState(h1Initial.pageCount)
  const [h1Categories, setH1Categories] = useState<VodCategory[]>(h1Initial.categories)
  const [h1Counts, setH1Counts] = useState<Record<number, number>>({})
  const [h1Type, setH1Type] = useState(0)
  const [h1Loading, setH1Loading] = useState(!h1Initial.items.length)
  const [h1Error, setH1Error] = useState<string | null>(null)
  const h1Seq = useRef(0)

  useEffect(() => {
    if (playback) playbackRef.current?.scrollIntoView({ block: 'start' })
  }, [playback])

  // 离开再点侧栏进入时回到列表
  useEffect(() => {
    if (resetSignal === undefined) return
    setPlayback(null)
    setLoadingName(null)
    setFocusLoading(false)
  }, [resetSignal])

  // 收藏 / 在线观看入口清空后允许下次再次触发
  useEffect(() => {
    if (!focus) {
      handledFocusRef.current = ''
      setFocusLoading(false)
    }
  }, [focus])
  useEffect(() => {
    if (!searchTitle) handledSearchRef.current = ''
  }, [searchTitle])

  const loadH1 = async (page: number, kw: string, typeId: number) => {
    if (!h1Source) return
    const seq = ++h1Seq.current
    setH1Loading(true)
    setH1Error(null)
    const res = await window.laozheng.listVod(toInput(h1Source), page, typeId, kw)
    if (seq !== h1Seq.current) return
    setH1Loading(false)
    if (!res.ok) {
      setH1Error(res.error ?? '加载失败')
      return
    }
    setH1Items(res.items ?? [])
    setH1Total(res.total ?? 0)
    setH1Page(res.page ?? page)
    setH1PageCount(res.pageCount ?? 1)
    if (res.categories?.length) setH1Categories(res.categories)
    // 只缓存默认视图（全部 + 第一页 + 无关键词）
    if (page === 1 && typeId === 0 && !kw) {
      saveCache<H1Cache>(h1CacheKey, {
        items: res.items ?? [],
        total: res.total ?? 0,
        page: 1,
        pageCount: res.pageCount ?? 1,
        categories: res.categories?.length ? res.categories : h1Categories,
        typeId: 0
      })
    }
  }

  /** 分类列表要用 ac=list 才拿得到，数量用每类第一页的 total 探测 */
  const loadH1Categories = async () => {
    if (!h1Source) return
    const res = await window.laozheng.vodCategories(toInput(h1Source))
    if (!res.ok || !res.categories?.length) return
    setH1Categories(res.categories)
    const queue = [...res.categories]
    const worker = async (): Promise<void> => {
      for (;;) {
        const category = queue.shift()
        if (!category) return
        const list = await window.laozheng.listVod(toInput(h1Source), 1, category.type_id, '')
        if (list.ok) {
          setH1Counts((prev) => ({ ...prev, [category.type_id]: list.total ?? 0 }))
        }
      }
    }
    void Promise.all(Array.from({ length: 4 }, worker))
  }

  useEffect(() => {
    if (!h1Source) return
    void loadH1Categories()
    if (!h1Initial.items.length) void loadH1(1, '', 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h1Source?.id])

  // 列表接口经常不给时长：给缺时长的前 16 条补一次详情（结果有缓存，翻回同一页不再请求）
  const missingDurationIds = h1Items
    .filter((item) => !hasDuration(item.vod_duration))
    .slice(0, 16)
    .map((item) => item.vod_id)
    .join(',')

  useEffect(() => {
    if (!h1Source || !missingDurationIds) return
    let alive = true
    const ids = missingDurationIds
      .split(',')
      .map((value) => Number.parseInt(value, 10))
      .filter((id) => Number.isFinite(id) && id > 0)
    let cursor = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const id = ids[cursor++]
        if (id === undefined || !alive) return
        const res = await window.laozheng.fetchVodDetail(toInput(h1Source), id)
        if (!alive || !res.ok || !res.item) continue
        const duration = res.item.vod_duration
        if (!hasDuration(duration)) continue
        setH1Items((prev) =>
          prev.map((item) => (item.vod_id === id ? { ...item, vod_duration: duration } : item))
        )
      }
    }
    void Promise.all(Array.from({ length: 3 }, worker))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingDurationIds, h1Source?.id])

  // 不再区分国内 / 外网目录：观影搜索全部已启用片源
  const sources = useMemo(() => data.vodSources.filter((s) => s.enabled), [data.vodSources])
  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources])
  const allSourceById = useMemo(
    () => new Map(data.vodSources.map((s) => [s.id, s])),
    [data.vodSources]
  )

  const favOf = (sourceId: string, vodId: number): InnerFav | undefined =>
    data.innerFavs.find((f) => f.module === favModule && f.id === `${sourceId}|${vodId}`)

  const toggleFav = (
    source: VodSource,
    item: VodItem,
    groups?: VodPlayGroup[],
    groupIndex?: number,
    episodeIndex?: number
  ) => {
    const favId = `${source.id}|${item.vod_id}`
    const exists = data.innerFavs.some((f) => f.module === favModule && f.id === favId)
    update((d) => {
      if (exists) {
        return { ...d, innerFavs: d.innerFavs.filter((f) => !(f.module === favModule && f.id === favId)) }
      }
      const group = groups?.[groupIndex ?? 0]
      const episode = group?.episodes[episodeIndex ?? 0]
      const fav: InnerFav = {
        module: favModule,
        id: favId,
        title: item.vod_name,
        subtitle: [source.name, item.vod_year].filter(Boolean).join(' · '),
        cover: item.vod_pic || null,
        savedAt: Date.now(),
        videoUrl: episode?.url ?? null,
        mediaId: item.vod_id,
        durationSec: 0,
        tweetUrl: null,
        payload: JSON.stringify({
          sourceId: source.id,
          sourceName: source.name,
          vodId: item.vod_id,
          groupName: group?.name ?? '',
          episodeName: episode?.name ?? ''
        })
      }
      return { ...d, innerFavs: [...d.innerFavs, fav] }
    })
    onNotice(exists ? '已取消收藏' : '已收藏，可在「收藏」页查看')
  }

  const runSearch = async (raw: string) => {
    const kw = raw.trim()
    if (!kw || searching) return
    if (!sources.length) {
      onNotice('还没有可用的片源，请到「配置管理 → 片源管理」添加')
      return
    }
    const seq = ++seqRef.current
    setSearching(true)
    setSearched(true)
    setResults([])
    setSourceErrors([])
    setProgress({ done: 0, total: sources.length })
    const year = kw.match(/\b(19|20)\d{2}\b/)?.[0] ?? ''
    const queue = [...sources]
    const errors: { name: string; error: string }[] = []
    let done = 0

    const worker = async () => {
      for (;;) {
        const source = queue.shift()
        if (!source) return
        const res = await window.laozheng.searchVod(toInput(source), kw, year)
        if (seq !== seqRef.current) return
        done += 1
        setProgress({ done, total: sources.length })
        if (!res.ok) {
          errors.push({ name: source.name, error: res.error ?? '搜索失败' })
          setSourceErrors([...errors])
          continue
        }
        if (!res.items.length) continue
        // 每搜到一个源就实时追加，不等全部完成
        setResults((prev) =>
          [
            ...prev,
            ...res.items.map((item) => ({
              ...item,
              sourceId: source.id,
              sourceName: source.name
            }))
          ].sort((a, b) => b.score - a.score)
        )
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    if (seq !== seqRef.current) return
    setSearching(false)
  }

  /** 停止搜索：保留已搜到的结果，丢弃还没返回的源 */
  const stopSearch = () => {
    seqRef.current += 1
    setSearching(false)
    setProgress((prev) => ({ ...prev, done: prev.total }))
  }

  const startPlayback = (
    source: VodSource,
    item: VodItem,
    groups: VodPlayGroup[],
    groupIndex = 0,
    episodeIndex?: number,
    external = false,
    autoDowngrade = false
  ) => {
    const group = groups[groupIndex]
    if (!group?.episodes.length) {
      onNotice('该片源没有返回可播放地址，换一个片源试试')
      return
    }
    const index = Math.min(
      episodeIndex ?? group.episodes.length - 1,
      group.episodes.length - 1
    )
    const episode: VodEpisode = group.episodes[Math.max(0, index)]
    if (!autoDowngrade) downgradedRef.current = false
    setExternalPlayback(external)
    setPlayback({ source, item, groups, groupIndex, episodeIndex: Math.max(0, index), url: episode.url })
    // 记住最后看到哪一集：从收藏再次进入时直接续这一集（跨重启保留）
    if (item.vod_id > 0) {
      const progressKey = episodeProgressKey(source.id, item.vod_id)
      const value = `${group.name}|${episode.name}`
      if (data.readProgress[progressKey] !== value) {
        update((d) => ({
          ...d,
          readProgress: { ...d.readProgress, [progressKey]: value }
        }))
      }
    }
  }

  /** 点搜索结果直接进播放页：默认播放最新一集，集数默认倒序 */
  const openDetail = async (source: VodSource, item: VodItem) => {
    setLoadingName(item.vod_name)
    setEpisodeAsc(false)
    const immediate = parsePlayGroups(item.vod_play_from, item.vod_play_url)
    if (immediate.length) {
      setLoadingName(null)
      startPlayback(source, item, immediate)
      return
    }
    const res = await window.laozheng.fetchVodDetail(toInput(source), item.vod_id)
    setLoadingName(null)
    if (res.ok && res.item && res.groups?.length) {
      startPlayback(source, { ...item, ...res.item }, res.groups)
    } else {
      onNotice(`获取播放地址失败：${res.error ?? '该片源没有可播放地址'}`)
    }
  }

  /** 下载当前播放的这一集（番1~番4 播放页） */
  const downloadEpisode = (state: Playback) => {
    const group = state.groups[state.groupIndex]
    const episode = group?.episodes[state.episodeIndex]
    if (!episode) return
    requestDownload({
      title: `${state.item.vod_name} ${episode.name}`.trim().slice(0, 120),
      url: episode.url,
      kind: 'video',
      coverUrl: state.item.vod_pic || '',
      sourceName: state.source.name
    })
  }

  /** 收藏入口：有片源信息就重新解析分集，没有则按标题搜源 */
  const resolveFocusSource = (sourceId?: string, sourceName?: string): VodSource | null => {
    if (sourceId) {
      if (h1Source && h1Source.id === sourceId) return h1Source
      if (sourceId.startsWith('h1_fixed_')) {
        const index = Number.parseInt(sourceId.replace('h1_fixed_', ''), 10) - 1
        return fixedSource(index)
      }
      return allSourceById.get(sourceId) ?? sourceById.get(sourceId) ?? null
    }
    // 旧收藏没有 payload：按收藏里保存的片源名回退匹配
    if (sourceName) {
      const candidates = [
        ...[0, 1, 2, 3].map((i) => fixedSource(i)),
        ...data.vodSources
      ].filter((s): s is VodSource => !!s)
      return candidates.find((s) => s.name === sourceName) ?? null
    }
    return null
  }

  const playFocus = async (target: WatchFocus) => {
    setEpisodeAsc(false)
    const source = resolveFocusSource(target.sourceId, target.sourceName)
    if (source && target.vodId) {
      const res = await window.laozheng.fetchVodDetail(toInput(source), target.vodId)
      if (res.ok && res.item && res.groups?.length) {
        const groups = res.groups
        // 优先续「上次看到的那一集」（收藏后可能又看了别的集），没有再按收藏里保存的地址找
        const saved = data.readProgress[episodeProgressKey(source.id, target.vodId)] ?? ''
        const [savedGroup, savedEp] = saved.includes('|') ? saved.split('|') : ['', saved]
        let gi = savedEp
          ? groups.findIndex(
              (g) =>
                (!savedGroup || g.name === savedGroup) &&
                g.episodes.some((ep) => ep.name === savedEp)
            )
          : -1
        let index =
          gi >= 0 ? groups[gi].episodes.findIndex((ep) => ep.name === savedEp) : -1
        if (index < 0) {
          gi = Math.max(
            0,
            groups.findIndex((g) => g.episodes.some((ep) => ep.url === target.url))
          )
          index = groups[gi].episodes.findIndex((ep) => ep.url === target.url)
        }
        startPlayback(
          source,
          res.item,
          groups,
          Math.max(0, gi),
          index >= 0 ? index : groups[Math.max(0, gi)].episodes.length - 1,
          true
        )
        return true
      }
    }
    if (target.url) {
      startPlayback(
        source ?? {
          id: 'fav',
          name: '收藏',
          baseUrl: '',
          enabled: true,
          region: 'cn',
          regionManual: true,
          testStatus: null,
          testMsg: null,
          testAt: 0
        },
        {
          vod_id: target.vodId ?? 0,
          vod_name: target.title,
          vod_pic: '',
          type_name: '',
          vod_year: '',
          vod_area: '',
          vod_remarks: '',
          vod_duration: '',
          vod_douban_id: 0,
          vod_play_from: '收藏',
          vod_play_url: ''
        },
        [{ name: target.groupName || '收藏', episodes: [{ name: '播放', url: target.url }] }],
        0,
        0,
        true
      )
      return true
    }
    return false
  }

  useEffect(() => {
    if (!focus) return
    const key = `${focus.sourceId ?? ''}|${focus.sourceName ?? ''}|${focus.vodId ?? ''}|${focus.url ?? ''}|${focus.title}`
    if (handledFocusRef.current === key) return
    handledFocusRef.current = key
    setPlayback(null)
    setFocusLoading(true)
    let alive = true
    void (async () => {
      const played = await playFocus(focus)
      if (!alive) {
        // 用户在解析途中返回：把可能已经挂上的播放页关掉，避免后台出声
        setPlayback(null)
        setExternalPlayback(false)
        return
      }
      setFocusLoading(false)
      if (played) return
      setKeyword(focus.title)
      void runSearch(focus.title)
    })()
    return () => {
      alive = false
      setPlayback(null)
      setExternalPlayback(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.sourceId, focus?.sourceName, focus?.vodId, focus?.url, focus?.title])

  // 清单条目「在线观看」：按片名直接搜源
  useEffect(() => {
    const title = searchTitle?.trim()
    if (!title) return
    if (handledSearchRef.current === title) return
    handledSearchRef.current = title
    setKeyword(title)
    setPlayback(null)
    void runSearch(title)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTitle])

  if (playback) {
    const group = playback.groups[playback.groupIndex]
    const fav = favOf(playback.source.id, playback.item.vod_id)
    /** 旧收藏没有片源信息时用临时直链播放，不提供收藏/下载，避免写入脏数据 */
    const virtualSource = playback.source.id === 'fav'
    const ordered = (group?.episodes ?? []).map((ep, index) => ({ ep, index }))
    if (!episodeAsc) ordered.reverse()
    return (
      <div ref={playbackRef}>
        <header className="page-header">
          <button
            className="btn ghost"
            onClick={() => {
              // 先清掉播放页自身状态，再走全局上一页；否则从收藏返回后会再看到播放页
              setPlayback(null)
              setExternalPlayback(false)
              if (externalPlayback && onExit) onExit()
            }}
          >
            <ChevronLeft size={15} /> 返回
          </button>
          <h1 className="page-title">{playback.item.vod_name}</h1>
          <div className="page-actions">
            {variant && !virtualSource ? (
              <button className="btn" onClick={() => downloadEpisode(playback)}>
                <Download size={15} /> 下载本集
              </button>
            ) : null}
            {virtualSource ? null : (
              <button
                className="btn"
                onClick={() =>
                  toggleFav(
                    playback.source,
                    playback.item,
                    playback.groups,
                    playback.groupIndex,
                    playback.episodeIndex
                  )
                }
              >
                <Heart size={15} fill={fav ? 'currentColor' : 'none'} /> {fav ? '已收藏' : '收藏'}
              </button>
            )}
          </div>
        </header>

        <VideoPlayer
          src={playback.url}
          resumeKey={`vod|${playback.item.vod_name}|${
            playback.groups[playback.groupIndex]?.episodes[playback.episodeIndex]?.name ?? ''
          }`}
          onFail={(msg) => {
            // 默认最新一集失效时自动退到上一集（只退一次），避免停在黑屏
            if (!downgradedRef.current && playback.episodeIndex > 0) {
              downgradedRef.current = true
              onNotice('当前集播放失败，已自动切到上一集')
              startPlayback(
                playback.source,
                playback.item,
                playback.groups,
                playback.groupIndex,
                playback.episodeIndex - 1,
                externalPlayback,
                true
              )
              return
            }
            onNotice(msg)
          }}
        />

        <div className="toolbar" style={{ marginTop: 14 }}>
          {playback.groups.length > 1
            ? playback.groups.map((g, gi) => (
                <button
                  key={`${g.name}-${gi}`}
                  className={`chip ${gi === playback.groupIndex ? 'active' : ''}`}
                  onClick={() =>
                    startPlayback(
                      playback.source,
                      playback.item,
                      playback.groups,
                      gi,
                      undefined,
                      externalPlayback
                    )
                  }
                >
                  {g.name}
                </button>
              ))
            : null}
          <button className="btn ghost" onClick={() => setEpisodeAsc((v) => !v)}>
            集数：{episodeAsc ? '正序' : '倒序'}
          </button>
        </div>

        <div className="episode-grid">
          {ordered.map(({ ep, index }) => (
            <button
              key={`${ep.url}-${index}`}
              className={`episode ${index === playback.episodeIndex ? 'active' : ''}`}
              onClick={() =>
                startPlayback(
                  playback.source,
                  playback.item,
                  playback.groups,
                  playback.groupIndex,
                  index,
                  externalPlayback
                )
              }
            >
              {ep.name}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (focusLoading) {
    return (
      <>
        <header className="page-header">
          {onExit ? (
            <button className="btn ghost" onClick={onExit}>
              <ChevronLeft size={15} /> 返回
            </button>
          ) : null}
          <h1 className="page-title">{focus?.title || '正在打开…'}</h1>
        </header>
        <EmptyState title="正在打开播放页…" desc="正在解析片源与剧集，请稍等。" />
      </>
    )
  }

  if (variant && h1Source) {
    // 数量已探测到 0 的分类不显示（未探测到的先保留，避免闪现）
    const visibleCats = h1Categories.filter((c) => h1Counts[c.type_id] !== 0)
    return (
      <>
        <header className="page-header">
          <h1 className="page-title">{variant.label}</h1>
          <div className="page-actions">
            <ModuleShortcuts onOpenFavorites={onOpenFavorites} onOpenDownloads={onOpenDownloads} />
          </div>
        </header>

        <SearchBar
          value={h1Input}
          onChange={(value) => {
            setH1Input(value)
            if (!value) {
              setH1Keyword('')
              void loadH1(1, '', h1Type)
            }
          }}
          onSubmit={() => {
            const kw = h1Input.trim()
            setH1Keyword(kw)
            void loadH1(1, kw, h1Type)
          }}
          onCancel={() => {
            h1Seq.current += 1
            setH1Loading(false)
          }}
          onClear={() => {
            setH1Keyword('')
            void loadH1(1, '', h1Type)
          }}
          searching={h1Loading}
          placeholder={`在 ${h1Source.name} 里搜索`}
        />

        {!h1Keyword && visibleCats.length > 0 && (
          <div className="toolbar">
            <button
              className={`chip ${h1Type === 0 ? 'active' : ''}`}
              onClick={() => {
                setH1Type(0)
                void loadH1(1, h1Keyword, 0)
              }}
            >
              全部
              {h1Total > 0 ? <span className="chip-count">{h1Total}</span> : null}
            </button>
            {visibleCats.map((c) => (
              <button
                key={c.type_id}
                className={`chip ${h1Type === c.type_id ? 'active' : ''}`}
                onClick={() => {
                  setH1Type(c.type_id)
                  void loadH1(1, h1Keyword, c.type_id)
                }}
              >
                {c.type_name}
                {h1Counts[c.type_id] > 0 ? (
                  <span className="chip-count">{h1Counts[c.type_id]}</span>
                ) : null}
              </button>
            ))}
          </div>
        )}

        {loadingName ? (
          <div className="result-hint" style={{ marginBottom: 10 }}>
            正在获取「{loadingName}」的播放地址…
          </div>
        ) : null}

        {h1Loading && h1Items.length > 0 ? (
          <div className="loading-block">
            <span className="spinner" />
            <span>正在切换，请稍等…</span>
          </div>
        ) : null}

        {h1Loading && h1Items.length === 0 ? (
          <EmptyState title="正在加载…" desc="外网片源首次加载可能稍慢。" />
        ) : h1Error ? (
          <EmptyState
            title="加载失败"
            desc={h1Error}
            action={
              <button className="btn" onClick={() => void loadH1(h1Page, h1Keyword, h1Type)}>
                重试
              </button>
            }
          />
        ) : h1Items.length === 0 ? (
          <EmptyState
            title={h1Keyword ? `没有找到「${h1Keyword}」` : '该片源暂无内容'}
            desc="换个关键词或分类再试。"
          />
        ) : (
          <>
            <div className="comic-grid">
              {h1Items.map((item) => {
                const fav = favOf(h1Source.id, item.vod_id)
                return (
                  <div key={item.vod_id} className="comic-card">
                    <button className="comic-cover" onClick={() => void openDetail(h1Source, item)}>
                      {item.vod_pic ? <img src={item.vod_pic} alt="" loading="lazy" /> : null}
                      {item.vod_remarks ? <span className="comic-badge">{item.vod_remarks}</span> : null}
                      {hasDuration(item.vod_duration) ? (
                        <span className="media-duration">{item.vod_duration}</span>
                      ) : null}
                      <span
                        className={`fav-heart ${fav ? 'on' : ''}`}
                        role="button"
                        title={fav ? '取消收藏' : '收藏'}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleFav(h1Source, item)
                        }}
                      >
                        <Heart size={15} fill={fav ? 'currentColor' : 'none'} />
                      </span>
                    </button>
                    <div className="comic-title">{item.vod_name}</div>
                    <div className="comic-sub">
                      {[
                        item.type_name,
                        item.vod_year,
                        hasDuration(item.vod_duration) ? item.vod_duration : ''
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </div>
                  </div>
                )
              })}
            </div>

            <Pagination
              page={h1Page}
              lastPage={h1PageCount}
              disabled={h1Loading}
              onChange={(next) => void loadH1(next, h1Keyword, h1Type)}
            />
          </>
        )}
      </>
    )
  }

  if (variant) {
    return <EmptyState title={`${variant.label} 暂无对应片源`} desc="番1~番4 固定对应四个片源站点。" />
  }

  return (
    <>
      <header className="page-header">
        {(searchTitle || focus) && onExit ? (
          <button className="btn ghost" onClick={onExit}>
            <ChevronLeft size={15} /> 返回
          </button>
        ) : null}
        <h1 className="page-title">观影</h1>
        <div className="page-actions">
          <ModuleShortcuts onOpenFavorites={onOpenFavorites} onOpenDownloads={onOpenDownloads} />
        </div>
      </header>

      <SearchBar
        value={keyword}
        onChange={setKeyword}
        onSubmit={() => void runSearch(keyword)}
        onCancel={stopSearch}
        onClear={() => {
          setKeyword('')
          setSearched(false)
          setResults([])
          setSourceErrors([])
        }}
        searching={searching}
        placeholder="输入片名（可带年份，如 沙丘 2021）"
      />

      {loadingName ? (
        <div className="result-hint" style={{ marginBottom: 10 }}>
          正在获取「{loadingName}」的播放地址…
        </div>
      ) : null}

      {sources.length === 0 ? (
        <EmptyState
          title="还没有可用的片源"
          desc="到「配置管理 → 片源管理」导入内置片源或添加苹果CMS接口地址，番1~番4 不受影响。"
        />
      ) : !searched ? (
        <EmptyState
          title="输入片名开始跨源搜索"
          desc="会并行查询所有已启用的片源，结果随片源返回实时追加；点结果直接进入播放页。"
        />
      ) : results.length === 0 && searching ? (
        <EmptyState
          title={`正在搜索 ${progress.done}/${progress.total} 个片源…`}
          desc="结果会随着片源返回实时追加。"
        />
      ) : results.length === 0 ? (
        <EmptyState
          title="没有找到可播放的结果"
          desc={
            sourceErrors.length
              ? `有 ${sourceErrors.length} 个片源请求失败，可到片源管理里测试线路状态。`
              : '换个片名或年份再试；片源质量参差，建议多启用几个。'
          }
        />
      ) : (
        <>
          <div className="page-desc" style={{ marginBottom: 10 }}>
            {searching
              ? `共 ${results.length} 条结果 · 搜索中 ${progress.done}/${progress.total} 个源`
              : `共 ${results.length} 条结果（${progress.total || sources.length} 个片源）`}
          </div>
          <div className="rows">
            {results.map((item) => {
              const fav = favOf(item.sourceId, item.vod_id)
              const source = sourceById.get(item.sourceId)
              return (
                <div
                  key={`${item.sourceId}-${item.vod_id}`}
                  className="row clickable"
                  onClick={() => {
                    if (source) void openDetail(source, item)
                  }}
                >
                  <div className="row-cover">
                    {item.vod_pic ? <img src={item.vod_pic} alt="" loading="lazy" /> : '影片'}
                  </div>
                  <div className="row-main">
                    <div className="row-title">{item.vod_name}</div>
                    <div className="row-meta">
                      {[item.type_name, item.vod_year, item.vod_area, item.vod_duration, item.vod_remarks]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </div>
                    <div className="row-meta">来自 {item.sourceName}</div>
                  </div>
                  <button
                    className="icon-btn"
                    title={fav ? '取消收藏' : '收藏'}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (source) toggleFav(source, item)
                    }}
                  >
                    <Heart size={15} fill={fav ? 'currentColor' : 'none'} />
                  </button>
                  <span className="badge brand">播放</span>
                </div>
              )
            })}
          </div>
          {sourceErrors.length > 0 && (
            <div className="result-hint" style={{ marginTop: 10 }}>
              {sourceErrors.length} 个片源请求失败：
              {sourceErrors.slice(0, 4).map((e) => `${e.name}（${e.error}）`).join('、')}
              {sourceErrors.length > 4 ? ' 等' : ''}
            </div>
          )}
        </>
      )}
    </>
  )
}
