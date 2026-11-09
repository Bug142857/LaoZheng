import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LivePlayLine } from '../shared/livePlatform'

/**
 * 平台直播播放器：m3u8 走 hls.js，flv 走 mpegts.js。
 * 线路失败自动切下一条，全部失败时把原因交给页面显示。
 * 直播没有进度，不记录续播位置。
 */
export function LivePlayer({
  lines,
  onError
}: {
  lines: LivePlayLine[]
  onError?: (message: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [index, setIndex] = useState(0)
  const [error, setError] = useState('')

  const available = useMemo(() => {
    const seen = new Set<string>()
    return lines.filter((line) => {
      if (seen.has(line.url)) return false
      seen.add(line.url)
      return true
    })
  }, [lines])

  const active = available[index] ?? null

  /** 同一清晰度 / 格式只保留一个按钮；底层仍保留所有线路用于自动切换 */
  const lineGroups = useMemo(() => {
    const map = new Map<string, { label: string; format: string; index: number }>()
    available.forEach((line, index) => {
      const key = `${line.qualityLabel}|${line.format}`
      if (!map.has(key)) {
        map.set(key, { label: line.qualityLabel, format: line.format, index })
      }
    })
    return [...map.values()]
  }, [available])

  useEffect(() => {
    setIndex(0)
    setError('')
  }, [lines])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !active) return undefined

    setError('')
    let hls: Hls | null = null
    let flv: ReturnType<typeof mpegts.createPlayer> | null = null
    let disposed = false

    const fail = (message: string): void => {
      if (disposed) return
      if (index < available.length - 1) {
        setIndex(index + 1)
        return
      }
      setError(message)
      onError?.(message)
    }

    const play = (): void => {
      video.play().catch(() => {
        // 浏览器可能拦截自动播放，保留控制条让用户手动点
      })
    }

    if (active.format === 'hls') {
      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30
        })
        hls.on(Hls.Events.ERROR, (_event, payload) => {
          if (payload.fatal) fail('直播流已中断，可能是线路失效')
        })
        hls.loadSource(active.url)
        hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, play)
      } else {
        video.src = active.url
        play()
      }
    } else if (mpegts.isSupported()) {
      flv = mpegts.createPlayer(
        { type: 'flv', url: active.url, isLive: true, cors: true },
        {
          enableWorker: true,
          liveBufferLatencyChasing: true,
          lazyLoad: false
        }
      )
      flv.attachMediaElement(video)
      flv.on(mpegts.Events.ERROR, () => fail('FLV 直播流已中断，可能是线路失效'))
      flv.load()
      play()
    } else {
      fail('当前环境不支持 FLV 播放')
    }

    return () => {
      disposed = true
      try {
        video.pause()
        video.removeAttribute('src')
        video.load()
      } catch {
        // 忽略
      }
      hls?.destroy()
      flv?.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, index, available.length])

  if (!active) {
    return (
      <div className="live-player-empty">
        <span>没有可用的播放线路</span>
      </div>
    )
  }

  return (
    <div className="live-player">
      <video ref={videoRef} controls autoPlay playsInline />
      {lineGroups.length > 1 ? (
        <div className="live-lines">
          {lineGroups.map((line) => (
            <button
              key={`${line.label}-${line.format}`}
              className={`chip ${line.index === index ? 'active' : ''}`}
              onClick={() => {
                setError('')
                setIndex(line.index)
              }}
            >
              {line.label}
              <span className="live-line-format">{line.format.toUpperCase()}</span>
            </button>
          ))}
        </div>
      ) : null}
      {error ? <div className="live-player-error">{error}</div> : null}
    </div>
  )
}
