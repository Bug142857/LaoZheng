import { Component, type ErrorInfo, type ReactNode } from 'react'
import { FolderOpen, RefreshCw, RotateCcw } from 'lucide-react'

/**
 * React 渲染错误边界：渲染异常不再让根节点清空导致整页白屏。
 * 每个模块页各包一层，单个模块出错只卸载该模块；数据层 / 应用根节点再包一层兜底。
 */

/** 更新后旧 chunk 404 等动态导入失败：React.lazy 会缓存 rejected promise，reset 无法重试 */
function isChunkLoadError(error: Error): boolean {
  const text = `${error.name} ${error.message}`
  return /ChunkLoadError|Loading chunk [^ ]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
    text
  )
}

export class ErrorBoundary extends Component<
  { children: ReactNode; label?: string; fullPage?: boolean },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 只记录模块名与堆栈，不写账号 / Cookie 等敏感信息
    console.error(`[render] ${this.props.label ?? '页面'}渲染异常`, error, info.componentStack)
    if (!window.laozheng?.reportError) return
    void window.laozheng
      .reportError({
        label: this.props.label ?? '页面',
        message: error.message || '渲染异常',
        stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}`.slice(0, 8000)
      })
      .catch(() => undefined)
  }

  private retry = (): void => {
    this.setState({ error: null })
  }

  private reloadApp = (): void => {
    window.location.reload()
  }

  private openDataDir = (): void => {
    void window.laozheng.openDataDir().catch(() => undefined)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const label = this.props.label ?? '页面'
    // chunk 加载失败时重置边界不会重新 import，只能整页重新加载
    const chunkError = isChunkLoadError(error)
    return (
      <div className={`error-boundary${this.props.fullPage ? ' full' : ''}`}>
        <div className="error-boundary-card">
          <div className="error-boundary-title">{label}渲染出错</div>
          <div className="error-boundary-message">
            {chunkError ? '页面资源已更新或加载失败，需要重新加载。' : error.message || '未知错误'}
          </div>
          <div className="error-boundary-actions">
            <button
              className="btn primary"
              onClick={chunkError ? this.reloadApp : this.retry}
            >
              {chunkError ? <RefreshCw size={15} /> : <RotateCcw size={15} />}
              {chunkError ? '重新加载' : '重试'}
            </button>
            {chunkError ? null : (
              <button className="btn" onClick={this.reloadApp}>
                <RefreshCw size={15} /> 重新加载
              </button>
            )}
            <button className="btn ghost" onClick={this.openDataDir}>
              <FolderOpen size={15} /> 打开数据目录
            </button>
          </div>
        </div>
      </div>
    )
  }
}
