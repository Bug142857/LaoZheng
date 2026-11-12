# 老郑分享 · PC 端项目记忆

> **唯一记忆入口**（PC 端仓库 https://github.com/Bug142857/LaoZheng），换电脑 / 换 AI 账号后从这里恢复上下文。
> 最后更新：2026-11-12（v0.136 未发版，**下次版本号 0.137**）。
> **读取纪律**：开工只读第 0 节（Read offset 0, limit 140），其余内容按关键词 Grep；**禁止整文件读取本文件**。
> 历史细节已归档，不要整读：`docs/archive/VERSION_LOG.md`（v0.55~v0.123 流水）、`docs/archive/MODULE_DETAILS.md`（各模块完整实现口径）、`docs/archive/MOBILE_HISTORY.md`（手机端原文）。
>
> 结构：**第 0 节 = 当前状态与硬规则**；**一 = PC 端工程约定**；**二 = 手机端历史记忆索引**。

### 0. 新窗口先读（当前状态）

- **⛔ 开工纪律（2026-11-11 用户强调，最高优先级）**：① 开工先读本节 + 跑 `git status`（**不要整读本文件与 project_memory.md**）；② 严格执行既有全部规则（版本号先 +1、新功能必带缓存 / 导入导出 / 云同步、各模块口径、发版需用户明说），不得凭印象省略；③ 收尾按「接入内容 → 验证结果 → 剩余限制 → 安装包」四段输出并附真实数据，不得只回「已修复」；④ 每轮结束**仅在出现新硬规则 / 用户新口径时**按「记忆同步净增长为 0」追加（单次 ≤5 行，同时删等量过期内容），不重复抄写既有内容；**平时一律不 commit / push**，用户明确说「发版」才 push（手机端 ShangYin 的「每轮必 push」不适用于 PC 端）。
- **版本状态**：v0.136 未发版（`package.json` = `0.136.0`）；**下次版本号 0.137**；最新已发版 = v0.109（Release 资产 `LaoZheng-0.109-Setup.exe`，108,100,148 字节，公开 Gist `update.json` 已同步 0.109）。
- **v0.131→v0.134（未发版）套图模块（原「美图」）**：新增 `meitu` 模块，默认源 魅影画廊 `https://www.jb9.es`（jb9 模板，入口是线路跳转页 `var targets`，解析可用镜像并缓存 30 分钟）+ 雪月映画 `https://taoo.xyz`（taoo 模板，Typecho photograph 主题）；列表 / 分类 / 图集详情（taoo 详情读 `script#virtual-gallery-data`，jb9 详情读 gallery-item 原图链接），图集内可翻页大图、收藏、下载到「套图」目录（v0.134 起由「美图」迁移改名）；源存 `data.meituSources`，片源管理有套图源卡片（增删改 / 导入 / 导出 / 测试 / 启停），列表缓存 `meitu1`；魅影画廊分类平铺展示站点导航全部分类（含下拉细分，去掉深夜电台，slug 作 id，数量仍按站点头尾页折算）；漫画 / 套图的网格浏览卡片右上角有单张下载按钮（直接进下载中心，不用点开）。
- **v0.124（未发版）皇片镜像信息流**：P站默认 `pList('recommended')` = `/recommended`，可切 推荐/最新/热门；X站默认 `/new/1`（最新），热门 = `/best`（单页），分类页显式 `s:uploaddate` / `s:views`；XH 默认 `/newest`，热门 = `/best`，分类排序段 `/categories/<slug>/newest|best/N`；镜像 chip 顺序 = 排序 chip → 全部 → 分类；X站 38 个分类中文映射 + 站内 `"nbResults"` 数量（2h 内存缓存）；XH 分类过滤 `macanese`（澳门人）。
- **v0.122（未发版）皇片播放专项**：片源管理 `testMsg` 为空且继承状态与预设一致时借用文案「可用」；`SiteResolver` 新增 `mediaAuth`（rou07 = false，不登记站点鉴权）+ `pickSkMediaUa`（3 个候选 UA 并行探测 playUrl，取返回 200 + `#EXTM3U` 的那个）；`skMediaHosts` 改存完整 `{referer, cookie, ua}`，新增 `noteShuangkanMediaRedirect` + `main.ts` `onBeforeRedirect`，让重定向后的 `jre*.vc*` 网关继承同一份鉴权；hls.js 增加 `manifestLoadingMaxRetry:6 / levelLoadingMaxRetry:6 / fragLoadingMaxRetry:8`，`LEVEL_LOADED` 首分片含 `/tip.` 直接报「站点风控拦截了播放」，不静默播提示片。
- **v0.122 第二轮（未发版）**：第一个源偶发失败根因 = 网关 `/api/hls/<id>` 的 **302 被 Chromium 缓存**（重试全回同一坏节点，网络层每次 fetch 会重新分流所以测不出来）；修复 = `VideoPlayer` 的 hls.js `xhrSetup` 只对 `/api/hls/` URL 追加一次性随机参数再 `xhr.open`，`main.ts` 对伪装成 `index.png` 的清单补 `Accept: */*`；第五个源详情页被站点 CDN 缓存约 3 小时、页内 `var stream` 令牌（约 3 小时）常已过期 → `skPpp.ts` 的 `pppDetail` 用 `freshPath()`（`/v/<id>/?t=<随机>`）强制回源，410/403 探活兜底保留。
- **省积分工作流（2026-11-12 用户批准）**：① 探查一次到位——单脚本覆盖全部目标路径，只回 ≤20 行结论（状态 / 选择器计数 / 首条标题），不打印 HTML；② 大输出不进上下文——日志 >30 行走 `context-mode`（`ctx_execute` / `ctx_execute_file`），否则重定向后只读错误行 / 尾部；③ 编辑批量做完再一次 `typecheck` → 一次 `build` → 一轮 e2e（只测用户明确要求 + 新代码路径）→ 最多一次 UI 抽查，不反复重启应用；**e2e 仍可主动跑（2026-11-12 用户确认不采用「只做 typecheck+build」）**，但必须一个脚本覆盖多个功能点、测试资源一律秒级小文件（禁止公网大文件）、临时脚本合并成一个并收尾统一删除；④ 缓存类改动先失效测试缓存再验，长任务拆会话（探查 / 实施分开），独立操作并行发出。
- **皇片播放鉴权规则（v0.122 第二轮，当前）**：① 提示片有两层根因——站点主域要 Cookie + Referer；**重定向后的 CDN 网关（`jre*.vc*.top/.sbs/.cc/.com` 等共享网关）对 master / variant / 分片 / AES key 每个请求单独鉴权**，任何一跳裸 UA 只回 `player.centercdn.top/tip.ts`（143 字节假清单 / 假 key）。实现：`gohome.ts` 的 `skMediaHosts` 存完整 `{referer, cookie, ua}`；requestSite / psite `getHtml` 成功后登记站点主域；`main.ts` `onBeforeRedirect` 把重定向目标域名继承同一份鉴权；`applyRequestHeaders` 的 skMedia 只对非 image 资源生效。② 肉视频（rou07）`/api/hls` **不能注入站点 Cookie / Referer / 桌面 UA**（网关按 UA 粘性分流到质量不一的边缘节点）：`SiteResolver.mediaAuth=false` 关闭登记，`resolveSkMediaPlay` **串行**探测候选 UA（并行会因会话粘性互相干扰），只登记 UA、**返回原始 `/api/hls/<id>` 入口不锁节点**（锁节点后一次坏节点就整段失败）。③ 网关 302 会被 Chromium 缓存 → hls.js `xhrSetup` 对 `/api/hls/` URL 追加一次性随机参数再 `xhr.open`，让每次请求（含 6 次重试）重新分流。④ 播放器重试 6 / 6 / 8；`LEVEL_LOADED` 检测 `/tip.` 直接报错。⑤ KVS（第五个源）详情页 CDN 缓存约 3 小时，`pppDetail` 必须走 `freshPath()` 回源拿新令牌。⑥ 节点池随时段翻转，rou07 偶发整段不可播属站点端问题，不要用固定 UA / 固定节点解决。
- **皇片镜像翻页规则（v0.123，当前）**：① 分页条只渲染当前页附近几页（P站只到 1~9），**不要用分页条判断末页**：P站从页面内嵌 `"resultsCount":N`（兼容 `VIDEO_FILTER_resultsCount=N`）反推，`pages = 1 + ceil((N-30)/42)`（第 1 页 30 条、第 2 页起 42 条）；搜索镜像封顶 100 页（101 起 404）、分类实测 ~451 页封顶 451；`PListResponse.totalPages` 与 `hasMore` 以此为准。② PPP（KVS）搜索分页是 AJAX：`?page=N` 无效、`/search/<kw>/N/` 404，必须走 `/search/?q=<kw>&mode=async&function=get_block&block_id=list_videos_videos_list_search_result&q=<kw>&category_ids=&sort_by=&from_videos=N&from_albums=N`，`from_videos` 与 `from_albums` 必须是两个独立参数（`from_videos+from_albums` 恒返回第一页）。③ X站镜像把搜索请求当首页返回，`xvidSearch` 以「标题是否含关键词」判定，不支持就提示「该源不支持搜索，请改用分类浏览」，不返回首页列表或空列表。
- **导航口径（2026-11-12 v0.134 更新）**：只有一套侧栏「老郑分享」，无「老郑优化」树与品牌切换；硬件（原「电脑信息」，key `sysinfo`）不在导航列表，应用默认页 = 硬件，点侧栏顶部「老郑分享」进入；顺序 清单 → 影视 → 短剧 → 电视 → 直播 → 音乐 → 漫画 → 小说 → 图书 → 游戏 → 补丁 → 磁力 → 壁纸 → 套图 → 吃瓜 → 皇片（`settings.ts` 的 `NAV_ORDER_VERSION=3` 把旧保存顺序一次性重排为这套，未知 key 留末尾）。片源管理卡片同序：影视 → 短剧 → 电视 → 直播 → 音乐 → 漫画 → 小说 → 补丁 → 磁力 → 壁纸 → 套图 → 皇片；收藏管理同序（watch → drama → tv → live → music → comic → novel → book → game → trainer → wallpaper → meitu → melon → shuangkan）；下载分区视频置顶，其余音乐 → 漫画 → 小说 → 书籍 → 修改器 → 壁纸 → 套图；首页标题为「下载管理」。整体导入 / 导出按钮在页面左上角；皇片 / 图书导航项都不带「外网」标记（图书的「外网」提示放在图书页标题后）。
- **播放器清晰度规则**：所有视频播放模块必须提供清晰度选择，默认自动选最高档，控件固定在播放器右上角（`VideoPlayer` 的 `.player-quality`，仅多码率 HLS 显示，切源自动重置）。
- **站点 500 自动恢复规则**：站点返回 500 时自动切到同站可用镜像线路（`requestSite` 前 3 步失败后用真实路径逐个实测同站线路，最多 8 条），无需用户手动操作；成功请求后把 `testStatus:'bad'` 的源自动改回 ok 并提示「已恢复可用」。

