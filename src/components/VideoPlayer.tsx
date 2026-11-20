import Artplayer from 'artplayer'
import { useEffect, useRef, useState } from 'react'
import { useData } from '../state/DataContext'
import { addStageFullscreen, artBase, attachM3u8, isHlsUrl, setHlsLevel } from './artCore'

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
 * 通用播放器（ArtPlayer 内核）：m3u8 走 hls.js，mp4/flv 等交给原生 video。
 * 底部控制条提供进度 / 音量 / 倍速 / 画中画 / 快捷键 / 设置，
 * 右上角保留项目固定的清晰度下拉（默认锁最高档）；
 * 传 resumeKey 记录续播位置，传 fallbackSrc 主线路失败自动换备用直链。
 */
export function VideoPlayer({
  src,
  resumeKey,
  fallbackSrc,
  onFail,
  onEnded,
  onRetrySrc
}: {
  src: string
  resumeKey?: string
  fallbackSrc?: string
  /** 主线路与备用线路都失败时通知调用方（可用于自动换集 / 提示） */
  onFail?: (message: string) => void
  /** 视频播放到结尾时触发（可用于自动下一集 / 播下一个视频） */
  onEnded?: () => void
  /**
   * 线路失效 / 地址过期时重新取一次播放地址（返回 null 表示拿不到）。
   * 站点网关会随机分流到坏节点、播放地址也带短时效签名，重取一次就能换条活链路。
   */
  onRetrySrc?: () => Promise<string | null>
}) {
  const { updateProgress, getProgressSnapshot } = useData()
  const stageRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<Artplayer | null>(null)
  const onFailRef = useRef(onFail)
  const onEndedRef = useRef(onEnded)
  const onRetrySrcRef = useRef(onRetrySrc)
  onFailRef.current = onFail
  onEndedRef.current = onEnded
  onRetrySrcRef.current = onRetrySrc
  const [error, setError] = useState<string | null>(null)
  const [fallbackActive, setFallbackActive] = useState(false)
  const [retrySrc, setRetrySrc] = useState('')
  const retryCountRef = useRef(0)
  const lastSavedRef = useRef(-1)
  /** 清晰度列表（按高度 / 码率降序），空表示单码率 / 非 HLS，不显示选择器 */
  const [levels, setLevels] = useState<{ index: number; label: string }[]>([])
  const [quality, setQuality] = useState<string>('auto')

  const storeKey = resumeKey ? progressKeyOf(resumeKey) : ''
  const activeSrc = fallbackActive && fallbackSrc ? fallbackSrc : retrySrc || src

  useEffect(() => {
    setFallbackActive(false)
    setRetrySrc('')
    retryCountRef.current = 0
  }, [src])

  useEffect(() => {
    const stage = stageRef.current
    const mount = mountRef.current
    if (!stage || !mount || !activeSrc) return

    setError(null)
    setLevels([])
    setQuality('auto')
    lastSavedRef.current = -1
    let disposed = false

    const fail = (message: string): void => {
      if (disposed) return
      if (fallbackSrc && !fallbackActive) {
        setFallbackActive(true)
        return
      }
      setError(message)
      onFailRef.current?.(message)
    }

    // 网关随机分流到坏节点、播放地址签名过期都会让首包拿不到，
    // 此时重新向调用方要一次地址（主进程会重新解析并探测可用链路），有界重试两次
    const retryOrFail = (message: string): void => {
      if (disposed) return
      if (fallbackSrc && !fallbackActive) {
        setFallbackActive(true)
        return
      }
      const retry = onRetrySrcRef.current
      if (retry && retryCountRef.current < 2) {
        retryCountRef.current += 1
        if (artRef.current) artRef.current.notice.show = '线路重连中…'
        void retry().then((next) => {
          if (disposed) return
          if (next && next !== activeSrc) {
            setRetrySrc(next)
            return
          }
          setError(message)
          onFailRef.current?.(message)
        })
        return
      }
      setError(message)
      onFailRef.current?.(message)
    }

    const startPlayback = (attempt = 0): void => {
      if (disposed) return
      const request = art.video.play()
      if (request) {
        request.catch(() => {
          if (attempt < 5) window.setTimeout(() => startPlayback(attempt + 1), 700)
        })
      }
    }

    const isHls = isHlsUrl(activeSrc)
    const art = new Artplayer({
      ...artBase(mount, activeSrc),
      ...(isHls ? { type: 'm3u8' as const } : {}),
      customType: {
        m3u8: (video, url, instance) => {
          void attachM3u8(video, url, instance, {
            onLevels: (list) => {
              if (disposed) return
              setLevels(list)
              setQuality(list[0] ? String(list[0].index) : 'auto')
            },
            onParsed: () => startPlayback(),
            onFatal: (message) => retryOrFail(message),
            onTip: (message) => retryOrFail(message)
          })
        }
      }
    })
    artRef.current = art
    addStageFullscreen(art, stage)

    // 只读一次进度作为续播起点；进度后续变化不需要让播放器重渲染
    const savedSec = storeKey
      ? Number.parseInt(getProgressSnapshot()[storeKey] ?? '', 10)
      : NaN

    art.on('video:loadedmetadata', () => {
      if (disposed) return
      if (Number.isFinite(savedSec) && savedSec > 5) {
        const duration = Number.isFinite(art.video.duration) ? art.video.duration : 0
        if (!duration || savedSec < duration - 8) {
          try {
            art.currentTime = savedSec
            art.notice.show = `已跳到上次播放 ${formatClock(savedSec)}`
          } catch {
            // 部分流不允许 seek，忽略
          }
        }
      }
      startPlayback()
    })

    const save = (): void => {
      if (!storeKey || !Number.isFinite(art.video.currentTime)) return
      const sec = Math.floor(art.video.currentTime)
      if (sec < 5) return
      if (Math.abs(sec - lastSavedRef.current) < 8) return
      lastSavedRef.current = sec
      // 只提交进度键 + 秒数，不再触发整份 data.json 重写
      updateProgress(storeKey, sec)
    }

    // 暂停 / 播完立即刷盘，其余进度由主进程按窗口批量写入
    const flushProgress = (): void => {
      void window.laozheng.flushReadProgress().catch(() => undefined)
    }

    art.on('video:timeupdate', save)
    art.on('video:pause', flushProgress)
    art.on('video:ended', () => {
      if (disposed) return
      flushProgress()
      onEndedRef.current?.()
    })
    art.on('video:error', () => fail('播放失败，可能是线路失效或需要外网环境'))
    if (!isHls) art.once('video:canplay', () => startPlayback())

    return () => {
      disposed = true
      save()
      flushProgress()
      // 先显式停掉 video：ArtPlayer 销毁后 video 已被移出 DOM，
      // 若还有未完成的 play() / 晚到的媒体流，就没人能再暂停它了。
      // 同时强制静音 / 关自动播放：即使有晚到的 HLS 挂到已脱离 DOM 的元素上，也不会出声
      try {
        art.video.autoplay = false
        art.video.muted = true
        art.video.pause()
        art.video.removeAttribute('src')
        art.video.load()
      } catch {
        // video 已被销毁时忽略
      }
      // ArtPlayer destroy 会一并销毁 hls / 事件，关闭页面不留后台声音
      art.destroy()
      if (artRef.current === art) artRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSrc, storeKey])

  return (
    <div className="player-stage" ref={stageRef}>
      <div className="art-mount" ref={mountRef} />
      {levels.length > 1 ? (
        <select
          className="player-quality"
          title="清晰度"
          value={quality}
          onChange={(event) => {
            const value = event.target.value
            setQuality(value)
            // -1 = 自动（自适应），其余为锁定对应档位
            setHlsLevel(artRef.current, value === 'auto' ? -1 : Number(value))
          }}
        >
          <option value="auto">自动</option>
          {levels.map((level) => (
            <option key={level.index} value={level.index}>
              {level.label}
            </option>
          ))}
        </select>
      ) : null}
      {error ? <div className="player-error">{error}</div> : null}
    </div>
  )
}
