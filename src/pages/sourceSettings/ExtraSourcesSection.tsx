import { useState, type ReactNode } from 'react'
import { Download, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useData } from '../../state/DataContext'
import { ConfirmDialog, EmptyState } from '../../components/ui'
import { genSourceId, normalizeBaseUrl, vodHost, type VodSourceInput } from '../../shared/vod'
import {
  inferMeituTemplate,
  meituTemplateLabel,
  toMeituSourceRef,
  type MeituSource,
  type MeituSourceInput
} from '../../shared/meitu'
import { inferSkAdapter, toShuangkanSourceRef, type ShuangkanSource } from '../../shared/shuangkan'
import {
  inferWallpaperTemplate,
  toWallpaperSourceRef,
  wallpaperTemplateLabel,
  type WallpaperSource,
  type WallpaperSourceInput
} from '../../shared/wallpaper'
import {
  ImportModal,
  MeituSourceModal,
  ShuangkanSourceModal,
  WallpaperSourceModal
} from '../SourceSettingsModals'
import { PreferredSortButton, SourceCard, byPreferredOrder, sourceSummary } from './shared'
import { probeLatency, testMsgText, withMs } from './sourceTest'

interface TestResult {
  status: 'ok' | 'bad'
  msg: string
}

interface TemplateSource {
  id: string
  name: string
  baseUrl: string
  enabled: boolean
  testStatus?: string | null
  testMsg?: string | null
  builtin?: boolean
}

function newShuangkanSourceId(baseUrl: string, taken: { id: string }[]): string {
  const baseId = `sk_${genSourceId(baseUrl)}`
  let id = baseId
  let n = 2
  while (taken.some((s) => s.id === id)) id = `${baseId}_${n++}`
  return id
}