## 一、PC 端工程约定

### 1. 仓库边界

- 手机端仓库 `Bug142857/ShangYin`（Android / Kotlin / Compose）**已冻结**，只读参考，不提交任何改动。
- PC 端仓库 `Bug142857/LaoZheng`（本仓库），代码 / 文档 / 发布都在这里；**仓库已公开**（应用内读 Release 更新），但 `.secrets/`（账号种子）与任何证书 / 密码严禁入库。
- 两端只通过备份 JSON（format version 1）互通，字段以手机端 `ExportJson.kt` 为准。

### 2. 技术栈决策（2026-10-28 用户确认）

- **Electron + React + TypeScript + electron-vite**，不用 Tauri：功能以网络请求 + HTML/JSON 解析为主，Node 生态迁移成本最低，自带 Chromium 保证 HLS 行为一致，后续可拉 ffmpeg / yt-dlp / mpv 子进程；代价是安装包 80–120MB、内存高于 Tauri。
- 用户要求：PC 端**完整复刻手机端功能**，先跑通框架与数据迁移，再按模块补齐。

### 3. 版本与发布约定

- **版本号（2026-10-30 重新定义，2026-11-02 再次强调）**：当前 **v0.134**，下次 **0.135**；**每次修改都必须先把版本号 +1**（即使不发 Release / 只是修 bug 也照样递增）。electron-builder 要求三段式，`package.json` 写 `0.134.0`，对外显示、安装包文件名、tag 与 Release 一律去掉末尾 `.0`（`0.134 / v0.134`），由 `main.ts` 的 `displayVersion()` 统一转换。
- **发版必须经用户主动要求（2026-11-11 再次明确）**：平时只改代码 + 更新记忆，**一律不 commit / push**；用户说「发版」后才 push 并更新仓库（含本记忆文件），再创建 / 上传 Release。
- **发版安装包由 GitHub Actions 云端构建**：push + 打 tag 后 Actions 自动构建并上传 `LaoZheng-0.N-Setup.exe`（v0.51 / v0.66 / v0.109 均如此），本机不再手动传包；本机 `npm run dist` 产物 `release\老郑分享 Setup 0.N.exe` 只供本地测试，不是发版资产。
- **Release 说明必须用 UTF-8**：用 Node `fetch` 或 curl 提交 JSON，不要用 PowerShell `Invoke-RestMethod` 手拼中文（会乱码）。
- 构建产物 `out/`、安装包 `release/`、`node_modules/` 不入库；`npm run dist` 收尾（`scripts/pack-artifact.cjs`）只保留当前 exe，删除旧安装包 / `latest.yml` / `.blockmap` / `win-unpacked`；应用启动时清空 `userData/updates` 旧包。
- 发版前必须 `npm run build` 通过；安装包用 `npm run dist`（NSIS，可选安装目录、桌面快捷方式「老郑分享」、`build/installer.nsh` 卸载页可选清除个人数据）。
- **发版必做（2026-11-03 用户强调）**：发布后必须同步公开 Gist 更新清单 `update.json`（gist id `802551160083623580189fc536724d65`，字段 `version / url / exe / notes`），与当次 Release 完全一致；这是 GitHub API 不可达时检查更新的唯一兜底，漏更用户永远收不到新版。
- 更新链路：公开 Releases API → 后台下载 exe（检查与下载都先并发探测直连 / gh-proxy.com / ghproxy.net 按延迟选线）→ 打开 NSIS 向导；API 不可达回退 Gist 清单。安装包签名仍未做（无证书，见第 8 节）。

