# 老郑分享 PC 端 · 新增功能自检清单

> 用途：每次加新功能 / 新模块 / 新源 / 新收藏类型 / 新 IPC / 新播放器前逐项过一遍，避免重复 2026-11-18～20 已修过的问题。
> 配套：`docs/AI_PROJECT_MEMORY.md` 第 0 节、`docs/OPTIMIZATION_REVIEW_P0_P3.md`。
> 原则：不要求每项都做，但「涉及」的必须做；最终回复里说明跳过了哪些及原因。

## 0. 开工前

- [ ] `package.json` 版本先 +0.001（三段式，对外显示去掉末尾 `.0`）；纯文档 / 记忆更新不升版本。
- [ ] 读 `docs/AI_PROJECT_MEMORY.md` 第 0 节 + 跑 `git status`；大文件按关键词 Grep 后分段读，不整读。
- [ ] 先明确功能属于哪几类：新页面 / 新数据 / 新源 / 新收藏 / 新下载 / 新设置 / 新 IPC / 新播放器。

## 1. 数据：能不能丢、能不能回滚

- [ ] 新数据有明确落盘位置（`data.json` / 独立 JSON / `settings.json`），重启后能恢复；列表缓存只放可重建数据，不碰收藏、清单、进度。
- [ ] 新字段加进 `src/shared/types.ts` 的 `AppData`、`EMPTY_DATA`、`normalizeData`；字段可选、坏值回退，旧备份 / 手机备份缺字段不能报错。
- [ ] 同时接入三处：本机持久化、整体导入导出、云同步；导出前走 `stripNullFields`。
- [ ] 主进程保存必须串行 + 序号 + 临时文件 rename；退出前的同步写不能让旧异步写覆盖新数据（照 `electron/store.ts`）。
- [ ] 只存在主进程的数据（电视源 / 下载记录 / 磁力源 / 本机设置）必须进 `buildBackupPayload`，恢复时进 `applyBackupExtras`；不要重复写进 `data.json`。登录态 / Cookie / 密码不进备份。
- [ ] 高频进度（播放 / 阅读）走 `ProgressStore` + `data:setProgress`，不要用 `update()` 重写整份 `data.json`；暂停 / 切集 / 退出调 `flushReadProgress`；备份时合并 `progress().peek()`。
- [ ] 进度类独立存储必须串行写 + 退出同步落盘 + 代次防止旧异步写覆盖新值（照 `electron/progressStore.ts`）。
- [ ] 任何覆盖全量数据的入口（导入 / 云恢复 / 快照恢复 / 重置）必须先快照，快照失败即中止；流程照 `DataContext.replaceData`：flush 待保存 → 快照 → 取消防抖 → 清模块缓存 → 广播 `laozheng:data-replaced` → `applyBackupExtras`。

## 2. 稳定性：单页坏了不能整个应用白屏

- [ ] 新页面在 `src/App.tsx` 用 `pageBoundary(...)` 注册（lazy + Suspense + ErrorBoundary），并加进 `NAV_ITEMS` / 路由 / `routeKey` / `MODULE_SHORTCUTS`。
- [ ] 新模块默认会被有限 KeepAlive 卸载（最多 6 页，主页固定保留）；搜索词、列表、详情、页码、滚动位置必须能恢复，不能只放组件 state。
- [ ] 列表 → 详情用 `useDetailScrollRestore`；隐藏页面不写滚动位置；返回列表先清详情。
- [ ] 异步请求加「仅最后一次生效」保护，避免切源 / 返回 / 连点后旧响应覆盖新状态。
- [ ] 页面切走必须停视频 / 音频（全局会暂停隐藏页媒体，新播放器不要绕开）。
- [ ] lazy 页面 chunk 加载失败（更新后旧 chunk 404）时，ErrorBoundary 直接整页 reload；只 reset 不会重新 import，React.lazy 会缓存 rejected promise。
- [ ] 播放器全屏对 `.player-stage` 调 Fullscreen API，清晰度固定右上角；新视频模块优先复用 `src/components/artCore.ts`。
- [ ] 启动阶段不做重网络 / 大文件解析；放 `did-finish-load` 后或 `electron/idleTasks.ts`，先 `net.isOnline()`，失败只记日志。
- [ ] 退出前同步落盘（`beforeunload` / `will-quit`），不能只靠 350ms 防抖。

