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

已具备可运行的桌面框架：

- 首页模块宫格（与手机端模块一一对应）、左侧导航、深浅色跟随系统；
- **清单**：根清单 / 子清单的查看、新建、重命名、删除，条目浏览与从清单移除，按清单名稳定配色；
- **收藏**：爱心收藏聚合查看，支持关键词搜索与按模块筛选；
- **设置**：数据概览、导入手机端备份、导出手机端可识别备份、打开数据目录；
- 数据自动保存到本机 `userData/data.json`（临时文件替换写入，防写坏）。

规划中（点击会提示）：观影、番1~番4、本子、漫画、游戏、图书、电视、音乐、吃瓜、X站、P站、下载管理。

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
  main.ts        # 主进程：窗口、IPC、菜单
  preload.ts     # contextBridge 暴露最小 API
  store.ts       # data.json 读写 / 导入导出（格式与手机端一致）
src/
  shared/        # 主进程与渲染进程共用类型（备份格式 version 1）
  state/         # 数据上下文（加载 / 防抖保存）
  modules.tsx    # 首页模块注册表
  pages/         # 首页 / 清单 / 清单详情 / 收藏 / 设置
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

云同步（坚果云 WebDAV）计划复用手机端同一份云端备份，后续版本接入。

## 路线图

1. 搜索与清单条目写入（影视 / 图书 / 游戏 / 人物分类）；
2. 观影 + 片源管理（导入手机端 `vodSources`，跨源搜索、播放器）；
3. 电视直播（M3U）、音乐（搜索 / 播放 / 收藏队列）；
4. 吃瓜、X站、P站、漫画、本子、番号；
5. 下载管理（视频 / 漫画 / 本子 / 音乐 / 书籍目录规范与手机端对齐）；
6. 云同步、自动更新、安装包签名与发布流程。

## 项目记忆

`docs/AI_PROJECT_MEMORY.md` 是本仓库的上下文入口：上半部分为 PC 端工程约定，下半部分原样保留手机端历史记忆，便于在新环境中继续开发。
