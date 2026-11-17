/**
 * 软件模块清单：常用软件 / 浏览器扩展的官网下载地址与简介。
 * 只做展示与打开官网，不参与主进程请求；笔记内容存在 AppData.toolNotes。
 * 数组顺序 = 界面分组与组内顺序（按 category 首次出现分组）。
 */

export interface ToolItem {
  id: string
  name: string
  /** 官网 / 下载页地址 */
  url: string
  category: string
  /** 图标 key，由页面映射到 lucide 图标 */
  icon: string
  desc: string
}

export const TOOL_ITEMS: ToolItem[] = [
  {
    id: 'win11',
    name: '微软系统下载',
    url: 'https://www.microsoft.com/zh-cn/software-download/windows11',
    category: '系统安全',
    icon: 'MonitorDown',
    desc: '微软官方 Windows 11 镜像下载页，可下载 ISO 或制作官方安装 U 盘。重装系统优先用官方镜像，避免第三方改版捆绑。'
  },
  {
    id: 'tbtool',
    name: '图吧工具箱',
    url: 'https://www.tbtool.cn/',
    category: '系统安全',
    icon: 'Wrench',
    desc: '绿色免安装的硬件检测合集，集成 CPU-Z、GPU-Z、AIDA64、CrystalDiskInfo、DiskMark 等常用工具。装机验机、查参数、测硬盘一站搞定。'
  },
  {
    id: 'huorong',
    name: '火绒安全',
    url: 'https://www.huorong.cn/',
    category: '系统安全',
    icon: 'ShieldCheck',
    desc: '轻量国产安全软件，主打安静、低占用、无弹窗广告。提供病毒查杀、实时防护、弹窗拦截和家长控制，适合替代臃肿的安全卫士。'
  },
  {
    id: 'weishi360',
    name: '360安全卫士极速版',
    url: 'https://weishi.360.cn',
    category: '系统安全',
    icon: 'Shield',
    desc: '360 安全卫士的轻量版本，保留木马查杀、系统清理、优化加速等核心功能，去掉了大部分广告与推广模块。'
  },
  {
    id: 'browser360x',
    name: '360极速浏览器X',
    url: 'https://browser.360.cn/eex',
    category: '网络传输',
    icon: 'Globe',
    desc: '基于 Chromium 的国产双核浏览器，兼容 Chrome 扩展与扩展商店，支持 IE 内核切换，适合网银、政务等老旧站点。'
  },
  {
    id: 'thunder',
    name: '迅雷',
    url: 'https://www.xunlei.com',
    category: '网络传输',
    icon: 'Download',
    desc: '老牌下载工具，支持 HTTP、BT、磁力链接下载与加速，会员可使用离线下载和高速通道，适合大文件与冷门资源。'
  },
  {
    id: 'localsend',
    name: 'LocalSend',
    url: 'https://localsend.org/#/download',
    category: '网络传输',
    icon: 'Share2',
    desc: '开源跨平台局域网传输工具，同一 Wi-Fi 下手机、电脑、平板互传文件，不经过云端、不限速、无需注册。'
  },
  {
    id: 'xqnetwork',
    name: 'XQNetwork',
    url: 'https://81xq.cc/#/register?invite=Muk28UeZ',
    category: '网络传输',
    icon: 'Network',
    desc: '小强（XQ）注册与客户端下载入口，含邀请链接；原域名失效时可从地址发布页获取最新地址。'
  },
  {
    id: 'fastgithub',
    name: 'FastGithub',
    url: 'https://github.com/creazyboyone/FastGithub',
    category: '网络传输',
    icon: 'Rocket',
    desc: '开源 GitHub 访问加速工具，通过本地 DNS 与代理优化 GitHub 网页、Release 下载和 raw 文件的连接速度。'
  },
  {
    id: 'todesk',
    name: 'ToDesk',
    url: 'https://www.todesk.com',
    category: '网络传输',
    icon: 'MonitorSmartphone',
    desc: '国产远程控制软件，支持远程桌面、文件传输、手机远程控制电脑，免费版即可满足日常远程协助。'
  },
  {
    id: 'tencentmeeting',
    name: '腾讯会议',
    url: 'https://meeting.tencent.com/download/',
    category: '网络传输',
    icon: 'Video',
    desc: '腾讯官方视频会议工具，支持多人会议、屏幕共享、会议录制、虚拟背景和在线文档协作。'
  },
  {
    id: 'adguard',
    name: 'AdGuard',
    url: 'https://www.crxsoso.com/webstore/detail/bgnkhhnnamicmpeenaelnjfhikgbkllg',
    category: '页面插件',
    icon: 'ShieldBan',
    desc: '老牌广告拦截扩展，能过滤网页广告、视频贴片、弹窗和跟踪脚本，支持自定义规则；桌面版还可做系统级过滤。'
  },
  {
    id: 'simpletrans',
    name: '简约翻译',
    url: 'https://www.crxsoso.com/webstore/detail/bdiifdefkgmcblbcghdlonllpjhhjgof',
    category: '页面插件',
    icon: 'Languages',
    desc: '轻量浏览器翻译扩展，支持划词翻译、整页翻译与多翻译引擎切换，界面简洁，可自定义快捷键。'
  },
  {
    id: 'quantiwen',
    name: '全提问',
    url: 'https://www.crxsoso.com/webstore/detail/phlefbnhphgfijeabpgjlbcpedpdonef',
    category: '页面插件',
    icon: 'Sparkles',
    desc: '多 AI 并行提问扩展：输入一次问题，同时发给 DeepSeek、GPT、豆包等 12 个 AI 助手并排对比答案，交叉验证避免单一模型胡编，提问记录只存本地。'
  },
  {
    id: 'imagusreborn',
    name: 'Imagus Reborn',
    url: 'https://www.crxsoso.com/webstore/detail/fcjmgeodgobggcppooncdagfkogfffdm',
    category: '页面插件',
    icon: 'Image',
    desc: 'Imagus 的维护分支，光标停在缩略图或链接上即可放大查看原图 / 视频，筛选器规则更新更及时；安装后需在扩展详情启用「允许用户脚本」开关才会生效。'
  },
  {
    id: 'catcatch',
    name: '猫抓嗅探',
    url: 'https://www.crxsoso.com/webstore/detail/jfedfbgedapdagkghmgibemcoggfppbb',
    category: '页面插件',
    icon: 'Cat',
    desc: '浏览器视频嗅探扩展，自动识别网页中的视频、音频与图片资源，支持 M3U8 合并下载，是保存网页视频的常用工具。'
  },
  {
    id: 'folder360',
    name: '360文件夹',
    url: 'https://baoku.360.cn/xtgj/2000003908.html',
    category: '文件管理',
    icon: 'FolderTree',
    desc: '360 出品的本地文件管理工具，支持标签分组、快速搜索、批量重命名与常用目录置顶，适合整理大量文件。'
  },
  {
    id: '7zip',
    name: '7z',
    url: 'https://sparanoid.com/lab/7z',
    category: '文件管理',
    icon: 'FileArchive',
    desc: '7-Zip 官方中文镜像站（Sparanoid），开源免费的压缩软件，支持 7z、zip、rar、tar 等常见格式，压缩率高、无广告。'
  },
  {
    id: 'guohe',
    name: '果核看图',
    url: 'https://pic.ghxi.com/',
    category: '文件管理',
    icon: 'Eye',
    desc: '果核剥壳出品的轻量图片浏览器，启动快、占用低，支持常见图片格式、文件夹快速切换和滚轮缩放。'
  },
  {
    id: 'fileconverter',
    name: 'File Converter',
    url: 'https://file-converter.io/index.html',
    category: '文件管理',
    icon: 'FileCog',
    desc: '开源 Windows 右键菜单格式转换工具，支持图片、音频、视频和文档的批量转换，装好后在资源管理器右键即可使用。'
  },
  {
    id: 'yuque',
    name: '语雀',
    url: 'https://www.yuque.com/download',
    category: '文件管理',
    icon: 'NotebookPen',
    desc: '蚂蚁集团出品的知识库与文档协作工具，支持 Markdown、表格、画板、思维导图和团队协作，桌面端可离线编辑。'
  },
  {
    id: 'plainapp',
    name: 'PlainApp',
    url: 'https://github.com/plainhub/plain-app',
    category: '文件管理',
    icon: 'Smartphone',
    desc: '开源手机管理工具，在电脑浏览器里即可管理安卓手机的文件、照片、短信、联系人和通话记录，无需在手机安装 App。'
  },
  {
    id: 'qqmusic',
    name: 'QQ音乐',
    url: 'https://y.qq.com/download',
    category: '媒体影音',
    icon: 'Music',
    desc: 'QQ 音乐官方 PC 客户端，支持在线试听、无损 / 高解析音质、歌单同步、歌词显示与本地音乐管理。'
  },
  {
    id: 'potplayer',
    name: 'Potplayer',
    url: 'http://potplayer.tv',
    category: '媒体影音',
    icon: 'Play',
    desc: '全能视频播放器，内置完整解码器，几乎支持所有视频 / 音频格式与直播源，硬件解码性能好、播放流畅。'
  },
  {
    id: 'screentogif',
    name: 'ScreenToGif',
    url: 'https://nicke.tech/screentogif',
    category: '媒体影音',
    icon: 'Clapperboard',
    desc: '开源录屏工具，可录制屏幕、窗口或摄像头并直接生成 GIF，内置逐帧编辑、裁剪、文字和水印标注。'
  },
  {
    id: 'bili23',
    name: 'Bili23',
    url: 'https://github.com/ScottSloan/Bili23-Downloader',
    category: '媒体影音',
    icon: 'CirclePlay',
    desc: '开源 B 站视频下载工具，支持视频、番剧、课程下载，可保存弹幕与字幕，界面简洁。'
  },
  {
    id: 'losslesscut',
    name: 'LosslessCut',
    url: 'https://github.com/mifi/lossless-cut',
    category: '媒体影音',
    icon: 'Scissors',
    desc: '开源无损视频剪辑工具，基于 ffmpeg 直接切分关键帧，不重新编码、不损失画质，适合快速剪广告或提取片段。'
  },
  {
    id: 'telegram',
    name: 'Telegram',
    url: 'https://desktop.telegram.org/',
    category: '通讯社交',
    icon: 'Send',
    desc: '跨平台即时通讯客户端，支持云端同步、超大文件传输、频道与机器人。桌面版免安装即可运行，多设备消息实时同步。'
  },
  {
    id: 'qq',
    name: 'QQ',
    url: 'https://im.qq.com/pcqq',
    category: '通讯社交',
    icon: 'MessageCircle',
    desc: '腾讯 QQ 官方 PC 客户端，支持好友聊天、群聊、文件传输、远程协助和屏幕共享。'
  },
  {
    id: 'wechat',
    name: '微信',
    url: 'https://pc.weixin.qq.com',
    category: '通讯社交',
    icon: 'MessageSquare',
    desc: '微信官方 Windows 客户端，支持聊天、朋友圈、文件互传、小程序与公众号阅读，手机电脑消息同步。'
  },
  {
    id: 'wechatime',
    name: '微信输入法',
    url: 'https://z.weixin.qq.com/',
    category: '通讯社交',
    icon: 'Keyboard',
    desc: '微信官方输入法，支持拼音 / 双拼、智能纠错、快捷回复与常用语，可与手机端同步剪贴板，界面干净无广告。'
  },
  {
    id: 'weflow',
    name: 'WeFlow',
    url: 'https://github.com/hicccc77/WeFlow',
    category: '通讯社交',
    icon: 'Workflow',
    desc: '完全本地的微信聊天记录查看、分析与导出工具，支持实时查看、防撤回、朋友圈解密、年度报告，以及导出 HTML / JSON / Excel 等格式。'
  }
]