/** 三类源共用的配置卡片：壁纸 / 套图 / 皇片只是模板标签和文案不同 */
function TemplateSourceCard<T extends TemplateSource>({
  title,
  summary,
  open,
  onToggle,
  sources,
  emptyTitle,
  emptyDesc,
  testingAll,
  testingId,
  onAdd,
  onImport,
  onExport,
  onTestAll,
  onSort,
  onTest,
  onToggleEnabled,
  onEdit,
  onDelete,
  meta
}: {
  title: string
  summary: string
  open: boolean
  onToggle: () => void
  sources: T[]
  emptyTitle: string
  emptyDesc: string
  testingAll: boolean
  testingId: string | null
  onAdd: () => void
  onImport: () => void
  onExport: () => void
  onTestAll: () => void
  onSort: () => void
  onTest: (source: T) => void
  onToggleEnabled: (source: T) => void
  onEdit: (source: T) => void
  onDelete: (source: T) => void
  meta: (source: T) => ReactNode
}) {
  return (
    <SourceCard title={title} summary={summary} open={open} onToggle={onToggle}>
      <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn primary" onClick={onAdd}>
          <Plus size={15} /> 添加源
        </button>
        <button className="btn" onClick={onImport}>
          <Upload size={15} /> 批量导入
        </button>
        <button
          className="btn"
          disabled={testingAll || sources.length === 0}
          onClick={onTestAll}
        >
          <RefreshCw size={15} /> {testingAll ? '测试中…' : '整体测试'}
        </button>
        <PreferredSortButton disabled={sources.length < 2} onSort={onSort} />
        <button className="btn" disabled={sources.length === 0} onClick={onExport}>
          <Download size={15} /> 导出
        </button>
      </div>
      {sources.length === 0 ? (
        <EmptyState title={emptyTitle} desc={emptyDesc} />
      ) : (
        <div className="rows" style={{ marginTop: 10 }}>
          {sources.map((source) => (
            <div key={source.id} className="row">
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
                <div className="row-meta">{meta(source)}</div>
                <div className="row-meta">{testMsgText(source.testMsg)}</div>
              </div>
              <button
                className="btn"
                disabled={testingId === source.id}
                onClick={() => onTest(source)}
              >
                <RefreshCw size={14} /> {testingId === source.id ? '测试中…' : '测试'}
              </button>
              <button className="btn" onClick={() => onToggleEnabled(source)}>
                {source.enabled ? '停用' : '启用'}
              </button>
              <button className="icon-btn" title="修改" aria-label="修改" onClick={() => onEdit(source)}>
                <Pencil size={14} />
              </button>
              {!source.builtin && (
                <button
                  className="icon-btn danger"
                  title="删除"
                  aria-label="删除"
                  onClick={() => onDelete(source)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </SourceCard>
  )
}

/** 壁纸 / 套图 / 皇片三类源的配置卡片与弹窗（从 SourceSettings 拆出） */
export function ExtraSourcesSection({ onNotice }: { onNotice: (text: string) => void }) {
  const { data, update } = useData()

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
  const [editingShuangkan, setEditingShuangkan] = useState<ShuangkanSource | 'new' | null>(null)
  const [importingShuangkan, setImportingShuangkan] = useState(false)
  const [deletingShuangkan, setDeletingShuangkan] = useState<ShuangkanSource | null>(null)
  const [testingShuangkanId, setTestingShuangkanId] = useState<string | null>(null)
  const [testingShuangkanAll, setTestingShuangkanAll] = useState(false)

  // ---------- 壁纸源 ----------

  const patchWallpaper = (id: string, patch: Partial<WallpaperSource>) => {
    update((d) => ({
      ...d,
      wallpaperSources: d.wallpaperSources.map((source) =>
        source.id === id ? { ...source, ...patch } : source
      )
    }))
  }

  const runWallpaperTest = async (source: WallpaperSource): Promise<TestResult> => {
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

  const testWallpaper = async (source: WallpaperSource): Promise<void> => {
    if (testingWallpaperId) return
    setTestingWallpaperId(source.id)
    const res = await runWallpaperTest(source)
    setTestingWallpaperId(null)
    onNotice(`「${source.name}」${res.status === 'ok' ? '可用' : `不可用：${res.msg}`}`)
  }

  const testAllWallpaper = async (): Promise<void> => {
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
    if (!deletingWallpaper || deletingWallpaper.builtin) return
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

  // ---------- 套图源 ----------

  const patchMeitu = (id: string, patch: Partial<MeituSource>) => {
    update((d) => ({
      ...d,
      meituSources: d.meituSources.map((source) =>
        source.id === id ? { ...source, ...patch } : source
      )
    }))
  }

  const runMeituTest = async (source: MeituSource): Promise<TestResult> => {
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

  const testMeitu = async (source: MeituSource): Promise<void> => {
    if (testingMeituId) return
    setTestingMeituId(source.id)
    const res = await runMeituTest(source)
    setTestingMeituId(null)
    onNotice(`「${source.name}」${res.status === 'ok' ? '可用' : `不可用：${res.msg}`}`)
  }

  const testAllMeitu = async (): Promise<void> => {
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
    if (!deletingMeitu || deletingMeitu.builtin) return
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

  // ---------- 皇片源 ----------

  const patchShuangkan = (id: string, patch: Partial<ShuangkanSource>) => {
    update((d) => ({
      ...d,
      shuangkanSources: d.shuangkanSources.map((source) =>
        source.id === id ? { ...source, ...patch } : source
      )
    }))
  }

  const runShuangkanTest = async (source: ShuangkanSource): Promise<TestResult> => {
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

  const testShuangkan = async (source: ShuangkanSource): Promise<void> => {
    if (testingShuangkanId) return
    setTestingShuangkanId(source.id)
    const res = await runShuangkanTest(source)
    setTestingShuangkanId(null)
    onNotice(`「${source.name}」${res.status === 'ok' ? '可用' : `不可用：${res.msg}`}`)
  }

  const testAllShuangkan = async (): Promise<void> => {
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
    id?: string
    name: string
    baseUrl: string
    adapter?: ShuangkanSource['adapter']
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
    if (!deletingShuangkan || deletingShuangkan.builtin) return
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

  return (
    <>
      <TemplateSourceCard
        title="壁纸源"
        summary={sourceSummary(
          data.wallpaperSources.length,
          wallpaperEnabled,
          wallpaperOk,
          wallpaperBad
        )}
        open={wallpaperOpen}
        onToggle={() => setWallpaperOpen((value) => !value)}
        sources={data.wallpaperSources}
        emptyTitle="还没有壁纸源"
        emptyDesc="点「添加源」或「批量导入」；壁纸源支持 Wallspic / 壁纸迷 两种站点模板。"
        testingAll={testingWallpaperAll}
        testingId={testingWallpaperId}
        onAdd={() => setEditingWallpaper('new')}
        onImport={() => setImportingWallpaper(true)}
        onExport={() => void exportWallpaper()}
        onTestAll={() => void testAllWallpaper()}
        onSort={() =>
          update((d) => ({
            ...d,
            wallpaperSources: byPreferredOrder(d.wallpaperSources)
          }))
        }
        onTest={(source) => void testWallpaper(source)}
        onToggleEnabled={(source) =>
          patchWallpaper(source.id, { enabled: !source.enabled })
        }
        onEdit={setEditingWallpaper}
        onDelete={setDeletingWallpaper}
        meta={(source) => `${vodHost(source.baseUrl)} · ${wallpaperTemplateLabel(source.template)}`}
      />

      <TemplateSourceCard
        title="套图源"
        summary={sourceSummary(data.meituSources.length, meituEnabled, meituOk, meituBad)}
        open={meituOpen}
        onToggle={() => setMeituOpen((value) => !value)}
        sources={data.meituSources}
        emptyTitle="还没有套图源"
        emptyDesc="点「添加源」或「批量导入」；套图源支持魅影画廊 / 雪月映画 两种站点模板。"
        testingAll={testingMeituAll}
        testingId={testingMeituId}
        onAdd={() => setEditingMeitu('new')}
        onImport={() => setImportingMeitu(true)}
        onExport={() => void exportMeitu()}
        onTestAll={() => void testAllMeitu()}
        onSort={() =>
          update((d) => ({ ...d, meituSources: byPreferredOrder(d.meituSources) }))
        }
        onTest={(source) => void testMeitu(source)}
        onToggleEnabled={(source) => patchMeitu(source.id, { enabled: !source.enabled })}
        onEdit={setEditingMeitu}
        onDelete={setDeletingMeitu}
        meta={(source) => `${vodHost(source.baseUrl)} · ${meituTemplateLabel(source.template)}`}
      />

      <TemplateSourceCard
        title="皇片源"
        summary={sourceSummary(
          data.shuangkanSources.length,
          shuangkanEnabled,
          shuangkanOk,
          shuangkanBad
        )}
        open={shuangkanOpen}
        onToggle={() => setShuangkanOpen((value) => !value)}
        sources={data.shuangkanSources}
        emptyTitle="还没有皇片源"
        emptyDesc="点「添加源」填站点地址；内置源不可删除，不用时停用即可。"
        testingAll={testingShuangkanAll}
        testingId={testingShuangkanId}
        onAdd={() => setEditingShuangkan('new')}
        onImport={() => setImportingShuangkan(true)}
        onExport={() => void exportShuangkan()}
        onTestAll={() => void testAllShuangkan()}
        onSort={() =>
          update((d) => ({
            ...d,
            shuangkanSources: byPreferredOrder(d.shuangkanSources)
          }))
        }
        onTest={(source) => void testShuangkan(source)}
        onToggleEnabled={(source) => patchShuangkan(source.id, { enabled: !source.enabled })}
        onEdit={setEditingShuangkan}
        onDelete={setDeletingShuangkan}
        meta={(source) => vodHost(source.baseUrl)}
      />

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
    </>
  )
}
