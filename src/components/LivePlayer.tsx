import Artplayer from 'artplayer'
import Hls from 'hls.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LivePlayLine } from '../shared/livePlatform'
import { addStageFullscreen, artBase, attachFlv } from './artCore'

/**
 * 平台直播播放器（ArtPlayer 内核）：m3u8 走 hls.js，flv 走 mpegts.js。
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
  const stageRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
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
    const stage = stageRef.current
    const mount = mountRef.current
    if (!stage || !mount || !active) return undefined

    setError('')
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

    const play = (attempt = 0): void => {
      if (disposed) return
      const request = art.video.play()
      if (request) {
        request.catch(() => {
          // 直播流首包晚到时 autoplay 时机会错过，有界重试兜住
          if (attempt < 5) window.setTimeout(() => play(attempt + 1), 700)
        })
      }
    }

    const art = new Artplayer({
      ...artBase(mount, active.url),
      type: active.format === 'flv' ? 'flv' : 'm3u8',
      isLive: true,
      autoMini: false,
      playbackRate: false,
      setting: false,
      customType: {
        m3u8: (video, url, instance) => {
          if (!Hls.isSupported()) {
            video.src = url
            return
          }
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 30
          })
          instance.hls = hls
          hls.on(Hls.Events.ERROR, (_event, payload) => {
            if (payload.fatal) fail('直播流已中断，可能是线路失效')
          })
          hls.on(Hls.Events.MANIFEST_PARSED, () => play())
          hls.loadSource(url)
          hls.attachMedia(video)
          instance.on('destroy', () => hls.destroy())
        },
        flv: (video, url, instance) => void attachFlv(video, url, instance, fail)
      }
    })
    addStageFullscreen(art, stage)
    art.video.addEventListener('canplay', () => play())

    return () => {
      disposed = true
      // 与点播播放器一致：销毁时强制静音，避免任何晚到的媒体流在后台出声
      try {
        art.video.autoplay = false
        art.video.muted = true
        art.video.pause()
        art.video.removeAttribute('src')
        art.video.load()
      } catch {
        // video 已被销毁时忽略
      }
      art.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.url, index, available.length])

  if (!active) {
    return (
      <div className="live-player-empty">
        <span>没有可用的播放线路</span>
      </div>
    )
  }

  return (
    <div className="live-player">
      <div className="player-stage" ref={stageRef}>
        <div className="art-mount" ref={mountRef} />
      </div>
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
