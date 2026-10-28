import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'

/** 通用播放器：m3u8 走 hls.js，mp4/flv 等交给原生 video */
export function VideoPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return
    setError(null)
    let hls: Hls | null = null
    const isHls = /\.m3u8(\?|$)/i.test(src) || /m3u8/i.test(src)

    if (isHls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError('播放失败，可能是线路失效或需要外网环境')
      })
      hls.loadSource(src)
      hls.attachMedia(video)
    } else {
      video.src = src
    }

    const onError = () => setError('播放失败，可能是线路失效或需要外网环境')
    video.addEventListener('error', onError)
    return () => {
      video.removeEventListener('error', onError)
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [src])

  return (
    <div className="player-stage">
      <video ref={videoRef} className="player-video" controls autoPlay playsInline />
      {error ? <div className="player-error">{error}</div> : null}
    </div>
  )
}