### 4. 工程结构（当前）

```
electron/main.ts        主进程：窗口、单实例锁、IPC、请求层规则（Referer/UA/CORS）
electron/preload.ts     contextBridge 暴露 API（数据 / 搜索 / 播放 / 下载 / 云同步 / 更新）
electron/store.ts       userData/data.json 读写；导入校验 items/lists/listItems
electron/douban.ts      豆瓣条目搜索 / 详情           electron/vod.ts        苹果CMS 片源
electron/live.ts        电视 M3U 源                  electron/music.ts      音乐源
electron/downloads.ts   直链 / HLS 合并 / 本地媒体服务  electron/sync.ts       WebDAV 云同步
electron/xsite.ts       X站                          electron/psite.ts      P站
electron/melon.ts       吃瓜                         electron/drama.ts      短剧
electron/shuangkan.ts   皇片 / 肉视频                 electron/gohome.ts     SiteResolver 换址 / 鉴权
electron/bika.ts        哔咔本子                      electron/komiic.ts     Komiic 漫画
electron/bikahub.ts     哔咔小说 / 漫画                electron/bikahubImage.ts 图床解密
electron/tptoon.ts      头牌漫画                      electron/jmcomic.ts    禁漫天堂
electron/jmcomicImage.ts 禁漫章节图还原               electron/wallpaper.ts  壁纸
electron/meitu.ts       套图（魅影画廊 / 雪月映画）   electron/wygamer.ts     无忧游戏                      electron/zlib.ts       Z-Library
electron/trainers.ts    补丁 / 修改器                 electron/sysinfo.ts    硬件
electron/accounts.ts    内置账号仓库                  electron/livePlatform/ 直播（B站/斗鱼/抖音）
electron/powershell.ts  PowerShell 封装
src/shared/*.ts         两端共用类型 + normalizeData + 各模块默认源
src/state/              DataProvider：启动加载、防抖 350ms 保存、replaceData 立即落盘
src/components/         VideoPlayer（hls.js）/ LivePlayer / DownloadCenter / ui.tsx
src/pages/              清单 / 搜索 / 影视 / 短剧 / 音乐 / 电视 / 直播 / 吃瓜 / 磁力 / 小说 /
                        壁纸 / 套图 / 漫画 / 本子 / 图书 / 番号 / P站 / X站 / 皇片 / 游戏 / 补丁 / 硬件 / 设置
src/utils/data.ts       根清单、递归子清单、条目查询、收藏筛选
docs/AI_PROJECT_MEMORY.md 本文件（docs/archive/ 为历史归档）
```

