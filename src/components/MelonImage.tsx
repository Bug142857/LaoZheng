import { useEffect, useState, type CSSProperties } from 'react'

/**
 * 吃瓜图片：图床返回的是 AES 密文，必须由主进程解密后再交给 <img>。
 * 同一 URL 在会话内只解密一次（封面会在列表/收藏/详情里重复出现）。
 */
const cache = new Map<string, string>()

export function MelonImage({
  url,
  className,
  alt = '',
  style
}: {
  url: string | null | undefined
  className?: string
  alt?: string
  style?: CSSProperties
}) {
  const [src, setSrc] = useState(() => (url ? cache.get(url) ?? '' : ''))

  useEffect(() => {
    if (!url) {
      setSrc('')
      return
    }
    const hit = cache.get(url)
    if (hit) {
      setSrc(hit)
      return
    }
    let alive = true
    void window.laozheng.melonImage(url).then((res) => {
      if (!alive) return
      if (res.ok && res.dataUrl) {
        if (cache.size > 300) cache.clear()
        cache.set(url, res.dataUrl)
        setSrc(res.dataUrl)
      }
    })
    return () => {
      alive = false
    }
  }, [url])

  if (!src) return null
  return <img src={src} alt={alt} className={className} style={style} loading="lazy" />
}
