# 老郑分享 · PC 端

手机端（[Bug142857/ShangYin](https://github.com/Bug142857/ShangYin)）的桌面版本，数据格式与手机端完全互通。
本仓库只承载 PC 端代码，手机端仓库保持独立、不再改动。

## 技术选型

**Electron + React + TypeScript + electron-vite**。

选 Electron 而不是 Tauri 的原因：

- 现有功能大量是网络请求 + JSON / HTML 解析，Node 生态（undici、cheerio 等）迁移成本最低；
- 自带 Chromium，媒体播放（H.264 / HLS）在每台 Windows 上行为一致，不依赖系统 WebView2 版本；
- 后续集成其他开源软件时，主进程可直接拉起 ffmpeg / yt-dlp / mpv 等 CLI 或本地服务，npm 现成方案最多；
- 代价是安装包 80–120MB、内存占用高于 Tauri，接受这一取舍。

## 当前进度

已具备可运行的桌面框架与主要功能模块：

- 首页模块宫格（与手机端模块一一对应）、左侧导航、深浅色跟随系统；
- **搜索**：影视 / 图书 / 游戏 / 人物四类，必须先选分类再搜索；结果可拉取详情并加入指定清单，已收藏条目显示所在清单；
- **观影 + 番1~番4**：片源管理（增删改 / 启停 / 测速 / 批量导入 / 内置源）、跨源并发搜索、线路与剧集选择、HLS 播放、收藏、下载；
- **电视**：M3U 网络源 / 本地导入、频道分组与搜索、直播播放、收藏；
- **音乐**：在线搜索、直链解析播放、歌词、收藏、下载；
- **X站 / P站 / 吃瓜**：榜单 / 分类 / 搜索、详情、视频播放、收藏、下载；
- **本子（哔咔）**：内置账号自动登录，分类 / 排序 / 搜索 / 翻页、详情、章节、纵向图片阅读、收藏；
- **漫画（Komiic）**：内置账号自动登录，最近更新 / 热门 / 分类 / 搜索、详情、章节、纵向图片阅读、收藏；
- **账号管理**：哔咔 / Komiic / 无忧三站账号已内置并加密保存，启动自动登录（无忧自动完成滑块验证）；设置页可查看状态或重新登录；
- **图书 / 游戏**：已收藏条目按分类聚合、搜索、加入更多清单；
- **清单**：根清单 / 子清单的查看、新建、重命名、删除，条目浏览与从清单移除，按清单名稳定配色；
- **收藏**：爱心收藏聚合查看，支持关键词搜索与按模块筛选；
- **下载**：视频直链与 m3u8 切片合并下载（AES-128 解密）、本地播放、删除记录/文件；
- **设置**：数据概览、导入导出、打开数据目录、账号管理、WebDAV 云同步（上传 / 恢复 / 测试连接）、检查更新；
- 数据自动保存到本机 `userData/data.json`（临时文件替换写入，防写坏）。

仍未实现：静默自动更新、安装包签名、漫画/本子批量下载。

> 应用内「检查更新」读取公开更新清单（私有仓库的 Releases 匿名 API 不可见），有新版本时会打开对应的 Release 页。

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
  main.ts        # 主进程：窗口、IPC、菜单、请求层规则（Referer/UA/CORS）
  preload.ts     # contextBridge 暴露 API
  store.ts       # data.json 读写 / 导入导出（格式与手机端一致）
  douban.ts      # 条目搜索与详情抓取（影视 / 图书 / 游戏 / 人物）
  vod.ts         # 苹果CMS 采集源搜索 / 详情 / 测速
  live.ts        # 电视源（M3U）落盘、解析与频道加载
  music.ts       # 音乐搜索与直链解析
  downloads.ts   # 直链 / HLS 下载 + 本地媒体服务
  xsite.ts       # X站客户端
  psite.ts       # P站客户端
  melon.ts       # 吃瓜客户端
  sync.ts        # WebDAV 云同步
  accounts.ts    # 内置账号仓库（safeStorage 加密账密 / token）
  bika.ts        # 哔咔：签名接口、列表 / 详情 / 章节 / 图片
  komiic.ts      # Komiic：GraphQL、token 续期、图片鉴权
  wygamer.ts     # 无忧：自动通过滑块验证 + 持久化会话
src/
  shared/        # 共用类型（备份格式 version 1 + 各模块类型）
  state/         # 数据上下文（加载 / 防抖保存）
  modules.tsx    # 首页模块注册表
  components/    # VideoPlayer（hls.js）等
  pages/         # 首页 / 搜索 / 观影 / 电视 / 音乐 / X站 / P站 / 本子 / 漫画 /
                 # 吃瓜 / 图书 / 游戏 / 清单 / 清单详情 / 收藏 / 下载 / 设置
  utils/data.ts  # 清单递归计数、条目查询、收藏筛选等
docs/
  AI_PROJECT_MEMORY.md  # 项目记忆（PC 约定 + 手机端历史记忆）
```

## 数据互通

两端共用手机端 `ExportJson.kt` 的备份格式（`version: 1`），字段完全一致：

```text
items / lists / listItems / vodSources / innerFavs / readProgress / config
```

- 手机端：数据管理 → 导出 → 把 JSON 传到电脑；
- PC 端：设置 → 导入手机端备份（覆盖本机数据）；
- PC 端：设置 → 导出备份 → 手机端导入。

云同步复用手机端同一份云端备份：设置 → 云同步（WebDAV）→ 上传 / 从云端恢复。

## 内置账号

哔咔、Komiic、无忧三个站点的账号已内置，**启动时自动登录，不需要手动输入**：

- 账密与 token 用系统 DPAPI（Electron `safeStorage`）加密后保存在 `userData/accounts.json`，不会进入备份文件、日志或仓库；
- 开发态从 `.secrets/accounts.json` 读取种子，打包时由 electron-builder 作为 `resources/accounts.seed.json` 内置；
- 哔咔 / Komiic 的 token 过期会自动用内置账密重登；无忧的滑块验证由隐藏窗口自动完成，登录 Cookie 持久化复用；
- 设置 → 账号管理可查看三站状态、重新登录，无忧还可打开可见登录窗口作为兜底。

`.secrets/` 已加入 `.gitignore`，请勿提交。

## 路线图

1. 静默自动更新（electron-updater）与安装包签名；
2. 音乐多平台音源与旧收藏回退播放；
3. 漫画 / 本子 / 书籍批量下载。

## 项目记忆

`docs/AI_PROJECT_MEMORY.md` 是本仓库的上下文入口：上半部分为 PC 端工程约定，下半部分原样保留手机端历史记忆，便于在新环境中继续开发。