- 安全基线：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，渲染层只走 preload API；CSP 允许 self + http(s) 图片/媒体 + `blob:`，脚本限 self + inline + blob。
- 数据写入先写临时文件再 rename；品牌色 `--brand: #8b7cff`，深色为默认，浅色跟随系统。

### 5. 数据格式（与手机端一致，version 1）

> **硬规则（2026-11-02 用户强调）**：每次新增功能必须同时做到 **① 有缓存（切模块 / 重开应用不丢）② 数据进入导入导出 ③ 数据进入云同步**，不要再出现「新功能忘了接备份」。

- 根字段：`version / exportAt / items / lists / listItems / vodSources / innerFavs / readProgress / config`。
- `lists` 的 `parentId = null` 为根清单；`vodSources.regionManual` 必须保留，避免自动归组覆盖手选；`innerFavs` 以 `module + id` 唯一；`readProgress` 存漫画 / 本子上次章节。
- PC 扩展字段（只有备份里存在才恢复，手机端忽略）：`liveSources / downloads / magnetSources / magnetSearch / settings / dramaSources / trainerSources / installedTrainers / wallpaperSources / meituSources / comicSources / musicSources / livePlatformSources / h1Sources`。
- `settings.navOrder`（v0.82）存两套导航顺序，随备份 / 云同步恢复；`settings.lastDirs` 记住各类文件对话框上次目录。
- `dramaSources`（v0.65 / v0.117）：内置 `xifan` + `rou07`（`builtin: true`），其余必须带 `baseUrl` 的苹果CMS 源；`trainerSources`（v0.75）字段 `id / name / type(fling|3dm|gamersky|ali213|megagames) / baseUrl / enabled / testStatus / testMsg / testAt`，默认补全七个源。
- 导入判据与手机端一致：必须同时存在 `items / lists / listItems`，否则拒绝。
- **双端互通（2026-11-03 核对 `ExportJson.kt`）**：items / lists / listItems / vodSources / innerFavs / readProgress / config 双向兼容；PC 扩展字段手机端忽略且手机再导出会丢，不要经手机中转；手机 `config` 里的电视源 / 下载记录 PC 只原样保存不应用；下载文件不互通；导出前必须递归去掉 `null`（Android `optString` 会把 null 读成字符串 `"null"`）。

### 6. 当前进度

- 已完成模块（启动默认进入清单，首页模块已于 v0.65 移除）：清单 / 搜索 / 影视（原「观影」，key 仍 `watch`）/ 短剧 / 音乐 / 游戏（无忧）/ 补丁（原「修改器」）/ 电视 / 直播 / 吃瓜 / 磁力 / 小说 / 壁纸 / 套图 / 漫画 / 本子 / 图书（Z-Library）/ 番号 / P站 / X站 / 皇片 / 硬件（默认页）/ 设置；各模块完整功能清单见 `docs/archive/MODULE_DETAILS.md` 附 A。
- 全局能力：返回栈、模块常驻挂载、`lzimg://` 图片磁盘缓存 + `apiCache`（永久命中 + 静默后台刷新）、全局下载中心（下载前必确认）、收藏管理按模块卡片、云同步 / 导入导出 / 托盘、主题与导航拖动排序。

