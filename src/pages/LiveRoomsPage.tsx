import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ExternalLink, Heart, LogIn, LogOut } from 'lucide-react'
import { useData } from '../state/DataContext'
import { EmptyState, Modal, ModuleShortcuts, Pagination } from '../components/ui'
import { SearchBar } from '../components/SearchBar'
import { LivePlayer } from '../components/LivePlayer'
import { tileGradient } from '../utils/data'
import { enabledLivePlatforms, livePlatformOfSource } from '../shared/livePlatformSources'
import {
  LIVE_PLATFORMS,
  liveRoomKey,
  type LiveCategoryGroup,
  type LiveFavorite,
  type LiveLoginStatus,
  type LivePlatformId,
  type LiveQrStart,
  type LiveRoom,
  type LiveRoomFocus,
  type LiveRoomPlayback
} from '../shared/livePlatform'

type Mode = 'hot' | 'category' | 'search'

const PLATFORM_NAMES: Record<LivePlatformId, string> = {
  bilibili: 'B站',
  douyu: '斗鱼',
  douyin: '抖音'
}

/** 每个平台在本次会话里的浏览现场：切平台时直接还原，不重新请求 */
interface LiveViewSnapshot {
  mode: Mode
  input: string
  query: string
  groupPicker: string
  areaPicker: string
  categories: LiveCategoryGroup[]
  rooms: LiveRoom[]
  page: number
  hasMore: boolean
  error: string
}

function isRoomInput(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  return (
    /^\d{3,20}$/.test(text) ||
    /live\.bilibili\.com|douyu\.com\/\d+|live\.douyin\.com\/\d+/i.test(text)
  )
}

function detectPlatform(value: string): LivePlatformId | null {
  if (/bilibili\.com/i.test(value)) return 'bilibili'
  if (/douyu\.com/i.test(value)) return 'douyu'
  if (/douyin\.com/i.test(value)) return 'douyin'
  return null
}

/** 主进程抓流偶尔会卡住，渲染层也要有硬超时，保证不会一直显示加载中 */
function withRequestTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        window.clearTimeout(timer)
        reject(err)
      }
    )
  })
}

