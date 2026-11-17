import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload
} from 'lucide-react'
import { useData } from '../state/DataContext'
import { ConfirmDialog, EmptyState, Modal } from '../components/ui'
import {
  genSourceId,
  normalizeBaseUrl,
  parseSourceImport,
  vodHost,
  type VodSourceImport,
  type VodSourceInput
} from '../shared/vod'
import { DEFAULT_VOD_SOURCES } from '../shared/vodDefaults'
import {
  DEFAULT_LIVE_PLATFORM_SOURCES,
  livePlatformOfSource,
  type LivePlatformSource
} from '../shared/livePlatformSources'
import {
  ROU07_DRAMA_BASE_URL,
  ROU07_DRAMA_SOURCE_ID,
  XIFAN_DRAMA_BASE_URL,
  XIFAN_DRAMA_SOURCE_ID,
  type DramaSource,
  type DramaSourceInput
} from '../shared/drama'
import type { LiveSource } from '../shared/live'
import type { MagnetSource } from '../shared/magnet'
import {
  TRAINER_SOURCE_TYPE_LABEL,
  inferTrainerSourceType,
  type TrainerSource,
  type TrainerSourceType
} from '../shared/trainers'
import {
  DEFAULT_MUSIC_BACKUP,
  MUSIC_SOURCE_LINES,
  musicLineName,
  type MusicLxPlatform,
  type MusicSource,
  type MusicSourceBackup,
  type MusicSourceLine
} from '../shared/music'
import {
  NOVEL_SOURCE_TEMPLATE_LABEL,
  NOVEL_SOURCE_TEMPLATE_OPTIONS,
  type NovelSource,
  type NovelSourceInput,
  type NovelSourceTemplate
} from '../shared/novel'
import {
  inferComicTemplate,
  type ComicMirrorOption,
  type ComicSource,
  type ComicSourceInput,
  type ComicSourceTemplate
} from '../shared/comicSources'
import type { AllSourcesBundle, VodSource } from '../shared/types'
import { clearModuleCaches } from '../utils/cache'
import {
  WALLPAPER_SOURCE_TEMPLATES,
  inferWallpaperTemplate,
  isWallpaperTemplate,
  toWallpaperSourceRef,
  wallpaperTemplateLabel,
  type WallpaperSource,
  type WallpaperSourceInput,
  type WallpaperSourceTemplate
} from '../shared/wallpaper'
import {
  SK_ADAPTER_LABEL,
  SK_DEFAULT_BASE,
  inferSkAdapter,
  isSkAdapter,
  toShuangkanSourceRef,
  type SkAdapter,
  type SkMirrorOption,
  type ShuangkanSource
} from '../shared/shuangkan'
import {
  MEITU_SOURCE_TEMPLATES,
  inferMeituTemplate,
  isMeituTemplate,
  meituTemplateLabel,
  toMeituSourceRef,
  type MeituSource,
  type MeituSourceInput,
  type MeituSourceTemplate
} from '../shared/meitu'
import { MagnetSettings } from './MagnetSettings'

function toInput(source: VodSource): VodSourceInput {
  return { id: source.id, name: source.name, baseUrl: source.baseUrl }
}

function toDramaInput(source: DramaSource): DramaSourceInput {
  return {
    id: source.id,
    name: source.name,
    ...(source.baseUrl ? { baseUrl: source.baseUrl } : {})
  }
}

function newDramaSourceId(baseUrl: string, taken: { id: string }[]): string {
  const baseId = `drama_${genSourceId(baseUrl)}`
  let id = baseId
  let n = 2
  while (taken.some((s) => s.id === id)) id = `${baseId}_${n++}`
  return id
}

function newShuangkanSourceId(baseUrl: string, taken: { id: string }[]): string {
  const baseId = `sk_${genSourceId(baseUrl)}`
  let id = baseId
  let n = 2
  while (taken.some((s) => s.id === id)) id = `${baseId}_${n++}`
  return id
}

function newNovelSourceId(baseUrl: string, taken: { id: string }[]): string {
  const baseId = `novel_${genSourceId(baseUrl)}`
  let id = baseId
  let n = 2
  while (taken.some((s) => s.id === id)) id = `${baseId}_${n++}`
  return id
}

function newComicSourceId(baseUrl: string, taken: { id: string }[]): string {
  const baseId = `comic_${genSourceId(baseUrl)}`
  let id = baseId
  let n = 2
  while (taken.some((s) => s.id === id)) id = `${baseId}_${n++}`
  return id
}

function toComicInput(source: ComicSource): ComicSourceInput {
  return {
    id: source.id,
    name: source.name,
    baseUrl: source.baseUrl,
    template: source.template
  }
}

/** 批量导入小说源时按地址猜解析模板，猜不到按蚂蚁文学处理 */
function inferNovelTemplate(baseUrl: string): NovelSourceTemplate {
  if (/bikahub\.net|bikago\.net|mlaridyo\.cc|dojqybrcm\.com/i.test(baseUrl)) return 'bikahub'
  if (/95dushu|jwdushu/i.test(baseUrl)) return '95dushu'
  if (/xuanhuange/i.test(baseUrl)) return 'xuanhuange'
  if (/5wa\.net|qishu/i.test(baseUrl)) return 'qishu5wa'
  if (/xyuzhaiwu/i.test(baseUrl)) return 'xyuzhaiwu'
  if (/xhytd/i.test(baseUrl)) return 'xhytd'
  if (/ajnnan/i.test(baseUrl)) return 'ajnnan'
  if (/bqquge/i.test(baseUrl)) return 'bqquge'
  if (/zuizhong/i.test(baseUrl)) return 'zuizhong'
  if (/banshanren/i.test(baseUrl)) return 'banshanren'
  if (/bqg70\./i.test(baseUrl)) return 'bqg70'
  if (/52bqg|bqg52/i.test(baseUrl)) return 'bqg52'
  if (/biqugeco/i.test(baseUrl)) return 'biqugeco'
  return 'mayi'
}

function toNovelInput(source: NovelSource): NovelSourceInput {
  return {
    id: source.id,
    name: source.name,
    baseUrl: source.baseUrl,
    template: source.template
  }
}

function newLiveSourceId(url: string): string {
  let h = 0
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0
  return `live_${Math.abs(h)}`
}

function sourceSummary(total: number, enabled: number, ok: number, bad: number): string {
  return `共 ${total} 个 · 启用 ${enabled} · 有效 ${ok} · 无效 ${bad}`
}

/** 测试结果后追加真实访问延迟（ms）；测不到延迟时只显示测试结果，不写「超时」误导 */
function withMs(message: string, ms: number | null | undefined): string {
  return ms != null ? `${message} · ${Math.max(1, Math.round(ms))}ms` : message
}

/** 旧版本写进数据的「· 超时」在展示时去掉，避免测试成功却显示超时 */
function testMsgText(message?: string | null): string {
  return (message ?? '未测试').replace(/\s*·\s*超时\s*$/, '')
}

function probeLatency(url?: string | null): Promise<number | null | undefined> {
  if (!url || !/^https?:\/\//i.test(url)) return Promise.resolve(undefined)
  return window.laozheng.probeSourceLatency(url).catch(() => null)
}

/** 从测试文案末尾解析延迟（123ms）；没有测速结果返回 null */
function sourceMs(source: { testMsg?: string | null }): number | null {
  const matched = /·\s*(\d+)ms\s*$/.exec(source.testMsg ?? '')
  return matched ? Number(matched[1]) : null
}

/** 0 = 有效（ok），1 = 未测试，2 = 无效；优选排序时无效源统一放最后 */
function sourceGroup(source: { testStatus?: string | null }): number {
  if (source.testStatus === 'ok') return 0
  if (
    source.testStatus === 'bad' ||
    source.testStatus === 'failed' ||
    source.testStatus === 'dead'
  ) {
    return 2
  }
  return 1
}

/** 有效的源按测速延迟升序；未测试 / 无效的源保持原相对顺序排后面 */
function byPreferredOrder<T extends { testMsg?: string | null; testStatus?: string | null }>(
  list: T[]
): T[] {
  return [...list].sort((a, b) => {
    const group = sourceGroup(a) - sourceGroup(b)
    if (group !== 0) return group
    if (sourceGroup(a) !== 0) return 0
    return (sourceMs(a) ?? Number.MAX_SAFE_INTEGER) - (sourceMs(b) ?? Number.MAX_SAFE_INTEGER)
  })
}

function PreferredSortButton({ disabled, onSort }: { disabled?: boolean; onSort: () => void }) {
  return (
    <button
      className="btn"
      disabled={disabled}
      onClick={onSort}
      title="有效的源按测速延迟从快到慢排列，无效的排后面；对应模块的源下拉同步生效"
    >
      <ArrowUpDown size={15} /> 优选排序
    </button>
  )
}

interface MirrorLatencyEntry {
  at: number
  mirrors: { url: string; ms: number | null }[]
}

/** 优选地址延迟缓存：测过一次后重开弹窗直接显示上次的 ms，不再自动测速 */
const MIRROR_LATENCY_KEY = 'lz_mirror_latency_v1'

function readMirrorLatency(key: string): MirrorLatencyEntry | null {
  try {
    const raw = localStorage.getItem(MIRROR_LATENCY_KEY)
    if (!raw) return null
    const all = JSON.parse(raw) as Record<string, MirrorLatencyEntry>
    const entry = all[key]
    return entry && Array.isArray(entry.mirrors) && entry.mirrors.length ? entry : null
  } catch {
    return null
  }
}

function writeMirrorLatency(key: string, mirrors: { url: string; ms: number | null }[]): void {
  try {
    const raw = localStorage.getItem(MIRROR_LATENCY_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, MirrorLatencyEntry>) : {}
    all[key] = { at: Date.now(), mirrors }
    localStorage.setItem(MIRROR_LATENCY_KEY, JSON.stringify(all))
  } catch {
    // 缓存失败不影响选择
  }
}

/** 可折叠的源配置卡片：标题右侧统一显示 共 / 启用 / 有效 / 无效 */
function SourceCard({
  title,
  summary,
  open,
  onToggle,
  children
}: {
  title: string
  summary: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className="settings-card">
      <button
        type="button"
        className="settings-card-toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        <h3>{title}</h3>
        <span className="settings-value">{summary}</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open ? <div style={{ marginTop: 10 }}>{children}</div> : null}
    </section>
  )
}

/**
 * 片源管理（配置管理 → 片源管理）：
 * 影视源、电视源、短剧源、磁力源统一在这里维护，模块页只负责播放。
 * 四张卡片默认全部折叠，标题右侧显示数量统计。
 */