### 7. 各模块实现口径（完整细节见 `docs/archive/MODULE_DETAILS.md`，先 Grep 再读）

- 通用口径：所有源配置统一支持增删改 / 批量导入 / 整体测试 / 导出 / 启停，新增与批量导入默认 `testStatus:'ok'` / `testMsg:'可用'`，源配置随备份 / 云同步 / 整体导入导出走；带分类的源尽量给分类 chip 显示数量（`categoryCounts` + `chip-count`）。
- 带源模块统一在搜索框前放「全部源（N）/ 单源」下拉（音乐 / 短剧 / 电视 / 磁力 / 小说 / 漫画 / 番号 / 皇片），默认全部源；列表缓存按源隔离，切模块不丢。

#### 7.1 条目搜索（`electron/douban.ts`）
- 主进程 `subject:search` / `subject:detail`：影视 `movie.douban.com/subject_search?cat=1002`、图书 `book.douban.com/subject_search?cat=1001`（`window.__DATA__` 括号配对截取）、游戏 / 人物 `www.douban.com/search?cat=3114|1065`；详情 `m.douban.com/rexxar/api/v2/{movie|tv|book|game}/{id}`。
- 硬约束：界面文案不出现「豆瓣」、无外链、搜索必须显式分类；反爬 / 空壳页面显式抛错重试，不静默返回空。

#### 7.2 观影 / 番号（`electron/vod.ts`）
- 苹果CMS V10：`?ac=videolist&wd=` 搜索、`&ids=` 详情，`vod_play_url` 按 `$$$` 分组 / `#` 分集，默认只留 3u8；标题匹配精确 3 分 / 包含 2 分 / 同年 +1，低于 2 分不展示；渲染层 6 并发实时追加。
- 观影首页走公开榜单 `movie.douban.com/j/search_subjects`（10 个固定分类，每类 1 请求，缓存 1 小时）；番号默认 4 源 `h1_fixed_1~4`（黄色仓库 hsckzy.vip / 91麻豆 91md.me / 奶香香 Naixxzy.com / 精品资源 www.jingpinx.com），收藏 module = `h1`。

#### 7.2.1 短剧（`electron/drama.ts` / `DramaPage.tsx`）
- 内置源 `xifan`（西饭）+ `rou07`（肉视频短剧 `https://rou07.net/series`：`/s/<id>` 详情、`/v/<id>` 播放、搜索 `/search?q=&tab=series` 只有一页），其余为用户添加的苹果CMS 源；统一用 `isBuiltinDramaSource()` 判断内置源。
- 红果 / 河马代码保留兼容旧数据但不进新配置；`drama:catalog/detail/play` 全部白名单校验；默认列表按源写 `drama_<sourceId>`。

#### 7.3 电视（`electron/live.ts`）
- 源存 `userData/live-sources.json`（含 `testStatus/testMsg/testAt`），不进备份 JSON；M3U 解析 `group-title` / `tvg-name` / 逗号后频道名，同地址只留第一条，网络源 20s 超时，本地导入存 `content`。

#### 7.4 音乐（`electron/music.ts`）
- 源 `data.musicSources`：`mvmp3` 无名音乐 `http://www.mvmp3.com`、`s33ve` 33ve `https://www.33ve.com`；mvmp3 `GET /so.php?wd=&page=` + `POST /style/js/play.php` 拿直链，失败 / 空结果自动用 33ve 兜底。
- 无损音乐（flac.music.hi.cn）默认源已下线但适配器保留；网易云会员曲匿名接口只给试听（不当作成功），回落酷我同名替代。

#### 7.4.1 小说（`electron/novel.ts` / `NovelPage.tsx`）
- 默认 3 源：蚂蚁文学 `https://www.biquges.com`（301 → mayiwsk.info，`canonicalBases` 记住落地域名，否则 POST 跟 301 退化成 GET 丢参数）、九五小说 `http://www.95dushu.info`（模板 `95dushu`）、玄幻阁 `http://www.xuanhuange.info`（模板 `xuanhuange`）。
- 卡片副标题「作者 · 完结/连载」、心形收藏 module=`novel`（id=`sourceId|bookId`）、客户端 24 条/页；整本下载 `kind='novel'` 走「下载小说」确认框。

#### 7.5 下载（`electron/downloads.ts`）
- 目录 `系统下载目录/老郑分享/{视频,音乐,漫画,图书,小说}`，记录 `userData/downloads.json`；**所有下载入口必须先弹确认**（`requestDownload` → DownloadCenter / 各模块 ConfirmDialog），不允许点击即下载。
- 直链 `.part` → rename；HLS master 选最高码率 → 切片 / AES-128-CBC 解密 → 本地 m3u8；本地播放 `127.0.0.1:{随机端口}/media/...` 带 Range + CORS；漫画按章 `0001.jpg…` + `meta.json` 断点续传。