export function LiveRoomsPage({
  onNotice,
  resetSignal,
  focus,
  onExit,
  onOpenFavorites
}: {
  onNotice: (text: string) => void
  resetSignal?: number
  focus?: LiveRoomFocus
  onExit?: () => void
  onOpenFavorites?: () => void
}) {
  const { data, update } = useData()
  const [platform, setPlatform] = useState<LivePlatformId>('bilibili')
  const [mode, setMode] = useState<Mode>('hot')
  const [rooms, setRooms] = useState<LiveRoom[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [categories, setCategories] = useState<LiveCategoryGroup[]>([])
  const [groupPicker, setGroupPicker] = useState('')
  const [areaPicker, setAreaPicker] = useState('')
  const [playing, setPlaying] = useState<{ input: string; room?: LiveRoom } | null>(null)
  const [playback, setPlayback] = useState<LiveRoomPlayback | null>(null)
  const [playbackError, setPlaybackError] = useState('')
  const [playbackLoading, setPlaybackLoading] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [loginBusy, setLoginBusy] = useState(false)
  const [qr, setQr] = useState<LiveQrStart | null>(null)
  const [qrHint, setQrHint] = useState('')
  const [statuses, setStatuses] = useState<Partial<Record<LivePlatformId, LiveLoginStatus>>>({})
  const lastReset = useRef(resetSignal)
  const playRequestRef = useRef(0)
  const listRequestRef = useRef(0)
  const skipLoadRef = useRef(false)
  const viewCache = useRef<Map<LivePlatformId, LiveViewSnapshot>>(new Map())
  const focusKeyRef = useRef('')

  const favorites = data.liveFavorites

  const enabledSources = useMemo(
    () => enabledLivePlatforms(data.livePlatformSources),
    [data.livePlatformSources]
  )
  const enabledPlatforms = useMemo(
    () => enabledSources.map((item) => item.platform),
    [enabledSources]
  )
  const platformName = (id: LivePlatformId): string =>
    data.livePlatformSources.find((item) => livePlatformOfSource(item) === id)?.name ||
    PLATFORM_NAMES[id]

  const refreshStatuses = async (): Promise<void> => {
    const list = await Promise.all(
      LIVE_PLATFORMS.map((item) => window.laozheng.livePlatformLoginStatus(item.id))
    )
    const next: Partial<Record<LivePlatformId, LiveLoginStatus>> = {}
    for (const status of list) next[status.platform] = status
    setStatuses(next)
  }

  useEffect(() => {
    void refreshStatuses()
  }, [])

  const currentArea = useMemo(() => {
    if (!areaPicker) return null
    for (const group of categories) {
      const area = group.areas.find((item) => item.id === areaPicker)
      if (area) return area
    }
    return null
  }, [categories, areaPicker])

  const loadList = async (nextPage: number): Promise<void> => {
    if (!enabledPlatforms.includes(platform)) return
    if (mode === 'category' && !areaPicker) return
    const token = ++listRequestRef.current
    setLoading(true)
    setError('')
    try {
      const result = await withRequestTimeout(
        window.laozheng.livePlatformList(
          platform,
          mode === 'hot' ? 'recommend' : mode === 'category' ? 'category' : 'search',
          {
            page: nextPage,
            parentId: currentArea?.parentId ?? groupPicker,
            areaId: areaPicker,
            keyword: query
          }
        ),
        70_000,
        '加载超时，请点刷新重试'
      )
      if (token !== listRequestRef.current) return
      setRooms(result.items)
      setPage(nextPage)
      setHasMore(result.hasMore)
      setError(result.error ?? '')
    } catch (err) {
      if (token !== listRequestRef.current) return
      setRooms([])
      setError(err instanceof Error ? err.message : '列表加载失败')
    } finally {
      if (token === listRequestRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    viewCache.current.set(platform, {
      mode,
      input,
      query,
      groupPicker,
      areaPicker,
      categories,
      rooms,
      page,
      hasMore,
      error
    })
  }, [platform, mode, input, query, groupPicker, areaPicker, categories, rooms, page, hasMore, error])

  useEffect(() => {
    if (skipLoadRef.current) {
      skipLoadRef.current = false
      return
    }
    if (!enabledPlatforms.includes(platform)) return
    if (mode === 'category' && !areaPicker) return
    void loadList(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, mode, areaPicker, query, reloadToken, enabledPlatforms])

  useEffect(() => {
    if (!enabledPlatforms.length) return
    if (enabledPlatforms.includes(platform)) return
    switchPlatform(enabledPlatforms[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledPlatforms, platform])

  useEffect(() => {
    if (!enabledPlatforms.includes(platform)) return
    if (viewCache.current.get(platform)?.categories.length) return
    let alive = true
    withRequestTimeout(
      window.laozheng.livePlatformCategories(platform),
      60_000,
      '分类加载超时'
    )
      .then((result) => {
        if (!alive) return
        setCategories(result.groups)
        if (result.error && !result.groups.length) setError(result.error)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, enabledPlatforms])

  useEffect(() => {
    if (resetSignal === lastReset.current) return
    lastReset.current = resetSignal
    playRequestRef.current += 1
    listRequestRef.current += 1
    skipLoadRef.current = false
    viewCache.current.clear()
    setPlaying(null)
    setPlayback(null)
    setPlaybackError('')
    setInput('')
    setQuery('')
    setMode('hot')
    setAreaPicker('')
    setGroupPicker('')
    setRooms([])
    setPage(1)
    setLoading(false)
    setReloadToken((value) => value + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal])

  useEffect(() => {
    if (!loginOpen || !qr || platform !== 'bilibili') return undefined
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
            setStatuses((prev) => ({ ...prev, bilibili: result.login as LiveLoginStatus }))
            onNotice('B站登录成功')
          }
        })
        .catch(() => undefined)
    }, 2000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [loginOpen, qr, platform, onNotice])

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

  const openLogin = async (): Promise<void> => {
    if (statuses[platform]?.loggedIn) {
      onNotice(`已登录：${statuses[platform]?.name ?? platformName(platform)}`)
      return
    }
    if (platform === 'bilibili') {
      setLoginOpen(true)
      void startBilibiliQr()
      return
    }
    setLoginBusy(true)
    onNotice(`请在弹出的${platformName(platform)}窗口中扫码登录`)
    try {
      const result = await window.laozheng.livePlatformOpenLogin(platform)
      if (result.error) {
        onNotice(result.error)
      } else if (result.canceled) {
        onNotice('已取消登录')
      } else if (result.login) {
        setStatuses((prev) => ({ ...prev, [platform]: result.login as LiveLoginStatus }))
        onNotice(`${platformName(platform)}登录成功`)
      }
    } catch (err) {
      onNotice(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoginBusy(false)
    }
  }

  const logout = async (): Promise<void> => {
    try {
      const status = await window.laozheng.livePlatformLogout(platform)
      setStatuses((prev) => ({ ...prev, [platform]: status }))
      onNotice(`已退出${platformName(platform)}账号`)
    } catch {
      onNotice('退出登录失败')
    }
  }

  const isFavorite = (room: LiveRoom): boolean =>
    favorites.some((item) => item.platform === room.platform && item.roomId === room.roomId)

  const toggleFavorite = (room: LiveRoom): void => {
    const key = liveRoomKey(room.platform, room.roomId)
    const exists = favorites.some(
      (item) => liveRoomKey(item.platform, item.roomId) === key
    )
    update((d) => {
      if (exists) {
        return {
          ...d,
          liveFavorites: d.liveFavorites.filter(
            (item) => liveRoomKey(item.platform, item.roomId) !== key
          )
        }
      }
      const row: LiveFavorite = {
        platform: room.platform,
        roomId: room.roomId,
        title: room.title,
        anchor: room.anchor,
        cover: room.cover,
        area: room.area,
        savedAt: Date.now()
      }
      return { ...d, liveFavorites: [row, ...d.liveFavorites].slice(0, 200) }
    })
    onNotice(exists ? '已取消收藏' : '已收藏')
  }

  const recordHistory = (room: LiveRoom): void => {
    if (!room.roomId) return
    update((d) => {
      const rest = d.liveHistory.filter(
        (item) => !(item.platform === room.platform && item.roomId === room.roomId)
      )
      return {
        ...d,
        liveHistory: [
          {
            platform: room.platform,
            roomId: room.roomId,
            title: room.title,
            anchor: room.anchor,
            cover: room.cover,
            watchedAt: Date.now()
          },
          ...rest
        ].slice(0, 100)
      }
    })
  }

  const openRoom = async (
    roomInput: string,
    room?: LiveRoom,
    qualityId?: string,
    platformOverride?: LivePlatformId
  ): Promise<void> => {
    const targetPlatform = platformOverride ?? room?.platform ?? platform
    const token = ++playRequestRef.current
    setPlaying({ input: roomInput, room })
    setPlayback(null)
    setPlaybackError('')
    setPlaybackLoading(true)
    try {
      const result = await withRequestTimeout(
        window.laozheng.livePlatformRoom(targetPlatform, roomInput, qualityId),
        45_000,
        '获取直播流超时：可能未开播或平台限制了网页播放'
      )
      if (token !== playRequestRef.current) return
      setPlayback(result)
      if (result.detail.roomId) {
        recordHistory({
          ...result.detail,
          title: result.detail.title || room?.title || '',
          anchor: result.detail.anchor || room?.anchor || '',
          cover: result.detail.cover || room?.cover || ''
        })
      }
    } catch (err) {
      if (token !== playRequestRef.current) return
      const message = err instanceof Error ? err.message : '获取直播流失败'
      setPlayback(null)
      setPlaybackError(message)
      onNotice(message)
    } finally {
      if (token === playRequestRef.current) setPlaybackLoading(false)
    }
  }

  useEffect(() => {
    if (!focus?.roomId) return
    const key = `${focus.platform}:${focus.roomId}:${focus.at ?? 0}`
    if (focusKeyRef.current === key) return
    focusKeyRef.current = key
    // 走平台切换逻辑，顺带还原该平台的分区 / 列表现场，避免把上一个平台的分区带过来
    if (focus.platform !== platform) switchPlatform(focus.platform)
    void openRoom(
      focus.roomId,
      {
        platform: focus.platform,
        roomId: focus.roomId,
        title: focus.title ?? '',
        anchor: focus.anchor ?? '',
        cover: focus.cover ?? '',
        area: '',
        watching: '',
        status: 'unknown'
      },
      undefined,
      focus.platform
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.platform, focus?.roomId, focus?.at])

  const submitSearch = (): void => {
    const value = input.trim()
    if (!value) return
    if (isRoomInput(value)) {
      const detected = detectPlatform(value)
      if (detected && detected !== platform) switchPlatform(detected)
      void openRoom(value, undefined, undefined, detected ?? platform)
      return
    }
    setQuery(value)
    setMode('search')
  }

  const switchPlatform = (next: LivePlatformId): void => {
    if (next === platform) return
    listRequestRef.current += 1
    setLoading(false)
    const saved = viewCache.current.get(next)
    if (saved) {
      skipLoadRef.current = true
      setPlatform(next)
      setMode(saved.mode)
      setInput(saved.input)
      setQuery(saved.query)
      setGroupPicker(saved.groupPicker)
      setAreaPicker(saved.areaPicker)
      setCategories(saved.categories)
      setRooms(saved.rooms)
      setPage(saved.page)
      setHasMore(saved.hasMore)
      setError(saved.error)
      return
    }
    skipLoadRef.current = false
    setPlatform(next)
    setMode('hot')
    setInput('')
    setQuery('')
    setGroupPicker('')
    setAreaPicker('')
    setCategories([])
    setRooms([])
    setPage(1)
    setHasMore(false)
    setError('')
  }

  const changeMode = (next: Mode): void => {
    if (next === mode) return
    setMode(next)
    setError('')
    if (next !== 'search') {
      setInput('')
      setQuery('')
    }
    if (next === 'hot') {
      setGroupPicker('')
      setAreaPicker('')
    }
  }

  const pickGroup = (id: string): void => {
    const group = categories.find((item) => item.id === id)
    const areaId = group?.areas[0]?.id ?? ''
    setGroupPicker(id)
    setAreaPicker(areaId)
    setInput('')
    setQuery('')
    setError('')
    setMode(id && areaId ? 'category' : 'hot')
  }

  const pickArea = (id: string): void => {
    setAreaPicker(id)
    setInput('')
    setQuery('')
    setError('')
    setMode(id ? 'category' : 'hot')
  }

  const backToList = (): void => {
    playRequestRef.current += 1
    setPlaying(null)
    setPlayback(null)
    setPlaybackError('')
    setPlaybackLoading(false)
  }

  const renderRoomCard = (room: LiveRoom, index: number) => {
    const status = room.status
    return (
      <div
        key={`${room.platform}-${room.roomId}-${index}`}
        className="live-room-card"
        role="button"
        tabIndex={0}
        onClick={() => {
          void openRoom(room.roomId, room)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            void openRoom(room.roomId, room)
          }
        }}
      >
        <div
          className="live-room-cover"
          style={room.cover ? undefined : { background: tileGradient(room.anchor || room.title) }}
        >
          {room.cover ? <img src={room.cover} alt="" loading="lazy" /> : null}
          {status !== 'unknown' ? (
            <span className={`live-room-badge ${status}`}>
              {status === 'living' ? '直播中' : status === 'replay' ? '轮播' : '未开播'}
            </span>
          ) : null}
          <button
            type="button"
            className={`fav-heart ${isFavorite(room) ? 'on' : ''}`}
            title={isFavorite(room) ? '取消收藏' : '收藏直播间'}
            onClick={(event) => {
              event.stopPropagation()
              toggleFavorite(room)
            }}
          >
            <Heart size={15} fill={isFavorite(room) ? 'currentColor' : 'none'} />
          </button>
        </div>
        <div className="live-room-info">
          <div className="live-room-title" title={room.title}>
            {room.title || '未命名直播间'}
          </div>
          <div className="live-room-meta">
            <span>{room.anchor || '主播'}</span>
            {room.watching ? <span>{room.watching}</span> : null}
          </div>
          <div className="live-room-sub">
            {platformName(room.platform)}
            {room.area ? ` · ${room.area}` : ''}
          </div>
        </div>
      </div>
    )
  }

  if (playing) {
    const detail = playback?.detail
    const title = detail?.title || playing.room?.title || '直播间'
    const link = detail?.link || playing.room?.link
    const favRoom = detail ?? playing.room
    return (
      <>
        <header className="page-header">
          <button
            className="btn ghost"
            onClick={() => {
              if (focus && onExit) {
                onExit()
                return
              }
              backToList()
            }}
          >
            <ChevronLeft size={15} /> 返回
          </button>
          <h1 className="page-title" title={title}>
            {title}
          </h1>
          <div className="page-actions">
            {favRoom ? (
              <button
                className="btn"
                onClick={() => toggleFavorite(favRoom)}
                disabled={!favRoom.roomId}
              >
                <Heart size={15} fill={isFavorite(favRoom) ? 'currentColor' : 'none'} />
                {isFavorite(favRoom) ? '已收藏' : '收藏'}
              </button>
            ) : null}
            {link ? (
              <button
                className="icon-btn header-shortcut"
                title="在浏览器打开原直播间"
                onClick={() => void window.laozheng.openExternal(link)}
              >
                <ExternalLink size={17} />
              </button>
            ) : null}
          </div>
        </header>

        <div className="live-room-detail">
          <span>{platformName(playing.room?.platform ?? platform)}</span>
          {detail?.anchor ? <span>{detail.anchor}</span> : null}
          {detail?.area ? <span>{detail.area}</span> : null}
          {detail?.watching ? <span>{detail.watching} 人气</span> : null}
          {detail?.statusText ? <span className="live-status-offline">{detail.statusText}</span> : null}
        </div>

        {playbackLoading ? (
          <EmptyState
            title="正在获取直播流…"
            desc={
              (playing.room?.platform ?? platform) === 'douyin'
                ? '抖音需要打开直播间页面抓流，通常需要几秒。'
                : '正在向平台请求清晰度和线路。'
            }
          />
        ) : playback?.error || playbackError ? (
          <EmptyState
            title="播放失败"
            desc={playback?.error || playbackError}
            action={
              <div className="live-error-actions">
                <button className="btn" onClick={() => void openRoom(playing.input, playing.room)}>
                  重试
                </button>
                {link ? (
                  <button className="btn ghost" onClick={() => void window.laozheng.openExternal(link)}>
                    在浏览器打开
                  </button>
                ) : null}
              </div>
            }
          />
        ) : (
          <>
            <LivePlayer lines={playback?.lines ?? []} onError={(message) => onNotice(message)} />
            {playback && playback.qualities.length > 1 ? (
              <div className="live-qualities">
                <span>清晰度</span>
                {playback.qualities.map((quality) => (
                  <button
                    key={quality.id}
                    className={`chip ${
                      playback.lines[0]?.qualityId === quality.id ? 'active' : ''
                    }`}
                    onClick={() => void openRoom(playing.input, playing.room, quality.id)}
                  >
                    {quality.label}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}
      </>
    )
  }

  const currentStatus = statuses[platform]

  if (!enabledPlatforms.length) {
    return (
      <>
        <header className="page-header">
          <h1 className="page-title">直播</h1>
          <div className="page-actions">
            <ModuleShortcuts onOpenFavorites={onOpenFavorites} />
          </div>
        </header>
        <EmptyState
          title="还没有启用的直播源"
          desc="到「设置 → 片源管理 → 直播源」启用或添加 B站 / 斗鱼 / 抖音。"
        />
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">直播</h1>
        <div className="page-actions">
          <button className="btn" onClick={() => void openLogin()} disabled={loginBusy}>
            <LogIn size={15} />
            {loginBusy
              ? '等待登录…'
              : currentStatus?.loggedIn
                ? currentStatus.name || '已登录'
                : '扫码登录'}
          </button>
          {currentStatus?.loggedIn ? (
            <button className="icon-btn" title="退出当前平台账号" onClick={() => void logout()}>
              <LogOut size={16} />
            </button>
          ) : null}
          <ModuleShortcuts onOpenFavorites={onOpenFavorites} />
        </div>
      </header>

      <SearchBar
        value={input}
        onChange={setInput}
        onSubmit={submitSearch}
        onClear={() => {
          setInput('')
          setQuery('')
          if (mode === 'search') changeMode('hot')
        }}
        placeholder="搜索直播间 / 主播，或粘贴直播间链接"
        submitLabel="搜索"
        onRefresh={() => {
          void window.laozheng.forceRefresh('liveRooms').catch(() => {})
          setReloadToken((value) => value + 1)
        }}
        refreshing={loading}
        refreshDisabled={mode === 'category' && !areaPicker}
        leading={
          <select
            className="select-inline"
            value={platform}
            title="切换直播平台"
            onChange={(event) => switchPlatform(event.target.value as LivePlatformId)}
          >
            {enabledSources.map((item) => (
              <option key={item.platform} value={item.platform}>
                {item.source.name}
              </option>
            ))}
          </select>
        }
      />

      {categories.length ? (
        <div className="toolbar">
          {categories.length === 1 ? (
            <select
              className="select-inline"
              value={areaPicker}
              onChange={(event) => pickArea(event.target.value)}
            >
              <option value="">热门</option>
              {categories[0].areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <select
                className="select-inline"
                value={groupPicker}
                onChange={(event) => pickGroup(event.target.value)}
              >
                <option value="">热门</option>
                {categories.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <select
                className="select-inline"
                value={areaPicker}
                onChange={(event) => pickArea(event.target.value)}
                disabled={!groupPicker}
              >
                {groupPicker ? (
                  (categories.find((group) => group.id === groupPicker)?.areas ?? []).map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name}
                    </option>
                  ))
                ) : (
                  <option value="">分类</option>
                )}
              </select>
            </>
          )}
        </div>
      ) : null}

      {loading ? (
        <EmptyState
          title="正在加载直播间…"
          desc={platform === 'douyin' ? '抖音需要打开直播页抓取列表，可能慢几秒。' : undefined}
        />
      ) : error ? (
        <EmptyState
          title="加载失败"
          desc={error}
          action={
            <button className="btn" onClick={() => void loadList(page)}>
              重试
            </button>
          }
        />
      ) : rooms.length === 0 ? (
        <EmptyState
          title={mode === 'search' ? '没有搜到直播间' : '这个分类暂时没有直播间'}
          desc="换个分类或关键词再试。"
        />
      ) : (
        <>
          <div className="live-room-grid">
            {rooms.map((room, index) => renderRoomCard(room, index))}
          </div>
          <Pagination
            page={page}
            hasMore={hasMore}
            showLast={false}
            disabled={loading}
            onChange={(next) => void loadList(next)}
          />
        </>
      )}

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
              登录只用于提高清晰度和搜索，Cookie 加密保存在本机，不进备份与云同步。
            </p>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
