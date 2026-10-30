import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, Play, Star, X } from 'lucide-react'
import type { CollectionItem } from '../shared/types'
import type {
  PersonWork,
  SubjectComment,
  SubjectCredit,
  SubjectFull,
  SubjectKind
} from '../shared/douban'
import { VideoPlayer } from './VideoPlayer'
import { CollectAction } from './CollectAction'
import { PersonDetail, personWorkToItem } from './PersonDetail'

type CommentOrder = 'hot' | 'new'

function kindOf(item: CollectionItem): SubjectKind | null {
  if (!/^\d+$/.test(item.doubanId)) return null
  const category = item.category
  if (category.includes('电影')) return 'movie'
  if (category.includes('剧') || category.includes('电视')) return 'tv'
  if (category.includes('书')) return 'book'
  if (category.includes('游戏')) return 'game'
  return null
}

function scoreLine(rating: number | null | undefined): ReactNode {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return '—'
  return (
    <span className="detail-score">
      <Star size={15} fill="#f5c518" stroke="#f5c518" /> {rating.toFixed(1)}
    </span>
  )
}

function DetailLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="detail-line">
      <span className="detail-key">{label}</span>
      <span className="detail-value">{value == null || value === '' ? '—' : value}</span>
    </div>
  )
}

function splitNames(raw: string): string[] {
  return raw
    .split('/')
    .map((name) => name.trim())
    .filter(Boolean)
}