## 3. 性能：别把 data.json 和 DOM 撑爆

- [ ] 长列表用 `VirtualRows`（默认超过 80 行）/ `VirtualMasonry`（默认超过 40 条）；保留图片懒加载、批量选择、滚动恢复；小列表不虚拟化；列表缩短时窗口夹回合法范围。
- [ ] 新图片 / 接口缓存要有容量上限 + LRU；命中更新 mtime，最近 10 分钟文件不淘汰；清理不影响收藏 / 清单 / 进度 / 登录态。
- [ ] 下载统一走 `addDownload` 队列：全局并发 2，HLS 分片并发单独算；queued / paused / running 状态一致；暂停 / 取消要移出队列；显示速度 / ETA；有运行任务时不删 `.part`。
- [ ] 新重依赖按需动态 import；不把 hls.js / 播放器 / 大模块塞进首屏；大文件按域拆子模块（参考 `electron/ipc/`、`electron/novel/`、`electron/trainers/`、`src/pages/sourceSettings/`）。**`SourceSettings.tsx` / `downloads.ts` 暂不做纯搬家式大拆，只在改动对应功能时局部拆，避免无收益回归风险。**
- [ ] 高频进度只通知订阅进度的组件（`useProgressValue` / `getProgressSnapshot`），不要 `setData` 让所有 `useData()` 消费者一起重渲染。
- [ ] 新窗口 / 面板需要记忆尺寸位置时照 `electron/windowState.ts`：防抖保存 + 启动校验显示器区域 + 最大化单独存。

## 4. 安全：新通道 / 新地址 / 新文件

- [ ] 新 IPC 在 `electron/ipc/<domain>.ts` 注册；主进程校验类型 / 长度 / URL 协议 / 白名单；preload 只暴露最小方法；`LaozhengApi` 类型同步；渲染层不直接拿 Node。
- [ ] 隐藏取页窗口保持 `sandbox: true`；新窗口 `contextIsolation: true` / `nodeIntegration: false`。
- [ ] 媒体探测 / 服务端抓取只允许公网 http(s)：拦截 127 / 10 / 172.16-31 / 192.168 / 169.254 / 100.64 / 组播 / localhost / `.local` / 纯数字与十六进制 IP / IPv6 本地地址；ffmpeg 加 `-protocol_whitelist`。打开外链只允许 http(s)，禁止 `file:` / `javascript:` / 自定义协议。
- [ ] 账号 / Cookie / 密码走 `electron/secureStorage.ts`，日志与错误提示不打印敏感值；备份不含 `.secrets`。
- [ ] 文件名 / 快照名 / 缓存路径做合法校验，防路径穿越；写文件先临时文件再 rename。

## 5. 模块接入点：新模块 / 新源 / 新收藏 / 新缓存

