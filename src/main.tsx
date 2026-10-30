import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { applyCachedUiSettings } from './utils/theme'

// 先按上次的主题同步上色，再从主进程同步（避免深色闪屏）
applyCachedUiSettings()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
