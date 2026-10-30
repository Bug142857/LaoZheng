import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'

/**
 * 全局图片放大：详情页里的图片单击打开；同一组图片（剧照 / 照片 / 漫画章节）可用
 * 底部「上一张 / 下一张」或键盘左右键切换。点击遮罩关闭。
 */
export function openImageZoom(src: string, gallery?: string[]): void {
  if (!src) return
  window.dispatchEvent(
    new CustomEvent('lz:image-zoom', {
      detail: { src, gallery: gallery && gallery.length ? gallery : undefined }
    })
  )
}

/** 单击图片打开放大层的范围：详情页内的剧照 / 人物照片 / 吃瓜正文 / 漫画 */
const DETAIL_IMAGE_SCOPE =
  '.detail-photos, .melon-article, .comic-reader, .item-detail-head, .person-detail-cover'
/** 点击会跳转的封面 / 卡片，不拦截单击 */
const CLICKABLE_SCOPE =
  'button, a, [role="button"], .clickable, .media-card, .item-card, .comic-card, .tile, .person-work-card'

/** 同一区块里的全部图片作为图集 */
function collectGallery(img: HTMLImageElement, src: string): string[] {
  const scope =
    img.closest('.detail-photos') ??
    img.closest('.melon-article') ??
    img.closest('section') ??
    img.closest('.comic-reader') ??
    document.body
  const urls = [...scope.querySelectorAll('img')]
    .map((el) => el.currentSrc || el.src)
    .filter((url) => /^(https?:|data:|blob:)/i.test(url))
  const unique = [...new Set(urls)]
  return unique.length ? unique : [src]
}

export function ImageViewer({ onNotice }: { onNotice: (text: string) => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [gallery, setGallery] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [scale, setScale] = useState(1)
  const [saving, setSaving] = useState(false)
  const stageRef = useRef<HTMLDivElement | null>(null)

  const close = useCallback(() => {
    setSrc(null)
    setGallery([])
    setIndex(0)
    setScale(1)
  }, [])

  const show = useCallback((url: string, list?: string[]) => {
    const nextGallery = list && list.length ? list : [url]
    const at = Math.max(0, nextGallery.indexOf(url))
    setGallery(nextGallery)
    setIndex(at)
    setScale(1)
    setSrc(nextGallery[at] ?? url)
  }, [])

  const step = useCallback(
    (delta: number) => {
      if (gallery.length < 2) return
      const next = (index + delta + gallery.length) % gallery.length
      setIndex(next)
      setScale(1)
      setSrc(gallery[next])
    },
    [gallery, index]
  )

  const save = useCallback(
    async (url: string) => {
      setSaving(true)
      try {
        const res = await window.laozheng.saveImage(url)
        if (res.canceled) return
        if (res.error) {
          onNotice(`保存失败：${res.error}`)
          return
        }
        onNotice(`图片已保存到 ${res.path}`)
      } catch (err) {
        onNotice(`保存失败：${(err as Error).message}`)
      } finally {
        setSaving(false)
      }
    },
    [onNotice]
  )

  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof HTMLImageElement)) return
      if (target.dataset.noZoom === '1') return
      // 封面 / 卡片这类点击会跳转的不拦截；只处理详情页内的图片
      if (target.closest(CLICKABLE_SCOPE)) return
      if (!target.closest(DETAIL_IMAGE_SCOPE)) return
      const url = target.currentSrc || target.src
      if (!url) return
      event.preventDefault()
      show(url, collectGallery(target, url))
    }
    const onZoomEvent = (event: Event): void => {
      const detail = (event as CustomEvent<{ src: string; gallery?: string[] }>).detail
      if (detail && typeof detail.src === 'string' && detail.src) {
        show(detail.src, detail.gallery)
      }
    }
    document.addEventListener('click', onClick, true)
    window.addEventListener('lz:image-zoom', onZoomEvent as EventListener)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('lz:image-zoom', onZoomEvent as EventListener)
    }
  }, [show])

  // 键盘：Esc 关闭，左右切换
  useEffect(() => {
    if (!src) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
      else if (event.key === 'ArrowLeft') step(-1)
      else if (event.key === 'ArrowRight') step(1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [src, close, step])

  // 滚轮缩放（只在放大层打开时生效）
  useEffect(() => {
    const stage = stageRef.current
    if (!src || !stage) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      setScale((prev) => {
        const next = prev + (event.deltaY < 0 ? 0.2 : -0.2)
        return Math.min(5, Math.max(0.4, Number(next.toFixed(2))))
      })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [src])

  if (!src) return null

  return (
    <div className="image-viewer" onClick={close}>
      <div
        className="image-viewer-stage"
        ref={stageRef}
        onDoubleClick={(e) => {
          // 双击图片切换缩放；双击黑色遮罩仍然关闭
          if (e.target instanceof HTMLImageElement) setScale((prev) => (prev > 1 ? 1 : 2))
        }}
      >
        <img
          src={src}
          alt=""
          style={{ transform: `scale(${scale})` }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <div className="image-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <button
          title="上一张"
          disabled={gallery.length < 2}
          onClick={() => step(-1)}
        >
          <ChevronLeft size={16} /> 上一张
        </button>
        <button title="保存图片" disabled={saving} onClick={() => void save(src)}>
          <Download size={16} /> {saving ? '保存中…' : '保存'}
        </button>
        <button
          title="下一张"
          disabled={gallery.length < 2}
          onClick={() => step(1)}
        >
          下一张 <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
