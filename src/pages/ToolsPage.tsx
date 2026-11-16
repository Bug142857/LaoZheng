import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import {
  ArrowLeft,
  Bold,
  Cat,
  Check,
  CirclePlay,
  Clapperboard,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  FileCog,
  FolderSync,
  Globe,
  Heading2,
  Image,
  ImagePlus,
  Italic,
  Languages,
  List,
  ListOrdered,
  MessageCircle,
  MessageSquare,
  MonitorDown,
  MonitorSmartphone,
  Music,
  Network,
  NotebookPen,
  Pencil,
  Play,
  Quote,
  Redo2,
  RemoveFormatting,
  Rocket,
  Scissors,
  Send,
  Share2,
  Shield,
  ShieldBan,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Strikethrough,
  Underline,
  Undo2,
  Video,
  Workflow,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import { useData } from '../state/DataContext'
import { TOOL_ITEMS, type ToolItem } from '../shared/tools'

const ICONS: Record<string, LucideIcon> = {
  MonitorDown,
  Wrench,
  ShieldCheck,
  Shield,
  Globe,
  Cat,
  Languages,
  ShieldBan,
  Image,
  Sparkles,
  Send,
  MessageCircle,
  MessageSquare,
  Workflow,
  Download,
  FileArchive,
  Network,
  Rocket,
  Eye,
  NotebookPen,
  Smartphone,
  Share2,
  FolderSync,
  FileCog,
  MonitorSmartphone,
  Video,
  Clapperboard,
  Scissors,
  CirclePlay,
  Music,
  Play
}

/** 允许出现在笔记里的标签；其余标签只保留文字，脚本类标签连同内容一起丢掉 */
const ALLOWED_TAGS = new Set([
  'P',
  'DIV',
  'BR',
  'SPAN',
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'STRIKE',
  'H1',
  'H2',
  'H3',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'CODE',
  'HR',
  'IMG',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TD',
  'TH'
])

const DROP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'SVG',
  'MATH',
  'FORM',
  'INPUT',
  'TEXTAREA',
  'BUTTON',
  'SELECT',
  'VIDEO',
  'AUDIO',
  'LINK',
  'META',
  'TEMPLATE',
  'NOSCRIPT'
])

const IMAGE_SRC_PATTERN = /^(?:data:image\/(?:png|jpe?g|webp|gif);base64,|https?:\/\/)/i

/**
 * 笔记内容来自粘贴 / 手写，保存与回显前统一清洗：
 * 只留白名单标签，链接降级为文字，图片只接受位图 data URL 或 http(s) 地址。
 */
function sanitizeNote(raw: string): string {
  if (!raw) return ''
  const doc = new DOMParser().parseFromString(`<div id="lz-note-root">${raw}</div>`, 'text/html')
  const root = doc.getElementById('lz-note-root')
  if (!root) return ''
  for (const el of Array.from(root.querySelectorAll('*')).reverse()) {
    const tag = el.tagName
    if (DROP_TAGS.has(tag)) {
      el.remove()
      continue
    }
    if (!ALLOWED_TAGS.has(tag)) {
      el.replaceWith(...Array.from(el.childNodes))
      continue
    }
    for (const attr of Array.from(el.attributes)) {
      if (tag === 'IMG' && (attr.name === 'src' || attr.name === 'alt')) continue
      el.removeAttribute(attr.name)
    }
    if (tag === 'IMG') {
      const src = el.getAttribute('src') ?? ''
      if (!IMAGE_SRC_PATTERN.test(src)) el.remove()
    }
  }
  return root.innerHTML
}

function noteIsEmpty(html: string): boolean {
  if (!html) return true
  if (/<img\b/i.test(html)) return false
  return !html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim()
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * 粘贴 / 选择进来的图片先缩到 1400px 宽再转 webp，
 * 直接存 base64 进 data.json，避免几张截图就把备份撑到几十兆。
 */
async function compressImage(file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error('图片超过 20MB，请压缩后再插入')
  const dataUrl = await readAsDataUrl(file)
  const image = new window.Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('图片格式不支持'))
    image.src = dataUrl
  })
  const scale = Math.min(1, 1400 / image.naturalWidth)
  const rawOk = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(dataUrl)
  if (rawOk && scale === 1 && dataUrl.length < 600_000) return dataUrl
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return rawOk ? dataUrl : ''
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  const webp = canvas.toDataURL('image/webp', 0.86)
  if (webp.startsWith('data:image/webp')) return webp
  return canvas.toDataURL('image/jpeg', 0.86)
}

