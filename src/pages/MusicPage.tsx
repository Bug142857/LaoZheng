import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Heart, Music as MusicIcon, Play, Search } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState } from '../components/ui'
import type { MusicSong } from '../shared/music'
import type { InnerFav } from '../shared/types'

interface Playing {
  song: MusicSong
  url: string
  lrc: string
  cover: string
}

function formatDuration(ms: number): string {
  if (!ms) return '—'
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function lyricLines(lrc: string): string[] {
  return lrc
    .split(/\r?\n/)
    .map((line) => line.replace(/\[[^\]]*\]/g, '').trim())
    .filter(Boolean)
}

export function MusicPage({
  onNotice,
  focus
}: {
  onNotice: (text: string) => void
  focus?: { id: string; title: string; subtitle: string; cover: string | null; durationSec: number }
}) {
  const { data, update } = useData()
  const [query, setQuery] = useState('')
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [items, setItems] = useState<MusicSong[]>([])
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [playing, setPlaying] = useState<Playing | null>(null)
  const [showLyrics, setShowLyrics] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  const lyrics = useMemo(() => (playing ? lyricLines(playing.lrc) : []), [playing])

  useEffect(() => {
    if (!focus?.id) return
    let alive = true
    void (async () => {
      const rawId = focus.id.includes('|') ? focus.id.split('|').slice(1).join('|') : focus.id
      const res = /^[0-9a-f]{32}$/i.test(rawId)
        ? await window.laozheng.resolveMusic(rawId)
        : await window.laozheng.resolveLegacyMusic(focus.title, focus.subtitle)
      if (!alive) return
      if (!res.ok || !res.url) {
        onNotice(`「${focus.title}」播放失败：${res.error ?? '没有可用直链'}`)
        return
      }
      setPlaying({
        song: {
          id: rawId,
          name: focus.title,
          artists: focus.subtitle,
          album: '',
          cover: focus.cover ?? '',
          durationMs: focus.durationSec * 1000
        },
        url: res.url,
        lrc: res.lrc ?? '',
        cover: res.cover || focus.cover || ''
      })
      setShowLyrics(false)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.id])

  const doSearch = async (raw: string, nextPage = 1) => {
    const kw = raw.trim()
    if (!kw || searching || loadingMore) return
    if (nextPage === 1) {
      setSearching(true)
      setSearched(true)
      setError(null)
      setItems([])
      setPlaying(null)
    } else {
      setLoadingMore(true)
    }
    const res = await window.laozheng.searchMusic(kw, nextPage)
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
    setItems((prev) => (nextPage === 1 ? res.items : [...prev, ...res.items]))
    setPage(nextPage)
  }

  const play = async (song: MusicSong) => {
    if (resolvingId) return
    setResolvingId(song.id)
    const res = await window.laozheng.resolveMusic(song.id)
    setResolvingId(null)
    if (!res.ok || !res.url) {
      onNotice(`「${song.name}」播放失败：${res.error ?? '没有可用直链'}`)
      return
    }
    setPlaying({
      song,
      url: res.url,
      lrc: res.lrc ?? '',
      cover: res.cover || song.cover
    })
    setShowLyrics(false)
  }

  const downloadSong = async () => {
    if (!playing) return
    const res = await window.laozheng.addDownload({
      title: [playing.song.artists, playing.song.name].filter(Boolean).join(' - '),
      url: playing.url,
      kind: 'music',
      coverUrl: playing.cover,
      sourceName: '音乐'
    })
    onNotice(res.ok ? '已加入下载队列，可在「下载」页查看进度' : `下载失败：${res.error}`)
  }

  const favId = (song: MusicSong) => `mvmp3|${song.id}`
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
        payload: JSON.stringify({ album: song.album, dur: song.durationMs, raw: { id: song.id } })
      }
      return { ...d, innerFavs: [...d.innerFavs, row] }
    })
    onNotice(exists ? '已取消收藏' : '已收藏，可在「收藏」页查看')
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">音乐</h1>
        <span className="page-desc">搜索在线歌曲，解析直链后直接播放 · 收藏与手机端 innerFavs 同步</span>
      </header>

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          void doSearch(query, 1)
        }}
      >
        <label className="search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索歌曲名或歌手…"
          />
        </label>
        <button className="btn primary" type="submit" disabled={!query.trim() || searching}>
          {searching ? '搜索中…' : '搜索'}
        </button>
      </form>

      {playing && (
        <section className="now-playing">
          <div className="now-cover">
            {playing.cover ? <img src={playing.cover} alt="" /> : <MusicIcon size={26} />}
          </div>
          <div className="now-main">
            <div className="now-title">{playing.song.name}</div>
            <div className="now-artist">{playing.song.artists || '未知歌手'}</div>
            <audio
              key={playing.url}
              ref={audioRef}
              src={playing.url}
              controls
              autoPlay
              style={{ width: '100%', marginTop: 8 }}
            />
          </div>
          <div className="now-actions">
            <button className="btn" onClick={() => toggleFav(playing.song)}>
              <Heart size={15} fill={favOf(playing.song) ? 'currentColor' : 'none'} />{' '}
              {favOf(playing.song) ? '已收藏' : '收藏'}
            </button>
            <button className="btn" disabled={!playing.lrc} onClick={() => setShowLyrics((v) => !v)}>
              {showLyrics ? '收起歌词' : '歌词'}
            </button>
            <button className="btn" onClick={() => void downloadSong()}>
              <Download size={14} /> 下载
            </button>
          </div>
          {showLyrics && (
            <pre className="lyrics">{lyrics.join('\n') || '这首歌暂时没有歌词'}</pre>
          )}
        </section>
      )}

      {searching ? (
        <EmptyState title="正在搜索…" desc="在线音源返回后再解析播放直链。" />
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
          desc="点击结果会实时解析播放直链；收藏的歌曲会出现在「收藏」页。"
        />
      ) : items.length === 0 ? (
        <EmptyState title="没有找到歌曲" desc="换个关键词再试。" />
      ) : (
        <>
          <div className="rows">
            {items.map((song) => {
              const fav = favOf(song)
              return (
                <div key={song.id} className="row clickable" onClick={() => void play(song)}>
                  <div className="row-cover">
                    {song.cover ? <img src={song.cover} alt="" loading="lazy" /> : '音乐'}
                  </div>
                  <div className="row-main">
                    <div className="row-title">{song.name}</div>
                    <div className="row-meta">
                      {[song.artists, formatDuration(song.durationMs)].filter(Boolean).join(' · ')}
                    </div>
                  </div>
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
                    <Play size={11} /> {resolvingId === song.id ? '解析中…' : '播放'}
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
              {loadingMore ? '加载中…' : '加载更多'}
            </button>
          </div>
        </>
      )}
    </>
  )
}
