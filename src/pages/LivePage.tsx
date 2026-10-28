import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Heart, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, ConfirmDialog, Modal } from '../components/ui'
import { VideoPlayer } from '../components/VideoPlayer'
import type { LiveChannel, LiveChannelResult, LiveSource } from '../shared/live'
import type { InnerFav } from '../shared/types'

interface Playing {
  channel: LiveChannel
  sourceName: string
}

interface ChannelCache {
  [sourceId: string]: LiveChannelResult
}

function newSourceId(url: string): string {
  let h = 0
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0
  return `live_${Math.abs(h)}`
}

export function LivePage({
  onNotice,
  focusUrl
}: {
  onNotice: (text: string) => void
  focusUrl?: string
}) {
  const { data, update } = useData()
  const [sources, setSources] = useState<LiveSource[] | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [cache, setCache] = useState<ChannelCache>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('全部')
  const [playing, setPlaying] = useState<Playing | null>(null)
  const [adding, setAdding] = useState(false)
  const [managing, setManaging] = useState(false)
  const [deleting, setDeleting] = useState<LiveSource | null>(null)

  const loadChannels = async (source: LiveSource) => {
    setSelectedId(source.id)
    setGroup('全部')
    setQuery('')
    if (cache[source.id] && !cache[source.id].error) return
    setLoadingId(source.id)
    const res = await window.laozheng.loadLiveChannels(source)
    setCache((prev) => ({ ...prev, [source.id]: res }))
    setLoadingId(null)
  }

  useEffect(() => {
    let alive = true
    window.laozheng.loadLiveSources().then((list) => {
      if (!alive) return
      setSources(list)
      const first = list.find((s) => s.enabled)
      if (first) void loadChannels(first)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!focusUrl) return
    setPlaying({ channel: { group: '收藏', name: '收藏频道', url: focusUrl }, sourceName: '收藏' })
  }, [focusUrl])

  const persist = (next: LiveSource[]) => {
    setSources(next)
    void window.laozheng.saveLiveSources(next)
  }

  const current = sources?.find((s) => s.id === selectedId) ?? null
  const currentResult = selectedId ? cache[selectedId] : undefined
  const channels = currentResult?.channels ?? []

  const groups = useMemo(() => {
    const list: string[] = []
    for (const c of channels) if (!list.includes(c.group)) list.push(c.group)
    return list
  }, [channels])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return channels.filter(
      (c) => (group === '全部' || c.group === group) && (!q || c.name.toLowerCase().includes(q))
    )
  }, [channels, group, query])

  const favId = (channel: LiveChannel) => `custom|${channel.url}`
  const fav = playing ? data.innerFavs.find((f) => f.module === 'tv' && f.id === favId(playing.channel)) : undefined

  const toggleFav = (target: Playing) => {
    const id = favId(target.channel)
    const exists = data.innerFavs.some((f) => f.module === 'tv' && f.id === id)
    update((d) => {
      if (exists) return { ...d, innerFavs: d.innerFavs.filter((f) => !(f.module === 'tv' && f.id === id)) }
      const row: InnerFav = {
        module: 'tv',
        id,
        title: target.channel.name,
        subtitle: [target.sourceName, target.channel.group].filter(Boolean).join(' · '),
        cover: null,
        savedAt: Date.now(),
        videoUrl: target.channel.url,
        mediaId: 0,
        durationSec: 0,
        tweetUrl: null,
        payload: null
      }
      return { ...d, innerFavs: [...d.innerFavs, row] }
    })
    onNotice(exists ? '已取消收藏' : '已收藏，可在「收藏」页查看')
  }

  const addUrlSource = (name: string, url: string) => {
    if (!sources) return
    const source: LiveSource = {
      id: newSourceId(url),
      name: name.trim() || '直播源',
      url: url.trim(),
      content: '',
      enabled: true
    }
    persist([...sources, source])
    setAdding(false)
    void loadChannels(source)
    onNotice(`已添加「${source.name}」`)
  }

  const importFile = async () => {
    const res = await window.laozheng.importLiveFile()
    if (res.canceled) return
    if (res.error) {
      onNotice(`导入失败：${res.error}`)
      return
    }
    if (!res.source || !sources) return
    if (sources.some((s) => s.id === res.source!.id)) {
      onNotice('该直播源已存在')
      return
    }
    persist([...sources, res.source])
    void loadChannels(res.source)
    onNotice(`已导入「${res.source.name}」`)
  }

  const removeSource = () => {
    if (!deleting || !sources) return
    const next = sources.filter((s) => s.id !== deleting.id)
    persist(next)
    setDeleting(null)
    if (selectedId === deleting.id) {
      setSelectedId('')
      const first = next.find((s) => s.enabled)
      if (first) void loadChannels(first)
    }
    onNotice(`已删除「${deleting.name}」`)
  }

  if (sources === null) {
    return <EmptyState title="正在加载电视源…" />
  }

  if (playing) {
    return (
      <>
        <header className="page-header">
          <button className="btn ghost" onClick={() => setPlaying(null)}>
            <ChevronLeft size={15} /> 返回
          </button>
          <h1 className="page-title">{playing.channel.name}</h1>
          <span className="page-desc">{playing.sourceName} · {playing.channel.group}</span>
          <div className="page-actions">
            <button className="btn" onClick={() => toggleFav(playing)}>
              <Heart size={15} fill={fav ? 'currentColor' : 'none'} /> {fav ? '已收藏' : '收藏'}
            </button>
          </div>
        </header>
        <VideoPlayer src={playing.channel.url} />
        <div className="page-desc" style={{ marginTop: 12 }}>
          直播流地址：{playing.channel.url}
        </div>
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">电视</h1>
        <span className="page-desc">
          {sources.length} 个源 · {channels.length} 个频道
        </span>
        <div className="page-actions">
          <button className="btn" onClick={() => setAdding(true)}>
            <Plus size={15} /> 添加源
          </button>
          <button className="btn" onClick={() => void importFile()}>
            <Upload size={15} /> 导入 M3U
          </button>
          <button className="btn" onClick={() => setManaging(true)}>
            管理源
          </button>
        </div>
      </header>

      {sources.length === 0 ? (
        <EmptyState
          title="还没有电视源"
          desc="添加 M3U / M3U8 地址，或从本地导入播放列表。"
          action={
            <button className="btn primary" onClick={() => setAdding(true)}>
              添加源
            </button>
          }
        />
      ) : (
        <>
          <div className="toolbar">
            {sources
              .filter((s) => s.enabled)
              .map((s) => (
                <button
                  key={s.id}
                  className={`chip ${selectedId === s.id ? 'active' : ''}`}
                  onClick={() => void loadChannels(s)}
                >
                  {s.name}
                </button>
              ))}
            {current && (
              <button
                className="btn ghost"
                disabled={loadingId === current.id}
                onClick={() => {
                  setCache((prev) => {
                    const next = { ...prev }
                    delete next[current.id]
                    return next
                  })
                  void loadChannels(current)
                }}
              >
                <RefreshCw size={14} /> {loadingId === current.id ? '加载中…' : '重载'}
              </button>
            )}
          </div>

          {currentResult?.error ? (
            <EmptyState
              title="频道加载失败"
              desc={currentResult.error}
              action={
                <button
                  className="btn"
                  onClick={() => {
                    if (!current) return
                    setCache((prev) => {
                      const next = { ...prev }
                      delete next[current.id]
                      return next
                    })
                    void loadChannels(current)
                  }}
                >
                  重试
                </button>
              }
            />
          ) : loadingId === current?.id && channels.length === 0 ? (
            <EmptyState title="正在加载频道…" desc="直播源较大时可能需要几秒。" />
          ) : channels.length === 0 ? (
            <EmptyState title="这个源没有频道" desc="换一个源，或重新导入播放列表。" />
          ) : (
            <>
              <div className="toolbar">
                <label className="search">
                  <Search size={16} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索频道…"
                  />
                </label>
              </div>
              <div className="toolbar">
                <button
                  className={`chip ${group === '全部' ? 'active' : ''}`}
                  onClick={() => setGroup('全部')}
                >
                  全部 {channels.length}
                </button>
                {groups.map((g) => {
                  const count = channels.filter((c) => c.group === g).length
                  return (
                    <button
                      key={g}
                      className={`chip ${group === g ? 'active' : ''}`}
                      onClick={() => setGroup(g)}
                    >
                      {g} {count}
                    </button>
                  )
                })}
              </div>

              {filtered.length === 0 ? (
                <EmptyState title="没有匹配的频道" desc="换个关键词或分组再试。" />
              ) : (
                <div className="channel-grid">
                  {filtered.map((c) => (
                    <button
                      key={`${c.url}-${c.name}`}
                      className="channel-card"
                      onClick={() => setPlaying({ channel: c, sourceName: current?.name ?? '' })}
                    >
                      <span className="channel-name">{c.name}</span>
                      <span className="channel-group">{c.group}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {adding && (
        <AddSourceModal
          onClose={() => setAdding(false)}
          onSave={addUrlSource}
        />
      )}

      {managing && (
        <Modal
          title="电视源管理"
          onClose={() => setManaging(false)}
          footer={
            <>
              <button className="btn" onClick={() => void importFile()}>
                <Upload size={14} /> 导入 M3U
              </button>
              <button className="btn ghost" onClick={() => setManaging(false)}>
                关闭
              </button>
            </>
          }
        >
          <div className="list-picker">
            {sources.map((s) => (
              <div key={s.id} className="list-option">
                <span>{s.name}</span>
                <span className="sub">{s.url.startsWith('local://') ? '本地' : '网络'}</span>
                <button
                  className="btn"
                  onClick={() =>
                    persist(sources.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)))
                  }
                >
                  {s.enabled ? '停用' : '启用'}
                </button>
                <button className="icon-btn danger" title="删除" onClick={() => setDeleting(s)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title="删除电视源"
          message={`确定删除「${deleting.name}」吗？只影响本机电视源配置。`}
          confirmText="删除"
          danger
          onConfirm={removeSource}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}

function AddSourceModal({
  onClose,
  onSave
}: {
  onClose: () => void
  onSave: (name: string, url: string) => void
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const valid = /^https?:\/\//i.test(url.trim())

  return (
    <Modal
      title="添加电视源"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!valid} onClick={() => onSave(name, url)}>
            添加
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：IPv4 直播源" />
        </label>
        <label>
          M3U 地址
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/playlist.m3u"
          />
        </label>
      </div>
    </Modal>
  )
}
