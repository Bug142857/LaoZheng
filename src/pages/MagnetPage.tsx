import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { EmptyState, LoadingBlock } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { useData } from '../state/DataContext'
import {
  DEFAULT_MAGNET_OPTIONS,
  DEFAULT_MAGNET_SORT,
  type MagnetItem,
  type MagnetSearchCache,
  type MagnetSearchResponse,
  type MagnetSortField,
  type MagnetSortOrder,
  type MagnetSource
} from '../shared/magnet'

/** 单次搜索最多缓存这么多条，避免把 data.json 撑得过大 */
const MAX_CACHED_ITEMS = 300
/** 全部源搜索时同时请求几个源；结果按源返回实时追加 */
const SEARCH_CONCURRENCY = 5

function compareItems(
  a: MagnetItem,
  b: MagnetItem,
  field: MagnetSortField,
  order: MagnetSortOrder
): number {
  const direction = order === 'asc' ? 1 : -1
  if (field === 'name') return direction * a.title.localeCompare(b.title, 'zh-Hans-CN')
  const left = field === 'size' ? a.sizeBytes : a.timeMs
  const right = field === 'size' ? b.sizeBytes : b.timeMs
  if (!left && !right) return 0
  // 未知大小 / 时间始终排在后面，不随升降序翻转
  if (!left) return 1
  if (!right) return -1
  return direction * (left - right)
}

