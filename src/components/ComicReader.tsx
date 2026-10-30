import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Grid2X2, Images, RotateCcw, Rows3, ZoomIn, ZoomOut } from 'lucide-react'
import { openImageZoom } from './ImageViewer'

export type ReaderMode = 'vertical' | 'horizontal' | 'grid'

const MODE_OPTIONS: { key: ReaderMode; label: string; icon: typeof Rows3 }[] = [
  { key: 'vertical', label: '上下滑动', icon: Rows3 },
  { key: 'horizontal', label: '左右翻页', icon: Images },
  { key: 'grid', label: '网格浏览', icon: Grid2X2 }
]

/** 漫画 / 本子阅读器：默认上下滑动，另有左右翻页（滚轮缩放）与网格总览 */
export function ComicReader({ images }: { images: string[] }) {
  const [mode, setMode] = useState<ReaderMode>('vertical')
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState(1)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setPage(0)
    setZoom(1)
  }, [images])

  useEffect(() => {
    if (mode !== 'horizontal') return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowLeft') setPage((prev) => Math.max(0, prev - 1))
      if (event.key === 'ArrowRight') setPage((prev) => Math.min(images.length - 1, prev + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, images.length])

  // 横向模式滚轮缩放（需要非 passive 才能阻止页面滚动）
  useEffect(() => {
    const el = scrollRef.current
    if (!el || mode !== 'horizontal') return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      setZoom((prev) => {
        const next = prev + (event.deltaY < 0 ? 0.15 : -0.15)
        return Math.min(4, Math.max(0.5, Number(next.toFixed(2))))
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [mode])

  return (
    <div className="comic-reader">
      <div className="reader-mode-bar">
        <div className="view-toggle">
          {MODE_OPTIONS.map((option) => {
            const Icon = option.icon
            return (
              <button
                key={option.key}
                className={`icon-btn ${mode === option.key ? 'active' : ''}`}
                title={option.label}
                onClick={() => {
                  setMode(option.key)
                  setZoom(1)
                }}
              >
                <Icon size={15} />
              </button>
            )
          })}
        </div>
        <span className="page-desc">{MODE_OPTIONS.find((m) => m.key === mode)?.label}</span>
        {mode === 'horizontal' ? (
          <div className="reader-zoom">
            <button className="icon-btn" title="缩小" onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.15).toFixed(2))))}>
              <ZoomOut size={15} />
            </button>
            <span className="page-desc">{Math.round(zoom * 100)}%</span>
            <button className="icon-btn" title="放大" onClick={() => setZoom((z) => Math.min(4, Number((z + 0.15).toFixed(2))))}>
              <ZoomIn size={15} />
            </button>
            <button className="icon-btn" title="还原" onClick={() => setZoom(1)}>
              <RotateCcw size={15} />
            </button>
          </div>
        ) : null}
      </div>

      {mode === 'vertical' ? (
        <div className="reader">
          {images.map((url, index) => (
            <img key={`${url}-${index}`} src={url} alt={`第 ${index + 1} 页`} loading="lazy" />
          ))}
        </div>
      ) : mode === 'horizontal' ? (
        <div className="reader-horizontal" ref={scrollRef}>
          <div className="reader-h-page">
            <img
              src={images[page]}
              alt={`第 ${page + 1} 页`}
              style={{ width: `${zoom * 100}%`, maxWidth: 'none' }}
            />
          </div>
          <button
            className="reader-h-nav prev"
            disabled={page <= 0}
            onClick={() => setPage((prev) => Math.max(0, prev - 1))}
            title="上一页"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            className="reader-h-nav next"
            disabled={page >= images.length - 1}
            onClick={() => setPage((prev) => Math.min(images.length - 1, prev + 1))}
            title="下一页"
          >
            <ChevronRight size={20} />
          </button>
          <div className="reader-h-counter">
            {page + 1} / {images.length}
          </div>
        </div>
      ) : (
        <div className="reader-grid">
          {images.map((url, index) => (
            <button
              key={`${url}-${index}`}
              className="reader-grid-item"
              title="双击/点击放大"
              onClick={() => openImageZoom(url, images)}
            >
              <img src={url} alt={`第 ${index + 1} 页`} loading="lazy" />
              <span>{index + 1}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
