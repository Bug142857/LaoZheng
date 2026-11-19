import Artplayer from 'artplayer'

/** 全局关闭 ArtPlayer 自带双击全屏：统一由外层 .player-stage 全屏，清晰度 / 弹幕层才能跟随 */
Artplayer.DBCLICK_FULLSCREEN = false

export const PLAYER_THEME = '#8b7cff'

/** 判断是否为 HLS 地址（爽看 /api/hls/<id> 这类不带 .m3u8 后缀的也算） */
export function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url) || /m3u8/i.test(url) || /\/api\/hls\//i.test(url)
}

/** 统一播放器外观：中文、品牌色、B 站式底部控制条（进度 / 音量 / 倍速 / 画中画 / 设置 / 快捷键） */
export function artBase(container: HTMLDivElement, url: string): Artplayer['option'] {
  return {
    container,
    url,
    lang: 'zh-cn',
    theme: PLAYER_THEME,
    autoplay: true,
    autoSize: false,
    autoMini: true,
    pip: true,
    // 全屏交给外层容器，自建按钮见 addStageFullscreen
    fullscreen: false,
    fullscreenWeb: false,
    playbackRate: true,
    setting: true,
    hotkey: true,
    backdrop: true,
    playsInline: true,
    airplay: false,
    miniProgressBar: true,
    moreVideoAttr: {
      controls: false,
      preload: 'auto'
    }
  }
}

/** 整个播放器容器全屏：清晰度下拉、弹幕层、工具条会一起进全屏 */
export function toggleStageFullscreen(stage: HTMLElement): void {
  if (document.fullscreenElement === stage) {
    void document.exitFullscreen().catch(() => undefined)
  } else {
    void stage.requestFullscreen().catch(() => undefined)
  }
}

const ICON_EXPAND =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>'
const ICON_COMPRESS =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>'

/** 在 ArtPlayer 控制条右侧加全屏按钮，并同步图标状态 */
export function addStageFullscreen(art: Artplayer, stage: HTMLElement): void {
  const button = art.controls.add({
    name: 'lz-fullscreen',
    position: 'right',
    index: 40,
    html: ICON_EXPAND,
    tooltip: '全屏',
    click: () => toggleStageFullscreen(stage)
  })
  const sync = (): void => {
    if (button) button.innerHTML = document.fullscreenElement === stage ? ICON_COMPRESS : ICON_EXPAND
  }
  document.addEventListener('fullscreenchange', sync)
  art.on('destroy', () => document.removeEventListener('fullscreenchange', sync))

  // 双击画面 = 整个容器全屏。ArtPlayer 把双击拆成两次 click，
  // 第一次 click 已经切换过一次播放 / 暂停，这里记录双击前的状态并在全屏后还原。
  let lastClickAt = 0
  let pausedBeforeClick = false
  art.on('click', () => {
    const now = Date.now()
    if (now - lastClickAt > Artplayer.DBCLICK_TIME) pausedBeforeClick = art.video.paused
    lastClickAt = now
  })
  art.on('dblclick', () => {
    toggleStageFullscreen(stage)
    if (pausedBeforeClick) {
      art.pause()
    } else {
      void art.play().catch(() => undefined)
    }
  })
}

export interface HlsHooks {
  /** 主清单解析完成，返回按码率 / 分辨率降序的清晰度列表 */
  onLevels?: (levels: { index: number; label: string }[]) => void
  /** 解析完成可以开始播放 */
  onParsed?: () => void
  /** 致命错误（线路失效 / 需要外网环境） */
  onFatal?: (message: string) => void
  /** 站点风控换成提示片 */
  onTip?: (message: string) => void
}

const HLS_CONFIG = {
  enableWorker: true,
  manifestLoadingMaxRetry: 6,
  manifestLoadingRetryDelay: 600,
  manifestLoadingMaxRetryTimeout: 4000,
  levelLoadingMaxRetry: 6,
  levelLoadingRetryDelay: 600,
  fragLoadingMaxRetry: 8,
  fragLoadingRetryDelay: 500
}