/** 清单条目详情（影视 / 图书 / 游戏按类型逐条展示，短评支持热门/最新） */
export function ItemDetail({
  item,
  onBack,
  actions,
  onNotice,
  onWatch
}: {
  item: CollectionItem
  onBack: () => void
  actions?: ReactNode
  /** 没有传 actions 时（如人物作品详情）用来自动显示加入 / 移出清单 */
  onNotice?: (text: string) => void
  /** 影视条目的「在线观看」：按片名进入观影搜索 */
  onWatch?: (title: string) => void
}) {
  const kind = useMemo(() => kindOf(item), [item])
  const [full, setFull] = useState<SubjectFull | null>(null)
  const [loading, setLoading] = useState(!!kind)
  const [error, setError] = useState<string | null>(null)
  const [commentOrder, setCommentOrder] = useState<CommentOrder>('hot')
  const [comments, setComments] = useState<SubjectComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [trailer, setTrailer] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [person, setPerson] = useState<{ id: string; name: string; avatar: string | null } | null>(
    null
  )
  /** 人物页里点开的作品详情 */
  const [personWork, setPersonWork] = useState<PersonWork | null>(null)
  /** 演职员表「查看全部」：从豆瓣 celebrities 页抓取整页名单 */
  const [fullCredits, setFullCredits] = useState<SubjectCredit[] | null>(null)
  const [creditsLoading, setCreditsLoading] = useState(false)
  const [creditsError, setCreditsError] = useState<string | null>(null)
  const commentsCache = useRef(new Map<CommentOrder, SubjectComment[]>())

  useEffect(() => {
    setFull(null)
    setError(null)
    setComments([])
    setTrailer(null)
    setCommentOrder('hot')
    setExpanded({})
    setPerson(null)
    setPersonWork(null)
    setFullCredits(null)
    setCreditsLoading(false)
    setCreditsError(null)
    commentsCache.current.clear()
    if (!kind) {
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    void window.laozheng.fetchSubjectFull(kind, item.doubanId).then((res) => {
      if (!alive) return
      setLoading(false)
      if (res.ok && res.detail) setFull(res.detail)
      else setError(res.error ?? '详情加载失败')
    })
    return () => {
      alive = false
    }
  }, [kind, item.doubanId])

  useEffect(() => {
    if (!kind) return
    const cached = commentsCache.current.get(commentOrder)
    if (cached) {
      setComments(cached)
      return
    }
    let alive = true
    setCommentsLoading(true)
    setComments([])
    void window.laozheng.fetchSubjectComments(kind, item.doubanId, commentOrder).then((res) => {
      if (!alive) return
      setCommentsLoading(false)
      const list = res.ok ? res.comments : []
      commentsCache.current.set(commentOrder, list)
      setComments(list)
    })
    return () => {
      alive = false
    }
  }, [kind, item.doubanId, commentOrder])

  const data = {
    title: full?.title || item.title || '未命名条目',
    coverUrl: full?.coverUrl || item.coverUrl,
    rating: full?.rating ?? item.doubanRating,
    summary: full?.summary || item.summary,
    info: full?.info || item.info,
    directors: full?.directors || item.directors,
    writers: full?.writers ?? '',
    casts: full?.casts || item.casts,
    genres: full?.genres || item.genres,
    countries: full?.countries ?? '',
    dates: full?.dates ?? '',
    durations: full?.durations ?? '',
    aka: full?.aka ?? '',
    publisher: full?.publisher ?? '',
    pages: full?.pages ?? '',
    binding: full?.binding ?? '',
    authorIntro: full?.authorIntro ?? '',
    catalog: full?.catalog ?? '',
    developers: full?.developers ?? '',
    publishers: full?.publishers ?? '',
    platforms: full?.platforms ?? '',
    releaseDate: full?.releaseDate ?? '',
    credits: full?.credits ?? [],
    creditsTotal: full?.creditsTotal ?? full?.credits?.length ?? 0,
    photos: full?.photos ?? [],
    trailers: full?.trailers ?? []
  }

  const isVideo =
    item.category.includes('电影') || item.category.includes('剧') || item.category.includes('电视')
  const isBook = item.category.includes('书')
  const isGame = item.category.includes('游戏')

  const pubInfo = [data.publisher, data.info].filter(Boolean).join(' · ')
  const year = item.year || (data.dates.match(/\d{4}/)?.[0] ?? '')

  if (person) {
    if (personWork) {
      return (
        <ItemDetail
          item={personWorkToItem(personWork)}
          onBack={() => setPersonWork(null)}
          onNotice={onNotice}
          onWatch={onWatch}
        />
      )
    }
    return (
      <PersonDetail
        personId={person.id}
        fallbackName={person.name}
        fallbackAvatar={person.avatar}
        onBack={() => setPerson(null)}
        onOpenWork={(work) => setPersonWork(work)}
      />
    )
  }

  const fallbackCredits =
    isVideo && !data.credits.length
      ? [
          ...splitNames(data.directors).map((name) => ({
            id: null,
            name,
            role: '导演',
            avatar: null
          })),
          ...splitNames(data.casts).map((name) => ({
            id: null,
            name,
            role: '演员',
            avatar: null
          }))
        ]
      : []
  const apiCredits: SubjectCredit[] = data.credits.length ? data.credits : fallbackCredits
  /** 点过「查看全部」后改用整页名单；还没点过时只显示接口返回的主要演职员 */
  const creditList: SubjectCredit[] = fullCredits?.length ? fullCredits : apiCredits
  const creditTotal = Math.max(data.creditsTotal, creditList.length)
  const bookAuthors: SubjectCredit[] = creditList.length
    ? creditList
    : data.directors
        .split('/')
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ id: null, name, role: '作者', avatar: null }))
  const visibleCredits = expanded.credits ? creditList : apiCredits.slice(0, 8)
  const visiblePhotos = expanded.photos ? data.photos : data.photos.slice(0, 8)
  const hasMoreCredits = creditTotal > apiCredits.length
  const hasMorePhotos = data.photos.length > 8
  const creditGroups: { name: string; items: SubjectCredit[] }[] = []
  for (const credit of creditList) {
    const name = credit.department || credit.role || '职员'
    let group = creditGroups.find((item) => item.name === name)
    if (!group) {
      group = { name, items: [] }
      creditGroups.push(group)
    }
    group.items.push(credit)
  }
  const catalogLines = (data.catalog || '').split('\n').filter((line) => line.trim())
  const catalogText =
    expanded.catalog || catalogLines.length <= 10
      ? catalogLines.join('\n')
      : catalogLines.slice(0, 10).join('\n')
  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
  /** 演职员表「查看全部」：首次点击从豆瓣 celebrities 页抓整页名单（按部门分组） */
  const toggleCredits = async () => {
    if (!kind) return
    if (expanded.credits) {
      toggle('credits')
      return
    }
    if (fullCredits?.length) {
      setExpanded((prev) => ({ ...prev, credits: true }))
      return
    }
    if (creditsLoading) return
    setCreditsLoading(true)
    setCreditsError(null)
    const res = await window.laozheng.fetchSubjectCredits(kind, item.doubanId)
    setCreditsLoading(false)
    if (res.ok && res.credits.length) {
      setFullCredits(res.credits)
    } else {
      setCreditsError(res.error ?? '完整演职员表暂时取不到')
    }
    setExpanded((prev) => ({ ...prev, credits: true }))
  }
  const openPerson = (credit: { id: string | null; name: string; avatar: string | null }) => {
    if (credit.id) setPerson({ id: credit.id, name: credit.name, avatar: credit.avatar })
  }

  return (
    <>
      <header className="page-header">
        <button className="btn ghost" onClick={onBack}>
          <ChevronLeft size={15} /> 返回
        </button>
        <h1 className="page-title">{data.title}</h1>
        {actions ? (
          <div className="page-actions">{actions}</div>
        ) : onNotice ? (
          <div className="page-actions">
            <CollectAction item={item} onNotice={onNotice} />
          </div>
        ) : null}
      </header>

      <div className="item-detail-head">
        <div className="item-detail-cover">
          {data.coverUrl ? <img src={data.coverUrl} alt="" /> : null}
        </div>
        <div className="item-detail-info">
          <DetailLine label="名称" value={data.title} />
          {isVideo ? (
            <>
              <DetailLine label="导演" value={data.directors} />
              <DetailLine label="编剧" value={data.writers} />
              <DetailLine label="主演" value={data.casts} />
              <DetailLine label="类型" value={data.genres} />
              <DetailLine label="国家/地区" value={data.countries} />
              <DetailLine label="日期" value={data.dates || year} />
              <DetailLine label="片长" value={data.durations} />
              <DetailLine label="别名" value={data.aka} />
            </>
          ) : isBook ? (
            <>
              <DetailLine label="出版信息" value={pubInfo} />
              <DetailLine label="年代" value={year || data.dates} />
              <DetailLine label="页数" value={data.pages} />
              <DetailLine label="装帧" value={data.binding} />
              <DetailLine label="别名" value={data.aka} />
            </>
          ) : isGame ? (
            <>
              <DetailLine label="类型" value={data.genres} />
              <DetailLine label="时间" value={data.releaseDate || data.dates || year} />
              <DetailLine label="别名" value={data.aka} />
              <DetailLine label="平台" value={data.platforms} />
              <DetailLine label="开发商" value={data.developers} />
              <DetailLine label="发行" value={data.publishers} />
            </>
          ) : (
            <>
              <DetailLine label="类型" value={data.genres} />
              <DetailLine label="日期" value={data.dates || year} />
              <DetailLine label="别名" value={data.aka} />
            </>
          )}
          <div className="detail-line">
            <span className="detail-key">评分</span>
            <span className="detail-value">{scoreLine(data.rating)}</span>
          </div>
          {isVideo && onWatch ? (
            <div className="detail-actions">
              <button className="btn primary" onClick={() => onWatch(data.title)}>
                <Play size={14} /> 在线观看
              </button>
              <span className="page-desc">会按片名到观影里搜索全部片源</span>
            </div>
          ) : null}
          {loading ? <div className="page-desc">正在补全详情…</div> : null}
          {!loading && error && !full ? (
            <div className="page-desc">详情来源暂时不可用，展示的是本地保存的信息。</div>
          ) : null}
        </div>
      </div>

      <section className="detail-section">
        <h3 className="melon-heading">简介</h3>
        <p className="comic-desc">{data.summary || (loading ? '正在加载简介…' : '暂无简介。')}</p>
      </section>

      {isBook ? (
        <section className="detail-section">
          <h3 className="melon-heading">目录</h3>
          <p className="comic-desc" style={{ whiteSpace: 'pre-wrap' }}>
            {catalogText || (loading ? '正在加载目录…' : '暂无目录信息。')}
          </p>
          {catalogLines.length > 10 ? (
            <div className="detail-collapse-line">
              <button className="btn section-more" onClick={() => toggle('catalog')}>
                {expanded.catalog ? '收起' : `查看全部（${catalogLines.length} 行）`}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {isBook ? (
        <section className="detail-section">
          <h3 className="melon-heading">作者</h3>
          {bookAuthors.length ? (
            <div className="credit-grid">
              {bookAuthors.map((credit) => (
                <button
                  key={`${credit.id ?? credit.name}`}
                  className="credit-card"
                  title={credit.id ? `查看 ${credit.name} 的人物详情` : credit.name}
                  onClick={() => openPerson(credit)}
                  disabled={!credit.id}
                >
                  <span className="credit-avatar">
                    {credit.avatar ? (
                      <img src={credit.avatar} alt="" loading="lazy" />
                    ) : (
                      credit.name.slice(0, 1)
                    )}
                  </span>
                  <span className="credit-name">{credit.name}</span>
                  <span className="credit-role">{credit.role}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="page-desc">{loading ? '正在加载作者…' : '暂无作者信息。'}</div>
          )}
        </section>
      ) : null}

      {isVideo ? (
        <section className="detail-section">
          <div className="detail-section-head">
            <h3 className="melon-heading">演职员表</h3>
            {creditList.length && hasMoreCredits ? (
              <button
                className="btn section-more"
                disabled={creditsLoading}
                onClick={() => void toggleCredits()}
              >
                {creditsLoading
                  ? '正在加载完整演职员表…'
                  : expanded.credits
                    ? '收起'
                    : `查看全部（${creditTotal} 人）`}
              </button>
            ) : null}
          </div>
          {creditList.length ? (
            <>
              {expanded.credits && creditGroups.length > 1
                ? creditGroups.map((group) => (
                    <div key={group.name} className="credit-group">
                      <div className="credit-group-title">
                        {group.name}
                        <span className="credit-group-count">{group.items.length}</span>
                      </div>
                      <div className="credit-grid">
                        {group.items.map((credit) => (
                          <button
                            key={`${credit.id ?? credit.name}-${credit.role}`}
                            className="credit-card"
                            title={credit.id ? `查看 ${credit.name} 的人物详情` : credit.name}
                            onClick={() => openPerson(credit)}
                            disabled={!credit.id}
                          >
                            <span className="credit-avatar">
                              {credit.avatar ? (
                                <img src={credit.avatar} alt="" loading="lazy" />
                              ) : (
                                credit.name.slice(0, 1)
                              )}
                            </span>
                            <span className="credit-name">{credit.name}</span>
                            <span className="credit-role">{credit.role}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                : (
                  <div className="credit-grid">
                    {visibleCredits.map((credit) => (
                      <button
                        key={`${credit.id ?? credit.name}-${credit.role}`}
                        className="credit-card"
                        title={credit.id ? `查看 ${credit.name} 的人物详情` : credit.name}
                        onClick={() => openPerson(credit)}
                        disabled={!credit.id}
                      >
                        <span className="credit-avatar">
                          {credit.avatar ? (
                            <img src={credit.avatar} alt="" loading="lazy" />
                          ) : (
                            credit.name.slice(0, 1)
                          )}
                        </span>
                        <span className="credit-name">{credit.name}</span>
                        <span className="credit-role">{credit.role}</span>
                      </button>
                    ))}
                  </div>
                )}
              {creditsError ? (
                <div className="page-desc" style={{ marginTop: 8 }}>
                  {creditsError}，先显示主要演职员（站点记录共 {creditTotal} 人）。
                </div>
              ) : null}
              {expanded.credits && !creditsError && creditTotal > creditList.length ? (
                <div className="page-desc" style={{ marginTop: 8 }}>
                  站点只返回主要演职员，完整名单共 {creditTotal} 人。
                </div>
              ) : null}
            </>
          ) : (
            <div className="page-desc">{loading ? '正在加载演职员…' : '暂无演职员信息。'}</div>
          )}
        </section>
      ) : null}

      {isVideo || isGame ? (
        <section className="detail-section">
          <div className="detail-section-head">
            <h3 className="melon-heading">{isGame ? '图片' : '剧照'}</h3>
            {data.photos.length && hasMorePhotos ? (
              <button className="btn section-more" onClick={() => toggle('photos')}>
                {expanded.photos ? '收起' : `查看全部（${data.photos.length} 张）`}
              </button>
            ) : null}
          </div>
          {data.photos.length ? (
            <div className="detail-photos">
              {visiblePhotos.map((src) => (
                <img key={src} src={src} alt="" loading="lazy" />
              ))}
            </div>
          ) : (
            <div className="page-desc">
              {loading ? '正在加载图片…' : `暂无${isGame ? '图片' : '剧照'}。`}
            </div>
          )}
        </section>
      ) : null}

      {isVideo ? (
        <section className="detail-section">
          <div className="detail-section-head">
            <h3 className="melon-heading">预告片</h3>
            {trailer ? (
              <button className="btn section-more" onClick={() => setTrailer(null)}>
                <X size={13} /> 关闭
              </button>
            ) : null}
          </div>
          {trailer ? <VideoPlayer src={trailer} /> : null}
          {data.trailers.length ? (
            <div className="trailer-list">
              {data.trailers.map((t, index) => (
                <button
                  key={`${t.url}-${index}`}
                  className="trailer-item"
                  onClick={() => setTrailer(t.url)}
                >
                  <span className="trailer-cover">
                    {t.cover ? <img src={t.cover} alt="" loading="lazy" /> : null}
                    <span className="trailer-play">
                      <Play size={16} />
                    </span>
                  </span>
                  <span className="trailer-title">{t.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="page-desc">{loading ? '正在加载预告片…' : '暂无预告片。'}</div>
          )}
        </section>
      ) : null}

      <section className="detail-section">
        <div className="detail-section-head">
          <h3 className="melon-heading">短评</h3>
          <div className="toolbar" style={{ margin: 0 }}>
            <button
              className={`chip ${commentOrder === 'hot' ? 'active' : ''}`}
              onClick={() => setCommentOrder('hot')}
            >
              热门
            </button>
            <button
              className={`chip ${commentOrder === 'new' ? 'active' : ''}`}
              onClick={() => setCommentOrder('new')}
            >
              最新
            </button>
          </div>
        </div>
        {commentsLoading ? (
          <div className="page-desc">正在加载短评…</div>
        ) : comments.length === 0 ? (
          <div className="page-desc">暂时没有短评。</div>
        ) : (
          <div className="comment-list">
            {comments.map((comment, index) => (
              <div key={`${comment.author}-${index}`} className="comment-item">
                <div className="comment-head">
                  <span className="comment-author">{comment.author}</span>
                  {comment.rating != null ? scoreLine(comment.rating) : null}
                  <span className="comment-time">{comment.time}</span>
                </div>
                <p className="comment-content">{comment.content}</p>
                {comment.votes > 0 ? (
                  <div className="comment-votes">{comment.votes} 人觉得有用</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
