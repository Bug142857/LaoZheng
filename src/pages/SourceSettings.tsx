import { useEffect, useState } from 'react'
import { Download, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
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
import type { LiveSource } from '../shared/live'
import type { VodSource } from '../shared/types'

function toInput(source: VodSource): VodSourceInput {
  return { id: source.id, name: source.name, baseUrl: source.baseUrl }
}

function newLiveSourceId(url: string): string {
  let h = 0
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0
  return `live_${Math.abs(h)}`
}

/**
 * 片源管理（配置管理 → 片源管理）：
 * 影视源（观影 / 番号共用配置）与电视源（M3U）统一在这里维护，
 * 观影页与电视页只负责播放，不再放片源管理入口。
 */
export function SourceSettings({ onNotice }: { onNotice: (text: string) => void }) {
  const { data, update } = useData()
  const sources = data.vodSources
  const [editing, setEditing] = useState<VodSource | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState<VodSource | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testingAll, setTestingAll] = useState(false)

  const [liveSources, setLiveSources] = useState<LiveSource[] | null>(null)
  const [addingLive, setAddingLive] = useState(false)
  const [editingLive, setEditingLive] = useState<LiveSource | null>(null)
  const [deletingLive, setDeletingLive] = useState<LiveSource | null>(null)
  const [liveStatus, setLiveStatus] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [testingLiveId, setTestingLiveId] = useState<string | null>(null)
  const [testingLiveAll, setTestingLiveAll] = useState(false)

  useEffect(() => {
    let alive = true
    window.laozheng.loadLiveSources().then((list) => {
      if (alive) setLiveSources(list)
    })
    return () => {
      alive = false
    }
  }, [])

  const saveSource = (input: VodSourceInput) => {
    if (editing === 'new') {
      update((d) => ({
        ...d,
        vodSources: [
          ...d.vodSources,
          {
            id: d.vodSources.some((s) => s.id === input.id) ? genSourceId(input.baseUrl) : input.id,
            name: input.name,
            baseUrl: normalizeBaseUrl(input.baseUrl),
            enabled: true,
            region: 'cn',
            regionManual: false,
            testStatus: null,
            testMsg: null,
            testAt: 0
          }
        ]
      }))
      onNotice(`已添加片源「${input.name}」`)
    } else if (editing) {
      const current = editing
      update((d) => ({
        ...d,
        vodSources: d.vodSources.map((s) =>
          s.id === current.id
            ? {
                ...s,
                name: input.name,
                baseUrl: normalizeBaseUrl(input.baseUrl)
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

  const persistLive = (next: LiveSource[]) => {
    setLiveSources(next)
    void window.laozheng.saveLiveSources(next)
  }

  const addLiveSource = (name: string, url: string) => {
    if (!liveSources) return
    const source: LiveSource = {
      id: newLiveSourceId(url),
      name: name.trim() || '直播源',
      url: url.trim(),
      content: '',
      enabled: true
    }
    persistLive([...liveSources, source])
    setAddingLive(false)
    onNotice(`已添加电视源「${source.name}」`)
  }

  const saveLiveSource = (name: string, url: string) => {
    if (!editingLive || !liveSources) return
    const target = editingLive
    persistLive(
      liveSources.map((s) =>
        s.id === target.id
          ? {
              ...s,
              name: name.trim() || s.name,
              url: url.trim(),
              content: url.trim().startsWith('local://') ? s.content : ''
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
    setLiveStatus((prev) => ({ ...prev, [source.id]: { ok: res.ok, message: res.message } }))
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
        setLiveStatus((prev) => ({ ...prev, [source.id]: { ok: res.ok, message: res.message } }))
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

  const vodOk = sources.filter((s) => s.testStatus === 'ok').length
  const vodBad = sources.filter((s) => !!s.testStatus && s.testStatus !== 'ok').length
  const liveOk = Object.values(liveStatus).filter((s) => s.ok).length
  const liveBad = Object.values(liveStatus).filter((s) => !s.ok).length

  return (
    <div className="settings">
      <section className="settings-card">
        <h3>影视源（观影）</h3>
        <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Plus size={15} /> 添加片源
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
          <span className="settings-value">
            共 {sources.length} 个 · 有效 {vodOk} · 无效 {vodBad}
          </span>
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
      </section>

      <section className="settings-card">
        <h3>电视源</h3>
        <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn primary" onClick={() => setAddingLive(true)}>
            <Plus size={15} /> 添加电视源
          </button>
          <button className="btn" onClick={() => void importLiveFile()}>
            <Upload size={15} /> 导入 M3U
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
          <span className="settings-value">
            共 {liveSources?.length ?? 0} 个 · 有效 {liveOk} · 无效 {liveBad}
          </span>
        </div>

        {liveSources === null ? (
          <div className="settings-hint">正在读取电视源…</div>
        ) : liveSources.length === 0 ? (
          <div className="settings-hint">还没有电视源。</div>
        ) : (
          <div className="rows" style={{ marginTop: 10 }}>
            {liveSources.map((s) => {
              const status = liveStatus[s.id]
              return (
                <div key={s.id} className="row">
                  <span className={`status-dot ${!s.enabled ? 'off' : status ? (status.ok ? 'ok' : 'warn') : ''}`} />
                  <div className="row-main">
                    <div className="row-title">{s.name}</div>
                    <div className="row-meta">
                      {s.url.startsWith('local://') ? '本地导入' : s.url}
                    </div>
                    <div className="row-meta">{status?.message ?? '未测试'}</div>
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
                    onClick={() =>
                      persistLive(
                        liveSources.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x))
                      )
                    }
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
      </section>

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
      title={source ? '编辑片源' : '添加片源'}
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

function ImportModal({
  onClose,
  onImport,
  onBuiltin
}: {
  onClose: () => void
  onImport: (inputs: VodSourceInput[]) => void
  onBuiltin: () => void
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
      title="批量导入片源"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn" onClick={onBuiltin}>
            导入内置片源
          </button>
          <button className="btn primary" disabled={!text.trim()} onClick={doImport}>
            导入
          </button>
        </>
      }
    >
      <p>
        支持 KVideo 订阅 JSON（数组或单对象），或每行一个「名称|接口地址」。接口地址形如
        https://example.com/api.php/provide/vod。
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
  title = '添加电视源',
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