/**
 * HLS 挂载：保留原有网关重试 / 提示片检测 / 节点随机分流逻辑。
 * 每次拿到新 manifest 都重新计算清晰度并默认锁最高档。
 */
export async function attachM3u8(
  video: HTMLVideoElement,
  url: string,
  art: Artplayer,
  hooks: HlsHooks = {}
): Promise<void> {
  // hls.js 只在真正播放 HLS 时加载，避免 B 站 / 直播等不走 HLS 的播放器也跟着拉大包
  const { default: Hls } = await import('hls.js')
  if (!Hls.isSupported()) {
    // 原生支持 HLS 的环境（Safari / 部分 Chromium 构建）
    video.src = url
    return
  }
  const hls = new Hls({
    ...HLS_CONFIG,
    // 肉视频 /api/hls/<id> 是随机分流的 302 入口，Chromium 会缓存这条 302，
    // 重试时一直回到同一个边缘节点，节点坏了就整段播不了。每次请求加一次性参数强制重新分流。
    xhrSetup: (xhr, target) => {
      if (/\/api\/hls\//i.test(target)) {
        const bust = `r=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        xhr.open('GET', `${target}${target.includes('?') ? '&' : '?'}${bust}`, true)
      }
    }
  })
  art.hls = hls
  hls.on(Hls.Events.MANIFEST_PARSED, (_event, manifest) => {
    // 有的源只在主清单里声明带宽、不写分辨率，这类档位也纳入清晰度列表
    const parsed = manifest.levels
      .map((level, index) => {
        const height = level.height || 0
        const bitrate = level.bitrate || 0
        if (!height && !bitrate) return null
        return {
          index,
          label: height > 0 ? `${height}P` : `${Math.round(bitrate / 1000)}K`,
          rank: height * 1_000_000 + bitrate
        }
      })
      .filter((level): level is { index: number; label: string; rank: number } => !!level)
      .sort((a, b) => b.rank - a.rank)
    hooks.onLevels?.(parsed.map(({ index, label }) => ({ index, label })))
    // 默认锁最高清晰度，不做自适应降档
    if (parsed[0]) hls.currentLevel = parsed[0].index
    hooks.onParsed?.()
  })
  // 站点风控时会把播放清单换成几秒提示片（player.centercdn.top/tip.ts），检测到直接上报重连
  hls.on(Hls.Events.LEVEL_LOADED, (_event, payload) => {
    const first = payload.details?.fragments?.[0]?.url ?? ''
    if (first && /\/tip\./i.test(first)) {
      hooks.onTip?.('站点风控拦截了播放（返回提示片），请重试或稍后再试')
    }
  })
  hls.on(Hls.Events.ERROR, (_event, payload) => {
    if (payload.fatal) hooks.onFatal?.('播放失败，可能是线路失效或需要外网环境')
  })
  hls.loadSource(url)
  hls.attachMedia(video)
  art.on('destroy', () => hls.destroy())
}

/** FLV 直播挂载（斗鱼 / 抖音 / B 站直播） */
export async function attachFlv(
  video: HTMLVideoElement,
  url: string,
  art: Artplayer,
  onFatal: (message: string) => void
): Promise<void> {
  const { default: mpegts } = await import('mpegts.js')
  if (!mpegts.isSupported()) {
    onFatal('当前环境不支持 FLV 播放')
    return
  }
  const flv = mpegts.createPlayer(
    { type: 'flv', url, isLive: true, cors: true },
    { enableWorker: true, liveBufferLatencyChasing: true, lazyLoad: false }
  )
  flv.attachMediaElement(video)
  flv.on(mpegts.Events.ERROR, () => onFatal('FLV 直播流已中断，可能是线路失效'))
  flv.load()
  art.on('destroy', () => flv.destroy())
}

/** 切换 HLS 内部清晰度（-1 = 自动） */
export function setHlsLevel(art: Artplayer | null, level: number): void {
  const hls = art?.hls as { currentLevel: number } | undefined
  if (hls) hls.currentLevel = level
}
