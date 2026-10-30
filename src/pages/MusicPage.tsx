import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Download, Heart, ListPlus, Music as MusicIcon, Play } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, ModuleShortcuts } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { useMusicPlayer, type PlayerSong } from '../components/MusicPlayer'
import { requestDownload } from '../utils/download'
import type { MusicSong } from '../shared/music'
import type { InnerFav } from '../shared/types'

function formatDuration(ms: number): string {
  if (!ms) return '—'
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function toPlayerSong(song: MusicSong): PlayerSong {
  return {
    key: `${song.platform ?? 'mvmp3'}|${song.id}`,
    id: song.id,
    platform: song.platform ?? 'mvmp3',
    title: song.name,
    artists: song.artists,
    cover: song.cover || null
  }
}

export function MusicPage({
  onNotice,
  focus,
  resetSignal,
  onExit,
  onOpenFavorites,
  onOpenDownloads
}: {
  onNotice: (text: string) => void
  focus?: { id: string; title: string; subtitle: string; cover: string | null; durationSec: number }
  resetSignal?: number
  /** 从收藏进入时，返回走全局上一页 */
  onExit?: () => void
  onOpenFavorites?: () => void
  onOpenDownloads?: () => void
}) {
  const { data, update } = useData()
  const player = useMusicPlayer()
  const [query, setQuery] = useState('')
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  // 每次打开应用都是空白搜索；搜过的关键词会命中主进程缓存
  const [searched, setSearched] = useState(false)
  const [items, setItems] = useState<MusicSong[]>([])
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const seqRef = useRef(0)
  const handledFocusRef = useRef('')

  useEffect(() => {
    if (!focus?.id) {
      handledFocusRef.current = ''
      return
    }
    const key = `${focus.id}|${focus.title}`
    if (handledFocusRef.current === key) return
    handledFocusRef.current = key
    const rawId = focus.id.includes('|') ? focus.id.split('|').slice(1).join('|') : focus.id
    const prefix = focus.id.includes('|') ? focus.id.split('|')[0] : ''
    player.playQueue([
      {
        key: focus.id,
        id: rawId,
        platform: prefix || undefined,
        title: focus.title,
        artists: focus.subtitle,
        cover: focus.cover
      }
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.id, focus?.title])

  useEffect(() => {
    if (resetSignal === undefined) return
    // 侧栏进入音乐时只回到列表，不打断正在播放的音乐
    setError(null)
  }, [resetSignal])

  const doSearch = async (raw: string, nextPage = 1) => {
    const kw = raw.trim()
    if (!kw || searching || loadingMore) return
    const seq = nextPage === 1 ? ++seqRef.current : seqRef.current
    if (nextPage === 1) {
      setSearching(true)
      setSearched(true)
      setError(null)
      setItems([])
    } else {
      setLoadingMore(true)
    }
    const res = await window.laozheng.searchMusic(kw, nextPage)
    if (seq !== seqRef.current) return
    if (nextPage === 1) {
      setSearching(false)
      setKeyword(kw)
      setPage(1)
    } else {
      setLoadingMore(false)
    }
    if (!res.ok) {
      if (nextPage === 1) setError(res.error ?? '搜索失败')
      else onNotice(res.error ?? '加载更多失败')
      return
    }
    const merged = nextPage === 1 ? res.items : [...items, ...res.items]
    setItems(merged)
    setPage(nextPage)
  }

  const cancelSearch = () => {
    seqRef.current += 1
    setSearching(false)
    setLoadingMore(false)
  }

  const resolveSongUrl = async (
    rawId: string,
    title: string,
    artists: string,
    platform?: string
  ): Promise<string | null> => {
    const res = /^[0-9a-f]{32}$/i.test(rawId)
      ? await window.laozheng.resolveMusic(rawId, platform ?? 'mvmp3')
      : await window.laozheng.resolveLegacyMusic(title, artists)
    if (!res.ok || !res.url) {
      onNotice(`下载失败：${res.error ?? '没有可用直链'}`)
      return null
    }
    return res.url
  }

  const downloadSong = async (song: MusicSong) => {
    const url = await resolveSongUrl(song.id, song.name, song.artists, song.platform)
    if (!url) return
    requestDownload({
      title: [song.artists, song.name].filter(Boolean).join(' - '),
      url,
      kind: 'music',
      coverUrl: song.cover || '',
      sourceName: '音乐',
      durationSec: Math.round(song.durationMs / 1000)
    })
  }

  const downloadCurrent = async () => {
    if (!player.current) return
    const rawId = player.current.id.includes('|')
      ? player.current.id.split('|').slice(1).join('|')
      : player.current.id
    const url =
      player.current.url ??
      (await resolveSongUrl(
        rawId,
        player.current.title,
        player.current.artists,
        player.current.platform
      ))
    if (!url) return
    requestDownload({
      title: [player.current.artists, player.current.title].filter(Boolean).join(' - '),
      url,
      kind: 'music',
      coverUrl: player.current.cover ?? '',
      sourceName: '音乐',
      durationSec: Math.round(player.duration || 0)
    })
  }

  const favId = (song: MusicSong) => `${song.platform ?? 'mvmp3'}|${song.id}`
  const favOf = (song: MusicSong): InnerFav | undefined =>
    data.innerFavs.find((f) => f.module === 'music' && f.id === favId(song))

  const toggleFav = (song: MusicSong) => {
    const id = favId(song)
    const exists = data.innerFavs.some((f) => f.module === 'music' && f.id === id)
    update((d) => {
      if (exists) return { ...d, innerFavs: d.innerFavs.filter((f) => !(f.module === 'music' && f.id === id)) }
      const row: InnerFav = {
        module: 'music',
        id,
        title: song.name,
        subtitle: song.artists,
        cover: song.cover || null,
        savedAt: Date.now(),
        videoUrl: null,
        mediaId: 0,
        durationSec: Math.round(song.durationMs / 1000),
        tweetUrl: null,
        payload: JSON.stringify({
          album: song.album,
          dur: song.durationMs,
          raw: { id: song.id, platform: song.platform ?? 'mvmp3' }
        })
      }
      return { ...d, innerFavs: [...d.innerFavs, row] }
    })
    onNotice(exists ? '已取消收藏' : '已收藏，可在「收藏」页查看')
  }

  return (
    <>
      <header className="page-header">
        {focus?.id && onExit ? (
          <button className="btn ghost" onClick={onExit}>
            <ChevronLeft size={15} /> 返回
          </button>
        ) : null}
        <h1 className="page-title">音乐</h1>
        <div className="page-actions">
          {player.current ? (
            <button className="btn" onClick={() => void downloadCurrent()}>
              下载正在播放
            </button>
          ) : null}
          <ModuleShortcuts onOpenFavorites={onOpenFavorites} onOpenDownloads={onOpenDownloads} />
        </div>
      </header>

      <SearchBar
        value={query}
        onChange={setQuery}
        onSubmit={() => void doSearch(query, 1)}
        onCancel={cancelSearch}
        onClear={() => {
          setQuery('')
          setKeyword('')
          setSearched(false)
          setItems([])
          setError(null)
        }}
        searching={searching}
        placeholder="搜索歌曲名或歌手…"
      />

      {searching ? (
        <EmptyState title="正在搜索…" desc="在线音源返回后会在底部播放器解析播放。" />
      ) : error ? (
        <EmptyState
          title="搜索失败"
          desc={error}
          action={
            <button className="btn" onClick={() => void doSearch(keyword, 1)}>
              重试
            </button>
          }
        />
      ) : !searched ? (
        <EmptyState
          title="搜索歌曲开始播放"
          desc="点击任意歌曲会用底部内置播放器播放，并支持歌词、循环与随机。"
        />
      ) : items.length === 0 ? (
        <EmptyState title="没有找到歌曲" desc="换个关键词再试。" />
      ) : (
        <>
          <div className="rows compact">
            {items.map((song, index) => {
              const fav = favOf(song)
              const playing = player.current?.key === toPlayerSong(song).key
              return (
                <div
                  key={song.id}
                  className="row clickable"
                  onClick={() => player.playQueue(items.map(toPlayerSong), index)}
                >
                  <div className="row-cover">
                    {song.cover ? <img src={song.cover} alt="" loading="lazy" /> : <MusicIcon size={16} />}
                  </div>
                  <div className="row-main">
                    <div className="row-title">{song.name}</div>
                    <div className="row-meta">
                      {[song.artists, formatDuration(song.durationMs), song.platform === 's33ve' ? '33ve' : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <button
                    className="icon-btn"
                    title="下载这首歌"
                    onClick={(e) => {
                      e.stopPropagation()
                      void downloadSong(song)
                    }}
                  >
                    <Download size={15} />
                  </button>
                  <button
                    className="icon-btn"
                    title={fav ? '取消收藏' : '收藏'}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFav(song)
                    }}
                  >
                    <Heart size={15} fill={fav ? 'currentColor' : 'none'} />
                  </button>
                  <span className="badge brand">
                    <Play size={11} /> {playing ? '播放中' : '播放'}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button
              className="btn"
              disabled={loadingMore}
              onClick={() => void doSearch(keyword, page + 1)}
            >
              <ListPlus size={14} /> {loadingMore ? '加载中…' : '加载更多'}
            </button>
          </div>
        </>
      )}
    </>
  )
}
