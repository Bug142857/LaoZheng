import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
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
  type VodSourceInput
} from '../shared/vod'
import { DEFAULT_VOD_SOURCES } from '../shared/vodDefaults'
import {
  XIFAN_DRAMA_BASE_URL,
  XIFAN_DRAMA_SOURCE_ID,
  type DramaSource,
  type DramaSourceInput
} from '../shared/drama'
import type { LiveSource } from '../shared/live'
import type { MagnetSource } from '../shared/magnet'
import type { AllSourcesBundle, VodSource } from '../shared/types'
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

function newLiveSourceId(url: string): string {
  let h = 0
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0
  return `live_${Math.abs(h)}`
}

function sourceSummary(total: number, enabled: number, ok: number, bad: number): string {
  return `共 ${total} 个 · 启用 ${enabled} · 有效 ${ok} · 无效 ${bad}`
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
              testStatus: null,
              testMsg: null,
              testAt: 0
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
          testStatus: null,
          testMsg: null,
          testAt: 0
        })
      }
      return { ...d, vodSources: [...d.vodSources, ...added] }
    })
    onNotice(`已导入 ${fresh.length} 个片源`)
    setImporting(false)
  }

  const testSource = async (source: VodSource) => {
    setTestingId(source.id)
    const res = await window.laozheng.testVodSource(toInput(source))
    update((d) => ({
      ...d,
      vodSources: d.vodSources.map((s) =>
        s.id === source.id
          ? {
              ...s,
              testStatus: res.status,
              testMsg: res.message,
              testAt: res.testAt,
              region: s.regionManual ? s.region : res.region
            }
          : s
      )
    }))
    setTestingId(null)
    onNotice(`${source.name}：${res.message}`)
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
        const res = await window.laozheng.testVodSource(toInput(source))
        if (res.status === 'ok') ok += 1
        else bad += 1
        update((d) => ({
          ...d,
          vodSources: d.vodSources.map((s) =>
            s.id === source.id
              ? {
                  ...s,
                  testStatus: res.status,
                  testMsg: res.message,
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
            testStatus: null,
            testMsg: null,
            testAt: 0
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
            testStatus: null,
            testMsg: null,
            testAt: 0
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
          testStatus: null,
          testMsg: null,
          testAt: 0
        })
      }
      return { ...d, dramaSources: [...nextSources, ...added] }
    })
    onNotice(`已导入 ${fresh.length + (xifanInput ? 1 : 0)} 个短剧源`)
    setImportingDrama(false)
  }

  const testDramaSource = async (source: DramaSource): Promise<void> => {
    setTestingDramaId(source.id)
    const res = await window.laozheng.dramaCatalog(toDramaInput(source), '', 1, '')
    const status = res.ok ? 'ok' : 'failed'
    const message = res.ok ? `可用 · 返回 ${res.items.length} 部` : res.error ?? '不可用'
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
        const res = await window.laozheng.dramaCatalog(toDramaInput(source), '', 1, '')
        const status = res.ok ? 'ok' : 'failed'
        if (res.ok) ok += 1
        else bad += 1
        const message = res.ok ? `可用 · 返回 ${res.items.length} 部` : res.error ?? '不可用'
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
      testStatus: null,
      testMsg: null,
      testAt: 0
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
    const res = await window.laozheng.testLiveSource(source)
    setTestingLiveId(null)
    patchLive(source.id, {
      testStatus: res.ok ? 'ok' : 'failed',
      testMsg: res.message,
      testAt: Date.now()
    })
    onNotice(`${source.name}：${res.message}`)
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
        const res = await window.laozheng.testLiveSource(source)
        if (res.ok) ok += 1
        else bad += 1
        patchLive(source.id, {
          testStatus: res.ok ? 'ok' : 'failed',
          testMsg: res.message,
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
        enabled: s.enabled
      })),
      dramaSources: data.dramaSources.map((s) => ({
        id: s.id,
        name: s.name,
        baseUrl: s.baseUrl ?? '',
        enabled: s.enabled
      })),
      liveSources: live,
      magnetSources: magnet.sources
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
          region: 'cn',
          regionManual: false,
          testStatus: null,
          testMsg: null,
          testAt: 0
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
            testStatus: null,
            testMsg: null,
            testAt: 0
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
          testStatus: null,
          testMsg: null,
          testAt: 0
        })
        dramaAddedCount += 1
      }

      vodAdded = vodRows.length
      dramaAdded = dramaAddedCount
      return {
        ...d,
        vodSources: [...d.vodSources, ...vodRows],
        dramaSources: nextDramaSources
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
        testStatus: null,
        testMsg: null,
        testAt: 0
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
          testStatus: null,
          testMsg: null,
          testAt: 0
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

    if (!vodAdded && !dramaAdded && !liveRows.length && !magnetAdded) {
      onNotice('没有新增源（地址都已存在）')
      return
    }
    onNotice(
      `已导入：影视源 ${vodAdded} · 短剧源 ${dramaAdded} · 电视源 ${liveRows.length} · 磁力源 ${magnetAdded}`
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

  return (
    <div className="settings">
      <section className="settings-card">
        <h3>全部源</h3>
        <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn primary" onClick={() => void importAllSources()}>
            <Upload size={15} /> 整体导入
          </button>
          <button className="btn" onClick={() => void exportAllSources()}>
            <Download size={15} /> 整体导出
          </button>
          <span className="settings-value">影视源 / 短剧源 / 电视源 / 磁力源</span>
        </div>
      </section>

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
                  <div className="row-meta">{s.testMsg ?? '未测试'}</div>
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
                      ? vodHost(source.baseUrl ?? XIFAN_DRAMA_BASE_URL)
                      : vodHost(source.baseUrl ?? '')}
                  </div>
                  <div className="row-meta">{source.testMsg ?? '未测试'}</div>
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
                    <div className="row-meta">{s.testMsg ?? '未测试'}</div>
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

      {/* 磁力源并入片源管理，不再单独占配置管理入口 */}
      <MagnetSettings key={magnetKey} onNotice={onNotice} />

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
    </div>
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
  const [name, setName] = useState(source?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(
    source?.baseUrl ?? (source?.builtin ? XIFAN_DRAMA_BASE_URL : '')
  )
  const valid = name.trim() && /^https?:\/\//i.test(baseUrl.trim())

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
      </div>
      <p className="settings-hint" style={{ marginTop: 10 }}>
        {source?.builtin
          ? '西饭短剧默认使用官方接口地址，也可以改成镜像地址。'
          : '短剧源使用苹果CMS V10 接口；西饭短剧不需要在这里添加。'}
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
  onImport: (inputs: VodSourceInput[]) => void
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
