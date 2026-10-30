import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'
import { useData } from '../state/DataContext'

function progressKeyOf(raw: string): string {
  let hash = 0
  for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) | 0
  return `video/${Math.abs(hash)}`
}

/**
 * 通用播放器：m3u8 走 hls.js，mp4/flv 等交给原生 video。
 * 传 resumeKey（同一视频的稳定标识）时记录播放进度，下次自动续播；
 * 传 fallbackSrc 时主线路失败会自动换备用直链（P站 HLS → mp4）。
 */
export function VideoPlayer({
  src,
  resumeKey,
  fallbackSrc,
  onFail
}: {
  src: string
  resumeKey?: string
  fallbackSrc?: string
  /** 主线路与备用线路都失败时通知调用方（可用于自动换集 / 提示） */
  onFail?: (message: string) => void
}) {
  const { data, update } = useData()
  const videoRef = useRef<HTMLVideoElement>(null)
  const lastSavedRef = useRef(-1)
  const onFailRef = useRef(onFail)
  onFailRef.current = onFail
  const [error, setError] = useState<string | null>(null)
  const [resumeHint, setResumeHint] = useState('')
  const [fallbackActive, setFallbackActive] = useState(false)

  const storeKey = resumeKey ? progressKeyOf(resumeKey) : ''
  const activeSrc = fallbackActive && fallbackSrc ? fallbackSrc : src

  useEffect(() => {
    setFallbackActive(false)
  }, [src])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !activeSrc) return
    setError(null)
    setResumeHint('')
    lastSavedRef.current = -1
    let hls: Hls | null = null
    let disposed = false
    const isHls = /\.m3u8(\?|$)/i.test(activeSrc) || /m3u8/i.test(activeSrc)

    const fail = (message: string): void => {
      if (disposed) return
      if (fallbackSrc && !fallbackActive) {
        setFallbackActive(true)
        return
      }
      setError(message)
      onFailRef.current?.(message)
    }

    if (isHls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true })
      hls.on(Hls.Events.ERROR, (_event, payload) => {
        if (payload.fatal) fail('播放失败，可能是线路失效或需要外网环境')
      })
      hls.loadSource(activeSrc)
      hls.attachMedia(video)
    } else {
      video.src = activeSrc
    }

    const savedSec = storeKey ? Number.parseInt(data.readProgress[storeKey] ?? '', 10) : NaN

    const onLoaded = (): void => {
      if (Number.isFinite(savedSec) && savedSec > 5) {
        const duration = Number.isFinite(video.duration) ? video.duration : 0
        if (!duration || savedSec < duration - 8) {
          try {
            video.currentTime = savedSec
            setResumeHint(`已跳到上次播放 ${formatClock(savedSec)}`)
            window.setTimeout(() => setResumeHint(''), 3200)
          } catch {
            // 部分流不允许 seek，忽略
          }
        }
      }
    }

    const save = (): void => {
      if (!storeKey || !Number.isFinite(video.currentTime)) return
      const sec = Math.floor(video.currentTime)
      if (sec < 5) return
      if (Math.abs(sec - lastSavedRef.current) < 8) return
      lastSavedRef.current = sec
      update((d) => ({
        ...d,
        readProgress: { ...d.readProgress, [storeKey]: String(sec) }
      }))
    }

    const onError = (): void => fail('播放失败，可能是线路失效或需要外网环境')
    video.addEventListener('loadedmetadata', onLoaded)
    video.addEventListener('timeupdate', save)
    video.addEventListener('error', onError)
    return () => {
      disposed = true
      save()
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('timeupdate', save)
      video.removeEventListener('error', onError)
      // 关闭播放页 / 切走页面时必须彻底停掉：只销毁 hls 有时会留下后台声音
      try {
        video.pause()
      } catch {
        // 忽略
      }
      hls?.stopLoad()
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSrc, storeKey, fallbackActive])

  return (
    <div className="player-stage">
      <video ref={videoRef} className="player-video" controls autoPlay playsInline />
      {resumeHint ? <div className="player-hint">{resumeHint}</div> : null}
      {error ? <div className="player-error">{error}</div> : null}
    </div>
  )
}

function formatClock(sec: number): string {
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`
}
