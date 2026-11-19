import Artplayer from 'artplayer'
import Danmaku from 'danmaku'
import { useEffect, useRef, useState } from 'react'
import { useData } from '../state/DataContext'
import type { SingingDanmakuItem, SingingQuality } from '../shared/singing'
import { addStageFullscreen, artBase } from './artCore'

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
 * B站视频播放器（ArtPlayer 内核）：DASH 是视频 / 音轨分离的 fMP4，
 * 用画面 <video> 播视频 + 隐藏 <audio> 播声音，并实时对齐进度 / 音量 / 倍速。
 * 没有音轨地址（durl 回退）时就是普通 mp4 播放器。
 * 底部控制条由 ArtPlayer 提供，右上角保留弹幕开关与清晰度下拉。
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
  const { updateProgress, getProgressSnapshot } = useData()
  const stageRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<Artplayer | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const danmakuLayerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [danmakuOn, setDanmakuOn] = useState(true)
  const volumeRef = useRef({ volume: 1, muted: false })
  const lastTimeRef = useRef(0)
  const savedSecRef = useRef(-1)
  const onFailRef = useRef(onFail)
  const onEndedRef = useRef(onEnded)
  onFailRef.current = onFail
  onEndedRef.current = onEnded

  const storeKey = resumeKey ? progressKeyOf(resumeKey) : ''

  useEffect(() => {
    const stage = stageRef.current
    const mount = mountRef.current
    const audio = audioRef.current
    if (!stage || !mount || !src) return

    setError(null)
    savedSecRef.current = -1
    let disposed = false
    let videoTriedBackup = false
    let audioTriedBackup = false

    // 只读一次进度作为续播起点；进度后续变化不需要让播放器重渲染
    const savedSec = storeKey
      ? Number.parseInt(getProgressSnapshot()[storeKey] ?? '', 10)
      : NaN
    const resumeAt = Number.isFinite(savedSec) && savedSec > 5 ? savedSec : 0
    let startAt = lastTimeRef.current > 1 ? lastTimeRef.current : resumeAt

    const pauseAudio = (): void => {
      if (audio && !audio.paused) audio.pause()
    }

    const syncAudio = (force = false): void => {
      const video = artRef.current?.video
      if (!audio || !audioSrc || !video || disposed) return
      const drift = Math.abs(audio.currentTime - video.currentTime)
      if (force || drift > 0.4) {
        try {
          audio.currentTime = video.currentTime
        } catch {
          // 音频还没 ready 时忽略，等 loadedmetadata 再对齐
        }
      }
    }

    const art = new Artplayer({
      ...artBase(mount, src),
      // DASH 双轨的声音在隐藏音轨上，画中画会把声音留在外面
      pip: false,
      autoMini: false
    })
    artRef.current = art
    addStageFullscreen(art, stage)

    const startPlayback = (attempt = 0): void => {
      if (disposed) return
      const request = art.video.play()
      if (request) {
        request.catch(() => {
          if (attempt < 5) window.setTimeout(() => startPlayback(attempt + 1), 700)
        })
      }
    }

    const flushProgress = (): void => {
      void window.laozheng.flushReadProgress().catch(() => undefined)
    }

    const onLoadedMetadata = (): void => {
      if (disposed) return
      if (startAt > 0) {
        const duration = Number.isFinite(art.video.duration) ? art.video.duration : 0
        if (!duration || startAt < duration - 8) {
          try {
            art.currentTime = startAt
            if (audio && audioSrc) audio.currentTime = startAt
          } catch {
            // 部分流不允许 seek
          }
          if (startAt === resumeAt && resumeAt > 5) {
            art.notice.show = `已跳到上次播放 ${formatClock(resumeAt)}`
          }
        }
      }
      startPlayback()
    }

    const onPlay = (): void => {
      syncAudio(true)
      if (audio && audioSrc) audio.play().catch(() => undefined)
    }
    const onPause = (): void => {
      pauseAudio()
      flushProgress()
    }
    const onSeeking = (): void => {
      const video = art.video
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
      if (audio && audioSrc && !art.video.paused) audio.play().catch(() => undefined)
    }
    const onRateChange = (): void => {
      if (audio) audio.playbackRate = art.video.playbackRate
    }
    const onVolumeChange = (): void => {
      const next = { volume: art.video.volume, muted: art.video.muted }
      volumeRef.current = next
      // DASH 的声音在隐藏音轨上，ArtPlayer 的音量条作用在画面上，需要同步过去
      if (audio && audioSrc) {
        audio.volume = next.volume
        audio.muted = next.muted
      }
    }
    const onWaiting = (): void => pauseAudio()
    const onPlaying = (): void => {
      if (audio && audioSrc && !art.video.paused && audio.paused) {
        syncAudio(true)
        audio.play().catch(() => undefined)
      }
    }
    const onTimeUpdate = (): void => {
      const video = art.video
      if (!Number.isFinite(video.currentTime)) return
      if (audio && audioSrc && !video.paused) {
        if (Math.abs(audio.currentTime - video.currentTime) > 0.45) syncAudio(true)
      }
      if (!storeKey) return
      const sec = Math.floor(video.currentTime)
      if (sec < 5 || Math.abs(sec - savedSecRef.current) < 8) return
      savedSecRef.current = sec
      updateProgress(storeKey, sec)
    }
    const onEnded = (): void => {
      pauseAudio()
      flushProgress()
      onEndedRef.current?.()
    }
    const onVideoError = (): void => {
      if (!videoTriedBackup && backupSrc) {
        videoTriedBackup = true
        // 切备用线路后 loadedmetadata 还会按 startAt 续播：用当前进度覆盖，
        // 否则播到一半断流会跳回进入播放器时的位置
        pauseAudio()
        if (Number.isFinite(art.video.currentTime) && art.video.currentTime > 1) {
          startAt = art.video.currentTime
        }
        art.notice.show = '主线路失败，正在切换备用线路…'
        void art.switchUrl(backupSrc).then(() => startPlayback()).catch(() => undefined)
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
        if (!art.video.paused) audio.play().catch(() => undefined)
        return
      }
      art.notice.show = '音轨加载失败，画面仍可播放'
    }
    const onAudioMetadata = (): void => syncAudio(true)

    art.on('video:loadedmetadata', onLoadedMetadata)
    art.on('video:play', onPlay)
    art.on('video:pause', onPause)
    art.on('video:seeking', onSeeking)
    art.on('video:seeked', onSeeked)
    art.on('video:ratechange', onRateChange)
    art.on('video:volumechange', onVolumeChange)
    art.on('video:waiting', onWaiting)
    art.on('video:playing', onPlaying)
    art.on('video:timeupdate', onTimeUpdate)
    art.on('video:ended', onEnded)
    art.on('video:error', onVideoError)
    audio?.addEventListener('error', onAudioError)
    audio?.addEventListener('loadedmetadata', onAudioMetadata)

    art.video.volume = volumeRef.current.volume
    art.video.muted = volumeRef.current.muted
    if (audio) {
      if (audioSrc) {
        audio.src = audioSrc
        audio.load()
        audio.volume = volumeRef.current.volume
        audio.muted = volumeRef.current.muted
        // ArtPlayer 的 autoplay 可能在事件监听绑定前就启动，这里补一次音轨播放
        if (!art.video.paused) audio.play().catch(() => undefined)
      } else {
        audio.removeAttribute('src')
        audio.load()
      }
    }

    return () => {
      disposed = true
      lastTimeRef.current = art.video.currentTime
      flushProgress()
      audio?.removeEventListener('error', onAudioError)
      audio?.removeEventListener('loadedmetadata', onAudioMetadata)
      pauseAudio()
      if (audio) {
        audio.removeAttribute('src')
        audio.load()
      }
      art.destroy()
      if (artRef.current === art) artRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, audioSrc, backupSrc, audioBackupSrc, storeKey])

  /**
   * 弹幕：用 Danmaku 引擎渲染。轨道分配按每条弹幕的实际宽度做碰撞检测
   * （同轨不重叠、不追尾，顶部 / 底部按停留时间占位），即 B 站弹幕的排版算法；
   * 播放 / 暂停 / 拖动进度由引擎跟随视频自动同步。
   * 字号随播放器宽度放大（全屏约 1.8 倍），滚动速度按宽度换算，横穿屏幕约 8 秒。
   */
  useEffect(() => {
    const video = artRef.current?.video
    const layer = danmakuLayerRef.current
    if (!video || !layer || !danmakuOn || !danmaku?.length) return

    /** 900px 宽以内保持原字号，更宽的窗口 / 全屏按比例放大，上限 1.8 倍 */
    const fontScaleOf = (): number =>
      Math.round(Math.min(1.8, Math.max(1, layer.clientWidth / 900)) * 10) / 10

    const build = (scale: number): Danmaku =>
      new Danmaku({
        container: layer,
        media: video,
        // 横穿屏幕约 8 秒，宽屏时物理速度同步放大
        speed: Math.max(80, layer.clientWidth / 8),
        comments: danmaku.map((item) => {
          const color = item.color & 0xffffff
          return {
            text: item.text,
            time: item.time,
            mode: (item.mode === 5 ? 'top' : item.mode === 4 ? 'bottom' : 'rtl') as
              | 'top'
              | 'bottom'
              | 'rtl',
            style: {
              color: color !== 0xffffff ? `#${color.toString(16).padStart(6, '0')}` : '#ffffff',
              fontSize: `${Math.round((item.size >= 30 ? 22 : 18) * scale)}px`,
              lineHeight: '1.2',
              fontWeight: '600',
              textShadow: '0 1px 2px rgba(0, 0, 0, 0.9), 0 0 4px rgba(0, 0, 0, 0.6)'
            }
          }
        })
      })

    let scale = fontScaleOf()
    let engine = build(scale)
    let timer = 0

    // 窗口缩放 / 进出全屏：字号档位变了就重建（碰撞检测用的是创建时测量的弹幕宽度），
    // 否则只重新分配轨道并更新滚动速度
    const resize = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (!layer.clientWidth) return
        const next = fontScaleOf()
        if (next !== scale) {
          engine.destroy()
          engine = build(next)
          scale = next
          return
        }
        engine.resize()
        engine.speed = Math.max(80, layer.clientWidth / 8)
      }, 220)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(layer)
    document.addEventListener('fullscreenchange', resize)

    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
      document.removeEventListener('fullscreenchange', resize)
      engine.destroy()
    }
  }, [danmaku, danmakuOn, src])

  return (
    <div ref={stageRef} className="player-stage">
      <div className="art-mount" ref={mountRef} />
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
      </div>
      {error ? <div className="player-error">{error}</div> : null}
    </div>
  )
}
