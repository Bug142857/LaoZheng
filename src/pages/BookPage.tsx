import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Download, Heart } from 'lucide-react'
import { useData } from '../state/DataContext'
import { ConfirmDialog, EmptyState, ModuleShortcuts, Pagination } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { zlibBookKey, type ZlibBook, type ZlibStatusResponse } from '../shared/zlib'

export function BookPage({
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
  /** 从收藏进入时，详情页返回走全局上一页 */
  onExit?: () => void
  onOpenFavorites?: () => void
  onOpenDownloads?: () => void
}) {
  const { data, update } = useData()
  const [status, setStatus] = useState<ZlibStatusResponse | null>(null)
  // 每次打开应用都是空白搜索页；搜过的内容由主进程缓存，重复搜索会很快
  const [keyword, setKeyword] = useState('')
  const [input, setInput] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [books, setBooks] = useState<ZlibBook[]>([])
  const [searched, setSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ book: ZlibBook | null; loading: boolean; error: string | null } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [pending, setPending] = useState<ZlibBook | null>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    if (resetSignal === undefined) return
    setDetail(null)
  }, [resetSignal])

  const refreshStatus = async () => {
    const next = await window.laozheng.zlibStatus()
    setStatus(next)
  }

  useEffect(() => {
    void refreshStatus()
    // 在设置里登录 / 退出后，图书页即使一直挂载也要同步最新登录态
    return window.laozheng.onAccountsChanged(() => void refreshStatus())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!focusId) return
    const [id, hash] = focusId.split('|')
    if (!id) return
    let alive = true
    void loadDetail(id, hash || '-', () => alive)
    return () => {
      alive = false
      setDetail(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])

  const doSearch = async (raw: string, nextPage: number) => {
    const kw = raw.trim()
    if (!kw || searching) return
    const seq = ++seqRef.current
    setSearching(true)
    setError(null)
    const res = await window.laozheng.zlibSearch(kw, nextPage)
    if (seq !== seqRef.current) return
    setSearching(false)
    setSearched(true)
    if (!res.ok) {
      setError(res.error ?? '搜索失败')
      return
    }
    setBooks(res.books)
    setPage(res.page)
    setTotalPages(res.totalPages || 1)
    setKeyword(kw)
  }

  const loadDetail = async (id: string, hash: string, alive?: () => boolean) => {
    setDetail({ book: null, loading: true, error: null })
    const res = await window.laozheng.zlibDetail(id, hash)
    if (alive && !alive()) return
    setDetail({
      book: res.ok ? res.book : null,
      loading: false,
      error: res.ok ? null : res.error ?? '详情加载失败'
    })
  }

  const favId = (book: ZlibBook): string => zlibBookKey(book)
  const favOf = (book: ZlibBook): boolean =>
    data.innerFavs.some((f) => f.module === 'book' && f.id === favId(book))

  const toggleFav = (book: ZlibBook) => {
    const id = favId(book)
    const exists = data.innerFavs.some((f) => f.module === 'book' && f.id === id)
    update((d) => {
      if (exists) return { ...d, innerFavs: d.innerFavs.filter((f) => !(f.module === 'book' && f.id === id)) }
      return {
        ...d,
        innerFavs: [
          ...d.innerFavs,
          {
            module: 'book',
            id,
            title: book.title,
            subtitle: book.author ?? '',
            cover: book.cover,
            savedAt: Date.now(),
            videoUrl: null,
            mediaId: 0,
            durationSec: 0,
            tweetUrl: null,
            payload: null
          }
        ]
      }
    })
    onNotice(exists ? '已取消收藏' : '已收藏，可在「收藏」页查看')
  }

  const download = async () => {
    if (!pending) return
    const book = pending
    setPending(null)
    setDownloading(true)
    onNotice('正在下载，完成后可在「下载」页查看…')
    const res = await window.laozheng.zlibDownload(book.id, book.hash, book.title)
    setDownloading(false)
    if (!res.ok) {
      onNotice(`下载失败：${res.error ?? '未知错误'}`)
      return
    }
    onNotice(`已下载到「图书」目录：${res.name ?? ''}`)
    void refreshStatus()
  }

  const quotaText = (() => {
    const today = status?.downloadsToday
    const limit = status?.downloadsLimit
    if (today != null && limit != null) {
      return `今日剩余额度：${Math.max(0, limit - today)} 次（已用 ${today} / ${limit}）`
    }
    if (today != null) return `今日已下载 ${today} 次（具体额度以站点为准）`
    return '今日剩余额度：站点暂未返回，可到 Z-Library 账号页查看'
  })()

  if (detail) {
    const book = detail.book
    return (
      <>
        <header className="page-header">
          <button
            className="btn ghost"
            onClick={() => {
              // 先清掉详情再返回，避免从收藏返回后又落回详情页
              setDetail(null)
              if (focusId && onExit) onExit()
            }}
          >
            <ChevronLeft size={15} /> 返回列表
          </button>
          <h1 className="page-title">{book?.title ?? '图书详情'}</h1>
          {book ? (
            <div className="page-actions">
              <button className="btn" onClick={() => toggleFav(book)}>
                <Heart size={15} fill={favOf(book) ? 'currentColor' : 'none'} /> {favOf(book) ? '已收藏' : '收藏'}
              </button>
              <button
                className="btn primary"
                disabled={downloading}
                onClick={() => setPending(book)}
              >
                <Download size={14} /> {downloading ? '下载中…' : '下载'}
              </button>
            </div>
          ) : null}
        </header>

        {detail.loading ? (
          <EmptyState title="正在加载图书信息…" />
        ) : detail.error || !book ? (
          <EmptyState title="加载失败" desc={detail.error ?? '没有拿到图书信息'} />
        ) : (
          <div className="comic-detail">
            <div className="comic-detail-cover" style={{ maxWidth: 200 }}>
              {book.cover ? <img src={book.cover} alt="" /> : null}
            </div>
            <div className="comic-detail-info">
              <div className="row-title" style={{ whiteSpace: 'normal' }}>
                {book.title}
              </div>
              <div className="comic-meta">{[book.author, book.year, book.publisher].filter(Boolean).join(' · ') || '—'}</div>
              <div className="comic-meta">
                {[
                  book.language,
                  book.extension ? book.extension.toUpperCase() : '',
                  book.filesize,
                  book.rating ? `评分 ${book.rating}` : ''
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {book.description ? (
                <p className="comic-desc" style={{ whiteSpace: 'pre-wrap' }}>
                  {book.description}
                </p>
              ) : null}
            </div>
          </div>
        )}

        {pending ? (
          <ConfirmDialog
            title="下载图书"
            message={`将下载《${pending.title}》到「老郑分享/图书」目录。\n${quotaText}。\n下载会消耗 Z-Library 当日额度，是否继续？`}
            confirmText="开始下载"
            onConfirm={() => void download()}
            onCancel={() => setPending(null)}
          />
        ) : null}
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
        <h1 className="page-title">图书</h1>
        <div className="page-actions">
          <ModuleShortcuts onOpenFavorites={onOpenFavorites} onOpenDownloads={onOpenDownloads} />
        </div>
      </header>

      <SearchBar
        value={input}
        onChange={setInput}
        onSubmit={() => void doSearch(input, 1)}
        onCancel={() => {
          seqRef.current += 1
          setSearching(false)
        }}
        onClear={() => {
          setInput('')
          setSearched(false)
          setBooks([])
          setError(null)
          setKeyword('')
        }}
        searching={searching}
        placeholder="搜索书名 / 作者 / ISBN…"
        extra={
          <span className="book-quota" title={quotaText}>
            {quotaText}
          </span>
        }
      />

      {searching ? (
        <EmptyState title="正在搜索…" desc="首次搜索需要等站点反爬验证完成，通常几秒。" />
      ) : error ? (
        <EmptyState
          title="搜索失败"
          desc={error}
          action={
            <button className="btn" onClick={() => void doSearch(keyword || input, page)}>
              重试
            </button>
          }
        />
      ) : !searched ? (
        <EmptyState
          title="搜索图书"
          desc={
            status?.loggedIn
              ? '可按书名、作者或 ISBN 搜索，并可下载到本地。'
              : '未登录时请到 配置管理 → 账号管理 → Z-Library 保存账号并打开登录窗口完成一次验证。'
          }
        />
      ) : books.length === 0 ? (
        <EmptyState title="没有找到图书" desc="换个关键词再试。" />
      ) : (
        <>
          <div className="comic-grid">
            {books.map((book) => (
              <button
                key={`${book.id}/${book.hash}`}
                className="comic-card"
                onClick={() => void loadDetail(book.id, book.hash || '-')}
              >
                <span className="comic-cover" style={{ aspectRatio: '1 / 1.4' }}>
                  {book.cover ? <img src={book.cover} alt="" loading="lazy" /> : null}
                  <span
                    className="fav-heart"
                    role="button"
                    title={favOf(book) ? '取消收藏' : '收藏'}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFav(book)
                    }}
                  >
                    <Heart size={15} fill={favOf(book) ? 'currentColor' : 'none'} />
                  </span>
                </span>
                <span className="comic-title">{book.title}</span>
                <span className="comic-sub">{book.author || '—'}</span>
              </button>
            ))}
          </div>

          <Pagination
            page={page}
            lastPage={totalPages}
            disabled={searching}
            onChange={(next) => void doSearch(keyword, next)}
          />
        </>
      )}
    </>
  )
}
