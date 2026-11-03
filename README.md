# 老郑分享 · PC 端

手机端（[Bug142857/ShangYin](https://github.com/Bug142857/ShangYin)）的桌面版本，数据格式与手机端互通。
本仓库只承载 PC 端代码，手机端仓库保持独立、不再改动。

**当前版本：v0.68** ｜ [下载最新安装包](https://github.com/Bug142857/LaoZheng/releases/latest)

## 技术选型

**Electron + React + TypeScript + electron-vite**。

选 Electron 而不是 Tauri 的原因：

- 现有功能大量是网络请求 + JSON / HTML 解析，Node 生态（undici、cheerio 等）迁移成本最低；
- 自带 Chromium，媒体播放（H.264 / HLS）在每台 Windows 上行为一致，不依赖系统 WebView2 版本；
- 后续集成其他开源软件时，主进程可直接拉起 ffmpeg / yt-dlp / mpv 等 CLI 或本地服务，npm 现成方案最多；
- 代价是安装包约 100–120MB、内存占用高于 Tauri，接受这一取舍。

## 已实现功能

- **导航**：左侧导航与手机端模块一一对应，启动默认进入清单（首页模块已移除）；图书 / 漫画 / 本子 / 番1~4 / P站 / X站标记「外网」；点 × 关闭窗口会隐藏到右下角托盘，托盘菜单可显示、隐藏或真正退出。
- **清单**：搜索影视 / 图书 / 游戏 / 人物，加入任意清单；支持子清单、网格 / 列表切换、封面四宫格拼图；条目详情包含评分、简介、演职员、剧照、预告片、短评；已收藏条目显示「从清单移除」，搜索里未收藏的条目显示「加入清单」。
- **收藏管理**：按模块整理，支持搜索、排序、删除；电影 / 短剧 / 番号 / P站 / X站用视频网格，点击可回到对应模块继续播放。
- **观影 + 番1~番4**：片源管理（增删改 / 启停 / 测速 / 批量导入 / 内置源）、跨源并发搜索、线路与剧集选择、HLS 播放、断点续播、收藏、下载。
- **短剧**：内置西饭短剧，可在片源管理里添加苹果CMS 短剧源；全部源 / 单源切换、分类（苹果CMS 源带数量）、搜索、分页、详情、选集、播放、收藏、下载。短剧源支持添加 / 批量导入 / 整体测试 / 导出，西饭源可改名、改接口地址或删除。
- **电视**：M3U 网络源 / 本地导入、频道分组与搜索、直播播放、收藏。
- **音乐**：无名音乐网搜索、33ve 自动兜底、直链解析、歌词同步、单曲 / 顺序 / 随机播放、收藏、下载；旧 joox / 网易云收藏按歌名回退。
- **X站 / P站 / 吃瓜**：榜单 / 分类 / 搜索、详情、视频播放、收藏、下载；吃瓜图片在主进程解密后落盘缓存。
- **磁力**：全部源 / 单源搜索、分页、复制磁链；内置多套资源库，支持添加 / 批量导入 / 整体测试 / 导出，屏蔽广告与智能过滤固定开启。
- **本子（哔咔）**：内置账号自动登录，分类 / 排序 / 搜索 / 翻页、详情、章节、三种阅读模式、整本 / 单章批量下载、收藏。
- **漫画（Komiic）**：内置账号自动登录，最近更新 / 热门 / 分类 / 搜索、详情、章节、三种阅读模式、整本 / 单章批量下载、收藏。
- **图书（Z-Library）**：保存账号密码后静默登录 / 自动填写登录表单；搜索 / 详情 / 下载到「图书」目录；额度提示。
- **游戏（无忧游戏库）**：首页 / 分类 / 搜索 / 详情、游戏属性、网盘下载链接解析、解压密码复制。
- **账号管理**：哔咔 / Komiic / 无忧三站账号内置并加密保存，启动自动登录（无忧自动完成滑块验证）；豆瓣、Z-Library 可在设置里登录 / 退出。
- **下载管理**：视频 / 漫画 / 本子 / 音乐 / 书籍分区；视频直链与 HLS 切片合并下载（AES-128 解密、ffmpeg 合并）、音乐、漫画 / 本子整本或单章批量下载（断点续传）、图书；支持本地打开、移入回收站。
- **缓存**：所有图片落盘缓存；搜索 / 列表 / 详情响应命中即显示，过期只在后台静默刷新；「清理缓存」会同时清理图片、接口与模块列表缓存并重新加载，不影响收藏、清单、进度与登录态。
- **数据与备份**：本机 `userData/data.json` 防抖保存，退出前同步落盘；手动导入 / 导出与 WebDAV 云同步。备份包含清单、收藏、片源、短剧源、电视源、磁力源、阅读 / 播放进度、下载记录、主题与下载目录；豆瓣 / 各站登录态与 WebDAV 密码只存本机加密，不写入备份。
- **设置**：主题管理、账号管理、数据管理、片源管理（影视 / 短剧 / 电视 / 磁力源，支持全部源整体导入导出）、清单管理（支持导入导出）、收藏管理、下载管理、清理缓存、版本更新。

仍待完成：安装包代码签名（需要证书）。

> 打包结束时 `scripts/pack-artifact.cjs` 只保留当前安装包，并删除 `win-unpacked`、`latest.yml`、`.blockmap` 等中间产物。

> 卸载时默认保留个人数据（`%APPDATA%\laozheng-pc` 与下载目录里的文件）；卸载向导第一页提供「同时清除个人数据」勾选项，默认不勾选。已下载的视频 / 漫画 / 音乐 / 图书文件不会被卸载程序删除。

> 应用内「检查更新」优先读公开仓库的 GitHub Releases，找到 exe 资产后在后台下载，完成后弹出安装向导。检查与下载都会先并发探测直连 / gh-proxy / ghproxy 三条线路，选最快且可用的一条（直连被墙时自动走镜像，其它线路留作兜底）；API 全部不可用时回退读公开清单（`update.json` 的 `version / url / exe / notes`）。**仓库需要是公开的**，匿名才能读取 Release 资产。

### 安装包签名

代码签名依赖证书，未配置时构建的是未签名安装包。拿到证书后任选一种方式交给 electron-builder：

```bash
# 方式一：PFX 证书
set CSC_LINK=D:\keys\laozheng.pfx
set CSC_KEY_PASSWORD=证书密码
npm run dist

# 方式二：指定证书文件（写进 package.json build.win.certificateFile）
```

签名后的安装包在 Windows 上不再出现「未知发布者」提示，也能配合后续的自动更新校验。

## 版本与发布

- 当前版本 **v0.68**。以后每次修改版本号 **+1**：`0.68 → 0.69 → 0.70 …`，即使不上传 GitHub 也照样递增。
- `package.json` 内部使用三段式（`0.68.0 / 0.69.0 / …`）；应用内显示、安装包文件名、tag 与 Release 一律去掉末尾 `.0`（`v0.68 / v0.69`），由 `main.ts` 的 `displayVersion()` 统一转换。
- 发版流程：改好代码与版本号 → 提交推送 → 打 `v*` tag 并推送。**GitHub Actions 会自动构建 Windows 安装包并上传到对应 Release**，不需要本地打包或手动传 100MB 文件。
- **每次发版必须同步公开 Gist 更新清单**（`update.json` 的 `version / url / exe / notes` 与本次 Release 完全一致）：GitHub API 不可达时应用靠它检查新版，漏更会导致回退线路报旧版本。
- 也可以在 Actions 页面手动运行 `Build Windows installer`，填写要补传的 tag（例如 `v0.68`）即可补传安装包。
- GitHub Release 说明必须用 UTF-8 写入，避免中文乱码。

### 自动构建（GitHub Actions）

工作流：[`.github/workflows/build-release.yml`](.github/workflows/build-release.yml)

- 触发：推送 `v*` tag，或手动 `workflow_dispatch`（可填 tag 补传）。
- 产物：`LaoZheng-<版本>-Setup.exe`，同时作为 Actions artifact 保留一份。
- 内置账号种子不进仓库：本仓库已配置 Actions Secret `ACCOUNTS_SEED`（值为本机 `.secrets/accounts.json` 的完整 JSON）；换仓库或重新初始化时需要到 **Settings → Secrets and variables → Actions → New repository secret** 重新添加。未配置时也能构建，但安装包不会内置哔咔 / Komiic / 无忧账号（日志会给出警告）。
- 本地仍可 `npm run dist` 生成 `release/老郑分享 Setup <版本>.exe` 用于测试。

## 开发

要求 Node.js ≥ 20（本机验证为 Node 24 / npm 11）。

```bash
npm install      # 安装依赖
npm run dev      # 开发模式（热更新）
npm run typecheck
npm run build    # 类型检查 + 生产构建，产物在 out/
npm run dist     # 构建 Windows 安装包，产物在 release/
```

## 目录结构

```
electron/
  main.ts        # 主进程：窗口 / 托盘、IPC、请求层规则（Referer/UA/CORS）
  preload.ts     # contextBridge 暴露 API
  store.ts       # data.json 读写 / 导入导出（格式与手机端互通）
  settings.ts    # 本机设置（下载目录 / 主题 / 上次图片目录）
  apiCache.ts    # 接口响应磁盘缓存（命中即返回 + 静默后台刷新）
  imageCache.ts  # 图片磁盘缓存（lzimg:// 协议）
  douban.ts      # 条目搜索与详情抓取（影视 / 图书 / 游戏 / 人物）
  vod.ts         # 苹果CMS 采集源搜索 / 详情 / 测速
  live.ts        # 电视源（M3U）落盘、解析与频道加载
  music.ts       # 音乐搜索与直链解析
  downloads.ts   # 直链 / HLS 下载 + 本地媒体服务
  xsite.ts       # X站客户端
  psite.ts       # P站客户端
  melon.ts       # 吃瓜客户端
  drama.ts       # 短剧：内置西饭 + 用户添加的苹果CMS 短剧源
  sync.ts        # WebDAV 云同步
  accounts.ts    # 内置账号仓库（safeStorage 加密账密 / token）
  bika.ts        # 哔咔：签名接口、列表 / 详情 / 章节 / 图片
  komiic.ts      # Komiic：GraphQL、token 续期、图片鉴权
  wygamer.ts     # 无忧：自动通过滑块验证 + 持久化会话
  zlib.ts        # Z-Library：隐藏窗口过反爬 + 搜索 / 详情 / 下载
src/
  shared/        # 共用类型（备份格式 version 1 + 各模块类型）
  state/         # 数据上下文（加载 / 防抖保存 / 退出前同步落盘）
  modules.tsx    # 旧首页模块注册表（首页已移除，当前不再引用）
  components/    # VideoPlayer、全局图片查看器、下载中心、音乐播放器等
  pages/         # 清单（默认首页）/ 搜索 / 观影 / 短剧 / 电视 / 音乐 / X站 / P站 / 本子 / 漫画 /
                 # 吃瓜 / 图书 / 游戏 / 清单 / 清单详情 / 收藏 / 下载 / 设置
  utils/         # 清单递归计数、收藏筛选、列表缓存、主题、下载事件
docs/
  AI_PROJECT_MEMORY.md  # 项目记忆（PC 约定 + 手机端历史记忆）
resources/
  default-seed.json     # 首次启动的默认清单 / 片源
  tray.png              # 右下角托盘图标
```

## 数据互通

两端共用手机端 `ExportJson.kt` 的备份格式（`version: 1`）：

```text
items / lists / listItems / vodSources / innerFavs / readProgress / config
```

PC 端额外带上以下可选字段，手机端会自动忽略：

```text
liveSources / downloads / magnetSources / magnetSearch / dramaSources / settings
```

- 手机端：数据管理 → 导出 → 把 JSON 传到电脑；
- PC 端：设置 → 数据管理 → 导入备份（覆盖本机数据）；
- PC 端：设置 → 数据管理 → 导出备份 → 手机端导入；
- 云同步：设置 → 数据管理 → 上传到云端 / 从云端恢复（**仅手动执行，不会自动同步**）。

## 内置账号

哔咔、Komiic、无忧三个站点的账号已内置，**启动时自动登录，不需要手动输入**：

- 账密与 token 用系统 DPAPI（Electron `safeStorage`）加密后保存在 `userData/accounts.json`，不会进入备份文件、日志或仓库；
- 开发态从 `.secrets/accounts.json` 读取种子，打包时由 electron-builder 作为 `resources/accounts.seed.json` 内置；
- 哔咔 / Komiic 的 token 过期会自动用内置账密重登；无忧的滑块验证由隐藏窗口自动完成，登录 Cookie 持久化复用；
- 设置 → 账号管理可查看三站状态、重新登录，无忧还可打开可见登录窗口作为兜底。

`.secrets/` 已加入 `.gitignore`，请勿提交。

## 项目记忆

`docs/AI_PROJECT_MEMORY.md` 是本仓库的上下文入口：上半部分为 PC 端工程约定，下半部分原样保留手机端历史记忆，便于在新环境中继续开发。
