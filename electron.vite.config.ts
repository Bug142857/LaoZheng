import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * 生产构建收紧 CSP：dev 模式下 Vite / React Refresh 会注入内联脚本，
 * 因此只在 build 时去掉 script-src 的 'unsafe-inline'，避免误伤开发热更新。
 */
function strictCspPlugin() {
  return {
    name: 'laozheng-strict-csp',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return html.replace(
        "script-src 'self' 'unsafe-inline' blob:",
        "script-src 'self' blob:"
      )
    }
  }
}

export default defineConfig({
  main: {
    // node-html-parser / adm-zip / iconv-lite / undici 打进主进程 bundle：安装包 files 只含 out/**，避免依赖漏打包
    plugins: [externalizeDepsPlugin({ exclude: ['node-html-parser', 'adm-zip', 'iconv-lite', 'undici'] })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    plugins: [react(), strictCspPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/index.html')
      }
    }
  }
})
