import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, ExternalLink, Heart, LogIn, Search } from 'lucide-react'
import { useData } from '../state/DataContext'
import { ConfirmDialog, EmptyState } from '../components/ui'
import { CollectionPage } from './CollectionPage'
import { zlibBookKey, type ZlibBook, type ZlibStatusResponse } from '../shared/zlib'

interface SearchCache {
  keyword: string
  page: number
  totalPages: number
  books: ZlibBook[]
  searched: boolean
}

const cache: SearchCache = { keyword: '', page: 1, totalPages: 1, books: [], searched: false }

export function BookPage({
  onNotice,
  focusId,
  onGoSearch
}: {
  onNotice: (text: string) => void
  focusId?: string
  onGoSearch: () => void
}) {
  const { data, update } = useData()
  const [showCollection, setShowCollection] = useState(false)
  const [status, setStatus] = useState<ZlibStatusResponse | null>(null)
  const [keyword, setKeyword] = useState(cache.keyword)
  const [input, setInput] = useState(cache.keyword)
  const [page, setPage] = useState(cache.page)
  const [totalPages, setTotalPages] = useState(cache.totalPages)
  const [books, setBooks] = useState<ZlibBook[]>(cache.books)
  const [searched, setSearched] = useState(cache.searched)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ book: ZlibBook | null; loading: boolean; error: string | null } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [pending, setPending] = useState<ZlibBook | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)

  const refreshStatus = async () => {
    const next = await window.laozheng.zlibStatus()
    setStatus(next)
  }

  useEffect(() => {
    void refreshStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (focusId) {
      const [id, hash] = focusId.split('|')
      if (id) void loadDetail(id, hash || '-')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])

  const login = async () => {
    setLoggingIn(true)
    const res = await window.laozheng.zlibLogin()
    setLoggingIn(false)
    onNotice(res.message)
    void refreshStatus()
  }

  const doSearch = async (raw: string, nextPage: number) => {
    const kw = raw.trim()
    if (!kw || searching) return
    setSearching(true)
    setError(null)
    const res = await window.laozheng.zlibSearch(kw, nextPage)
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
    Object.assign(cache, {
      keyword: kw,
      page: res.page,
      totalPages: res.totalPages || 1,
      books: res.books,
      searched: true
    })
  }

  const loadDetail = async (id: string, hash: string) => {
    setDetail({ book: null, loading: true, error: null })
    const res = await window.laozheng.zlibDetail(id, hash)
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

  if (showCollection) {
    return (
      <>
        <header className="page-header">
          <h1 className="page-title">图书</h1>
          <span className="page-desc">已收藏的图书（豆瓣条目）</span>
          <div className="page-actions">
            <button className="btn" onClick={() => setShowCollection(false)}>
              Z-Library
            </button>
          </div>
        </header>
        <CollectionPage
          category="图书"
          title="图书"
          desc="已收藏的图书"
          embedded
          onNotice={onNotice}
          onGoSearch={onGoSearch}
        />
      </>
    )
  }

  if (detail) {
    const book = detail.book
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={() => setDetail(null)}>
            <ChevronLeft size={15} /> 返回列表
          </button>
          <h1 className="page-title">{book?.title ?? '图书详情'}</h1>
          {book ? (
            <div className="page-actions">
              <button className="btn" onClick={() => toggleFav(book)}>
                <Heart size={15} fill={favOf(book) ? 'currentColor' : 'none'} /> {favOf(book) ? '已收藏' : '收藏'}
              </button>
              {book.readOnlineUrl ? (
                <button className="btn" onClick={() => void window.laozheng.openExternal(book.readOnlineUrl ?? '')}>
                  <ExternalLink size={14} /> 在线阅读
                </button>
              ) : null}
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
            message={`将下载《${pending.title}》到「老郑分享/图书」目录。\n下载会消耗 Z-Library 当日额度，是否继续？`}
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
        <h1 className="page-title">图书</h1>
        <span className="page-desc">
          Z-Library · {status?.loggedIn ? `已登录（${status.host}）` : '需要登录后才能搜索与下载'}
        </span>
        <div className="page-actions">
          <button className="btn" onClick={() => setShowCollection(true)}>
            豆瓣收藏
          </button>
          <button className="btn" disabled={loggingIn} onClick={() => void login()}>
            <LogIn size={14} /> {loggingIn ? '请在弹出的窗口登录…' : status?.loggedIn ? '重新登录' : '登录 Z-Library'}
          </button>
        </div>
      </header>

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          void doSearch(input, 1)
        }}
      >
        <label className="search">
          <Search size={16} />
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="搜索书名 / 作者 / ISBN…" />
        </label>
        <button className="btn primary" type="submit" disabled={searching || !input.trim()}>
          {searching ? '搜索中…' : '搜索'}
        </button>
        {searched ? (
          <button
            className="btn ghost"
            onClick={() => {
              setInput('')
              setSearched(false)
              setBooks([])
              setError(null)
              setKeyword('')
            }}
          >
            清除搜索
          </button>
        ) : null}
      </form>

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
        <EmptyState title="搜索图书" desc="登录后可按书名、作者或 ISBN 搜索，并可下载到本地。" />
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

          <div className="toolbar" style={{ marginTop: 14 }}>
            <button className="btn" disabled={searching || page <= 1} onClick={() => void doSearch(keyword, page - 1)}>
              <ChevronLeft size={14} /> 上一页
            </button>
            <span className="page-desc">
              第 {page} 页{totalPages ? ` / 共 ${totalPages} 页` : ''}
            </span>
            <button
              className="btn"
              disabled={searching || (totalPages > 0 && page >= totalPages)}
              onClick={() => void doSearch(keyword, page + 1)}
            >
              下一页 <ChevronRight size={14} />
            </button>
          </div>
        </>
      )}
    </>
  )
}
