import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  Download,
  Heart,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload
} from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, ConfirmDialog, Modal } from '../components/ui'
import { VideoPlayer } from '../components/VideoPlayer'
import {
  genSourceId,
  normalizeBaseUrl,
  parsePlayGroups,
  parseSourceImport,
  vodHost,
  type VodEpisode,
  type VodPlayGroup,
  type VodSearchItem,
  type VodSourceInput
} from '../shared/vod'
import { DEFAULT_VOD_SOURCES } from '../shared/vodDefaults'
import type { InnerFav, VodSource } from '../shared/types'

type WatchResult = VodSearchItem & { sourceId: string; sourceName: string }

interface Selection {
  source: VodSource
  item: VodSearchItem
  groups: VodPlayGroup[]
  loading: boolean
  error?: string
}

interface Playback {
  source: VodSource
  item: VodSearchItem
  groups: VodPlayGroup[]
  groupIndex: number
  episodeIndex: number
  url: string
}

function toInput(source: VodSource): VodSourceInput {
  return { id: source.id, name: source.name, baseUrl: source.baseUrl }
}

const CONCURRENCY = 6

export function WatchPage({
  onNotice,
  variant,
  focusPlay
}: {
  onNotice: (text: string) => void
  /** 番1~番4：只搜第 N 个已启用的外网片源，并隐藏片源管理 */
  variant?: { label: string; proxyIndex: number }
  /** 从收藏进入：直接播放已保存的分集直链 */
  focusPlay?: { url: string; title: string }
}) {
  const { data, update } = useData()
  const favModule = variant ? 'h1' : 'watch'
  const [tab, setTab] = useState<'search' | 'sources'>('search')
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<WatchResult[]>([])
  const [sourceErrors, setSourceErrors] = useState<{ name: string; error: string }[]>([])
  const [selection, setSelection] = useState<Selection | null>(null)
  const [playback, setPlayback] = useState<Playback | null>(null)
  const [editing, setEditing] = useState<VodSource | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState<VodSource | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const seqRef = useRef(0)
  const [favPlay, setFavPlay] = useState<{ url: string; title: string } | null>(null)

  useEffect(() => {
    if (focusPlay?.url) setFavPlay(focusPlay)
  }, [focusPlay?.url, focusPlay?.title])

  const sources = data.vodSources
  const proxySources = useMemo(
    () => sources.filter((s) => s.enabled && s.region === 'proxy'),
    [sources]
  )
  const scopedSource = variant ? proxySources[variant.proxyIndex] : undefined
  const enabledSources = useMemo(
    () =>
      variant
        ? scopedSource
          ? [scopedSource]
          : []
        : sources.filter((s) => s.enabled),
    [variant, scopedSource, sources]
  )

  const favOf = (sourceId: string, vodId: number): InnerFav | undefined =>
    data.innerFavs.find((f) => f.module === favModule && f.id === `${sourceId}|${vodId}`)

  const toggleFav = (source: VodSource, item: VodSearchItem, url?: string) => {
    const favId = `${source.id}|${item.vod_id}`
    const exists = data.innerFavs.some((f) => f.module === favModule && f.id === favId)
    update((d) => {
      if (exists) {
        return { ...d, innerFavs: d.innerFavs.filter((f) => !(f.module === favModule && f.id === favId)) }
      }
      const fav: InnerFav = {
        module: favModule,
        id: favId,
        title: item.vod_name,
        subtitle: [source.name, item.vod_year].filter(Boolean).join(' · '),
        cover: item.vod_pic || null,
        savedAt: Date.now(),
        videoUrl: url ?? null,
        mediaId: item.vod_id,
        durationSec: 0,
        tweetUrl: null,
        payload: null
      }
      return { ...d, innerFavs: [...d.innerFavs, fav] }
    })
    onNotice(exists ? '已取消收藏' : '已收藏，可在「收藏」页查看')
  }

  const runSearch = async (raw: string) => {
    const kw = raw.trim()
    if (!kw || searching) return
    if (!enabledSources.length) {
      onNotice('还没有启用的片源，先到「片源管理」添加')
      setTab('sources')
      return
    }
    const seq = ++seqRef.current
    setSearching(true)
    setSearched(false)
    setResults([])
    setSourceErrors([])
    setProgress({ done: 0, total: enabledSources.length })
    const year = kw.match(/\b(19|20)\d{2}\b/)?.[0] ?? ''
    const queue = [...enabledSources]
    const errors: { name: string; error: string }[] = []
    let done = 0

    const worker = async () => {
      for (;;) {
        const source = queue.shift()
        if (!source) return
        const res = await window.laozheng.searchVod(toInput(source), kw, year)
        if (seq !== seqRef.current) return
        done += 1
        setProgress({ done, total: enabledSources.length })
        if (!res.ok) {
          errors.push({ name: source.name, error: res.error ?? '搜索失败' })
          setSourceErrors([...errors])
          continue
        }
        if (!res.items.length) continue
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
    setSearched(true)
  }

  const openDetail = async (sourceId: string, item: VodSearchItem) => {
    const source = sources.find((s) => s.id === sourceId)
    if (!source) return
    setSelection({ source, item, groups: [], loading: true })
    const immediate = parsePlayGroups(item.vod_play_from, item.vod_play_url)
    if (immediate.length) {
      setSelection({ source, item, groups: immediate, loading: false })
    }
    const res = await window.laozheng.fetchVodDetail(toInput(source), item.vod_id)
    if (res.ok && res.item) {
      setSelection({
        source,
        item: { ...item, ...res.item },
        groups: res.groups ?? [],
        loading: false
      })
    } else if (!immediate.length) {
      setSelection({ source, item, groups: [], loading: false, error: res.error ?? '没有取到播放地址' })
    }
  }

  const startPlayback = (source: VodSource, item: VodSearchItem, groups: VodPlayGroup[], groupIndex: number, episodeIndex: number) => {
    const group = groups[groupIndex]
    const episode: VodEpisode | undefined = group?.episodes[episodeIndex]
    if (!episode) return
    setSelection(null)
    setPlayback({ source, item, groups, groupIndex, episodeIndex, url: episode.url })
  }

  const saveSource = (input: VodSourceInput, region: 'cn' | 'proxy') => {
    if (editing === 'new') {
      update((d) => ({
        ...d,
        vodSources: [
          ...d.vodSources,
          {
            id: d.vodSources.some((s) => s.id === input.id) ? genSourceId(input.baseUrl) : input.id,
            name: input.name,
            baseUrl: normalizeBaseUrl(input.baseUrl),
            enabled: true,
            region,
            regionManual: true,
            testStatus: null,
            testMsg: null,
            testAt: 0
          }
        ]
      }))
      onNotice(`已添加片源「${input.name}」`)
    } else if (editing) {
      update((d) => ({
        ...d,
        vodSources: d.vodSources.map((s) =>
          s.id === editing.id
            ? {
                ...s,
                name: input.name,
                baseUrl: normalizeBaseUrl(input.baseUrl),
                region,
                regionManual: true
              }
            : s
        )
      }))
      onNotice(`已保存「${input.name}」`)
    }
    setEditing(null)
  }

  const importSources = (inputs: VodSourceInput[]) => {
    const existing = new Set(data.vodSources.map((s) => s.baseUrl))
    const fresh = inputs.filter((i) => !existing.has(i.baseUrl))
    if (!fresh.length) {
      onNotice('这些片源已存在')
      setImporting(false)
      return
    }
    update((d) => {
      const exists = new Set(d.vodSources.map((s) => s.baseUrl))
      const added: VodSource[] = []
      for (const input of fresh) {
        if (exists.has(input.baseUrl)) continue
        exists.add(input.baseUrl)
        let id = input.id || genSourceId(input.baseUrl)
        let n = 2
        while (d.vodSources.some((s) => s.id === id) || added.some((s) => s.id === id)) {
          id = `${input.id}_${n++}`
        }
        added.push({
          id,
          name: input.name || vodHost(input.baseUrl),
          baseUrl: normalizeBaseUrl(input.baseUrl),
          enabled: true,
          region: 'cn',
          regionManual: false,
          testStatus: null,
          testMsg: null,
          testAt: 0
        })
      }
      return { ...d, vodSources: [...d.vodSources, ...added] }
    })
    onNotice(`已导入 ${fresh.length} 个片源`)
    setImporting(false)
  }

  const testSource = async (source: VodSource) => {
    setTestingId(source.id)
    const res = await window.laozheng.testVodSource(toInput(source))
    update((d) => ({
      ...d,
      vodSources: d.vodSources.map((s) =>
        s.id === source.id
          ? {
              ...s,
              testStatus: res.status,
              testMsg: res.message,
              testAt: res.testAt,
              region: s.regionManual ? s.region : res.region
            }
          : s
      )
    }))
    setTestingId(null)
    onNotice(`${source.name}：${res.message}`)
  }

  const removeSource = () => {
    if (!deleting) return
    update((d) => ({ ...d, vodSources: d.vodSources.filter((s) => s.id !== deleting.id) }))
    onNotice(`已删除片源「${deleting.name}」`)
    setDeleting(null)
  }

  const downloadEpisode = async () => {
    if (!playback) return
    const group = playback.groups[playback.groupIndex]
    const episode = group?.episodes[playback.episodeIndex]
    const res = await window.laozheng.addDownload({
      title: `${playback.item.vod_name} ${episode?.name ?? ''}`.trim(),
      url: playback.url,
      kind: 'video',
      coverUrl: playback.item.vod_pic,
      sourceName: playback.source.name
    })
    onNotice(res.ok ? '已加入下载队列，可在「下载」页查看进度' : `下载失败：${res.error}`)
  }

  if (favPlay) {
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={() => setFavPlay(null)}>
            <ChevronLeft size={15} /> 返回
          </button>
          <h1 className="page-title">{favPlay.title}</h1>
          <span className="page-desc">收藏 · 播放已保存的分集直链</span>
        </header>
        <VideoPlayer src={favPlay.url} />
      </>
    )
  }

  if (playback) {
    const group = playback.groups[playback.groupIndex]
    const fav = favOf(playback.source.id, playback.item.vod_id)
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={() => setPlayback(null)}>
            <ChevronLeft size={15} /> 返回
          </button>
          <h1 className="page-title">{playback.item.vod_name}</h1>
          <span className="page-desc">
            {playback.source.name} · {group?.name}
          </span>
          <div className="page-actions">
            <button className="btn" onClick={() => void downloadEpisode()}>
              <Download size={15} /> 下载
            </button>
            <button className="btn" onClick={() => toggleFav(playback.source, playback.item, playback.url)}>
              <Heart size={15} fill={fav ? 'currentColor' : 'none'} /> {fav ? '已收藏' : '收藏'}
            </button>
          </div>
        </header>

        <VideoPlayer src={playback.url} />

        {playback.groups.length > 1 && (
          <div className="toolbar" style={{ marginTop: 14 }}>
            {playback.groups.map((g, gi) => (
              <button
                key={`${g.name}-${gi}`}
                className={`chip ${gi === playback.groupIndex ? 'active' : ''}`}
                onClick={() => startPlayback(playback.source, playback.item, playback.groups, gi, 0)}
              >
                {g.name}
              </button>
            ))}
          </div>
        )}

        <div className="episode-grid">
          {(group?.episodes ?? []).map((ep, i) => (
            <button
              key={`${ep.url}-${i}`}
              className={`episode ${i === playback.episodeIndex ? 'active' : ''}`}
              onClick={() =>
                startPlayback(playback.source, playback.item, playback.groups, playback.groupIndex, i)
              }
            >
              {ep.name}
            </button>
          ))}
        </div>
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">{variant ? variant.label : '观影'}</h1>
        <span className="page-desc">
          {variant
            ? scopedSource
              ? `外网片源：${scopedSource.name}`
              : '没有可用的外网片源'
            : `${sources.length} 个片源 · 已启用 ${enabledSources.length} 个 · 跨源搜索后直接播放`}
        </span>
        {!variant && (
          <div className="page-actions">
            <button className="btn" onClick={() => setTab('sources')}>
              片源管理
            </button>
          </div>
        )}
      </header>

      {!variant && (
        <div className="toolbar">
          <button className={`chip ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>
            搜索
          </button>
          <button className={`chip ${tab === 'sources' ? 'active' : ''}`} onClick={() => setTab('sources')}>
            片源管理
          </button>
        </div>
      )}

      {variant || tab === 'search' ? (
        <>
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault()
              void runSearch(keyword)
            }}
          >
            <label className="search">
              <Search size={16} />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="输入片名（可带年份，如 沙丘 2021）"
              />
            </label>
            <button className="btn primary" type="submit" disabled={!keyword.trim() || searching}>
              {searching ? `搜索中 ${progress.done}/${progress.total}` : '搜索'}
            </button>
          </form>

          {variant && !scopedSource ? (
            <EmptyState
              title="没有可用的外网片源"
              desc="请先在「观影 → 片源管理」添加片源，并把网络目录设为「需要外网」；番1~番4 会依次使用第 1~4 个已启用的外网片源。"
            />
          ) : sources.length === 0 ? (
            <EmptyState
              title="还没有片源"
              desc="先导入内置片源，或手动添加苹果CMS接口地址（形如 https://xxx/api.php/provide/vod）。"
              action={
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn primary" onClick={() => setImporting(true)}>
                    导入内置片源
                  </button>
                  <button className="btn" onClick={() => setEditing('new')}>
                    手动添加
                  </button>
                </div>
              }
            />
          ) : searching && results.length === 0 ? (
            <EmptyState
              title={`正在搜索 ${progress.done}/${progress.total} 个片源…`}
              desc="结果会随着片源返回实时追加。"
            />
          ) : !searched ? (
            <EmptyState
              title="输入片名开始跨源搜索"
              desc="会并行查询所有已启用片源，只保留片名匹配的结果；点击结果选择线路即可播放。"
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
                找到 {results.length} 条{searching ? `（搜索中 ${progress.done}/${progress.total}）` : ''}
              </div>
              <div className="rows">
                {results.map((item) => {
                  const fav = favOf(item.sourceId, item.vod_id)
                  return (
                    <div
                      key={`${item.sourceId}-${item.vod_id}`}
                      className="row clickable"
                      onClick={() => void openDetail(item.sourceId, item)}
                    >
                      <div className="row-cover">
                        {item.vod_pic ? <img src={item.vod_pic} alt="" loading="lazy" /> : '影片'}
                      </div>
                      <div className="row-main">
                        <div className="row-title">{item.vod_name}</div>
                        <div className="row-meta">
                          {[item.type_name, item.vod_year, item.vod_area, item.vod_remarks]
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
                          toggleFav(sources.find((s) => s.id === item.sourceId)!, item)
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
      ) : (
        <SourceManager
          sources={sources}
          testingId={testingId}
          onAdd={() => setEditing('new')}
          onImport={() => setImporting(true)}
          onEdit={setEditing}
          onTest={(s) => void testSource(s)}
          onToggle={(s) =>
            update((d) => ({
              ...d,
              vodSources: d.vodSources.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x))
            }))
          }
          onDelete={setDeleting}
        />
      )}

      {selection && (
        <DetailModal
          selection={selection}
          isFav={!!favOf(selection.source.id, selection.item.vod_id)}
          onClose={() => setSelection(null)}
          onToggleFav={() => toggleFav(selection.source, selection.item)}
          onPlay={(gi, ei) =>
            startPlayback(selection.source, selection.item, selection.groups, gi, ei)
          }
        />
      )}

      {editing && (
        <SourceEditModal
          source={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={saveSource}
        />
      )}

      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onImport={importSources}
          onBuiltin={() => importSources(DEFAULT_VOD_SOURCES.map(toInput))}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="删除片源"
          message={`确定删除「${deleting.name}」吗？只影响本机片源配置，不影响清单数据。`}
          confirmText="删除"
          danger
          onConfirm={removeSource}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}

function SourceManager({
  sources,
  testingId,
  onAdd,
  onImport,
  onEdit,
  onTest,
  onToggle,
  onDelete
}: {
  sources: VodSource[]
  testingId: string | null
  onAdd: () => void
  onImport: () => void
  onEdit: (source: VodSource) => void
  onTest: (source: VodSource) => void
  onToggle: (source: VodSource) => void
  onDelete: (source: VodSource) => void
}) {
  const [onlyEnabled, setOnlyEnabled] = useState(false)
  const list = onlyEnabled ? sources.filter((s) => s.enabled) : sources

  return (
    <>
      <div className="toolbar">
        <button className="btn primary" onClick={onAdd}>
          <Plus size={15} /> 添加片源
        </button>
        <button className="btn" onClick={onImport}>
          <Upload size={15} /> 批量导入
        </button>
        <button
          className={`chip ${onlyEnabled ? 'active' : ''}`}
          onClick={() => setOnlyEnabled((v) => !v)}
        >
          只看已启用
        </button>
        <span className="page-desc">{sources.length} 个片源</span>
      </div>

      {sources.length === 0 ? (
        <EmptyState
          title="还没有片源"
          desc="可以导入内置片源，或粘贴自己的苹果CMS采集接口。"
          action={
            <button className="btn" onClick={onImport}>
              批量导入
            </button>
          }
        />
      ) : (
        <div className="rows">
          {list.map((s) => (
            <div key={s.id} className="row">
              <span
                className={`status-dot ${s.enabled ? (s.testStatus === 'ok' ? 'ok' : s.testStatus ? 'warn' : '') : 'off'}`}
              />
              <div className="row-main">
                <div className="row-title">
                  {s.name}
                  <span className={`badge ${s.region === 'proxy' ? 'warn' : ''}`} style={{ marginLeft: 8 }}>
                    {s.region === 'proxy' ? '需外网' : '国内'}
                  </span>
                </div>
                <div className="row-meta">{vodHost(s.baseUrl)}</div>
                <div className="row-meta">{s.testMsg ?? '未测试'}</div>
              </div>
              <button className="btn" disabled={testingId === s.id} onClick={() => onTest(s)}>
                <RefreshCw size={14} /> {testingId === s.id ? '测试中…' : '测试'}
              </button>
              <button className="btn" onClick={() => onToggle(s)}>
                {s.enabled ? '停用' : '启用'}
              </button>
              <button className="icon-btn" title="编辑" onClick={() => onEdit(s)}>
                <Pencil size={14} />
              </button>
              <button className="icon-btn danger" title="删除" onClick={() => onDelete(s)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function DetailModal({
  selection,
  isFav,
  onClose,
  onToggleFav,
  onPlay
}: {
  selection: Selection
  isFav: boolean
  onClose: () => void
  onToggleFav: () => void
  onPlay: (groupIndex: number, episodeIndex: number) => void
}) {
  const [groupIndex, setGroupIndex] = useState(0)
  const { item, source, groups, loading, error } = selection
  const group = groups[groupIndex]

  return (
    <Modal
      title={item.vod_name}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onToggleFav}>
            <Heart size={14} fill={isFav ? 'currentColor' : 'none'} /> {isFav ? '已收藏' : '收藏'}
          </button>
          <button className="btn ghost" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <div className="detail-head">
        <div className="detail-cover">
          {item.vod_pic ? <img src={item.vod_pic} alt="" /> : null}
        </div>
        <div className="detail-meta">
          <div>
            {[item.type_name, item.vod_year, item.vod_area].filter(Boolean).join(' · ') || '—'}
          </div>
          <div>{item.vod_remarks || '暂无备注'}</div>
          <div className="detail-source">片源：{source.name}</div>
        </div>
      </div>

      {loading ? (
        <p>正在获取播放地址…</p>
      ) : error ? (
        <p>{error}</p>
      ) : groups.length === 0 ? (
        <p>该片源没有返回可播放地址，换一个片源试试。</p>
      ) : (
        <>
          {groups.length > 1 && (
            <div className="toolbar">
              {groups.map((g, gi) => (
                <button
                  key={`${g.name}-${gi}`}
                  className={`chip ${gi === groupIndex ? 'active' : ''}`}
                  onClick={() => setGroupIndex(gi)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
          <div className="episode-grid modal-scroll">
            {(group?.episodes ?? []).map((ep, ei) => (
              <button
                key={`${ep.url}-${ei}`}
                className="episode"
                onClick={() => onPlay(groupIndex, ei)}
              >
                {ep.name}
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

function SourceEditModal({
  source,
  onClose,
  onSave
}: {
  source: VodSource | null
  onClose: () => void
  onSave: (input: VodSourceInput, region: 'cn' | 'proxy') => void
}) {
  const [name, setName] = useState(source?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(source?.baseUrl ?? '')
  const [region, setRegion] = useState<'cn' | 'proxy'>(source?.region === 'proxy' ? 'proxy' : 'cn')
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())

  return (
    <Modal
      title={source ? '编辑片源' : '添加片源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() =>
              onSave(
                {
                  id: source?.id ?? genSourceId(baseUrl.trim()),
                  name: name.trim(),
                  baseUrl: baseUrl.trim()
                },
                region
              )
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：非凡资源" />
        </label>
        <label>
          接口地址
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://example.com/api.php/provide/vod"
          />
        </label>
        <label>
          网络目录
          <select value={region} onChange={(e) => setRegion(e.target.value as 'cn' | 'proxy')}>
            <option value="cn">国内可访问</option>
            <option value="proxy">需要外网</option>
          </select>
        </label>
      </div>
    </Modal>
  )
}

function ImportModal({
  onClose,
  onImport,
  onBuiltin
}: {
  onClose: () => void
  onImport: (inputs: VodSourceInput[]) => void
  onBuiltin: () => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const doImport = () => {
    const res = parseSourceImport(text)
    if (res.error) {
      setError(res.error)
      return
    }
    onImport(res.sources)
  }

  return (
    <Modal
      title="批量导入片源"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn" onClick={onBuiltin}>
            导入内置片源
          </button>
          <button className="btn primary" disabled={!text.trim()} onClick={doImport}>
            导入
          </button>
        </>
      }
    >
      <p>
        支持 KVideo 订阅 JSON（数组或单对象），或每行一个「名称|接口地址」。接口地址形如
        https://example.com/api.php/provide/vod。
      </p>
      <textarea
        className="textarea"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
        placeholder={'非凡资源|https://example.com/api.php/provide/vod\nhttps://another.com/api.php/provide/vod'}
      />
      {error ? <div className="result-hint">{error}</div> : null}
    </Modal>
  )
}