function ToolBarButton({
  title,
  onClick,
  children
}: {
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="note-tool"
      title={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/**
 * 富文本笔记编辑器：contentEditable + execCommand，
 * 支持加粗 / 标题 / 列表、粘贴图文（图片自动压缩）、撤销重做与 Ctrl+S 保存。
 */
function NoteEditor({
  initialHtml,
  placeholder,
  onChange,
  onSave,
  onNotice
}: {
  initialHtml: string
  placeholder: string
  onChange: (html: string) => void
  onSave: (html: string, notify: boolean) => void
  onNotice: (text: string) => void
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const savedRange = useRef<Range | null>(null)
  const [empty, setEmpty] = useState(() => noteIsEmpty(sanitizeNote(initialHtml)))

  useLayoutEffect(() => {
    const el = editorRef.current
    if (!el) return
    el.innerHTML = sanitizeNote(initialHtml)
    setEmpty(noteIsEmpty(el.innerHTML))
    // 只在挂载时写入；之后由浏览器自己维护光标与内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sync = () => {
    const el = editorRef.current
    if (!el) return
    setEmpty(noteIsEmpty(el.innerHTML))
    onChange(el.innerHTML)
  }

  const rememberSelection = () => {
    const el = editorRef.current
    const sel = window.getSelection()
    if (!el || !sel || sel.rangeCount === 0) {
      savedRange.current = null
      return
    }
    const range = sel.getRangeAt(0)
    savedRange.current = el.contains(range.commonAncestorContainer) ? range.cloneRange() : null
  }

  const restoreSelection = () => {
    const el = editorRef.current
    if (!el) return
    el.focus()
    const range = savedRange.current
    if (!range) return
    const sel = window.getSelection()
    if (!sel) return
    try {
      sel.removeAllRanges()
      sel.addRange(range)
    } catch {
      // 选中的节点已被删除时忽略，直接在末尾输入
    }
  }

  const run = (command: string, value?: string) => {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
    rememberSelection()
    sync()
  }

  const insertFiles = async (files: File[]) => {
    for (const file of files) {
      try {
        const url = await compressImage(file)
        if (!url) throw new Error('图片格式不支持')
        restoreSelection()
        document.execCommand('insertHTML', false, `<img src="${url}">`)
        sync()
      } catch (err) {
        onNotice((err as Error).message || '插入图片失败')
      }
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file)
    if (files.length) {
      event.preventDefault()
      rememberSelection()
      void insertFiles(files)
      return
    }
    const html = event.clipboardData.getData('text/html')
    if (html) {
      event.preventDefault()
      document.execCommand('insertHTML', false, sanitizeNote(html))
      sync()
    }
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      onSave(editorRef.current?.innerHTML ?? '', true)
    }
  }

  return (
    <div className="note-editor-wrap">
      <div className="note-toolbar">
        <ToolBarButton title="加粗" onClick={() => run('bold')}>
          <Bold size={15} />
        </ToolBarButton>
        <ToolBarButton title="斜体" onClick={() => run('italic')}>
          <Italic size={15} />
        </ToolBarButton>
        <ToolBarButton title="下划线" onClick={() => run('underline')}>
          <Underline size={15} />
        </ToolBarButton>
        <ToolBarButton title="删除线" onClick={() => run('strikeThrough')}>
          <Strikethrough size={15} />
        </ToolBarButton>
        <span className="note-toolbar-sep" />
        <ToolBarButton title="小标题" onClick={() => run('formatBlock', 'h2')}>
          <Heading2 size={15} />
        </ToolBarButton>
        <ToolBarButton title="引用" onClick={() => run('formatBlock', 'blockquote')}>
          <Quote size={15} />
        </ToolBarButton>
        <ToolBarButton title="无序列表" onClick={() => run('insertUnorderedList')}>
          <List size={15} />
        </ToolBarButton>
        <ToolBarButton title="有序列表" onClick={() => run('insertOrderedList')}>
          <ListOrdered size={15} />
        </ToolBarButton>
        <span className="note-toolbar-sep" />
        <ToolBarButton
          title="插入图片（也可以直接粘贴截图）"
          onClick={() => {
            rememberSelection()
            fileRef.current?.click()
          }}
        >
          <ImagePlus size={15} />
        </ToolBarButton>
        <ToolBarButton title="清除格式" onClick={() => run('removeFormat')}>
          <RemoveFormatting size={15} />
        </ToolBarButton>
        <span className="note-toolbar-sep" />
        <ToolBarButton title="撤销" onClick={() => run('undo')}>
          <Undo2 size={15} />
        </ToolBarButton>
        <ToolBarButton title="重做" onClick={() => run('redo')}>
          <Redo2 size={15} />
        </ToolBarButton>
        <span className="note-toolbar-spacer" />
        <button
          type="button"
          className="btn primary note-save"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSave(editorRef.current?.innerHTML ?? '', true)}
        >
          <Check size={15} />
          保存笔记
        </button>
      </div>
      <div
        ref={editorRef}
        className={`note-editor note-content${empty ? ' is-empty' : ''}`}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder={placeholder}
        onInput={sync}
        onBlur={() => {
          rememberSelection()
          onSave(editorRef.current?.innerHTML ?? '', false)
        }}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="note-file-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void insertFiles(files)
        }}
      />
    </div>
  )
}

export function ToolsPage({
  onNotice,
  resetSignal
}: {
  onNotice: (text: string) => void
  resetSignal?: number
}) {
  const { data, update } = useData()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const activeRef = useRef<string | null>(null)
  const draftRef = useRef('')
  /** 停止输入 1.2s 后自动落盘，避免忘点保存或直接关窗丢内容 */
  const autoSaveTimer = useRef<number | null>(null)
  /** 最近一次真正写进 data 的内容，避免 blur / 切换工具时重复保存 */
  const persistedRef = useRef<Record<string, string>>({})
  const notesRef = useRef<Record<string, string>>(data.toolNotes ?? {})
  notesRef.current = data.toolNotes ?? {}

  const activeTool = useMemo(
    () => TOOL_ITEMS.find((tool) => tool.id === activeId) ?? null,
    [activeId]
  )

  const persist = (tool: ToolItem, html: string, notify: boolean) => {
    const cleaned = sanitizeNote(html)
    const clean = noteIsEmpty(cleaned) ? '' : cleaned
    if ((persistedRef.current[tool.id] ?? '') === clean) {
      if (notify) onNotice(`「${tool.name}」的笔记已是最新`)
      return
    }
    persistedRef.current[tool.id] = clean
    update((current) => {
      const next = { ...(current.toolNotes ?? {}) }
      if (clean) next[tool.id] = clean
      else delete next[tool.id]
      return { ...current, toolNotes: next }
    })
    if (notify) onNotice(`已保存「${tool.name}」的使用经验`)
  }

  const persistActive = (notify: boolean) => {
    if (!activeRef.current) return
    const tool = TOOL_ITEMS.find((entry) => entry.id === activeRef.current)
    if (tool) persist(tool, draftRef.current, notify)
  }

  const clearAutoSave = () => {
    if (autoSaveTimer.current != null) {
      window.clearTimeout(autoSaveTimer.current)
      autoSaveTimer.current = null
    }
  }

  const scheduleAutoSave = () => {
    clearAutoSave()
    const toolId = activeRef.current
    if (!toolId) return
    const html = draftRef.current
    autoSaveTimer.current = window.setTimeout(() => {
      autoSaveTimer.current = null
      const tool = TOOL_ITEMS.find((entry) => entry.id === toolId)
      if (tool) persist(tool, html, false)
    }, 1200)
  }

  const openTool = (tool: ToolItem) => {
    clearAutoSave()
    persistActive(false)
    const stored = sanitizeNote(notesRef.current[tool.id] ?? '')
    persistedRef.current[tool.id] = noteIsEmpty(stored) ? '' : stored
    draftRef.current = stored
    activeRef.current = tool.id
    setEditing(false)
    setActiveId(tool.id)
  }

  const closeTool = () => {
    clearAutoSave()
    persistActive(false)
    activeRef.current = null
    setActiveId(null)
    setEditing(false)
  }

  const openSite = (tool: ToolItem) => {
    window.laozheng
      .openExternal(tool.url)
      .catch(() => onNotice(`打开「${tool.name}」官网失败，请稍后再试`))
  }

  // 点侧栏「软件」重新进入模块：回到软件列表，未保存的笔记先落盘
  useEffect(() => {
    clearAutoSave()
    if (!activeRef.current) return
    persistActive(false)
    activeRef.current = null
    setActiveId(null)
    setEditing(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal])

  // 页面被标题刷新 / 数据恢复卸载时清掉待执行的自动保存
  useEffect(() => clearAutoSave, [])

  if (activeTool) {
    const Icon = ICONS[activeTool.icon] ?? Wrench
    const noteHtml = sanitizeNote(notesRef.current[activeTool.id] ?? '')
    const noteEmpty = noteIsEmpty(noteHtml)
    return (
      <>
        <header className="page-header">
          <button className="icon-btn tool-back" title="返回软件列表" onClick={closeTool}>
            <ArrowLeft size={18} />
          </button>
          <h1 className="page-title">{activeTool.name}</h1>
          <div className="page-actions">
            <button className="btn primary" onClick={() => openSite(activeTool)}>
              <ExternalLink size={15} />
              打开官网下载
            </button>
          </div>
        </header>

        <section className="tool-detail">
          <div className="tool-detail-head">
            <span className="tool-icon tool-icon-lg">
              <Icon size={26} strokeWidth={1.8} />
            </span>
            <div className="tool-detail-info">
              <div className="tool-detail-name">{activeTool.name}</div>
              <div className="tool-detail-url">{activeTool.url}</div>
            </div>
          </div>
          <p className="tool-detail-desc">{activeTool.desc}</p>
        </section>

        <section className="tool-note">
          <div className="tool-note-head">
            <h2>使用经验</h2>
            {editing ? null : (
              <button className="btn tool-note-edit" onClick={() => setEditing(true)}>
                <Pencil size={14} />
                {noteEmpty ? '写经验' : '编辑'}
              </button>
            )}
          </div>
          {editing ? (
            <NoteEditor
              key={activeTool.id}
              initialHtml={notesRef.current[activeTool.id] ?? ''}
              placeholder={`记录「${activeTool.name}」的使用经验…\n可以直接粘贴文字或截图，Ctrl+S 保存。`}
              onChange={(html) => {
                draftRef.current = html
                scheduleAutoSave()
              }}
              onSave={(html, notify) => {
                clearAutoSave()
                if (!activeRef.current) return
                const tool = TOOL_ITEMS.find((entry) => entry.id === activeRef.current)
                if (tool) persist(tool, html, notify)
                if (notify) setEditing(false)
              }}
              onNotice={onNotice}
            />
          ) : noteEmpty ? (
            <div className="tool-note-empty">还没有记录使用经验。</div>
          ) : (
            <div
              className="tool-note-view note-content"
              dangerouslySetInnerHTML={{ __html: noteHtml }}
            />
          )}
        </section>
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">软件</h1>
      </header>

      <div className="tools-grid">
        {TOOL_ITEMS.map((tool) => {
          const Icon = ICONS[tool.icon] ?? Wrench
          return (
            <div key={tool.id} className="tool-card">
              <button className="tool-card-main" title={tool.desc} onClick={() => openTool(tool)}>
                <span className="tool-icon">
                  <Icon size={22} strokeWidth={1.8} />
                </span>
                <span className="tool-card-text">
                  <span className="tool-card-name">{tool.name}</span>
                  <span className="tool-card-category">{tool.category}</span>
                </span>
              </button>
              <button
                className="tool-card-link"
                title="打开官网下载"
                aria-label={`打开 ${tool.name} 官网`}
                onClick={() => openSite(tool)}
              >
                <ExternalLink size={15} />
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
