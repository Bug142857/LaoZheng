import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Cloud,
  Database,
  Download,
  Eraser,
  Heart,
  ListChecks,
  LogIn,
  Palette,
  RefreshCw,
  Tv,
  Upload,
  UserRound,
  type LucideIcon
} from 'lucide-react'
import type { AppData, DataSnapshotInfo } from '../shared/types'
import type { AccountSite, AccountsView } from '../shared/accounts'
import type { DoubanAuthStatus } from '../shared/douban'
import type { CacheInfo, ThemeMode, UiSettings } from '../shared/settings'
import type { SyncConfigView } from '../shared/sync'
import type { ZlibStatusResponse } from '../shared/zlib'
import type { UpdateCheckResult } from '../shared/update'
import { formatBytes } from '../shared/downloads'
import { useData } from '../state/DataContext'
import { clearModuleCaches } from '../utils/cache'
import { ConfirmDialog, Modal, PasswordDialog } from '../components/ui'
import { UpdateModal } from '../components/UpdateModal'
import { SourceSettings } from './SourceSettings'
import { ListManagerSection } from './ListManagerSection'
import {
  ACCENT_OPTIONS,
  DEFAULT_UI_SETTINGS,
  GLASS_OPTIONS,
  THEME_OPTIONS,
  glassAlphaValue,
  saveUiSettings,
  syncUiSettings,
  windowAlphaValue
} from '../utils/theme'

const ACCOUNT_STATE_LABEL: Record<string, string> = {
  ok: '已登录',
  failed: '失败',
  pending: '登录中',
  unknown: '待确认'
}

type Section = 'root' | 'theme' | 'data' | 'accounts' | 'sources' | 'lists'

const SECTION_TITLE: Record<Exclude<Section, 'root'>, string> = {
  theme: '主题管理',
  data: '数据管理',
  accounts: '账号管理',
  sources: '片源管理',
  lists: '清单管理'
}

function themeLabel(mode: ThemeMode): string {
  return mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统'
}

function accentLabel(key: string): string {
  return ACCENT_OPTIONS.find((a) => a.key === key)?.label ?? '紫'
}

function formatSnapshotTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return new Date(ms).toISOString()
  }
}

/** 快照原因中文化，避免设置页直接显示 import / auto */
function snapshotReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    auto: '每日自动备份',
    import: '导入前',
    sync: '云恢复前',
    snapshot: '快照恢复前',
    manual: '手动备份'
  }
  return labels[reason] ?? reason
}

