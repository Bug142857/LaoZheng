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
  const { data, update } = useData()
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const lastSavedRef = useRef(-1)
  const onFailRef = useRef(onFail)
  const onEndedRef = useRef(onEnded)
  const onRetrySrcRef = useRef(onRetrySrc)
  onFailRef.current = onFail
  onEndedRef.current = onEnded
  onRetrySrcRef.current = onRetrySrc
  const [error, setError] = useState<string | null>(null)
  const [resumeHint, setResumeHint] = useState('')
  const [fallbackActive, setFallbackActive] = useState(false)
  /** 重连后拿到的替换地址（主进程重新解析 / 探测过的链路） */
  const [retrySrc, setRetrySrc] = useState('')
  const retryCountRef = useRef(0)
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
    const video = videoRef.current
    if (!video || !activeSrc) return
    setError(null)
    setResumeHint('')
    setLevels([])
    setQuality('auto')
    lastSavedRef.current = -1
    let hls: Hls | null = null
    let disposed = false
    // 爽看（肉视频）的播放地址是 /api/hls/<id>，不带 .m3u8 后缀
    const isHls =
      /\.m3u8(\?|$)/i.test(activeSrc) ||
      /m3u8/i.test(activeSrc) ||
      /\/api\/hls\//i.test(activeSrc)

    const fail = (message: string): void => {
      if (disposed) return
      if (fallbackSrc && !fallbackActive) {
        setFallbackActive(true)
        return
      }
      setError(message)
      onFailRef.current?.(message)
    }

    // v0.122：网关随机分流到坏节点、播放地址签名过期都会让首包拿不到，
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
        setResumeHint('线路重连中…')
        void retry().then((next) => {
          if (disposed) return
          setResumeHint('')
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

    // v0.122：不能只靠 <video autoPlay> —— MSE 场景下首包数据晚到时 autoplay 时机已过，
    // 视频会一直停在暂停态（实测肉视频 / P站都出现过）。显式 play() + 有界重试兜住。
    const startPlayback = (attempt = 0): void => {
      if (disposed) return
      const req = video.play()
      if (req) {
        req.catch(() => {
          if (attempt < 5) window.setTimeout(() => startPlayback(attempt + 1), 700)
        })
      }
    }

    if (isHls && Hls.isSupported()) {
      // v0.122：站点网关会随机分流到部分 502 / 401 的边缘节点，多试几次自动绕开坏节点
      hls = new Hls({
        enableWorker: true,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 600,
        manifestLoadingMaxRetryTimeout: 4000,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 600,
        fragLoadingMaxRetry: 8,
        fragLoadingRetryDelay: 500,
        // v0.122：肉视频 /api/hls/<id> 是随机分流的 302 入口，Chromium 会缓存这条 302，
        // 重试时一直回到同一个边缘节点，节点坏了就整段播不了。每次请求加一次性参数强制重新分流。
        xhrSetup: (xhr, url) => {
          if (/\/api\/hls\//i.test(url)) {
            const bust = `r=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
            xhr.open('GET', `${url}${url.includes('?') ? '&' : '?'}${bust}`, true)
          }
        }
      })
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, manifest) => {
        if (disposed) return
        // 有的源只在主清单里声明带宽、不写分辨率，这类档位也纳入清晰度列表，
        // 否则会误判成单码率而完全不显示选择器
        const parsed = manifest.levels
          .map((level, index) => {
            const height = level.height || 0
            const bitrate = level.bitrate || 0
            if (!height && !bitrate) return null
            return {
              index,
              label: height > 0 ? `${height}P` : `${Math.round(bitrate / 1000)}K`,
              rank: height * 1_000_000 + bitrate
            }
          })
          .filter((level): level is { index: number; label: string; rank: number } => !!level)
          .sort((a, b) => b.rank - a.rank)
        setLevels(parsed.map(({ index, label }) => ({ index, label })))
        // 默认选最高清晰度（直接锁定，不做自适应降档）
        const best = parsed[0]
        if (best) {
          hls!.currentLevel = best.index
          setQuality(String(best.index))
        }
        startPlayback()
      })
      // v0.122：站点风控时会把播放清单换成几秒提示片（player.centercdn.top/tip.ts），
      // 检测到直接重连，不让用户静默看完提示片还以为播放正常
      hls.on(Hls.Events.LEVEL_LOADED, (_event, payload) => {
        const first = payload.details?.fragments?.[0]?.url ?? ''
        if (first && /\/tip\./i.test(first)) {
          retryOrFail('站点风控拦截了播放（返回提示片），请重试或稍后再试')
        }
      })
      hls.on(Hls.Events.ERROR, (_event, payload) => {
        if (payload.fatal) retryOrFail('播放失败，可能是线路失效或需要外网环境')
      })
      hlsRef.current = hls
      hls.loadSource(activeSrc)
      hls.attachMedia(video)
    } else {
      video.src = activeSrc
      video.addEventListener('canplay', () => startPlayback(), { once: true })
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
    const handleEnded = (): void => {
      if (disposed) return
      onEndedRef.current?.()
    }
    video.addEventListener('loadedmetadata', onLoaded)
    video.addEventListener('timeupdate', save)
    video.addEventListener('error', onError)
    video.addEventListener('ended', handleEnded)
    return () => {
      disposed = true
      save()
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('timeupdate', save)
      video.removeEventListener('error', onError)
      video.removeEventListener('ended', handleEnded)
      // 关闭播放页 / 切走页面时必须彻底停掉：只销毁 hls 有时会留下后台声音
      try {
        video.pause()
      } catch {
        // 忽略
      }
      hls?.stopLoad()
      hls?.destroy()
      if (hlsRef.current === hls) hlsRef.current = null
      video.removeAttribute('src')
      video.load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSrc, storeKey, fallbackActive])

  return (
    <div className="player-stage">
      <video ref={videoRef} className="player-video" controls autoPlay playsInline />
      {levels.length > 1 ? (
        <select
          className="player-quality"
          title="清晰度"
          value={quality}
          onChange={(event) => {
            const hls = hlsRef.current
            if (!hls) return
            const value = event.target.value
            setQuality(value)
            // -1 = 自动（自适应），其余为锁定对应档位
            hls.currentLevel = value === 'auto' ? -1 : Number(value)
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
