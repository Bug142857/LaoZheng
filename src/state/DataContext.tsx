import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { AppData } from '../shared/types'
import { EMPTY_DATA } from '../shared/types'
import { applyUiSettings } from '../utils/theme'

type SaveState = 'idle' | 'saving' | 'saved'

interface DataContextValue {
  data: AppData
  ready: boolean
  saveState: SaveState
  update: (fn: (data: AppData) => AppData) => void
  replaceData: (data: AppData) => Promise<void>
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

  useEffect(() => {
    let alive = true
    window.laozheng.loadData().then((loaded) => {
      if (!alive) return
      dataRef.current = loaded
      setData(loaded)
      setReady(true)
    })
    return () => {
      alive = false
    }
  }, [])

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
      })
  }, [])

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

  const replaceData = useCallback(
    (next: AppData): Promise<void> => {
      // 取消尚未触发的防抖保存：否则导入 / 云恢复后，旧的待保存数据会把新数据覆盖回磁盘
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      dataRef.current = next
      dirtyRef.current = true
      setData(next)
      flush(next)
      // 导入 / 云恢复：把电视源、下载记录、本机设置一起写回，并立即应用新主题
      return window.laozheng
        .applyBackupExtras(next)
        .then(() => window.laozheng.getUiSettings())
        .then((settings) => applyUiSettings(settings))
        .catch((err) => console.error('[data] 恢复扩展数据失败', err))
    },
    [flush]
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
      }
    }
    window.addEventListener('beforeunload', flushSync)
    return () => window.removeEventListener('beforeunload', flushSync)
  }, [])

  return (
    <DataContext.Provider value={{ data, ready, saveState, update, replaceData }}>
      {children}
    </DataContext.Provider>
  )
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData 必须在 DataProvider 内使用')
  return ctx
}
