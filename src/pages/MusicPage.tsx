import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Download, Heart, ListPlus, Music as MusicIcon, Play } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, Modal, ModuleShortcuts } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { useMusicPlayer, type PlayerSong } from '../components/MusicPlayer'
import type {
  MusicQuality,
  MusicResolveResponse,
  MusicSong,
  MusicSourceInput
} from '../shared/music'
import type { InnerFav } from '../shared/types'

const LYRICS_KEY = 'laozheng.music.downloadLyrics'

interface DownloadTarget {
  id: string
  title: string
  artists: string
  cover: string
  durationSec: number
  platform?: string
  baseUrl?: string
  origin?: string
  qualities: MusicQuality[]
  sizeHint?: string
  /** 已经解析好的直链（本地音乐 / 下载音乐重下时直接用） */
  url?: string
}

function qualityLabel(quality: MusicQuality): string {
  if (quality.format === 'flac') {
    return Number(quality.bitrate) >= 2000 ? 'FLAC 24bit' : 'FLAC 无损'
  }
  if (quality.format === 'mp3') return `MP3 ${quality.bitrate}kbps`
  return `${quality.format.toUpperCase()} ${quality.bitrate}kbps`
}

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
    baseUrl: song.baseUrl,
    origin: song.origin,
    qualities: song.qualities,
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
  const enabledSources = useMemo(
    () => data.musicSources.filter((s) => s.enabled),
    [data.musicSources]
  )
  const [sourceId, setSourceId] = useState(() =>
    data.musicSources.some((source) => source.id === 'mvmp3' && source.enabled) ? 'mvmp3' : 'all'
  )
  const [query, setQuery] = useState('')
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  // 每次打开应用都是空白搜索；搜过的关键词会命中主进程缓存
  const [searched, setSearched] = useState(false)
  const [items, setItems] = useState<MusicSong[]>([])
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [downloadTarget, setDownloadTarget] = useState<DownloadTarget | null>(null)
  const [downloadQualityKey, setDownloadQualityKey] = useState('')
  const [downloadWithLyrics, setDownloadWithLyrics] = useState(
    () => localStorage.getItem(LYRICS_KEY) === '1'
  )
  const downloadWithLyricsRef = useRef(downloadWithLyrics)
  const [downloadBusy, setDownloadBusy] = useState(false)
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
    const source = data.musicSources.find((s) => s.id === prefix)
    player.playQueue([
      {
        key: focus.id,
        id: rawId,
        platform: prefix || undefined,
        baseUrl: source?.baseUrl,
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

  // 选中的音源被停用 / 删除后回到「全部源」
  useEffect(() => {
    if (sourceId === 'all') return
    if (data.musicSources.some((s) => s.id === sourceId && s.enabled)) return
    setSourceId('all')
  }, [data.musicSources, sourceId])

  const sourceInputs = (id: string): MusicSourceInput[] => {
    const list = id === 'all' ? enabledSources : enabledSources.filter((s) => s.id === id)
    return list.map((s) => ({
      id: s.id,
      name: s.name,
      baseUrl: s.baseUrl,
      kind: s.kind,
      platforms: s.platforms
    }))
  }

  const doSearch = async (raw: string, nextPage = 1, srcId = sourceId) => {
    const kw = raw.trim()
    if (!kw || searching || loadingMore) return
    if (!enabledSources.length) {
      setSearched(true)
      setError('没有启用的音乐源，请到「配置管理 → 片源管理 → 音乐源」启用')
      return
    }
    const seq = nextPage === 1 ? ++seqRef.current : seqRef.current
    if (nextPage === 1) {
      setSearching(true)
      setSearched(true)
      setError(null)
      setItems([])
    } else {
      setLoadingMore(true)
    }
    const res = await window.laozheng.searchMusic(sourceInputs(srcId), kw, nextPage)
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

  const changeSource = (next: string) => {
    setSourceId(next)
    if (!keyword.trim()) return
    void doSearch(keyword, 1, next)
  }

  const cancelSearch = () => {
    seqRef.current += 1
    setSearching(false)
    setLoadingMore(false)
  }

  const resolveSong = async (
    rawId: string,
    title: string,
    artists: string,
    platform?: string,
    baseUrl?: string,
    quality?: MusicQuality
  ): Promise<MusicResolveResponse> => {
    // 无损音乐（hi~ 开头）与自定义音源都带 baseUrl，交给主进程按音源识别解析
    if (/^[0-9a-f]{32}$/i.test(rawId) || rawId.startsWith('hi~') || baseUrl) {
      const res = await window.laozheng.resolveMusic(
        rawId,
        platform ?? 'mvmp3',
        baseUrl,
        title,
        artists,
        quality
      )
      if (res.ok || !rawId.startsWith('hi~')) return res
    }
    return window.laozheng.resolveLegacyMusic(title, artists)
  }

  const openDownload = (target: DownloadTarget) => {
    setDownloadTarget(target)
    setDownloadQualityKey(
      target.qualities[0] ? `${target.qualities[0].format}/${target.qualities[0].bitrate}` : ''
    )
    const remembered = localStorage.getItem(LYRICS_KEY) === '1'
    downloadWithLyricsRef.current = remembered
    setDownloadWithLyrics(remembered)
  }

  const openSongDownload = (song: MusicSong) => {
    openDownload({
      id: song.id,
      title: song.name,
      artists: song.artists,
      cover: song.cover,
      durationSec: Math.round(song.durationMs / 1000),
      platform: song.platform,
      baseUrl: song.baseUrl,
      origin: song.origin,
      qualities: song.qualities ?? [],
      sizeHint: song.sizeHint
    })
  }

  const toggleDownloadLyrics = (checked: boolean) => {
    downloadWithLyricsRef.current = checked
    setDownloadWithLyrics(checked)
    localStorage.setItem(LYRICS_KEY, checked ? '1' : '0')
  }

  const confirmDownload = async () => {
    const target = downloadTarget
    if (!target || downloadBusy) return
    setDownloadBusy(true)
    try {
      let url = target.url ?? ''
      let lrc = ''
      const quality = target.qualities.find(
        (item) => `${item.format}/${item.bitrate}` === downloadQualityKey
      )
      if (!url) {
        const res = await resolveSong(
          target.id,
          target.title,
          target.artists,
          target.platform,
          target.baseUrl,
          quality
        )
        if (!res.ok || !res.url) {
          onNotice(`下载失败：${res.error ?? '没有可用直链'}`)
          return
        }
        url = res.url
        lrc = res.lrc ?? ''
      } else if (downloadWithLyricsRef.current) {
        // 已经在播放器里拿到直链时不会重新解析，这里单独补一次歌词（洛雪音源也能拿到）
        const res = await resolveSong(
          target.id,
          target.title,
          target.artists,
          target.platform,
          target.baseUrl,
          quality
        )
        lrc = res.lrc ?? ''
      }
      const title = [target.artists, target.title].filter(Boolean).join(' - ')
      const added = await window.laozheng.addDownload({
        title,
        url,
        kind: 'music',
        coverUrl: target.cover,
        sourceName: '音乐',
        durationSec: target.durationSec
      })
      if (!added.ok) {
        onNotice(`下载失败：${added.error ?? '未知错误'}`)
        return
      }
      if (downloadWithLyricsRef.current) {
        if (lrc.trim()) {
          const saved = await window.laozheng.saveMusicLyrics({
            title: target.title,
            artists: target.artists,
            lrc
          })
          onNotice(
            saved.ok
              ? `已开始下载，歌词已保存到 ${saved.path}`
              : `歌曲已开始下载，但歌词保存失败：${saved.error ?? '未知错误'}`
          )
        } else {
          onNotice('已开始下载；这首歌没有歌词，已跳过')
        }
      } else {
        onNotice('已开始下载，左下角可查看进度')
      }
      setDownloadTarget(null)
    } finally {
      setDownloadBusy(false)
    }
  }

  const downloadCurrent = () => {
    if (!player.current) return
    const rawId = player.current.id.includes('|')
      ? player.current.id.split('|').slice(1).join('|')
      : player.current.id
    openDownload({
      id: rawId,
      title: player.current.title,
      artists: player.current.artists,
      cover: player.current.cover ?? '',
      durationSec: Math.round(player.duration || 0),
      platform: player.current.platform,
      baseUrl: player.current.baseUrl,
      origin: player.current.origin,
      qualities: player.current.qualities ?? [],
      url: player.current.url
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
          raw: {
            id: song.id,
            platform: song.platform ?? 'mvmp3',
            baseUrl: song.baseUrl
          }
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
            <button className="btn" onClick={downloadCurrent}>
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
          cancelSearch()
          setQuery('')
          setKeyword('')
          setSearched(false)
          setItems([])
          setError(null)
        }}
        searching={searching}
        placeholder="搜索歌曲名或歌手…"
        onRefresh={() => {
          if (keyword) {
            void window.laozheng.forceRefresh('music').catch(() => {})
            void doSearch(keyword, 1)
          }
        }}
        refreshing={searching}
        refreshDisabled={!keyword}
        leading={
          <select
            className="select-inline"
            value={sourceId}
            disabled={searching || loadingMore}
            title="音乐源"
            onChange={(e) => changeSource(e.target.value)}
          >
            <option value="all">全部源（{enabledSources.length}）</option>
            {enabledSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        }
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
              const originLabel =
                song.origin === 'wyy'
                  ? '网易云'
                  : song.origin === 'kuwo'
                    ? '酷我'
                    : song.origin === 'kw'
                      ? '酷我'
                      : song.origin === 'kg'
                        ? '酷狗'
                        : song.origin === 'tx'
                          ? 'QQ音乐'
                          : song.origin === 'wy'
                            ? '网易云'
                            : song.platform === 's33ve'
                              ? '33ve'
                              : ''
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
                      {[song.artists, formatDuration(song.durationMs), originLabel]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <button
                    className="icon-btn"
                    title="下载这首歌"
                    onClick={(e) => {
                      e.stopPropagation()
                      openSongDownload(song)
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

      {downloadTarget ? (
        <Modal
          title="下载歌曲"
          onClose={() => {
            if (!downloadBusy) setDownloadTarget(null)
          }}
          footer={
            <>
              <button
                className="btn ghost"
                disabled={downloadBusy}
                onClick={() => setDownloadTarget(null)}
              >
                取消
              </button>
              <button
                className="btn primary"
                disabled={downloadBusy}
                onClick={() => void confirmDownload()}
              >
                {downloadBusy ? '正在解析…' : '下载'}
              </button>
            </>
          }
        >
          <div className="music-download">
            <div className="music-download-title">{downloadTarget.title}</div>
            <div className="music-download-sub">{downloadTarget.artists || '未知歌手'}</div>
            {downloadTarget.qualities.length ? (
              <div className="music-quality-list">
                {downloadTarget.qualities.map((item) => {
                  const key = `${item.format}/${item.bitrate}`
                  return (
                    <label
                      key={key}
                      className={`music-quality ${downloadQualityKey === key ? 'active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="music-quality"
                        checked={downloadQualityKey === key}
                        onChange={() => setDownloadQualityKey(key)}
                      />
                      <span>{qualityLabel(item)}</span>
                      <span className="music-quality-size">{item.size ?? '大小未知'}</span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <div className="settings-hint">
                默认音质（由站点自动选择）
                {downloadTarget.sizeHint ? ` · ${downloadTarget.sizeHint}` : ''}
              </div>
            )}
            <label className="music-download-lyrics">
              <input
                type="checkbox"
                checked={downloadWithLyrics}
                onChange={(e) => toggleDownloadLyrics(e.target.checked)}
              />
              同时下载歌词
            </label>
            {downloadTarget.origin === 'wyy' ? (
              <div className="settings-hint">
                网易云音源最高提供 MP3 320kbps；没有歌词时会自动跳过。
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  )
}