- [ ] 新模块：导航顺序固定不可拖动；同时更新导航、路由、页面标题、返回栈、收藏分类、主页分组、收藏管理顺序、下载分区（涉及才做）。
- [ ] 新源：内置源 `builtin: true` 不可删除，只能停用 / 改名 / 改地址；默认 `testStatus: 'ok'`；支持增删改 / 导入 / 导出 / 启停 / 测试；`normalize` 补 `builtin`；加进片源管理卡片顺序；站点请求走 `requestSite` / 镜像自动恢复，不自己写裸 fetch。
- [ ] 新收藏：`module` key、payload 校验、卡片、跳转、主页 / 收藏页顺序、批量删除、备份字段一起改；已下线模块放 `HIDDEN_FAV_MODULES`。
- [ ] 新列表缓存：key 前缀能被 `clearCachePrefix` / `clearModuleCaches` 清掉；换源 / 启停 / 数据替换后失效；缓存结构变更升版本。
- [ ] 新设置：`UiSettings` + `electron/settings.ts` 双向归一化 + 备份快照；音量 / 队列等要防「设置还没加载完就写回空值」。
- [ ] 新增内置默认内容（源 / 视频 / 经验 / 清单）要同时处理新安装种子和已有用户启动合并：`electron/seed.ts` + `resources/default-seed.json` + `seed-state.json`，不能只改 `EMPTY_DATA` 或默认常量。

## 6. 验证与收尾

- [ ] `npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 全过。
- [ ] 解析 / 归一化 / 进度 / 备份类改动补最小单测（正常、空列表、缺字段、末页、错误页；样例去账号 Cookie）。
- [ ] e2e 一个脚本覆盖多个点，只测用户要求 + 新代码路径；测试资源用秒级本地小文件；`.tmp-*` 临时脚本收尾删除。
- [ ] 新增 / 修改安全边界（IPC、preload、凭据、写入路径、外链）才跑 `TRAE-security-review`。
- [ ] Electron / 播放器 / 下载内核升级单独安排完整回归，不与大功能混在一起；重点 HLS、下载、扫码登录、本地媒体、安装更新。
- [ ] 最终回复四段式：接入内容 → 验证结果 → 剩余限制 → 安装包；附真实数据，不只回「已修复」。
- [ ] 用户明说「发版」才 commit / push；发版同步 README、Gist `update.json`、记忆文件。
- [ ] 实施 / 放弃某项优化后，同步更新来源文档的实施状态（已做 / 不做 / 按需），不要留下「未实施」的过期结论。

## 附：这份清单对应的本次修复

| 本次实际修复 | 以后新功能要检查 |
| --- | --- |
| React 渲染异常导致整页白屏 | 新页面必须包 `pageBoundary` + 根 ErrorBoundary |
| 导入 / 云恢复覆盖后无法回滚 | 任何全量覆盖入口先创建快照，失败中止 |
| 播放进度每 8 秒重写约 1.2MB `data.json` | 高频数据走独立存储，不进 `update()` |
| 访问 21 个模块后进程内存 403MB → 1GB | 有限 KeepAlive，页面状态必须可恢复 |
| 下载无全局并发上限 | 新下载类型统一走队列 |
| 图片缓存只写不删、无限增长 | 新缓存必须有上限 + LRU |
| 启动后台登录拖慢首屏、离线反复超时 | 重任务延迟 / 空闲执行，先判断在线 |
| 窗口尺寸位置不记忆 | 新窗口保存 bounds 并校验显示器区域 |
| 音乐音量 / 队列重启丢失 | 新设置接持久化 + 导入导出 + 云同步 |
| 长列表 DOM / React 节点持续堆积 | 长列表用虚拟滚动 |
| `main.ts` / `novel.ts` / `trainers.ts` / `SourceSettings.tsx` 职责集中 | 新代码按域拆子模块，不继续加巨型文件 |
| 无日常 CI、站点解析器无测试 | 新增解析补单测，CI 跑 typecheck / lint / test / build |
| 隐藏取页窗口 `sandbox: false` | 新窗口按最小权限配置 |
| 页面切走后视频 / 音频继续出声 | 隐藏页媒体必须暂停 |
| 列表 → 详情返回后滚动位置丢失 | 新列表接 `useDetailScrollRestore` |
| 进度更新仍触发全局重渲染 | 进度只通知订阅进度的组件，不 `setData` |
| lazy chunk 失败时「重试」无效 | chunk 错误直接整页 reload |
| 优化文档状态过期 | 实施 / 放弃后同步更新来源文档 |
