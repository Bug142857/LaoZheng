import { useEffect, useState } from 'react'
import { ChevronLeft, Star } from 'lucide-react'
import { EmptyState } from './ui'
import type { PersonFull, PersonWork } from '../shared/douban'
import type { CollectionItem } from '../shared/types'

/** 人物作品 → 条目详情页需要的结构（豆瓣编号 + 类型） */
export function personWorkToItem(work: PersonWork): CollectionItem {
  const category = work.kind === 'book' ? '图书' : work.kind === 'tv' ? '剧集' : '电影'
  return {
    id: 0,
    category,
    doubanId: work.id,
    title: work.title,
    subTitle: work.role,
    year: work.year,
    doubanRating: work.rating,
    coverUrl: work.cover,
    summary: '',
    info: '',
    directors: '',
    casts: '',
    genres: '',
    doubanUrl:
      work.kind === 'book'
        ? `https://book.douban.com/subject/${work.id}/`
        : `https://movie.douban.com/subject/${work.id}/`,
    status: '',
    myRating: 0,
    note: '',
    createdAt: 0,
    updatedAt: 0
  }
}

function PersonLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-line">
      <span className="detail-key">{label}</span>
      <span className="detail-value">{value || '—'}</span>
    </div>
  )
}

function WorkGrid({
  works,
  onOpen
}: {
  works: PersonWork[]
  onOpen?: (work: PersonWork) => void
}) {
  return (
    <div className="person-work-grid">
      {works.map((work) => {
        const open = () => onOpen?.(work)
        return (
          <div
            key={`${work.id}-${work.title}`}
            className={`person-work-card ${onOpen ? 'clickable' : ''}`}
            role={onOpen ? 'button' : undefined}
            tabIndex={onOpen ? 0 : undefined}
            title={onOpen ? `查看《${work.title}》详情` : work.title}
            onClick={onOpen ? open : undefined}
            onKeyDown={
              onOpen
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') open()
                  }
                : undefined
            }
          >
            <span className="person-work-cover">
              {work.cover ? <img src={work.cover} alt="" loading="lazy" /> : null}
            </span>
            <span className="person-work-title" title={work.title}>
              {work.title}
            </span>
            <span className="person-work-meta">
              {[work.year, work.role].filter(Boolean).join(' · ') || '—'}
            </span>
            {work.rating ? (
              <span className="person-work-rating">
                <Star size={10} fill="#f5c518" stroke="#f5c518" /> {work.rating.toFixed(1)}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/** 人物详情页：从演职员表 / 图书作者点进来，展示资料、简介、获奖、照片与作品 */
export function PersonDetail({
  personId,
  fallbackName,
  fallbackAvatar,
  onBack,
  onOpenWork
}: {
  personId: string
  fallbackName?: string
  fallbackAvatar?: string | null
  onBack: () => void
  /** 点作品卡片：打开对应影视 / 图书条目详情 */
  onOpenWork?: (work: PersonWork) => void
}) {
  const [person, setPerson] = useState<PersonFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setPerson(null)
    setExpanded({})
    void window.laozheng.fetchPersonFull(personId).then((res) => {
      if (!alive) return
      setLoading(false)
      if (res.ok && res.person) setPerson(res.person)
      else setError(res.error ?? '人物详情加载失败')
    })
    return () => {
      alive = false
    }
  }, [personId])

  const name = person?.name || fallbackName || '人物'
  const avatar = person?.avatar || fallbackAvatar || null
  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
  const photos = person?.photos ?? []
  const visiblePhotos = expanded.photos ? photos : photos.slice(0, 12)
  const worksLabel = person?.worksLabel || ''
  const recentWorks = person?.recentWorks ?? []
  const visibleRecent = expanded.recent ? recentWorks : recentWorks.slice(0, 8)
  const topWorks = person?.topWorks ?? []
  const visibleTop = expanded.top ? topWorks : topWorks.slice(0, 8)
  const awards = person?.awards ?? []
  /** 加载中不要显示「暂无」，避免看起来像真的没有数据 */
  const pendingText = (text: string) => (loading ? '正在加载…' : text)

  return (
    <>
      <header className="page-header">
        <button className="btn ghost" onClick={onBack}>
          <ChevronLeft size={15} /> 返回
        </button>
        <h1 className="page-title">{name}</h1>
      </header>

      {loading ? (
        <EmptyState title="正在加载人物资料…" />
      ) : error && !person ? (
        <EmptyState title="加载失败" desc={error} />
      ) : person ? (
        <>
          <div className="item-detail-head">
            <div className="item-detail-cover person-detail-cover">
              {avatar ? <img src={avatar} alt="" /> : null}
            </div>
            <div className="item-detail-info">
              <PersonLine label="姓名" value={person.name || name} />
              <PersonLine label="性别" value={person.gender} />
              <PersonLine label="出生日期" value={person.birthday} />
              <PersonLine label="出生地" value={person.birthplace} />
              <PersonLine label="别名" value={person.aka} />
              {person.professions ? <PersonLine label="职业" value={person.professions} /> : null}
            </div>
          </div>

          <section className="detail-section">
            <h3 className="melon-heading">人物简介</h3>
            <p className="comic-desc" style={{ whiteSpace: 'pre-wrap' }}>
              {person.intro || pendingText('暂无简介。')}
            </p>
          </section>

          <section className="detail-section">
            <h3 className="melon-heading">获奖情况</h3>
            {awards.length ? (
              <div className="person-awards">
                {awards.map((award, index) => (
                  <div key={`${award.year}-${award.ceremony}-${award.category}-${index}`} className="person-award">
                    <span className="person-award-year">{award.year || '—'}</span>
                    <span className="person-award-main">
                      {[award.ceremony, award.category].filter(Boolean).join(' · ')}
                    </span>
                    <span className={`person-award-tag ${award.won ? 'won' : ''}`}>
                      {award.won ? '获奖' : '提名'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="page-desc">{pendingText('暂无获奖信息。')}</div>
            )}
          </section>

          <section className="detail-section">
            <div className="detail-section-head">
              <h3 className="melon-heading">照片</h3>
              {photos.length > 12 ? (
                <button className="btn section-more" onClick={() => toggle('photos')}>
                  {expanded.photos ? '收起' : `查看全部（${photos.length} 张）`}
                </button>
              ) : null}
            </div>
            {photos.length ? (
              <div className="detail-photos">
                {visiblePhotos.map((src) => (
                  <img key={src} src={src} alt="" loading="lazy" />
                ))}
              </div>
            ) : (
              <div className="page-desc">暂无照片。</div>
            )}
          </section>

          <section className="detail-section">
            <div className="detail-section-head">
              <h3 className="melon-heading">{worksLabel ? `${worksLabel}作品 · 最新` : '作品 · 最新'}</h3>
              {recentWorks.length > 8 ? (
                <button className="btn section-more" onClick={() => toggle('recent')}>
                  {expanded.recent ? '收起' : `查看全部（${recentWorks.length} 部）`}
                </button>
              ) : null}
            </div>
            {recentWorks.length ? (
              <WorkGrid works={visibleRecent} onOpen={onOpenWork} />
            ) : (
              <div className="page-desc">{loading ? '正在加载…' : '暂无作品信息。'}</div>
            )}
          </section>

          <section className="detail-section">
            <div className="detail-section-head">
              <h3 className="melon-heading">{worksLabel ? `${worksLabel}作品 · 热门` : '作品 · 热门'}</h3>
              {topWorks.length > 8 ? (
                <button className="btn section-more" onClick={() => toggle('top')}>
                  {expanded.top ? '收起' : `查看全部（${topWorks.length} 部）`}
                </button>
              ) : null}
            </div>
            {topWorks.length ? (
              <WorkGrid works={visibleTop} onOpen={onOpenWork} />
            ) : (
              <div className="page-desc">{loading ? '正在加载…' : '暂无作品信息。'}</div>
            )}
          </section>
        </>
      ) : null}
    </>
  )
}