#### 7.6 X站 / P站（`electron/xsite.ts` / `psite.ts`）
- X站 pektino：`/api/media?range&page&per_page&sort=favorite&category&lang`、`/api/tags`、`/api/media/{url_cd}`，直链 video.twimg.com；收藏 module=`xsite`（id=urlCd）。
- P站：列表 `li[data-video-vkey]`，详情从 `mediaDefinitions` 选最高清 HLS，失败退 mp4；`*.phncdn.com` 统一补 `Referer: https://www.pornhub.com/`；收藏 module=`psite`（id=vkey）。

#### 7.7 吃瓜（`electron/melon.ts`）
- 着陆页 Base64 混淆解出镜像并探活（页面须含 `post-card`）；列表 `article div.post-card`；正文 `[itemprop=articleBody]`，视频在 `.dplayer[data-config]` 的 `video.url`（HLS，auth_key 有时效）；图片真实地址在 img 任意属性里（src 是占位图）。

#### 7.8 云同步 / 更新（`electron/sync.ts` / `main.ts`）
- WebDAV：配置 `userData/sync.json`（safeStorage 加密），上传前自动 PROPFIND + 逐级 MKCOL，PUT `{目录}/data.json`，恢复校验 items/lists/listItems。
- 更新：公开 Releases API → 失败回退 Gist `802551160083623580189fc536724d65`；检查与下载先测速选线（下载用 `Range: bytes=0-0` 只等响应头）；**仓库必须公开**，否则匿名读资产 404。

#### 7.9 播放与请求层（`electron/main.ts setupRequestRules`）
- CSP 必须含 `media-src 'self' blob: http: https:` 与 `worker-src blob:`（缺了 hls.js 播放全黑）；`onHeadersReceived` 对 xhr / media 注入 `Access-Control-Allow-Origin: *`。
- 单一 `onBeforeSendHeaders` 补头：豆瓣图 m.douban Referer + iPhone UA、`*.phncdn.com`、`komiic.com/cc` 的 `/api/image/*` 注入 Cookie + 完整路径 Referer、`*.picacomic.com / *.go2778.com` 的 `okhttp/3.8.1`、其余媒体补移动 UA；`qnmob*.doubanio.com` 重写到 `img2.doubanio.com`。
- `node-html-parser` 用 `externalizeDepsPlugin({ exclude })` 打进主进程 bundle，避免安装包漏依赖。

#### 7.10 账号 / 本子 / 漫画（v0.4.0）
- `electron/accounts.ts`：账密 / token 用 safeStorage（DPAPI）加密存 `userData/accounts.json`，种子来自 `resources/accounts.seed.json`（`.secrets/accounts.json`，永不入库），状态 `ok/failed/pending/unknown` 广播。
- 哔咔 `electron/bika.ts`：HmacSHA256 签名（不含域名），`picaapi.picacomic.com` → `picaapi.go2778.com` 回退，401 静默重登一次，收藏 module=`h2`；Komiic `electron/komiic.ts`：GraphQL + token 20h 自动续期，章节图注入 `komiic-access-token` Cookie，收藏 module=`comic`。
- 无忧 `electron/wygamer.ts` 隐藏窗口自动滑块登录（`persist:wygamer`）；Z-Library `electron/zlib.ts` 隐藏窗口过 DiamWall、**搜索必须 POST**，账密 safeStorage 存 `userData/zlib-account.json`。

#### 7.10.1 套图（原美图，`electron/meitu.ts` / `MeituPage.tsx`，v0.131 起 / v0.134 改名）
- 源 `data.meituSources`：`jb9` 魅影画廊（入口 `https://www.jb9.es`，跳转页解析 `var targets` 得可用镜像并缓存 30 分钟；列表 `/page/N/`、分类 `/category/<slug>/page/N/`、搜索 `?s=`）与 `taoo` 雪月映画（`https://taoo.xyz`，列表 `/page/N/`、分类 `/category/<slug>/N/`、搜索 `/search/<kw>/`）；`meitu:list/categories/detail` 走 `cachedResponse` 并支持 `forceRefresh('meitu')`。
- 图集详情：taoo 读 `script#virtual-gallery-data` 的 `items[].original`；jb9 读 gallery-item 的 `<a href>` 原图 + 内层缩略图；收藏 `module=meitu`、id=`源id|图集id`，payload 存 pageUrl / 封面 / 标题 / 张数；下载 kind=`meitu`（目录「套图」，v0.134 自动把旧「美图」目录与记录迁移过来）。缓存 key `meitu1`。

