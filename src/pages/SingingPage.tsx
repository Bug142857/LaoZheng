import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ExternalLink,
  LogIn,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import { useData } from '../state/DataContext'
import { ConfirmDialog, EmptyState, Modal } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { BiliPlayer } from '../components/BiliPlayer'
import { tileGradient } from '../utils/data'
import {
  LIVE_LOGIN_EVENT,
  notifyLiveLoginChanged,
  type LiveLoginStatus,
  type LiveQrStart
} from '../shared/livePlatform'
import {
  SINGING_MANUAL_CATEGORY,
  singingCategoryPath,
  singingCategoryTree,
  type SingingDanmakuItem,
  type SingingPlayback,
  type SingingVideo
} from '../shared/singing'

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`
}

function videoLink(video: SingingVideo): string {
  return `https://www.bilibili.com/video/${video.bvid}?p=${video.page}`
}

/**
 * 演唱：B站视频（早期收藏夹视频已一次性导入，之后只能手动填链接添加）。
 * 登录态与「直播」模块共用同一份 B站账号（主进程 live-accounts.json），登录只影响播放清晰度。
 */
export function SingingPage({
  onNotice,
  resetSignal,
  active = true
}: {
  onNotice: (text: string) => void
  resetSignal?: number
  active?: boolean
}) {
  const { data, update } = useData()
  const videos = data.singingVideos
  const [status, setStatus] = useState<LiveLoginStatus | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  const [qr, setQr] = useState<LiveQrStart | null>(null)
  const [qrHint, setQrHint] = useState('')
  const [level1, setLevel1] = useState('')
  const [level2, setLevel2] = useState('')
  const [level3, setLevel3] = useState('')
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [playing, setPlaying] = useState<SingingVideo | null>(null)
  const [playback, setPlayback] = useState<SingingPlayback | null>(null)
  const [danmaku, setDanmaku] = useState<SingingDanmakuItem[]>([])
  const [playLoading, setPlayLoading] = useState(false)
  const [playError, setPlayError] = useState('')
  const [qualityId, setQualityId] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [addLink, setAddLink] = useState('')
  const [addTitle, setAddTitle] = useState('')
  const [addCategory, setAddCategory] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState('')
  const [renameTarget, setRenameTarget] = useState<SingingVideo | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [removeTarget, setRemoveTarget] = useState<SingingVideo | null>(null)
  const lastReset = useRef(resetSignal)
  const playRequestRef = useRef(0)
  /** 切清晰度的请求序号：打开 / 关闭视频后让在途的旧清晰度请求失效 */
  const qualityRequestRef = useRef(0)

  const categoryTree = useMemo(() => singingCategoryTree(videos), [videos])
  const level1Node = categoryTree.find((node) => node.name === level1)
  const level2Node = level1Node?.children.find((node) => node.name === level2)
  const categoryOptions = useMemo(
    () => [...new Set(videos.map((video) => video.category))],
    [videos]
  )
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return videos
      .filter((video) => {
        if (level1 || level2 || level3) {
          const path = singingCategoryPath(video.category)
          if (level1 && path[0] !== level1) return false
          if (level2 && (path[1] ?? '') !== level2) return false
          if (level3 && (path[2] ?? '') !== level3) return false
        }
        if (!keyword) return true
        return (
          video.title.toLowerCase().includes(keyword) ||
          video.originalTitle.toLowerCase().includes(keyword) ||
          video.owner.toLowerCase().includes(keyword) ||
          video.category.toLowerCase().includes(keyword)
        )
      })
      .sort((a, b) => b.addedAt - a.addedAt)
  }, [videos, level1, level2, level3, query])

  const refreshStatus = async (): Promise<void> => {
    try {
      const next = await window.laozheng.livePlatformLoginStatus('bilibili')
      setStatus(next)
    } catch {
      // 网络异常时保留上一次状态
    }
  }

  /** 刷新列表：清空搜索 / 分类筛选，回到「全部」并滚到顶部 */
  const refreshList = (): void => {
    if (refreshing) return
    setRefreshing(true)
    setInput('')
    setQuery('')
    setLevel1('')
    setLevel2('')
    setLevel3('')
    document.querySelector<HTMLElement>('.content')?.scrollTo({ top: 0, behavior: 'smooth' })
    window.setTimeout(() => setRefreshing(false), 500)
  }

  useEffect(() => {
    void refreshStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (active) void refreshStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    const onLoginChanged = (): void => {
      void refreshStatus()
    }
    window.addEventListener(LIVE_LOGIN_EVENT, onLoginChanged)
    return () => window.removeEventListener(LIVE_LOGIN_EVENT, onLoginChanged)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (lastReset.current === resetSignal) return
    lastReset.current = resetSignal
    playRequestRef.current += 1
    qualityRequestRef.current += 1
    setPlaying(null)
    setPlayback(null)
    setLevel1('')
    setLevel2('')
    setLevel3('')
    setInput('')
    setQuery('')
    setAddOpen(false)
  }, [resetSignal])

  // 切到其它模块时停止演唱播放，避免画面隐藏后声音继续
  useEffect(() => {
    if (active) return
    playRequestRef.current += 1
    qualityRequestRef.current += 1
    setPlaying(null)
    setPlayback(null)
    setPlayError('')
  }, [active])

  const startBilibiliQr = async (): Promise<void> => {
    setQr(null)
    setQrHint('正在生成二维码…')
    try {
      const result = await window.laozheng.livePlatformQrStart()
      setQr(result)
      setQrHint('请用 B 站手机客户端扫码')
    } catch (err) {
      setQrHint(err instanceof Error ? err.message : '二维码生成失败')
    }
  }

  useEffect(() => {
    if (!loginOpen || !qr) return undefined
    let alive = true
    const timer = window.setInterval(() => {
      void window.laozheng
        .livePlatformQrPoll(qr.key)
        .then((result) => {
          if (!alive) return
          if (result.state === 'scanned') setQrHint('已扫码，请在手机上确认登录')
          if (result.state === 'expired') {
            setQrHint('二维码已过期，请点「刷新二维码」')
            window.clearInterval(timer)
          }
          if (result.state === 'confirmed' && result.login) {
            window.clearInterval(timer)
            setQr(null)
            setLoginOpen(false)
            setStatus(result.login)
            notifyLiveLoginChanged('bilibili')
            onNotice('B站登录成功')
          }
        })
        .catch(() => undefined)
    }, 2000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [loginOpen, qr, onNotice])

  const logout = async (): Promise<void> => {
    try {
      const next = await window.laozheng.livePlatformLogout('bilibili')
      setStatus(next)
      notifyLiveLoginChanged('bilibili')
      onNotice('已退出B站账号')
    } catch {
      onNotice('退出登录失败')
    }
  }

  const openVideo = async (video: SingingVideo, quality?: string): Promise<void> => {
    const token = ++playRequestRef.current
    qualityRequestRef.current += 1
    setPlaying(video)
    setPlayLoading(true)
    setPlayError('')
    setPlayback(null)
    setDanmaku([])
    setQualityId(quality ?? '')
    void window.laozheng
      .singingDanmaku(video.bvid, video.page)
      .then((result) => {
        if (token === playRequestRef.current && !result.error) setDanmaku(result.items)
      })
      .catch(() => undefined)
    try {
      const result = await window.laozheng.singingPlay(video.bvid, video.page, quality)
      if (token !== playRequestRef.current) return
      if (result.error) {
        setPlayError(result.error)
        return
      }
      setPlayback(result)
      setQualityId(result.qualityId)
    } catch {
      if (token === playRequestRef.current) setPlayError('播放地址获取失败')
    } finally {
      if (token === playRequestRef.current) setPlayLoading(false)
    }
  }

  const changeQuality = async (id: string): Promise<void> => {
    if (!playing || id === qualityId) return
    // 每次切换都递增序号：本地换源也要让在途的旧清晰度请求失效
    const token = ++qualityRequestRef.current
    // DASH 已经把每个清晰度的地址一起返回，直接切换不重新请求
    const option = playback?.qualities.find((quality) => quality.id === id)
    if (option?.src) {
      setQualityId(id)
      return
    }
    setQualityId(id)
    try {
      const result = await window.laozheng.singingPlay(playing.bvid, playing.page, id)
      // 请求期间可能已经切到别的视频 / 关闭播放器：旧结果直接丢弃
      if (token !== qualityRequestRef.current) return
      if (result.error) {
        onNotice(result.error)
        return
      }
      setPlayback(result)
      setQualityId(result.qualityId)
    } catch {
      if (token === qualityRequestRef.current) onNotice('切换清晰度失败')
    }
  }

  const submitAdd = async (): Promise<void> => {
    if (addBusy) return
    const link = addLink.trim()
    if (!link) {
      setAddError('请粘贴 B站视频链接、BV 号或 av 号')
      return
    }
    setAddBusy(true)
    setAddError('')
    try {
      const info = await window.laozheng.singingVideoInfo(link)
      if (info.error) {
        setAddError(info.error)
        return
      }
      update((d) => {
        const existing = d.singingVideos.find((video) => video.bvid === info.bvid)
        const title = addTitle.trim() || info.title
        const next: SingingVideo = {
          bvid: info.bvid,
          page: info.page,
          title,
          originalTitle: info.title,
          cover: info.cover,
          durationSec: info.durationSec,
          category: addCategory.trim() || SINGING_MANUAL_CATEGORY,
          owner: info.owner,
          addedAt: existing?.addedAt ?? Date.now()
        }
        return {
          ...d,
          singingVideos: existing
            ? d.singingVideos.map((video) => (video.bvid === info.bvid ? next : video))
            : [...d.singingVideos, next]
        }
      })
      setAddOpen(false)
      setAddLink('')
      setAddTitle('')
      setAddCategory('')
      onNotice('已添加视频')
    } catch (err) {
      setAddError(err instanceof Error ? err.message : '添加失败')
    } finally {
      setAddBusy(false)
    }
  }

  const submitRename = (): void => {
    if (!renameTarget) return
    const title = renameTitle.trim() || renameTarget.originalTitle
    update((d) => ({
      ...d,
      singingVideos: d.singingVideos.map((video) =>
        video.bvid === renameTarget.bvid ? { ...video, title } : video
      )
    }))
    if (playing?.bvid === renameTarget.bvid) setPlaying({ ...playing, title })
    setRenameTarget(null)
    setRenameTitle('')
    onNotice('标题已修改')
  }

  const confirmRemove = (): void => {
    if (!removeTarget) return
    const target = removeTarget
    update((d) => ({
      ...d,
      singingVideos: d.singingVideos.filter((video) => video.bvid !== target.bvid)
    }))
    if (playing?.bvid === target.bvid) {
      playRequestRef.current += 1
      qualityRequestRef.current += 1
      setPlaying(null)
      setPlayback(null)
    }
    setRemoveTarget(null)
    onNotice('已移除')
  }

  const loggedIn = !!status?.loggedIn
  const statusText = loggedIn ? status?.name || '已登录' : '扫码登录'

  if (playing) {
    const link = videoLink(playing)
    const currentQuality = playback?.qualities.find((quality) => quality.id === qualityId)
    return (
      <>
        <header className="page-header">
          <button
            className="btn ghost"
            onClick={() => {
              playRequestRef.current += 1
              qualityRequestRef.current += 1
              setPlaying(null)
              setPlayback(null)
              setPlayError('')
            }}
          >
            <ChevronLeft size={15} /> 返回
          </button>
          <h1 className="page-title" title={playing.title}>
            {playing.title}
          </h1>
          <div className="page-actions">
            <button
              className="btn"
              onClick={() => {
                setRenameTarget(playing)
                setRenameTitle(playing.title)
              }}
            >
              <Pencil size={15} /> 改名
            </button>
            <button className="btn" onClick={() => setRemoveTarget(playing)}>
              <Trash2 size={15} /> 移除
            </button>
            <button
              className="icon-btn header-shortcut"
              title="在浏览器打开原视频"
              onClick={() => void window.laozheng.openExternal(link)}
            >
              <ExternalLink size={17} />
            </button>
          </div>
        </header>

        {playLoading ? (
          <EmptyState title="正在获取播放地址…" />
        ) : playError ? (
          <EmptyState
            title="播放失败"
            desc={playError}
            action={
              <div className="live-error-actions">
                <button className="btn" onClick={() => void openVideo(playing, qualityId || undefined)}>
                  重试
                </button>
                <button className="btn ghost" onClick={() => void window.laozheng.openExternal(link)}>
                  在浏览器打开
                </button>
              </div>
            }
          />
        ) : playback ? (
          <>
            <BiliPlayer
              src={currentQuality?.src || playback.src}
              audioSrc={playback.audioSrc}
              backupSrc={currentQuality?.backupSrc}
              audioBackupSrc={playback.audioBackupSrc}
              danmaku={danmaku}
              resumeKey={`singing:${playback.bvid}:${playing.page}`}
              qualities={playback.qualities}
              qualityId={qualityId}
              onQualityChange={(id) => void changeQuality(id)}
              onFail={(message) => onNotice(message)}
            />
            <div className="live-room-detail">
              <span>{playing.category}</span>
              {playing.owner ? <span>{playing.owner}</span> : null}
              {playing.durationSec ? <span>{formatDuration(playing.durationSec)}</span> : null}
            </div>
          </>
        ) : null}

        {renameTarget ? (
          <Modal
            title="修改标题"
            onClose={() => setRenameTarget(null)}
            footer={
              <>
                <button className="btn ghost" onClick={() => setRenameTarget(null)}>
                  取消
                </button>
                <button className="btn primary" onClick={submitRename}>
                  保存
                </button>
              </>
            }
          >
            <input
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
              placeholder={renameTarget.originalTitle}
              autoFocus
            />
            <p className="singing-hint">留空会恢复 B站原标题。</p>
          </Modal>
        ) : null}

        {removeTarget ? (
          <ConfirmDialog
            title="从演唱模块移除？"
            message={`「${removeTarget.title}」会从演唱列表里删除。`}
            confirmText="移除"
            danger
            onConfirm={confirmRemove}
            onCancel={() => setRemoveTarget(null)}
          />
        ) : null}
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">演唱</h1>
        <div className="page-actions">
          <button className="btn" onClick={() => setAddOpen(true)}>
            <Plus size={15} /> 添加视频
          </button>
          <button
            className="btn"
            onClick={() => {
              if (loggedIn) {
                setLogoutConfirm(true)
                return
              }
              setLoginOpen(true)
              void startBilibiliQr()
            }}
            title={loggedIn ? `已登录：${status?.name || 'B站'}，点击可退出` : undefined}
          >
            <LogIn size={15} />
            {statusText}
          </button>
        </div>
      </header>

      <SearchBar
        value={input}
        onChange={setInput}
        onSubmit={() => setQuery(input.trim())}
        onClear={() => {
          setInput('')
          setQuery('')
        }}
        placeholder="搜索标题 / UP主 / 分类"
        submitLabel="筛选"
        onRefresh={refreshList}
        refreshing={refreshing}
        refreshTitle="刷新列表"
        disabled={!videos.length}
      />

      {videos.length ? (
        <div className="toolbar singing-filters">
          <select
            className="select-inline"
            value={level1}
            title="一级分类"
            onChange={(event) => {
              setLevel1(event.target.value)
              setLevel2('')
              setLevel3('')
            }}
          >
            <option value="">全部（{videos.length}）</option>
            {categoryTree.map((node) => (
              <option key={node.name} value={node.name}>
                {node.name}（{node.count}）
              </option>
            ))}
          </select>
          {level1Node && level1Node.children.length ? (
            <select
              className="select-inline"
              value={level2}
              title="二级分类"
              onChange={(event) => {
                setLevel2(event.target.value)
                setLevel3('')
              }}
            >
              <option value="">全部（{level1Node.count}）</option>
              {level1Node.children.map((node) => (
                <option key={node.name} value={node.name}>
                  {node.name}（{node.count}）
                </option>
              ))}
            </select>
          ) : null}
          {level2Node && level2Node.children.length ? (
            <select
              className="select-inline"
              value={level3}
              title="三级分类"
              onChange={(event) => setLevel3(event.target.value)}
            >
              <option value="">全部（{level2Node.count}）</option>
              {level2Node.children.map((node) => (
                <option key={node.name} value={node.name}>
                  {node.name}（{node.count}）
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}

      {!videos.length ? (
        <EmptyState
          title="还没有视频"
          desc="点右上角「添加视频」，粘贴 B站链接即可加入；登录只用于提高播放画质。"
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="没有匹配的视频" desc="换个关键词或分类再试。" />
      ) : (
        <div className="live-room-grid">
          {filtered.map((video) => (
            <div
              key={video.bvid}
              className="live-room-card"
              role="button"
              tabIndex={0}
              onClick={() => void openVideo(video)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') void openVideo(video)
              }}
            >
              <div
                className="live-room-cover"
                style={video.cover ? undefined : { background: tileGradient(video.title) }}
              >
                {video.cover ? (
                  <img
                    src={video.cover}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      const img = event.currentTarget
                      img.style.display = 'none'
                      const box = img.parentElement
                      if (box) box.style.background = tileGradient(video.title)
                    }}
                  />
                ) : null}
                {video.durationSec ? (
                  <span className="live-room-badge singing-duration">
                    {formatDuration(video.durationSec)}
                  </span>
                ) : null}
              </div>
              <div className="live-room-info">
                <div className="live-room-title" title={video.title}>
                  {video.title}
                </div>
                <div
                  className="live-room-meta"
                  title={`${video.category}${video.owner ? ` · ${video.owner}` : ''}`}
                >
                  {video.category}
                  {video.owner ? ` · ${video.owner}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {logoutConfirm ? (
        <ConfirmDialog
          title="退出 B站账号？"
          message={`当前登录：${status?.name || 'B站'}。退出后「直播」和「演唱」会一起退出，需要重新扫码登录。`}
          confirmText="退出登录"
          danger
          onConfirm={() => {
            setLogoutConfirm(false)
            void logout()
          }}
          onCancel={() => setLogoutConfirm(false)}
        />
      ) : null}

      {loginOpen ? (
        <Modal
          title="B站扫码登录"
          onClose={() => {
            setLoginOpen(false)
            setQr(null)
          }}
          footer={
            <>
              <button
                className="btn ghost"
                onClick={() => {
                  setLoginOpen(false)
                  setQr(null)
                }}
              >
                关闭
              </button>
              <button className="btn primary" onClick={() => void startBilibiliQr()}>
                刷新二维码
              </button>
            </>
          }
        >
          <div className="live-login-box">
            {qr ? <img className="live-qr" src={qr.image} alt="B站登录二维码" /> : null}
            <p>{qrHint || '请用 B 站手机客户端扫码'}</p>
            <p className="live-login-hint">
              登录与「直播」模块共通，只用于提高播放清晰度；Cookie 加密保存在本机，不进备份与云同步。
            </p>
          </div>
        </Modal>
      ) : null}

      {addOpen ? (
        <Modal
          title="通过 B站链接添加"
          onClose={() => {
            setAddOpen(false)
            setAddError('')
          }}
          footer={
            <>
              <button
                className="btn ghost"
                onClick={() => {
                  setAddOpen(false)
                  setAddError('')
                }}
              >
                取消
              </button>
              <button className="btn primary" onClick={() => void submitAdd()} disabled={addBusy}>
                {addBusy ? '解析中…' : '添加'}
              </button>
            </>
          }
        >
          <input
            value={addLink}
            onChange={(event) => setAddLink(event.target.value)}
            placeholder="粘贴 B站视频链接 / BV 号 / av 号，支持 b23.tv 短链"
            autoFocus
          />
          <input
            value={addTitle}
            onChange={(event) => setAddTitle(event.target.value)}
            placeholder="自定义标题（留空使用 B站标题）"
          />
          <input
            value={addCategory}
            onChange={(event) => setAddCategory(event.target.value)}
            placeholder={SINGING_MANUAL_CATEGORY}
            list="singing-category-options"
          />
          <datalist id="singing-category-options">
            {categoryOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {addError ? <p className="singing-hint danger">{addError}</p> : null}
          <p className="singing-hint">分类留空会放进「{SINGING_MANUAL_CATEGORY}」。</p>
        </Modal>
      ) : null}
    </>
  )
}
