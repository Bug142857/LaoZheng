import { useEffect, useRef, useState } from 'react'
import { Maximize, Minimize, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useData } from '../state/DataContext'
import type { SingingDanmakuItem, SingingQuality } from '../shared/singing'

function progressKeyOf(raw: string): string {
  let hash = 0
  for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) | 0
  return `video/${Math.abs(hash)}`
}

function formatClock(sec: number): string {
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`
}

/**
 * B站视频播放器：DASH 是视频 / 音轨分离的 fMP4，
 * 用 <video> 播画面 + 隐藏 <audio> 播声音，并实时对齐进度 / 音量。
 * 没有音轨地址（durl 回退）时就是普通 mp4 播放器。
 */
export function BiliPlayer({
  src,
  audioSrc,
  backupSrc,
  audioBackupSrc,
  danmaku,
  resumeKey,
  qualities,
  qualityId,
  onQualityChange,
  onFail,
  onEnded
}: {
  src: string
  audioSrc?: string
  backupSrc?: string
  audioBackupSrc?: string
  danmaku?: SingingDanmakuItem[]
  resumeKey?: string
  qualities: SingingQuality[]
  qualityId: string
  onQualityChange: (id: string) => void
  onFail?: (message: string) => void
  onEnded?: () => void
}) {
  const { data, update } = useData()
  const stageRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const danmakuLayerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState('')
  const [danmakuOn, setDanmakuOn] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  /** DASH 视频轨没有声音，原生音量条是灰的：用自建音量控件控制隐藏音轨 */
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const volumeRef = useRef({ volume: 1, muted: false })
  const lastTimeRef = useRef(0)
  const savedSecRef = useRef(-1)
  const onFailRef = useRef(onFail)
  const onEndedRef = useRef(onEnded)
  onFailRef.current = onFail
  onEndedRef.current = onEnded

  const storeKey = resumeKey ? progressKeyOf(resumeKey) : ''

  const applyVolume = (nextVolume: number, nextMuted: boolean): void => {
    const value = Math.min(1, Math.max(0, nextVolume))
    setVolume(value)
    setMuted(nextMuted)
    volumeRef.current = { volume: value, muted: nextMuted }
    const video = videoRef.current
    const audio = audioRef.current
    if (video) {
      video.volume = value
      video.muted = nextMuted
    }
    if (audio && audioSrc) {
      audio.volume = value
      audio.muted = nextMuted
    }
  }

  /** 原生全屏只把 <video> 放大，弹幕层不在里面；改为整个播放器容器全屏 */
  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = (): void => {
    const stage = stageRef.current
    if (!stage) return
    if (document.fullscreenElement === stage) {
      void document.exitFullscreen().catch(() => undefined)
    } else {
      void stage.requestFullscreen().catch(() => undefined)
    }
  }

  useEffect(() => {
    const video = videoRef.current
    const audio = audioRef.current
    if (!video || !src) return

    setError(null)
    setHint('')
    savedSecRef.current = -1
    let disposed = false
    let videoTriedBackup = false
    let audioTriedBackup = false
    let hintTimer = 0

    const savedSec = storeKey ? Number.parseInt(data.readProgress[storeKey] ?? '', 10) : NaN
    const resumeAt = Number.isFinite(savedSec) && savedSec > 5 ? savedSec : 0
    let startAt = lastTimeRef.current > 1 ? lastTimeRef.current : resumeAt

    const pauseAudio = (): void => {
      if (audio && !audio.paused) audio.pause()
    }

    const syncAudio = (force = false): void => {
      if (!audio || !audioSrc || disposed) return
      const drift = Math.abs(audio.currentTime - video.currentTime)
      if (force || drift > 0.4) {
        try {
          audio.currentTime = video.currentTime
        } catch {
          // 音频还没 ready 时忽略，等 loadedmetadata 再对齐
        }
      }
    }

    const startPlayback = (attempt = 0): void => {
      if (disposed) return
      const request = video.play()
      if (request) {
        request.catch(() => {
          if (attempt < 5) window.setTimeout(() => startPlayback(attempt + 1), 700)
        })
      }
    }

    const onLoadedMetadata = (): void => {
      if (disposed) return
      if (startAt > 0) {
        const duration = Number.isFinite(video.duration) ? video.duration : 0
        if (!duration || startAt < duration - 8) {
          try {
            video.currentTime = startAt
            if (audio && audioSrc) audio.currentTime = startAt
          } catch {
            // 部分流不允许 seek
          }
          if (startAt === resumeAt && resumeAt > 5) {
            setHint(`已跳到上次播放 ${formatClock(resumeAt)}`)
            hintTimer = window.setTimeout(() => setHint(''), 3200)
          }
        }
      }
      startPlayback()
    }

    const onPlay = (): void => {
      syncAudio(true)
      if (audio && audioSrc) audio.play().catch(() => undefined)
    }
    const onPause = (): void => pauseAudio()
    const onSeeking = (): void => {
      if (audio && audioSrc) {
        try {
          audio.currentTime = video.currentTime
        } catch {
          // 忽略
        }
      }
    }
    const onSeeked = (): void => {
      syncAudio(true)
      if (audio && audioSrc && !video.paused) audio.play().catch(() => undefined)
    }
    const onRateChange = (): void => {
      if (audio) audio.playbackRate = video.playbackRate
    }
    const onVolumeChange = (): void => {
      const next = { volume: video.volume, muted: video.muted }
      volumeRef.current = next
      setVolume(next.volume)
      setMuted(next.muted)
      // DASH 的声音在隐藏音轨上，原生音量条可用时也要同步过去
      if (audio && audioSrc) {
        audio.volume = next.volume
        audio.muted = next.muted
      }
    }
    const onWaiting = (): void => pauseAudio()
    const onPlaying = (): void => {
      if (audio && audioSrc && !video.paused && audio.paused) {
        syncAudio(true)
        audio.play().catch(() => undefined)
      }
    }
    const onTimeUpdate = (): void => {
      if (!Number.isFinite(video.currentTime)) return
      if (audio && audioSrc && !video.paused) {
        if (Math.abs(audio.currentTime - video.currentTime) > 0.45) syncAudio(true)
      }
      if (!storeKey) return
      const sec = Math.floor(video.currentTime)
      if (sec < 5 || Math.abs(sec - savedSecRef.current) < 8) return
      savedSecRef.current = sec
      update((current) => ({
        ...current,
        readProgress: { ...current.readProgress, [storeKey]: String(sec) }
      }))
    }
    const onEnded = (): void => {
      pauseAudio()
      onEndedRef.current?.()
    }
    const onVideoError = (): void => {
      if (!videoTriedBackup && backupSrc) {
        videoTriedBackup = true
        // 切备用线路后 loadedmetadata 还会按 startAt 续播：用当前进度覆盖，
        // 否则播到一半断流会跳回进入播放器时的位置
        pauseAudio()
        if (Number.isFinite(video.currentTime) && video.currentTime > 1) {
          startAt = video.currentTime
        }
        setHint('主线路失败，正在切换备用线路…')
        video.src = backupSrc
        video.load()
        startPlayback()
        return
      }
      setError('播放失败，可能是线路失效或需要外网环境')
      onFailRef.current?.('播放失败，可能是线路失效或需要外网环境')
    }
    const onAudioError = (): void => {
      if (!audioTriedBackup && audioBackupSrc && audio) {
        audioTriedBackup = true
        audio.src = audioBackupSrc
        audio.load()
        if (!video.paused) audio.play().catch(() => undefined)
        return
      }
      setHint('音轨加载失败，画面仍可播放')
    }
    const onAudioMetadata = (): void => {
      if (!disposed) syncAudio(true)
    }

    video.addEventListener('loadedmetadata', onLoadedMetadata)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('seeking', onSeeking)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('ratechange', onRateChange)
    video.addEventListener('volumechange', onVolumeChange)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('ended', onEnded)
    video.addEventListener('error', onVideoError)
    audio?.addEventListener('error', onAudioError)
    audio?.addEventListener('loadedmetadata', onAudioMetadata)

    video.src = src
    video.volume = volumeRef.current.volume
    video.muted = volumeRef.current.muted
    video.load()
    if (audio) {
      if (audioSrc) {
        audio.src = audioSrc
        audio.load()
        audio.volume = volumeRef.current.volume
        audio.muted = volumeRef.current.muted
      } else {
        audio.removeAttribute('src')
        audio.load()
      }
    }

    return () => {
      disposed = true
      window.clearTimeout(hintTimer)
      lastTimeRef.current = video.currentTime
      video.pause()
      pauseAudio()
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeking', onSeeking)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('ratechange', onRateChange)
      video.removeEventListener('volumechange', onVolumeChange)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onVideoError)
      audio?.removeEventListener('error', onAudioError)
      audio?.removeEventListener('loadedmetadata', onAudioMetadata)
      video.removeAttribute('src')
      video.load()
      if (audio) {
        audio.removeAttribute('src')
        audio.load()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, audioSrc, backupSrc, audioBackupSrc, storeKey])

  /** 弹幕：按视频时间逐条生成，滚动 / 顶部 / 底部三种模式；开关关闭时清空 */
  useEffect(() => {
    const video = videoRef.current
    const layer = danmakuLayerRef.current
    if (!video || !layer || !danmakuOn || !danmaku?.length) return

    const items = [...danmaku].sort((a, b) => a.time - b.time)
    const lanes = new Map<number, number>()
    const laneCount = 10
    let index = 0
    let last = video.currentTime
    let raf = 0

    const clear = (): void => {
      layer.textContent = ''
    }
    const reset = (): void => {
      clear()
      index = 0
      while (index < items.length && items[index].time < video.currentTime) index += 1
      last = video.currentTime
    }
    reset()

    const spawn = (item: SingingDanmakuItem): void => {
      if (layer.childElementCount >= 90) layer.firstElementChild?.remove()
      const el = document.createElement('span')
      el.className = 'bili-dm-item'
      el.textContent = item.text
      const color = item.color & 0xffffff
      if (color !== 0xffffff) el.style.color = `#${color.toString(16).padStart(6, '0')}`
      if (item.size >= 30) el.style.fontSize = '22px'
      if (item.mode === 5) {
        el.classList.add('top')
        el.style.animation = 'bili-dm-static 4s linear forwards'
      } else if (item.mode === 4) {
        el.classList.add('bottom')
        el.style.animation = 'bili-dm-static 4s linear forwards'
      } else {
        let lane = 0
        let oldest = Number.POSITIVE_INFINITY
        for (let i = 0; i < laneCount; i += 1) {
          const at = lanes.get(i) ?? Number.NEGATIVE_INFINITY
          if (at < oldest) {
            oldest = at
            lane = i
          }
        }
        lanes.set(lane, video.currentTime)
        el.style.top = `${8 + lane * 28}px`
        el.style.setProperty('--dm-distance', `${layer.clientWidth}px`)
        el.style.animation = `bili-dm-move ${8 + Math.min(5, item.text.length / 8)}s linear forwards`
      }
      el.addEventListener('animationend', () => el.remove())
      layer.appendChild(el)
    }

    const tick = (): void => {
      if (!video.paused) {
        const now = video.currentTime
        if (now < last - 0.5 || now > last + 2) {
          reset()
        } else {
          while (index < items.length && items[index].time <= now) {
            if (items[index].time >= last - 0.25) spawn(items[index])
            index += 1
          }
          last = now
        }
      } else {
        last = video.currentTime
      }
      layer.classList.toggle('paused', video.paused)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      clear()
    }
  }, [danmaku, danmakuOn, src])

  return (
    <div ref={stageRef} className="player-stage">
      <video ref={videoRef} className="player-video bili-video" controls autoPlay playsInline />
      <audio ref={audioRef} className="bili-audio" preload="auto" />
      {danmakuOn ? <div ref={danmakuLayerRef} className="bili-danmaku-layer" /> : null}
      <div className="bili-player-tools">
        <button
          type="button"
          className={`bili-danmaku-btn ${
            danmakuOn && danmaku && danmaku.length > 0 ? 'on' : ''
          }`}
          disabled={!danmaku || danmaku.length === 0}
          title={
            danmaku && danmaku.length > 0
              ? danmakuOn
                ? '关闭弹幕'
                : '开启弹幕'
              : '该视频暂无弹幕'
          }
          onClick={() => setDanmakuOn((value) => !value)}
        >
          弹幕
        </button>
        <div className="bili-volume" title="音量">
          <button
            type="button"
            className="bili-volume-btn"
            title={muted || volume === 0 ? '取消静音' : '静音'}
            onClick={() => {
              const silent = muted || volume === 0
              applyVolume(silent ? (volume > 0 ? volume : 0.8) : volume, !silent)
            }}
          >
            {muted || volume === 0 ? (
              <VolumeX size={16} />
            ) : volume < 0.5 ? (
              <Volume1 size={16} />
            ) : (
              <Volume2 size={16} />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            title="音量"
            onChange={(event) => {
              const next = Number(event.target.value)
              applyVolume(next, next === 0)
            }}
          />
        </div>
        {qualities.length > 1 ? (
          <select
            className="player-quality"
            title="清晰度"
            value={qualityId}
            onChange={(event) => onQualityChange(event.target.value)}
          >
            {qualities.map((quality) => (
              <option key={quality.id} value={quality.id}>
                {quality.label}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          className="bili-fullscreen-btn"
          title={fullscreen ? '退出全屏' : '全屏'}
          onClick={toggleFullscreen}
        >
          {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
      </div>
      {hint ? <div className="player-hint">{hint}</div> : null}
      {error ? <div className="player-error">{error}</div> : null}
    </div>
  )
}