#### 7.11 壁纸（`electron/wallpaper.ts` / `WallpaperPage.tsx`，v0.107）
- 源 `data.wallpaperSources`（`template` 只有 `wallspic` / `bizhimi`），默认顺序「壁纸迷 → Wallspic」，默认 `testStatus='ok'` / `testMsg='可用'`，缺失补默认、删空不补回；缓存 key `wallpaper2`，分类缓存 `wallpaper:categories:v5`。
- 默认地址：壁纸迷 `https://bizhimi.cn`（电脑 `/` 或 `/?cat=`，手机 `/wallpaper/mobile-wallpaper`，数量取 WP REST `X-WP-Total`）、Wallspic `https://wallspic.com/cn`（`/album/...`、搜索 `/search/<kw>`，读 `window.mainGalleryTarget / mainAdaptiveGallery`）。
- 关键规则：图片缓存必须带兜底 UA（`VOD_UA`，否则 chaoxing 等 403 变坏图，失败卡片直接隐藏）；`downloads:add` 白名单必须含 `wallpaper`；`downloads:setWallpaper` 用 PowerShell `SystemParametersInfo` 设桌面壁纸。

#### 7.12 漫画源：哔咔 / 头牌 / 禁漫天堂
- 哔咔 `bikahub`：小说 `https://bikahub.net`、漫画同域（默认顺序 漫画客 → Komiic → 哔咔 → 头牌 → 禁漫），漫画 ID 前缀 `bkh:`；`electron/bikahub.ts` 解析 Nuxt `__NUXT_DATA__`，搜索走 `/api/v1/search?keyword=&type=novel|comic&page=N&pageSize=100`；图床 AES-CBC 必须经 `electron/bikahubImage.ts` 解密（key `f5d965df75336270` / iv `97b60394abc2fbe1`），5xx/429 读 `/go-home` 探活换镜像。
- 头牌 `tptoon`：`https://tptoon.net`，ID 前缀 `tpt:`，`electron/tptoon.ts`；搜索 `POST /e/search/index.php` 后必须从结果页分页链接认 `/so/<id>.html`（`res.url` 为空）；探测发布页 `https://tpmh8.cc/` 时必须用 `/update/` 验签（只用首页会把 `mhqun.com` 误判成镜像）。
- 禁漫 `jmcomic`：`https://18comic66.com`（入口 `/enter`），ID 前缀 `jm:`（镜像 `jm_<sourceId>:`），`electron/jmcomic.ts` + `jmcomicImage.ts`；id ≥ 220980 的章节图需 offscreen canvas 还原，分段数由 `md5(aid+page)` 末位映射 `[2..20]`。

#### 7.13 皇片 / 肉视频（`electron/shuangkan.ts` / `gohome.ts` / `skPpp.ts`，v0.117~v0.124）
- 主源 `rou07` = `https://rou07.net/v`（短剧 `/series`），站点打不开时读 `https://x99dh.net/` 发布页的 `JTVC…` base64 → JSON，并发探活换镜像（缓存 10 分钟）；4 个内置镜像源 `pornhub / xvid / xhamster / ppp` 共用 `SiteResolver`。
- 播放地址从详情页 `ev:$R[n]={d:"<base64>",k:<数字>}` 解码（每字节减 k）→ `/api/hls/<id>`（`VideoPlayer` 按 `/api/hls/` 判 HLS）；**播放鉴权与翻页规则见第 0 节**。

#### 7.14 直播 / 补丁（`electron/livePlatform/` / `trainers.ts`）
- 直播：源 `data.livePlatformSources`（B站 / 斗鱼 / 抖音），`LivePlayer` m3u8 走 hls.js、flv 走 mpegts.js；抖音 `executeJavaScript` 一律走 `runScript`（6 秒硬超时），`douyinRoom` 40 秒兜底，收藏 `liveFavorites` / 历史 `liveHistory`。
- 补丁：源 `data.trainerSources`（风灵月影 / 3DM / 游民星空 / 游侠网，MegaGames 停用），解压到 `下载目录/修改器/<标题>/`，`installedTrainers` 只存目录信息；收藏 module=`trainer`。

### 8. 已知缺口 / 下一步

1. **安装包签名**：electron-builder 支持 `CSC_LINK` / `CSC_KEY_PASSWORD`，但仓库没有证书，当前产物未签名（无法伪造）。
2. **应用内更新**：仓库已公开，Releases API 可匿名读 exe；API 不可达时回退 Gist 清单直链。
3. **已下载漫画的模块内离线阅读**：图片与 `meta.json` 已落盘，目前只能从下载页用本地应用打开。
4. **Z-Library 首次登录**：需用户在设置里保存一次账密（之后自动静默登录 / 自动填表），站点偶尔要求在窗口内手动验证。
5. **音乐音源**：mvmp3 主源 + 33ve 兜底；无损音乐默认源下线（适配器保留），joox 直链未接（旧收藏按歌名回退）。
6. **账号种子**：安装包把 `.secrets/accounts.json` 作为 `accounts.seed.json` 打进 resources，换机构建需先放种子。
7. **短剧**：红果只公开前几集、河马多数付费锁定（代码保留）；西饭基本全免费；短剧下载 / 收藏已接。

### 9. 每轮收尾约定

