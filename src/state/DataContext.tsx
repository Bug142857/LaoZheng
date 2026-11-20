import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import type { AppData } from '../shared/types'
import { EMPTY_DATA } from '../shared/types'
import { applyUiSettings } from '../utils/theme'
import { clearModuleCaches } from '../utils/cache'

type SaveState = 'idle' | 'saving' | 'saved'

interface DataContextValue {
  data: AppData
  ready: boolean
  saveState: SaveState
  update: (fn: (data: AppData) => AppData) => void
  /** 播放 / 阅读进度：只更新内存并提交给主进程独立存储，不触发整份 data.json 重写 */
  updateProgress: (key: string, value: string | number) => void
  /** 读取某一刻的最新进度（事件回调里用，不订阅、不触发重渲染） */
  getProgressSnapshot: () => Record<string, string>
  /** 订阅进度变化：只让真正用到进度的组件重渲染 */
  subscribeProgress: (listener: () => void) => () => void
  replaceData: (data: AppData, reason?: string) => Promise<void>
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(EMPTY_DATA)
  const [ready, setReady] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const dataRef = useRef<AppData>(EMPTY_DATA)
  const timerRef = useRef<number | null>(null)
  /** 有改动还没写进 data.json（退出前需要同步落盘） */
  const dirtyRef = useRef(false)
  /** 串行保存：避免慢的先发后到，把新数据覆盖成旧数据 */
  const saveChainRef = useRef<Promise<void>>(Promise.resolve())
  /** 保存失败提示节流：避免每次防抖保存都弹一次 */
  const lastSaveErrorAtRef = useRef(0)
  /** 进度独立订阅源：更新时不 setData，避免所有 useData 消费者一起重渲染 */
  const progressRef = useRef<Record<string, string>>({})
  const progressListenersRef = useRef<Set<() => void>>(new Set())

  const getProgressSnapshot = useCallback(() => progressRef.current, [])

  const subscribeProgress = useCallback((listener: () => void) => {
    const listeners = progressListenersRef.current
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const notifyProgress = useCallback(() => {
    progressListenersRef.current.forEach((listener) => listener())
  }, [])

  const notifySaveError = useCallback((err: unknown) => {
    const now = Date.now()
    if (now - lastSaveErrorAtRef.current < 10_000) return
    lastSaveErrorAtRef.current = now
    const detail =
      err instanceof Error && err.message
        ? `数据保存失败：${err.message}`
        : '数据保存失败，请检查磁盘空间或杀毒软件是否占用数据文件'
    window.dispatchEvent(new CustomEvent('laozheng:save-error', { detail }))
  }, [])

  useEffect(() => {
    let alive = true
    window.laozheng.loadData().then((loaded) => {
      if (!alive) return
      dataRef.current = loaded
      progressRef.current = loaded.readProgress
      setData(loaded)
      setReady(true)
      notifyProgress()
    })
    return () => {
      alive = false
    }
  }, [notifyProgress])

  // 新版本首次启动：种子里的软件使用经验 / 演唱标题在开窗后才合并，
  // 主进程合并完通知这里重新读一次，避免界面一直显示旧内容。
  useEffect(() => {
    let alive = true
    const off = window.laozheng.onSeedSynced(() => {
      // 本地还有没落盘的修改时不覆盖，下次启动再同步
      if (dirtyRef.current) return
      window.laozheng
        .loadData()
        .then((loaded) => {
          if (!alive) return
          dataRef.current = loaded
          progressRef.current = loaded.readProgress
          setData(loaded)
          notifyProgress()
        })
        .catch((err) => console.error('[data] 种子同步后刷新数据失败', err))
    })
    return () => {
      alive = false
      off()
    }
  }, [notifyProgress])

  const flush = useCallback((next: AppData) => {
    setSaveState('saving')
    saveChainRef.current = saveChainRef.current
      .catch(() => undefined)
      .then(() => window.laozheng.saveData(next))
      .then(() => {
        // 只有落盘的就是当前最新数据时才标记已保存，避免旧请求把状态改回 saved
        if (dataRef.current === next) {
          dirtyRef.current = false
          setSaveState('saved')
        }
      })
      .catch((err) => {
        console.error('[data] 保存失败', err)
        if (dataRef.current === next) setSaveState('idle')
        notifySaveError(err)
      })
  }, [notifySaveError])

  const scheduleSave = useCallback(
    (next: AppData) => {
      setSaveState('saving')
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        flush(next)
      }, 350)
    },
    [flush]
  )

  const update = useCallback(
    (fn: (data: AppData) => AppData) => {
      const next = fn(dataRef.current)
      dataRef.current = next
      dirtyRef.current = true
      setData(next)
      scheduleSave(next)
    },
    [scheduleSave]
  )

