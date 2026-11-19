import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import {
  ListMusic,
  Music as MusicIcon,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import type { InnerFav } from '../shared/types'
import type { MusicQueueItem } from '../shared/music'
import type { MusicPlayMode } from '../shared/settings'

export type PlayMode = MusicPlayMode

export type PlayerSong = MusicQueueItem

/** 恢复队列时把越界下标收回到合法范围 */
function restoreIndex(value: unknown, length: number): number {
  if (!length) return -1
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(length - 1, Math.max(0, Math.floor(value)))
}

interface LyricLine {
  time: number
  text: string
}

interface PlayerValue {
  queue: PlayerSong[]
  index: number
  playing: boolean
  mode: PlayMode
  resolving: boolean
  error: string | null
  panelOpen: boolean
  current: PlayerSong | null
  currentTime: number
  duration: number
  /** 音量（0~1）与静音状态，记住上次值并随备份 / 云同步走 */
  volume: number
  muted: boolean
  lyrics: LyricLine[]
  playQueue: (songs: PlayerSong[], startIndex?: number) => void
  playFavs: (favs: InnerFav[], startIndex?: number) => void
  toggle: () => void
  next: () => void
  prev: () => void
  cycleMode: () => void
  setPanelOpen: (open: boolean) => void
  setVolume: (volume: number) => void
  toggleMuted: () => void
  seek: (time: number) => void
  stop: () => void
}

const MusicPlayerContext = createContext<PlayerValue | null>(null)

const MODE_ORDER: PlayMode[] = ['single', 'order', 'shuffle']

export const PLAY_MODE_LABEL: Record<PlayMode, string> = {
  single: '单曲循环',
  order: '顺序播放',
  shuffle: '随机播放'
}

export function songFromFav(fav: InnerFav): PlayerSong {
  let id = fav.id
  let platform: string | undefined
  let baseUrl: string | undefined
  if (fav.id.includes('|')) {
    const [prefix, ...rest] = fav.id.split('|')
    id = rest.join('|')
    platform = prefix
  }
  if (fav.payload) {
    try {
      const payload = JSON.parse(fav.payload) as {
        raw?: { id?: string; platform?: string; baseUrl?: string }
      }
      if (payload.raw?.id) id = payload.raw.id
      if (payload.raw?.platform) platform = payload.raw.platform
      if (typeof payload.raw?.baseUrl === 'string' && payload.raw.baseUrl) {
        baseUrl = payload.raw.baseUrl
      }
    } catch {
      // 旧收藏没有 payload，按标题回退解析
    }
  }
  return {
    key: `fav-${fav.module}-${fav.id}`,
    id,
    platform,
    baseUrl,
    title: fav.title,
    artists: fav.subtitle,
    cover: fav.cover
  }
}

function parseLyrics(raw: string): LyricLine[] {
  if (!raw.trim()) return []
  const out: LyricLine[] = []
  for (const line of raw.split(/\r?\n/)) {
    const matches = [...line.matchAll(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)]
    const text = line.replace(/\[[^\]]*\]/g, '').trim()
    if (!text) continue
    if (!matches.length) {
      out.push({ time: -1, text })
      continue
    }
    for (const m of matches) {
      const minutes = Number.parseInt(m[1], 10) || 0
      const seconds = Number.parseInt(m[2], 10) || 0
      const fraction = m[3] ? Number.parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) / 1000 : 0
      out.push({ time: minutes * 60 + seconds + fraction, text })
    }
  }
  return out.sort((a, b) => a.time - b.time)
}

async function resolveSongUrl(
  song: PlayerSong
): Promise<{ url: string; lrc: string; cover: string } | null> {
  if (song.url) return { url: song.url, lrc: '', cover: song.cover ?? '' }
  const rawId = song.id.includes('|') ? song.id.split('|').slice(1).join('|') : song.id
  const prefix =
    song.platform ?? (song.id.includes('|') ? song.id.split('|')[0] : '') ?? 'mvmp3'
  const isCmsId = /^[0-9a-f]{32}$/i.test(rawId)
  const isHiId = rawId.startsWith('hi~')
  if (isCmsId || isHiId || song.baseUrl) {
    const res = await window.laozheng.resolveMusic(
      rawId,
      prefix || 'mvmp3',
      song.baseUrl,
      song.title,
      song.artists
    )
    if (res.ok && res.url) {
      return { url: res.url, lrc: res.lrc ?? '', cover: res.cover || song.cover || '' }
    }
    // 无损音乐的签名过期且刷新失败时，再按歌名回退搜一次
    if (!isHiId) return null
  }
  const res = await window.laozheng.resolveLegacyMusic(song.title, song.artists)
  if (!res.ok || !res.url) return null
  return { url: res.url, lrc: res.lrc ?? '', cover: res.cover || song.cover || '' }
}

