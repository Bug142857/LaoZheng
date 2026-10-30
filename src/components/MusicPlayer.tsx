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
  Shuffle,
  SkipBack,
  SkipForward,
  X
} from 'lucide-react'
import type { InnerFav } from '../shared/types'

export type PlayMode = 'single' | 'order' | 'shuffle'

export interface PlayerSong {
  /** 唯一键：platform|id 或直链 */
  key: string
  id: string
  platform?: string
  title: string
  artists: string
  cover: string | null
  /** 已解析直链（本地音乐 / 下载音乐） */
  url?: string
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
  lyrics: LyricLine[]
  playQueue: (songs: PlayerSong[], startIndex?: number) => void
  playFavs: (favs: InnerFav[], startIndex?: number) => void
  toggle: () => void
  next: () => void
  prev: () => void
  cycleMode: () => void
  setPanelOpen: (open: boolean) => void
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
  if (fav.id.includes('|')) {
    const [prefix, ...rest] = fav.id.split('|')
    id = rest.join('|')
    platform = prefix
  }
  if (fav.payload) {
    try {
      const payload = JSON.parse(fav.payload) as {
        raw?: { id?: string; platform?: string }
      }
      if (payload.raw?.id) id = payload.raw.id
      if (payload.raw?.platform) platform = payload.raw.platform
    } catch {
      // 旧收藏没有 payload，按标题回退解析
    }
  }
  return {
    key: `fav-${fav.module}-${fav.id}`,
    id,
    platform,
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
  if (/^[0-9a-f]{32}$/i.test(rawId) && (!prefix || prefix === 'mvmp3' || prefix === 's33ve')) {
    const res = await window.laozheng.resolveMusic(rawId, prefix || 'mvmp3')
    if (!res.ok || !res.url) return null
    return { url: res.url, lrc: res.lrc ?? '', cover: res.cover || song.cover || '' }
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

  const current = index >= 0 ? queue[index] ?? null : null

  const ensureAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const audio = new Audio()
      audio.preload = 'auto'
      audioRef.current = audio
    }
    return audioRef.current
  }, [])

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
    const audio = audioRef.current
    if (!audio || !current || resolvingRef.current) return
    if (audio.paused) {
      void audio.play().then(() => setPlaying(true)).catch(() => {
        setError('播放失败，可能是直链已失效')
      })
    } else {
      audio.pause()
      setPlaying(false)
    }
  }, [current])

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
    setError(null)
    setPanelOpen(false)
  }, [])

  useEffect(() => {
    const audio = ensureAudio()
    const onTime = (): void => setCurrentTime(audio.currentTime)
    const onMeta = (): void => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    const onEnded = (): void => advance(true)
    const onError = (): void => {
      if (audio.src) setError('播放失败，可能是直链失效或需要外网')
      setPlaying(false)
    }
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
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
  }, [advance, ensureAudio])

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
      lyrics,
      playQueue,
      playFavs,
      toggle,
      next,
      prev,
      cycleMode,
      setPanelOpen,
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
      lyrics,
      playQueue,
      playFavs,
      toggle,
      next,
      prev,
      cycleMode,
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

export function MusicPlayerBar() {
  const player = useMusicPlayer()
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

  if (!player.current) return null

  const ModeIcon =
    player.mode === 'single'
      ? Repeat1
      : player.mode === 'order'
        ? Repeat
        : player.mode === 'shuffle'
          ? Shuffle
          : ListMusic

  return (
    <>
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
        <div className="music-bar-progress">
          <span>{formatTime(player.currentTime)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, player.duration)}
            step={0.5}
            value={Math.min(player.currentTime, player.duration || 0)}
            onChange={(e) => player.seek(Number(e.target.value))}
          />
          <span>{formatTime(player.duration)}</span>
        </div>
        <div className="music-bar-actions">
          <button
            className="icon-btn"
            title={PLAY_MODE_LABEL[player.mode]}
            onClick={player.cycleMode}
          >
            <ModeIcon size={16} />
          </button>
          <button className="icon-btn" title="上一曲" onClick={player.prev}>
            <SkipBack size={17} />
          </button>
          <button
            className="icon-btn primary"
            title={player.playing ? '暂停' : '播放'}
            disabled={player.resolving}
            onClick={player.toggle}
          >
            {player.playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <button className="icon-btn" title="下一曲" onClick={player.next}>
            <SkipForward size={17} />
          </button>
          <button
            className={`icon-btn ${player.panelOpen ? 'active' : ''}`}
            title="歌词 / 播放列表"
            onClick={() => player.setPanelOpen(!player.panelOpen)}
          >
            <ListMusic size={16} />
          </button>
          <button className="icon-btn danger" title="关闭播放器" onClick={player.stop}>
            <X size={16} />
          </button>
        </div>
      </div>
    </>
  )
}
