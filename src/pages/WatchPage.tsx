import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Heart } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, ModuleShortcuts, Pagination } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { VideoPlayer } from '../components/VideoPlayer'
import { loadCache, saveCache } from '../utils/cache'
import { useDetailScrollRestore } from '../utils/scroll'
import {
  parsePlayGroups,
  type VodEpisode,
  type VodItem,
  type VodPlayGroup
} from '../shared/vod'
import type { DoubanHotItem } from '../shared/douban'
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

/** 影视搜索并发数 */
const CONCURRENCY = 6

/** 记录收藏里上次看到哪一集：readProgress 里按片源 + 条目存集名 */
function episodeProgressKey(sourceId: string, vodId: number): string {
  return `vodEp|${sourceId}|${vodId}`
}

/**
 * 影视默认分类：与公开影视榜单的标签一一对应（热门 / 华语 / 欧美 / 国产剧 …）。
 * 首页只拉 1~2 个榜单接口，点海报再去搜索片源，避免一次打开几十个采集源。
 */
type WatchTabKey =
  | 'hot'
  | 'cn_movie'
  | 'cn_drama'
  | 'west_movie'
  | 'us_drama'
  | 'jk_movie'
  | 'kr_drama'
  | 'jp_anime'
  | 'documentary'
  | 'variety'

interface WatchHotList {
  kind: 'movie' | 'tv'
  tag: string
}

interface WatchTab {
  key: WatchTabKey
  label: string
  lists: WatchHotList[]
}

const WATCH_TABS: WatchTab[] = [
  {
    key: 'hot',
    label: '热门',
    lists: [
      { kind: 'movie', tag: '热门' },
      { kind: 'tv', tag: '热门' }
    ]
  },
  { key: 'cn_movie', label: '华语电影', lists: [{ kind: 'movie', tag: '华语' }] },
  { key: 'cn_drama', label: '国产剧', lists: [{ kind: 'tv', tag: '国产剧' }] },
  { key: 'west_movie', label: '欧美电影', lists: [{ kind: 'movie', tag: '欧美' }] },
  { key: 'us_drama', label: '美剧', lists: [{ kind: 'tv', tag: '美剧' }] },
  {
    key: 'jk_movie',
    label: '日韩电影',
    lists: [
      { kind: 'movie', tag: '韩国' },
      { kind: 'movie', tag: '日本' }
    ]
  },
  { key: 'kr_drama', label: '韩剧', lists: [{ kind: 'tv', tag: '韩剧' }] },
  { key: 'jp_anime', label: '日漫', lists: [{ kind: 'tv', tag: '日本动画' }] },
  { key: 'documentary', label: '纪录片', lists: [{ kind: 'tv', tag: '纪录片' }] },
  { key: 'variety', label: '综艺', lists: [{ kind: 'tv', tag: '综艺' }] }
]

const WATCH_PAGE_SIZE = 20