export function MusicPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const queueRef = useRef<PlayerSong[]>([])
  const indexRef = useRef(-1)
  const modeRef = useRef<PlayMode>('single')
  const resolvingRef = useRef(false)
  const playSeqRef = useRef(0)
  const [queue, setQueue] = useState<PlayerSong[]>([])
  const [index, setIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [mode, setMode] = useState<PlayMode>('single')
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [lyrics, setLyrics] = useState<LyricLine[]>([])
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  /** 音量 / 静音：持久化到 settings.json（作为 PC 扩展字段随备份 / 云同步） */
  const [volume, setVolumeState] = useState(0.8)
  const [muted, setMutedState] = useState(false)
  const volumeRef = useRef(0.8)
  const mutedRef = useRef(false)
  const volumeSaveTimer = useRef<number | null>(null)
  /** 队列是否已从 settings 恢复：恢复前不要把空队列写回去 */
  const queueLoadedRef = useRef(false)
  const queueSaveTimer = useRef<number | null>(null)
  /** 恢复队列后等音频元数据加载完再跳回上次进度 */
  const pendingSeekRef = useRef(0)
  /** 播放中每 10 秒把进度写一次 settings，避免直接关窗口丢进度 */
  const lastQueueSaveRef = useRef(0)

  const current = index >= 0 ? queue[index] ?? null : null

  const ensureAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const audio = new Audio()
      audio.preload = 'auto'
      audio.volume = volumeRef.current
      audio.muted = mutedRef.current
      audioRef.current = audio
    }
    return audioRef.current
  }, [])

  const applyVolume = useCallback(
    (nextVolume: number, nextMuted: boolean) => {
      volumeRef.current = nextVolume
      mutedRef.current = nextMuted
      const audio = ensureAudio()
      audio.volume = nextVolume
      audio.muted = nextMuted
    },
    [ensureAudio]
  )

  const persistVolume = useCallback((nextVolume: number, nextMuted: boolean) => {
    if (volumeSaveTimer.current != null) window.clearTimeout(volumeSaveTimer.current)
    volumeSaveTimer.current = window.setTimeout(() => {
      volumeSaveTimer.current = null
      void window.laozheng
        .setUiSettings({ musicVolume: nextVolume, musicMuted: nextMuted })
        .catch(() => undefined)
    }, 400)
  }, [])

  /** 队列 / 当前条目 / 播放模式 / 进度一起写入 settings，重启和云恢复后继续播放 */
  const persistQueue = useCallback(() => {
    if (!queueLoadedRef.current) return
    if (queueSaveTimer.current != null) window.clearTimeout(queueSaveTimer.current)
    queueSaveTimer.current = window.setTimeout(() => {
      queueSaveTimer.current = null
      const songs = queueRef.current
      const at = indexRef.current
      // 恢复队列但还没解析音频时，currentTime 是 0，用待恢复进度补上，避免把续播位置覆盖掉
      const played = audioRef.current?.currentTime ?? 0
      const time = played > 0 ? played : pendingSeekRef.current
      void window.laozheng
        .setUiSettings({
          musicQueue: songs,
          musicQueueIndex: songs.length ? at : -1,
          musicMode: modeRef.current,
          musicQueueTime: time
        })
        .catch(() => undefined)
    }, 500)
  }, [])

  const setVolume = useCallback(
    (nextVolume: number) => {
      const value = Math.min(1, Math.max(0, nextVolume))
      const nextMuted = value <= 0 ? mutedRef.current : false
      setVolumeState(value)
      setMutedState(nextMuted)
      applyVolume(value, nextMuted)
      persistVolume(value, nextMuted)
    },
    [applyVolume, persistVolume]
  )

  const toggleMuted = useCallback(() => {
    const nextMuted = !mutedRef.current
    setMutedState(nextMuted)
    applyVolume(volumeRef.current, nextMuted)
    persistVolume(volumeRef.current, nextMuted)
  }, [applyVolume, persistVolume])

  // 启动时读取上次音量与播放队列；读取失败保持默认值
  useEffect(() => {
    let alive = true
    window.laozheng
      .getUiSettings()
      .then((settings) => {
        if (!alive) return
        const value =
          typeof settings.musicVolume === 'number'
            ? Math.min(1, Math.max(0, settings.musicVolume))
            : 0.8
        setVolumeState(value)
        setMutedState(!!settings.musicMuted)
        applyVolume(value, !!settings.musicMuted)

        const restored = Array.isArray(settings.musicQueue) ? settings.musicQueue : []
        if (restored.length) {
          const at = restoreIndex(settings.musicQueueIndex, restored.length)
          queueRef.current = restored
          indexRef.current = at
          setQueue(restored)
          setIndex(at)
          const restoredMode = settings.musicMode
          if (
            restoredMode === 'single' ||
            restoredMode === 'order' ||
            restoredMode === 'shuffle'
          ) {
            modeRef.current = restoredMode
            setMode(restoredMode)
          }
          const time =
            typeof settings.musicQueueTime === 'number' &&
            Number.isFinite(settings.musicQueueTime) &&
            settings.musicQueueTime > 0
              ? settings.musicQueueTime
              : 0
          pendingSeekRef.current = time
        }
        queueLoadedRef.current = true
      })
      .catch(() => {
        queueLoadedRef.current = true
      })
    return () => {
      alive = false
    }
  }, [applyVolume])

  // 队列 / 当前条目 / 播放模式变化时写入 settings（500ms 防抖）
  useEffect(() => {
    persistQueue()
  }, [queue, index, mode, persistQueue])

  const loadAndPlay = useCallback(
    async (target: number) => {
      const songs = queueRef.current
      const song = songs[target]
      if (!song) return
      const seq = ++playSeqRef.current
      const audio = ensureAudio()
      setIndex(target)
      indexRef.current = target
      setResolving(true)
      resolvingRef.current = true
      setError(null)
      setCurrentTime(0)
      setDuration(0)
      try {
        const resolved = await resolveSongUrl(song)
        if (seq !== playSeqRef.current) return
        if (!resolved) {
          // 解析失败时要把上一首停掉，否则播放条显示新歌、声音还是旧歌
          audio.pause()
          audio.removeAttribute('src')
          audio.load()
          setError('没有解析到可用直链，换一首或稍后重试')
          setPlaying(false)
          return
        }
        audio.src = resolved.url
        setLyrics(parseLyrics(resolved.lrc))
        if (resolved.cover && resolved.cover !== song.cover) {
          const next = songs.map((item, i) =>
            i === target ? { ...item, cover: resolved.cover } : item
          )
          queueRef.current = next
          setQueue(next)
        }
        try {
          await audio.play()
          setPlaying(true)
        } catch {
          setError('浏览器拦截了自动播放，点一下播放按钮继续')
          setPlaying(false)
        }
      } catch {
        if (seq === playSeqRef.current) {
          audio.pause()
          audio.removeAttribute('src')
          audio.load()
          setError('解析播放地址失败，换一首或稍后重试')
          setPlaying(false)
        }
      } finally {
        if (seq === playSeqRef.current) {
          setResolving(false)
          resolvingRef.current = false
        }
      }
    },
    [ensureAudio]
  )

  const advance = useCallback(
    (auto: boolean) => {
      const songs = queueRef.current
      if (!songs.length) return
      const at = indexRef.current
      const currentMode = modeRef.current
      if (auto && currentMode === 'single') {
        void loadAndPlay(at)
        return
      }
      let nextIndex: number
      if (currentMode === 'shuffle') {
        nextIndex = songs.length === 1 ? 0 : Math.floor(Math.random() * (songs.length - 1))
        if (nextIndex >= at) nextIndex += 1
      } else {
        nextIndex = at + 1
        if (nextIndex >= songs.length) nextIndex = 0
      }
      void loadAndPlay(nextIndex)
    },
    [loadAndPlay]
  )

  const prev = useCallback(() => {
    const songs = queueRef.current
    if (!songs.length) return
    const at = indexRef.current
    void loadAndPlay(at <= 0 ? songs.length - 1 : at - 1)
  }, [loadAndPlay])

  const next = useCallback(() => advance(false), [advance])

  const playQueue = useCallback(
    (songs: PlayerSong[], startIndex = 0) => {
      if (!songs.length) return
      queueRef.current = songs
      setQueue(songs)
      void loadAndPlay(Math.min(Math.max(0, startIndex), songs.length - 1))
    },
    [loadAndPlay]
  )

  const playFavs = useCallback(
    (favs: InnerFav[], startIndex = 0) => {
      playQueue(favs.map(songFromFav), startIndex)
    },
    [playQueue]
  )

  const toggle = useCallback(() => {
    if (!current || resolvingRef.current) return
    const audio = audioRef.current
    // 重启后恢复的队列还没解析直链：第一次点播放时再解析
    if (!audio || !audio.src) {
      void loadAndPlay(indexRef.current)
      return
    }
    if (audio.paused) {
      void audio.play().then(() => setPlaying(true)).catch(() => {
        setError('播放失败，可能是直链已失效')
      })
    } else {
      audio.pause()
      setPlaying(false)
    }
  }, [current, loadAndPlay])

  const cycleMode = useCallback(() => {
    setMode((prevMode) => {
      const nextMode = MODE_ORDER[(MODE_ORDER.indexOf(prevMode) + 1) % MODE_ORDER.length]
      modeRef.current = nextMode
      return nextMode
    })
  }, [])

  const seek = useCallback((time: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = time
    setCurrentTime(time)
  }, [])

  const stop = useCallback(() => {
    playSeqRef.current += 1
    resolvingRef.current = false
    setResolving(false)
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    queueRef.current = []
    indexRef.current = -1
    setQueue([])
    setIndex(-1)
    setPlaying(false)
    setLyrics([])
    setCurrentTime(0)
    setDuration(0)
    pendingSeekRef.current = 0
    setError(null)
    setPanelOpen(false)
  }, [])

  useEffect(() => {
    const audio = ensureAudio()
    const onTime = (): void => {
      setCurrentTime(audio.currentTime)
      const now = Date.now()
      if (now - lastQueueSaveRef.current >= 10_000) {
        lastQueueSaveRef.current = now
        persistQueue()
      }
    }
    const onMeta = (): void => {
      const total = Number.isFinite(audio.duration) ? audio.duration : 0
      setDuration(total)
      const pending = pendingSeekRef.current
      if (pending > 0) {
        pendingSeekRef.current = 0
        const target = total > 0 ? Math.min(pending, Math.max(0, total - 0.5)) : pending
        audio.currentTime = target
        setCurrentTime(target)
      }
    }
    const onEnded = (): void => advance(true)
    const onError = (): void => {
      if (audio.src) setError('播放失败，可能是直链失效或需要外网')
      setPlaying(false)
    }
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => {
      setPlaying(false)
      // 切歌时会先暂停旧音源，这时 index 已经指向新歌，不要把旧进度写成新歌的
      if (!resolvingRef.current) persistQueue()
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.pause()
    }
  }, [advance, ensureAudio, persistQueue])

  const value = useMemo<PlayerValue>(
    () => ({
      queue,
      index,
      playing,
      mode,
      resolving,
      error,
      panelOpen,
      current,
      currentTime,
      duration,
      volume,
      muted,
      lyrics,
      playQueue,
      playFavs,
      toggle,
      next,
      prev,
      cycleMode,
      setPanelOpen,
      setVolume,
      toggleMuted,
      seek,
      stop
    }),
    [
      queue,
      index,
      playing,
      mode,
      resolving,
      error,
      panelOpen,
      current,
      currentTime,
      duration,
      volume,
      muted,
      lyrics,
      playQueue,
      playFavs,
      toggle,
      next,
      prev,
      cycleMode,
      setVolume,
      toggleMuted,
      seek,
      stop
    ]
  )

  return <MusicPlayerContext.Provider value={value}>{children}</MusicPlayerContext.Provider>
}

