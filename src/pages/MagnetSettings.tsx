import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Download, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import type {
  MagnetApiMapping,
  MagnetEncodeType,
  MagnetSource,
  MagnetState,
  MagnetTestStatus
} from '../shared/magnet'
import { ConfirmDialog, Modal } from '../components/ui'

const SAMPLE_API = `{
  "listPath": "data.list",
  "titleField": "title",
  "sizeField": "size",
  "hashField": "hash",
  "dateField": "date",
  "totalField": "total",
  "codeField": "code",
  "successValue": "200",
  "pageSize": 20,
  "idField": "id",
  "detailUrlTemplate": ""
}`

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function statusClass(source: MagnetSource): string {
  if (!source.enabled) return 'off'
  if (source.testStatus === 'ok') return 'ok'
  if (source.testStatus === 'failed') return 'warn'
  return ''
}

function newSourceId(): string {
  return `magnet_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function parseApiMapping(text: string): { value: MagnetApiMapping | null; error: string | null } {
  if (!text.trim()) return { value: null, error: '请填写 API 映射 JSON' }
  try {
    const raw = JSON.parse(text) as Partial<MagnetApiMapping>
    const value: MagnetApiMapping = {
      listPath: String(raw.listPath ?? ''),
      titleField: String(raw.titleField ?? ''),
      sizeField: String(raw.sizeField ?? ''),
      hashField: String(raw.hashField ?? ''),
      dateField: String(raw.dateField ?? ''),
      totalField: String(raw.totalField ?? ''),
      codeField: String(raw.codeField ?? ''),
      successValue: String(raw.successValue ?? ''),
      pageSize: Number(raw.pageSize) || 20,
      idField: String(raw.idField ?? ''),
      detailUrlTemplate: String(raw.detailUrlTemplate ?? '')
    }
    if (!value.listPath || !value.hashField) {
      return { value: null, error: 'API 映射至少需要 listPath 和 hashField' }
    }
    return { value, error: null }
  } catch (err) {
    return { value: null, error: `API 映射不是有效 JSON：${(err as Error).message}` }
  }
}

export function MagnetSettings({ onNotice }: { onNotice: (text: string) => void }) {
  const [state, setState] = useState<MagnetState | null>(null)
  const [open, setOpen] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testingAll, setTestingAll] = useState(false)
  const [editing, setEditing] = useState<MagnetSource | 'new' | null>(null)
  const [deleting, setDeleting] = useState<MagnetSource | null>(null)
  const sourcesRef = useRef<MagnetSource[]>([])

  useEffect(() => {
    let alive = true
    void window.laozheng
      .magnetState()
      .then((next) => {
        if (!alive) return
        setState(next)
        sourcesRef.current = next.sources
      })
      .catch((err: unknown) => {
        if (alive) onNotice(`读取磁力源失败：${(err as Error).message}`)
      })
    return () => {
      alive = false
    }
  }, [onNotice])

  useEffect(() => {
    sourcesRef.current = state?.sources ?? []
  }, [state])

  const sources = state?.sources ?? []
  const enabledCount = sources.filter((source) => source.enabled).length
  const okCount = sources.filter((source) => source.testStatus === 'ok').length
  const badCount = sources.filter((source) => source.testStatus === 'failed').length

  const persistSources = async (nextSources: MagnetSource[]): Promise<void> => {
    const next = await window.laozheng.saveMagnetSources(nextSources)
    setState(next)
    sourcesRef.current = next.sources
  }

  const toggleSource = async (source: MagnetSource): Promise<void> => {
    const nextSources = sourcesRef.current.map((entry) =>
      entry.id === source.id ? { ...entry, enabled: !entry.enabled } : entry
    )
    await persistSources(nextSources)
    onNotice(`「${source.name}」${source.enabled ? '已停用' : '已启用'}`)
  }

  const applyTestResult = (
    source: MagnetSource,
    ok: boolean,
    message: string,
    testAt: number
  ): void => {
    const status: MagnetTestStatus = ok ? 'ok' : 'failed'
    const nextSources = sourcesRef.current.map((entry) =>
      entry.id === source.id
        ? { ...entry, testStatus: status, testMsg: message, testAt }
        : entry
    )
    sourcesRef.current = nextSources
    setState((previous) => (previous ? { ...previous, sources: nextSources } : previous))
  }

  const testSource = async (source: MagnetSource): Promise<void> => {
    setTestingId(source.id)
    try {
      const result = await window.laozheng.testMagnetSource(source)
      applyTestResult(source, result.ok, result.message, result.testAt)
      await window.laozheng.saveMagnetSources(sourcesRef.current)
      onNotice(`${source.name}：${result.message}`)
    } catch (err) {
      applyTestResult(source, false, (err as Error).message, Date.now())
      onNotice(`${source.name}：${(err as Error).message}`)
    } finally {
      setTestingId(null)
    }
  }

  const testAll = async (): Promise<void> => {
    if (testingAll) return
    const enabled = sourcesRef.current.filter((source) => source.enabled)
    if (!enabled.length) {
      onNotice('没有启用的资源库')
      return
    }
    setTestingAll(true)
    const queue = [...enabled]
    let ok = 0
    let bad = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const source = queue.shift()
        if (!source) return
        setTestingId(source.id)
        try {
          const result = await window.laozheng.testMagnetSource(source)
          if (result.ok) ok += 1
          else bad += 1
          applyTestResult(source, result.ok, result.message, result.testAt)
        } catch (err) {
          bad += 1
          applyTestResult(source, false, (err as Error).message, Date.now())
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker))
    const next = await window.laozheng.saveMagnetSources(sourcesRef.current)
    setState(next)
    setTestingId(null)
    setTestingAll(false)
    onNotice(`磁力源测试完成：可用 ${ok} 个 · 失败 ${bad} 个`)
  }

  const saveSource = async (source: MagnetSource): Promise<void> => {
    const current = sourcesRef.current
    const exists = current.some((entry) => entry.id === source.id)
    if (current.some((entry) => entry.id !== source.id && entry.searchUrl === source.searchUrl)) {
      onNotice('该资源库地址已经存在')
      return
    }
    const nextSources = exists
      ? current.map((entry) => (entry.id === source.id ? source : entry))
      : [...current, source]
    await persistSources(nextSources)
    setEditing(null)
    onNotice(exists ? `已保存「${source.name}」` : `已添加「${source.name}」`)
  }

  const removeSource = async (): Promise<void> => {
    if (!deleting) return
    await persistSources(sourcesRef.current.filter((source) => source.id !== deleting.id))
    onNotice(`已删除「${deleting.name}」`)
    setDeleting(null)
  }

  const importSources = async (): Promise<void> => {
    const result = await window.laozheng.importMagnetSources()
    if (result.canceled) return
    if (result.error) {
      onNotice(`导入失败：${result.error}`)
      return
    }
    const current = sourcesRef.current
    const ids = new Set(current.map((source) => source.id))
    const urls = new Set(current.map((source) => source.searchUrl))
    const fresh = (result.sources ?? []).filter(
      (source) => !ids.has(source.id) && !urls.has(source.searchUrl)
    )
    if (!fresh.length) {
      onNotice('导入的资源库都已存在')
      return
    }
    await persistSources([...current, ...fresh])
    onNotice(`已导入 ${fresh.length} 个资源库`)
  }

  const exportSources = async (): Promise<void> => {
    const result = await window.laozheng.exportMagnetSources(sourcesRef.current)
    if (result.canceled) return
    if (result.error) {
      onNotice(`导出失败：${result.error}`)
      return
    }
    onNotice(`已导出 ${result.count ?? 0} 个资源库到 ${result.path}`)
  }

  return (
    <>
      <section className="settings-card">
        <button
          type="button"
          className="settings-card-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <h3>磁力源</h3>
          <span className="settings-value">
            共 {sources.length} 个 · 启用 {enabledCount} · 有效 {okCount} · 无效 {badCount}
          </span>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {open ? (
          <>
            <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              <button className="btn primary" onClick={() => setEditing('new')}>
                <Plus size={15} /> 添加源
              </button>
              <button className="btn" onClick={() => void importSources()}>
                <Upload size={15} /> 批量导入
              </button>
              <button
                className="btn"
                disabled={testingAll || sources.length === 0}
                onClick={() => void testAll()}
              >
                <RefreshCw size={15} /> {testingAll ? '测试中…' : '整体测试'}
              </button>
              <button className="btn" disabled={sources.length === 0} onClick={() => void exportSources()}>
                <Download size={15} /> 导出
              </button>
            </div>

            {sources.length === 0 ? (
              <div className="settings-hint" style={{ marginTop: 12 }}>
                还没有资源库，点「添加源」或「批量导入」。
              </div>
            ) : (
              <div className="rows" style={{ marginTop: 10 }}>
                {sources.map((source) => (
                  <div key={source.id} className="row">
                    <span className={`status-dot ${statusClass(source)}`} />
                    <div className="row-main">
                      <div className="row-title">
                        {source.name}
                        {source.isApi ? <span className="badge">API</span> : null}
                        {source.needProxy ? <span className="badge">需代理</span> : null}
                      </div>
                      <div className="row-meta">{hostOf(source.searchUrl)}</div>
                      <div className="row-meta">{source.testMsg ?? '未测试'}</div>
                    </div>
                    <button
                      className="btn"
                      disabled={testingId === source.id}
                      onClick={() => void testSource(source)}
                    >
                      <RefreshCw size={14} /> {testingId === source.id ? '测试中…' : '测试'}
                    </button>
                    <button className="btn" onClick={() => void toggleSource(source)}>
                      {source.enabled ? '停用' : '启用'}
                    </button>
                    <button className="icon-btn" title="修改" onClick={() => setEditing(source)}>
                      <Pencil size={14} />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="删除"
                      onClick={() => setDeleting(source)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </section>

      {editing && (
        <MagnetSourceModal
          source={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(source) => void saveSource(source)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="删除资源库"
          message={`确定删除「${deleting.name}」吗？只影响本机磁力源配置。`}
          confirmText="删除"
          danger
          onConfirm={() => void removeSource()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}

function MagnetSourceModal({
  source,
  onClose,
  onSave
}: {
  source: MagnetSource | null
  onClose: () => void
  onSave: (source: MagnetSource) => void
}) {
  const [name, setName] = useState(source?.name ?? '')
  const [searchUrl, setSearchUrl] = useState(source?.searchUrl ?? '')
  const [separator, setSeparator] = useState(source?.separator ?? '<h2>')
  const [nextPage, setNextPage] = useState(source?.nextPageIndicator ?? '')
  const [encodeType, setEncodeType] = useState<MagnetEncodeType>(source?.encodeType ?? 'UrlEncode')
  const [useWebView2, setUseWebView2] = useState(source?.useWebView2 ?? false)
  const [directNavigate, setDirectNavigate] = useState(source?.directNavigate ?? false)
  const [isApi, setIsApi] = useState(source?.isApi ?? false)
  const [apiText, setApiText] = useState(source?.api ? JSON.stringify(source.api, null, 2) : '')

  const apiResult = isApi ? parseApiMapping(apiText) : { value: null, error: null }
  const urlValid =
    /^https?:\/\//i.test(searchUrl.trim()) && searchUrl.trim().includes('{keyword}')
  const valid =
    !!name.trim() &&
    urlValid &&
    (isApi ? !!apiResult.value : !!separator.trim())

  const toggleApi = (): void => {
    const next = !isApi
    setIsApi(next)
    if (next && !apiText.trim()) setApiText(SAMPLE_API)
  }

  const submit = (): void => {
    if (!valid) return
    const base: MagnetSource = source ?? {
      id: newSourceId(),
      name: '',
      enabled: true,
      needProxy: false,
      searchUrl: '',
      separator: '',
      nextPageIndicator: '',
      useWebView2: false,
      directNavigate: false,
      encodeType: 'UrlEncode',
      isApi: false,
      navigationPage: '',
      fixedRules: false,
      api: null,
      testStatus: 'ok',
      testMsg: '可用',
      testAt: Date.now()
    }
    onSave({
      ...base,
      name: name.trim(),
      searchUrl: searchUrl.trim(),
      separator: isApi ? '' : separator.trim(),
      nextPageIndicator: nextPage.trim(),
      encodeType,
      useWebView2,
      directNavigate: useWebView2 ? directNavigate : false,
      isApi,
      api: isApi ? apiResult.value : null,
      testStatus: 'ok',
      testMsg: '可用',
      testAt: Date.now()
    })
  }

  return (
    <Modal
      title={source ? '修改源' : '添加源'}
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
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：3MAG" />
        </label>
        <label>
          搜索地址
          <input
            value={searchUrl}
            onChange={(event) => setSearchUrl(event.target.value)}
            placeholder="https://example.com/search?q={keyword}&page={page}"
          />
        </label>
        <label>
          列表分割符
          <input
            value={separator}
            onChange={(event) => setSeparator(event.target.value)}
            placeholder='例如：<h2> 或 <tr class="default">'
            disabled={isApi}
          />
        </label>
        <label>
          下一页关键词
          <input
            value={nextPage}
            onChange={(event) => setNextPage(event.target.value)}
            placeholder="例如：>下一页<；留空表示单页"
          />
        </label>
        <label>
          关键词编码
          <select
            className="select-inline"
            value={encodeType}
            onChange={(event) => setEncodeType(event.target.value as MagnetEncodeType)}
          >
            <option value="UrlEncode">URL 编码</option>
            <option value="Base64UrlSafe">Base64 URL Safe</option>
            <option value="Hex">Hex</option>
            <option value="Raw">原样</option>
          </select>
        </label>
      </div>

      <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <button className="btn" onClick={() => setUseWebView2((value) => !value)}>
          {useWebView2 ? '浏览器渲染：已启用' : '使用浏览器渲染'}
        </button>
        {useWebView2 ? (
          <button className="btn" onClick={() => setDirectNavigate((value) => !value)}>
            {directNavigate ? '直接打开搜索页' : '先打开导航页'}
          </button>
        ) : null}
        <button className="btn" onClick={toggleApi}>
          {isApi ? 'API 模式：已启用' : '使用 API 模式'}
        </button>
      </div>

      {isApi ? (
        <label>
          API 映射（JSON）
          <textarea
            className="textarea"
            value={apiText}
            onChange={(event) => setApiText(event.target.value)}
            placeholder={SAMPLE_API}
          />
        </label>
      ) : null}
      {isApi && apiResult.error ? <div className="result-hint">{apiResult.error}</div> : null}
      {!urlValid && searchUrl.trim() ? (
        <div className="result-hint">搜索地址必须为 http(s)，并且包含 {'{keyword}'}</div>
      ) : null}
      <p className="settings-hint" style={{ marginTop: 10 }}>
        普通站点需要填写列表分割符；API 站点填写 JSON 映射。浏览器渲染用于必须执行
        JavaScript 的站点，会打开一个隐藏窗口。
      </p>
    </Modal>
  )
}
