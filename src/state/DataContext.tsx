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

type SaveState = 'idle' | 'saving' | 'saved'

interface DataContextValue {
  data: AppData
  ready: boolean
  saveState: SaveState
  update: (fn: (data: AppData) => AppData) => void
  replaceData: (data: AppData) => void
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(EMPTY_DATA)
  const [ready, setReady] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const dataRef = useRef<AppData>(EMPTY_DATA)
  const timerRef = useRef<number | null>(null)

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
    window.laozheng
      .saveData(next)
      .then(() => setSaveState('saved'))
      .catch((err) => {
        console.error('[data] 保存失败', err)
        setSaveState('idle')
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
      setData(next)
      scheduleSave(next)
    },
    [scheduleSave]
  )

  const replaceData = useCallback(
    (next: AppData) => {
      dataRef.current = next
      setData(next)
      flush(next)
    },
    [flush]
  )

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