  /**
   * 进度单独走主进程的 read-progress.json：
   * 以前每次进度变化都会触发整份 data.json（约 1.2MB）重写，播放时每 8 秒写一次。
   * 现在也不再 setData：只通知订阅进度的组件，避免所有 useData 消费者每 8 秒一起重渲染。
   */
  const updateProgress = useCallback(
    (key: string, value: string | number) => {
      if (!key) return
      const text = String(value)
      const current = progressRef.current
      if (current[key] === text) return
      const nextProgress = { ...current, [key]: text }
      progressRef.current = nextProgress
      // 同步 dataRef 供导出 / 退出保存兜底；不更新 data 状态，不触发整页渲染
      dataRef.current = { ...dataRef.current, readProgress: nextProgress }
      notifyProgress()
      void window.laozheng.setReadProgress(key, text).catch((err) => {
        console.error('[data] 保存播放进度失败', err)
      })
    },
    [notifyProgress]
  )

  const replaceData = useCallback(
    async (next: AppData, reason = 'import'): Promise<void> => {
      // 先把防抖队列里的最新改动落盘，快照才包含用户此刻看到的完整数据
      if (dirtyRef.current) {
        if (timerRef.current != null) {
          window.clearTimeout(timerRef.current)
          timerRef.current = null
        }
        await window.laozheng.saveData(dataRef.current).catch((err) => {
          console.error('[data] 覆盖前保存当前数据失败', err)
        })
        dirtyRef.current = false
      }
      // 覆盖本机数据前先留快照；快照失败直接中止，避免不可回滚
      const snapshot = await window.laozheng.snapshotData(reason).catch((err) => ({
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }))
      if (!snapshot.ok) {
        throw new Error(`无法创建本地快照，已取消覆盖：${snapshot.error ?? '未知错误'}`)
      }
      // 取消尚未触发的防抖保存：否则导入 / 云恢复后，旧的待保存数据会把新数据覆盖回磁盘
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      // 模块列表缓存不会随备份走：数据换了之后旧缓存可能指向已删除的源，直接清掉
      clearModuleCaches()
      // 常驻挂载的模块页还持有旧源的列表 / 详情状态，广播出去让 App 重新挂载它们
      window.dispatchEvent(new CustomEvent('laozheng:data-replaced'))
      // 电视源 / 下载记录 / 磁力源 / 本机设置 / 磁力搜索缓存都由主进程各自存储，
      // 备份里的这些字段已通过 applyBackupExtras 写回；不再落进 data.json，
      // 否则之后恢复快照会把 data.json 里的旧副本重新盖回这些存储。
      const persisted: AppData = {
        ...next,
        liveSources: undefined,
        downloads: undefined,
        magnetSources: undefined,
        magnetSearch: undefined,
        settings: undefined
      }
      dataRef.current = persisted
      dirtyRef.current = true
      progressRef.current = persisted.readProgress
      notifyProgress()
      setData(persisted)
      flush(persisted)
      // 导入 / 云恢复：把电视源、下载记录、本机设置一起写回，并立即应用新主题
      return window.laozheng
        .applyBackupExtras(next)
        .then(() => window.laozheng.getUiSettings())
        .then((settings) => {
          applyUiSettings(settings)
        })
        .catch((err) => console.error('[data] 恢复扩展数据失败', err))
    },
    [flush, notifyProgress]
  )

  // 关闭窗口前同步落盘，避免防抖队列里的最后一次修改丢失
  useEffect(() => {
    const flushSync = (): void => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (!dirtyRef.current) return
      try {
        window.laozheng.saveDataSync(dataRef.current)
        dirtyRef.current = false
      } catch (err) {
        console.error('[data] 退出前同步保存失败', err)
        notifySaveError(err)
      }
    }
    window.addEventListener('beforeunload', flushSync)
    return () => window.removeEventListener('beforeunload', flushSync)
  }, [notifySaveError])

  return (
    <DataContext.Provider
      value={{
        data,
        ready,
        saveState,
        update,
        updateProgress,
        getProgressSnapshot,
        subscribeProgress,
        replaceData
      }}
    >
      {children}
    </DataContext.Provider>
  )
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData 必须在 DataProvider 内使用')
  return ctx
}

/** 只订阅某个进度 key：key 不变或值没变时不会重渲染 */
export function useProgressValue(key: string): string | undefined {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useProgressValue 必须在 DataProvider 内使用')
  const getSnapshot = useCallback(
    () => (key ? ctx.getProgressSnapshot()[key] : undefined),
    [ctx, key]
  )
  return useSyncExternalStore(ctx.subscribeProgress, getSnapshot, getSnapshot)
}
