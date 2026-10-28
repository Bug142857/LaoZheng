import { useEffect, useState } from 'react'
import { Cloud, Download, FolderOpen, Upload } from 'lucide-react'
import type { AppData } from '../shared/types'
import type { AccountSite, AccountsView } from '../shared/accounts'
import type { SyncConfigView } from '../shared/sync'
import { useData } from '../state/DataContext'
import { ConfirmDialog } from '../components/ui'

const ACCOUNT_STATE_LABEL: Record<string, string> = {
  ok: '已登录',
  failed: '失败',
  pending: '登录中',
  unknown: '待确认'
}

export function SettingsPage({ onNotice }: { onNotice: (text: string) => void }) {
  const { data, replaceData } = useData()
  const [version, setVersion] = useState('—')
  const [dataDir, setDataDir] = useState('')
  const [pendingImport, setPendingImport] = useState<AppData | null>(null)
  const [sync, setSync] = useState<SyncConfigView | null>(null)
  const [accounts, setAccounts] = useState<AccountsView | null>(null)
  const [accountBusy, setAccountBusy] = useState<AccountSite | null>(null)
  const [syncUrl, setSyncUrl] = useState('')
  const [syncUser, setSyncUser] = useState('')
  const [syncPass, setSyncPass] = useState('')
  const [syncBusy, setSyncBusy] = useState<string | null>(null)
  const [pendingSync, setPendingSync] = useState<AppData | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    window.laozheng.appVersion().then(setVersion)
    window.laozheng.dataDir().then(setDataDir)
    window.laozheng.getSyncConfig().then((cfg) => {
      setSync(cfg)
      setSyncUrl(cfg.url)
      setSyncUser(cfg.username)
    })
  }, [])

  useEffect(() => {
    const refresh = () => {
      void window.laozheng.listAccounts().then(setAccounts)
    }
    refresh()
    return window.laozheng.onAccountsChanged(refresh)
  }, [])

  const loginAccount = async (site: AccountSite) => {
    setAccountBusy(site)
    const res = await window.laozheng.loginAccount(site)
    setAccountBusy(null)
    void window.laozheng.listAccounts().then(setAccounts)
    onNotice(res.message)
  }

  const openAccountLogin = async (site: AccountSite) => {
    await window.laozheng.openAccountLogin(site)
  }

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

  const saveSyncConfig = async () => {
    setSyncBusy('save')
    const cfg = await window.laozheng.saveSyncConfig({
      url: syncUrl,
      username: syncUser,
      password: syncPass || undefined
    })
    setSyncBusy(null)
    setSync(cfg)
    setSyncPass('')
    onNotice('云同步配置已保存到本机')
  }

  const testSync = async () => {
    setSyncBusy('test')
    const res = await window.laozheng.testSync()
    setSyncBusy(null)
    onNotice(res.message)
  }

  const uploadSync = async () => {
    setSyncBusy('upload')
    const res = await window.laozheng.uploadSync(data)
    setSyncBusy(null)
    onNotice(res.message)
  }

  const downloadSync = async () => {
    setSyncBusy('download')
    const res = await window.laozheng.downloadSync()
    setSyncBusy(null)
    if (!res.ok) {
      onNotice(res.message)
      return
    }
    if (res.data) setPendingSync(res.data as AppData)
  }

  const checkUpdate = async () => {
    setChecking(true)
    const res = await window.laozheng.checkUpdate()
    setChecking(false)
    if (!res.ok) {
      onNotice(res.error ?? '检查更新失败')
      return
    }
    if (!res.hasUpdate) {
      onNotice(`已是最新版本 ${res.current}`)
      return
    }
    onNotice(`发现新版本 ${res.latest}，正在打开下载页…`)
    if (res.url) {
      try {
        await window.laozheng.openExternal(res.url)
      } catch {
        onNotice(`新版本 ${res.latest} 已发布，但打开下载页失败`)
      }
    }
  }

  const confirmSyncImport = () => {
    if (!pendingSync) return
    replaceData(pendingSync)
    onNotice(
      `已从云端恢复：${pendingSync.items.length} 个条目 / ${pendingSync.lists.length} 个清单 / ${pendingSync.innerFavs.length} 条收藏`
    )
    setPendingSync(null)
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
          <h3>账号管理（已内置）</h3>
          <p className="settings-hint">
            哔咔 / Komiic / 无忧三个站点的账号已加密保存在本机，启动时自动登录：哔咔与
            Komiic 静默换 token 并自动续期；无忧会自动完成滑块验证，并复用持久化会话。
            账号密码不会出现在备份文件、日志或代码里。
          </p>
          {accounts?.items.map((item) => (
            <div className="account-row" key={item.site}>
              <div className="account-main">
                <div className="account-title">
                  {item.title}
                  <span className={`account-state ${item.status}`}>
                    {ACCOUNT_STATE_LABEL[item.status] ?? item.status}
                  </span>
                </div>
                <div className="account-meta">
                  {item.username || '未配置账号'} · {item.message}
                </div>
              </div>
              <button
                className="btn"
                disabled={accountBusy === item.site}
                onClick={() => void loginAccount(item.site)}
              >
                {accountBusy === item.site ? '登录中…' : '重新登录'}
              </button>
              {item.site === 'wygamer' ? (
                <button className="btn ghost" onClick={() => void openAccountLogin(item.site)}>
                  打开登录窗口
                </button>
              ) : null}
            </div>
          ))}
          {!accounts ? <div className="settings-hint">正在读取账号状态…</div> : null}
        </section>

        <section className="settings-card">
          <h3>云同步（WebDAV）</h3>
          <p className="settings-hint">
            与手机端共用同一份 data.json，可手动上传 / 恢复。坚果云地址形如
            https://dav.jianguoyun.com/dav/老郑分享/ ，密码要用「应用密码」。账号密码只存本机（加密），不会写进备份。
          </p>
          <div className="form-grid">
            <label>
              WebDAV 地址
              <input
                value={syncUrl}
                onChange={(e) => setSyncUrl(e.target.value)}
                placeholder="https://dav.jianguoyun.com/dav/老郑分享/"
              />
            </label>
            <label>
              账号
              <input value={syncUser} onChange={(e) => setSyncUser(e.target.value)} placeholder="邮箱" />
            </label>
            <label>
              密码 / 应用密码
              <input
                type="password"
                value={syncPass}
                onChange={(e) => setSyncPass(e.target.value)}
                placeholder={sync?.hasPassword ? '已保存，留空表示不修改' : '输入应用密码'}
              />
            </label>
          </div>
          <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button className="btn" disabled={!!syncBusy} onClick={() => void saveSyncConfig()}>
              {syncBusy === 'save' ? '保存中…' : '保存配置'}
            </button>
            <button className="btn" disabled={!!syncBusy} onClick={() => void testSync()}>
              <Cloud size={15} /> {syncBusy === 'test' ? '测试中…' : '测试连接'}
            </button>
            <button className="btn" disabled={!!syncBusy} onClick={() => void uploadSync()}>
              <Upload size={15} /> {syncBusy === 'upload' ? '上传中…' : '上传到云端'}
            </button>
            <button className="btn" disabled={!!syncBusy} onClick={() => void downloadSync()}>
              <Download size={15} /> {syncBusy === 'download' ? '下载中…' : '从云端恢复'}
            </button>
          </div>
        </section>

        <section className="settings-card">
          <h3>关于</h3>
          <div className="settings-row">
            <span className="settings-label">PC 端版本</span>
            <span className="settings-value">{version}</span>
            <button className="btn" disabled={checking} onClick={() => void checkUpdate()}>
              {checking ? '检查中…' : '检查更新'}
            </button>
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

      {pendingSync && (
        <ConfirmDialog
          title="从云端恢复"
          message={`将用云端备份覆盖本机数据：\n${pendingSync.items.length} 个条目 · ${pendingSync.lists.length} 个清单 · ${pendingSync.innerFavs.length} 条收藏 · ${pendingSync.vodSources.length} 个片源\n\n当前本机数据会被替换，建议先点「上传到云端」保留一份。`}
          confirmText="覆盖恢复"
          danger
          onConfirm={confirmSyncImport}
          onCancel={() => setPendingSync(null)}
        />
      )}
    </>
  )
}