function mergeItems(previous: MagnetItem[], next: MagnetItem[], dedupe: boolean): MagnetItem[] {
  const merged = [...previous, ...next]
  if (!dedupe) return merged.slice(0, MAX_CACHED_ITEMS)
  const seen = new Set<string>()
  return merged
    .filter((item) => {
      const key = (item.hash || item.magnet).toLowerCase()
      if (!key) return true
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_CACHED_ITEMS)
}

/** 结果小字里的「格式」：优先文件扩展名，没有就退到清晰度 */
function formatOf(title: string): string {
  const ext = /\.(mp4|mkv|avi|rmvb|rm|wmv|mov|flv|ts|m2ts|iso|mpg|mpeg|webm|zip|rar|7z)\b/i.exec(
    title
  )
  if (ext) return ext[1].toUpperCase()
  const quality = /\b(4k|2160p|1080p|720p|480p|360p)\b/i.exec(title)
  return quality ? quality[1].toUpperCase() : ''
}

export function MagnetPage({
  onNotice,
  resetSignal,
  searchTitle
}: {
  onNotice: (text: string) => void
  resetSignal?: number
  /** 从清单条目「下载」带入的片名：自动搜索全部磁力源 */
  searchTitle?: string
}) {
  const { data, update } = useData()
  const cached = data.magnetSearch
  const [sources, setSources] = useState<MagnetSource[]>([])
  const [sourcesReady, setSourcesReady] = useState(false)
  const [sourceId, setSourceId] = useState(cached?.sourceId ?? '')
  const [keyword, setKeyword] = useState(cached?.keyword ?? '')
  const [items, setItems] = useState<MagnetItem[]>(cached?.items ?? [])
  const [page, setPage] = useState(cached?.page ?? 1)
  const [hasNext, setHasNext] = useState(cached?.hasNext ?? false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searched, setSearched] = useState(cached?.searched ?? false)
  const [errors, setErrors] = useState<string[]>(cached?.errors ?? [])
  const [sortField, setSortField] = useState<MagnetSortField>(
    cached?.sortField ?? DEFAULT_MAGNET_SORT.field
  )
  const [sortOrder, setSortOrder] = useState<MagnetSortOrder>(
    cached?.sortOrder ?? DEFAULT_MAGNET_SORT.order
  )
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  /** 递增表示「本次搜索已作废」：取消或开始新搜索后，旧结果直接丢弃 */
  const seqRef = useRef(0)
  /** 上一次写进缓存的 updatedAt，用来区分「自己写的」和「导入 / 云恢复带回来的」 */
  const savedAtRef = useRef(cached?.updatedAt ?? 0)
  /** 已按清单片名自动搜过的关键词，避免同一次进入重复触发 */
  const handledTitleRef = useRef('')

  useEffect(() => {
    let alive = true
    void window.laozheng
      .magnetState()
      .then((state) => {
        if (!alive) return
        setSources(state.sources)
        setSourcesReady(true)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setSourcesReady(true)
        onNotice(`读取磁力源失败：${(err as Error).message}`)
      })
    return () => {
      alive = false
    }
  }, [onNotice])

  useEffect(() => {
    if (resetSignal === undefined) return
    // 从片源管理回到模块时只刷新磁力源列表，保留上次搜索结果
    void window.laozheng
      .magnetState()
      .then((state) => setSources(state.sources))
      .catch(() => undefined)
  }, [resetSignal])

  const enabledSources = useMemo(() => sources.filter((source) => source.enabled), [sources])

  useEffect(() => {
    // 磁力源列表还没读完时不要清空缓存里恢复出来的选择
    if (!sources.length || !sourceId) return
    if (!enabledSources.some((source) => source.id === sourceId)) setSourceId('')
  }, [sources.length, enabledSources, sourceId])

  // 导入备份 / 云恢复后，用新的搜索缓存刷新界面
  useEffect(() => {
    const restored = data.magnetSearch
    if (!restored) {
      // 备份里没有磁力搜索缓存：清掉当前展示，避免和刚导入的数据不一致
      if (savedAtRef.current !== 0) {
        savedAtRef.current = 0
        setKeyword('')
        setItems([])
        setSearched(false)
        setErrors([])
        setPage(1)
        setHasNext(false)
      }
      return
    }
    if (restored.updatedAt === savedAtRef.current) return
    savedAtRef.current = restored.updatedAt
    setKeyword(restored.keyword)
    setSourceId(restored.sourceId)
    setItems(restored.items)
    setPage(restored.page)
    setHasNext(restored.hasNext)
    setSearched(restored.searched)
    setErrors(restored.errors)
    setSortField(restored.sortField)
    setSortOrder(restored.sortOrder)
  }, [data.magnetSearch])

  // 离开磁力页后清空「已自动搜索」标记，下次用同一个片名再点下载仍会重新搜索
  useEffect(() => {
    if (!searchTitle) handledTitleRef.current = ''
  }, [searchTitle])

  // 清单条目「下载」：带着片名进来，直接搜索全部磁力源
  useEffect(() => {
    const title = searchTitle?.trim()
    if (!title || !sourcesReady) return
    if (handledTitleRef.current === title) return
    handledTitleRef.current = title
    setKeyword(title)
    setSourceId('')
    void runSearch(1, false, title, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTitle, sourcesReady])

  // 搜索状态写入 data.json：切模块 / 重开应用 / 导入导出 / 云同步都带着
  useEffect(() => {
    if (!searched && !items.length) return
    const next: MagnetSearchCache = {
      keyword,
      sourceId,
      items,
      page,
      hasNext,
      searched,
      errors,
      sortField,
      sortOrder,
      updatedAt: Date.now()
    }
    savedAtRef.current = next.updatedAt
    update((current) => ({ ...current, magnetSearch: next }))
  }, [keyword, sourceId, items, page, hasNext, searched, errors, sortField, sortOrder, update])

  const activeSource = enabledSources.find((source) => source.id === sourceId)

  const sortedItems = useMemo(() => {
    const copy = [...items]
    copy.sort((a, b) => compareItems(a, b, sortField, sortOrder))
    return copy
  }, [items, sortField, sortOrder])

  const sourceCount = useMemo(() => new Set(items.map((item) => item.sourceId)).size, [items])

  const runSearch = async (
    nextPage: number,
    append: boolean,
    rawKeyword?: string,
    allSources = false
  ): Promise<void> => {
    const clean = (rawKeyword ?? keyword).trim()
    const selected = allSources ? undefined : activeSource
    if (!clean) {
      onNotice('请输入搜索关键词')
      return
    }
    if (!enabledSources.length) {
      onNotice('没有启用的磁力源，请到 配置管理 → 片源管理 → 磁力源 启用')
      return
    }
    if (!allSources && sourceId && !activeSource) {
      onNotice('这个磁力源已停用')
      return
    }

    if (append && selected) {
      const seq = seqRef.current
      setLoadingMore(true)
      try {
        const result = await window.laozheng.searchMagnet(
          selected,
          clean,
          nextPage,
          DEFAULT_MAGNET_OPTIONS
        )
        if (seq !== seqRef.current) return
        if (!result.ok) {
          onNotice(result.error ?? '搜索失败')
          return
        }
        setItems((previous) => mergeItems(previous, result.items, DEFAULT_MAGNET_OPTIONS.dedupe))
        setPage(result.page)
        setHasNext(result.hasNext)
        setErrors(result.errors)
      } catch (err) {
        if (seq === seqRef.current) onNotice(`搜索失败：${(err as Error).message}`)
      } finally {
        if (seq === seqRef.current) setLoadingMore(false)
      }
      return
    }

    const targets = selected ? [selected] : enabledSources
    const seq = ++seqRef.current
    setLoading(true)
    setSearched(true)
    setItems([])
    setErrors([])
    setPage(1)
    setHasNext(false)
    setProgress({ done: 0, total: targets.length })
    const failures: string[] = []
    let done = 0

    const searchOne = async (source: MagnetSource): Promise<void> => {
      let result: MagnetSearchResponse
      try {
        result = await window.laozheng.searchMagnet(source, clean, 1, DEFAULT_MAGNET_OPTIONS)
      } catch (err) {
        result = {
          ok: false,
          items: [],
          hasNext: false,
          page: 1,
          sourceId: source.id,
          errors: [],
          error: (err as Error).message
        }
      }
      if (seq !== seqRef.current) return
      done += 1
      setProgress({ done, total: targets.length })
      if (!result.ok) {
        failures.push(`${source.name}：${result.error ?? '搜索失败'}`)
        setErrors([...failures])
        return
      }
      // 每搜到一个源就实时追加，不等全部完成
      setItems((previous) =>
        mergeItems(previous, result.items, DEFAULT_MAGNET_OPTIONS.dedupe)
      )
      if (targets.length === 1) {
        setPage(result.page)
        setHasNext(result.hasNext)
      }
    }

    // 普通站点并发抓取；需要隐藏浏览器的站点逐个跑，避免同时开多个窗口
    const httpTargets = targets.filter((source) => !source.useWebView2)
    const windowTargets = targets.filter((source) => source.useWebView2)
    let cursor = 0
    const httpWorker = async (): Promise<void> => {
      for (;;) {
        const source = httpTargets[cursor++]
        if (!source || seq !== seqRef.current) return
        await searchOne(source)
      }
    }

    try {
      await Promise.all(
        Array.from({ length: Math.min(SEARCH_CONCURRENCY, httpTargets.length) }, httpWorker)
      )
      for (const source of windowTargets) {
        if (seq !== seqRef.current) break
        await searchOne(source)
      }
    } finally {
      if (seq === seqRef.current) {
        setLoading(false)
        if (failures.length) onNotice(`部分磁力源失败：${failures.length} 个`)
      }
    }
  }

  /** 再次点击搜索按钮 = 取消本次搜索，保留已经返回的结果 */
  const stopSearch = (): void => {
    seqRef.current += 1
    setLoading(false)
    setLoadingMore(false)
    setProgress((previous) => ({ ...previous, done: previous.total }))
  }

  const copyMagnet = async (item: MagnetItem): Promise<void> => {
    try {
      await navigator.clipboard.writeText(item.magnet)
      onNotice('磁力链接已复制')
    } catch {
      onNotice('复制失败，请检查剪贴板权限')
    }
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">磁力</h1>
      </header>

      <SearchBar
        value={keyword}
        onChange={setKeyword}
        onSubmit={() => void runSearch(1, false)}
        onCancel={stopSearch}
        onClear={() => {
          setKeyword('')
          seqRef.current += 1
          setLoading(false)
          setLoadingMore(false)
          setSearched(false)
          setItems([])
          setErrors([])
          setPage(1)
          setHasNext(false)
          savedAtRef.current = 0
          update((current) => ({ ...current, magnetSearch: undefined }))
        }}
        searching={loading}
        placeholder="输入关键词，回车搜索"
        leading={
          <select
            className="select-inline"
            value={sourceId}
            onChange={(event) => {
              // 换源时先停掉正在跑的旧搜索，避免旧源结果继续追加
              if (loading) stopSearch()
              setSourceId(event.target.value)
            }}
            title="选择磁力源"
            style={{ maxWidth: 200 }}
          >
            <option value="">全部源（{enabledSources.length}）</option>
            {enabledSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        }
        extra={
          <>
            <select
              className="select-inline"
              value={sortField}
              onChange={(event) => setSortField(event.target.value as MagnetSortField)}
              title="排序字段"
            >
              <option value="size">按大小</option>
              <option value="time">按时间</option>
              <option value="name">按名称</option>
            </select>
            <button
              type="button"
              className="chip"
              title="切换升序 / 降序"
              onClick={() => setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'))}
            >
              {sortOrder === 'asc' ? '升序 ↑' : '降序 ↓'}
            </button>
          </>
        }
      />

      {!enabledSources.length ? (
        <EmptyState
          title="没有启用的磁力源"
          desc="到「配置管理 → 片源管理 → 磁力源」启用或导入磁力源。"
        />
      ) : !searched ? (
        <EmptyState
          title="搜索磁力资源"
          desc="默认搜索全部源，也可以先在搜索框前选择单个源；结果会随源返回实时追加。"
        />
      ) : sortedItems.length === 0 && loading ? (
        <LoadingBlock
          text={
            sourceId
              ? '正在搜索磁力源…'
              : `正在搜索 ${enabledSources.length} 个磁力源，全部搜索需要稍等…`
          }
        />
      ) : sortedItems.length === 0 ? (
        <EmptyState
          title="没有找到结果"
          desc={
            errors.length
              ? '磁力源可能被反爬或已改版，可以到 片源管理 → 磁力源 里逐个检验。'
              : '换个关键词，或到 片源管理 → 磁力源 里启用更多源。'
          }
        />
      ) : (
        <>
          <div className="page-desc" style={{ marginBottom: 10 }}>
            {loading
              ? `共 ${items.length} 条结果 · 搜索中 ${progress.done}/${progress.total} 个源`
              : `共 ${items.length} 条结果 · 来源 ${sourceCount} 个`}
            {errors.length > 0 ? ` · 失败 ${errors.length} 个` : ''}
          </div>

          <div className="rows">
            {sortedItems.map((item) => (
              <div key={item.id} className="row">
                <span className="badge">{item.sourceName}</span>
                <div className="row-main">
                  <div className="row-title" title={item.title}>
                    {item.title}
                  </div>
                  <div className="row-meta">
                    {[item.size, item.time, formatOf(item.title)].filter(Boolean).join(' · ') ||
                      '—'}
                  </div>
                </div>
                <button className="btn" onClick={() => void copyMagnet(item)}>
                  <Copy size={13} /> 复制磁力
                </button>
              </div>
            ))}
          </div>

          {hasNext && sourceId ? (
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button
                className="btn"
                disabled={loadingMore || loading}
                onClick={() => void runSearch(page + 1, true)}
              >
                {loadingMore ? '加载中…' : '加载更多'}
              </button>
            </div>
          ) : null}
        </>
      )}
    </>
  )
}