export function useMusicPlayer(): PlayerValue {
  const ctx = useContext(MusicPlayerContext)
  if (!ctx) throw new Error('useMusicPlayer 必须在 MusicPlayerProvider 内使用')
  return ctx
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const total = Math.floor(sec)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function MusicPlayerBar({
  alwaysVisible = false,
  homeMode = false,
  playlist,
  onPlayPlaylist
}: {
  alwaysVisible?: boolean
  /** 主页播放器多一个播放列表按钮，其余样式与全局播放器一致 */
  homeMode?: boolean
  /** 主页播放列表（音乐收藏），不传时用当前播放队列 */
  playlist?: PlayerSong[]
  onPlayPlaylist?: (index: number) => void
}) {
  const player = useMusicPlayer()
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const [playlistQuery, setPlaylistQuery] = useState('')
  const lyricRef = useRef<HTMLDivElement | null>(null)
  const activeLine = useMemo(() => {
    if (!player.lyrics.length) return -1
    let active = -1
    for (let i = 0; i < player.lyrics.length; i++) {
      const line = player.lyrics[i]
      if (line.time >= 0 && line.time <= player.currentTime + 0.3) active = i
    }
    return active
  }, [player.lyrics, player.currentTime])

  useEffect(() => {
    if (!player.panelOpen || activeLine < 0) return
    const container = lyricRef.current
    const target = container?.querySelector<HTMLElement>(`[data-line="${activeLine}"]`)
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [player.panelOpen, activeLine])

  const ModeIcon =
    player.mode === 'single'
      ? Repeat1
      : player.mode === 'order'
        ? Repeat
        : player.mode === 'shuffle'
          ? Shuffle
          : ListMusic

  const playlistSongs = playlist ?? player.queue
  const playlistKeyword = playlistQuery.trim().toLowerCase()
  const playlistEntries = playlistSongs
    .map((song, index) => ({ song, index }))
    .filter(
      ({ song }) =>
        !playlistKeyword ||
        song.title.toLowerCase().includes(playlistKeyword) ||
        (song.artists || '').toLowerCase().includes(playlistKeyword)
    )
  const playPlaylistItem = (index: number): void => {
    if (onPlayPlaylist) onPlayPlaylist(index)
    else player.playQueue(playlistSongs, index)
  }
  const playlistButton = homeMode ? (
    <button
      className={`icon-btn music-bar-playlist-btn${playlistOpen ? ' active' : ''}`}
      title="播放列表"
      onClick={() => {
        player.setPanelOpen(false)
        setPlaylistOpen((value) => !value)
      }}
    >
      <ListMusic size={17} />
    </button>
  ) : null
  const playlistPanel =
    homeMode && playlistOpen ? (
      <div className="music-panel music-playlist-panel">
        <div className="music-panel-head">
          <span className="music-panel-title">播放列表</span>
          <span className="page-desc">{playlistSongs.length} 首</span>
          <button
            className="icon-btn"
            title="收起播放列表"
            onClick={() => setPlaylistOpen(false)}
          >
            <X size={15} />
          </button>
        </div>
        <label className="search music-playlist-search">
          <Search size={14} />
          <input
            value={playlistQuery}
            onChange={(event) => setPlaylistQuery(event.target.value)}
            placeholder="搜索音乐列表"
          />
        </label>
        <div className="music-playlist-body rows compact">
          {playlistEntries.length ? (
            playlistEntries.map(({ song, index }) => (
              <div
                key={song.key}
                className="row clickable"
                role="button"
                tabIndex={0}
                title="播放这首"
                onClick={() => playPlaylistItem(index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') playPlaylistItem(index)
                }}
              >
                <div className="row-cover">
                  {song.cover ? (
                    <img src={song.cover} alt="" loading="lazy" />
                  ) : (
                    <MusicIcon size={16} />
                  )}
                </div>
                <div className="row-main">
                  <div className="row-title">{song.title}</div>
                  <div className="row-meta">{song.artists || '未知歌手'}</div>
                </div>
                {player.current?.key === song.key ? (
                  <span className="badge brand">播放中</span>
                ) : (
                  <Play size={15} className="row-arrow" />
                )}
              </div>
            ))
          ) : (
            <div className="settings-hint">
              {playlistSongs.length ? '没有匹配的音乐。' : '还没有音乐收藏。'}
            </div>
          )}
        </div>
      </div>
    ) : null

  if (!player.current) {
    if (!alwaysVisible) return null
    return (
      <>
        {playlistPanel}
        <div className="music-bar">
          <div className="music-bar-cover">
            <MusicIcon size={18} />
          </div>
          <div className="music-bar-main">
            <div className="music-bar-title">主页播放器</div>
            <div className="music-bar-sub">
              {playlistSongs.length ? '从播放列表里选一首开始播放' : '还没有音乐收藏'}
            </div>
          </div>
          {playlistButton}
          <div className="music-bar-progress">
            <span>0:00</span>
            <input type="range" min={0} max={1} step={0.5} value={0} disabled />
            <span>0:00</span>
          </div>
          <div className="music-bar-actions">
            <button className="icon-btn" title={PLAY_MODE_LABEL[player.mode]} disabled>
              <ModeIcon size={16} />
            </button>
            <button className="icon-btn" title="上一曲" disabled>
              <SkipBack size={17} />
            </button>
            <button className="icon-btn primary" title="播放" disabled>
              <Play size={17} />
            </button>
            <button className="icon-btn" title="下一曲" disabled>
              <SkipForward size={17} />
            </button>
            <button className="icon-btn" title="歌词" disabled>
              <ListMusic size={16} />
            </button>
            <button className="icon-btn danger" title="关闭播放器" disabled>
              <X size={16} />
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      {playlistPanel}
      {player.panelOpen ? (
        <div className="music-panel">
          <div className="music-panel-head">
            <span className="music-panel-title">{player.current.title}</span>
            <span className="page-desc">{player.current.artists || '未知歌手'}</span>
            <button className="icon-btn" title="收起歌词" onClick={() => player.setPanelOpen(false)}>
              <X size={15} />
            </button>
          </div>
          <div className="music-lyrics" ref={lyricRef}>
            {player.lyrics.length ? (
              player.lyrics.map((line, i) => (
                <div
                  key={`${line.time}-${i}`}
                  data-line={i}
                  className={`music-lyric ${i === activeLine ? 'active' : ''} ${
                    line.time >= 0 ? 'clickable' : ''
                  }`}
                  title={line.time >= 0 ? '点击跳转到这句歌词' : undefined}
                  onClick={() => {
                    if (line.time >= 0) player.seek(line.time)
                  }}
                >
                  {line.text}
                </div>
              ))
            ) : (
              <div className="settings-hint">这首歌暂时没有歌词</div>
            )}
          </div>
        </div>
      ) : null}

      <div className="music-bar">
        <div className="music-bar-cover">
          {player.current.cover ? (
            <img src={player.current.cover} alt="" />
          ) : (
            <MusicIcon size={18} />
          )}
        </div>
        <div className="music-bar-main">
          <div className="music-bar-title">{player.current.title}</div>
          <div className="music-bar-sub">
            {player.resolving
              ? '正在解析播放地址…'
              : player.error
                ? player.error
                : player.current.artists || '未知歌手'}
          </div>
        </div>
        {playlistButton}
        <div className="music-bar-progress">
          <span>{formatTime(player.currentTime)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, player.duration)}
            step={0.5}
            aria-label="播放进度"
            value={Math.min(player.currentTime, player.duration || 0)}
            onChange={(e) => player.seek(Number(e.target.value))}
          />
          <span>{formatTime(player.duration)}</span>
        </div>
        <div className="music-bar-volume">
          <button
            className="icon-btn"
            title={player.muted ? '取消静音' : '静音'}
            aria-label={player.muted ? '取消静音' : '静音'}
            onClick={player.toggleMuted}
          >
            {player.muted || player.volume <= 0 ? (
              <VolumeX size={15} />
            ) : (
              <Volume2 size={15} />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={player.muted ? 0 : player.volume}
            title={`音量 ${Math.round((player.muted ? 0 : player.volume) * 100)}%`}
            aria-label="音量"
            onChange={(e) => player.setVolume(Number(e.target.value))}
          />
        </div>
        <div className="music-bar-actions">
          <button
            className="icon-btn"
            title={PLAY_MODE_LABEL[player.mode]}
            aria-label={`播放模式：${PLAY_MODE_LABEL[player.mode]}`}
            onClick={player.cycleMode}
          >
            <ModeIcon size={16} />
          </button>
          <button className="icon-btn" title="上一曲" aria-label="上一曲" onClick={player.prev}>
            <SkipBack size={17} />
          </button>
          <button
            className="icon-btn primary"
            title={player.playing ? '暂停' : '播放'}
            aria-label={player.playing ? '暂停' : '播放'}
            disabled={player.resolving}
            onClick={player.toggle}
          >
            {player.playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <button className="icon-btn" title="下一曲" aria-label="下一曲" onClick={player.next}>
            <SkipForward size={17} />
          </button>
          <button
            className={`icon-btn ${player.panelOpen ? 'active' : ''}`}
            title="歌词"
            aria-label="歌词"
            onClick={() => {
              setPlaylistOpen(false)
              player.setPanelOpen(!player.panelOpen)
            }}
          >
            <ListMusic size={16} />
          </button>
          <button
            className="icon-btn danger"
            title="关闭播放器"
            aria-label="关闭播放器"
            onClick={() => {
              setPlaylistOpen(false)
              player.stop()
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </>
  )
}
