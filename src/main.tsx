import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { applyCachedUiSettings } from './utils/theme'

// 先按上次的主题同步上色，再从主进程同步（避免深色闪屏）
applyCachedUiSettings()

/** 渲染层未捕获错误落盘：3 秒内只报一次，避免同一异常刷屏 */
let lastReportAt = 0
function reportRendererError(label: string, value: unknown): void {
  const now = Date.now()
  if (now - lastReportAt < 3000) return
  lastReportAt = now
  const error = value instanceof Error ? value : null
  const message = error?.message || String(value ?? '未知错误')
  if (!window.laozheng?.reportError) return
  void window.laozheng
    .reportError({ label, message, stack: error?.stack })
    .catch(() => undefined)
}

window.addEventListener('error', (event) => {
  reportRendererError('window', event.error ?? event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  reportRendererError('unhandledrejection', event.reason)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
