import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Heart, RefreshCw } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, ModuleShortcuts, Pagination } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { loadCache, saveCache } from '../utils/cache'
import { useDetailScrollRestore } from '../utils/scroll'
import {
  NEWS_CATEGORIES,
  newsCategoryLabel,
  type NewsFeedResponse,
  type NewsItem,
  type NewsNodeCard,
  type NewsNodeDetail
} from '../shared/news'

/**
 * 资讯（今日热榜 tophub.today）：
 * - 一级下拉 = 站点顶部分类（综合 / 科技 / ... / 报刊），二级下拉 = 分类页「热门榜单」子分类；
 * - 卡片与网站一致：统一高度，榜单条目在卡片内滚轮滚动；
 * - 卡片右上角收藏榜单（连同条目一起存进收藏），收藏页同样以可滚动小卡片展示。
 */

const DEFAULT_CATEGORY = 'news'

interface NewsCache {
  category: string
  sub: string
  page: number
  feed: NewsFeedResponse | null
}

const initialCache = loadCache<NewsCache>('news', {
  category: DEFAULT_CATEGORY,
  sub: '',
  page: 1,
  feed: null
})
const initialCategory = NEWS_CATEGORIES.some((c) => c.key === initialCache.category)
  ? initialCache.category
  : DEFAULT_CATEGORY
const initialSub = typeof initialCache.sub === 'string' ? initialCache.sub : ''
const initialPage =
  typeof initialCache.page === 'number' && initialCache.page >= 1 ? initialCache.page : 1

