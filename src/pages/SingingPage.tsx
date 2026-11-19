import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ExternalLink,
  Heart,
  LogIn
} from 'lucide-react'
import { useData } from '../state/DataContext'
import { ConfirmDialog, EmptyState, Modal, ModuleShortcuts } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { BiliPlayer } from '../components/BiliPlayer'
import { tileGradient } from '../utils/data'
import { useDetailScrollRestore } from '../utils/scroll'
import {
  LIVE_LOGIN_EVENT,
  notifyLiveLoginChanged,
  type LiveLoginStatus,
  type LiveQrStart
} from '../shared/livePlatform'
import {
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
 * 演唱：B站视频（早期收藏夹视频已一次性导入，之后由老郑在设置里统一添加）。
 * 登录态与「直播」模块共用同一份 B站账号（主进程 live-accounts.json），登录只影响播放清晰度。
 */
export function SingingPage({
  onNotice,
  onOpenFavorites,
  onExit,
  focusId,
  resetSignal,
  active = true
}: {
  onNotice: (text: string) => void
  onOpenFavorites?: () => void
  onExit?: () => void
  /** 从收藏进入时直接打开对应视频 */
  focusId?: string
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
  useDetailScrollRestore(!!playing || !!playback, 'singing')
  const [danmaku, setDanmaku] = useState<SingingDanmakuItem[]>([])
  const [playLoading, setPlayLoading] = useState(false)
  const [playError, setPlayError] = useState('')
  const [qualityId, setQualityId] = useState('')
  const lastReset = useRef(resetSignal)
  const lastFocus = useRef<string | undefined>(undefined)
  const playRequestRef = useRef(0)
  /** 切清晰度的请求序号：打开 / 关闭视频后让在途的旧清晰度请求失效 */
  const qualityRequestRef = useRef(0)

  const categoryTree = useMemo(() => singingCategoryTree(videos), [videos])
  const level1Node = categoryTree.find((node) => node.name === level1)
  const level2Node = level1Node?.children.find((node) => node.name === level2)
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
      // 按 B站收藏夹添加时间从新到旧；手动添加的条目没有 favAt，退回本地添加时间
      .sort((a, b) => (b.favAt || b.addedAt) - (a.favAt || a.addedAt))
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

  /** 从收藏进入：路由带着 bvid 时直接打开对应视频 */
  useEffect(() => {
    if (!focusId) {
      lastFocus.current = undefined
      return
    }
    if (lastFocus.current === focusId) return
    const video = videos.find((entry) => entry.bvid === focusId)
    if (!video) {
      // 列表还没加载到这条视频时保持等待，等 videos 更新后再试
      if (videos.length) {
        lastFocus.current = focusId
        onNotice('这条收藏不在演唱列表中')
      }
      return
    }
    lastFocus.current = focusId
    void openVideo(video)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, videos])

  const favOf = (bvid: string): boolean =>
    data.innerFavs.some((fav) => fav.module === 'singing' && fav.id === bvid)

  const toggleFav = (video: SingingVideo): void => {
    const exists = favOf(video.bvid)
    update((d) => {
      if (exists) {
        return {
          ...d,
          innerFavs: d.innerFavs.filter(
            (fav) => !(fav.module === 'singing' && fav.id === video.bvid)
          )
        }
      }
      return {
        ...d,
        innerFavs: [
          ...d.innerFavs,
          {
            module: 'singing',
            id: video.bvid,
            title: video.title,
            subtitle: [video.category, video.owner].filter(Boolean).join(' · '),
            cover: video.cover || null,
            savedAt: Date.now(),
            videoUrl: null,
            mediaId: 0,
            durationSec: video.durationSec,
            tweetUrl: null,
            payload: JSON.stringify({ bvid: video.bvid, page: video.page })
          }
        ]
      }
    })
    onNotice(exists ? '已取消收藏' : '已收藏')
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
              // 从主页 / 收藏进来时直接回到上一页，不停在演唱列表
              if (focusId && onExit) onExit()
            }}
          >
            <ChevronLeft size={15} /> 返回
          </button>
          <h1 className="page-title" title={playing.title}>
            {playing.title}
          </h1>
          <div className="page-actions">
            <button className="btn" onClick={() => toggleFav(playing)}>
              <Heart size={15} fill={favOf(playing.bvid) ? 'currentColor' : 'none'} />
              {favOf(playing.bvid) ? '已收藏' : '收藏'}
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
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">演唱</h1>
        <span className="page-desc">请尽量戴上耳机调高音量 感受置身于现场的震撼</span>
        <div className="page-actions">
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
          <ModuleShortcuts onOpenFavorites={onOpenFavorites} />
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
          desc="默认视频随版本更新；需要添加时请在「设置 → 清单管理 → 演唱管理」里操作。登录只用于提高播放画质。"
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
                <button
                  className={`fav-heart${favOf(video.bvid) ? ' on' : ''}`}
                  title={favOf(video.bvid) ? '取消收藏' : '收藏'}
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleFav(video)
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Heart size={15} fill={favOf(video.bvid) ? 'currentColor' : 'none'} />
                </button>
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
    </>
  )
}