export function SourceSettings({ onNotice }: { onNotice: (text: string) => void }) {
  const { data, update } = useData()
  const sources = data.vodSources

  const [vodOpen, setVodOpen] = useState(false)
  const [liveOpen, setLiveOpen] = useState(false)
  const [dramaOpen, setDramaOpen] = useState(false)
  const [wallpaperOpen, setWallpaperOpen] = useState(false)
  const [editingWallpaper, setEditingWallpaper] = useState<WallpaperSource | 'new' | null>(null)
  const [importingWallpaper, setImportingWallpaper] = useState(false)
  const [deletingWallpaper, setDeletingWallpaper] = useState<WallpaperSource | null>(null)
  const [testingWallpaperId, setTestingWallpaperId] = useState<string | null>(null)
  const [testingWallpaperAll, setTestingWallpaperAll] = useState(false)
  const [meituOpen, setMeituOpen] = useState(false)
  const [editingMeitu, setEditingMeitu] = useState<MeituSource | 'new' | null>(null)
  const [importingMeitu, setImportingMeitu] = useState(false)
  const [deletingMeitu, setDeletingMeitu] = useState<MeituSource | null>(null)
  const [testingMeituId, setTestingMeituId] = useState<string | null>(null)
  const [testingMeituAll, setTestingMeituAll] = useState(false)
  const [shuangkanOpen, setShuangkanOpen] = useState(false)
  const [editingShuangkan, setEditingShuangkan] = useState<ShuangkanSource | 'new' | null>(
    null
  )
  const [importingShuangkan, setImportingShuangkan] = useState(false)
  const [deletingShuangkan, setDeletingShuangkan] = useState<ShuangkanSource | null>(null)
  const [testingShuangkanId, setTestingShuangkanId] = useState<string | null>(null)
  const [testingShuangkanAll, setTestingShuangkanAll] = useState(false)

  const [editing, setEditing] = useState<VodSource | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState<VodSource | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testingAll, setTestingAll] = useState(false)

  const [liveSources, setLiveSources] = useState<LiveSource[] | null>(null)
  const liveRef = useRef<LiveSource[] | null>(null)
  const [addingLive, setAddingLive] = useState(false)
  const [editingLive, setEditingLive] = useState<LiveSource | null>(null)
  const [deletingLive, setDeletingLive] = useState<LiveSource | null>(null)
  const [testingLiveId, setTestingLiveId] = useState<string | null>(null)
  const [testingLiveAll, setTestingLiveAll] = useState(false)

  const [editingDrama, setEditingDrama] = useState<DramaSource | 'new' | null>(null)
  const [importingDrama, setImportingDrama] = useState(false)
  const [deletingDrama, setDeletingDrama] = useState<DramaSource | null>(null)
  const [testingDramaId, setTestingDramaId] = useState<string | null>(null)
  const [testingDramaAll, setTestingDramaAll] = useState(false)

  const [novelOpen, setNovelOpen] = useState(false)
  const [editingNovel, setEditingNovel] = useState<NovelSource | 'new' | null>(null)
  const [importingNovel, setImportingNovel] = useState(false)
  const [deletingNovel, setDeletingNovel] = useState<NovelSource | null>(null)
  const [testingNovelId, setTestingNovelId] = useState<string | null>(null)
  const [testingNovelAll, setTestingNovelAll] = useState(false)

  const [comicOpen, setComicOpen] = useState(false)
  const [editingComic, setEditingComic] = useState<ComicSource | 'new' | null>(null)
  const [importingComic, setImportingComic] = useState(false)
  const [deletingComic, setDeletingComic] = useState<ComicSource | null>(null)
  const [testingComicId, setTestingComicId] = useState<string | null>(null)
  const [testingComicAll, setTestingComicAll] = useState(false)

  const [livePlatformOpen, setLivePlatformOpen] = useState(false)
  const [editingLivePlatform, setEditingLivePlatform] = useState<LivePlatformSource | 'new' | null>(
    null
  )
  const [importingLivePlatform, setImportingLivePlatform] = useState(false)
  const [deletingLivePlatform, setDeletingLivePlatform] = useState<LivePlatformSource | null>(null)
  const [testingLivePlatformId, setTestingLivePlatformId] = useState<string | null>(null)
  const [testingLivePlatformAll, setTestingLivePlatformAll] = useState(false)

  const [trainerOpen, setTrainerOpen] = useState(false)
  const [editingTrainer, setEditingTrainer] = useState<TrainerSource | 'new' | null>(null)
  const [importingTrainer, setImportingTrainer] = useState(false)
  const [deletingTrainer, setDeletingTrainer] = useState<TrainerSource | null>(null)
  const [testingTrainerId, setTestingTrainerId] = useState<string | null>(null)
  const [testingTrainerAll, setTestingTrainerAll] = useState(false)

  const [musicOpen, setMusicOpen] = useState(false)
  const [editingMusic, setEditingMusic] = useState<MusicSource | 'new' | null>(null)
  const [importingMusic, setImportingMusic] = useState(false)
  const [deletingMusic, setDeletingMusic] = useState<MusicSource | null>(null)
  const [testingMusicId, setTestingMusicId] = useState<string | null>(null)
  const [testingMusicBackupId, setTestingMusicBackupId] = useState<string | null>(null)
  const [testingMusicAll, setTestingMusicAll] = useState(false)
  /** 全部源导入后让磁力源卡片重新读取主进程配置 */
  const [magnetKey, setMagnetKey] = useState(0)

  useEffect(() => {
    let alive = true
    window.laozheng.loadLiveSources().then((list) => {
      if (!alive) return
      liveRef.current = list
      setLiveSources(list)
    })
    return () => {
      alive = false
    }
  }, [])

  const saveSource = (input: VodSourceInput) => {
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    if (editing === 'new') {
      if (sources.some((s) => s.baseUrl === baseUrl)) {
        onNotice('该片源地址已经存在')
        return
      }
      update((d) => {
        // genSourceId 是 URL 哈希：极端情况下会撞 id，这里补后缀保证唯一
        const baseId = input.id || genSourceId(baseUrl)
        let id = baseId
        let n = 2
        while (d.vodSources.some((s) => s.id === id)) id = `${baseId}_${n++}`
        return {
          ...d,
          vodSources: [
            ...d.vodSources,
            {
              id,
              name: input.name,
              baseUrl,
              enabled: true,
              region: 'cn',
              regionManual: false,
              testStatus: 'ok',
              testMsg: '可用',
              testAt: Date.now()
            }
          ]
        }
      })
      onNotice(`已添加片源「${input.name}」`)
    } else if (editing) {
      const current = editing
      if (sources.some((s) => s.id !== current.id && s.baseUrl === baseUrl)) {
        onNotice('该接口地址已被其他片源使用')
        return
      }
      const urlChanged = baseUrl !== current.baseUrl
      update((d) => ({
        ...d,
        vodSources: d.vodSources.map((s) =>
          s.id === current.id
            ? {
                ...s,
                name: input.name,
                baseUrl,
                // 接口地址变了，旧的测试结果不再可信
                ...(urlChanged ? { testStatus: null, testMsg: null, testAt: 0 } : {})
              }
            : s
        )
      }))
      onNotice(`已保存「${input.name}」`)
    }
    setEditing(null)
  }

  const importSources = (inputs: VodSourceInput[]) => {
    const existing = new Set(sources.map((s) => s.baseUrl))
    const fresh = inputs.filter((i) => !existing.has(i.baseUrl))
    if (!fresh.length) {
      onNotice('这些片源已存在')
      setImporting(false)
      return
    }
    update((d) => {
      const exists = new Set(d.vodSources.map((s) => s.baseUrl))
      const added: VodSource[] = []
      for (const input of fresh) {
        if (exists.has(input.baseUrl)) continue
        exists.add(input.baseUrl)
        let id = input.id || genSourceId(input.baseUrl)
        let n = 2
        while (d.vodSources.some((s) => s.id === id) || added.some((s) => s.id === id)) {
          id = `${input.id}_${n++}`
        }
        added.push({
          id,
          name: input.name || vodHost(input.baseUrl),
          baseUrl: normalizeBaseUrl(input.baseUrl),
          enabled: true,
          region: 'cn',
          regionManual: false,
          testStatus: 'ok',
          testMsg: '可用',
          testAt: Date.now()
        })
      }
      return { ...d, vodSources: [...d.vodSources, ...added] }
    })
    onNotice(`已导入 ${fresh.length} 个片源`)
    setImporting(false)
  }

  const testSource = async (source: VodSource) => {
    setTestingId(source.id)
    const latency = probeLatency(source.baseUrl)
    const res = await window.laozheng.testVodSource(toInput(source))
    const message = withMs(res.message, await latency)
    update((d) => ({
      ...d,
      vodSources: d.vodSources.map((s) =>
        s.id === source.id
          ? {
              ...s,
              testStatus: res.status,
              testMsg: message,
              testAt: res.testAt,
              region: s.regionManual ? s.region : res.region
            }
          : s
      )
    }))
    setTestingId(null)
    onNotice(`${source.name}：${message}`)
  }

  const testAllSources = async () => {
    if (testingAll || sources.length === 0) return
    setTestingAll(true)
    const queue = [...sources]
    let ok = 0
    let bad = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const source = queue.shift()
        if (!source) return
        setTestingId(source.id)
        const latency = probeLatency(source.baseUrl)
        const res = await window.laozheng.testVodSource(toInput(source))
        if (res.status === 'ok') ok += 1
        else bad += 1
        const message = withMs(res.message, await latency)
        update((d) => ({
          ...d,
          vodSources: d.vodSources.map((s) =>
            s.id === source.id
              ? {
                  ...s,
                  testStatus: res.status,
                  testMsg: message,
                  testAt: res.testAt,
                  region: s.regionManual ? s.region : res.region
                }
              : s
          )
        }))
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker))
    setTestingId(null)
    setTestingAll(false)
    onNotice(`整体测试完成：有效 ${ok} 个 · 无效 ${bad} 个`)
  }

  const exportSources = async () => {
    const res = await window.laozheng.exportVodSources(
      sources.map((s) => ({ name: s.name, baseUrl: s.baseUrl, enabled: s.enabled }))
    )
    if (res.canceled) return
    if (res.error) {
      onNotice(`导出失败：${res.error}`)
      return
    }
    onNotice(`已导出 ${res.count ?? 0} 个影视源到 ${res.path}`)
  }

  const removeSource = () => {
    if (!deleting) return
    update((d) => ({ ...d, vodSources: d.vodSources.filter((s) => s.id !== deleting.id) }))
    onNotice(`已删除片源「${deleting.name}」`)
    setDeleting(null)
  }

  // ---------- 短剧源（内置西饭 + 苹果CMS） ----------

  const saveDramaSource = (input: VodSourceInput) => {
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    if (editingDrama === 'new') {
      if (data.dramaSources.some((s) => s.baseUrl === baseUrl)) {
        onNotice('该短剧源地址已经存在')
        return
      }
      update((d) => ({
        ...d,
        dramaSources: [
          ...d.dramaSources,
          {
            id: newDramaSourceId(baseUrl, d.dramaSources),
            name: input.name,
            baseUrl,
            enabled: true,
            testStatus: 'ok',
            testMsg: '可用',
            testAt: Date.now()
          }
        ]
      }))
      onNotice(`已添加短剧源「${input.name}」`)
    } else if (editingDrama) {
      const current = editingDrama
      if (data.dramaSources.some((s) => s.id !== current.id && s.baseUrl === baseUrl)) {
        onNotice('该接口地址已被其他短剧源使用')
        return
      }
      const urlChanged = baseUrl !== current.baseUrl
      update((d) => ({
        ...d,
        dramaSources: d.dramaSources.map((s) =>
          s.id === current.id
            ? {
                ...s,
                name: input.name,
                baseUrl,
                ...(urlChanged ? { testStatus: null, testMsg: null, testAt: 0 } : {})
              }
            : s
        )
      }))
      onNotice(`已保存「${input.name}」`)
    }
    setEditingDrama(null)
  }

  const importDramaSources = (inputs: VodSourceInput[]) => {
    const xifanInput = inputs.find((input) => input.id === XIFAN_DRAMA_SOURCE_ID)
    const customInputs = inputs.filter((input) => input.id !== XIFAN_DRAMA_SOURCE_ID)
    const existing = new Set(
      data.dramaSources
        .filter((source) => source.id !== XIFAN_DRAMA_SOURCE_ID)
        .map((source) => source.baseUrl)
        .filter(Boolean)
    )
    const fresh = customInputs.filter((input) => {
      const baseUrl = normalizeBaseUrl(input.baseUrl)
      return !!baseUrl && !existing.has(baseUrl)
    })
    if (!xifanInput && !fresh.length) {
      onNotice('这些短剧源已存在')
      setImportingDrama(false)
      return
    }
    update((d) => {
      const nextSources = [...d.dramaSources]
      if (xifanInput) {
        const baseUrl = normalizeBaseUrl(xifanInput.baseUrl) || XIFAN_DRAMA_BASE_URL
        const index = nextSources.findIndex((source) => source.id === XIFAN_DRAMA_SOURCE_ID)
        if (index >= 0) {
          nextSources[index] = {
            ...nextSources[index],
            name: String(xifanInput.name ?? '').trim() || nextSources[index].name,
            baseUrl
          }
        } else {
          nextSources.push({
            id: XIFAN_DRAMA_SOURCE_ID,
            name: String(xifanInput.name ?? '').trim() || '西饭短剧',
            baseUrl,
            enabled: true,
            builtin: true,
            testStatus: 'ok',
            testMsg: '可用',
            testAt: Date.now()
          })
        }
      }

      const exists = new Set(nextSources.map((s) => s.baseUrl).filter(Boolean))
      const added: DramaSource[] = []
      for (const input of fresh) {
        const baseUrl = normalizeBaseUrl(input.baseUrl)
        if (!/^https?:\/\//i.test(baseUrl) || exists.has(baseUrl)) continue
        exists.add(baseUrl)
        added.push({
          id: newDramaSourceId(baseUrl, [...nextSources, ...added]),
          name: input.name || vodHost(baseUrl),
          baseUrl,
          enabled: true,
          testStatus: 'ok',
          testMsg: '可用',
          testAt: Date.now()
        })
      }
      return { ...d, dramaSources: [...nextSources, ...added] }
    })
    onNotice(`已导入 ${fresh.length + (xifanInput ? 1 : 0)} 个短剧源`)
    setImportingDrama(false)
  }

  const testDramaSource = async (source: DramaSource): Promise<void> => {
    setTestingDramaId(source.id)
    const latency = probeLatency(source.baseUrl)
    const res = await window.laozheng.dramaCatalog(toDramaInput(source), '', 1, '')
    const status = res.ok ? 'ok' : 'failed'
    const message = withMs(
      res.ok ? `可用 · 返回 ${res.items.length} 部` : res.error ?? '不可用',
      await latency
    )
    update((d) => ({
      ...d,
      dramaSources: d.dramaSources.map((s) =>
        s.id === source.id
          ? { ...s, testStatus: status, testMsg: message, testAt: Date.now() }
          : s
      )
    }))
    setTestingDramaId(null)
    onNotice(`${source.name}：${message}`)
  }

  const testAllDrama = async (): Promise<void> => {
    if (testingDramaAll || data.dramaSources.length === 0) return
    setTestingDramaAll(true)
    const queue = [...data.dramaSources]
    let ok = 0
    let bad = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const source = queue.shift()
        if (!source) return
        setTestingDramaId(source.id)
        const latency = probeLatency(source.baseUrl)
        const res = await window.laozheng.dramaCatalog(toDramaInput(source), '', 1, '')
        const status = res.ok ? 'ok' : 'failed'
        if (res.ok) ok += 1
        else bad += 1
        const message = withMs(
          res.ok ? `可用 · 返回 ${res.items.length} 部` : res.error ?? '不可用',
          await latency
        )
        update((d) => ({
          ...d,
          dramaSources: d.dramaSources.map((s) =>
            s.id === source.id
              ? { ...s, testStatus: status, testMsg: message, testAt: Date.now() }
              : s
          )
        }))
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker))
    setTestingDramaId(null)
    setTestingDramaAll(false)
    onNotice(`短剧源测试完成：有效 ${ok} 个 · 无效 ${bad} 个`)
  }

  const exportDrama = async (): Promise<void> => {
    const rows = data.dramaSources.map((source) => ({
      id: source.id,
      name: source.name,
      baseUrl: source.baseUrl ?? XIFAN_DRAMA_BASE_URL,
      enabled: source.enabled
    }))
    if (!rows.length) {
      onNotice('还没有可导出的短剧源')
      return
    }
    const res = await window.laozheng.exportDramaSources(rows)
    if (res.canceled) return
    if (res.error) {
      onNotice(`导出失败：${res.error}`)
      return
    }
    onNotice(`已导出 ${res.count ?? 0} 个短剧源到 ${res.path}`)
  }

  const removeDramaSource = (): void => {
    if (!deletingDrama) return
    update((d) => ({
      ...d,
      dramaSources: d.dramaSources.filter((s) => s.id !== deletingDrama.id)
    }))
    onNotice(`已删除短剧源「${deletingDrama.name}」`)
    setDeletingDrama(null)
  }

  // ---------- 小说源（笔趣阁系模板） ----------

  const saveNovelSource = (input: NovelSourceInput) => {
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    if (editingNovel === 'new') {
      if (data.novelSources.some((s) => s.baseUrl === baseUrl)) {
        onNotice('该小说源地址已经存在')
        return
      }
      update((d) => ({
        ...d,
        novelSources: [
          ...d.novelSources,
          {
            id: newNovelSourceId(baseUrl, d.novelSources),
            name: input.name,
            baseUrl,
            template: input.template,
            enabled: true,
            testStatus: 'ok',
            testMsg: '可用',
            testAt: Date.now()
          }
        ]
      }))
      onNotice(`已添加小说源「${input.name}」`)
    } else if (editingNovel) {
      const current = editingNovel
      if (data.novelSources.some((s) => s.id !== current.id && s.baseUrl === baseUrl)) {
        onNotice('该地址已被其他小说源使用')
        return
      }
      const changed = baseUrl !== current.baseUrl || input.template !== current.template
      update((d) => ({
        ...d,
        novelSources: d.novelSources.map((s) =>
          s.id === current.id
            ? {
                ...s,
                name: input.name,
                baseUrl,
                template: input.template,
                ...(changed ? { testStatus: null, testMsg: null, testAt: 0 } : {})
              }
            : s
        )
      }))
      onNotice(`已保存「${input.name}」`)
    }
    setEditingNovel(null)
  }

  const importNovelSources = (inputs: VodSourceInput[]): void => {
    const existing = new Set(data.novelSources.map((s) => s.baseUrl))
    const taken = new Set(data.novelSources.map((s) => s.id))
    const fresh: NovelSource[] = []
    for (const input of inputs) {
      const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
      if (!/^https?:\/\//i.test(baseUrl) || existing.has(baseUrl)) continue
      existing.add(baseUrl)
      const baseId = newNovelSourceId(baseUrl, [...data.novelSources, ...fresh])
      let id = baseId
      let n = 2
      while (taken.has(id)) id = `${baseId}_${n++}`
      taken.add(id)
      fresh.push({
        id,
        name: input.name.trim() || vodHost(baseUrl),
        baseUrl,
        template: inferNovelTemplate(baseUrl),
        enabled: true,
        testStatus: 'ok',
        testMsg: '可用',
        testAt: Date.now()
      })
    }
    setImportingNovel(false)
    if (!fresh.length) {
      onNotice('这些小说源已存在')
      return
    }
    update((d) => ({ ...d, novelSources: [...d.novelSources, ...fresh] }))
    onNotice(`已导入 ${fresh.length} 个小说源`)
  }

  const testNovel = async (source: NovelSource): Promise<void> => {
    setTestingNovelId(source.id)
    const latency = probeLatency(source.baseUrl)
    const res = await window.laozheng.testNovelSource(toNovelInput(source))
    const status = res.ok ? 'ok' : 'bad'
    const message = withMs(res.ok ? res.message ?? '可用' : res.error ?? '不可用', await latency)
    update((d) => ({
      ...d,
      novelSources: d.novelSources.map((s) =>
        s.id === source.id ? { ...s, testStatus: status, testMsg: message, testAt: Date.now() } : s
      )
    }))
    setTestingNovelId(null)
    onNotice(`${source.name}：${message}`)
  }

  const testAllNovel = async (): Promise<void> => {
    if (testingNovelAll || data.novelSources.length === 0) return
    setTestingNovelAll(true)
    const queue = [...data.novelSources]
    let ok = 0
    let bad = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const source = queue.shift()
        if (!source) return
        setTestingNovelId(source.id)
        const latency = probeLatency(source.baseUrl)
        const res = await window.laozheng.testNovelSource(toNovelInput(source))
        const status = res.ok ? 'ok' : 'bad'
        if (res.ok) ok += 1
        else bad += 1
        const message = withMs(res.ok ? res.message ?? '可用' : res.error ?? '不可用', await latency)
        update((d) => ({
          ...d,
          novelSources: d.novelSources.map((s) =>
            s.id === source.id
              ? { ...s, testStatus: status, testMsg: message, testAt: Date.now() }
              : s
          )
        }))
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker))
    setTestingNovelId(null)
    setTestingNovelAll(false)
    onNotice(`小说源测试完成：有效 ${ok} 个 · 无效 ${bad} 个`)
  }

  const exportNovel = async (): Promise<void> => {
    const rows = data.novelSources.map((source) => ({
      id: source.id,
      name: source.name,
      baseUrl: source.baseUrl,
      template: source.template,
      enabled: source.enabled
    }))
    if (!rows.length) {
      onNotice('还没有可导出的小说源')
      return
    }
    const res = await window.laozheng.exportNovelSources(rows)
    if (res.canceled) return
    if (res.error) {
      onNotice(`导出失败：${res.error}`)
      return
    }
    onNotice(`已导出 ${res.count ?? 0} 个小说源到 ${res.path}`)
  }

  const removeNovelSource = (): void => {
    if (!deletingNovel) return
    update((d) => ({
      ...d,
      novelSources: d.novelSources.filter((s) => s.id !== deletingNovel.id)
    }))
    onNotice(`已删除小说源「${deletingNovel.name}」`)
    setDeletingNovel(null)
  }

  // ---------- 漫画源（漫画客 / Komiic / 哔咔） ----------

  const saveComicSource = (input: ComicSourceInput) => {
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
    if (editingComic === 'new') {
      if (data.comicSources.some((s) => s.baseUrl === baseUrl)) {
        onNotice('该漫画源地址已经存在')
        return
      }
      update((d) => ({
        ...d,
        comicSources: [
          ...d.comicSources,
          {
            id: newComicSourceId(baseUrl, d.comicSources),
            name: input.name.trim(),
            baseUrl,
            template: input.template,
            enabled: true,
            testStatus: 'ok',
            testMsg: '可用',
            testAt: Date.now()
          }
        ]
      }))
      onNotice(`已添加漫画源「${input.name.trim()}」`)
    } else if (editingComic) {
      const current = editingComic
      if (data.comicSources.some((s) => s.id !== current.id && s.baseUrl === baseUrl)) {
        onNotice('该地址已被其他漫画源使用')
        return
      }
      const changed = baseUrl !== current.baseUrl || input.template !== current.template
      update((d) => ({
        ...d,
        comicSources: d.comicSources.map((s) =>
          s.id === current.id
            ? {
                ...s,
                name: input.name.trim(),
                baseUrl,
                template: input.template,
                ...(changed
                  ? { testStatus: 'ok' as const, testMsg: '可用', testAt: Date.now() }
                  : {})
              }
            : s
        )
      }))
      onNotice(`已保存「${input.name.trim()}」`)
    }
    setEditingComic(null)
  }

  const importComicSources = (inputs: VodSourceInput[]): void => {
    const existing = new Set(data.comicSources.map((s) => s.baseUrl))
    const taken = new Set(data.comicSources.map((s) => s.id))
    const fresh: ComicSource[] = []
    for (const input of inputs) {
      const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
      if (!/^https?:\/\//i.test(baseUrl) || existing.has(baseUrl)) continue
      existing.add(baseUrl)
      const baseId = newComicSourceId(baseUrl, [...data.comicSources, ...fresh])
      let id = baseId
      let n = 2
      while (taken.has(id)) id = `${baseId}_${n++}`
      taken.add(id)
      fresh.push({
        id,
        name: input.name.trim() || vodHost(baseUrl),
        baseUrl,
        template: inferComicTemplate(baseUrl),
        enabled: true,
        testStatus: 'ok',
        testMsg: '可用',
        testAt: Date.now()
      })
    }
    setImportingComic(false)
    if (!fresh.length) {
      onNotice('这些漫画源已存在')
      return
    }
    update((d) => ({ ...d, comicSources: [...d.comicSources, ...fresh] }))
    onNotice(`已导入 ${fresh.length} 个漫画源`)
  }

  const testComic = async (source: ComicSource): Promise<void> => {
    setTestingComicId(source.id)
    const latency = probeLatency(source.baseUrl)
    const res = await window.laozheng.testComicSource(toComicInput(source))
    const status = res.ok ? 'ok' : 'bad'
    const message = withMs(res.ok ? res.message ?? '可用' : res.error ?? '不可用', await latency)
    update((d) => ({
      ...d,
      comicSources: d.comicSources.map((s) =>
        s.id === source.id ? { ...s, testStatus: status, testMsg: message, testAt: Date.now() } : s
      )
    }))
    setTestingComicId(null)
    onNotice(`${source.name}：${message}`)
  }

  const testAllComic = async (): Promise<void> => {
    if (testingComicAll || data.comicSources.length === 0) return
    setTestingComicAll(true)
    const queue = [...data.comicSources]
    let ok = 0
    let bad = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const source = queue.shift()
        if (!source) return
        setTestingComicId(source.id)
        const latency = probeLatency(source.baseUrl)
        const res = await window.laozheng.testComicSource(toComicInput(source))
        const status = res.ok ? 'ok' : 'bad'
        if (res.ok) ok += 1
        else bad += 1
        const message = withMs(res.ok ? res.message ?? '可用' : res.error ?? '不可用', await latency)
        update((d) => ({
          ...d,
          comicSources: d.comicSources.map((s) =>
            s.id === source.id
              ? { ...s, testStatus: status, testMsg: message, testAt: Date.now() }
              : s
          )
        }))
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker))
    setTestingComicId(null)
    setTestingComicAll(false)
    onNotice(`漫画源测试完成：有效 ${ok} 个 · 无效 ${bad} 个`)
  }

  const exportComic = async (): Promise<void> => {
    const rows = data.comicSources.map((source) => ({
      id: source.id,
      name: source.name,
      baseUrl: source.baseUrl,
      template: source.template,
      enabled: source.enabled
    }))
    if (!rows.length) {
      onNotice('还没有可导出的漫画源')
      return
    }
    const res = await window.laozheng.exportComicSources(rows)
    if (res.canceled) return
    if (res.error) {
      onNotice(`导出失败：${res.error}`)
      return
    }
    onNotice(`已导出 ${res.count ?? 0} 个漫画源到 ${res.path}`)
  }

  const removeComicSource = (): void => {
    if (!deletingComic) return
    update((d) => ({
      ...d,
      comicSources: d.comicSources.filter((s) => s.id !== deletingComic.id)
    }))
    onNotice(`已删除漫画源「${deletingComic.name}」`)
    setDeletingComic(null)
  }

  // ---------- 补丁源（风灵月影 / 3DM / 游民星空 / 游侠网） ----------
  const patchTrainer = (id: string, patch: Partial<TrainerSource>) => {
    update((d) => ({
      ...d,
      trainerSources: d.trainerSources.map((source) =>
        source.id === id ? { ...source, ...patch } : source
      )
    }))
  }

  const saveTrainerSource = (input: {
    name: string
    baseUrl: string
    type: TrainerSourceType
  }) => {
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
    if (!input.name.trim() || !/^https?:\/\//i.test(baseUrl)) {
      onNotice('补丁源名称和地址不能为空')
      return
    }
    if (!(editingTrainer === 'new' || editingTrainer)) return
    if (editingTrainer === 'new') {
      if (data.trainerSources.some((s) => s.baseUrl === baseUrl)) {
        onNotice('该补丁源已经存在')
        return
      }
      update((d) => ({
        ...d,
        trainerSources: [
          ...d.trainerSources,
          {
            id: `${input.type}_${Date.now().toString(36)}`,
            name: input.name.trim(),
            type: input.type,
            baseUrl,
            enabled: true,
            testStatus: 'ok',
            testMsg: '可用',
            testAt: Date.now()
          }
        ]
      }))
      onNotice(`已添加补丁源「${input.name.trim()}」`)
    } else {
      const current = editingTrainer
      if (data.trainerSources.some((s) => s.id !== current.id && s.baseUrl === baseUrl)) {
        onNotice('该补丁源地址已经存在')
        return
      }
      const changed = current.baseUrl !== baseUrl || current.type !== input.type
      update((d) => ({
        ...d,
        trainerSources: d.trainerSources.map((source) =>
          source.id === current.id
            ? {
                ...source,
                name: input.name.trim(),
                type: input.type,
                baseUrl,
                ...(changed ? { testStatus: null, testMsg: null, testAt: 0 } : {})
              }
            : source
        )
      }))
      onNotice(`已保存补丁源「${input.name.trim()}」`)
    }
    setEditingTrainer(null)
  }

  const testTrainer = async (source: TrainerSource) => {
    setTestingTrainerId(source.id)
    const latency = probeLatency(source.baseUrl)
    try {
      const res = await window.laozheng.testTrainerSource({
        id: source.id,
        type: source.type,
        baseUrl: source.baseUrl,
        name: source.name
      })
      patchTrainer(source.id, {
        testStatus: res.ok ? 'ok' : 'bad',
        testMsg: withMs(res.ok ? res.message ?? '可用' : res.error ?? '测试失败', await latency),
        testAt: Date.now()
      })
    } catch (err) {
      patchTrainer(source.id, {
        testStatus: 'bad',
        testMsg: withMs((err as Error).message, await latency),
        testAt: Date.now()
      })
    } finally {
      setTestingTrainerId(null)
    }
  }

  const testAllTrainer = async () => {
    if (testingTrainerAll || data.trainerSources.length === 0) return
    setTestingTrainerAll(true)
    let ok = 0
    let bad = 0
    for (const source of data.trainerSources) {
      const latency = probeLatency(source.baseUrl)
      const res = await window.laozheng.testTrainerSource({
        id: source.id,
        type: source.type,
        baseUrl: source.baseUrl,
        name: source.name
      })
      if (res.ok) ok += 1
      else bad += 1
      patchTrainer(source.id, {
        testStatus: res.ok ? 'ok' : 'bad',
        testMsg: withMs(res.ok ? res.message ?? '可用' : res.error ?? '测试失败', await latency),
        testAt: Date.now()
      })
    }
    setTestingTrainerAll(false)
    onNotice(`补丁源测试完成：有效 ${ok} 个 · 无效 ${bad} 个`)
  }

  const importTrainerSources = (inputs: VodSourceInput[]) => {
    const existing = new Set(data.trainerSources.map((s) => s.baseUrl))
    const taken = new Set(data.trainerSources.map((s) => s.id))
    const fresh: TrainerSource[] = []
    for (const input of inputs) {
      const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
      if (!/^https?:\/\//i.test(baseUrl) || existing.has(baseUrl)) continue
      existing.add(baseUrl)
      const type = inferTrainerSourceType(baseUrl)
      const baseId = `${type}_${genSourceId(baseUrl)}`
      let id = baseId
      let n = 2
      while (taken.has(id)) id = `${baseId}_${n++}`
      taken.add(id)
      fresh.push({
        id,
        name: input.name.trim() || vodHost(baseUrl),
        type,
        baseUrl,
        enabled: true,
        testStatus: 'ok',
        testMsg: '可用',
        testAt: Date.now()
      })
    }
    if (!fresh.length) {
      onNotice('这些补丁源已存在')
      setImportingTrainer(false)
      return
    }
    update((d) => ({ ...d, trainerSources: [...d.trainerSources, ...fresh] }))
    onNotice(`已导入 ${fresh.length} 个补丁源`)
    setImportingTrainer(false)
  }

  const exportTrainer = async (): Promise<void> => {
    if (!data.trainerSources.length) {
      onNotice('还没有可导出的补丁源')
      return
    }
    const res = await window.laozheng.exportTrainerSources(
      data.trainerSources.map((source) => ({
        id: source.id,
        name: source.name,
        type: source.type,
        baseUrl: source.baseUrl,
        enabled: source.enabled
      }))
    )
    if (res.canceled) return
    if (res.error) {
      onNotice(`导出失败：${res.error}`)
      return
    }
    onNotice(`已导出 ${res.count ?? 0} 个补丁源到 ${res.path}`)
  }

  const removeTrainerSource = () => {
    if (!deletingTrainer) return
    update((d) => ({
      ...d,
      trainerSources: d.trainerSources.filter((s) => s.id !== deletingTrainer.id)
    }))
    onNotice(`已删除补丁源「${deletingTrainer.name}」`)
    setDeletingTrainer(null)
  }

  // ---------- 音乐源（无名音乐 + 备用线路无名闪闪音乐） ----------
  const patchMusic = (id: string, patch: Partial<MusicSource>) => {
    update((d) => ({
      ...d,
      musicSources: d.musicSources.map((source) =>
        source.id === id ? { ...source, ...patch } : source
      )
    }))
  }

  const patchMusicBackup = (id: string, patch: Partial<MusicSourceBackup>) => {
    update((d) => ({
      ...d,
      musicSources: d.musicSources.map((source) =>
        source.id === id && source.backup
          ? { ...source, backup: { ...source.backup, ...patch } }
          : source
      )
    }))
  }

  const saveMusicSource = (input: {
    name: string
    baseUrl: string
    backup: MusicSourceBackup | null
    primaryStatus?: { testStatus: 'ok' | 'bad' | null; testMsg: string | null; testAt: number }
  }) => {
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
    if (!input.name.trim() || !/^https?:\/\//i.test(baseUrl)) {
      onNotice('音乐源名称和地址不能为空')
      return
    }
    if (!(editingMusic === 'new' || editingMusic)) return
    if (editingMusic === 'new') {
      if (data.musicSources.some((s) => s.baseUrl === baseUrl)) {
        onNotice('该音乐源已经存在')
        return
      }
      update((d) => ({
        ...d,
        musicSources: [
          ...d.musicSources,
          {
            id: `music_${Date.now().toString(36)}`,
            name: input.name.trim(),
            baseUrl,
            backup: input.backup,
            enabled: true,
            testStatus: input.primaryStatus?.testStatus ?? 'ok',
            testMsg: input.primaryStatus?.testMsg ?? '可用',
            testAt: input.primaryStatus?.testAt ?? Date.now()
          }
        ]
      }))
      onNotice(`已添加音乐源「${input.name.trim()}」`)
    } else {
      const current = editingMusic
      if (data.musicSources.some((s) => s.id !== current.id && s.baseUrl === baseUrl)) {
        onNotice('该音乐源地址已经存在')
        return
      }
      const changed = current.baseUrl !== baseUrl
      update((d) => ({
        ...d,
        musicSources: d.musicSources.map((source) =>
          source.id === current.id
            ? {
                ...source,
                name: input.name.trim(),
                baseUrl,
                backup: input.backup,
                ...(changed
                  ? {
                      testStatus: input.primaryStatus?.testStatus ?? null,
                      testMsg: input.primaryStatus?.testMsg ?? null,
                      testAt: input.primaryStatus?.testAt ?? 0
                    }
                  : input.primaryStatus
                    ? {
                        testStatus: input.primaryStatus.testStatus,
                        testMsg: input.primaryStatus.testMsg,
                        testAt: input.primaryStatus.testAt
                      }
                    : {})
              }
            : source
        )
      }))
      onNotice(`已保存音乐源「${input.name.trim()}」`)
    }
    setEditingMusic(null)
  }

  const testMusic = async (source: MusicSource) => {
    setTestingMusicId(source.id)
    const latency = probeLatency(source.baseUrl)
    try {
      const res = await window.laozheng.testMusicSource({
        id: source.id,
        name: source.name,
        baseUrl: source.baseUrl
      })
      patchMusic(source.id, {
        testStatus: res.ok ? 'ok' : 'bad',
        testMsg: withMs(res.ok ? res.message ?? '可用' : res.error ?? '测试失败', await latency),
        testAt: Date.now()
      })
    } catch (err) {
      patchMusic(source.id, {
        testStatus: 'bad',
        testMsg: withMs((err as Error).message, await latency),
        testAt: Date.now()
      })
    } finally {
      setTestingMusicId(null)
    }
  }

  /** 备用线路测试：和优选地址一样，测一次可用性与延迟写回 backup */
  const testMusicBackup = async (source: MusicSource) => {
    const backup = source.backup
    if (!backup) return
    setTestingMusicBackupId(source.id)
    const latency = probeLatency(backup.baseUrl)
    try {
      const res = await window.laozheng.testMusicSource({
        id: backup.id,
        name: backup.name,
        baseUrl: backup.baseUrl
      })
      patchMusicBackup(source.id, {
        testStatus: res.ok ? 'ok' : 'bad',
        testMsg: withMs(res.ok ? res.message ?? '可用' : res.error ?? '测试失败', await latency),
        testAt: Date.now()
      })
    } catch (err) {
      patchMusicBackup(source.id, {
        testStatus: 'bad',
        testMsg: withMs((err as Error).message, await latency),
        testAt: Date.now()
      })
    } finally {
      setTestingMusicBackupId(null)
    }
  }

  const testAllMusic = async () => {
    if (testingMusicAll || data.musicSources.length === 0) return
    setTestingMusicAll(true)
    let ok = 0
    let bad = 0
    for (const source of data.musicSources) {
      const latency = probeLatency(source.baseUrl)
      const res = await window.laozheng.testMusicSource({
        id: source.id,
        name: source.name,
        baseUrl: source.baseUrl
      })
      if (res.ok) ok += 1
      else bad += 1
      patchMusic(source.id, {
        testStatus: res.ok ? 'ok' : 'bad',
        testMsg: withMs(res.ok ? res.message ?? '可用' : res.error ?? '测试失败', await latency),
        testAt: Date.now()
      })
      if (source.backup) {
        const backupLatency = probeLatency(source.backup.baseUrl)
        const backupRes = await window.laozheng.testMusicSource({
          id: source.backup.id,
          name: source.backup.name,
          baseUrl: source.backup.baseUrl
        })
        if (backupRes.ok) ok += 1
        else bad += 1
        patchMusicBackup(source.id, {
          testStatus: backupRes.ok ? 'ok' : 'bad',
          testMsg: withMs(
            backupRes.ok ? backupRes.message ?? '可用' : backupRes.error ?? '测试失败',
            await backupLatency
          ),
          testAt: Date.now()
        })
      }
    }
    setTestingMusicAll(false)
    onNotice(`音乐源测试完成：有效 ${ok} 个 · 无效 ${bad} 个`)
  }

  const importMusicSources = (inputs: VodSourceImport[]) => {
    const existing = new Set(data.musicSources.map((s) => s.baseUrl))
    const taken = new Set(data.musicSources.map((s) => s.id))
    const fresh: MusicSource[] = []
    for (const input of inputs) {
      const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
      if (!/^https?:\/\//i.test(baseUrl) || existing.has(baseUrl)) continue
      existing.add(baseUrl)
      const baseId = `music_${genSourceId(baseUrl)}`
      let id = baseId
      let n = 2
      while (taken.has(id)) id = `${baseId}_${n++}`
      taken.add(id)
      const backupBase = normalizeBaseUrl(input.backup?.baseUrl ?? '')
      const backup: MusicSourceBackup | null =
        input.backup && /^https?:\/\//i.test(backupBase)
          ? {
              id: input.backup.id || 's33ve',
              name:
                musicLineName(backupBase) ||
                input.backup.name?.trim() ||
                DEFAULT_MUSIC_BACKUP.name,
              baseUrl: backupBase,
              enabled: input.backup.enabled !== false,
              testStatus: 'ok',
              testMsg: '可用',
              testAt: Date.now()
            }
          : null
      fresh.push({
        id,
        name: input.name.trim() || vodHost(baseUrl),
        baseUrl,
        ...(backup ? { backup } : {}),
        enabled: true,
        testStatus: 'ok',
        testMsg: '可用',
        testAt: Date.now()
      })
    }
    if (!fresh.length) {
      onNotice('这些音乐源已存在')
      setImportingMusic(false)
      return
    }
    update((d) => ({ ...d, musicSources: [...d.musicSources, ...fresh] }))
    onNotice(`已导入 ${fresh.length} 个音乐源`)
    setImportingMusic(false)
  }

  const exportMusic = async (): Promise<void> => {
    if (!data.musicSources.length) {
      onNotice('还没有可导出的音乐源')
      return
    }
    const res = await window.laozheng.exportMusicSources(
      data.musicSources.map((source) => ({
        id: source.id,
        name: source.name,
        baseUrl: source.baseUrl,
        enabled: source.enabled,
        ...(source.backup
          ? {
              backup: {
                id: source.backup.id,
                name: source.backup.name,
                baseUrl: source.backup.baseUrl,
                enabled: source.backup.enabled
              }
            }
          : {})
      }))
    )
    if (res.canceled) return
    if (res.error) {
      onNotice(`导出失败：${res.error}`)
      return
    }
    onNotice(`已导出 ${res.count ?? 0} 个音乐源到 ${res.path}`)
  }

  const removeMusicSource = () => {
    if (!deletingMusic) return
    update((d) => ({
      ...d,
      musicSources: d.musicSources.filter((s) => s.id !== deletingMusic.id)
    }))
    onNotice(`已删除音乐源「${deletingMusic.name}」`)
    setDeletingMusic(null)
  }

  // ---------- 平台直播源（B站 / 斗鱼 / 抖音） ----------

  const patchLivePlatform = (id: string, patch: Partial<LivePlatformSource>) => {
    update((d) => ({
      ...d,
      livePlatformSources: d.livePlatformSources.map((source) =>
        source.id === id ? { ...source, ...patch } : source
      )
    }))
  }

  const saveLivePlatformSource = (input: VodSourceInput) => {
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    if (!input.name.trim() || !/^https?:\/\//i.test(baseUrl)) {
      onNotice('直播源名称和地址不能为空')
      return
    }
    const platform = livePlatformOfSource({ id: input.id, baseUrl })
    if (!platform) {
      onNotice('直播源地址需属于 B站 / 斗鱼 / 抖音')
      return
    }
    if (!(editingLivePlatform === 'new' || editingLivePlatform)) return
    if (editingLivePlatform === 'new') {
      if (data.livePlatformSources.some((s) => livePlatformOfSource(s) === platform)) {
        onNotice('该平台直播源已经存在')
        return
      }
      update((d) => {
        let id: string = platform
        let n = 2
        while (d.livePlatformSources.some((s) => s.id === id)) id = `${platform}_${n++}`
        return {
          ...d,
          livePlatformSources: [
            ...d.livePlatformSources,
            {
              id,
              name: input.name.trim(),
              baseUrl,
              enabled: true,
              region: 'cn',
              regionManual: true,
              testStatus: 'ok',
              testMsg: '可用',
              testAt: Date.now()
            }
          ]
        }
      })
      onNotice(`已添加直播源「${input.name.trim()}」`)
    } else {
      const current = editingLivePlatform
      if (
        data.livePlatformSources.some(
          (s) => s.id !== current.id && livePlatformOfSource(s) === platform
        )
      ) {
        onNotice('该平台直播源已经存在')
        return
      }
      if (data.livePlatformSources.some((s) => s.id !== current.id && s.baseUrl === baseUrl)) {
        onNotice('该直播源地址已经存在')
        return
      }
      const changed = current.baseUrl !== baseUrl
      update((d) => ({
        ...d,
        livePlatformSources: d.livePlatformSources.map((source) =>
          source.id === current.id
            ? {
                ...source,
                name: input.name.trim(),
                baseUrl,
                ...(changed ? { testStatus: null, testMsg: null, testAt: 0 } : {})
              }
            : source
        )
      }))
      onNotice(`已保存直播源「${input.name.trim()}」`)
    }
    setEditingLivePlatform(null)
  }

  const testLivePlatform = async (source: LivePlatformSource) => {
    setTestingLivePlatformId(source.id)
    const latency = probeLatency(source.baseUrl)
    try {
      const res = await window.laozheng.livePlatformTestSource({
        name: source.name,
        baseUrl: source.baseUrl
      })
      const message = withMs(res.message, await latency)
      patchLivePlatform(source.id, {
        testStatus: res.status,
        testMsg: message,
        testAt: res.testAt
      })
      onNotice(`${source.name}：${message}`)
    } catch (err) {
      const message = withMs((err as Error).message, await latency)
      patchLivePlatform(source.id, {
        testStatus: 'dead',
        testMsg: message,
        testAt: Date.now()
      })
      onNotice(`${source.name}：测试失败`)
    } finally {
      setTestingLivePlatformId(null)
    }
  }

  const testAllLivePlatform = async () => {
    if (testingLivePlatformAll || data.livePlatformSources.length === 0) return
    setTestingLivePlatformAll(true)
    const queue = [...data.livePlatformSources]
    let ok = 0
    let bad = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const source = queue.shift()
        if (!source) return
        setTestingLivePlatformId(source.id)
        const latency = probeLatency(source.baseUrl)
        const res = await window.laozheng.livePlatformTestSource({
          name: source.name,
          baseUrl: source.baseUrl
        })
        if (res.status === 'ok') ok += 1
        else bad += 1
        patchLivePlatform(source.id, {
          testStatus: res.status,
          testMsg: withMs(res.message, await latency),
          testAt: res.testAt
        })
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker))
    setTestingLivePlatformId(null)
    setTestingLivePlatformAll(false)
    onNotice(`直播源测试完成：有效 ${ok} 个 · 无效 ${bad} 个`)
  }

  const importLivePlatformSources = (inputs: VodSourceInput[]) => {
    const urls = new Set(data.livePlatformSources.map((s) => s.baseUrl))
    const platforms = new Set(
      data.livePlatformSources
        .map((source) => livePlatformOfSource(source))
        .filter((platform): platform is NonNullable<typeof platform> => !!platform)
    )
    const takenIds = new Set(data.livePlatformSources.map((s) => s.id))
    const fresh: LivePlatformSource[] = []
    for (const input of inputs) {
      const baseUrl = normalizeBaseUrl(input.baseUrl)
      const platform = livePlatformOfSource({ id: input.id, baseUrl })
      if (!platform || !/^https?:\/\//i.test(baseUrl) || urls.has(baseUrl)) continue
      if (platforms.has(platform)) continue
      urls.add(baseUrl)
      platforms.add(platform)
      let id: string = platform
      let n = 2
      while (takenIds.has(id)) id = `${platform}_${n++}`
      takenIds.add(id)
      const fallback = DEFAULT_LIVE_PLATFORM_SOURCES.find(
        (source) => livePlatformOfSource(source) === platform
      )
      fresh.push({
        id,
        name: input.name.trim() || fallback?.name || vodHost(baseUrl),
        baseUrl,
        enabled: true,
        region: 'cn',
        regionManual: true,
        testStatus: 'ok',
        testMsg: '可用',
        testAt: Date.now()
      })
    }
    if (!fresh.length) {
      onNotice('这些直播源已存在，或不是 B站 / 斗鱼 / 抖音 的地址')
      setImportingLivePlatform(false)
      return
    }
    update((d) => ({ ...d, livePlatformSources: [...d.livePlatformSources, ...fresh] }))
    onNotice(`已导入 ${fresh.length} 个直播源`)
    setImportingLivePlatform(false)
  }

  const exportLivePlatform = async (): Promise<void> => {
    if (!data.livePlatformSources.length) {
      onNotice('还没有可导出的直播源')
      return
    }
    const res = await window.laozheng.livePlatformExportSources(
      data.livePlatformSources.map((source) => ({
        id: source.id,
        name: source.name,
        baseUrl: source.baseUrl,
        enabled: source.enabled
      }))
    )
    if (res.canceled) return
    if (res.error) {
      onNotice(`导出失败：${res.error}`)
      return
    }
    onNotice(`已导出 ${res.count ?? 0} 个直播源到 ${res.path}`)
  }

  const removeLivePlatformSource = () => {
    if (!deletingLivePlatform) return
    update((d) => ({
      ...d,
      livePlatformSources: d.livePlatformSources.filter((s) => s.id !== deletingLivePlatform.id)
    }))
    onNotice(`已删除直播源「${deletingLivePlatform.name}」`)
    setDeletingLivePlatform(null)
  }

  // ---------- 电视源 ----------

  const persistLive = (next: LiveSource[]) => {
    liveRef.current = next
    setLiveSources(next)
    void window.laozheng.saveLiveSources(next)
  }

  const patchLive = (id: string, patch: Partial<LiveSource>) => {
    const current = liveRef.current
    if (!current) return
    persistLive(current.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  const addLiveSource = (name: string, url: string) => {
    if (!liveSources) return
    const nextUrl = url.trim()
    if (liveSources.some((s) => s.url === nextUrl)) {
      onNotice('该电视源地址已经存在')
      return
    }
    const baseId = newLiveSourceId(nextUrl)
    let id = baseId
    let n = 2
    while (liveSources.some((s) => s.id === id)) id = `${baseId}_${n++}`
    const source: LiveSource = {
      id,
      name: name.trim() || '直播源',
      url: nextUrl,
      content: '',
      enabled: true,
      testStatus: 'ok',
      testMsg: '可用',
      testAt: Date.now()
    }
    persistLive([...liveSources, source])
    setAddingLive(false)
    onNotice(`已添加电视源「${source.name}」`)
  }

  const saveLiveSource = (name: string, url: string) => {
    if (!editingLive || !liveSources) return
    const target = editingLive
    const nextUrl = url.trim()
    if (liveSources.some((s) => s.id !== target.id && s.url === nextUrl)) {
      onNotice('该电视源地址已被其他条目使用')
      return
    }
    const urlChanged = nextUrl !== target.url
    persistLive(
      liveSources.map((s) =>
        s.id === target.id
          ? {
              ...s,
              name: name.trim() || s.name,
              url: nextUrl,
              content: nextUrl.startsWith('local://') ? s.content : '',
              // 地址变了，旧的测试结果不再可信
              ...(urlChanged ? { testStatus: null, testMsg: null, testAt: 0 } : {})
            }
          : s
      )
    )
    setEditingLive(null)
    onNotice(`已保存电视源「${name.trim() || target.name}」`)
  }

  const importLiveFile = async () => {
    const res = await window.laozheng.importLiveFile()
    if (res.canceled) return
    if (res.error) {
      onNotice(`导入失败：${res.error}`)
      return
    }
    if (!res.source || !liveSources) return
    if (liveSources.some((s) => s.id === res.source!.id)) {
      onNotice('该直播源已存在')
      return
    }
    persistLive([...liveSources, res.source])
    onNotice(`已导入「${res.source.name}」`)
  }

  const testLive = async (source: LiveSource) => {
    setTestingLiveId(source.id)
    const latency = probeLatency(source.url)
    const res = await window.laozheng.testLiveSource(source)
    setTestingLiveId(null)
    const message = withMs(res.message, await latency)
    patchLive(source.id, {
      testStatus: res.ok ? 'ok' : 'failed',
      testMsg: message,
      testAt: Date.now()
    })
    onNotice(`${source.name}：${message}`)
  }

  const testAllLive = async () => {
    if (!liveSources || testingLiveAll || liveSources.length === 0) return
    setTestingLiveAll(true)
    const queue = [...liveSources]
    let ok = 0
    let bad = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const source = queue.shift()
        if (!source) return
        setTestingLiveId(source.id)
        const latency = probeLatency(source.url)
        const res = await window.laozheng.testLiveSource(source)
        if (res.ok) ok += 1
        else bad += 1
        patchLive(source.id, {
          testStatus: res.ok ? 'ok' : 'failed',
          testMsg: withMs(res.message, await latency),
          testAt: Date.now()
        })
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker))
    setTestingLiveId(null)
    setTestingLiveAll(false)
    onNotice(`电视源测试完成：有效 ${ok} 个 · 无效 ${bad} 个`)
  }

  const exportLive = async () => {
    if (!liveSources) return
    const res = await window.laozheng.exportLiveSources(liveSources)
    if (res.canceled) return
    if (res.error) {
      onNotice(`导出失败：${res.error}`)
      return
    }
    onNotice(`已导出 ${res.count ?? 0} 个电视源到 ${res.path}`)
  }

  const removeLiveSource = () => {
    if (!deletingLive || !liveSources) return
    persistLive(liveSources.filter((s) => s.id !== deletingLive.id))
    onNotice(`已删除电视源「${deletingLive.name}」`)
    setDeletingLive(null)
  }

  // ---------- 全部源整体导入 / 导出 ----------

  const exportAllSources = async (): Promise<void> => {
    const [magnet, live] = await Promise.all([
      window.laozheng.magnetState(),
      liveRef.current ? Promise.resolve(liveRef.current) : window.laozheng.loadLiveSources()
    ])
    const bundle: AllSourcesBundle = {
      vodSources: data.vodSources.map((s) => ({
        name: s.name,
        baseUrl: s.baseUrl,
        enabled: s.enabled,
        region: s.region,
        regionManual: s.regionManual
      })),
      dramaSources: data.dramaSources.map((s) => ({
        id: s.id,
        name: s.name,
        baseUrl: s.baseUrl ?? '',
        enabled: s.enabled
      })),
      liveSources: live,
      magnetSources: magnet.sources,
      trainerSources: data.trainerSources.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        baseUrl: s.baseUrl,
        enabled: s.enabled
      })),
      musicSources: data.musicSources.map((s) => ({
        id: s.id,
        name: s.name,
        baseUrl: s.baseUrl,
        enabled: s.enabled,
        ...(s.kind ? { kind: s.kind } : {}),
        ...(s.platforms?.length ? { platforms: [...s.platforms] } : {}),
        ...(s.backup ? { backup: { ...s.backup } } : {})
      })),
      novelSources: data.novelSources.map((s) => ({
        id: s.id,
        name: s.name,
        baseUrl: s.baseUrl,
        template: s.template,
        enabled: s.enabled
      })),
      comicSources: data.comicSources.map((s) => ({
        id: s.id,
        name: s.name,
        baseUrl: s.baseUrl,
        template: s.template,
        enabled: s.enabled
      })),
      h1Sources: data.h1Sources.map((s) => ({
        id: s.id,
        name: s.name,
        baseUrl: s.baseUrl,
        enabled: s.enabled
      })),
      livePlatformSources: data.livePlatformSources.map((s) => ({
        id: s.id,
        name: s.name,
        baseUrl: s.baseUrl,
        enabled: s.enabled
      })),
      wallpaperSources: data.wallpaperSources.map((s) => ({
        id: s.id,
        name: s.name,
        baseUrl: s.baseUrl,
        template: s.template,
        enabled: s.enabled
      })),
      shuangkanSources: data.shuangkanSources.map((s) => ({
        id: s.id,
        name: s.name,
        baseUrl: s.baseUrl,
        enabled: s.enabled,
        ...(isSkAdapter(s.adapter) ? { adapter: s.adapter } : {})
      })),
      meituSources: data.meituSources.map((s) => ({
        id: s.id,
        name: s.name,
        baseUrl: s.baseUrl,
        template: s.template,
        enabled: s.enabled
      }))
    }
    const res = await window.laozheng.exportAllSources(bundle)
    if (res.canceled) return
    if (res.error) {
      onNotice(`导出失败：${res.error}`)
      return
    }
    onNotice(`已导出 ${res.count ?? 0} 个源到 ${res.path}`)
  }

  const importAllSources = async (): Promise<void> => {
    const res = await window.laozheng.importAllSources()
    if (res.canceled) return
    if (res.error || !res.data) {
      onNotice(`导入失败：${res.error ?? '文件内容无效'}`)
      return
    }
    const bundle = res.data

    let vodAdded = 0
    let dramaAdded = 0
    let trainerAdded = 0
    let musicAdded = 0
    let novelAdded = 0
    let comicAdded = 0
    let h1Added = 0
    let livePlatformAdded = 0
    let wallpaperAdded = 0
    let meituAdded = 0
    let shuangkanAdded = 0
    update((d) => {
      const vodUrls = new Set(d.vodSources.map((s) => s.baseUrl))
      const vodRows: VodSource[] = []
      for (const raw of bundle.vodSources) {
        if (!raw || typeof raw !== 'object') continue
        const baseUrl = normalizeBaseUrl(String(raw.baseUrl ?? ''))
        if (!/^https?:\/\//i.test(baseUrl) || vodUrls.has(baseUrl)) continue
        vodUrls.add(baseUrl)
        const baseId = genSourceId(baseUrl)
        let id = baseId
        let n = 2
        while (d.vodSources.some((s) => s.id === id) || vodRows.some((s) => s.id === id)) {
          id = `${baseId}_${n++}`
        }
        vodRows.push({
          id,
          name: String(raw.name ?? '').trim() || vodHost(baseUrl),
          baseUrl,
          enabled: raw.enabled !== false,
          region: raw.region === 'proxy' ? 'proxy' : 'cn',
          regionManual: raw.regionManual === true,
          testStatus: 'ok',
          testMsg: '可用',
          testAt: Date.now()
        })
      }

      const nextDramaSources = [...d.dramaSources]
      let dramaAddedCount = 0
      const xifanRow = bundle.dramaSources.find(
        (raw) => !!raw && typeof raw === 'object' && raw.id === XIFAN_DRAMA_SOURCE_ID
      )
      if (xifanRow) {
        const baseUrl = normalizeBaseUrl(String(xifanRow.baseUrl ?? ''))
        const index = nextDramaSources.findIndex(
          (s) => s.id === XIFAN_DRAMA_SOURCE_ID
        )
        if (index >= 0) {
          const current = nextDramaSources[index]
          nextDramaSources[index] = {
            ...current,
            name: String(xifanRow.name ?? '').trim() || current.name,
            enabled: xifanRow.enabled !== false,
            ...(baseUrl ? { baseUrl } : {})
          }
          dramaAddedCount += 1
        } else {
          nextDramaSources.push({
            id: XIFAN_DRAMA_SOURCE_ID,
            name: String(xifanRow.name ?? '').trim() || '西饭短剧',
            enabled: xifanRow.enabled !== false,
            builtin: true,
            ...(baseUrl ? { baseUrl } : {}),
            testStatus: 'ok',
            testMsg: '可用',
            testAt: Date.now()
          })
          dramaAddedCount += 1
        }
      }

      const dramaUrls = new Set(nextDramaSources.map((s) => s.baseUrl).filter(Boolean))
      for (const raw of bundle.dramaSources) {
        if (!raw || typeof raw !== 'object') continue
        if (raw.id === XIFAN_DRAMA_SOURCE_ID) continue
        const baseUrl = normalizeBaseUrl(String(raw.baseUrl ?? ''))
        if (!/^https?:\/\//i.test(baseUrl) || dramaUrls.has(baseUrl)) continue
        dramaUrls.add(baseUrl)
        nextDramaSources.push({
          id: newDramaSourceId(baseUrl, nextDramaSources),
          name: String(raw.name ?? '').trim() || vodHost(baseUrl),
          baseUrl,
          enabled: raw.enabled !== false,
          testStatus: 'ok',
          testMsg: '可用',
          testAt: Date.now()
        })
        dramaAddedCount += 1
      }

      const nextTrainerSources = [...d.trainerSources]
      let trainerAddedCount = 0
      for (const raw of bundle.trainerSources ?? []) {
        if (!raw || typeof raw !== 'object') continue
        const baseUrl = normalizeBaseUrl(String(raw.baseUrl ?? ''))
        if (!/^https?:\/\//i.test(baseUrl)) continue
        const type: TrainerSourceType =
          raw.type === 'fling' ||
          raw.type === '3dm' ||
          raw.type === 'gamersky' ||
          raw.type === 'ali213'
            ? raw.type
            : inferTrainerSourceType(baseUrl)
        if (type === 'megagames') continue
        const id = typeof raw.id === 'string' ? raw.id : ''
        const exists = nextTrainerSources.some(
          (s) => (id && s.id === id) || s.baseUrl === baseUrl
        )
        if (exists) continue
        let newId =
          id && !nextTrainerSources.some((s) => s.id === id)
            ? id
            : `${type}_${Date.now().toString(36)}`
        let n = 2
        while (nextTrainerSources.some((s) => s.id === newId)) {
          newId = `${type}_${Date.now().toString(36)}_${n++}`
        }
        nextTrainerSources.push({
          id: newId,
          name: String(raw.name ?? '').trim() || TRAINER_SOURCE_TYPE_LABEL[type].split('（')[0],
          type,
          baseUrl,
          enabled: raw.enabled !== false,
          testStatus: 'ok',
          testMsg: '可用',
          testAt: Date.now()
        })
        trainerAddedCount += 1
      }

      const nextMusicSources = [...d.musicSources]
      let musicAddedCount = 0
      for (const raw of bundle.musicSources ?? []) {
        if (!raw || typeof raw !== 'object') continue
        const baseUrl = normalizeBaseUrl(String(raw.baseUrl ?? ''))
        if (!/^https?:\/\//i.test(baseUrl)) continue
        const id = typeof raw.id === 'string' ? raw.id : ''
        const exists = nextMusicSources.some((s) => (id && s.id === id) || s.baseUrl === baseUrl)
        if (exists) continue
        let newId =
          id && !nextMusicSources.some((s) => s.id === id)
            ? id
            : `music_${Date.now().toString(36)}`
        let n = 2
        while (nextMusicSources.some((s) => s.id === newId)) {
          newId = `music_${Date.now().toString(36)}_${n++}`
        }
        const kind = raw.kind === 'lx' || raw.kind === 'site' ? raw.kind : undefined
        const platforms = Array.isArray(raw.platforms)
          ? raw.platforms.filter((item): item is MusicLxPlatform =>
              ['kw', 'kg', 'tx', 'wy'].includes(String(item))
            )
          : []
        const backupBase = normalizeBaseUrl(String(raw.backup?.baseUrl ?? ''))
        const backup: MusicSourceBackup | null =
          raw.backup && /^https?:\/\//i.test(backupBase)
            ? {
                id: raw.backup.id || 's33ve',
                name:
                  musicLineName(backupBase) ||
                  raw.backup.name?.trim() ||
                  DEFAULT_MUSIC_BACKUP.name,
                baseUrl: backupBase,
                enabled: raw.backup.enabled !== false,
                testStatus: 'ok',
                testMsg: '可用',
                testAt: Date.now()
              }
            : null
        nextMusicSources.push({
          id: newId,
          name: String(raw.name ?? '').trim() || '音乐源',
          baseUrl,
          enabled: raw.enabled !== false,
          ...(kind ? { kind } : {}),
          ...(platforms.length ? { platforms } : {}),
          ...(backup ? { backup } : {}),
          testStatus: 'ok',
          testMsg: '可用',
          testAt: Date.now()
        })
        musicAddedCount += 1
      }

      const nextNovelSources = [...d.novelSources]
      let novelAddedCount = 0
      for (const raw of bundle.novelSources ?? []) {
        if (!raw || typeof raw !== 'object') continue
        const baseUrl = normalizeBaseUrl(String(raw.baseUrl ?? ''))
        const template = raw.template as NovelSourceTemplate
        if (!/^https?:\/\//i.test(baseUrl)) continue
        if (!(template in NOVEL_SOURCE_TEMPLATE_LABEL)) continue
        const id = typeof raw.id === 'string' ? raw.id : ''
        const exists = nextNovelSources.some((s) => (id && s.id === id) || s.baseUrl === baseUrl)
        if (exists) continue
        let newId =
          id && !nextNovelSources.some((s) => s.id === id)
            ? id
            : newNovelSourceId(baseUrl, nextNovelSources)
        let n = 2
        while (nextNovelSources.some((s) => s.id === newId)) {
          newId = newNovelSourceId(baseUrl, nextNovelSources) + `_${n++}`
        }
        nextNovelSources.push({
          id: newId,
          name: String(raw.name ?? '').trim() || vodHost(baseUrl),
          baseUrl,
          template,
          enabled: raw.enabled !== false,
          testStatus: 'ok',
          testMsg: '可用',
          testAt: Date.now()
        })
        novelAddedCount += 1
      }

      const nextComicSources = [...d.comicSources]
      let comicAddedCount = 0
      for (const raw of bundle.comicSources ?? []) {
        if (!raw || typeof raw !== 'object') continue
        const baseUrl = normalizeBaseUrl(String(raw.baseUrl ?? ''))
        if (!/^https?:\/\//i.test(baseUrl)) continue
        const template: ComicSourceTemplate =
          raw.template === 'komiic' ||
          raw.template === 'yumanhua' ||
          raw.template === 'bikahub' ||
          raw.template === 'tptoon' ||
          raw.template === 'jmcomic'
            ? raw.template
            : inferComicTemplate(baseUrl)
        const id = typeof raw.id === 'string' ? raw.id : ''
        const exists = nextComicSources.some((s) => (id && s.id === id) || s.baseUrl === baseUrl)
        if (exists) continue
        let newId =
          id && !nextComicSources.some((s) => s.id === id)
            ? id
            : newComicSourceId(baseUrl, nextComicSources)
        let n = 2
        while (nextComicSources.some((s) => s.id === newId)) {
          newId = newComicSourceId(baseUrl, nextComicSources) + `_${n++}`
        }
        nextComicSources.push({
          id: newId,
          name: String(raw.name ?? '').trim() || vodHost(baseUrl),
          baseUrl,
          template,
          enabled: raw.enabled !== false,
          testStatus: 'ok',
          testMsg: '可用',
          testAt: Date.now()
        })
        comicAddedCount += 1
      }

      const nextH1Sources = [...d.h1Sources]
      let h1AddedCount = 0
      const h1Urls = new Set(nextH1Sources.map((s) => s.baseUrl))
      for (const raw of bundle.h1Sources ?? []) {
        if (!raw || typeof raw !== 'object') continue
        const baseUrl = normalizeBaseUrl(String(raw.baseUrl ?? ''))
        if (!/^https?:\/\//i.test(baseUrl) || h1Urls.has(baseUrl)) continue
        h1Urls.add(baseUrl)
        const id =
          typeof raw.id === 'string' && raw.id ? raw.id : `h1_${genSourceId(baseUrl)}`
        let newId = id
        let n = 2
        while (nextH1Sources.some((s) => s.id === newId)) newId = `${id}_${n++}`
        nextH1Sources.push({
          id: newId,
          name: String(raw.name ?? '').trim() || vodHost(baseUrl),
          baseUrl,
          enabled: raw.enabled !== false,
          region: 'proxy',
          regionManual: true,
          testStatus: 'ok',
          testMsg: '可用',
          testAt: Date.now()
        })
        h1AddedCount += 1
      }
      h1Added = h1AddedCount

      vodAdded = vodRows.length
      dramaAdded = dramaAddedCount
      trainerAdded = trainerAddedCount
      musicAdded = musicAddedCount
      novelAdded = novelAddedCount
      comicAdded = comicAddedCount

      const nextLivePlatformSources = [...d.livePlatformSources]
      let livePlatformAddedCount = 0
      const livePlatformUrls = new Set(nextLivePlatformSources.map((s) => s.baseUrl))
      const livePlatformKinds = new Set(
        nextLivePlatformSources
          .map((source) => livePlatformOfSource(source))
          .filter((platform): platform is NonNullable<typeof platform> => !!platform)
      )
      for (const raw of bundle.livePlatformSources ?? []) {
        if (!raw || typeof raw !== 'object') continue
        const baseUrl = normalizeBaseUrl(String(raw.baseUrl ?? ''))
        if (!/^https?:\/\//i.test(baseUrl) || livePlatformUrls.has(baseUrl)) continue
        const platform = livePlatformOfSource({
          id: typeof raw.id === 'string' ? raw.id : '',
          baseUrl
        })
        if (!platform || livePlatformKinds.has(platform)) continue
        livePlatformUrls.add(baseUrl)
        livePlatformKinds.add(platform)
        let id: string = platform
        let n = 2
        while (nextLivePlatformSources.some((s) => s.id === id)) id = `${platform}_${n++}`
        nextLivePlatformSources.push({
          id,
          name: String(raw.name ?? '').trim() || vodHost(baseUrl),
          baseUrl,
          enabled: raw.enabled !== false,
          region: 'cn',
          regionManual: true,
          testStatus: 'ok',
          testMsg: '可用',
          testAt: Date.now()
        })
        livePlatformAddedCount += 1
      }
      livePlatformAdded = livePlatformAddedCount

      const nextWallpaperSources = [...d.wallpaperSources]
      let wallpaperAddedCount = 0
      const wallpaperUrls = new Set(nextWallpaperSources.map((s) => s.baseUrl))
      for (const raw of bundle.wallpaperSources ?? []) {
        if (!raw || typeof raw !== 'object') continue
        const baseUrl = normalizeBaseUrl(String(raw.baseUrl ?? ''))
        if (!/^https?:\/\//i.test(baseUrl) || wallpaperUrls.has(baseUrl)) continue
        // 导出文件里的模板优先，避免同一模板的自定义镜像因域名不含关键字被误判 / 丢弃
        const template = isWallpaperTemplate(raw.template)
          ? raw.template
          : inferWallpaperTemplate(baseUrl)
        if (!template) continue
        wallpaperUrls.add(baseUrl)
        const baseId = `wp_${genSourceId(baseUrl)}`
        let id = baseId
        let n = 2
        while (nextWallpaperSources.some((s) => s.id === id)) id = `${baseId}_${n++}`
        nextWallpaperSources.push({
          id,
          name: String(raw.name ?? '').trim() || vodHost(baseUrl),
          baseUrl,
          template,
          enabled: raw.enabled !== false,
          testStatus: 'ok',
          testMsg: '可用',
          testAt: Date.now()
        })
        wallpaperAddedCount += 1
      }
      wallpaperAdded = wallpaperAddedCount

      const nextMeituSources = [...d.meituSources]
      let meituAddedCount = 0
      const meituUrls = new Set(nextMeituSources.map((s) => s.baseUrl))
      for (const raw of bundle.meituSources ?? []) {
        if (!raw || typeof raw !== 'object') continue
        const baseUrl = normalizeBaseUrl(String(raw.baseUrl ?? ''))
        if (!/^https?:\/\//i.test(baseUrl) || meituUrls.has(baseUrl)) continue
        // 导出文件里的模板优先，自定义镜像不必再靠域名猜站点
        const template = isMeituTemplate(raw.template)
          ? raw.template
          : inferMeituTemplate(baseUrl)
        if (!template) continue
        meituUrls.add(baseUrl)
        const baseId = `mt_${genSourceId(baseUrl)}`
        let id = baseId
        let n = 2
        while (nextMeituSources.some((s) => s.id === id)) id = `${baseId}_${n++}`
        nextMeituSources.push({
          id,
          name: String(raw.name ?? '').trim() || vodHost(baseUrl),
          baseUrl,
          template,
          enabled: raw.enabled !== false,
          testStatus: 'ok',
          testMsg: '可用',
          testAt: Date.now()
        })
        meituAddedCount += 1
      }
      meituAdded = meituAddedCount

      const nextShuangkanSources = [...d.shuangkanSources]
      let shuangkanAddedCount = 0
      const shuangkanUrls = new Set(nextShuangkanSources.map((s) => s.baseUrl))
      for (const raw of bundle.shuangkanSources ?? []) {
        if (!raw || typeof raw !== 'object') continue
        const baseUrl = normalizeBaseUrl(String(raw.baseUrl ?? ''))
        if (!/^https?:\/\//i.test(baseUrl) || shuangkanUrls.has(baseUrl)) continue
        shuangkanUrls.add(baseUrl)
        const baseId = `sk_${genSourceId(baseUrl)}`
        let id = baseId
        let n = 2
        while (nextShuangkanSources.some((s) => s.id === id)) id = `${baseId}_${n++}`
        nextShuangkanSources.push({
          id,
          name: String(raw.name ?? '').trim() || vodHost(baseUrl),
          baseUrl,
          enabled: raw.enabled !== false,
          ...(isSkAdapter(raw.adapter) ? { adapter: raw.adapter } : {}),
          testStatus: null,
          testMsg: null,
          testAt: 0
        })
        shuangkanAddedCount += 1
      }
      shuangkanAdded = shuangkanAddedCount

      return {
        ...d,
        vodSources: [...d.vodSources, ...vodRows],
        dramaSources: nextDramaSources,
        trainerSources: nextTrainerSources,
        musicSources: nextMusicSources,
        novelSources: nextNovelSources,
        comicSources: nextComicSources,
        h1Sources: nextH1Sources,
        livePlatformSources: nextLivePlatformSources,
        wallpaperSources: nextWallpaperSources,
        meituSources: nextMeituSources,
        shuangkanSources: nextShuangkanSources
      }
    })

    const currentLive = liveRef.current ?? liveSources ?? []
    const liveUrls = new Set(currentLive.map((s) => s.url))
    const liveRows: LiveSource[] = []
    for (const raw of bundle.liveSources) {
      if (!raw || typeof raw !== 'object') continue
      const url = String(raw.url ?? '').trim()
      if (!url || liveUrls.has(url)) continue
      if (!/^https?:\/\//i.test(url) && !url.startsWith('local://')) continue
      liveUrls.add(url)
      const baseId = newLiveSourceId(url)
      let id = baseId
      let n = 2
      while (currentLive.some((s) => s.id === id) || liveRows.some((s) => s.id === id)) {
        id = `${baseId}_${n++}`
      }
      liveRows.push({
        id,
        name: String(raw.name ?? '').trim() || '直播源',
        url,
        content: typeof raw.content === 'string' ? raw.content : '',
        enabled: raw.enabled !== false,
        testStatus: 'ok',
        testMsg: '可用',
        testAt: Date.now()
      })
    }
    if (liveRows.length) persistLive([...currentLive, ...liveRows])

    let magnetAdded = 0
    try {
      const state = await window.laozheng.magnetState()
      const urls = new Set(state.sources.map((s) => s.searchUrl))
      const ids = new Set(state.sources.map((s) => s.id))
      const magnetRows: MagnetSource[] = []
      for (const raw of bundle.magnetSources) {
        if (!raw || typeof raw !== 'object') continue
        const source = raw as Partial<MagnetSource>
        const searchUrl = typeof source.searchUrl === 'string' ? source.searchUrl.trim() : ''
        if (!searchUrl || urls.has(searchUrl) || !searchUrl.includes('{keyword}')) continue
        urls.add(searchUrl)
        const baseId =
          typeof source.id === 'string' && source.id
            ? source.id
            : `magnet_${Date.now().toString(36)}`
        let id = baseId
        let n = 2
        while (ids.has(id)) id = `${baseId}_${n++}`
        ids.add(id)
        magnetRows.push({
          ...(source as MagnetSource),
          id,
          name: String(source.name ?? '').trim() || searchUrl,
          searchUrl,
          enabled: source.enabled !== false,
          testStatus: 'ok',
          testMsg: '可用',
          testAt: Date.now()
        })
      }
      if (magnetRows.length) {
        const next = await window.laozheng.saveMagnetSources([
          ...state.sources,
          ...magnetRows
        ])
        magnetAdded = Math.max(0, next.sources.length - state.sources.length)
        setMagnetKey((value) => value + 1)
      }
    } catch (err) {
      onNotice(`磁力源导入失败：${(err as Error).message}`)
    }

    if (
      !vodAdded &&
      !dramaAdded &&
      !liveRows.length &&
      !magnetAdded &&
      !trainerAdded &&
      !musicAdded &&
      !novelAdded &&
      !comicAdded &&
      !h1Added &&
      !livePlatformAdded &&
      !wallpaperAdded &&
      !meituAdded &&
      !shuangkanAdded
    ) {
      onNotice('没有新增源（地址都已存在）')
      return
    }
    // 源配置变了：清掉各模块的列表缓存，避免下次进入还显示旧源的列表
    clearModuleCaches()
    onNotice(
      `已导入：影视源 ${vodAdded} · 短剧源 ${dramaAdded} · 小说源 ${novelAdded} · 漫画源 ${comicAdded} · 番号源 ${h1Added} · 直播源 ${livePlatformAdded} · 电视源 ${liveRows.length} · 磁力源 ${magnetAdded} · 补丁源 ${trainerAdded} · 音乐源 ${musicAdded} · 壁纸源 ${wallpaperAdded} · 套图源 ${meituAdded} · 皇片源 ${shuangkanAdded}`
    )
  }

  const vodOk = sources.filter((s) => s.testStatus === 'ok').length
  const vodBad = sources.filter((s) => !!s.testStatus && s.testStatus !== 'ok').length
  const vodEnabled = sources.filter((s) => s.enabled).length
  const liveOk = (liveSources ?? []).filter((s) => s.testStatus === 'ok').length
  const liveBad = (liveSources ?? []).filter((s) => s.testStatus === 'failed').length
  const liveEnabled = (liveSources ?? []).filter((s) => s.enabled).length
  const dramaOk = data.dramaSources.filter((s) => s.testStatus === 'ok').length
  const dramaBad = data.dramaSources.filter((s) => s.testStatus === 'failed').length
  const dramaEnabled = data.dramaSources.filter((s) => s.enabled).length
  const novelOk = data.novelSources.filter((s) => s.testStatus === 'ok').length
  const novelBad = data.novelSources.filter((s) => s.testStatus === 'bad').length
  const novelEnabled = data.novelSources.filter((s) => s.enabled).length
  const comicOk = data.comicSources.filter((s) => s.testStatus === 'ok').length
  const comicBad = data.comicSources.filter((s) => s.testStatus === 'bad').length
  const comicEnabled = data.comicSources.filter((s) => s.enabled).length
  const trainerOk = data.trainerSources.filter((s) => s.testStatus === 'ok').length
  const trainerBad = data.trainerSources.filter((s) => s.testStatus === 'bad').length
  const trainerEnabled = data.trainerSources.filter((s) => s.enabled).length
  const musicOk = data.musicSources.filter((s) => s.testStatus === 'ok').length
  const musicBad = data.musicSources.filter((s) => s.testStatus === 'bad').length
  const musicEnabled = data.musicSources.filter((s) => s.enabled).length
  // ---------- 壁纸源（Wallspic / 壁纸迷站点模板） ----------

  const patchWallpaper = (id: string, patch: Partial<WallpaperSource>) => {
    update((d) => ({
      ...d,
      wallpaperSources: d.wallpaperSources.map((source) =>
        source.id === id ? { ...source, ...patch } : source
      )
    }))
  }

  const runWallpaperTest = async (
    source: WallpaperSource
  ): Promise<{ status: 'ok' | 'bad'; msg: string }> => {
    const latency = probeLatency(source.baseUrl)
    try {
      const res = await window.laozheng.wallpaperCategories(toWallpaperSourceRef(source), 'pc')
      const status: 'ok' | 'bad' = res.ok ? 'ok' : 'bad'
      const msg = withMs(
        res.ok ? `可用 · ${res.categories?.length ?? 0} 个分类` : res.error ?? '不可用',
        await latency
      )
      patchWallpaper(source.id, { testStatus: status, testMsg: msg, testAt: Date.now() })
      return { status, msg }
    } catch (err) {
      const msg = withMs((err as Error).message || '测试失败', await latency)
      patchWallpaper(source.id, { testStatus: 'bad', testMsg: msg, testAt: Date.now() })
      return { status: 'bad', msg }
    }
  }

  const testWallpaper = async (source: WallpaperSource) => {
    if (testingWallpaperId) return
    setTestingWallpaperId(source.id)
    const res = await runWallpaperTest(source)
    setTestingWallpaperId(null)
    onNotice(`「${source.name}」${res.status === 'ok' ? '可用' : `不可用：${res.msg}`}`)
  }

  const testAllWallpaper = async () => {
    if (testingWallpaperAll || data.wallpaperSources.length === 0) return
    setTestingWallpaperAll(true)
    let ok = 0
    let bad = 0
    for (const entry of data.wallpaperSources) {
      setTestingWallpaperId(entry.id)
      const res = await runWallpaperTest(entry)
      if (res.status === 'ok') ok += 1
      else bad += 1
    }
    setTestingWallpaperId(null)
    setTestingWallpaperAll(false)
    onNotice(`壁纸源测试完成：可用 ${ok} 个 · 不可用 ${bad} 个`)
  }

  const saveWallpaperSource = (input: WallpaperSourceInput) => {
    if (!(editingWallpaper === 'new' || editingWallpaper)) return
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    if (!input.name.trim() || !/^https?:\/\//i.test(baseUrl)) {
      onNotice('壁纸源名称和站点地址不能为空')
      return
    }
    const name = input.name.trim()
    if (
      data.wallpaperSources.some(
        (source) => source.id !== input.id && source.baseUrl === baseUrl
      )
    ) {
      onNotice('该壁纸源地址已经存在')
      return
    }
    if (editingWallpaper === 'new') {
      update((d) => {
        const baseId = `wp_${genSourceId(baseUrl)}`
        let id = baseId
        let n = 2
        while (d.wallpaperSources.some((source) => source.id === id)) {
          id = `${baseId}_${n++}`
        }
        return {
          ...d,
          wallpaperSources: [
            ...d.wallpaperSources,
            {
              id,
              name,
              baseUrl,
              template: input.template,
              enabled: true,
              testStatus: 'ok',
              testMsg: '可用',
              testAt: Date.now()
            }
          ]
        }
      })
      onNotice(`已添加壁纸源「${name}」`)
    } else {
      const current = editingWallpaper
      const changed = current.baseUrl !== baseUrl || current.template !== input.template
      update((d) => ({
        ...d,
        wallpaperSources: d.wallpaperSources.map((source) =>
          source.id === current.id
            ? {
                ...source,
                name,
                baseUrl,
                template: input.template,
                testStatus: changed ? null : source.testStatus,
                testMsg: changed ? null : source.testMsg,
                testAt: changed ? 0 : source.testAt
              }
            : source
        )
      }))
      onNotice(`已保存壁纸源「${name}」`)
    }
    setEditingWallpaper(null)
  }

  const importWallpaperSources = (inputs: VodSourceInput[]) => {
    const urls = new Set(data.wallpaperSources.map((source) => source.baseUrl))
    const ids = new Set(data.wallpaperSources.map((source) => source.id))
    const fresh: WallpaperSource[] = []
    let skipped = 0
    for (const input of inputs) {
      const baseUrl = normalizeBaseUrl(input.baseUrl)
      if (!/^https?:\/\//i.test(baseUrl) || urls.has(baseUrl)) {
        skipped += 1
        continue
      }
      const template = inferWallpaperTemplate(baseUrl)
      if (!template) {
        skipped += 1
        continue
      }
      urls.add(baseUrl)
      const baseId = `wp_${genSourceId(baseUrl)}`
      let id = baseId
      let n = 2
      while (ids.has(id)) id = `${baseId}_${n++}`
      ids.add(id)
      fresh.push({
        id,
        name: input.name.trim() || vodHost(baseUrl),
        baseUrl,
        template,
        enabled: true,
        testStatus: 'ok',
        testMsg: '可用',
        testAt: Date.now()
      })
    }
    if (!fresh.length) {
      onNotice('没有可导入的壁纸源（地址已存在或不是 Wallspic / 壁纸迷站点）')
      setImportingWallpaper(false)
      return
    }
    update((d) => ({ ...d, wallpaperSources: [...d.wallpaperSources, ...fresh] }))
    onNotice(`已导入 ${fresh.length} 个壁纸源${skipped ? ` · 跳过 ${skipped} 个` : ''}`)
    setImportingWallpaper(false)
  }

  const exportWallpaper = async (): Promise<void> => {
    if (!data.wallpaperSources.length) {
      onNotice('还没有可导出的壁纸源')
      return
    }
    const res = await window.laozheng.exportWallpaperSources(
      data.wallpaperSources.map((source) => ({
        id: source.id,
        name: source.name,
        baseUrl: source.baseUrl,
        template: source.template,
        enabled: source.enabled
      }))
    )
    if (res.canceled) return
    if (res.error) {
      onNotice(`导出失败：${res.error}`)
      return
    }
    onNotice(`已导出 ${res.count ?? 0} 个壁纸源到 ${res.path}`)
  }

  const removeWallpaperSource = () => {
    if (!deletingWallpaper) return
    update((d) => ({
      ...d,
      wallpaperSources: d.wallpaperSources.filter((source) => source.id !== deletingWallpaper.id)
    }))
    onNotice(`已删除壁纸源「${deletingWallpaper.name}」`)
    setDeletingWallpaper(null)
  }

  const wallpaperOk = data.wallpaperSources.filter((s) => s.testStatus === 'ok').length
  const wallpaperBad = data.wallpaperSources.filter(
    (s) => !!s.testStatus && s.testStatus !== 'ok'
  ).length
  const wallpaperEnabled = data.wallpaperSources.filter((s) => s.enabled).length

  // ---------- 套图源（魅影画廊 / 雪月映画） ----------

  const patchMeitu = (id: string, patch: Partial<MeituSource>) => {
    update((d) => ({
      ...d,
      meituSources: d.meituSources.map((source) =>
        source.id === id ? { ...source, ...patch } : source
      )
    }))
  }

  const runMeituTest = async (
    source: MeituSource
  ): Promise<{ status: 'ok' | 'bad'; msg: string }> => {
    const latency = probeLatency(source.baseUrl)
    try {
      const res = await window.laozheng.meituCategories(toMeituSourceRef(source))
      const status: 'ok' | 'bad' = res.ok ? 'ok' : 'bad'
      const msg = withMs(
        res.ok
          ? `可用 · ${res.categories?.filter((entry) => entry.id).length ?? 0} 个分类`
          : res.error ?? '不可用',
        await latency
      )
      patchMeitu(source.id, { testStatus: status, testMsg: msg, testAt: Date.now() })
      return { status, msg }
    } catch (err) {
      const msg = withMs((err as Error).message || '测试失败', await latency)
      patchMeitu(source.id, { testStatus: 'bad', testMsg: msg, testAt: Date.now() })
      return { status: 'bad', msg }
    }
  }

  const testMeitu = async (source: MeituSource) => {
    if (testingMeituId) return
    setTestingMeituId(source.id)
    const res = await runMeituTest(source)
    setTestingMeituId(null)
    onNotice(`「${source.name}」${res.status === 'ok' ? '可用' : `不可用：${res.msg}`}`)
  }

  const testAllMeitu = async () => {
    if (testingMeituAll || data.meituSources.length === 0) return
    setTestingMeituAll(true)
    let ok = 0
    let bad = 0
    for (const entry of data.meituSources) {
      setTestingMeituId(entry.id)
      const res = await runMeituTest(entry)
      if (res.status === 'ok') ok += 1
      else bad += 1
    }
    setTestingMeituId(null)
    setTestingMeituAll(false)
    onNotice(`套图源测试完成：可用 ${ok} 个 · 不可用 ${bad} 个`)
  }

  const saveMeituSource = (input: MeituSourceInput) => {
    if (!(editingMeitu === 'new' || editingMeitu)) return
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    if (!input.name.trim() || !/^https?:\/\//i.test(baseUrl)) {
      onNotice('套图源名称和站点地址不能为空')
      return
    }
    const name = input.name.trim()
    if (
      data.meituSources.some(
        (source) => source.id !== input.id && source.baseUrl === baseUrl
      )
    ) {
      onNotice('该套图源地址已经存在')
      return
    }
    if (editingMeitu === 'new') {
      update((d) => {
        const baseId = `mt_${genSourceId(baseUrl)}`
        let id = baseId
        let n = 2
        while (d.meituSources.some((source) => source.id === id)) {
          id = `${baseId}_${n++}`
        }
        return {
          ...d,
          meituSources: [
            ...d.meituSources,
            {
              id,
              name,
              baseUrl,
              template: input.template,
              enabled: true,
              testStatus: 'ok',
              testMsg: '可用',
              testAt: Date.now()
            }
          ]
        }
      })
      onNotice(`已添加套图源「${name}」`)
    } else {
      const current = editingMeitu
      const changed = current.baseUrl !== baseUrl || current.template !== input.template
      update((d) => ({
        ...d,
        meituSources: d.meituSources.map((source) =>
          source.id === current.id
            ? {
                ...source,
                name,
                baseUrl,
                template: input.template,
                testStatus: changed ? null : source.testStatus,
                testMsg: changed ? null : source.testMsg,
                testAt: changed ? 0 : source.testAt
              }
            : source
        )
      }))
      onNotice(`已保存套图源「${name}」`)
    }
    setEditingMeitu(null)
  }

  const importMeituSources = (inputs: VodSourceInput[]) => {
    const urls = new Set(data.meituSources.map((source) => source.baseUrl))
    const ids = new Set(data.meituSources.map((source) => source.id))
    const fresh: MeituSource[] = []
    let skipped = 0
    for (const input of inputs) {
      const baseUrl = normalizeBaseUrl(input.baseUrl)
      if (!/^https?:\/\//i.test(baseUrl) || urls.has(baseUrl)) {
        skipped += 1
        continue
      }
      const template = inferMeituTemplate(baseUrl)
      if (!template) {
        skipped += 1
        continue
      }
      urls.add(baseUrl)
      const baseId = `mt_${genSourceId(baseUrl)}`
      let id = baseId
      let n = 2
      while (ids.has(id)) id = `${baseId}_${n++}`
      ids.add(id)
      fresh.push({
        id,
        name: input.name.trim() || vodHost(baseUrl),
        baseUrl,
        template,
        enabled: true,
        testStatus: 'ok',
        testMsg: '可用',
        testAt: Date.now()
      })
    }
    if (!fresh.length) {
      onNotice('没有可导入的套图源（地址已存在或不是魅影画廊 / 雪月映画站点）')
      setImportingMeitu(false)
      return
    }
    update((d) => ({ ...d, meituSources: [...d.meituSources, ...fresh] }))
    onNotice(`已导入 ${fresh.length} 个套图源${skipped ? ` · 跳过 ${skipped} 个` : ''}`)
    setImportingMeitu(false)
  }

  const exportMeitu = async (): Promise<void> => {
    if (!data.meituSources.length) {
      onNotice('还没有可导出的套图源')
      return
    }
    const res = await window.laozheng.exportMeituSources(
      data.meituSources.map((source) => ({
        id: source.id,
        name: source.name,
        baseUrl: source.baseUrl,
        template: source.template,
        enabled: source.enabled
      }))
    )
    if (res.canceled) return
    if (res.error) {
      onNotice(`导出失败：${res.error}`)
      return
    }
    onNotice(`已导出 ${res.count ?? 0} 个套图源到 ${res.path}`)
  }

  const removeMeituSource = () => {
    if (!deletingMeitu) return
    update((d) => ({
      ...d,
      meituSources: d.meituSources.filter((source) => source.id !== deletingMeitu.id)
    }))
    onNotice(`已删除套图源「${deletingMeitu.name}」`)
    setDeletingMeitu(null)
  }

  const meituOk = data.meituSources.filter((s) => s.testStatus === 'ok').length
  const meituBad = data.meituSources.filter(
    (s) => !!s.testStatus && s.testStatus !== 'ok'
  ).length
  const meituEnabled = data.meituSources.filter((s) => s.enabled).length

  // ---------- 皇片源（肉视频站点） ----------

  const patchShuangkan = (id: string, patch: Partial<ShuangkanSource>) => {
    update((d) => ({
      ...d,
      shuangkanSources: d.shuangkanSources.map((source) =>
        source.id === id ? { ...source, ...patch } : source
      )
    }))
  }

  const runShuangkanTest = async (
    source: ShuangkanSource
  ): Promise<{ status: 'ok' | 'bad'; msg: string }> => {
    const latency = probeLatency(source.baseUrl)
    try {
      const res = await window.laozheng.shuangkanCatalog(
        toShuangkanSourceRef(source),
        'video',
        '',
        1
      )
      const status: 'ok' | 'bad' = res.ok ? 'ok' : 'bad'
      const msg = withMs(
        res.ok ? `可用 · 首页 ${res.items.length} 条` : res.error ?? '不可用',
        await latency
      )
      patchShuangkan(source.id, { testStatus: status, testMsg: msg, testAt: Date.now() })
      return { status, msg }
    } catch (err) {
      const msg = withMs((err as Error).message || '测试失败', await latency)
      patchShuangkan(source.id, { testStatus: 'bad', testMsg: msg, testAt: Date.now() })
      return { status: 'bad', msg }
    }
  }

  const testShuangkan = async (source: ShuangkanSource) => {
    if (testingShuangkanId) return
    setTestingShuangkanId(source.id)
    const res = await runShuangkanTest(source)
    setTestingShuangkanId(null)
    onNotice(`「${source.name}」${res.status === 'ok' ? '可用' : `不可用：${res.msg}`}`)
  }

  const testAllShuangkan = async () => {
    if (testingShuangkanAll || data.shuangkanSources.length === 0) return
    setTestingShuangkanAll(true)
    let ok = 0
    let bad = 0
    for (const entry of data.shuangkanSources) {
      setTestingShuangkanId(entry.id)
      const res = await runShuangkanTest(entry)
      if (res.status === 'ok') ok += 1
      else bad += 1
    }
    setTestingShuangkanId(null)
    setTestingShuangkanAll(false)
    onNotice(`皇片源测试完成：可用 ${ok} 个 · 不可用 ${bad} 个`)
  }

  const saveShuangkanSource = (input: {
    name: string
    baseUrl: string
    id?: string
    adapter?: SkAdapter
  }) => {
    if (!(editingShuangkan === 'new' || editingShuangkan)) return
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    if (!input.name.trim() || !/^https?:\/\//i.test(baseUrl)) {
      onNotice('皇片源名称和站点地址不能为空')
      return
    }
    const name = input.name.trim()
    const adapter = input.adapter ?? inferSkAdapter(baseUrl)
    if (
      data.shuangkanSources.some(
        (source) => source.id !== input.id && source.baseUrl === baseUrl
      )
    ) {
      onNotice('该皇片源地址已经存在')
      return
    }
    if (editingShuangkan === 'new') {
      update((d) => {
        const baseId = `sk_${genSourceId(baseUrl)}`
        let id = baseId
        let n = 2
        while (d.shuangkanSources.some((source) => source.id === id)) {
          id = `${baseId}_${n++}`
        }
        return {
          ...d,
          shuangkanSources: [
            ...d.shuangkanSources,
            {
              id,
              name,
              baseUrl,
              adapter,
              enabled: true,
              testStatus: null,
              testMsg: null,
              testAt: 0
            }
          ]
        }
      })
      onNotice(`已添加皇片源「${name}」`)
    } else {
      const current = editingShuangkan
      const changed = current.baseUrl !== baseUrl
      update((d) => ({
        ...d,
        shuangkanSources: d.shuangkanSources.map((source) =>
          source.id === current.id
            ? {
                ...source,
                name,
                baseUrl,
                adapter,
                testStatus: changed ? null : source.testStatus,
                testMsg: changed ? null : source.testMsg,
                testAt: changed ? 0 : source.testAt
              }
            : source
        )
      }))
      onNotice(`已保存皇片源「${name}」`)
    }
    setEditingShuangkan(null)
  }

  const importShuangkanSources = (inputs: VodSourceInput[]) => {
    const existing = new Set(data.shuangkanSources.map((source) => source.baseUrl))
    const fresh = inputs.filter((input) => {
      const baseUrl = normalizeBaseUrl(input.baseUrl)
      return /^https?:\/\//i.test(baseUrl) && !existing.has(baseUrl)
    })
    if (!fresh.length) {
      onNotice('这些皇片源已存在')
      setImportingShuangkan(false)
      return
    }
    update((d) => {
      const next = [...d.shuangkanSources]
      const urls = new Set(next.map((source) => source.baseUrl))
      const added: ShuangkanSource[] = []
      for (const input of fresh) {
        const baseUrl = normalizeBaseUrl(input.baseUrl)
        if (urls.has(baseUrl)) continue
        urls.add(baseUrl)
        added.push({
          id: newShuangkanSourceId(baseUrl, [...next, ...added]),
          name: input.name || vodHost(baseUrl),
          baseUrl,
          enabled: true,
          testStatus: null,
          testMsg: null,
          testAt: 0
        })
      }
      return { ...d, shuangkanSources: [...next, ...added] }
    })
    onNotice(`已导入 ${fresh.length} 个皇片源`)
    setImportingShuangkan(false)
  }

  const exportShuangkan = async (): Promise<void> => {
    const rows = data.shuangkanSources.map((source) => ({
      id: source.id,
      name: source.name,
      baseUrl: source.baseUrl,
      enabled: source.enabled
    }))
    if (!rows.length) {
      onNotice('还没有可导出的皇片源')
      return
    }
    const res = await window.laozheng.exportShuangkanSources(rows)
    if (res.canceled) return
    if (res.error) {
      onNotice(`导出失败：${res.error}`)
      return
    }
    onNotice(`已导出 ${res.count ?? 0} 个皇片源到 ${res.path}`)
  }

  const removeShuangkanSource = () => {
    if (!deletingShuangkan) return
    update((d) => ({
      ...d,
      shuangkanSources: d.shuangkanSources.filter(
        (source) => source.id !== deletingShuangkan.id
      )
    }))
    onNotice(`已删除皇片源「${deletingShuangkan.name}」`)
    setDeletingShuangkan(null)
  }

  const shuangkanOk = data.shuangkanSources.filter((s) => s.testStatus === 'ok').length
  const shuangkanBad = data.shuangkanSources.filter(
    (s) => !!s.testStatus && s.testStatus !== 'ok'
  ).length
  const shuangkanEnabled = data.shuangkanSources.filter((s) => s.enabled).length

  const livePlatformOk = data.livePlatformSources.filter((s) => s.testStatus === 'ok').length
  const livePlatformBad = data.livePlatformSources.filter(
    (s) => !!s.testStatus && s.testStatus !== 'ok'
  ).length
  const livePlatformEnabled = data.livePlatformSources.filter((s) => s.enabled).length

  return (
    <div className="settings">
      <div className="settings-row" style={{ justifyContent: 'flex-start', gap: 8 }}>
        <button className="btn primary" onClick={() => void importAllSources()}>
          <Upload size={15} /> 整体导入
        </button>
        <button className="btn" onClick={() => void exportAllSources()}>
          <Download size={15} /> 整体导出
        </button>
      </div>

      <SourceCard
        title="影视源"
        summary={sourceSummary(sources.length, vodEnabled, vodOk, vodBad)}
        open={vodOpen}
        onToggle={() => setVodOpen((value) => !value)}
      >
        <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Plus size={15} /> 添加源
          </button>
          <button className="btn" onClick={() => setImporting(true)}>
            <Upload size={15} /> 批量导入
          </button>
          <button
            className="btn"
            disabled={testingAll || sources.length === 0}
            onClick={() => void testAllSources()}
          >
            <RefreshCw size={15} /> {testingAll ? '测试中…' : '整体测试'}
          </button>
          <PreferredSortButton
            disabled={sources.length < 2}
            onSort={() => update((d) => ({ ...d, vodSources: byPreferredOrder(d.vodSources) }))}
          />
          <button className="btn" disabled={sources.length === 0} onClick={() => void exportSources()}>
            <Download size={15} /> 导出
          </button>
        </div>

        {sources.length === 0 ? (
          <EmptyState title="还没有片源" desc="可以导入内置片源，或粘贴自己的苹果CMS采集接口。" />
        ) : (
          <div className="rows" style={{ marginTop: 10 }}>
            {sources.map((s) => (
              <div key={s.id} className="row">
                <span
                  className={`status-dot ${s.enabled ? (s.testStatus === 'ok' ? 'ok' : s.testStatus ? 'warn' : '') : 'off'}`}
                />
                <div className="row-main">
                  <div className="row-title">{s.name}</div>
                  <div className="row-meta">{vodHost(s.baseUrl)}</div>
                  <div className="row-meta">{testMsgText(s.testMsg)}</div>
                </div>
                <button className="btn" disabled={testingId === s.id} onClick={() => void testSource(s)}>
                  <RefreshCw size={14} /> {testingId === s.id ? '测试中…' : '测试'}
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    update((d) => ({
                      ...d,
                      vodSources: d.vodSources.map((x) =>
                        x.id === s.id ? { ...x, enabled: !x.enabled } : x
                      )
                    }))
                  }
                >
                  {s.enabled ? '停用' : '启用'}
                </button>
                <button className="icon-btn" title="编辑" onClick={() => setEditing(s)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-btn danger" title="删除" onClick={() => setDeleting(s)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </SourceCard>

      <SourceCard
        title="短剧源"
        summary={sourceSummary(
          data.dramaSources.length,
          dramaEnabled,
          dramaOk,
          dramaBad
        )}
        open={dramaOpen}
        onToggle={() => setDramaOpen((value) => !value)}
      >
        <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn primary" onClick={() => setEditingDrama('new')}>
            <Plus size={15} /> 添加源
          </button>
          <button className="btn" onClick={() => setImportingDrama(true)}>
            <Upload size={15} /> 批量导入
          </button>
          <button
            className="btn"
            disabled={testingDramaAll || data.dramaSources.length === 0}
            onClick={() => void testAllDrama()}
          >
            <RefreshCw size={15} /> {testingDramaAll ? '测试中…' : '整体测试'}
          </button>
          <PreferredSortButton
            disabled={data.dramaSources.length < 2}
            onSort={() =>
              update((d) => ({ ...d, dramaSources: byPreferredOrder(d.dramaSources) }))
            }
          />
          <button
            className="btn"
            disabled={data.dramaSources.length === 0}
            onClick={() => void exportDrama()}
          >
            <Download size={15} /> 导出
          </button>
        </div>

        {data.dramaSources.length === 0 ? (
          <div className="settings-hint" style={{ marginTop: 12 }}>
            还没有短剧源，点「添加源」或「批量导入」。
          </div>
        ) : (
          <div className="rows" style={{ marginTop: 10 }}>
            {data.dramaSources.map((source) => (
              <div key={source.id} className="row">
                <span
                  className={`status-dot ${
                    !source.enabled
                      ? 'off'
                      : source.testStatus
                        ? source.testStatus === 'ok'
                          ? 'ok'
                          : 'warn'
                        : ''
                  }`}
                />
                <div className="row-main">
                  <div className="row-title">{source.name}</div>
                  <div className="row-meta">
                    {source.builtin
                      ? vodHost(
                          source.baseUrl ??
                            (source.id === ROU07_DRAMA_SOURCE_ID
                              ? ROU07_DRAMA_BASE_URL
                              : XIFAN_DRAMA_BASE_URL)
                        )
                      : vodHost(source.baseUrl ?? '')}
                  </div>
                  <div className="row-meta">{testMsgText(source.testMsg)}</div>
                </div>
                <button
                  className="btn"
                  disabled={testingDramaId === source.id}
                  onClick={() => void testDramaSource(source)}
                >
                  <RefreshCw size={14} /> {testingDramaId === source.id ? '测试中…' : '测试'}
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    update((d) => ({
                      ...d,
                      dramaSources: d.dramaSources.map((item) =>
                        item.id === source.id ? { ...item, enabled: !item.enabled } : item
                      )
                    }))
                  }
                >
                  {source.enabled ? '停用' : '启用'}
                </button>
                <button className="icon-btn" title="修改" onClick={() => setEditingDrama(source)}>
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn danger"
                  title="删除"
                  onClick={() => setDeletingDrama(source)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </SourceCard>

      <SourceCard
        title="电视源"
        summary={sourceSummary(liveSources?.length ?? 0, liveEnabled, liveOk, liveBad)}
        open={liveOpen}
        onToggle={() => setLiveOpen((value) => !value)}
      >
        <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn primary" onClick={() => setAddingLive(true)}>
            <Plus size={15} /> 添加源
          </button>
          <button className="btn" onClick={() => void importLiveFile()}>
            <Upload size={15} /> 批量导入
          </button>
          <button
            className="btn"
            disabled={testingLiveAll || !liveSources || liveSources.length === 0}
            onClick={() => void testAllLive()}
          >
            <RefreshCw size={15} /> {testingLiveAll ? '测试中…' : '整体测试'}
          </button>
          <PreferredSortButton
            disabled={!liveSources || liveSources.length < 2}
            onSort={() => {
              if (liveSources) persistLive(byPreferredOrder(liveSources))
            }}
          />
          <button
            className="btn"
            disabled={!liveSources || liveSources.length === 0}
            onClick={() => void exportLive()}
          >
            <Download size={15} /> 导出
          </button>
        </div>

        {liveSources === null ? (
          <div className="settings-hint" style={{ marginTop: 12 }}>
            正在读取电视源…
          </div>
        ) : liveSources.length === 0 ? (
          <div className="settings-hint" style={{ marginTop: 12 }}>
            还没有电视源。
          </div>
        ) : (
          <div className="rows" style={{ marginTop: 10 }}>
            {liveSources.map((s) => {
              return (
                <div key={s.id} className="row">
                  <span
                    className={`status-dot ${
                      !s.enabled
                        ? 'off'
                        : s.testStatus
                          ? s.testStatus === 'ok'
                            ? 'ok'
                            : 'warn'
                          : ''
                    }`}
                  />
                  <div className="row-main">
                    <div className="row-title">{s.name}</div>
                    <div className="row-meta">
                      {s.url.startsWith('local://') ? '本地导入' : s.url}
                    </div>
                    <div className="row-meta">{testMsgText(s.testMsg)}</div>
                  </div>
                  <button
                    className="btn"
                    disabled={testingLiveId === s.id}
                    onClick={() => void testLive(s)}
                  >
                    <RefreshCw size={14} /> {testingLiveId === s.id ? '测试中…' : '测试'}
                  </button>
                  <button
                    className="btn"
                    onClick={() => patchLive(s.id, { enabled: !s.enabled })}
                  >
                    {s.enabled ? '停用' : '启用'}
                  </button>
                  <button className="icon-btn" title="修改" onClick={() => setEditingLive(s)}>
                    <Pencil size={14} />
                  </button>
                  <button className="icon-btn danger" title="删除" onClick={() => setDeletingLive(s)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </SourceCard>

      <SourceCard
        title="直播源"
        summary={sourceSummary(
          data.livePlatformSources.length,
          livePlatformEnabled,
          livePlatformOk,
          livePlatformBad
        )}
        open={livePlatformOpen}
        onToggle={() => setLivePlatformOpen((value) => !value)}
      >
        <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn primary" onClick={() => setEditingLivePlatform('new')}>
            <Plus size={15} /> 添加源
          </button>
          <button className="btn" onClick={() => setImportingLivePlatform(true)}>
            <Upload size={15} /> 批量导入
          </button>
          <button
            className="btn"
            disabled={testingLivePlatformAll || data.livePlatformSources.length === 0}
            onClick={() => void testAllLivePlatform()}
          >
            <RefreshCw size={15} /> {testingLivePlatformAll ? '测试中…' : '整体测试'}
          </button>
          <PreferredSortButton
            disabled={data.livePlatformSources.length < 2}
            onSort={() =>
              update((d) => ({
                ...d,
                livePlatformSources: byPreferredOrder(d.livePlatformSources)
              }))
            }
          />
          <button
            className="btn"
            disabled={data.livePlatformSources.length === 0}
            onClick={() => void exportLivePlatform()}
          >
            <Download size={15} /> 导出
          </button>
        </div>

        {data.livePlatformSources.length === 0 ? (
          <div className="settings-hint" style={{ marginTop: 12 }}>
            还没有直播源，点「添加源」或「批量导入」；只支持 B站 / 斗鱼 / 抖音 的站点地址。
          </div>
        ) : (
          <div className="rows" style={{ marginTop: 10 }}>
            {data.livePlatformSources.map((source) => (
              <div key={source.id} className="row">
                <span
                  className={`status-dot ${
                    !source.enabled
                      ? 'off'
                      : source.testStatus
                        ? source.testStatus === 'ok'
                          ? 'ok'
                          : 'warn'
                        : ''
                  }`}
                />
                <div className="row-main">
                  <div className="row-title">{source.name}</div>
                  <div className="row-meta">{vodHost(source.baseUrl)}</div>
                  <div className="row-meta">{testMsgText(source.testMsg)}</div>
                </div>
                <button
                  className="btn"
                  disabled={testingLivePlatformId === source.id}
                  onClick={() => void testLivePlatform(source)}
                >
                  <RefreshCw size={14} />{' '}
                  {testingLivePlatformId === source.id ? '测试中…' : '测试'}
                </button>
                <button
                  className="btn"
                  onClick={() => patchLivePlatform(source.id, { enabled: !source.enabled })}
                >
                  {source.enabled ? '停用' : '启用'}
                </button>
                <button
                  className="icon-btn"
                  title="修改"
                  onClick={() => setEditingLivePlatform(source)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn danger"
                  title="删除"
                  onClick={() => setDeletingLivePlatform(source)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </SourceCard>

      <SourceCard
        title="音乐源"
        summary={sourceSummary(
          data.musicSources.length,
          musicEnabled,
          musicOk,
          musicBad
        )}
        open={musicOpen}
        onToggle={() => setMusicOpen((value) => !value)}
      >
        <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn primary" onClick={() => setEditingMusic('new')}>
            <Plus size={15} /> 添加源
          </button>
          <button className="btn" onClick={() => setImportingMusic(true)}>
            <Upload size={15} /> 批量导入
          </button>
          <button
            className="btn"
            disabled={testingMusicAll || data.musicSources.length === 0}
            onClick={() => void testAllMusic()}
          >
            <RefreshCw size={15} /> {testingMusicAll ? '测试中…' : '整体测试'}
          </button>
          <PreferredSortButton
            disabled={data.musicSources.length < 2}
            onSort={() =>
              update((d) => ({ ...d, musicSources: byPreferredOrder(d.musicSources) }))
            }
          />
          <button
            className="btn"
            disabled={data.musicSources.length === 0}
            onClick={() => void exportMusic()}
          >
            <Download size={15} /> 导出
          </button>
        </div>

        {data.musicSources.length === 0 ? (
          <div className="settings-hint" style={{ marginTop: 12 }}>
            还没有音乐源，点「添加源」。
          </div>
        ) : (
          <div className="rows" style={{ marginTop: 10 }}>
            {data.musicSources.map((source) => (
              <div key={source.id} className="row">
                <span
                  className={`status-dot ${
                    !source.enabled
                      ? 'off'
                      : source.testStatus
                        ? source.testStatus === 'ok'
                          ? 'ok'
                          : 'warn'
                        : ''
                  }`}
                />
                <div className="row-main">
                  <div className="row-title">{source.name}</div>
                  <div className="row-meta">
                    当前：{musicLineName(source.baseUrl) || '自定义线路'} ·{' '}
                    {vodHost(source.baseUrl)} · {testMsgText(source.testMsg)}
                  </div>
                  {source.backup ? (
                    <div className="row-meta">
                      备用：{source.backup.name} · {vodHost(source.backup.baseUrl)} ·{' '}
                      {source.backup.enabled ? testMsgText(source.backup.testMsg) : '已停用'}
                    </div>
                  ) : null}
                </div>
                {source.backup ? (
                  <button
                    className="icon-btn"
                    title={`测试备用线路（${source.backup.name}）`}
                    disabled={testingMusicBackupId === source.id}
                    onClick={() => void testMusicBackup(source)}
                  >
                    <RefreshCw size={14} />
                  </button>
                ) : null}
                <button
                  className="btn"
                  disabled={testingMusicId === source.id}
                  onClick={() => void testMusic(source)}
                >
                  <RefreshCw size={14} /> {testingMusicId === source.id ? '测试中…' : '测试'}
                </button>
                <button
                  className="btn"
                  onClick={() => patchMusic(source.id, { enabled: !source.enabled })}
                >
                  {source.enabled ? '停用' : '启用'}
                </button>
                <button className="icon-btn" title="修改" onClick={() => setEditingMusic(source)}>
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn danger"
                  title="删除"
                  onClick={() => setDeletingMusic(source)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </SourceCard>

      <SourceCard
        title="漫画源"
        summary={sourceSummary(data.comicSources.length, comicEnabled, comicOk, comicBad)}
        open={comicOpen}
        onToggle={() => setComicOpen((value) => !value)}
      >
        <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn primary" onClick={() => setEditingComic('new')}>
            <Plus size={15} /> 添加源
          </button>
          <button className="btn" onClick={() => setImportingComic(true)}>
            <Upload size={15} /> 批量导入
          </button>
          <button
            className="btn"
            disabled={testingComicAll || data.comicSources.length === 0}
            onClick={() => void testAllComic()}
          >
            <RefreshCw size={15} /> {testingComicAll ? '测试中…' : '整体测试'}
          </button>
          <PreferredSortButton
            disabled={data.comicSources.length < 2}
            onSort={() =>
              update((d) => ({ ...d, comicSources: byPreferredOrder(d.comicSources) }))
            }
          />
          <button
            className="btn"
            disabled={data.comicSources.length === 0}
            onClick={() => void exportComic()}
          >
            <Download size={15} /> 导出
          </button>
        </div>

        {data.comicSources.length === 0 ? (
          <div className="settings-hint" style={{ marginTop: 12 }}>
            还没有漫画源，点「添加源」或「批量导入」。内置漫画客、Komiic、哔咔与头牌。
          </div>
        ) : (
          <div className="rows" style={{ marginTop: 10 }}>
            {data.comicSources.map((source) => (
              <div key={source.id} className="row">
                <span
                  className={`status-dot ${
                    !source.enabled
                      ? 'off'
                      : source.testStatus
                        ? source.testStatus === 'ok'
                          ? 'ok'
                          : 'warn'
                        : ''
                  }`}
                />
                <div className="row-main">
                  <div className="row-title">{source.name}</div>
                  <div className="row-meta">
                    {vodHost(source.baseUrl)} ·{' '}
                    {source.template === 'komiic'
                      ? 'Komiic 接口'
                      : source.template === 'bikahub'
                        ? '哔咔模板'
                        : source.template === 'tptoon'
                          ? '头牌模板'
                          : source.template === 'jmcomic'
                            ? '禁漫模板'
                            : '漫画客模板'}
                  </div>
                  <div className="row-meta">{testMsgText(source.testMsg)}</div>
                </div>
                <button
                  className="btn"
                  disabled={testingComicId === source.id}
                  onClick={() => void testComic(source)}
                >
                  <RefreshCw size={14} /> {testingComicId === source.id ? '测试中…' : '测试'}
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    update((d) => ({
                      ...d,
                      comicSources: d.comicSources.map((item) =>
                        item.id === source.id ? { ...item, enabled: !item.enabled } : item
                      )
                    }))
                  }
                >
                  {source.enabled ? '停用' : '启用'}
                </button>
                <button className="icon-btn" title="修改" onClick={() => setEditingComic(source)}>
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn danger"
                  title="删除"
                  onClick={() => setDeletingComic(source)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </SourceCard>

      <SourceCard
        title="小说源"
        summary={sourceSummary(
          data.novelSources.length,
          novelEnabled,
          novelOk,
          novelBad
        )}
        open={novelOpen}
        onToggle={() => setNovelOpen((value) => !value)}
      >
        <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn primary" onClick={() => setEditingNovel('new')}>
            <Plus size={15} /> 添加源
          </button>
          <button className="btn" onClick={() => setImportingNovel(true)}>
            <Upload size={15} /> 批量导入
          </button>
          <button
            className="btn"
            disabled={testingNovelAll || data.novelSources.length === 0}
            onClick={() => void testAllNovel()}
          >
            <RefreshCw size={15} /> {testingNovelAll ? '测试中…' : '整体测试'}
          </button>
          <PreferredSortButton
            disabled={data.novelSources.length < 2}
            onSort={() =>
              update((d) => ({ ...d, novelSources: byPreferredOrder(d.novelSources) }))
            }
          />
          <button
            className="btn"
            disabled={data.novelSources.length === 0}
            onClick={() => void exportNovel()}
          >
            <Download size={15} /> 导出
          </button>
        </div>

        {data.novelSources.length === 0 ? (
          <div className="settings-hint" style={{ marginTop: 12 }}>
            还没有小说源，点「添加源」或「批量导入」。默认已内置多个免费书源。
          </div>
        ) : (
          <div className="rows" style={{ marginTop: 10 }}>
            {data.novelSources.map((source) => (
              <div key={source.id} className="row">
                <span
                  className={`status-dot ${
                    !source.enabled
                      ? 'off'
                      : source.testStatus
                        ? source.testStatus === 'ok'
                          ? 'ok'
                          : 'warn'
                        : ''
                  }`}
                />
                <div className="row-main">
                  <div className="row-title">{source.name}</div>
                  <div className="row-meta">
                    {vodHost(source.baseUrl)} · {NOVEL_SOURCE_TEMPLATE_LABEL[source.template]}
                  </div>
                  <div className="row-meta">{testMsgText(source.testMsg)}</div>
                </div>
                <button
                  className="btn"
                  disabled={testingNovelId === source.id}
                  onClick={() => void testNovel(source)}
                >
                  <RefreshCw size={14} /> {testingNovelId === source.id ? '测试中…' : '测试'}
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    update((d) => ({
                      ...d,
                      novelSources: d.novelSources.map((item) =>
                        item.id === source.id ? { ...item, enabled: !item.enabled } : item
                      )
                    }))
                  }
                >
                  {source.enabled ? '停用' : '启用'}
                </button>
                <button className="icon-btn" title="修改" onClick={() => setEditingNovel(source)}>
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn danger"
                  title="删除"
                  onClick={() => setDeletingNovel(source)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </SourceCard>

      <SourceCard
        title="补丁源"
        summary={sourceSummary(
          data.trainerSources.length,
          trainerEnabled,
          trainerOk,
          trainerBad
        )}
        open={trainerOpen}
        onToggle={() => setTrainerOpen((value) => !value)}
      >
        <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn primary" onClick={() => setEditingTrainer('new')}>
            <Plus size={15} /> 添加源
          </button>
          <button className="btn" onClick={() => setImportingTrainer(true)}>
            <Upload size={15} /> 批量导入
          </button>
          <button
            className="btn"
            disabled={testingTrainerAll || data.trainerSources.length === 0}
            onClick={() => void testAllTrainer()}
          >
            <RefreshCw size={15} /> {testingTrainerAll ? '测试中…' : '整体测试'}
          </button>
          <PreferredSortButton
            disabled={data.trainerSources.length < 2}
            onSort={() =>
              update((d) => ({ ...d, trainerSources: byPreferredOrder(d.trainerSources) }))
            }
          />
          <button
            className="btn"
            disabled={data.trainerSources.length === 0}
            onClick={() => void exportTrainer()}
          >
            <Download size={15} /> 导出
          </button>
        </div>

        {data.trainerSources.length === 0 ? (
          <div className="settings-hint" style={{ marginTop: 12 }}>
            还没有补丁源，点「添加源」。
          </div>
        ) : (
          <div className="rows" style={{ marginTop: 10 }}>
            {data.trainerSources.map((source) => (
              <div key={source.id} className="row">
                <span
                  className={`status-dot ${
                    !source.enabled
                      ? 'off'
                      : source.testStatus
                        ? source.testStatus === 'ok'
                          ? 'ok'
                          : 'warn'
                        : ''
                  }`}
                />
                <div className="row-main">
                  <div className="row-title">{source.name}</div>
                  <div className="row-meta">{vodHost(source.baseUrl)}</div>
                  <div className="row-meta">{testMsgText(source.testMsg)}</div>
                </div>
                <button
                  className="btn"
                  disabled={testingTrainerId === source.id}
                  onClick={() => void testTrainer(source)}
                >
                  <RefreshCw size={14} /> {testingTrainerId === source.id ? '测试中…' : '测试'}
                </button>
                <button
                  className="btn"
                  onClick={() => patchTrainer(source.id, { enabled: !source.enabled })}
                >
                  {source.enabled ? '停用' : '启用'}
                </button>
                <button
                  className="icon-btn"
                  title="修改"
                  onClick={() => setEditingTrainer(source)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn danger"
                  title="删除"
                  onClick={() => setDeletingTrainer(source)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </SourceCard>

      {/* 磁力源并入片源管理，不再单独占配置管理入口 */}
      <MagnetSettings key={magnetKey} onNotice={onNotice} />

      <SourceCard
        title="壁纸源"
        summary={sourceSummary(
          data.wallpaperSources.length,
          wallpaperEnabled,
          wallpaperOk,
          wallpaperBad
        )}
        open={wallpaperOpen}
        onToggle={() => setWallpaperOpen((value) => !value)}
      >
        <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn primary" onClick={() => setEditingWallpaper('new')}>
            <Plus size={15} /> 添加源
          </button>
          <button className="btn" onClick={() => setImportingWallpaper(true)}>
            <Upload size={15} /> 批量导入
          </button>
          <button
            className="btn"
            disabled={testingWallpaperAll || data.wallpaperSources.length === 0}
            onClick={() => void testAllWallpaper()}
          >
            <RefreshCw size={15} /> {testingWallpaperAll ? '测试中…' : '整体测试'}
          </button>
          <PreferredSortButton
            disabled={data.wallpaperSources.length < 2}
            onSort={() =>
              update((d) => ({
                ...d,
                wallpaperSources: byPreferredOrder(d.wallpaperSources)
              }))
            }
          />
          <button
            className="btn"
            disabled={data.wallpaperSources.length === 0}
            onClick={() => void exportWallpaper()}
          >
            <Download size={15} /> 导出
          </button>
        </div>

        {data.wallpaperSources.length === 0 ? (
          <EmptyState
            title="还没有壁纸源"
            desc="点「添加源」或「批量导入」；壁纸源支持 Wallspic / 壁纸迷 两种站点模板。"
          />
        ) : (
          <div className="rows" style={{ marginTop: 10 }}>
            {data.wallpaperSources.map((source) => (
              <div className="row" key={source.id}>
                <span
                  className={`status-dot ${
                    source.enabled
                      ? source.testStatus === 'ok'
                        ? 'ok'
                        : source.testStatus
                          ? 'warn'
                          : ''
                      : 'off'
                  }`}
                />
                <div className="row-main">
                  <div className="row-title">{source.name}</div>
                  <div className="row-meta">
                    {vodHost(source.baseUrl)} · {wallpaperTemplateLabel(source.template)}
                  </div>
                  <div className="row-meta">{testMsgText(source.testMsg)}</div>
                </div>
                <button
                  className="btn"
                  disabled={testingWallpaperId === source.id}
                  onClick={() => void testWallpaper(source)}
                >
                  <RefreshCw size={14} />{' '}
                  {testingWallpaperId === source.id ? '测试中…' : '测试'}
                </button>
                <button
                  className="btn"
                  onClick={() => patchWallpaper(source.id, { enabled: !source.enabled })}
                >
                  {source.enabled ? '停用' : '启用'}
                </button>
                <button
                  className="icon-btn"
                  title="修改"
                  onClick={() => setEditingWallpaper(source)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn danger"
                  title="删除"
                  onClick={() => setDeletingWallpaper(source)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </SourceCard>

      <SourceCard
        title="套图源"
        summary={sourceSummary(data.meituSources.length, meituEnabled, meituOk, meituBad)}
        open={meituOpen}
        onToggle={() => setMeituOpen((value) => !value)}
      >
        <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn primary" onClick={() => setEditingMeitu('new')}>
            <Plus size={15} /> 添加源
          </button>
          <button className="btn" onClick={() => setImportingMeitu(true)}>
            <Upload size={15} /> 批量导入
          </button>
          <button
            className="btn"
            disabled={testingMeituAll || data.meituSources.length === 0}
            onClick={() => void testAllMeitu()}
          >
            <RefreshCw size={15} /> {testingMeituAll ? '测试中…' : '整体测试'}
          </button>
          <PreferredSortButton
            disabled={data.meituSources.length < 2}
            onSort={() =>
              update((d) => ({ ...d, meituSources: byPreferredOrder(d.meituSources) }))
            }
          />
          <button
            className="btn"
            disabled={data.meituSources.length === 0}
            onClick={() => void exportMeitu()}
          >
            <Download size={15} /> 导出
          </button>
        </div>

        {data.meituSources.length === 0 ? (
          <EmptyState
            title="还没有套图源"
            desc="点「添加源」或「批量导入」；套图源支持魅影画廊 / 雪月映画 两种站点模板。"
          />
        ) : (
          <div className="rows" style={{ marginTop: 10 }}>
            {data.meituSources.map((source) => (
              <div className="row" key={source.id}>
                <span
                  className={`status-dot ${
                    source.enabled
                      ? source.testStatus === 'ok'
                        ? 'ok'
                        : source.testStatus
                          ? 'warn'
                          : ''
                      : 'off'
                  }`}
                />
                <div className="row-main">
                  <div className="row-title">{source.name}</div>
                  <div className="row-meta">
                    {vodHost(source.baseUrl)} · {meituTemplateLabel(source.template)}
                  </div>
                  <div className="row-meta">{testMsgText(source.testMsg)}</div>
                </div>
                <button
                  className="btn"
                  disabled={testingMeituId === source.id}
                  onClick={() => void testMeitu(source)}
                >
                  <RefreshCw size={14} /> {testingMeituId === source.id ? '测试中…' : '测试'}
                </button>
                <button
                  className="btn"
                  onClick={() => patchMeitu(source.id, { enabled: !source.enabled })}
                >
                  {source.enabled ? '停用' : '启用'}
                </button>
                <button
                  className="icon-btn"
                  title="修改"
                  onClick={() => setEditingMeitu(source)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn danger"
                  title="删除"
                  onClick={() => setDeletingMeitu(source)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </SourceCard>

      <SourceCard
        title="皇片源"
        summary={sourceSummary(
          data.shuangkanSources.length,
          shuangkanEnabled,
          shuangkanOk,
          shuangkanBad
        )}
        open={shuangkanOpen}
        onToggle={() => setShuangkanOpen((value) => !value)}
      >
        <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn primary" onClick={() => setEditingShuangkan('new')}>
            <Plus size={15} /> 添加源
          </button>
          <button className="btn" onClick={() => setImportingShuangkan(true)}>
            <Upload size={15} /> 批量导入
          </button>
          <button
            className="btn"
            disabled={testingShuangkanAll || data.shuangkanSources.length === 0}
            onClick={() => void testAllShuangkan()}
          >
            <RefreshCw size={15} /> {testingShuangkanAll ? '测试中…' : '整体测试'}
          </button>
          <PreferredSortButton
            disabled={data.shuangkanSources.length < 2}
            onSort={() =>
              update((d) => ({
                ...d,
                shuangkanSources: byPreferredOrder(d.shuangkanSources)
              }))
            }
          />
          <button
            className="btn"
            disabled={data.shuangkanSources.length === 0}
            onClick={() => void exportShuangkan()}
          >
            <Download size={15} /> 导出
          </button>
        </div>

        {data.shuangkanSources.length === 0 ? (
          <EmptyState
            title="还没有皇片源"
            desc="点「添加源」填肉视频站点地址；内置肉视频源删掉后也可以随时加回来。"
          />
        ) : (
          <div className="rows" style={{ marginTop: 10 }}>
            {data.shuangkanSources.map((source) => (
              <div className="row" key={source.id}>
                <span
                  className={`status-dot ${
                    source.enabled
                      ? source.testStatus === 'ok'
                        ? 'ok'
                        : source.testStatus
                          ? 'warn'
                          : ''
                      : 'off'
                  }`}
                />
                <div className="row-main">
                  <div className="row-title">{source.name}</div>
                  <div className="row-meta">{vodHost(source.baseUrl)}</div>
                  <div className="row-meta">{testMsgText(source.testMsg)}</div>
                </div>
                <button
                  className="btn"
                  disabled={testingShuangkanId === source.id}
                  onClick={() => void testShuangkan(source)}
                >
                  <RefreshCw size={14} />{' '}
                  {testingShuangkanId === source.id ? '测试中…' : '测试'}
                </button>
                <button
                  className="btn"
                  onClick={() => patchShuangkan(source.id, { enabled: !source.enabled })}
                >
                  {source.enabled ? '停用' : '启用'}
                </button>
                <button
                  className="icon-btn"
                  title="修改"
                  onClick={() => setEditingShuangkan(source)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn danger"
                  title="删除"
                  onClick={() => setDeletingShuangkan(source)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </SourceCard>

      {editing && (
        <SourceEditModal
          source={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={saveSource}
        />
      )}

      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onImport={importSources}
          onBuiltin={() => importSources(DEFAULT_VOD_SOURCES.map(toInput))}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="删除片源"
          message={`确定删除「${deleting.name}」吗？只影响本机片源配置，不影响清单数据。`}
          confirmText="删除"
          danger
          onConfirm={removeSource}
          onCancel={() => setDeleting(null)}
        />
      )}

      {editingDrama && (
        <DramaSourceModal
          source={editingDrama === 'new' ? null : editingDrama}
          onClose={() => setEditingDrama(null)}
          onSave={saveDramaSource}
        />
      )}

      {importingDrama && (
        <ImportModal
          title="批量导入短剧源"
          hint="支持每行一个「名称|接口地址」，或 KVideo 订阅 JSON。短剧源使用苹果CMS V10 接口。"
          onClose={() => setImportingDrama(false)}
          onImport={importDramaSources}
        />
      )}

      {deletingDrama && (
        <ConfirmDialog
          title="删除短剧源"
          message={`确定删除「${deletingDrama.name}」吗？只影响本机短剧源配置。`}
          confirmText="删除"
          danger
          onConfirm={removeDramaSource}
          onCancel={() => setDeletingDrama(null)}
        />
      )}

      {editingNovel && (
        <NovelSourceModal
          source={editingNovel === 'new' ? null : editingNovel}
          onClose={() => setEditingNovel(null)}
          onSave={saveNovelSource}
        />
      )}

      {deletingNovel && (
        <ConfirmDialog
          title="删除小说源"
          message={`确定删除「${deletingNovel.name}」吗？只影响本机小说源配置。`}
          confirmText="删除"
          danger
          onConfirm={removeNovelSource}
          onCancel={() => setDeletingNovel(null)}
        />
      )}

      {importingNovel && (
        <ImportModal
          title="批量导入小说源"
          hint="支持每行一个「名称|站点地址」，或 JSON 数组；地址会按站点特征自动匹配解析模板，识别不到时按蚂蚁文学处理。"
          onClose={() => setImportingNovel(false)}
          onImport={importNovelSources}
        />
      )}

      {editingComic && (
        <ComicSourceModal
          source={editingComic === 'new' ? null : editingComic}
          onClose={() => setEditingComic(null)}
          onSave={saveComicSource}
        />
      )}

      {deletingComic && (
        <ConfirmDialog
          title="删除漫画源"
          message={`确定删除「${deletingComic.name}」吗？只影响本机漫画源配置。`}
          confirmText="删除"
          danger
          onConfirm={removeComicSource}
          onCancel={() => setDeletingComic(null)}
        />
      )}

      {importingComic && (
        <ImportModal
          title="批量导入漫画源"
          hint="支持每行一个「名称|站点地址」，或 JSON 数组；地址含 komiic.com 时按 Komiic 接口处理，含 bikahub.net / bikago.net / dojqybrcm.com 时按哔咔模板处理，含 tptoon.net / tpmh*.com 时按头牌模板处理，含 18comic / jmcomic / 18mj 时按禁漫模板处理，其余按漫画客模板处理。"
          onClose={() => setImportingComic(false)}
          onImport={importComicSources}
        />
      )}

      {importingTrainer && (
        <ImportModal
          title="批量导入补丁源"
          hint="支持每行一个「名称|站点地址」，或 JSON 数组。地址属于 3DM / 游民星空 / 游侠网 时会自动识别站点类型，其余按风灵月影处理。"
          onClose={() => setImportingTrainer(false)}
          onImport={importTrainerSources}
        />
      )}

      {editingTrainer && (
        <TrainerSourceModal
          source={editingTrainer === 'new' ? null : editingTrainer}
          onClose={() => setEditingTrainer(null)}
          onSave={saveTrainerSource}
        />
      )}

      {deletingTrainer && (
        <ConfirmDialog
          title="删除补丁源"
          message={`确定删除「${deletingTrainer.name}」吗？只影响本机补丁源配置。`}
          confirmText="删除"
          danger
          onConfirm={removeTrainerSource}
          onCancel={() => setDeletingTrainer(null)}
        />
      )}

      {importingMusic && (
        <ImportModal
          title="批量导入音乐源"
          hint="支持每行一个「名称|站点地址」，或 JSON 数组。音乐源需要与无名音乐网使用同一套建站系统。"
          onClose={() => setImportingMusic(false)}
          onImport={importMusicSources}
        />
      )}

      {editingMusic && (
        <MusicSourceModal
          source={editingMusic === 'new' ? null : editingMusic}
          onClose={() => setEditingMusic(null)}
          onSave={saveMusicSource}
        />
      )}

      {deletingMusic && (
        <ConfirmDialog
          title="删除音乐源"
          message={`确定删除「${deletingMusic.name}」吗？只影响本机音乐源配置。`}
          confirmText="删除"
          danger
          onConfirm={removeMusicSource}
          onCancel={() => setDeletingMusic(null)}
        />
      )}

      {addingLive && (
        <LiveSourceModal onClose={() => setAddingLive(false)} onSave={addLiveSource} />
      )}

      {editingLive && (
        <LiveSourceModal
          title="修改电视源"
          initial={editingLive}
          onClose={() => setEditingLive(null)}
          onSave={saveLiveSource}
        />
      )}

      {deletingLive && (
        <ConfirmDialog
          title="删除电视源"
          message={`确定删除「${deletingLive.name}」吗？只影响本机电视源配置。`}
          confirmText="删除"
          danger
          onConfirm={removeLiveSource}
          onCancel={() => setDeletingLive(null)}
        />
      )}

      {editingLivePlatform && (
        <SourceEditModal
          source={editingLivePlatform === 'new' ? null : editingLivePlatform}
          onClose={() => setEditingLivePlatform(null)}
          onSave={saveLivePlatformSource}
        />
      )}

      {importingLivePlatform && (
        <ImportModal
          title="批量导入直播源"
          hint="支持每行一个「名称|站点地址」，或 JSON 数组；地址需属于 B站 / 斗鱼 / 抖音。"
          onClose={() => setImportingLivePlatform(false)}
          onImport={importLivePlatformSources}
          onBuiltin={() => importLivePlatformSources(DEFAULT_LIVE_PLATFORM_SOURCES.map(toInput))}
        />
      )}

      {deletingLivePlatform && (
        <ConfirmDialog
          title="删除直播源"
          message={`确定删除「${deletingLivePlatform.name}」吗？只影响本机直播源配置。`}
          confirmText="删除"
          danger
          onConfirm={removeLivePlatformSource}
          onCancel={() => setDeletingLivePlatform(null)}
        />
      )}

      {editingWallpaper && (
        <WallpaperSourceModal
          source={editingWallpaper === 'new' ? null : editingWallpaper}
          onClose={() => setEditingWallpaper(null)}
          onSave={saveWallpaperSource}
        />
      )}

      {importingWallpaper && (
        <ImportModal
          title="批量导入壁纸源"
          hint="支持每行一个「名称|站点地址」，或 JSON 数组。只支持 Wallspic（wallspic.com）和壁纸迷（bizhimi.cn）两种站点模板，其它地址会自动跳过。"
          onClose={() => setImportingWallpaper(false)}
          onImport={importWallpaperSources}
        />
      )}

      {deletingWallpaper && (
        <ConfirmDialog
          title="删除壁纸源"
          message={`确定删除「${deletingWallpaper.name}」吗？只影响本机壁纸源配置。`}
          confirmText="删除"
          danger
          onConfirm={removeWallpaperSource}
          onCancel={() => setDeletingWallpaper(null)}
        />
      )}

      {editingMeitu && (
        <MeituSourceModal
          source={editingMeitu === 'new' ? null : editingMeitu}
          onClose={() => setEditingMeitu(null)}
          onSave={saveMeituSource}
        />
      )}

      {importingMeitu && (
        <ImportModal
          title="批量导入套图源"
          hint="支持每行一个「名称|站点地址」，或 JSON 数组。只支持魅影画廊（jb9.es）和雪月映画（taoo.xyz）两种站点模板，其它地址会自动跳过。"
          onClose={() => setImportingMeitu(false)}
          onImport={importMeituSources}
        />
      )}

      {deletingMeitu && (
        <ConfirmDialog
          title="删除套图源"
          message={`确定删除「${deletingMeitu.name}」吗？只影响本机套图源配置。`}
          confirmText="删除"
          danger
          onConfirm={removeMeituSource}
          onCancel={() => setDeletingMeitu(null)}
        />
      )}

      {importingShuangkan && (
        <ImportModal
          title="批量导入皇片源"
          hint="支持每行一个「名称|站点地址」，或导出后的 JSON。站点地址形如 https://rou07.net。"
          onClose={() => setImportingShuangkan(false)}
          onImport={importShuangkanSources}
        />
      )}

      {editingShuangkan && (
        <ShuangkanSourceModal
          source={editingShuangkan === 'new' ? null : editingShuangkan}
          onClose={() => setEditingShuangkan(null)}
          onSave={saveShuangkanSource}
        />
      )}

      {deletingShuangkan && (
        <ConfirmDialog
          title="删除皇片源"
          message={`确定删除「${deletingShuangkan.name}」吗？只影响本机皇片源配置。`}
          confirmText="删除"
          danger
          onConfirm={removeShuangkanSource}
          onCancel={() => setDeletingShuangkan(null)}
        />
      )}
    </div>
  )
}

function WallpaperSourceModal({
  source,
  onClose,
  onSave
}: {
  source: WallpaperSource | null
  onClose: () => void
  onSave: (input: WallpaperSourceInput) => void
}) {
  const [template, setTemplate] = useState<WallpaperSourceTemplate>(
    source?.template ?? 'wallspic'
  )
  const [name, setName] = useState(source?.name ?? WALLPAPER_SOURCE_TEMPLATES[0].name)
  const [baseUrl, setBaseUrl] = useState(
    source?.baseUrl ?? WALLPAPER_SOURCE_TEMPLATES[0].homepage
  )
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())
  const info = WALLPAPER_SOURCE_TEMPLATES.find((entry) => entry.id === template)

  const pickTemplate = (next: WallpaperSourceTemplate) => {
    const prev = WALLPAPER_SOURCE_TEMPLATES.find((entry) => entry.id === template)
    const target = WALLPAPER_SOURCE_TEMPLATES.find((entry) => entry.id === next)
    if (!target) return
    setTemplate(next)
    // 没改过默认名称 / 地址时跟着模板走，避免用户选错模板后还留着旧站点
    if (!name.trim() || (prev && name.trim() === prev.name)) setName(target.name)
    if (!baseUrl.trim() || (prev && baseUrl.trim() === prev.homepage)) setBaseUrl(target.homepage)
  }

  return (
    <Modal
      title={source ? '修改壁纸源' : '添加壁纸源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() =>
              onSave({
                ...(source ? { id: source.id } : {}),
                name: name.trim(),
                baseUrl: baseUrl.trim(),
                template
              })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={info?.name ?? '壁纸源名称'}
          />
        </label>
        <label>
          站点模板
          <select
            value={template}
            onChange={(e) => pickTemplate(e.target.value as WallpaperSourceTemplate)}
          >
            {WALLPAPER_SOURCE_TEMPLATES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          站点地址
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={info?.homepage ?? 'https://wallspic.com/cn'}
          />
        </label>
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        壁纸源按站点模板解析页面；同一模板可以添加镜像地址，修改地址后建议重新测试一次。
      </p>
    </Modal>
  )
}

function MeituSourceModal({
  source,
  onClose,
  onSave
}: {
  source: MeituSource | null
  onClose: () => void
  onSave: (input: MeituSourceInput) => void
}) {
  const [template, setTemplate] = useState<MeituSourceTemplate>(source?.template ?? 'jb9')
  const [name, setName] = useState(source?.name ?? MEITU_SOURCE_TEMPLATES[0].name)
  const [baseUrl, setBaseUrl] = useState(
    source?.baseUrl ?? MEITU_SOURCE_TEMPLATES[0].homepage
  )
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())
  const info = MEITU_SOURCE_TEMPLATES.find((entry) => entry.id === template)

  const pickTemplate = (next: MeituSourceTemplate) => {
    const prev = MEITU_SOURCE_TEMPLATES.find((entry) => entry.id === template)
    const target = MEITU_SOURCE_TEMPLATES.find((entry) => entry.id === next)
    if (!target) return
    setTemplate(next)
    // 没改过默认名称 / 地址时跟着模板走
    if (!name.trim() || (prev && name.trim() === prev.name)) setName(target.name)
    if (!baseUrl.trim() || (prev && baseUrl.trim() === prev.homepage)) setBaseUrl(target.homepage)
  }

  return (
    <Modal
      title={source ? '修改套图源' : '添加套图源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() =>
              onSave({
                ...(source ? { id: source.id } : {}),
                name: name.trim(),
                baseUrl: baseUrl.trim(),
                template
              })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={info?.name ?? '套图源名称'}
          />
        </label>
        <label>
          站点模板
          <select
            value={template}
            onChange={(e) => pickTemplate(e.target.value as MeituSourceTemplate)}
          >
            {MEITU_SOURCE_TEMPLATES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          站点地址
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={info?.homepage ?? 'https://www.jb9.es'}
          />
        </label>
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        魅影画廊建议填入口地址 https://www.jb9.es（会自动选择可用线路），也可以直接填镜像站；雪月映画填 https://taoo.xyz。修改地址后建议重新测试一次。
      </p>
    </Modal>
  )
}

function ShuangkanSourceModal({
  source,
  onClose,
  onSave
}: {
  source: ShuangkanSource | null
  onClose: () => void
  onSave: (input: { id?: string; name: string; baseUrl: string; adapter?: SkAdapter }) => void
}) {
  const [name, setName] = useState(source?.name ?? '肉视频')
  const [baseUrl, setBaseUrl] = useState(source?.baseUrl ?? SK_DEFAULT_BASE)
  // 优选地址按源类型查询；从下拉里选中镜像时一并保存，避免 x123 / xv123 这类短域名推断错站点
  const [adapter] = useState<SkAdapter>(
    source?.adapter ?? inferSkAdapter(source?.baseUrl ?? SK_DEFAULT_BASE)
  )
  const [pickedAdapter, setPickedAdapter] = useState<SkAdapter | null>(null)
  const [mirrors, setMirrors] = useState<SkMirrorOption[] | null>(null)
  const [mirrorMeasured, setMirrorMeasured] = useState(false)
  const [mirrorError, setMirrorError] = useState<string | null>(null)
  const [mirrorLoading, setMirrorLoading] = useState(false)
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())

  /** measure=false 优先用上次测速缓存；点刷新按钮才 measure=true 重新测速并写回缓存 */
  const loadMirrors = useCallback(
    async (measure = false) => {
      const cacheKey = `sk:${adapter}`
      const cached = measure ? null : readMirrorLatency(cacheKey)
      if (cached) {
        setMirrors(cached.mirrors)
        setMirrorMeasured(true)
        setMirrorError(null)
        setMirrorLoading(false)
        return
      }
      setMirrorLoading(true)
      setMirrorError(null)
      try {
        const res = await window.laozheng.shuangkanMirrors(adapter, measure)
        setMirrors(res.mirrors ?? [])
        setMirrorMeasured(!!res.measured)
        if (!res.ok) {
          setMirrorError(res.error ?? '读取导航站优选地址失败')
        } else if (measure) {
          writeMirrorLatency(cacheKey, res.mirrors)
        }
      } catch (err) {
        setMirrorError((err as Error).message || '读取导航站优选地址失败')
        if (!measure) {
          setMirrors([])
          setMirrorMeasured(false)
        }
      } finally {
        setMirrorLoading(false)
      }
    },
    [adapter]
  )

  useEffect(() => {
    void loadMirrors(false)
  }, [loadMirrors])

  const current = baseUrl.trim().replace(/\/+$/, '')
  const selected = (mirrors ?? []).some((entry) => entry.url === current) ? current : ''

  return (
    <Modal
      title={source ? '修改皇片源' : '添加皇片源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() =>
              onSave({
                ...(source ? { id: source.id } : {}),
                name: name.trim(),
                baseUrl: baseUrl.trim(),
                ...(pickedAdapter ? { adapter: pickedAdapter } : {})
              })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="肉视频" />
        </label>
        <label>
          站点地址
          <input
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value)
              setPickedAdapter(null)
            }}
            placeholder={SK_DEFAULT_BASE}
          />
        </label>
        <label>
          优选地址（{SK_ADAPTER_LABEL[adapter]} · 延迟）
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select
              value={selected}
              disabled={mirrorLoading || !(mirrors ?? []).length}
              onChange={(event) => {
                const url = event.target.value
                if (!url) return
                setBaseUrl(url)
                setPickedAdapter(adapter)
              }}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="">
                {mirrorLoading
                  ? '正在读取…'
                  : (mirrors ?? []).length
                    ? mirrorMeasured
                      ? `选择线路（共 ${(mirrors ?? []).length} 条，按延迟排序）`
                      : `选择线路（共 ${(mirrors ?? []).length} 条，点刷新测速）`
                    : '暂无线路'}
              </option>
              {(mirrors ?? []).map((entry) => (
                <option key={entry.url} value={entry.url}>
                  {entry.url.replace(/^https?:\/\//, '').replace(/\/+$/, '')}
                  {mirrorMeasured
                    ? ` · ${entry.ms != null ? `${entry.ms}ms` : '超时'}`
                    : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-btn"
              title="测速"
              disabled={mirrorLoading || !(mirrors ?? []).length}
              onClick={() => void loadMirrors(true)}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </label>
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        {mirrorError ? `优选地址读取失败：${mirrorError}。` : ''}
        选择线路时不会自动测速，点右侧刷新按钮才逐个测延迟；地址失效时仍会自动到导航站换址。
      </p>
    </Modal>
  )
}

function SourceEditModal({
  source,
  onClose,
  onSave
}: {
  source: VodSource | null
  onClose: () => void
  onSave: (input: VodSourceInput) => void
}) {
  const [name, setName] = useState(source?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(source?.baseUrl ?? '')
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())

  return (
    <Modal
      title={source ? '编辑源' : '添加源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() =>
              onSave({
                id: source?.id ?? genSourceId(baseUrl.trim()),
                name: name.trim(),
                baseUrl: baseUrl.trim()
              })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：非凡资源" />
        </label>
        <label>
          接口地址
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://example.com/api.php/provide/vod"
          />
        </label>
      </div>
    </Modal>
  )
}

function DramaSourceModal({
  source,
  onClose,
  onSave
}: {
  source: DramaSource | null
  onClose: () => void
  onSave: (input: VodSourceInput) => void
}) {
  const rou07 = source?.id === ROU07_DRAMA_SOURCE_ID
  const [name, setName] = useState(source?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(
    source?.baseUrl ??
      (source?.builtin ? (rou07 ? ROU07_DRAMA_BASE_URL : XIFAN_DRAMA_BASE_URL) : '')
  )
  // 肉视频短剧与皇片里的肉视频是同一个站点：复用导航站优选地址（按延迟选线路）
  const [mirrors, setMirrors] = useState<SkMirrorOption[] | null>(null)
  const [mirrorMeasured, setMirrorMeasured] = useState(false)
  const [mirrorError, setMirrorError] = useState<string | null>(null)
  const [mirrorLoading, setMirrorLoading] = useState(false)
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())

  /** measure=false 优先用上次测速缓存；点刷新按钮才 measure=true 重新测速并写回缓存 */
  const loadMirrors = useCallback(
    async (measure = false) => {
      if (!rou07) return
      const cacheKey = `sk:${ROU07_DRAMA_SOURCE_ID}`
      const cached = measure ? null : readMirrorLatency(cacheKey)
      if (cached) {
        setMirrors(cached.mirrors)
        setMirrorMeasured(true)
        setMirrorError(null)
        setMirrorLoading(false)
        return
      }
      setMirrorLoading(true)
      setMirrorError(null)
      try {
        const res = await window.laozheng.shuangkanMirrors(ROU07_DRAMA_SOURCE_ID, measure)
        setMirrors(res.mirrors ?? [])
        setMirrorMeasured(!!res.measured)
        if (!res.ok) {
          setMirrorError(res.error ?? '读取导航站优选地址失败')
        } else if (measure) {
          writeMirrorLatency(cacheKey, res.mirrors)
        }
      } catch (err) {
        setMirrorError((err as Error).message || '读取导航站优选地址失败')
        if (!measure) {
          setMirrors([])
          setMirrorMeasured(false)
        }
      } finally {
        setMirrorLoading(false)
      }
    },
    [rou07]
  )

  useEffect(() => {
    void loadMirrors(false)
  }, [loadMirrors])

  const current = baseUrl.trim().replace(/\/+$/, '')
  const selected = (mirrors ?? []).some((entry) => entry.url === current) ? current : ''

  return (
    <Modal
      title={source ? '编辑短剧源' : '添加短剧源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() =>
              onSave({
                id: source?.id ?? '',
                name: name.trim(),
                baseUrl: baseUrl.trim()
              })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：某短剧采集站" />
        </label>
        <label>
          接口地址
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://example.com/api.php/provide/vod"
          />
        </label>
        {rou07 ? (
          <label>
            优选地址（肉视频 · 延迟）
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                value={selected}
                disabled={mirrorLoading || !(mirrors ?? []).length}
                onChange={(event) => {
                  const url = event.target.value
                  if (url) setBaseUrl(url)
                }}
                style={{ flex: 1, minWidth: 0 }}
              >
                <option value="">
                  {mirrorLoading
                    ? '正在读取…'
                    : (mirrors ?? []).length
                      ? mirrorMeasured
                        ? `选择线路（共 ${(mirrors ?? []).length} 条，按延迟排序）`
                        : `选择线路（共 ${(mirrors ?? []).length} 条，点刷新测速）`
                      : '暂无线路'}
                </option>
                {(mirrors ?? []).map((entry) => (
                  <option key={entry.url} value={entry.url}>
                    {entry.url.replace(/^https?:\/\//, '').replace(/\/+$/, '')}
                    {mirrorMeasured
                      ? ` · ${entry.ms != null ? `${entry.ms}ms` : '超时'}`
                      : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                title="测速"
                disabled={mirrorLoading || !(mirrors ?? []).length}
                onClick={() => void loadMirrors(true)}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </label>
        ) : null}
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        {rou07
          ? `${mirrorError ? `优选地址读取失败：${mirrorError}。` : ''}肉视频短剧与皇片里的肉视频是同一个站点；选线路时不会自动测速，点右侧刷新按钮才逐个测延迟。`
          : source?.builtin
            ? '西饭短剧默认使用官方接口地址，也可以改成镜像地址。'
            : '短剧源使用苹果CMS V10 接口；西饭短剧不需要在这里添加。'}
      </p>
    </Modal>
  )
}

function NovelSourceModal({
  source,
  onClose,
  onSave
}: {
  source: NovelSource | null
  onClose: () => void
  onSave: (input: NovelSourceInput) => void
}) {
  const [name, setName] = useState(source?.name ?? '蚂蚁文学镜像')
  const [baseUrl, setBaseUrl] = useState(source?.baseUrl ?? '')
  const [template, setTemplate] = useState<NovelSourceTemplate>(source?.template ?? 'mayi')
  // 哔咔小说与漫画里的哔咔漫画是同一个站点：复用漫画源的 /go-home 优选地址
  const [mirrors, setMirrors] = useState<ComicMirrorOption[] | null>(null)
  const [mirrorMeasured, setMirrorMeasured] = useState(false)
  const [mirrorError, setMirrorError] = useState<string | null>(null)
  const [mirrorLoading, setMirrorLoading] = useState(false)
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())

  /** measure=false 优先用上次测速缓存；点刷新按钮才 measure=true 重新测速并写回缓存 */
  const loadMirrors = useCallback(
    async (measure = false) => {
      if (template !== 'bikahub') return
      const cacheKey = 'comic:bikahub'
      const cached = measure ? null : readMirrorLatency(cacheKey)
      if (cached) {
        setMirrors(cached.mirrors)
        setMirrorMeasured(true)
        setMirrorError(null)
        setMirrorLoading(false)
        return
      }
      setMirrorLoading(true)
      setMirrorError(null)
      try {
        const res = await window.laozheng.comicMirrors('bikahub', measure)
        setMirrors(res.mirrors ?? [])
        setMirrorMeasured(!!res.measured)
        if (!res.ok) {
          setMirrorError(res.error ?? '读取镜像地址失败')
        } else if (measure) {
          writeMirrorLatency(cacheKey, res.mirrors)
        }
      } catch (err) {
        setMirrorError((err as Error).message || '读取镜像地址失败')
        if (!measure) {
          setMirrors([])
          setMirrorMeasured(false)
        }
      } finally {
        setMirrorLoading(false)
      }
    },
    [template]
  )

  useEffect(() => {
    void loadMirrors(false)
  }, [loadMirrors])

  const current = baseUrl.trim().replace(/\/+$/, '')
  const selected = (mirrors ?? []).some((entry) => entry.url === current) ? current : ''

  return (
    <Modal
      title={source ? '编辑小说源' : '添加小说源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() =>
              onSave({
                id: source?.id ?? '',
                name: name.trim(),
                baseUrl: baseUrl.trim(),
                template
              })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：笔趣阁镜像"
          />
        </label>
        <label>
          站点地址
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://www.example.com"
          />
        </label>
        <label>
          解析模板
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value as NovelSourceTemplate)}
          >
            {NOVEL_SOURCE_TEMPLATE_OPTIONS.map((key) => (
              <option key={key} value={key}>
                {NOVEL_SOURCE_TEMPLATE_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
        {template === 'bikahub' ? (
          <label>
            优选地址（哔咔小说 · 延迟）
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                value={selected}
                disabled={mirrorLoading || !(mirrors ?? []).length}
                onChange={(event) => {
                  const url = event.target.value
                  if (url) setBaseUrl(url)
                }}
                style={{ flex: 1, minWidth: 0 }}
              >
                <option value="">
                  {mirrorLoading
                    ? '正在读取…'
                    : (mirrors ?? []).length
                      ? mirrorMeasured
                        ? `选择线路（共 ${(mirrors ?? []).length} 条，按延迟排序）`
                        : `选择线路（共 ${(mirrors ?? []).length} 条，点刷新测速）`
                      : '暂无线路'}
                </option>
                {(mirrors ?? []).map((entry) => (
                  <option key={entry.url} value={entry.url}>
                    {entry.url.replace(/^https?:\/\//, '').replace(/\/+$/, '')}
                    {mirrorMeasured
                      ? ` · ${entry.ms != null ? `${entry.ms}ms` : '超时'}`
                      : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                title="测速"
                disabled={mirrorLoading || !(mirrors ?? []).length}
                onClick={() => void loadMirrors(true)}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </label>
        ) : null}
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        {template === 'bikahub'
          ? `${mirrorError ? `优选地址读取失败：${mirrorError}。` : ''}哔咔小说与漫画里的哔咔漫画是同一个站点；选线路时不会自动测速，点右侧刷新按钮才逐个测延迟。`
          : '小说源需要与所选模板使用同一套建站系统；填站点根地址即可。添加后可点「测试」确认能否解析推荐列表。'}
      </p>
    </Modal>
  )
}

type ComicMirrorTemplate = 'jmcomic' | 'tptoon' | 'bikahub'

const COMIC_MIRROR_LABEL: Record<ComicMirrorTemplate, string> = {
  jmcomic: '禁漫天堂',
  tptoon: '头牌漫画',
  bikahub: '哔咔漫画'
}

function hasComicMirrors(template: ComicSourceTemplate): template is ComicMirrorTemplate {
  return template === 'jmcomic' || template === 'tptoon' || template === 'bikahub'
}

function ComicSourceModal({
  source,
  onClose,
  onSave
}: {
  source: ComicSource | null
  onClose: () => void
  onSave: (input: ComicSourceInput) => void
}) {
  const [name, setName] = useState(source?.name ?? '漫画客镜像')
  const [baseUrl, setBaseUrl] = useState(source?.baseUrl ?? '')
  const [template, setTemplate] = useState<ComicSourceTemplate>(source?.template ?? 'yumanhua')
  const [mirrors, setMirrors] = useState<ComicMirrorOption[] | null>(null)
  const [mirrorMeasured, setMirrorMeasured] = useState(false)
  const [mirrorLoading, setMirrorLoading] = useState(false)
  const [mirrorError, setMirrorError] = useState<string | null>(null)
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())

  /** measure=false 优先用上次测速缓存；点刷新按钮才 measure=true 重新测速并写回缓存 */
  const loadMirrors = useCallback(
    async (measure = false) => {
      if (!hasComicMirrors(template)) {
        setMirrors([])
        setMirrorMeasured(false)
        setMirrorError(null)
        return
      }
      const cacheKey = `comic:${template}`
      const cached = measure ? null : readMirrorLatency(cacheKey)
      if (cached) {
        setMirrors(cached.mirrors)
        setMirrorMeasured(true)
        setMirrorError(null)
        setMirrorLoading(false)
        return
      }
      setMirrorLoading(true)
      setMirrorError(null)
      try {
        const res = await window.laozheng.comicMirrors(template, measure)
        setMirrors(res.mirrors ?? [])
        setMirrorMeasured(!!res.measured)
        if (!res.ok) {
          setMirrorError(res.error ?? '读取镜像地址失败')
        } else if (measure) {
          writeMirrorLatency(cacheKey, res.mirrors)
        }
      } catch (err) {
        setMirrorError((err as Error).message || '读取镜像地址失败')
        if (!measure) {
          setMirrors([])
          setMirrorMeasured(false)
        }
      } finally {
        setMirrorLoading(false)
      }
    },
    [template]
  )

  useEffect(() => {
    void loadMirrors(false)
  }, [loadMirrors])

  const current = baseUrl.trim().replace(/\/+$/, '')
  const selected = (mirrors ?? []).some((entry) => entry.url === current) ? current : ''

  return (
    <Modal
      title={source ? '编辑漫画源' : '添加漫画源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() =>
              onSave({
                id: source?.id ?? '',
                name: name.trim(),
                baseUrl: baseUrl.trim(),
                template
              })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：漫画客镜像"
          />
        </label>
        <label>
          站点地址
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://www.yumanhua.com"
          />
        </label>
        <label>
          解析模板
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value as ComicSourceTemplate)}
          >
            <option value="yumanhua">漫画客</option>
            <option value="komiic">Komiic</option>
            <option value="bikahub">哔咔漫画</option>
            <option value="tptoon">头牌漫画</option>
            <option value="jmcomic">禁漫天堂</option>
          </select>
        </label>
        {hasComicMirrors(template) ? (
          <label>
            优选地址（{COMIC_MIRROR_LABEL[template]} · 延迟）
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                value={selected}
                disabled={mirrorLoading || !(mirrors ?? []).length}
                onChange={(event) => {
                  const url = event.target.value
                  if (url) setBaseUrl(url)
                }}
                style={{ flex: 1, minWidth: 0 }}
              >
                <option value="">
                  {mirrorLoading
                    ? '正在读取…'
                    : (mirrors ?? []).length
                      ? mirrorMeasured
                        ? `选择线路（共 ${(mirrors ?? []).length} 条，按延迟排序）`
                        : `选择线路（共 ${(mirrors ?? []).length} 条，点刷新测速）`
                      : '暂无线路'}
                </option>
                {(mirrors ?? []).map((entry) => (
                  <option key={entry.url} value={entry.url}>
                    {entry.url.replace(/^https?:\/\//, '').replace(/\/+$/, '')}
                    {mirrorMeasured
                      ? ` · ${entry.ms != null ? `${entry.ms}ms` : '超时'}`
                      : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                title="测速"
                disabled={mirrorLoading || !(mirrors ?? []).length}
                onClick={() => void loadMirrors(true)}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </label>
        ) : null}
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        {mirrorError ? `镜像地址读取失败：${mirrorError}。` : ''}
        漫画客 / 哔咔镜像填站点根地址；Komiic 使用官方接口，地址保留默认即可。头牌、禁漫天堂、哔咔
        的镜像来自各自的地址发布页，打开弹窗只拉列表，点右侧刷新按钮才逐个测延迟。
      </p>
    </Modal>
  )
}

function TrainerSourceModal({
  source,
  onClose,
  onSave
}: {
  source: TrainerSource | null
  onClose: () => void
  onSave: (input: { name: string; baseUrl: string; type: TrainerSourceType }) => void
}) {
  const [name, setName] = useState(source?.name ?? '风灵月影')
  const [baseUrl, setBaseUrl] = useState(source?.baseUrl ?? 'https://flingtrainer.com')
  const [type, setType] = useState<TrainerSourceType>(
    source?.type && source.type !== 'megagames' ? source.type : 'fling'
  )
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())

  return (
    <Modal
      title={source ? '编辑补丁源' : '添加补丁源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => onSave({ name: name.trim(), baseUrl: baseUrl.trim(), type })}
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：3DM 修改器"
          />
        </label>
        <label>
          站点类型
          <select
            value={type}
            onChange={(e) => setType(e.target.value as TrainerSourceType)}
          >
            <option value="fling">{TRAINER_SOURCE_TYPE_LABEL.fling}</option>
            <option value="3dm">{TRAINER_SOURCE_TYPE_LABEL['3dm']}</option>
            <option value="gamersky">{TRAINER_SOURCE_TYPE_LABEL.gamersky}</option>
            <option value="ali213">{TRAINER_SOURCE_TYPE_LABEL.ali213}</option>
          </select>
        </label>
        <label>
          列表页地址
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://flingtrainer.com"
          />
        </label>
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        风灵月影填站点根地址；3DM / 游民星空 / 游侠网 填对应分区的列表页地址（修改器或存档）。
        风灵月影和三部分区支持直接下载，网盘地址会交给浏览器打开。
      </p>
    </Modal>
  )
}

function sameMusicUrl(a?: string | null, b?: string | null): boolean {
  const norm = (value?: string | null) => (value ?? '').trim().replace(/\/+$/, '').toLowerCase()
  return !!norm(a) && norm(a) === norm(b)
}

interface MusicLineStatus {
  testStatus: 'ok' | 'bad' | null
  testMsg: string | null
  testAt: number
}

function backupFromLine(line: MusicSourceLine, status?: MusicLineStatus): MusicSourceBackup {
  return {
    id: line.id,
    name: line.name,
    baseUrl: line.baseUrl,
    enabled: true,
    testStatus: status?.testStatus ?? null,
    testMsg: status?.testMsg ?? null,
    testAt: status?.testAt ?? 0
  }
}

function MusicSourceModal({
  source,
  onClose,
  onSave
}: {
  source: MusicSource | null
  onClose: () => void
  onSave: (input: {
    name: string
    baseUrl: string
    backup: MusicSourceBackup | null
    primaryStatus?: MusicLineStatus
  }) => void
}) {
  const initialBase = source?.baseUrl ?? MUSIC_SOURCE_LINES[0].baseUrl
  const [name, setName] = useState(source?.name ?? '无名闪闪音乐')
  const [baseUrl, setBaseUrl] = useState(initialBase)
  const [backup, setBackup] = useState<MusicSourceBackup | null>(() => {
    if (source?.backup) return { ...source.backup }
    const other = MUSIC_SOURCE_LINES.find((line) => !sameMusicUrl(line.baseUrl, initialBase))
    return other ? backupFromLine(other) : null
  })
  const [lineStatus, setLineStatus] = useState<Record<string, MusicLineStatus>>(() => {
    const out: Record<string, MusicLineStatus> = {}
    if (source) {
      out[source.baseUrl] = {
        testStatus: source.testStatus,
        testMsg: source.testMsg,
        testAt: source.testAt
      }
      if (source.backup) {
        out[source.backup.baseUrl] = {
          testStatus: source.backup.testStatus,
          testMsg: source.backup.testMsg,
          testAt: source.backup.testAt
        }
      }
    }
    return out
  })
  const [testing, setTesting] = useState(false)
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())

  /** 备用线路下拉固定列出无名音乐 / 闪闪音乐两条；自定义备用地址也保留 */
  const backupOptions = useMemo(() => {
    const lines: MusicSourceLine[] = [...MUSIC_SOURCE_LINES]
    const extra = [source?.backup, backup].filter(Boolean) as MusicSourceBackup[]
    for (const line of extra) {
      if (!lines.some((item) => sameMusicUrl(item.baseUrl, line.baseUrl))) {
        lines.push({ id: line.id, name: line.name, baseUrl: line.baseUrl })
      }
    }
    return lines
  }, [source?.backup, backup])

  const statusOf = (url: string): MusicLineStatus =>
    lineStatus[url] ?? { testStatus: null, testMsg: null, testAt: 0 }

  const changeBaseUrl = (value: string) => {
    setBaseUrl(value)
    // 主线路改成与备用线路相同的地址时，自动把另一条线路设为备用
    if (backup && sameMusicUrl(backup.baseUrl, value)) {
      const other = MUSIC_SOURCE_LINES.find((line) => !sameMusicUrl(line.baseUrl, value))
      if (other) setBackup(backupFromLine(other, statusOf(other.baseUrl)))
    }
  }

  const pickBackup = (value: string) => {
    const line = backupOptions.find((item) => sameMusicUrl(item.baseUrl, value))
    if (!line) return
    if (sameMusicUrl(line.baseUrl, baseUrl)) {
      // 选中的是当前线路：两条线路互换，选中项作为备用
      const nextPrimary =
        backup?.baseUrl ||
        MUSIC_SOURCE_LINES.find((item) => !sameMusicUrl(item.baseUrl, line.baseUrl))?.baseUrl
      if (nextPrimary && !sameMusicUrl(nextPrimary, line.baseUrl)) {
        setBaseUrl(nextPrimary)
        setBackup(backupFromLine(line, statusOf(line.baseUrl)))
      }
      return
    }
    if (backup && sameMusicUrl(backup.baseUrl, line.baseUrl)) return
    setBackup(backupFromLine(line, statusOf(line.baseUrl)))
  }

  /** 一次测完下拉里的线路（无名音乐 + 闪闪音乐），延迟写回选项 */
  const testLines = async () => {
    if (testing) return
    setTesting(true)
    const results = await Promise.all(
      backupOptions.map(async (line) => {
        const latency = probeLatency(line.baseUrl)
        try {
          const res = await window.laozheng.testMusicSource({
            id: line.id,
            name: line.name,
            baseUrl: line.baseUrl
          })
          const ms = await latency
          return [
            line.baseUrl,
            {
              testStatus: res.ok ? 'ok' : 'bad',
              testMsg: withMs(res.ok ? res.message ?? '可用' : res.error ?? '测试失败', ms),
              testAt: Date.now()
            }
          ] as [string, MusicLineStatus]
        } catch (err) {
          const ms = await latency
          return [
            line.baseUrl,
            {
              testStatus: 'bad',
              testMsg: withMs((err as Error).message, ms),
              testAt: Date.now()
            }
          ] as [string, MusicLineStatus]
        }
      })
    )
    const map = Object.fromEntries(results) as Record<string, MusicLineStatus>
    setLineStatus((prev) => ({ ...prev, ...map }))
    setBackup((current) =>
      current && map[current.baseUrl] ? { ...current, ...map[current.baseUrl] } : current
    )
    setTesting(false)
  }

  const submit = () => {
    if (!valid) return
    const primaryStatus = lineStatus[baseUrl.trim().replace(/\/+$/, '')]
    onSave({
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      backup: backup ? { ...backup } : null,
      ...(primaryStatus ? { primaryStatus } : {})
    })
  }

  return (
    <Modal
      title={source ? '编辑音乐源' : '添加音乐源'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!valid} onClick={submit}>
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：无名闪闪音乐"
          />
        </label>
        <label>
          站点地址
          <input
            value={baseUrl}
            onChange={(e) => changeBaseUrl(e.target.value)}
            placeholder="http://www.mvmp3.com"
          />
        </label>
        <label>
          备用线路（{backup ? backup.name : '请选择'} · 延迟）
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select
              value={backup?.baseUrl ?? ''}
              disabled={testing}
              onChange={(event) => pickBackup(event.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="" disabled>
                请选择备用线路
              </option>
              {backupOptions.map((line) => {
                const status = statusOf(line.baseUrl)
                return (
                  <option key={line.baseUrl} value={line.baseUrl}>
                    {line.name} · {line.baseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}{' '}
                    · {testMsgText(status.testMsg)}
                  </option>
                )
              })}
            </select>
            <button
              type="button"
              className="icon-btn"
              title="测试无名音乐 / 闪闪音乐两条线路延迟"
              disabled={testing}
              onClick={() => void testLines()}
            >
              <RefreshCw size={14} className={testing ? 'spin' : ''} />
            </button>
          </div>
        </label>
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        {backup
          ? `当前：${musicLineName(baseUrl) || '自定义线路'}；备用：${backup.name}。优先用当前线路，失败或空结果时自动切到备用线路。`
          : '请选择一条备用线路。'}
        两条线路都来自同一套建站系统（搜索 /so.php、直链 /style/js/play.php），
        点右侧刷新按钮可分别测试延迟。
      </p>
    </Modal>
  )
}

function ImportModal({
  title = '批量导入片源',
  hint,
  onClose,
  onImport,
  onBuiltin
}: {
  title?: string
  hint?: string
  onClose: () => void
  onImport: (inputs: VodSourceImport[]) => void
  onBuiltin?: () => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const doImport = () => {
    const res = parseSourceImport(text)
    if (res.error) {
      setError(res.error)
      return
    }
    onImport(res.sources)
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          {onBuiltin ? (
            <button className="btn" onClick={onBuiltin}>
              导入内置片源
            </button>
          ) : null}
          <button className="btn primary" disabled={!text.trim()} onClick={doImport}>
            导入
          </button>
        </>
      }
    >
      <p>
        {hint ??
          '支持 KVideo 订阅 JSON（数组或单对象），或每行一个「名称|接口地址」。接口地址形如 https://example.com/api.php/provide/vod。'}
      </p>
      <textarea
        className="textarea"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
        placeholder={'非凡资源|https://example.com/api.php/provide/vod\nhttps://another.com/api.php/provide/vod'}
      />
      {error ? <div className="result-hint">{error}</div> : null}
    </Modal>
  )
}

function LiveSourceModal({
  title = '添加源',
  initial,
  onClose,
  onSave
}: {
  title?: string
  initial?: LiveSource
  onClose: () => void
  onSave: (name: string, url: string) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const valid = /^https?:\/\//i.test(url.trim()) || url.trim().startsWith('local://')

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!valid} onClick={() => onSave(name, url)}>
            保存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：IPv4 直播源" />
        </label>
        <label>
          M3U 地址
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/playlist.m3u"
          />
        </label>
      </div>
    </Modal>
  )
}