export function NewsPage({
  onNotice,
  resetSignal,
  onOpenFavorites
}: {
  onNotice: (text: string) => void
  resetSignal?: number
  onOpenFavorites?: () => void
}) {
  const { data, update } = useData()
  const [category, setCategory] = useState(initialCategory)
  const [sub, setSub] = useState(initialSub)
  const [page, setPage] = useState(initialPage)
  const [feed, setFeed] = useState<NewsFeedResponse | null>(
    initialCache.feed?.category === initialCategory &&
      (initialCache.feed?.query ?? '') === initialSub &&
      (initialCache.feed?.page ?? 1) === initialPage
      ? initialCache.feed
      : null
  )
  const [input, setInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(
    !(
      initialCache.feed?.category === initialCategory &&
      (initialCache.feed?.query ?? '') === initialSub &&
      (initialCache.feed?.page ?? 1) === initialPage
    )
  )
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detailNode, setDetailNode] = useState<NewsNodeCard | null>(null)
  const [detail, setDetail] = useState<NewsNodeDetail | null>(null)
  useDetailScrollRestore(!!detail, 'news')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const feedSeq = useRef(0)
  const detailSeq = useRef(0)

  const load = async (key: string, q: string, targetPage: number, refresh = false) => {
    const seq = ++feedSeq.current
    if (refresh) setRefreshing(true)
    else if (
      feed?.category !== key ||
      (feed?.query ?? '') !== q ||
      (feed?.page ?? 1) !== targetPage
    ) {
      setLoading(true)
    }
    const res = await window.laozheng.newsFeed(key, q, targetPage)
    if (seq !== feedSeq.current) return
    setLoading(false)
    setRefreshing(false)
    if (!res.ok || !res.cards?.length) {
      if (feed?.category === key && (feed?.query ?? '') === q) {
        // 同分类已有缓存：翻页 / 刷新失败时退回缓存页，保留原有内容
        if ((feed.page ?? 1) !== targetPage) setPage(feed.page ?? 1)
        onNotice(res.error ?? '加载失败，已停留在上一页')
      } else {
        setError(res.error ?? '加载失败')
      }
      return
    }
    setError(null)
    setFeed(res)
    // 兜底结果没有分页：把页码拉回 1，避免与列表缓存页码不一致导致空白
    if (res.fallback && res.page && res.page !== targetPage) setPage(res.page)
  }

  useEffect(() => {
    void load(initialCategory, initialSub, initialPage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 点侧栏重新进入模块时回到分类列表
  useEffect(() => {
    if (resetSignal === undefined) return
    detailSeq.current += 1
    setDetailNode(null)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(false)
    setInput('')
    setKeyword('')
    setSub('')
    setPage(1)
    void load(category, '', 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal])

  // 切模块 / 重开应用不丢上次的分类与列表
  useEffect(() => {
    if (!feed) return
    saveCache<NewsCache>('news', { category, sub, page, feed })
  }, [feed, category, sub, page])

  const matched =
    feed?.category === category &&
    (feed?.query ?? '') === sub &&
    ((feed?.page ?? 1) === page || feed?.fallback === true)
  const cards = matched ? (feed?.cards ?? []) : []
  const subs = matched ? (feed?.subs ?? []) : []
  const kw = keyword.trim().toLowerCase()
  const visibleNodes = kw
    ? cards
        .map((node) => {
          const nameHit = `${node.name} ${node.board}`.toLowerCase().includes(kw)
          const hits = node.items.filter(
            (item) =>
              item.title.toLowerCase().includes(kw) || item.extra.toLowerCase().includes(kw)
          )
          if (!nameHit && !hits.length) return null
          return { ...node, items: nameHit && !hits.length ? node.items : hits }
        })
        .filter((node): node is NewsNodeCard => !!node)
    : cards

  const switchCategory = (key: string) => {
    if (key === category) return
    setCategory(key)
    setSub('')
    setPage(1)
    setKeyword('')
    setInput('')
    setError(null)
    void load(key, '', 1)
  }

  const switchSub = (q: string) => {
    if (q === sub) return
    setSub(q)
    setPage(1)
    setKeyword('')
    setInput('')
    setError(null)
    void load(category, q, 1)
  }

  const gotoPage = (next: number) => {
    setPage(next)
    void load(category, sub, next)
  }

  const openItem = (item: NewsItem) => {
    if (!item.url) {
      onNotice('这条资讯没有可打开的原文链接')
      return
    }
    void window.laozheng.openExternal(item.url).catch(() => onNotice('打开原文失败'))
  }

  const openNode = async (node: NewsNodeCard) => {
    const seq = ++detailSeq.current
    setDetailNode(node)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    const res = await window.laozheng.newsNode(node.id)
    if (seq !== detailSeq.current) return
    setDetailLoading(false)
    if (!res.ok || !res.detail) {
      setDetailError(res.error ?? '加载失败')
      return
    }
    setDetail(res.detail)
  }

  const closeDetail = () => {
    detailSeq.current += 1
    setDetailNode(null)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(false)
  }

  const refreshClick = () => {
    void window.laozheng.forceRefresh('news').catch(() => {})
    if (detailNode) void openNode(detailNode)
    else void load(category, sub, page, true)
  }

  const favOf = (id: string) => data.innerFavs.find((f) => f.module === 'news' && f.id === id)

  const toggleFav = (node: NewsNodeCard) => {
    const exists = !!favOf(node.id)
    if (exists) {
      update((d) => ({
        ...d,
        innerFavs: d.innerFavs.filter((f) => !(f.module === 'news' && f.id === node.id))
      }))
      onNotice('已取消收藏')
      return
    }
    const payload = JSON.stringify({
      category,
      query: sub,
      page,
      nodeId: node.id,
      name: node.name,
      board: node.board,
      icon: node.icon,
      items: node.items
    })
    update((d) => ({
      ...d,
      innerFavs: [
        ...d.innerFavs,
        {
          module: 'news',
          id: node.id,
          title: `${node.name} · ${node.board}`,
          subtitle: newsCategoryLabel(category),
          cover: node.icon,
          savedAt: Date.now(),
          videoUrl: null,
          mediaId: 0,
          durationSec: 0,
          tweetUrl: null,
          payload
        }
      ]
    }))
    onNotice('已收藏，可在「收藏」页查看')
  }

  const itemRow = (item: NewsItem) => (
    <button
      key={`${item.rank}-${item.title}`}
      className="news-item"
      title={item.url ? item.title : '暂无原文链接'}
      onClick={() => openItem(item)}
    >
      <span className={`news-item-rank ${item.rank <= 3 ? 'top' : ''}`}>{item.rank}</span>
      <span className="news-item-title">{item.title}</span>
      {item.extra ? <span className="news-item-extra">{item.extra}</span> : null}
    </button>
  )

  if (detailNode) {
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={closeDetail}>
            <ChevronLeft size={15} /> 返回列表
          </button>
          <h1 className="page-title" style={{ fontSize: 18 }}>
            {detail?.title || `${detailNode.name} ${detailNode.board}`}
          </h1>
          <div className="page-actions">
            <button
              className="btn btn-sq"
              title="刷新榜单"
              aria-label="刷新榜单"
              disabled={detailLoading}
              onClick={refreshClick}
            >
              <RefreshCw size={15} className={detailLoading ? 'spin' : ''} />
            </button>
          </div>
        </header>

        {detailLoading && !detail ? (
          <EmptyState title="正在加载榜单…" />
        ) : detailError ? (
          <EmptyState
            title="加载失败"
            desc={detailError}
            action={
              <button className="btn" onClick={() => void openNode(detailNode)}>
                重试
              </button>
            }
          />
        ) : detail ? (
          <div className="news-detail">{detail.items.map(itemRow)}</div>
        ) : null}
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">资讯</h1>
        <div className="page-actions">
          <ModuleShortcuts onOpenFavorites={onOpenFavorites} />
        </div>
      </header>

      <SearchBar
        value={input}
        onChange={setInput}
        onSubmit={() => setKeyword(input.trim())}
        onClear={() => {
          setInput('')
          setKeyword('')
        }}
        placeholder="搜索当前分类的榜单或资讯标题…"
        onRefresh={refreshClick}
        refreshing={refreshing || loading}
      />

      <div className="toolbar">
        <select
          className="select-inline"
          value={category}
          onChange={(e) => switchCategory(e.target.value)}
          title="分类"
        >
          {NEWS_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          className="select-inline"
          value={sub}
          onChange={(e) => switchSub(e.target.value)}
          title="子分类"
          style={{ maxWidth: 220 }}
          disabled={!subs.length}
        >
          <option value="">全部子分类{subs.length ? `（${subs.length}）` : ''}</option>
          {subs.map((item) => (
            <option key={item.q} value={item.q}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {feed?.fallback ? (
        <div className="news-fallback">
          分类页触发站点安全验证，暂时显示首页对应榜单（无分页 / 子分类）；稍后点刷新即可恢复。
        </div>
      ) : null}

      {loading ? (
        <EmptyState title="正在加载…" desc="正在拉取各站热榜，请稍候。" />
      ) : error ? (
        <EmptyState
          title="加载失败"
          desc={error}
          action={
            <div className="toolbar" style={{ marginBottom: 0, justifyContent: 'center' }}>
              <button className="btn" onClick={() => void load(category, sub, page, true)}>
                重试
              </button>
              {/安全验证|503/.test(error) ? (
                <button
                  className="btn ghost"
                  onClick={() =>
                    void window.laozheng.openExternal('https://tophub.today/').catch(() => {})
                  }
                >
                  打开网站验证
                </button>
              ) : null}
            </div>
          }
        />
      ) : !visibleNodes.length ? (
        <EmptyState
          title={kw ? '没有搜到相关资讯' : '这个分类暂时没有内容'}
          desc={kw ? '换个关键词再试。' : '稍后再来看看。'}
        />
      ) : (
        <>
          <div className="news-grid">
            {visibleNodes.map((node) => {
              const fav = favOf(node.id)
              return (
                <article key={node.id} className="news-card">
                  <div className="news-card-head">
                    {node.icon ? (
                      <img
                        className="news-card-icon"
                        src={node.icon}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="news-card-icon news-card-icon-fallback">
                        {node.name.slice(0, 1)}
                      </span>
                    )}
                    <span className="news-card-title">
                      <span className="news-card-name">{node.name}</span>
                      <span className="news-card-board">{node.board}</span>
                    </span>
                    <button className="news-more" onClick={() => void openNode(node)}>
                      完整榜单
                    </button>
                    <button
                      className={`news-fav ${fav ? 'on' : ''}`}
                      title={fav ? '取消收藏' : '收藏榜单'}
                      aria-label={fav ? '取消收藏' : '收藏榜单'}
                      onClick={() => toggleFav(cards.find((card) => card.id === node.id) ?? node)}
                    >
                      <Heart size={15} fill={fav ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <div className="news-card-items">{node.items.map(itemRow)}</div>
                </article>
              )
            })}
          </div>
          {kw || feed?.fallback ? null : (
            <Pagination
              page={page}
              lastPage={feed?.totalPages ?? 1}
              disabled={loading}
              onChange={gotoPage}
            />
          )}
        </>
      )}
    </>
  )
}