export function SettingsPage({
  onNotice,
  onOpenPage,
  resetSignal,
  developerMode,
  onEnterDeveloperMode
}: {
  onNotice: (text: string) => void
  onOpenPage: (page: 'favorites' | 'downloads', moduleKey?: string) => void
  resetSignal?: number
  /** 开发者模式：本次客户端运行期间有效 */
  developerMode: boolean
  onEnterDeveloperMode: () => void
}) {
  const { data, replaceData } = useData()
  const [section, setSection] = useState<Section>('root')
  const [devPasswordOpen, setDevPasswordOpen] = useState(false)
  /** 「配置管理」标题连点计数：不显示按钮，5 次内间隔超过 1.5 秒重新计数 */
  const devTapRef = useRef({ count: 0, at: 0 })

  const handleDevTitleClick = (event: ReactMouseEvent<HTMLHeadingElement>): void => {
    // 阻断 App 的「点标题刷新当前页」：刷新会重挂载本页，连击计数会丢
    event.stopPropagation()
    const now = Date.now()
    const next = now - devTapRef.current.at > 1500 ? 1 : devTapRef.current.count + 1
    if (next < 5) {
      devTapRef.current = { count: next, at: now }
      return
    }
    devTapRef.current = { count: 0, at: 0 }
    if (developerMode) {
      onNotice('开发者模式已开启，退出客户端前无需重复输入')
      return
    }
    setDevPasswordOpen(true)
  }
  const [version, setVersion] = useState('—')
  const [downloadDir, setDownloadDir] = useState('')
  const [downloadStats, setDownloadStats] = useState({ count: 0, bytes: 0 })
  const [pendingImport, setPendingImport] = useState<AppData | null>(null)
  const [pendingImportMissing, setPendingImportMissing] = useState<string[]>([])
  const [snapshots, setSnapshots] = useState<DataSnapshotInfo[]>([])
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [sync, setSync] = useState<SyncConfigView | null>(null)
  const [accounts, setAccounts] = useState<AccountsView | null>(null)
  const [accountBusy, setAccountBusy] = useState<AccountSite | null>(null)
  const [syncUrl, setSyncUrl] = useState('')
  const [syncUser, setSyncUser] = useState('')
  const [syncPass, setSyncPass] = useState('')
  const [syncBusy, setSyncBusy] = useState<string | null>(null)
  const [pendingSync, setPendingSync] = useState<AppData | null>(null)
  const [pendingSyncMissing, setPendingSyncMissing] = useState<string[]>([])
  const [uploadConflictAt, setUploadConflictAt] = useState<number | null>(null)
  const [zlib, setZlib] = useState<ZlibStatusResponse | null>(null)
  const [zlibBusy, setZlibBusy] = useState(false)
  const [zlibUser, setZlibUser] = useState('')
  const [zlibPass, setZlibPass] = useState('')
  const [douban, setDouban] = useState<DoubanAuthStatus | null>(null)
  const [doubanBusy, setDoubanBusy] = useState(false)
  const [logoutDoubanOpen, setLogoutDoubanOpen] = useState(false)
  const [ui, setUi] = useState<UiSettings>(DEFAULT_UI_SETTINGS)
  /** 透明度滑杆拖动中的临时值：先实时预览，松手再落盘 */
  const [glassDraft, setGlassDraft] = useState<number | null>(null)
  const [cache, setCache] = useState<CacheInfo | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [chooseCacheBusy, setChooseCacheBusy] = useState(false)
  const [chooseDownloadBusy, setChooseDownloadBusy] = useState(false)
  const [pendingDownloadRoot, setPendingDownloadRoot] = useState<string | null>(null)
  const [changingDownloadRoot, setChangingDownloadRoot] = useState(false)
  const [liveCount, setLiveCount] = useState(0)
  const [magnetCount, setMagnetCount] = useState(0)
  const [checking, setChecking] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null)
  const [updateOpen, setUpdateOpen] = useState(false)

  useEffect(() => {
    if (resetSignal === undefined) return
    setSection('root')
  }, [resetSignal])

  const refreshCache = async () => {
    setCache(await window.laozheng.cacheInfo())
  }

  const refreshSnapshots = async () => {
    try {
      setSnapshots(await window.laozheng.listSnapshots())
    } catch {
      setSnapshots([])
    }
  }

  const refreshDownloads = async () => {
    const res = await window.laozheng.listDownloads()
    setDownloadStats({
      count: res.items.length,
      bytes: res.items.reduce((sum, item) => sum + (item.sizeBytes || 0), 0)
    })
  }

  useEffect(() => {
    window.laozheng.appVersion().then(setVersion)
    window.laozheng.downloadRoot().then(setDownloadDir)
    void syncUiSettings().then(setUi)
    void window.laozheng.getSyncConfig().then((cfg) => {
      setSync(cfg)
      setSyncUrl(cfg.url)
      setSyncUser(cfg.username)
    })
    void window.laozheng.zlibStatus().then((status) => {
      setZlib(status)
      if (status.username) setZlibUser(status.username)
    })
    void window.laozheng.doubanStatus().then(setDouban)
    void refreshCache()
    void refreshSnapshots()
    void refreshDownloads()
    void window.laozheng.loadLiveSources().then((list) => setLiveCount(list.length))
    void window.laozheng
      .magnetState()
      .then((state) => setMagnetCount(state.sources.length))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    return window.laozheng.onDownloadsChanged(() => {
      void refreshDownloads()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 回到配置管理首页时刷新缓存大小 / 电视源数量 / 下载目录（子页面里可能刚改过）
  useEffect(() => {
    if (section !== 'root') {
      if (section === 'data') void refreshSnapshots()
      return
    }
    void refreshCache()
    void refreshDownloads()
    void window.laozheng.loadLiveSources().then((list) => setLiveCount(list.length))
    void window.laozheng
      .magnetState()
      .then((state) => setMagnetCount(state.sources.length))
      .catch(() => undefined)
    void window.laozheng.downloadRoot().then(setDownloadDir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])

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

  const loginDouban = async () => {
    setDoubanBusy(true)
    const status = await window.laozheng.doubanLogin()
    setDoubanBusy(false)
    setDouban(status)
    onNotice(status.message)
  }

  const logoutDoubanAccount = async () => {
    const status = await window.laozheng.doubanLogout()
    setDouban(status)
    setLogoutDoubanOpen(false)
    onNotice('已退出豆瓣登录')
  }

  const changeUi = async (patch: Partial<UiSettings>) => {
    if (patch.glassEffect !== undefined) setGlassDraft(null)
    const next = await saveUiSettings(patch)
    setUi(next)
  }

  /** 滑杆松手 / 失焦时再写设置，避免拖动过程每次像素都落盘 */
  const commitGlassTransparency = () => {
    if (glassDraft === null) return
    const value = glassDraft
    setGlassDraft(null)
    void changeUi({ glassTransparency: value })
  }

  const doImport = async () => {
    const res = await window.laozheng.importData()
    if (res.canceled) return
    if (res.error) {
      onNotice(`导入失败：${res.error}`)
      return
    }
    if (res.data) {
      setPendingImport(res.data)
      setPendingImportMissing(res.missingLocalFields ?? [])
    }
  }

  const confirmImport = async () => {
    if (!pendingImport) return
    const imported = pendingImport
    try {
      await replaceData(imported, 'import', pendingImportMissing)
    } catch (err) {
      onNotice(`导入已取消：${(err as Error).message}`)
      setPendingImport(null)
      setPendingImportMissing([])
      return
    }
    setUi(await window.laozheng.getUiSettings())
    setDownloadDir(await window.laozheng.downloadRoot())
    onNotice(
      `已导入：${imported.items.length} 个条目 / ${imported.lists.length} 个清单 / ${imported.innerFavs.length} 条收藏（覆盖前已留本地快照）`
    )
    setPendingImport(null)
    setPendingImportMissing([])
    void refreshSnapshots()
  }

  const doExport = async () => {
    const res = await window.laozheng.exportData(data)
    if (res.error) {
      onNotice(`导出失败：${res.error}`)
      return
    }
    if (!res.canceled && res.path) onNotice(`已导出到 ${res.path}`)
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

  const uploadSync = async (force = false) => {
    setSyncBusy('upload')
    const res = await window.laozheng.uploadSync(data, force ? { force: true } : undefined)
    setSyncBusy(null)
    if (res.conflict) {
      setUploadConflictAt(res.remoteAt ?? Date.now())
      return
    }
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
    if (res.data) {
      setPendingSync(res.data as AppData)
      setPendingSyncMissing(res.missingLocalFields ?? [])
    }
  }

  const refreshZlib = async () => {
    const next = await window.laozheng.zlibStatus()
    setZlib(next)
    if (next.username) setZlibUser(next.username)
  }

  const loginZlib = async () => {
    setZlibBusy(true)
    const res = await window.laozheng.zlibLogin()
    setZlibBusy(false)
    setZlibPass('')
    onNotice(res.message)
    await refreshZlib()
  }

  const logoutZlib = async () => {
    setZlibBusy(true)
    const status = await window.laozheng.zlibLogout()
    setZlibBusy(false)
    setZlib(status)
    setZlibUser('')
    setZlibPass('')
    onNotice(status.message)
  }

  const saveZlib = async () => {
    if (!zlibUser.trim()) {
      onNotice('请先填写 Z-Library 账号')
      return
    }
    if (!zlibPass && !zlib?.username) {
      onNotice('请填写密码（首次保存后可不填）')
      return
    }
    setZlibBusy(true)
    const res = zlibPass
      ? await window.laozheng.saveZlibCredentials(zlibUser, zlibPass)
      : await window.laozheng.zlibLogin()
    setZlibBusy(false)
    setZlibPass('')
    onNotice(res.message)
    await refreshZlib()
  }

  const checkUpdate = async () => {
    setChecking(true)
    const res = await window.laozheng.checkUpdate()
    setChecking(false)
    if (!res.ok) {
      onNotice(res.error ?? '检查更新失败')
      return
    }
    setUpdateInfo(res)
    if (!res.hasUpdate) {
      onNotice(`已是最新版本 ${res.current}${res.line ? ` · 线路 ${res.line}` : ''}`)
      return
    }
    setUpdateOpen(true)
  }

  const clearCacheNow = async () => {
    setClearing(true)
    const res = await window.laozheng.clearCache()
    setClearing(false)
    setClearOpen(false)
    if (!res.ok) {
      onNotice(`清理失败：${res.error ?? '未知错误'}`)
      return
    }
    // 各模块列表缓存也在本机 localStorage 里，一起清掉；重载后所有模块会重新拉取
    clearModuleCaches()
    onNotice(`缓存已清理，释放 ${formatBytes(res.freed)}，正在重新加载…`)
    window.setTimeout(() => window.location.reload(), 900)
  }

  /** 更换缓存目录：主进程会先清空旧目录里的图片 / 接口缓存 */
  const chooseCacheDirNow = async () => {
    if (chooseCacheBusy) return
    setChooseCacheBusy(true)
    const res = await window.laozheng.chooseCacheDir()
    setChooseCacheBusy(false)
    if (res.canceled) return
    if (res.error) {
      onNotice(`更换缓存目录失败：${res.error}`)
      return
    }
    await refreshCache()
    onNotice(
      `缓存目录已切换到 ${res.dir}，旧缓存已清除（${formatBytes(res.freed ?? 0)}）`
    )
  }

  const confirmSyncImport = async () => {
    if (!pendingSync) return
    const restored = pendingSync
    try {
      await replaceData(restored, 'sync', pendingSyncMissing)
    } catch (err) {
      onNotice(`恢复已取消：${(err as Error).message}`)
      setPendingSync(null)
      setPendingSyncMissing([])
      return
    }
    setUi(await window.laozheng.getUiSettings())
    setDownloadDir(await window.laozheng.downloadRoot())
    onNotice(
      `已从云端恢复：${restored.items.length} 个条目 / ${restored.lists.length} 个清单 / ${restored.innerFavs.length} 条收藏（覆盖前已留本地快照）`
    )
    setPendingSync(null)
    setPendingSyncMissing([])
    void refreshSnapshots()
  }

  /** 从本地快照恢复：同样先给当前数据留一份快照，恢复本身也可回滚 */
  const restoreSnapshotNow = async () => {
    if (!restoreTarget) return
    setRestoring(true)
    try {
      const res = await window.laozheng.restoreSnapshot(restoreTarget)
      if (!res.ok || !res.data) {
        onNotice(`恢复快照失败：${res.error ?? '未知错误'}`)
        return
      }
      await replaceData(res.data, 'snapshot', res.missingLocalFields ?? [])
      setUi(await window.laozheng.getUiSettings())
      setDownloadDir(await window.laozheng.downloadRoot())
      onNotice(`已恢复本地快照（${restoreTarget}）`)
      setRestoreTarget(null)
      void refreshSnapshots()
    } catch (err) {
      onNotice(`恢复快照失败：${(err as Error).message}`)
    } finally {
      setRestoring(false)
    }
  }

  /** 更换下载目录：选好后询问是否把旧目录内容一起迁移 */
  const chooseDownloadDirNow = async () => {
    if (chooseDownloadBusy) return
    setChooseDownloadBusy(true)
    const res = await window.laozheng.chooseDownloadRoot()
    setChooseDownloadBusy(false)
    if (res.canceled) return
    if (res.error) {
      onNotice(`选择下载目录失败：${res.error}`)
      return
    }
    if (!res.root) return
    if (res.root === downloadDir) {
      onNotice('下载目录没有变化')
      return
    }
    setPendingDownloadRoot(res.root)
  }

  const applyDownloadRoot = async (move: boolean) => {
    if (!pendingDownloadRoot || changingDownloadRoot) return
    setChangingDownloadRoot(true)
    const res = await window.laozheng.changeDownloadRoot(pendingDownloadRoot, move)
    setChangingDownloadRoot(false)
    if (!res.ok) {
      onNotice(`更改下载目录失败：${res.error ?? '未知错误'}`)
      return
    }
    setDownloadDir(res.root ?? pendingDownloadRoot)
    setPendingDownloadRoot(null)
    onNotice(
      move
        ? `下载目录已改为 ${res.root}，已迁移 ${res.moved ?? 0} 项内容并清理旧目录`
        : `下载目录已改为 ${res.root}（旧目录内容保留在原处）`
    )
    void refreshDownloads()
  }

  const sourceTotal =
    data.vodSources.length +
    data.dramaSources.length +
    data.musicSources.length +
    data.novelSources.length +
    data.comicSources.length +
    data.livePlatformSources.length +
    liveCount +
    magnetCount +
    data.trainerSources.length +
    data.wallpaperSources.length +
    data.shuangkanSources.length +
    data.meituSources.length

  const zlibHint = zlib
    ? zlib.loggedIn
      ? `已登录（${zlib.host}）`
      : zlib.username
        ? `未登录 · 已保存账号 ${zlib.username}`
        : `未登录${zlib.host ? ` · 线路 ${zlib.host}` : ''}`
    : '读取中…'

  return (
    <>
      {section === 'root' ? (
        <>
          <header className="page-header">
            <h1
              className="page-title"
              style={{ userSelect: 'none' }}
              onClick={handleDevTitleClick}
            >
              配置管理
            </h1>
          </header>
          <div className="settings-list">
            <SettingsEntry
              icon={Palette}
              title="主题管理"
              hint={`${themeLabel(ui.theme)} · ${accentLabel(ui.accent)}`}
              onClick={() => setSection('theme')}
            />
            <SettingsEntry
              icon={UserRound}
              title="账号管理"
              hint={`豆瓣 ${douban?.loggedIn ? '已登录' : '未登录'} · Z-Library ${
                zlib?.loggedIn ? '已登录' : '未登录'
              } · 内置 ${
                accounts?.items.filter((item) => item.site !== 'bika').length ?? 0
              } 个站点`}
              onClick={() => setSection('accounts')}
            />
            <SettingsEntry
              icon={Database}
              title="数据管理"
              hint="云端同步 · 导出 / 导入备份"
              onClick={() => setSection('data')}
            />
            <SettingsEntry
              icon={Tv}
              title="片源管理"
              hint={`共 ${sourceTotal} 个源`}
              onClick={() => setSection('sources')}
            />
            <SettingsEntry
              icon={ListChecks}
              title="清单管理"
              hint={`共 ${data.lists.length} 个清单`}
              onClick={() => setSection('lists')}
            />
            <SettingsEntry
              icon={Heart}
              title="收藏管理"
              hint={`共 ${
                data.innerFavs.filter(
                  (fav) => !['h2', 'h1', 'psite', 'xsite'].includes(fav.module)
                ).length + data.liveFavorites.length
              } 个收藏`}
              onClick={() => onOpenPage('favorites')}
            />
            <SettingsEntry
              icon={Download}
              title="下载管理"
              hint={
                downloadStats.count > 0
                  ? `${downloadStats.count} 个文件 · 共 ${formatBytes(downloadStats.bytes)} · ${downloadDir || '读取中…'}`
                  : `暂无文件 · ${downloadDir || '读取中…'}`
              }
              onClick={() => onOpenPage('downloads')}
              action={
                <button
                  className="settings-entry-action"
                  disabled={chooseDownloadBusy}
                  onClick={(event) => {
                    event.stopPropagation()
                    void chooseDownloadDirNow()
                  }}
                >
                  {chooseDownloadBusy ? '选择中…' : '更改目录'}
                </button>
              }
            />
            <SettingsEntry
              icon={Eraser}
              title="清理缓存"
              hint={`当前缓存：${cache ? formatBytes(cache.bytes) : '计算中…'}${
                cache
                  ? `（图片 ${formatBytes(cache.imageBytes)} · 接口 ${formatBytes(cache.apiBytes)}${
                      cache.partitionBytes ? ` · 分区 ${formatBytes(cache.partitionBytes)}` : ''
                    }）`
                  : ''
              }${cache?.parts ? ` · ${cache.parts} 个未完成文件` : ''} · ${cache?.dir ?? '读取中…'}`}
              onClick={() => setClearOpen(true)}
              action={
                <button
                  className="settings-entry-action"
                  disabled={chooseCacheBusy}
                  onClick={(event) => {
                    event.stopPropagation()
                    void chooseCacheDirNow()
                  }}
                >
                  {chooseCacheBusy ? '选择中…' : '更改目录'}
                </button>
              }
            />
            <SettingsEntry
              icon={RefreshCw}
              title="版本更新"
              hint={
                checking
                  ? '正在检查更新…'
                  : version !== '—'
                    ? `当前 v${version} · 点击检查更新`
                    : '点击检查更新'
              }
              onClick={() => void checkUpdate()}
            />
          </div>
        </>
      ) : (
        <>
          <header className="page-header">
            <button className="btn ghost" onClick={() => setSection('root')}>
              <ChevronLeft size={15} /> 返回配置管理
            </button>
            <h1 className="page-title">{SECTION_TITLE[section]}</h1>
          </header>

          {section === 'theme' && (
            <div className="settings">
              <section className="settings-card">
                <h3>预览</h3>
                <div className="theme-preview">
                  <div className="theme-preview-label">老郑分享 · 当前主题</div>
                  <div className="theme-preview-title">主题色会立即应用到整个界面</div>
                  <span className="theme-preview-btn">主色按钮</span>
                </div>
              </section>

              <section className="settings-card">
                <h3>显示模式</h3>
                <p className="settings-hint">跟随系统时会随 Windows 深浅色自动切换。</p>
                <div className="toolbar" style={{ marginBottom: 0 }}>
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      className={`chip ${ui.theme === option.key ? 'active' : ''}`}
                      onClick={() => void changeUi({ theme: option.key })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="settings-card">
                <h3>主题色</h3>
                <p className="settings-hint">点颜色立即生效，只影响强调色，不影响收藏与清单数据。</p>
                <div className="theme-accents">
                  {ACCENT_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      className={`theme-accent ${ui.accent === option.key ? 'selected' : ''}`}
                      onClick={() => void changeUi({ accent: option.key })}
                    >
                      <span className="theme-dot" style={{ background: option.color }} />
                      {option.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="settings-card">
                <h3>界面效果</h3>
                <p className="settings-hint">
                  Windows 11 22H2 及以上会用系统 Acrylic：开启后拖动「透明度」可透出桌面；旧系统只调节面板透明度。
                </p>
                <div className="toolbar" style={{ marginBottom: 0 }}>
                  {GLASS_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      className={`chip ${ui.glassEffect === option.key ? 'active' : ''}`}
                      onClick={() => void changeUi({ glassEffect: option.key })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {ui.glassEffect === 'on' ? (
                  <div className="glass-slider">
                    <span className="glass-slider-label">透明度</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={glassDraft ?? ui.glassTransparency}
                      aria-label="毛玻璃透明度"
                      onChange={(e) => {
                        const value = Number(e.target.value)
                        setGlassDraft(value)
                        document.documentElement.style.setProperty(
                          '--glass-alpha',
                          String(glassAlphaValue(value))
                        )
                        document.documentElement.style.setProperty(
                          '--window-alpha',
                          String(windowAlphaValue(value))
                        )
                      }}
                      onPointerUp={commitGlassTransparency}
                      onKeyUp={commitGlassTransparency}
                      onBlur={commitGlassTransparency}
                    />
                    <span className="glass-slider-value">{glassDraft ?? ui.glassTransparency}%</span>
                  </div>
                ) : (
                  <p className="settings-hint" style={{ margin: '10px 0 0' }}>
                    毛玻璃已关闭，界面使用纯色表面。
                  </p>
                )}
              </section>
            </div>
          )}

          {section === 'data' && (
            <div className="settings">
              <section className="settings-card">
                <h3>云端同步（WebDAV）</h3>
                <p className="settings-hint">
                  与手机端共用同一份 data.json，只有点「上传到云端 / 从云端恢复」时才同步，不会自动执行。
                  PC 端上传内容额外包含电视源、磁力源、下载记录和本机设置（手机端会忽略这些字段）。
                  坚果云地址形如 https://dav.jianguoyun.com/dav/老郑分享/ ，密码要用「应用密码」。只填根目录
                  https://dav.jianguoyun.com/dav/ 也可以，应用会自动使用「老郑分享」子目录（坚果云根目录不能直接写文件）。账号密码只存本机（加密），不会写进备份。
                </p>
                <p className="settings-hint">
                  不知道应用密码在哪？看坚果云官方教程：
                  <button
                    className="link-btn"
                    onClick={() =>
                      void window.laozheng.openExternal('https://help.jianguoyun.com/?p=2064')
                    }
                  >
                    坚果云第三方应用授权 WebDAV 开启方法
                  </button>
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
                <h3>导入 / 导出</h3>
                <p className="settings-hint">
                  与手机端共用同一份备份格式（version 1）。PC 端额外带上电视源、磁力源、
                  下载记录、本机设置（主题 / 下载目录 / 各对话框上次位置），手机端会自动忽略这些字段。
                  导入会覆盖本机当前数据（下载记录不导入，本机下载记录保持不变）；导出生成手机端可直接识别的 JSON。
                  豆瓣与各站登录态、WebDAV 密码属于本机加密凭据，不写入备份。
                </p>
                <div className="settings-row">
                  <button className="btn" onClick={doImport}>
                    <Upload size={15} /> 导入备份
                  </button>
                  <button className="btn" onClick={doExport}>
                    <Download size={15} /> 导出备份
                  </button>
                </div>
                <p className="settings-hint">
                  整体导入 / 云恢复覆盖前会自动生成本地快照（保留最近 20 份），快照创建失败会中止覆盖。
                </p>
              </section>

              <section className="settings-card">
                <h3>本地快照</h3>
                <p className="settings-hint">
                  整体导入、云恢复和快照恢复覆盖前都会自动留一份带时间戳的数据快照，
                  恢复快照本身也会先给当前数据留一份，可再次回滚。
                </p>
                {snapshots.length ? (
                  <div className="snapshot-list">
                    {snapshots.map((snapshot) => (
                      <div key={snapshot.name} className="snapshot-row">
                        <div className="snapshot-main">
                          <div className="snapshot-title">
                            {formatSnapshotTime(snapshot.createdAt)}
                          </div>
                          <div className="snapshot-meta">
                            {snapshotReasonLabel(snapshot.reason)} · {formatBytes(snapshot.bytes)} ·{' '}
                            {snapshot.name}
                          </div>
                        </div>
                        <button
                          className="btn ghost"
                          disabled={restoring}
                          onClick={() => setRestoreTarget(snapshot.name)}
                        >
                          恢复
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="settings-hint">还没有本地快照。</p>
                )}
              </section>
            </div>
          )}

          {section === 'accounts' && (
            <div className="settings">
              <section className="settings-card">
                <h3>豆瓣登录</h3>
                <p className="settings-hint">
                  登录后搜索结果更全（老片 / 冷门条目需要登录才搜得到）。登录在独立窗口完成，
                  Cookie 用系统 DPAPI 加密后只存本机，不会进入备份。
                </p>
                <div className="account-row">
                  <div className="account-main">
                    <div className="account-title">
                      豆瓣
                      <span className={`account-state ${douban?.loggedIn ? 'ok' : 'unknown'}`}>
                        {douban?.loggedIn ? '已登录' : '未登录'}
                      </span>
                    </div>
                    <div className="account-meta">{douban?.message ?? '读取中…'}</div>
                  </div>
                  <button className="btn" disabled={doubanBusy} onClick={() => void loginDouban()}>
                    <LogIn size={14} /> {doubanBusy ? '登录中…' : douban?.loggedIn ? '重新登录' : '登录豆瓣'}
                  </button>
                  {douban?.loggedIn ? (
                    <button className="btn ghost" onClick={() => setLogoutDoubanOpen(true)}>
                      退出登录
                    </button>
                  ) : null}
                </div>
              </section>

              <section className="settings-card">
                <h3>内置账号</h3>
                <p className="settings-hint">
                  Komiic / 无忧两个站点的账号已加密保存在本机，启动时自动登录：Komiic
                  静默换 token 并自动续期；无忧会自动完成滑块验证，并复用持久化会话。
                  账号密码不会出现在备份文件、日志或代码里。
                </p>
                {accounts?.items.filter((item) => item.site !== 'bika').map((item) => (
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
                <h3>Z-Library（图书）</h3>
                <p className="settings-hint">
                  站点有 DiamWall 反爬：第一次保存账号密码后，后续启动会自动静默登录；
                  自动验证没通过时会打开窗口并预填账号密码，手动完成一次即可。
                  密码用系统 DPAPI 加密，只存本机，不会进入备份或日志。
                </p>
                <div className="settings-row">
                  <span className="settings-label">登录状态</span>
                  <span className="settings-value">{zlibHint}</span>
                </div>
                <div className="form-grid">
                  <label>
                    账号
                    <input
                      value={zlibUser}
                      onChange={(e) => setZlibUser(e.target.value)}
                      placeholder="Z-Library 邮箱"
                    />
                  </label>
                  <label>
                    密码
                    <input
                      type="password"
                      value={zlibPass}
                      onChange={(e) => setZlibPass(e.target.value)}
                      placeholder={zlib?.username ? '已保存，留空表示继续用旧密码' : '密码'}
                    />
                  </label>
                </div>
                <div className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <button className="btn primary" disabled={zlibBusy} onClick={() => void saveZlib()}>
                    {zlibBusy ? '正在登录…' : '保存并登录'}
                  </button>
                  <button className="btn" disabled={zlibBusy} onClick={() => void loginZlib()}>
                    <LogIn size={15} /> 打开登录窗口
                  </button>
                  {zlib?.loggedIn || zlib?.username ? (
                    <button className="btn ghost" disabled={zlibBusy} onClick={() => void logoutZlib()}>
                      退出登录
                    </button>
                  ) : null}
                </div>
              </section>
            </div>
          )}

          {section === 'sources' && <SourceSettings onNotice={onNotice} />}

          {section === 'lists' && (
            <ListManagerSection onNotice={onNotice} developerMode={developerMode} />
          )}
        </>
      )}

      {devPasswordOpen ? (
        <PasswordDialog
          title="进入开发者模式"
          hint="输入密码后解锁演唱管理与软件经验编辑，退出客户端前无需重复输入。"
          onConfirm={() => {
            setDevPasswordOpen(false)
            onEnterDeveloperMode()
            onNotice('已进入开发者模式')
          }}
          onCancel={() => setDevPasswordOpen(false)}
        />
      ) : null}

      {restoreTarget && (
        <ConfirmDialog
          title="恢复本地快照"
          message={`将用快照覆盖当前数据：\n${restoreTarget}\n\n恢复前会自动为当前数据再留一份快照，可再次回滚。`}
          confirmText={restoring ? '恢复中…' : '恢复'}
          danger
          onConfirm={() => void restoreSnapshotNow()}
          onCancel={() => {
            if (!restoring) setRestoreTarget(null)
          }}
        />
      )}

      {pendingImport && (
        <ConfirmDialog
          title="导入备份"
          message={`将用备份覆盖本机数据：\n${pendingImport.items.length} 个条目 · ${pendingImport.lists.length} 个清单 · ${pendingImport.innerFavs.length} 条收藏 · ${pendingImport.vodSources.length} 个片源${
            pendingImport.liveSources ? ` · ${pendingImport.liveSources.length} 个电视源` : ''
          }${pendingImport.magnetSources ? ` · ${pendingImport.magnetSources.length} 个磁力源` : ''}${
            pendingImport.settings ? ' · 本机设置' : ''
          }${pendingImport.magnetSearch ? ' · 磁力搜索缓存' : ''}\n\n当前本机数据会被替换（下载记录不导入，保持不变），建议先导出一份备份。`}
          confirmText="覆盖导入"
          danger
          onConfirm={confirmImport}
          onCancel={() => setPendingImport(null)}
        />
      )}

      {uploadConflictAt !== null && (
        <ConfirmDialog
          title="云端备份比本机新"
          message={`云端备份最后修改于 ${new Date(uploadConflictAt).toLocaleString()}，比本机数据更新。\n继续上传会用本机数据覆盖云端，云端较新的内容将丢失。\n\n如果是另一台电脑刚同步过，建议先点「从云端恢复」。`}
          confirmText="仍然覆盖上传"
          danger
          onConfirm={() => {
            setUploadConflictAt(null)
            void uploadSync(true)
          }}
          onCancel={() => setUploadConflictAt(null)}
        />
      )}

      {pendingSync && (
        <ConfirmDialog
          title="从云端恢复"
          message={`将用云端备份覆盖本机数据：\n${pendingSync.items.length} 个条目 · ${pendingSync.lists.length} 个清单 · ${pendingSync.innerFavs.length} 条收藏 · ${pendingSync.vodSources.length} 个片源${
            pendingSync.liveSources ? ` · ${pendingSync.liveSources.length} 个电视源` : ''
          }${pendingSync.magnetSources ? ` · ${pendingSync.magnetSources.length} 个磁力源` : ''}${
            pendingSync.settings ? ' · 本机设置' : ''
          }${pendingSync.magnetSearch ? ' · 磁力搜索缓存' : ''}\n\n当前本机数据会被替换（下载记录不导入，保持不变），建议先点「上传到云端」保留一份。`}
          confirmText="覆盖恢复"
          danger
          onConfirm={confirmSyncImport}
          onCancel={() => setPendingSync(null)}
        />
      )}

      {clearOpen && (
        <ConfirmDialog
          title="清理缓存"
          message={`将清除图片与接口缓存、各网页分区缓存、各模块列表缓存、已下载的更新安装包（更新包正在下载时保留），并重新加载应用。\n下载目录里的未完成临时文件：没有未完成下载任务时一起清理；有任务时保留，方便继续下载 / 续传。\n当前可清理：${cache ? formatBytes(cache.bytes) : '计算中…'}\n\n不影响收藏、清单、阅读进度与各站登录状态（Cookie、模拟器存档会保留）。`}
          confirmText={clearing ? '清理中…' : '清理'}
          danger
          onConfirm={() => {
            if (!clearing) void clearCacheNow()
          }}
          onCancel={() => setClearOpen(false)}
        />
      )}

      {pendingDownloadRoot && (
        <Modal
          title="更改下载目录"
          onClose={() => {
            if (!changingDownloadRoot) setPendingDownloadRoot(null)
          }}
          footer={
            <>
              <button
                className="btn ghost"
                disabled={changingDownloadRoot}
                onClick={() => setPendingDownloadRoot(null)}
              >
                取消
              </button>
              <button
                className="btn"
                disabled={changingDownloadRoot}
                onClick={() => void applyDownloadRoot(false)}
              >
                仅修改目录
              </button>
              <button
                className="btn primary"
                disabled={changingDownloadRoot}
                onClick={() => void applyDownloadRoot(true)}
              >
                {changingDownloadRoot ? '正在迁移…' : '迁移内容并修改'}
              </button>
            </>
          }
        >
          <p>
            新目录：{pendingDownloadRoot}
            {'\n'}
            旧目录：{downloadDir || '—'}
            {'\n\n'}
            是否把旧目录里的视频 / 音乐 / 漫画 / 图书 / 小说移动到新目录？迁移完成后会删除旧目录的残余。
            选择「仅修改目录」则旧文件留在原处（下载记录会找不到这些文件）。
          </p>
        </Modal>
      )}

      {logoutDoubanOpen && (
        <ConfirmDialog
          title="退出豆瓣登录"
          message="退出后搜索结果可能不完整（部分条目需要登录才能搜到），确认退出？"
          confirmText="退出"
          danger
          onConfirm={() => void logoutDoubanAccount()}
          onCancel={() => setLogoutDoubanOpen(false)}
        />
      )}

      <UpdateModal
        open={updateOpen}
        info={updateInfo}
        onClose={() => setUpdateOpen(false)}
        onNotice={onNotice}
      />
    </>
  )
}

function SettingsEntry({
  icon,
  title,
  hint,
  onClick,
  action
}: {
  icon: LucideIcon
  title: string
  hint: string
  onClick: () => void
  /** 行尾小按钮：有值时整行改用 div，避免按钮里再嵌按钮 */
  action?: ReactNode
}) {
  const Icon = icon
  const content = (
    <>
      <span className="settings-entry-icon">
        <Icon size={20} strokeWidth={1.8} />
      </span>
      <span className="settings-entry-main">
        <span className="settings-entry-title">{title}</span>
        <span className="settings-entry-hint">{hint}</span>
      </span>
      {action}
      <ChevronRight size={17} className="settings-entry-arrow" />
    </>
  )
  if (action) {
    return (
      <div
        className="settings-entry"
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onClick()
          }
        }}
      >
        {content}
      </div>
    )
  }
  return (
    <button className="settings-entry" onClick={onClick}>
      {content}
    </button>
  )
}
