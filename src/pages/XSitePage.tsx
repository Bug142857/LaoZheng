import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Download, Heart } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, LoadingBlock, ModuleShortcuts, Pagination } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { VideoPlayer } from '../components/VideoPlayer'
import { loadCache, saveCache } from '../utils/cache'
import { requestDownload } from '../utils/download'
import {
  formatCount,
  formatDuration,
  type XCategory,
  type XPost
} from '../shared/xsite'

interface XCache {
  range: string
  category: string
  page: number
  lastPage: number
  total: number
  items: XPost[]
}

const EMPTY_X_CACHE: XCache = {
  range: 'weekly',
  category: '',
  page: 1,
  lastPage: 0,
  total: 0,
  items: []
}

const cache: XCache = (() => {
  const cached = loadCache<XCache>('xsite', EMPTY_X_CACHE)
  // 重开应用回到「最新 + 全部分类」；默认列表缓存仍直接显示
  if (cached.range !== 'weekly' || cached.category || cached.page !== 1) {
    return { ...EMPTY_X_CACHE }
  }
  return cached
})()

/** 分类数量：按「榜单 + 分类」缓存（来自列表接口的 total），切榜单会重探 */
const countCache = new Map<string, number>()
let countRange = ''

export function XSitePage({
  onNotice,
  focusId,
  resetSignal,
  onExit,
  onOpenFavorites,
  onOpenDownloads
}: {
  onNotice: (text: string) => void
  focusId?: string
  resetSignal?: number
  /** 从收藏进入时，播放页返回走全局上一页 */
  onExit?: () => void
  onOpenFavorites?: () => void
  onOpenDownloads?: () => void
}) {
  const { data, update } = useData()
  const [range, setRange] = useState(cache.range === 'all' ? 'all' : 'weekly')
  const [category, setCategory] = useState(cache.category)
  const [page, setPage] = useState(cache.page)
  const [lastPage, setLastPage] = useState(cache.lastPage)
  const [items, setItems] = useState<XPost[]>(cache.items)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState<XCategory[]>([])
  const [catCounts, setCatCounts] = useState<Record<string, number>>({})
  const [pending, setPending] = useState<{ range: string; category: string } | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [tagMatches, setTagMatches] = useState<XCategory[] | null>(null)
  const [playing, setPlaying] = useState<XPost | null>(null)
  /** 从收藏进入时先显示打开中，避免闪一下榜单界面 */
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  /** 只应用最后一次榜单 / 分类请求的结果，避免快速切换时旧请求后到覆盖新内容 */
  const requestSeq = useRef(0)

  useEffect(() => {
    if (resetSignal === undefined) return
    requestSeq.current += 1
    setLoading(false)
    setPlaying(null)
    setOpening(false)
    setOpenError(null)
    setTagInput('')
    setTagMatches(null)
  }, [resetSignal])

  useEffect(() => {
    if (!playing) return
    document.querySelector<HTMLElement>('.content')?.scrollTo({ top: 0 })
  }, [playing])

  const load = async (nextRange: string, nextCategory: string, nextPage: number) => {
    const seq = ++requestSeq.current
    setPending({ range: nextRange, category: nextCategory })
    setLoading(true)
    setError(null)
    const res = await window.laozheng.xList(nextRange, nextPage, nextCategory)
    if (seq !== requestSeq.current) return
    setPending(null)
    setLoading(false)
    if (!res.ok || !res.page) {
      setError(res.error ?? '加载失败')
      return
    }
    setItems(res.page.items)
    setLastPage(res.page.lastPage)
    setPage(res.page.page)
    setRange(nextRange)
    setCategory(nextCategory)
    Object.assign(cache, {
      range: nextRange,
      category: nextCategory,
      page: res.page.page,
      lastPage: res.page.lastPage,
      total: res.page.total,
      items: res.page.items
    })
    // 只把「最新 + 全部分类 + 第一页」写进本地缓存
    if (nextRange === 'weekly' && !nextCategory && res.page.page === 1) {
      saveCache<XCache>('xsite', { ...cache })
    }
  }

  /** 站点只提供标签检索：先按 code / 多语言别名匹配标签，再按标签加载视频 */
  const submitTagSearch = () => {
    const query = tagInput.trim()
    if (!query) return
    const lower = query.toLowerCase()
    const exact = categories.find((entry) => entry.code.toLowerCase() === lower)
    if (exact) {
      setTagMatches(null)
      setTagInput(exact.name)
      // 站点搜索默认按总榜找，避免「最新」周榜里没有该标签时显示空列表
      void load('all', exact.code, 1)
      return
    }
    const matches = categories
      .filter((entry) =>
        (entry.aliases ?? [entry.name]).some((alias) => alias.toLowerCase().includes(lower))
      )
      .slice(0, 20)
    if (!matches.length) {
      onNotice(`没有找到「${query}」相关的标签`)
      return
    }
    if (matches.length === 1) {
      setTagMatches(null)
      setTagInput(matches[0].name)
      void load('all', matches[0].code, 1)
      return
    }
    setTagMatches(matches)
  }

  const pickCategory = (code: string) => {
    setTagMatches(null)
    setTagInput('')
    void load(range, code, 1)
  }

  const pickTagMatch = (entry: XCategory) => {
    setTagMatches(null)
    setTagInput(entry.name)
    void load('all', entry.code, 1)
  }

  const clearTagSearch = () => {
    setTagInput('')
    setTagMatches(null)
    if (category) void load(range, '', 1)
  }

  useEffect(() => {
    window.laozheng.xCategories().then((res) => {
      if (res.ok) setCategories(res.items)
    })
    if (!cache.items.length) void load(range, cache.category, 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!categories.length) return
    if (countRange !== range) {
      countCache.clear()
      countRange = range
    }
    let alive = true
    const pending = categories.filter((c) => !countCache.has(c.code))
    if (!pending.length) {
      setCatCounts(Object.fromEntries(countCache))
      return
    }
    const queue = [...pending]
    const worker = async (): Promise<void> => {
      for (;;) {
        const category = queue.shift()
        if (!category) return
        const res = await window.laozheng.xList(range, 1, category.code)
        // 切换榜单后旧请求可能才返回：不要再写进新榜单的数量缓存
        if (!alive) return
        if (res.ok && res.page) {
          countCache.set(category.code, res.page.total)
          setCatCounts(Object.fromEntries(countCache))
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, range])

  useEffect(() => {
    if (!focusId) {
      setOpening(false)
      setOpenError(null)
      return
    }
    let alive = true
    setOpening(true)
    setOpenError(null)
    setPlaying(null)
    void window.laozheng.xDetail(focusId).then((res) => {
      if (!alive) return
      setOpening(false)
      if (res.ok && res.detail) {
        setPlaying(res.detail.post)
        return
      }
      setOpenError(res.error ?? '未知错误')
    })
    return () => {
      alive = false
      setPlaying(null)
      setOpening(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])

  const favOf = (post: XPost) =>
    data.innerFavs.find((f) => f.module === 'xsite' && f.id === post.urlCd)

  const toggleFav = (post: XPost, tags: string[] = []) => {
    const exists = !!favOf(post)
    update((d) => {
      if (exists) {
        return { ...d, innerFavs: d.innerFavs.filter((f) => !(f.module === 'xsite' && f.id === post.urlCd)) }
      }
      return {
        ...d,
        innerFavs: [
          ...d.innerFavs,
          {
            module: 'xsite',
            id: post.urlCd,
            title: post.account ? `@${post.account}` : 'X视频',
            subtitle: tags.length ? tags.join(' · ') : `${formatCount(post.favorite)} 赞`,
            cover: post.thumbnail,
            savedAt: Date.now(),
            videoUrl: post.videoUrl,
            mediaId: post.mediaId,
            durationSec: post.durationSec,
            tweetUrl: post.tweetUrl,
            payload: null
          }
        ]
      }
    })
    onNotice(exists ? '已取消收藏' : '已收藏，可在「收藏」页查看')
  }

  const download = (post: XPost) => {
    requestDownload({
      title: post.account ? `X站 @${post.account}` : 'X站视频',
      url: post.videoUrl,
      kind: 'video',
      coverUrl: post.thumbnail ?? '',
      sourceName: 'X站',
      durationSec: post.durationSec
    })
  }

  if ((opening || openError) && !playing) {
    return (
      <>
        <header className="page-header">
          <button
            className="btn ghost"
            onClick={() => {
              setOpening(false)
              setOpenError(null)
              if (focusId && onExit) onExit()
            }}
          >
            <ChevronLeft size={15} /> 返回
          </button>
          <h1 className="page-title">X站视频</h1>
        </header>
        {opening ? (
          <EmptyState title="正在打开视频…" desc="正在解析播放地址，请稍等。" />
        ) : (
          <EmptyState title="打开失败" desc={openError ?? '请稍后重试'} />
        )}
      </>
    )
  }

  if (playing) {
    return (
      <>
        <header className="page-header">
          <button
            className="btn ghost"
            onClick={() => {
              // 先关掉播放页再返回，避免返回上一页后又弹回播放页
              setPlaying(null)
              if (focusId && onExit) onExit()
            }}
          >
            <ChevronLeft size={15} /> 返回
          </button>
          <h1 className="page-title">{playing.account ? `@${playing.account}` : 'X站视频'}</h1>
          <div className="page-actions">
            <button className="btn" onClick={() => void download(playing)}>
              <Download size={15} /> 下载
            </button>
            <button className="btn" onClick={() => toggleFav(playing)}>
              <Heart size={15} fill={favOf(playing) ? 'currentColor' : 'none'} />{' '}
              {favOf(playing) ? '已收藏' : '收藏'}
            </button>
          </div>
        </header>
        <VideoPlayer src={playing.videoUrl} resumeKey={`xsite|${playing.urlCd}`} />
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        {focusId && onExit ? (
          <button className="btn ghost" onClick={onExit}>
            <ChevronLeft size={15} /> 返回
          </button>
        ) : null}
        <h1 className="page-title">X站</h1>
        <div className="page-actions">
          <ModuleShortcuts onOpenFavorites={onOpenFavorites} onOpenDownloads={onOpenDownloads} />
        </div>
      </header>

      <SearchBar
        value={tagInput}
        onChange={setTagInput}
        onSubmit={submitTagSearch}
        onClear={clearTagSearch}
        placeholder="搜索标签（如 jk / 女高中生 / cosplay）"
        disabled={!categories.length}
      />

      {tagMatches && tagMatches.length > 0 ? (
        <div className="toolbar">
          <span className="settings-value" style={{ fontSize: 11 }}>
            匹配标签
          </span>
          {tagMatches.map((entry) => {
            const active = pending
              ? pending.category === entry.code
              : category === entry.code
            return (
              <button
                key={entry.code}
                className={`chip ${active ? 'active' : ''}`}
                onClick={() => pickTagMatch(entry)}
              >
                {entry.name}
                {catCounts[entry.code] > 0 ? (
                  <span className="chip-count">{formatCount(catCounts[entry.code])}</span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="toolbar">
        <button
          className={`chip ${(pending ? pending.range : range) === 'weekly' ? 'active' : ''}`}
          onClick={() => void load('weekly', category, 1)}
        >
          最新
        </button>
        <button
          className={`chip ${(pending ? pending.range : range) === 'all' ? 'active' : ''}`}
          onClick={() => void load('all', category, 1)}
        >
          热门
        </button>
        <button
          className={`chip ${
            (pending ? pending.category : category) === '' ? 'active' : ''
          }`}
          onClick={() => pickCategory('')}
        >
          全部分类
        </button>
        {categories.map((c) => {
          const active = pending
            ? pending.range === range && pending.category === c.code
            : category === c.code
          return (
            <button
              key={c.code}
              className={`chip ${active ? 'active' : ''}`}
              onClick={() => pickCategory(c.code)}
            >
              {c.name}
              {catCounts[c.code] > 0 ? (
                <span className="chip-count">{formatCount(catCounts[c.code])}</span>
              ) : null}
            </button>
          )
        })}
      </div>

      {loading && items.length > 0 ? <LoadingBlock text="正在切换，请稍等…" /> : null}

      {loading && items.length === 0 ? (
        <EmptyState title="正在加载排行榜…" />
      ) : error ? (
        <EmptyState
          title="加载失败"
          desc={error}
          action={
            <button className="btn" onClick={() => void load(range, category, page)}>
              重试
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState title="这个分类暂时没有内容" desc="换一个分类或榜单再试。" />
      ) : (
        <>
          <div className="media-grid">
            {items.map((post) => (
              <button key={post.urlCd} className="media-card" onClick={() => setPlaying(post)}>
                <span className="media-thumb">
                  {post.thumbnail ? <img src={post.thumbnail} alt="" loading="lazy" /> : null}
                  <span className="media-duration">{formatDuration(post.durationSec)}</span>
                  <span
                    className={`fav-heart ${favOf(post) ? 'on' : ''}`}
                    role="button"
                    title={favOf(post) ? '取消收藏' : '收藏'}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFav(post)
                    }}
                  >
                    <Heart size={15} fill={favOf(post) ? 'currentColor' : 'none'} />
                  </span>
                </span>
                <span className="media-title">{post.account ? `@${post.account}` : 'X视频'}</span>
                <span className="media-meta">
                  {formatCount(post.favorite)} 赞 · {formatCount(post.pv)} 次观看
                </span>
              </button>
            ))}
          </div>

          <Pagination
            page={page}
            lastPage={lastPage}
            disabled={loading}
            onChange={(next) => void load(range, category, next)}
          />
        </>
      )}
    </>
  )
}