- 改完代码先 `npm run typecheck` / `npm run build`，通过后再提交；`npm run dist` 出本机安装包并删旧包。
- 同步更新本文件第 0 节 / 当前进度 / 下一步，必要时更新 README；发版后更新第 0 节「版本状态」与下次版本号，并同步公开 Gist 清单。
- 真实接口改动必须用真实请求或本地 mock 实测；临时脚本一律 `.tmp-*`，用完删除。
- **验证手段（2026-11-11 用户确认）**：除 CDP / curl / esbuild 脚本外，还可调用**内置浏览器自动化**做 UI 实测，按任务需要选用，不必局限于脚本。
- **安全审查（2026-11-11 用户批准优化）**：只在**本次改动新增或修改了安全边界**时跑一次 `TRAE-security-review`——即新增 / 变更 IPC 通道与参数校验、preload 暴露面、凭据 / Cookie 的存取、新的文件写入或路径拼接、`setWindowOpenHandler` / `will-navigate` 外链拦截；只扫本次未提交变更、只报本次引入的可证实风险，同一任务最多跑一次。普通 UI / 样式 / 文案 / 分页与解析逻辑 / 已有接口的小修**不跑**，也不需要在回复里解释。用户明确要求时照常调用。
- **内置技能自动调用（2026-11-11 用户确认）**：`context-mode`（大输出 / 日志用 ctx_execute）、`TRAE-browseruse` / `agent-browser`（浏览器实测）、`TRAE-debugger`（复杂调试）、`ui-ux-pro-max`（UI 设计）；`TRAE-code-review` 仅在用户明确要求审查 MR/PR/commit/差异时调用。已按 2026-11-11 决定禁用 github / superpowers / hyperframes / office / prd / html-report / deep-research / computer-use 等插件与无关技能，不要再引用。
- `git add` 只加源码与文档，确认没有 `out/`、`release/`、`node_modules/` 进版本库；不在手机端仓库提交任何内容。
- **「优化」= 全应用体检（2026-11-02 用户要求）**：用户说「优化 / 整体优化 / 检查一下」按 9 类逐项查，不许只改表面——① 路由 / 返回栈 / 常驻页切页暂停；② 搜索 / 分类 / 详情 / 章节 / 播放的异步竞态（旧响应不得覆盖新状态）；③ 播放器生命周期与 HLS 回退；④ 下载记录与文件一致性、并发锁、特殊文件名、本地读流；⑤ 数据源重复 URL / ID 冲突 / 测试结果持久化；⑥ 导入 / 云恢复 / 坏缓存 / 清单父子环 / 原子写；⑦ IPC 校验、`will-navigate`、外链与 preload 边界；⑧ 缓存登录态隔离 / 缓存自愈 / 更新下载锁；⑨ 响应式卡片、吸顶、空状态与最新 UI 口径。流程：静态审计列问题 → 修可确认 bug → 版本号 +1 → build → CDP 逐页冒烟 → dist → 更新记忆 → 四段式汇报；未说「发版」不得提交或上传 Release。
- **效率要求（2026-11-11 用户反馈「太慢了」）**：① 排障先用最小网络脚本一次定位根因（如「同一 URL 重复请求 vs 带随机参数」对比），不反复重启 UI 试错；② 改完先用 node/CDP 小脚本验证再 `npm run build`；③ CDP 测试脚本参数化复用（按源 id / 卡片索引），不写一次性脚本；④ 随机分流类问题先确认是缓存、粘性还是节点池，再决定锁不锁节点。
- **读取纪律（2026-11-11 用户批准）**：开工只读本文件第 0 节（Read offset 0, limit 140），其余按关键词 Grep 检索；禁止整文件读取本文件与 `project_memory.md`。
- **大文件纪律（2026-11-11 用户批准）**：`src/pages/SourceSettings.tsx`、`electron/main.ts`、`electron/novel.ts`、`electron/downloads.ts`、`electron/trainers.ts` 禁止整文件读取，必须 Grep 定位后 offset / limit 分段读，单次 ≤300 行。
- **日志纪律（2026-11-11 用户批准）**：`npm run build` / `npm run dist` / 测试脚本输出重定向到 `.tmp-*.log`，只读尾部或错误行，不整段灌进上下文。
- **记忆同步净增长为 0（2026-11-11 用户批准）**：只有出现新硬规则或用户新口径时才追加记忆，单次 ≤5 行，且同时删除等量过期内容；不再为「确认记忆内容」单独开一轮会话。
- **最终回复固定结构**：**接入内容 → 验证结果 → 剩余限制 → 安装包**（即使只修一个小 bug 也要按此结构，不省略验证数据）。用户说「四段式」= 立即重读第 0 / 9 节，并按该结构重报本轮结果、补查版本号 +1 / 临时脚本清理 / typecheck·build。

---

# 二、手机端（ShangYin）历史项目记忆

- 原文（约 58,000 字符，含工作纪律 / 硬约束 / 工程约定 / 踩坑）已整体迁至 `docs/archive/MOBILE_HISTORY.md`，**仅供功能口径与踩坑参考，不代表 PC 端已实现**，手机端仓库已冻结。
- 需要参考时按关键词 Grep 该文件，不要整读；**手机端「每轮必 push / 完成即发版」不适用于 PC 端**。
