import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Heart } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, ModuleShortcuts } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
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

export function LivePage({
  onNotice,
  focusUrl,
  resetSignal,
  onExit,
  onOpenFavorites,
  onOpenDownloads
}: {
  onNotice: (text: string) => void
  focusUrl?: string
  resetSignal?: number
  /** 从收藏进入时，播放页返回走全局上一页 */
  onExit?: () => void
  onOpenFavorites?: () => void
  onOpenDownloads?: () => void
}) {
  const { data, update } = useData()
  const [sources, setSources] = useState<LiveSource[] | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [cache, setCache] = useState<ChannelCache>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('全部')
  const [playing, setPlaying] = useState<Playing | null>(null)

  const loadChannels = async (source: LiveSource) => {
    setSelectedId(source.id)
    setGroup('全部')
    setQuery('')
    setInput('')
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
    return () => setPlaying(null)
  }, [focusUrl])

  // 从播放页去收藏/下载再返回时，回到频道列表而不是又停在播放页
  useEffect(() => {
    if (resetSignal === undefined) return
    setPlaying(null)
  }, [resetSignal])

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

  if (sources === null) {
    return <EmptyState title="正在加载电视源…" />
  }

  if (playing) {
    return (
      <>
        <header className="page-header">
          <button
            className="btn ghost"
            onClick={() => {
              // 先关闭播放页再返回，避免返回上一页后又弹回播放页
              setPlaying(null)
              if (focusUrl && onExit) onExit()
            }}
          >
            <ChevronLeft size={15} /> 返回
          </button>
          <h1 className="page-title">{playing.channel.name}</h1>
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
        <div className="page-actions">
          <ModuleShortcuts
            onOpenFavorites={
              onOpenFavorites
                ? () => {
                    setPlaying(null)
                    onOpenFavorites()
                  }
                : undefined
            }
            onOpenDownloads={
              onOpenDownloads
                ? () => {
                    setPlaying(null)
                    onOpenDownloads()
                  }
                : undefined
            }
          />
        </div>
      </header>

      {sources.length === 0 ? (
        <EmptyState
          title="还没有电视源"
          desc="到「配置管理 → 片源管理」添加 M3U / M3U8 地址，或从本地导入播放列表。"
        />
      ) : (
        <>
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
              <SearchBar
                value={input}
                onChange={setInput}
                onSubmit={() => setQuery(input.trim())}
                onClear={() => {
                  setInput('')
                  setQuery('')
                }}
                placeholder="搜索频道…"
                submitLabel="搜索"
                extra={
                  query ? (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        setInput('')
                        setQuery('')
                      }}
                    >
                      取消搜索
                    </button>
                  ) : null
                }
              />
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
                  {filtered.map((c) => {
                    const item = { channel: c, sourceName: current?.name ?? '' }
                    const saved = data.innerFavs.some(
                      (f) => f.module === 'tv' && f.id === favId(c)
                    )
                    return (
                      <div
                        key={`${c.url}-${c.name}`}
                        className="channel-card"
                        role="button"
                        tabIndex={0}
                        onClick={() => setPlaying(item)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') setPlaying(item)
                        }}
                      >
                        <span className="channel-name">{c.name}</span>
                        <span className="channel-group">{c.group}</span>
                        <span
                          className={`fav-heart ${saved ? 'on' : ''}`}
                          role="button"
                          title={saved ? '取消收藏' : '收藏'}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleFav(item)
                          }}
                        >
                          <Heart size={15} fill={saved ? 'currentColor' : 'none'} />
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  )
}