/** 多个榜单按轮次交叉合并并去重，避免热门页被电影或剧集刷屏 */
function mergeHotLists(lists: DoubanHotItem[][]): DoubanHotItem[] {
  const seen = new Set<string>()
  const out: DoubanHotItem[] = []
  const max = lists.reduce((size, list) => Math.max(size, list.length), 0)
  for (let index = 0; index < max; index += 1) {
    for (const list of lists) {
      const item = list[index]
      if (!item) continue
      const key = item.id || item.title
      if (seen.has(key)) continue
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

interface WatchHotCache {
  items: DoubanHotItem[]
}

const EMPTY_WATCH_HOT: WatchHotCache = { items: [] }

/** 缓存可能来自旧版本 / 被损坏，逐字段校验后再用 */
function readWatchHotCache(): DoubanHotItem[] {
  const cached = loadCache<WatchHotCache>('watch_hot_douban', EMPTY_WATCH_HOT)
  return Array.isArray(cached.items)
    ? cached.items.filter(
        (item): item is DoubanHotItem =>
          !!item &&
          typeof item.id === 'string' &&
          typeof item.title === 'string' &&
          typeof item.cover === 'string' &&
          (item.kind === 'movie' || item.kind === 'tv')
      )
    : []
}

export function WatchPage({
  onNotice,
  focus,
  searchTitle,
  resetSignal,
  onExit,
  onOpenFavorites
}: {
  onNotice: (text: string) => void
  /** 从收藏进入：尽量直接续播并显示集数 */
  focus?: WatchFocus
  /** 清单条目「在线观看」：按片名自动搜源 */
  searchTitle?: string
  /** 点侧栏进入模块时回到列表（不保留上次播放页） */
  resetSignal?: number
  /** 从收藏 / 清单进入时，播放页返回要走全局上一页 */
  onExit?: () => void
  onOpenFavorites?: () => void
}) {
  const { data, update, updateProgress, getProgressSnapshot } = useData()
  const favModule = 'watch'
  const [keyword, setKeyword] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<WatchResult[]>([])
  /** 搜索结果条目清晰度探测结果（key = sourceId|vod_id，空数组表示探测过但没识别到） */
  const [qualityInfo, setQualityInfo] = useState<Record<string, string[]>>({})
  const [sourceErrors, setSourceErrors] = useState<{ name: string; error: string }[]>([])
  const [playback, setPlayback] = useState<Playback | null>(null)
  useDetailScrollRestore(!!playback, 'watch')
  /** 当前播放页是不是从收藏 / 清单外部入口进来的：是则返回走上一页 */
  const [externalPlayback, setExternalPlayback] = useState(false)
  const [episodeAsc, setEpisodeAsc] = useState(false)
  const [loadingName, setLoadingName] = useState<string | null>(null)
  const [focusLoading, setFocusLoading] = useState(false)
  const seqRef = useRef(0)
  /** 只应用最后一次点开的详情请求，避免慢请求回来后又跳去播上一部 */
  const openSeqRef = useRef(0)
  const handledFocusRef = useRef('')
  const handledSearchRef = useRef('')
  const playbackRef = useRef<HTMLDivElement | null>(null)
  /** 已发起过清晰度探测的搜索结果，避免列表更新时重复请求 */
  const probedQualityRef = useRef(new Set<string>())
  /** 播放失败时只自动往上一集降一次，避免连续失败一路跳到底 */
  const downgradedRef = useRef(false)

  // 影视分类浏览：默认「热门」，榜单数据来自公开影视榜单（番号模块不走这里）
  const watchInitial = useMemo(() => readWatchHotCache(), [])
  const [watchTab, setWatchTab] = useState<WatchTabKey>('hot')
  const [watchItems, setWatchItems] = useState<DoubanHotItem[]>(watchInitial)
  const [watchPage, setWatchPage] = useState(1)
  const [watchHasMore, setWatchHasMore] = useState(true)
  const [watchLoading, setWatchLoading] = useState(!watchInitial.length)
  const [watchError, setWatchError] = useState<string | null>(null)
  const watchSeq = useRef(0)
  const watchLoadKeyRef = useRef('')

  useEffect(() => {
    if (playback) playbackRef.current?.scrollIntoView({ block: 'start' })
  }, [playback])

  // 离开再点侧栏进入时回到列表
  useEffect(() => {
    if (resetSignal === undefined) return
    // 同时作废还没跑完的搜索 / 详情请求，避免回到列表后旧结果又追加进来
    seqRef.current += 1
    openSeqRef.current += 1
    setSearching(false)
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

  // 不再区分国内 / 外网目录：影视搜索全部已启用片源
  const sources = useMemo(() => data.vodSources.filter((s) => s.enabled), [data.vodSources])
  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources])
  const allSourceById = useMemo(
    () => new Map(data.vodSources.map((s) => [s.id, s])),
    [data.vodSources]
  )
  /** 搜索框前的片源选择：空 = 全部已启用片源 */
  const activeSource = useMemo(
    () => sources.find((source) => source.id === sourceId) ?? null,
    [sources, sourceId]
  )
  useEffect(() => {
    if (sourceId && !activeSource) setSourceId('')
  }, [sourceId, activeSource])

  /** 影视分类列表：只拉公开榜单（热门 = 电影 + 剧集），点海报再去搜索片源 */
  const loadWatch = async (tabKey: WatchTabKey, page: number) => {
    const tab = WATCH_TABS.find((entry) => entry.key === tabKey) ?? WATCH_TABS[0]
    const seq = ++watchSeq.current
    setWatchLoading(true)
    setWatchError(null)
    const start = (Math.max(1, page) - 1) * WATCH_PAGE_SIZE
    const responses = await Promise.all(
      tab.lists.map((list) =>
        window.laozheng.doubanHot(list.kind, list.tag, start, WATCH_PAGE_SIZE)
      )
    )
    if (seq !== watchSeq.current) return
    setWatchLoading(false)
    const okResults = responses.filter((res) => res.ok)
    if (!okResults.length) {
      setWatchError(responses[0]?.error ?? '加载失败')
      return
    }
    const items = mergeHotLists(okResults.map((res) => res.items))
    setWatchItems(items)
    setWatchPage(page)
    setWatchHasMore(okResults.some((res) => res.items.length >= WATCH_PAGE_SIZE))
    // 只缓存默认视图（热门 + 第一页）
    if (tab.key === 'hot' && page === 1) {
      saveCache<WatchHotCache>('watch_hot_douban', { items: items.slice(0, 60) })
    }
  }

  // v0.91 起榜单改用公开接口：清掉旧版按片源缓存的影视列表
  useEffect(() => {
    try {
      window.localStorage.removeItem('laozheng.cache.v1.watch_hot')
      window.localStorage.removeItem('laozheng.cache.v1.watch_cats')
      // 番号模块已移除：清掉旧版本留下的番号列表缓存
      window.localStorage.removeItem('laozheng.cache.v1.h1_all')
    } catch {
      // localStorage 不可用时忽略
    }
  }, [])

  // 首次进入 / 切分类：回到第一页重新拉榜单
  useEffect(() => {
    if (watchLoadKeyRef.current === watchTab) return
    watchLoadKeyRef.current = watchTab
    void loadWatch(watchTab, 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchTab])

  /** 点榜单海报：按片名搜索已启用片源 */
  const searchHotItem = (item: DoubanHotItem) => {
    const title = item.title.trim()
    if (!title) return
    setKeyword(title)
    setPlayback(null)
    void runSearch(title)
  }

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
    if (!kw) return
    const targets = activeSource ? [activeSource] : sources
    if (!targets.length) {
      onNotice('还没有可用的片源，请到「配置管理 → 片源管理」添加')
      return
    }
    // 新的搜索直接作废上一次未完成的搜索与分类列表请求
    const seq = ++seqRef.current
    watchSeq.current += 1
    setWatchLoading(false)
    setSearching(true)
    setSearched(true)
    setResults([])
    setSourceErrors([])
    setProgress({ done: 0, total: targets.length })
    const year = kw.match(/\b(19|20)\d{2}\b/)?.[0] ?? ''
    const queue = [...targets]
    const errors: { name: string; error: string }[] = []
    let done = 0

    const worker = async () => {
      for (;;) {
        const source = queue.shift()
        if (!source) return
        const res = await window.laozheng.searchVod(toInput(source), kw, year)
        if (seq !== seqRef.current) return
        done += 1
        setProgress({ done, total: targets.length })
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

  // 搜索结果逐条探测真实清晰度：多码率源直接读主清单，单码率源由主进程用 ffmpeg 读流头；
  // 只探前 12 条（并发 2），同一 sourceId+vod_id 只探一次，主进程按地址哈希缓存 30 分钟
  useEffect(() => {
    const pending = results
      .slice(0, 12)
      .filter((item) => {
        const key = `${item.sourceId}|${item.vod_id}`
        return !!item.vod_play_url && !probedQualityRef.current.has(key)
      })
    if (!pending.length) return
    for (const item of pending) probedQualityRef.current.add(`${item.sourceId}|${item.vod_id}`)
    const queue = pending.slice()
    const worker = async (): Promise<void> => {
      for (;;) {
        const item = queue.shift()
        if (!item) return
        const key = `${item.sourceId}|${item.vod_id}`
        try {
          const res = await window.laozheng.probeVodQualities(item.vod_play_from, item.vod_play_url)
          setQualityInfo((prev) => ({ ...prev, [key]: res.ok ? res.qualities : [] }))
        } catch {
          // 探测失败只留空标签，不影响搜索结果本身
          setQualityInfo((prev) => ({ ...prev, [key]: [] }))
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker))
  }, [results])

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
      if (getProgressSnapshot()[progressKey] !== value) {
        updateProgress(progressKey, value)
      }
    }
  }

  /** 点搜索结果直接进播放页：默认播放最新一集，集数默认倒序 */
  const openDetail = async (source: VodSource, item: VodItem) => {
    const seq = ++openSeqRef.current
    setLoadingName(item.vod_name)
    setEpisodeAsc(false)
    const immediate = parsePlayGroups(item.vod_play_from, item.vod_play_url)
    if (immediate.length) {
      setLoadingName(null)
      startPlayback(source, item, immediate)
      return
    }
    const res = await window.laozheng.fetchVodDetail(toInput(source), item.vod_id)
    if (seq !== openSeqRef.current) return
    setLoadingName(null)
    if (res.ok && res.item && res.groups?.length) {
      startPlayback(source, { ...item, ...res.item }, res.groups)
    } else {
      onNotice(`获取播放地址失败：${res.error ?? '该片源没有可播放地址'}`)
    }
  }

  /** 收藏入口：有片源信息就重新解析分集，没有则按标题搜源 */
  const resolveFocusSource = (sourceId?: string, sourceName?: string): VodSource | null => {
    if (sourceId) {
      return allSourceById.get(sourceId) ?? sourceById.get(sourceId) ?? null
    }
    // 旧收藏没有 payload：按收藏里保存的片源名回退匹配
    if (sourceName) {
      return data.vodSources.find((s) => s.name === sourceName) ?? null
    }
    return null
  }

  const playFocus = async (target: WatchFocus, isAlive: () => boolean = () => true) => {
    setEpisodeAsc(false)
    const source = resolveFocusSource(target.sourceId, target.sourceName)
    if (source && target.vodId) {
      // 收藏里通常已经存了播放地址：详情接口慢时不能一直转圈，
      // 最多等 3.5 秒，拿不到就直接用收藏地址起播（没有收藏地址才等完整的 12 秒）
      const waitDetail = target.url ? 3500 : 12_000
      const detail = await Promise.race([
        window.laozheng.fetchVodDetail(toInput(source), target.vodId).catch(() => null),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), waitDetail))
      ])
      // 用户在解析途中已经返回：不能再挂上播放页，否则会变成后台自动播放
      if (!isAlive()) return false
      if (detail && detail.ok && detail.item && detail.groups?.length) {
        const groups = detail.groups
        const item = detail.item
        // 优先续「上次看到的那一集」（收藏后可能又看了别的集），没有再按收藏里保存的地址找
        const saved = getProgressSnapshot()[episodeProgressKey(source.id, target.vodId)] ?? ''
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
          item,
          groups,
          Math.max(0, gi),
          index >= 0 ? index : groups[Math.max(0, gi)].episodes.length - 1,
          true
        )
        return true
      }
    }
    if (!isAlive()) return false
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
      const played = await playFocus(focus, () => alive)
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
      // StrictMode 会 mount 后立刻 cleanup 再 mount：这一轮被取消时必须释放 key，
      // 否则第二次 effect 直接 return，focusLoading 会永远停在「正在打开播放页…」
      if (handledFocusRef.current === key) handledFocusRef.current = ''
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
          onEnded={() => {
            const currentGroup = playback.groups[playback.groupIndex]
            const nextIndex = playback.episodeIndex + 1
            if (nextIndex < currentGroup.episodes.length) {
              // 当前组内还有下一集
              startPlayback(
                playback.source,
                playback.item,
                playback.groups,
                playback.groupIndex,
                nextIndex,
                externalPlayback
              )
              return
            }
            // 当前组播完，看有没有下一个播放组
            if (playback.groupIndex + 1 < playback.groups.length) {
              const nextGroup = playback.groups[playback.groupIndex + 1]
              startPlayback(
                playback.source,
                playback.item,
                playback.groups,
                playback.groupIndex + 1,
                nextGroup.episodes.length - 1,
                externalPlayback
              )
              onNotice(`已到当前线路末尾，切到 ${nextGroup.name}`)
            }
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

  return (
    <>
      <header className="page-header">
        {(searchTitle || focus) && onExit ? (
          <button className="btn ghost" onClick={onExit}>
            <ChevronLeft size={15} /> 返回
          </button>
        ) : null}
        <h1 className="page-title">影视</h1>
        <div className="page-actions">
          <ModuleShortcuts onOpenFavorites={onOpenFavorites} />
        </div>
      </header>

      <SearchBar
        value={keyword}
        onChange={setKeyword}
        onSubmit={() => void runSearch(keyword)}
        onCancel={stopSearch}
        onClear={() => {
          stopSearch()
          setKeyword('')
          setSearched(false)
          setResults([])
          setSourceErrors([])
          // 搜索途中可能把榜单请求作废了：回到列表时补一次
          if (!watchItems.length) void loadWatch(watchTab, 1)
        }}
        searching={searching}
        placeholder="输入片名（可带年份，如 沙丘 2021）"
        onRefresh={() => {
          void window.laozheng.forceRefresh('watch').catch(() => {})
          if (searched && keyword.trim()) void runSearch(keyword)
          else void loadWatch(watchTab, 1)
        }}
        refreshing={searching || watchLoading}
        leading={
          <select
            className="select-inline"
            value={sourceId}
            onChange={(event) => {
              // 换片源时停止上一轮搜索，避免旧源结果继续追加
              stopSearch()
              setSourceId(event.target.value)
            }}
            title="选择片源"
            style={{ maxWidth: 180 }}
          >
            <option value="">全部源（{sources.length}）</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        }
      />

      {!searched && sources.length > 0 ? (
        <div className="toolbar">
          {WATCH_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`chip ${watchTab === tab.key ? 'active' : ''}`}
              onClick={() => {
                if (tab.key === watchTab) {
                  void loadWatch(tab.key, 1)
                  return
                }
                watchSeq.current += 1
                setWatchTab(tab.key)
                setWatchItems([])
                setWatchLoading(true)
                setWatchError(null)
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      {loadingName ? (
        <div className="result-hint" style={{ marginBottom: 10 }}>
          正在获取「{loadingName}」的播放地址…
        </div>
      ) : null}

      {sources.length === 0 ? (
        <EmptyState
          title="还没有可用的片源"
          desc="到「配置管理 → 片源管理」导入内置片源或添加苹果CMS接口地址。"
        />
      ) : !searched ? (
        watchLoading && watchItems.length === 0 ? (
          <EmptyState title="正在加载榜单…" desc="通常只需要 1~2 个请求，请稍等。" />
        ) : watchError && watchItems.length === 0 ? (
          <EmptyState
            title="榜单加载失败"
            desc={watchError}
            action={
              <button className="btn" onClick={() => void loadWatch(watchTab, watchPage)}>
                重试
              </button>
            }
          />
        ) : watchItems.length === 0 ? (
          <EmptyState
            title={watchPage > 1 ? '这一页没有内容了' : '该分类暂无内容'}
            desc={watchPage > 1 ? '榜单页数有限，返回第一页继续浏览。' : '换一个分类试试。'}
            action={
              watchPage > 1 ? (
                <button className="btn" onClick={() => void loadWatch(watchTab, 1)}>
                  回到第 1 页
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            {watchLoading ? (
              <div className="loading-block">
                <span className="spinner" />
                <span>正在切换榜单，请稍等…</span>
              </div>
            ) : null}
            <div className="comic-grid">
              {watchItems.map((item) => (
                <div key={item.id} className="comic-card">
                  <button className="comic-cover" onClick={() => searchHotItem(item)}>
                    {item.cover ? <img src={item.cover} alt="" loading="lazy" /> : null}
                    {item.rate ? <span className="comic-badge">★ {item.rate}</span> : null}
                    {item.episodes ? (
                      <span className="media-duration">{item.episodes}</span>
                    ) : null}
                  </button>
                  <div className="comic-title">{item.title}</div>
                  <div className="comic-sub">{item.kind === 'movie' ? '电影' : '剧集'}</div>
                </div>
              ))}
            </div>
            <Pagination
              page={watchPage}
              lastPage={0}
              hasMore={watchHasMore}
              disabled={watchLoading}
              onChange={(next) => void loadWatch(watchTab, next)}
            />
          </>
        )
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
            {results.map((item, index) => {
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
                    {(() => {
                      const info = qualityInfo[`${item.sourceId}|${item.vod_id}`]
                      if (info?.length) {
                        return (
                          <div className="row-meta row-qualities">
                            <span>清晰度</span>
                            {info.map((quality) => (
                              <span key={quality} className="badge brand">
                                {quality}
                              </span>
                            ))}
                          </div>
                        )
                      }
                      if (!info && index < 12 && item.vod_play_url) {
                        return <div className="row-meta row-quality-wait">清晰度检测中…</div>
                      }
                      return null
                    })()}
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
