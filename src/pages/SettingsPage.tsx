import { useEffect, useState } from 'react'
import { Download, FolderOpen, Upload } from 'lucide-react'
import type { AppData } from '../shared/types'
import { useData } from '../state/DataContext'
import { ConfirmDialog } from '../components/ui'

export function SettingsPage({ onNotice }: { onNotice: (text: string) => void }) {
  const { data, replaceData } = useData()
  const [version, setVersion] = useState('—')
  const [dataDir, setDataDir] = useState('')
  const [pendingImport, setPendingImport] = useState<AppData | null>(null)

  useEffect(() => {
    window.laozheng.appVersion().then(setVersion)
    window.laozheng.dataDir().then(setDataDir)
  }, [])

  const doImport = async () => {
    const res = await window.laozheng.importData()
    if (res.canceled) return
    if (res.error) {
      onNotice(`导入失败：${res.error}`)
      return
    }
    if (res.data) setPendingImport(res.data)
  }

  const confirmImport = () => {
    if (!pendingImport) return
    replaceData(pendingImport)
    onNotice(
      `已导入：${pendingImport.items.length} 个条目 / ${pendingImport.lists.length} 个清单 / ${pendingImport.innerFavs.length} 条收藏`
    )
    setPendingImport(null)
  }

  const doExport = async () => {
    const res = await window.laozheng.exportData(data)
    if (res.error) {
      onNotice(`导出失败：${res.error}`)
      return
    }
    if (!res.canceled && res.path) onNotice(`已导出到 ${res.path}`)
  }

  const openDir = async () => {
    try {
      await window.laozheng.openDataDir()
    } catch (err) {
      onNotice(`打开目录失败：${(err as Error).message}`)
    }
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">设置</h1>
        <span className="page-desc">数据、备份与两端同步</span>
      </header>

      <div className="settings">
        <section className="settings-card">
          <h3>数据概览</h3>
          <p className="settings-hint">
            与手机端共用同一份备份格式（version 1），字段完全一致。手机端「数据管理 → 导出」的文件可以直接导入这里，反向亦然。
          </p>
          <div className="settings-row">
            <span className="settings-label">收藏条目</span>
            <span className="settings-value">{data.items.length} 条</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">清单</span>
            <span className="settings-value">{data.lists.length} 个</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">爱心收藏</span>
            <span className="settings-value">{data.innerFavs.length} 条</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">片源</span>
            <span className="settings-value">{data.vodSources.length} 个</span>
          </div>
        </section>

        <section className="settings-card">
          <h3>导入 / 导出</h3>
          <p className="settings-hint">
            导入会覆盖本机当前数据；导出生成手机端可直接识别的 JSON。云同步（坚果云 WebDAV）计划在后续版本接入。
          </p>
          <div className="settings-row">
            <button className="btn" onClick={doImport}>
              <Upload size={15} /> 导入手机端备份
            </button>
            <button className="btn" onClick={doExport}>
              <Download size={15} /> 导出备份
            </button>
          </div>
        </section>

        <section className="settings-card">
          <h3>数据文件</h3>
          <p className="settings-hint">
            所有数据保存在本机 userData 目录下的 data.json，写入采用临时文件替换，避免中断损坏。
          </p>
          <div className="settings-row">
            <button className="btn" onClick={openDir}>
              <FolderOpen size={15} /> 打开数据目录
            </button>
            <span className="settings-value">{dataDir || 'data.json'}</span>
          </div>
        </section>

        <section className="settings-card">
          <h3>关于</h3>
          <div className="settings-row">
            <span className="settings-label">PC 端版本</span>
            <span className="settings-value">{version}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">技术栈</span>
            <span className="settings-value">Electron + React + TypeScript</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">备份格式</span>
            <span className="settings-value">version 1（与手机端一致）</span>
          </div>
        </section>
      </div>

      {pendingImport && (
        <ConfirmDialog
          title="导入备份"
          message={`将用备份覆盖本机数据：\n${pendingImport.items.length} 个条目 · ${pendingImport.lists.length} 个清单 · ${pendingImport.innerFavs.length} 条收藏 · ${pendingImport.vodSources.length} 个片源\n\n当前本机数据会被替换，建议先导出一份备份。`}
          confirmText="覆盖导入"
          danger
          onConfirm={confirmImport}
          onCancel={() => setPendingImport(null)}
        />
      )}
    </>
  )
}
