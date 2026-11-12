# 老郑分享 · 版本流水归档（第 0 节原文）

> 来源：`docs/AI_PROJECT_MEMORY.md` 第 0 节（v0.55 ~ v0.123 详细流水 / 构建发版记录），按原文搬运，未改写技术细节。
> 当前状态与生效规则以主文件第 0 节为准；本文件只用于追溯历史实现。

## v0.123

- **2026-11-11 v0.123（未发版）爽看收尾：P站真实末页 / PPP 搜索翻页 / X站搜索提示**：① P站移动版分页条只渲染第 1~9 页，`psite.ts` 的 `pList` 现在从页面内嵌 `"resultsCount":N`（兼容 `VIDEO_FILTER_resultsCount=N`）反推真实末页：第 1 页 30 条、第 2 页起实测 42 条，`pages = 1 + ceil((N-30)/42)`；搜索镜像最多只给到第 100 页（101 起 404）、分类实测 ~451 页仍可用，分别封顶 100 / 451；`PListResponse` 新增 `totalPages`，`hasMore` 以真实末页为准，`尾页` 不再只到 9（分类页 451 的 next 链接会给出 452，属正常最后一页）。② PPP 搜索分页是 KVS AJAX：`?page=N` 被忽略、`/search/<kw>/N/` 404，改为 `...&mode=async&function=get_block&block_id=list_videos_videos_list_search_result&q=<kw>&category_ids=&sort_by=&from_videos=N&from_albums=N`（两个参数必须分开传，不能用 `from_videos+from_albums`）；实测「人妻」p1/p2/p3 各 24 条互不重复、`lastPage` 53。③ X站镜像会把搜索请求当首页返回：`xvidSearch` 改为标题不含关键词就直接报「该源不支持搜索，请改用分类浏览」（原来只在有结果时判断，空列表会误显示「没找到」）。④ 实测：esbuild + electron-stub 跑真实适配器——P站搜索 p1 `last=100`、p100 42 条 `last=100`，分类 p1 `last=451`、p451 58 条；PPP 三页不重复；`npm run typecheck` / `npm run build` / `npm run dist` 通过，本机安装包 `release\老郑分享 Setup 0.123.exe`（108,129,864 字节）。剩余：本轮改的是主进程代码，用户必须**重启应用**才会加载；P站第 100 页 / 分类第 451 页之后镜像本身 404，应用侧无解。

## v0.122

- **2026-11-11 v0.122 第二轮（未发版）爽看播放复核：第一个源随机分流被 302 缓存锁死 / 第五个源过期令牌**：① 第一个源「偶发播放失败」的根因是网关 `/api/hls/<id>` 的 302 **被 Chromium 缓存**——hls.js 的 6 次重试全部回到同一个边缘节点，节点坏了就整段播不了（网络层每次 fetch 重新分流，所以之前只测网络看不出）。修复：`VideoPlayer` 给 hls.js 加 `xhrSetup`，只对 `/api/hls/` 的 URL 追加一次性随机参数再 `xhr.open`，让每次请求（含 hls.js 自己的重试）都重新分流；`main.ts` 对伪装成 `index.png` 的清单补 `Accept: */*`（部分节点按图片给 206）。② 「过期的视频没必要显示」：第五个源详情页会被站点 CDN 缓存约 3 小时，缓存页里的 `var stream` 令牌（约 3 小时有效）往往已过期；修复：`skPpp.ts` 的 `pppDetail` 改用 `freshPath()`（`/v/<id>/?t=<随机>`）强制回源拿新令牌，原来的「时间戳判断 + 410/403 探活」兜底保留（真正删掉的视频仍会明确提示，不静默播提示片）。③ 实测（独立 user-data-dir + CDP 真实 UI 播放）：第一个源播放到 39 秒 / 总长 1176 秒（修复前必现 206 + `duration:null` 播放失败）；第二个源 271 秒 / 728 秒 1080P；第五个源此前必现「播放权限已失效」的老视频现在播放到 111 秒 / 1776 秒；`npm run typecheck` / `npm run build` / `npm run dist` 通过，本机安装包 `release\老郑分享 Setup 0.122.exe`（108,127,142 字节）。剩余：第三个源仍是站点侧整体故障（镜像 500 / DNS 失败 / 导航站 500），应用侧无解；第四个源按用户要求本轮不动。

- **2026-11-11 v0.122（未发版）爽看播放专项修复（用户 4 反馈）**：① 片源管理状态显示「未测试」：v0.121 只继承了预设 testStatus，testMsg 仍为 null，状态点绿但文字还是「未测试」——`normalizeShuangkanSources` 现在在「testMsg 为空且继承后的状态与预设一致」时一并借用预设文案「可用」。② 肉视频播放失败（v0.121 回归）：实测 rou07 的 `/api/hls` 网关按 **UA 粘性分流**到 `jre*.vc*.top/.sbs/.mom` 等边缘节点，节点池随机且部分节点长时间 502/401（同 UA 连续 8~10 次全 502，几分钟后又换节点；GO_UA 桌面 UA / VOD_UA 移动 UA 命中好坏节点完全看时段），v0.121 注入 GO_UA 放大了失败率——`SiteResolver` 新增 `mediaAuth` 开关（默认 true），rou07 置 false 不登记站点鉴权；同时 `gohome.ts` 新增 `pickSkMediaUa`（3 个候选 UA 并行探测 playUrl，取 200+`#EXTM3U` 的那个）+ `noteShuangkanMediaAuth`（只登记 `{ua}`，不注入 Cookie/Referer），rou07 的 `shuangkanDetail`（video）/ `shuangkanPlay` 在返回前探测并登记可用 UA，渲染层沿用同一 UA 打到活节点；探测失败回落渲染层原生 UA。③ P站 / ppp / xvid「还有 5 秒提示片」根因升级：**CDN 网关对每个请求都做鉴权检查**——master / variant / 分片 / AES key 任何一个裸 UA 都只回 `player.centercdn.top/tip.ts`（143 字节假清单）或假 key，v0.121 只登记站点主域不够（重定向后的网关域名 `jre*.vc*` 无登记）；且 P站适配器走 psite.ts 裸 fetch 从未登记过。修复：`gohome.ts` 的 `skMediaHosts` 改存完整 `{referer, cookie, ua}`，新增 `noteShuangkanMediaRedirect(fromUrl, redirectUrl)`，`main.ts` `setupRequestRules` 加 `onBeforeRedirect` 把重定向目标域名继承同一份鉴权登记上；psite.ts `getHtml` 成功后 `noteShuangkanMediaBase(site.base)` 登记 P站主域；`applyRequestHeaders` 的 skMedia 只对非 image 资源生效（避免抢同域封面的 Referer 规则），Cookie/Referer/UA 按字段可选注入。④ 播放器加固：`VideoPlayer` hls.js 增加 `manifestLoadingMaxRetry:6 / levelLoadingMaxRetry:6 / fragLoadingMaxRetry:8` 等重试参数（网关随机坏节点时自动重试绕开）；新增 `LEVEL_LOADED` 监听，首分片 URL 含 `/tip.` 时直接 fail 报「站点风控拦截了播放（返回提示片）」，不再静默播提示片。⑤ 实测（esbuild + electron-stub 模拟逐跳鉴权）：xvid / ppp / pornhub 全链路 master→variant→分片→AES key 全部 200（分片 MPEG-TS `47 40 …` 正常、key 二进制正常、无 tip）；rou07 探测登记 UA 后 m3u8 200 + 分片 206 二进制正常；typecheck / build / dist 通过，本机安装包 `release\老郑分享 Setup 0.122.exe`。剩余限制：rou07 网关节点质量仍受站点端波动影响（探测 + 6 次重试已最大化兜底）；X站「加载失败」为瞬时故障，实测列表正常（48 条），未复现。

## 其他记录（规则 / 发版 / 安装包）

- **效率要求（2026-11-11 用户反馈「太慢了」）**：① 排障先用最小网络脚本一次定位根因（如「同一 URL 重复请求 vs 带随机参数」对比），不要反复重启 UI 试错；② 改完先用 node/CDP 小脚本验证再 `npm run build`，避免多轮 build + 重启；③ CDP 测试脚本参数化复用（按源 id / 卡片索引），不写一次性脚本；④ 随机分流类问题先确认是缓存、粘性还是节点池问题，再决定锁不锁节点，不凭感觉反复改。

- **⛔ 开工纪律（2026-11-11 用户强调，最高优先级）**：最近多轮任务出现遗漏，今后每一轮任务必须做到——① 开工先完整阅读本记忆文件（第 0 节 + 一、工程约定各节）与记忆系统 project_memory，并跑一次 `git status`；② 执行中严格按记忆里已有的全部规则约束走（版本号先 +1、新功能带缓存 / 导入导出 / 云同步、各模块口径、发版需用户明说等），不得凭印象省略；③ 收尾必须按「接入内容 → 验证结果 → 剩余限制 → 安装包链接」四段输出，并附真实验证数据，不得只回一句「已修复」；④ 每轮结束同步把本轮结果追加到本文件第 0 节与记忆系统 project_memory（两份都要更），并把本轮新经验 / 新踩坑 / 用户新口径**主动提炼成规则写进记忆，不用等用户要求**；**平时一律不 commit / push，代码与记忆改动都留在本地**——等用户明确说「发版」时，才连同代码与本记忆文件一起 push 并更新仓库（2026-11-11 用户明确：本项目以 PC 端开发为主，手机端（ShangYin）与 PC 端流程不同——手机端历史记忆里「每轮必 push / 完成即发版」只是 ShangYin 自己的旧流程，对 PC 端一律不适用）。任何一步都不得漏。

## v0.121

- **2026-11-11 v0.121（未发版）爽看 4 新源收口：分类铺开 / 翻页 / 5 秒提示片 / X站 500 / 清晰度选择**：① 片源管理：`DEFAULT_SHUANGKAN_SOURCES` 的 4 个新源改为默认 `testStatus:'ok'`（对齐 rou07），`normalizeShuangkanSources` 对「从未手动测试（testStatus=null）」的内置源继承预设状态（用户手动测出的 bad 保留）。② 分类 UI：4 个镜像源分类直接铺成 chip（`.toolbar` 里 `.chip` + `chip-count`，首项「全部」），不再用下拉；rou07 仍用两级下拉。③ 翻页修复：镜像忽略 `?page=` 查询参数——ppp（KVS）必须走路径分页，`pathOf` 改 `/new/N/` 与 `/categories/<slug>/N/`、搜索 `/search/<kw>/N/`；ppp 分类改从 `/categories/` 独立页解析（`.card-cat-v2__link`，文本形如「8943 影片 中国AV」，剥数量，缓存 30 分钟，实测 33 个），列表页已经没有分类链接。④ xvid 首页新链接格式 `/video.<id>/<num>/<num>/<slug>`：`itemIdOf` 改取路径末段为 slug（详情 `/video.<id>/<slug>` 站点会 302 到正确页）。⑤ **5 秒提示片根因**：渲染层播放请求（hls.js XHR / media）只有 VOD_UA，不带站点 Cookie / Referer 时，镜像的 `jmpres` 播放流直接返回 `player.centercdn.top/tip.ts`（约 10 秒提示片）；带 `x-index-auth=authed`（P站加年龄 Cookie）+ 站点 Referer 则返回完整多码率流。实现：`gohome.ts` 新增 `noteShuangkanMediaBase`（requestSite 每次成功后登记站点域名）/ `shuangkanMediaAuth`，`main.ts` 的 `applyRequestHeaders` 对登记域名补 `Referer` + `Cookie`（GO_COOKIE / GO_PH_COOKIE 按域名）+ GO_UA；rou07 / xhcdn（xhamster 的流在 xhcdn 上，不校验）一并兼容。⑥ X站 500 无恢复策略：`requestSite` 兜底——探活只测 `/status.html` 防不住「探活 ok 但内容页 500」，前 3 步（preferred / resolve / resolve(true)）全失败后，把 x99dh 的同站线路用真实路径逐个实测（最多 8 条）取第一个成功的；`ShuangkanPage` 列表 / 详情请求成功后把 `testStatus:'bad'` 的源自动改回 ok（toast「已恢复可用」）。⑦ `VideoPlayer` 清晰度选择：`MANIFEST_PARSED` 收集 levels（按高度降序，过滤 0 高度），默认锁定最高档（`hls.currentLevel = best.index`，不降档），播放器右上角 `.player-quality` 下拉「自动 + 各档 Np」，仅多码率 HLS 显示；切源自动重置。⑧ 实测：node 侧 A/B 证明浏览器级头拿全片、裸 UA 只拿 tip.ts；esbuild + electron-stub 端到端跑真实适配器——ppp p1/p2 0 重复、分类 33、taiwan 分类翻页 0 重复、详情 playUrl OK；xvid p1 48 / p2 27 0 重复、lastPage 恢复真实值（1000）、38 分类、playUrl OK；xhamster 46 条 / 60 分类 / 翻页 / playUrl OK；`npm run typecheck` / `npm run build` 通过。

## v0.120

- **2026-11-10 v0.120（未发版）爽看内置 4 个新源 + 统一 x99dh 换址**：① 新增 4 个片源适配器 `pornhub / xvid / xhamster / ppp`（共享类型 `src/shared/shuangkan.ts` 的 `DEFAULT_SHUANGKAN_SOURCES`，默认启用；内置源不可删除，缺失时 `normalizeShuangkanSources` 会补回，可停用 / 改名 / 改地址），爽看页搜索框前直接切换源（不做「全部源」合并，各站结构不同），分类来自各站首页：Pornhub 67 / XVIDEOS 38 / xhamster 60 / 亚洲素人精选 11；② 主进程新增 `electron/gohome.ts` 公共 `SiteResolver`：`/status.html` 探活 + x99dh 优选访问 `JTVC…` 载荷解码（base64 → URL 解码 → JSON）+ 同站线路并发探活 + 10 分钟缓存；片源管理里的 `baseUrl` 优先，失败自动换同站线路，5 个适配器（含 rou07）共用；③ 解析口径：Pornhub 手机页 `li[data-video-vkey]` + `/video?c=<id>&page=N`、播放 `/jmpres/` 302；XVIDEOS `div.thumb-block` + `/video.<id>/`、分类 `/c/<slug>`、播放 `/jmpres/`；xhamster `div.thumb-list__item` + `/videos/<slug>-<id>`、搜索 `/search/<kw>`、播放 `/jmpres/`；亚洲素人精选 KVS `div.card-video` + `/videos/<id>/`、分类 `/category/<slug>`、搜索 `/search/<kw>`、播放 `/get_file/`；④ 实测（本机直连）：5 个源 `/status.html` 均返回 ok，列表 26 / 31~58 / 48 / 46~63 / 61 条，分类 6 / 67 / 38 / 60 / 11，各取首条详情均解析出 playUrl，且 playUrl 实测 200 `application/vnd.apple.mpegurl`、正文含 `#EXTM3U`（不带 Referer 也能取流）；故障注入 `https://127.0.0.1:9` 后 4 个新源都自动回落默认线路；分页实测 Pornhub 第 2 / 3 页 43 / 43 条；⑤ XVIDEOS 镜像会把带 `?k=` 的请求当首页返回（搜索被忽略），`xvidSearch` 检测标题不含关键词时返回「当前镜像不支持搜索，请改用分类浏览」；⑥ `detail` 封面补 `trackShuangkanImages`，直接打开收藏详情也能带 Referer 加载封面；⑦ typecheck / build 通过。

## v0.119

- **2026-11-10 v0.119（未发版）修复爽看一级分类只剩「全部分类」**：根因是 `App.openNav` 点侧栏时会把 `navEpoch[key]+1` 传给页面的 `resetSignal`，而 `ShuangkanPage` 的重置 effect 里 `requestSeq.current += 1` + `setLoading(false)` 会在首屏加载还没返回时把这次响应丢弃（旧缓存有列表所以以前没暴露，v3 新缓存首次必须请求才出现）。修复：重置 effect 只清理详情 / 播放状态（`detailSeq++`），不再打断列表请求；同时首屏缓存只在「列表和分类都有」时才直接复用，缺分类会重新拉一次补全下拉。验证：用独立 `--user-data-dir` + `--remote-debugging-port` 启动 `electron .`，CDP 实测首屏一级分类 6 项、选「日本」后二级出现 `fc2 ppv (1,970)` / `my amateur-z (53)`、选二级后正常出 26 条内容。

## v0.118

- **2026-11-10 v0.118（未发版）爽看收口 4 项**：① 片源管理「爽看源」去掉源名后的「· 内置」，补齐「批量导入 / 导出」，与其它源一致；新增 IPC `shuangkan:exportSources`（JSON 与短剧源同格式，可互相导入），导入走通用 `ImportModal` + `parseSourceImport`，按 `baseUrl` 去重，新源 `testStatus=null`。② 爽看页移除「短剧库」下拉，列表 / 搜索固定视频库 `/v`；详情仍能打开旧收藏里的短剧记录。③ 分类改两级下拉：一级 = `/v` 首页返回的 6 个固定分类（自拍流出 / 國產AV / 探花 / 日本 / 麻豆傳媒 / OnlyFans），二级 = 选中一级后站点额外返回的 `/t/` 标签（日本 → fc2 ppv 1,970 / my amateur-z 53；國產AV → 糖心Vlog …），请求取「二级优先」，搜索时保留两级选择；`electron/shuangkan.ts` 的 `parseCategories` 视频分支从 `<span class="text-dim">` 取数量并从标签名剥离（否则下拉会显示「fc2 ppv1,970」），数量显示在二级下拉。④ 切换分类去掉工具栏「加载中…」，改为与其它模块一致的 `LoadingBlock`「正在切换，请稍等…」，首屏仍是「正在加载爽看…」。⑤ 渲染层缓存 key 升到 `shuangkan_v3_*`、主进程 `cachedResponse` key 升到 `shuangkan:v3:*`（旧缓存里分类名带数量）。验证：`npm run typecheck` / `npm run build` 通过；curl 实测 `/t/日本` 返回 6 个一级分类 + fc2 ppv / my amateur-z 两个二级标签。

## v0.117

- **2026-11-10 v0.117（未发版）爽看模块 + 肉视频短剧源**：① 侧栏「番号」之后新增「爽看」（key `shuangkan`，不做「外网」小字），页面只做 `https://rou07.net/v` 视频库：分类 `/t/<tag>`、分页、详情、HLS 播放，列表首页写 localStorage `shuangkan_video`，封面 CDN 由主进程补站点 Referer + 浏览器 UA。② 短剧模块新增内置源「肉视频短剧」（`id=rou07`，`https://rou07.net`，默认启用，老数据在保留西饭时自动补一次），接 `/series` 短剧库：分类 `/series?tag=`、分页、`/s/<id>` 详情与选集、分集播放 `/v/<id>`；搜索走 `/search?q=&tab=series`（站点只有一页结果）。③ 主进程 `electron/shuangkan.ts`：`/status.html` 探活；站点打不开时读 `x99dh.net` 发布页 `JTVC[A-Za-z0-9+/=]{80,}` → base64 → URL 解码 → JSON，取「肉视频」的 `url / urls[]` 并发探活换镜像，缓存 10 分钟；播放地址从详情页 `ev:$R[n]={d:"<base64>",k:<数字>}` 解码（每字节减 k 得 JSON `videoUrl`），指向 `/api/hls/<id>`（m3u8 无后缀，`VideoPlayer` 已按 `/api/hls/` 判定 HLS）。④ 短剧数据映射在 `electron/drama.ts` 的 `rou07Catalog / rou07Detail / rou07Play`，`DramaPage` 的 `inputFor / available / 收藏恢复` 改用 `isBuiltinDramaSource`。实测：视频列表 26 条 / 1494 页；短剧列表 26 条 / 55 页，分类带数量；详情 11 集；播放地址 HTTP 200；搜索「逆天」10 条；故障注入后经 x99dh 换到 `https://rou07.com` 正常返回；typecheck / build 通过。

## v0.116

- **2026-11-10 v0.116（未发版）禁漫分类数量 + 去掉外网字样**：① 禁漫天堂漫画页分类 chip 带数量：站点分类页不返回总数，`jmcomicCategoryCounts`（`electron/jmcomic.ts`）先取分类第一页，从分页块（含手机端 `<select>` 的全量页码）拿末页页码，再取末页条目数，按 `(lastPage - 1) * 80 + 末页条数` 折算；6 个分类 3 并发，模块内与 IPC `jmcomic:categoryCounts` 各缓存 24 小时，单个分类失败只标记 -1。实测韩漫 2089；同人 / 单本 / 短篇 / English Manga / 其他类被站点分页封顶 125 页（10000 条），显示 10000。冷启动约 10 秒（后台加载，不阻塞列表），命中缓存立即显示。② 漫画源下拉去掉禁漫天堂后面的「（外网）」小字，只有 Komiic 保留。③ 约定：以后新增或维护带分类的源，都尽量给分类 chip 显示数量（`categoryCounts` + `chip-count`）。

## v0.115

- **2026-11-10 v0.115（未发版）禁漫天堂（18comic66.com）漫画源**：新增漫画源模板 `jmcomic`，默认源「禁漫天堂」（`id=jmcomic`，`https://18comic66.com`，入口页 `/enter`），排在头牌漫画之后，片源管理可增删改 / 批量导入 / 整体测试 / 导出 / 启停；漫画 ID 前缀 `jm:`（镜像源 `jm_<sourceId>:`，只认 `/^jm([_A-Za-z0-9]*):/`，避免误判漫画客 slug），章节 ID 保留原始数字。主进程 `electron/jmcomic.ts` 解析服务端 HTML：最近 `/albums?o=mr&page=N`、热门 `/albums?o=mv&page=N`、分类 `/albums/<slug>?page=N`（6 个：hanman / doujin / single / short / meiman / another）、搜索 `/search/photos?search_query=<kw>&page=N`，每页 80 条，末页从 `.pagination` 的 `page=N` 取最大；详情 `/album/<id>` 读 `#book-name` 标题、`#album_photo_cover img` 封面、`#intro-block` 作者 / 标签 / 「敘述：」简介、`#episode-block .episode a[href*="/photo/"]` 全量目录；章节图读 `/photo/<chapterId>` 的 `.scramble-page img[data-original]`（兜底 `img[id^="album_photo_"]`）。**章节图还原**见 `electron/jmcomicImage.ts`：id ≥ 220980 的图按纵向分段倒序存，分段数 = `md5(String(aid)+String(page))` 末位 charCode 映射 `[2,4,6,8,10,12,14,16,18,20]`（268850~421925 取 `%10`，≥421926 取 `%8`），用隐藏 offscreen BrowserWindow + canvas 逐段重排（`nativeImage` 不解码 webp），导出 JPEG；并发 3、25 秒超时，`imageCache` 与漫画批量下载共用。**换址**：先用 `/status.html` 文本 `ok` + `/enter` 验签探活，首次 `warmUpCookies`；站点打不开时读发布页 `https://x99dh.net/`（允许 HTTP 500，只取正文），正则抓 `JTVC[A-Za-z0-9+/=]{80,}` → base64 → `decodeURIComponent` → JSON，找 `name` 含「禁漫」的条目，合并 `entry.url` 与 `entry.urls[].url` 后最多 30 条并发探活，取第一条可用线路，缓存 10 分钟，请求中途断线强制重解析重试一次。IPC `jmcomic:recent/hot/category/search/detail/chapters/images`（列表 15 分钟、搜索 30 分钟、详情 12 小时磁盘缓存），`comic:testSource` 支持 `jmcomic`；前端 `ComicPage` 增加 jm 分支与 `comic.jmcomic` 列表缓存，收藏 / 进度 / 下载走 `jm:` / `jm_<源>:` 前缀，老数据由 `config.jmcomicComicSeeded` 一次性补源。实测：最近 80 条（末页 125）、热门 80、韩漫分类 80、搜索「test」42 条、第 2 页 80；详情 11 章、章节图 264 张；还原 `descramble bytes=33514 -> 78194 ms=314 jpeg=true`；故障注入 `https://dead.invalid` 18.6 秒经 x99dh 优选线路返回 80 条；typecheck / build 通过。

## v0.114

- **2026-11-10 v0.114（未发版）头牌漫画分类数量**：站点分类页不返回总数，分页只显示当前页附近的 5 个页码；新增 `tptoonComicCategoryCounts`（`electron/tptoon.ts`），每个分类用二分探到最后一页（`low` 已知有效、`high` 探到 404 / 空页），按 `(lastPage - 1) * 30 + 末页条数` 折算；7 个分类 4 并发，主进程 `tptoon:categoryCounts` 磁盘缓存 24 小时（模块内也缓存 24 小时）。漫画页对 `tptoon` 拉取分类数量并用 `chip-count` 显示。实测：韩漫 5833 / 日漫 18943 / 3D 2042 / 同人誌 24264 / 单行本 2783 / 短篇 6708 / 其他 24606，与逐页探测的末页一致；首次统计约 36 秒（不阻塞列表，数字出来后才显示），之后命中缓存立即显示。本机安装包 `release\老郑分享 Setup 0.114.exe`。

## v0.113

- **2026-11-10 v0.113（未发版）头牌漫画（tptoon.net）漫画源**：新增漫画源模板 `tptoon`，默认源「头牌漫画」（`id=tptoon`，`https://tptoon.net`），排在哔咔之后，可在片源管理里增删改 / 批量导入 / 整体测试 / 导出 / 启停；漫画 ID 前缀 `tpt:`（镜像源用 `tpt_<sourceId>:`），收藏 / 阅读进度按前缀回到源。主进程 `electron/tptoon.ts` 解析静态 HTML：最近 `/update/`、热门 `/ranking/`，分类 7 个（hanman / riman / 3d / doujin / single / short / other），翻页 `/index_N.html`；详情 `/book/<id>.html` 取标题 / 封面 / 作者 / 分类 / 简介 / 全量目录；章节图取 `/chapter/<id>.html` 里的 `data-original`，一章多页用 `_1`、`_2` 继续拼；少数书目录走 `/cchapter/`，章节 ID 用 `c<数字>` 记住路径。搜索走 EmpireCMS 的 `POST /e/search/index.php`（`show=title&keyboard=`，UTF-8），成功后从分页链接认 `/so/<id>.html`，一次最多 10 页（20 条/页），前端按 24 条/页分页。站点打不开时读 `https://tpmh8.cc/` 地址发布页，筛出头牌系域名并发探活，探活用 `/update/` 页面（站点签名 + 列表项），结果缓存 10 分钟。CDP 实测：最近 / 热门 / 韩漫各 30 条、韩漫尾页 195 页 13 条、搜索「姐姐」60 条 3 页、详情 25 章 / 单章 65 图、`/cchapter/` 单章 24 图、收藏回源正常；故障注入（`https://tptoon.invalid`）约 13 秒切到可用线路，最近 / 详情 / 搜索均恢复；本机安装包 `release\老郑分享 Setup 0.113.exe`。

## v0.112

- **2026-11-10 v0.112（未发版）哔咔漫画搜索前端分页**：哔咔搜索会一次拉全量（实测「姐姐」128 条），之前漫画页一次性铺满所有卡片；现在 `ComicPage` 对 `template === 'bikahub'` 的搜索结果按 24 条/页做前端分页（`COMIC_SEARCH_PAGE_SIZE` / `searchPage` / `safeSearchPage`），标题显示「搜索结果：xx（N 条）」，底部 Pagination 显示真实总页数；漫画客 / Komiic 搜索仍走原来的服务端分页，不改动。CDP 实测：哔咔搜「姐姐」24 条/页、共 6 页，第 2 页首条变化；本机安装包 `release\老郑分享 Setup 0.112.exe`。

## v0.111

- **2026-11-10 v0.111（未发版）哔咔分类数量 + 全量搜索**：① 哔咔漫画页去掉「热门」chip（模板 `bikahub` 只保留「最近」+ 分类）；② 哔咔漫画 / 小说分类带数量：主进程 `bikahubComicCategoryCounts` / `bikahubNovelCategoryCounts` 并发 4 逐个取分类第一页 payload 的 `total`（漫画 20 个、小说 9 个），内存 + `cachedResponse` 各缓存 10 分钟；IPC `bikahub:categoryCounts`、`novel:categoryCounts`，漫画 / 小说页分类 chip 用 `chip-count` 显示；③ 小说分类分页补全：`NovelListResponse` 增加 `total / totalPages`，哔咔分类页返回 payload 的 `total` / `totalPages`，小说页 `categoryTotalPages` 直接驱动 Pagination（都市分类实测「共 563 页」并可翻页）；④ 修复搜索结果只有首批 15~16 条：改走站点 API `GET /api/v1/search?keyword=<kw>&type=novel|comic&page=N&pageSize=100`，逐页取到空页为止（最多 6 页）并按 id 去重；API 的 id 是数字、列表 payload 的 id 是字符串，新增 `idText` 统一（这是上一版搜索为空的原因）；`serialStatus` 1=已完结 / 2=连载中；`novel:search` / `bikahub:search` 缓存 key 升到 `v3`；实测「姐姐」小说 109 条（小说页 5 页可翻）、漫画 128 条（漫画页一次显示全部），分类数量漫画 日漫 3850 / 同人 913 …，小说 都市 13500 / 校园 263 / 玄幻 214 …；逐页 0 未捕获异常；本机安装包 `release\老郑分享 Setup 0.111.exe`。

## v0.110

- **2026-11-10 v0.110（未发版）硬件改名 + 哔咔小说 / 漫画源**：① 默认页「电脑信息」全应用改名为「硬件」（`App.tsx` 的 `HOME_NAV_ITEM`、品牌按钮 aria / title、`SysInfoPage` 标题与错误提示、`shared/sysinfo.ts` 注释；模块 key 仍是 `sysinfo`）。② 新增小说源模板 `bikahub`（哔咔小说 `https://bikahub.net`，默认源 `id=bikahub`，老数据由 `config.bikahubNovelSeeded` 首次补一次，删空不补回）与漫画源模板 `bikahub`（哔咔漫画，默认源追加在漫画客 / Komiic 之后，老数据由 `config.bikahubComicSeeded` 补一次）；小说 / 漫画的分类分别是站点 `/novel` 的 9 个与 `/comic` 的 20 个标签。③ 主进程新增 `electron/bikahub.ts`：站点是 Nuxt SSR，直接解析页面 `__NUXT_DATA__`（自写 devalue 解码，支持 ShallowReactive / Reactive / Date / Set / 引用），列表用 `novel-list-page` / `comic-list`（带 totalPages），搜索用 `/search?q=<kw>&type=novel|comic` 的 `search-page.novels/comics`，详情用 `novel-detail-<id>.item`（含全量 chapters）与 `comic-detail-<id>.detail`（含全量 chapters + routeParam），小说正文读 `/novel/read/<id>/<order>` 的 `.novel-reader-pc-copy p`，漫画章节图读 `/reader/<id>/<order>` payload 的 `detail.pages[].src`。④ 防失联：请求失败 / 5xx / 429 时读 `/go-home` 的「国内可用地址」`p[title]` 与「永久访问地址」`strong`，按顺序探活后自动切镜像；依次尝试源地址、bikahub.net、bikago.net、mlaridyo.cc、7ed43.dojqybrcm.com 的 go-home，解析结果按源地址缓存 10 分钟，请求中途断线会强制重解析重试一次。⑤ 哔咔图床（`pic.drleao.cn` 等）返回的是 AES-CBC 变体加密字节：新增 `electron/bikahubImage.ts`，按站点前端 image-transfer.worker 同款算法（key `f5d965df75336270` / iv `97b60394abc2fbe1`，密文末 16 字节作临时 IV 生成补齐块）解密；`imageCache` 在嗅探不到图片格式时先解密再落盘，漫画批量下载同样先解密再写文件。⑥ 漫画页 `ComicPage` 全部按 `template` 三分支（komiic / yumanhua / bikahub），新增 `comic.bikahub` 列表缓存（含 lastPage）、哔咔分类、分页（`/comic/page/N`、`/comic/category/<slug>/page/N`），收藏 / 阅读进度 / 下载走 `bkh:` 前缀；`ComicSource` 增加 `bikahub`，下载放行与来源名同步。⑦ 片源管理漫画源模板下拉 / 批量导入 / 整体导入支持 `bikahub`，小说源模板下拉自动包含「哔咔小说（bikahub）」，全部源整体导入导出与云同步 / 备份自动带上两个字段。验证：typecheck / build / dist 通过；独立 user-data-dir + CDP：默认页标题「硬件」、小说下拉出现「哔咔小说」且推荐 24 本 / 分类 24 本可翻页 / 搜索 16 条 / 详情 184 章 / 第 184 章正文 5821 字；漫画下拉「哔咔漫画」、列表 24 部且分页「共 200 页」、第 2 页内容变化、分类日漫 161 页、详情 167 章、章节图 36 张全部解密加载（1280×1810 / 1414×2000）、封面 577px、批量下载 2 张落地为 PNG（89 50 4e 47）后已清理测试目录；`bikahub.invalid` 实测经 go-home 自动换镜像返回 24 部 / 200 页；逐页导航 0 未捕获异常 / 0 console error；本机安装包 `release\老郑分享 Setup 0.110.exe`。

## v0.109

- **2026-11-09 v0.109（已发版）数据导入导出 / 缓存专项检查**：① 修复「片源管理 → 全部源整体导出 / 整体导入」漏掉漫画源：主进程 `sources:exportAll` / `sources:importAll` 事务里补上 `comicSources`（校验模板 `yumanhua` / `komiic`，导出 count 与「没有可导入的源」判断同步包含），此前渲染层虽然传了漫画源，主进程会静默丢弃，导入端也永远读不到。② 修复备份导出 → 导入后根清单在「加入清单 / 搜索结果加入清单」里消失：导出给手机端时 `stripNullFields` 会去掉根清单的 `parentId: null`，而 `CollectAction` / `SearchPage` 用 `parentId === null` 严格比较；`normalizeData` 新增 `normalizeLists`，导入 / 启动时把非数字 parentId 统一补回 `null` 并过滤非对象坏条目。③ 更换缓存目录改为「先在新目录建好 image-cache / api-cache，再清旧目录并切换」，新目录不可写时不会先清掉旧缓存；选择当前目录则为无操作。④ 导入备份 / 云恢复时清空各模块 localStorage 列表缓存（旧源列表不再残留），并广播 `laozheng:nav-order`，侧栏导航顺序立即生效，不用重启；片源管理整体导入成功后也清一次模块缓存。⑤ 版本号 0.109。验证：typecheck / build / dist 通过；独立 user-data-dir + CDP 逐页冒烟 18 个页面 0 未捕获异常 / 0 console error；壁纸标题刷新回到 `bizhimi / pc / 34`；`cacheInfo` 25MB → `clearCache` freed 25MB；完整备份 stripNullFields → normalizeData 往返（457 条目 / 63 清单 / 39 片源 / 2 漫画源 / 2 壁纸源）数量一致、根清单 3 个不变；本机安装包 `release\老郑分享 Setup 0.109.exe`。**发版记录（2026-11-09）**：commit `42cae95` / tag `v0.109` / Release https://github.com/Bug142857/LaoZheng/releases/tag/v0.109（id `438932061`）/ Actions run `42592819974` 构建并上传 `LaoZheng-0.109-Setup.exe`（108,100,148 字节，sha256 `23b19fbc3479a6080b4acbadd639571f8dab431e3a2629f9778ceab914281a81`）；公开 Gist `update.json` 已同步 0.109，直连与 gh-proxy 实测均读到新版本。

## v0.108

- **2026-11-09 v0.108（未发版）壁纸标题刷新回默认页**：点壁纸页标题「壁纸」现在会清掉渲染层壁纸缓存 `wallpaper2` 再重新挂载，真正回到默认页（壁纸迷 · 电脑壁纸 · 全部），不再恢复上次看的源 / 设备 / 分类；侧栏进入壁纸仍保留上次浏览现场。CDP 实测：切到 Wallspic · 手机 · 品牌后点标题，源 / 设备 / 分类恢复为 bizhimi / pc / 34，列表重新加载，无未捕获异常。

## v0.107

- **2026-11-09 v0.107（未发版）壁纸源顺序 + 手机分类数量**：① 默认壁纸源改为壁纸迷，`DEFAULT_WALLPAPER_SOURCES` 与片源管理/壁纸页源下拉顺序都变成「壁纸迷 → Wallspic」；`normalizeWallpaperSources` 会把老数据里 Wallspic 在前的顺序调换；渲染层壁纸缓存 key 从 `wallpaper` 升到 `wallpaper2`，升级后首次进入默认落壁纸迷；② 壁纸迷手机标签分类补数量：解析 `.archive-tags a.bc-tag` 的 `data-tag-id`，用 WordPress REST `/wp-json/wp/v2/posts?categories=5626&tags=<id>&per_page=1` 的 `X-WP-Total` 取准确数量（并发 4，失败则隐藏该数量），分类缓存 key 升到 `wallpaper:categories:v5`。CDP 实测：默认源 `bizhimi`、源下拉 / 片源管理顺序均为壁纸迷在前；手机分类 21 个带数量（全部 13,355 / 单人 4,663 / 天空 2,917 / 长发 1,955 / 自然 430 …），列表与分页正常，无未捕获异常。

## v0.106

- **2026-11-09 v0.106（未发版）导航 / 壁纸 / 下载反馈**：① 片源管理「整体导入 / 整体导出」从头右上角改为左上角；② 取消「老郑分享 / 老郑优化」双导航切换，只保留一套导航；电脑信息不再出现在导航里，应用默认页 = 电脑信息，点侧栏顶部「老郑分享」进入；③ 壁纸在导航里移到漫画上面；④ 壁纸缩略图加载失败的卡片直接不显示（不再显示「图片已失效」占位），整页都失效时给空状态，预览图失败会提示并退出；⑤ 壁纸迷手机分类改为站点手机壁纸页的「标签」区（全部 + 单人 / 天空 / 长发 / 云朵 / 手机壁纸 / 树木 / 山 / 白天 / 自然 / 水 / 蓝天 / 花朵 / 女孩 / 珠宝 / 衬衫 / 日落 / 动物 / 景色 / 森林 20 个），列表 URL `/wallpaper/mobile-wallpaper?tag=<slug>`、翻页 `/wallpaper/mobile-wallpaper/page/N?tag=<slug>`；分类缓存 key 升到 `wallpaper:categories:v4`；⑥ 下载管理 → 壁纸新增「设为壁纸」按钮：主进程校验下载记录 / 文件 / 图片格式，webp / avif / gif 先用 `nativeImage` 转 jpg，再通过 PowerShell P/Invoke `SystemParametersInfo` 设为 Windows 桌面壁纸（填充模式）。CDP 实测：默认页电脑信息、导航无电脑信息、品牌点击回首页、壁纸在漫画上方、片源管理按钮左对齐、壁纸迷手机分类 21 个且「天空」24 张 1440×3120 可翻页、Wallspic 坏图卡片从 30 变 29 且页面无坏图；`setWallpaper` 用真实图片实测返回 OK（测试后已恢复原壁纸并删除测试图）；全页面 0 未捕获异常。

## v0.105

- **2026-11-09 v0.105（未发版）片源管理 / 壁纸 7 项反馈**：① 片源管理删除「全部源」卡片，整体导入 / 整体导出改到页面顶部（v0.106 已改左对齐），仍含全部源（新增 `wallpaperSources`）；② 壁纸源改为可管理数据 `data.wallpaperSources`（`id/name/baseUrl/template/enabled/testStatus/testMsg/testAt`，`template` 为 `wallspic` / `bizhimi`），卡片补齐添加源 / 批量导入 / 整体测试 / 导出 + 每行测试 / 停用启用 / 修改 / 删除，去掉「固定内置源」「分类自动同步」说明；默认两源 `testStatus='ok'`、`testMsg='可用'`，缺失补默认、删空不补回；源配置随备份 / 云同步 / 整体导入导出走，收藏与列表按源 id 关联，源删除 / 停用时收藏给出提示；③ 壁纸迷手机壁纸分类先按站点导航抓取（v0.106 已改为标签）；④ 壁纸页设备 / 分类从 chips 改成下拉（参考直播），分类下拉带数量；⑤ 坏图修复：图片缓存请求补兜底 UA（`VOD_UA`），chaoxing 等图床无 UA 会 403；v0.106 起失效卡片直接隐藏；⑥ 预览层点黑色遮罩（stage 空白处）立即关闭；⑦ 返回栈：从收藏进入壁纸的预览视为详情，X / Esc / 遮罩关闭 = 返回收藏页；`pushRoute` 对同一张壁纸不重复入栈；`focus` 消失时清掉残留预览。

## v0.104

- **2026-11-09 v0.104（未发版）壁纸收口 + 返回栈修复**：① 片源管理「壁纸源」卡片补齐适用按钮：整体测试 / 导出 + 每行「测试 / 打开」，测试走 `wallpaperCategories(id,'pc')` 并显示「可用 · N 个分类」，固定内置源不提供添加 / 批量导入。② 哲风壁纸整源下线：`src/shared/wallpaper.ts` 与 `electron/wallpaper.ts` 删除 haowall 类型、AES 接口、分类 / 列表 / 原图解析、hostAllowed 分支；壁纸源只剩 Wallspic + 壁纸迷。旧哲风收藏保留数据但点击提示「来自已下线的哲风壁纸，无法直接打开」。③ 返回栈：`WallpaperPage` / `GameCheatPage` / `LiveRoomsPage` 补 `onExit`，从收藏进入详情后头部出现真正的「返回」，回到收藏页；收藏 / 下载右上角直达页的返回也已 CDP 验证（壁纸收藏 → 预览 → 返回收藏 → 返回壁纸；下载 → 返回壁纸）。④ 分类按设备（参考直播的分区口径）：壁纸页第一行设备 chips（电脑壁纸 / 手机壁纸），第二行分类 chips 随设备切换；IPC `wallpaper:categories` 新增 `device` 参数，缓存 key `wallpaper:categories:v2|源|设备`。Wallspic 直接用站点 `genre/for_desktop` / `genre/for_mobile`（实测全部 57,088 / 24,263，品牌 633 / 836，其余分类数量也各自不同）；壁纸迷电脑 42 个分类、手机只有「全部」13,349（站点手机壁纸没有内容子分类）。⑤ 原图：哲风移除后，Wallspic 详情页解析 `attachments/originals/...`（实测下载 URL 为原图），壁纸迷列表 `largeUrl` 为堆糖 `origin` 原图；不再出现下载预览图的问题。CDP 实测：源下拉只有 Wallspic / 壁纸迷；设备 / 分类切换与数量正确；片源管理卡「共 2 个 · 启用 2 · 有效 2 · 无效 0」；收藏 / 下载返回链路正确；无未捕获异常 / console error。

## v0.103

- **2026-11-09 v0.103（未发版）8 项反馈修复**：① 片源管理「壁纸源」卡片从最上面移到「番号源」之后，行样式与其它源统一（状态点 / 域名 / 内置源说明 / 打开按钮），统计显示「共 3 个 · 启用 3 · 有效 3 · 无效 0」。② 壁纸页右上角收藏 / 下载图标补上 `page-actions` 包裹，真正靠右；分类从搜索栏下拉改为搜索栏下方两组 chips：第一行「设备」（电脑壁纸 / 手机壁纸），第二行「分类」（动漫次元 / 自然风景 …），带站点数量。③ 哲风壁纸列表只请求静态壁纸（wpType 1 电脑 / 2 手机），解析时再过滤一次非静态类型；修复所有壁纸下载报「下载参数无效」——`electron/main.ts` 的 `downloads:add` 白名单原来只有 video / music / file，已补齐 comic / book / novel / wallpaper / trainer / file。④ `fish 聚合音源` 改名为 `fish 聚合音源 (Flac)`，老数据里仍是旧默认名的自动迁移，用户改过的名字保持。⑤ 电视「全部源」不再给分类名加「源名 · 」前缀，同名分组直接合并。⑥ 番号默认「全部源」时隐藏分类 chips，切到单个源后才显示该源分类与数量。⑦ X站新增标签搜索：SearchBar 按 code / 多语言别名匹配站点标签，唯一命中直接加载，多个命中显示「匹配标签」chips；搜索固定走总榜（range=all），避免周榜没有该标签时 0 条。CDP 实测：壁纸 12 张 / 两组分类 / 右上角 2 个快捷按钮、片源管理卡片顺序以「壁纸源」收尾、音乐下拉含 (Flac)、电视 448 频道且 chips 无前缀、番号全部源 0 个分类 chips 切单源后显示分类、X站搜 jk → 女高中生 1198 条 50 张卡片、 wallpaper:add 记录 kind=wallpaper 成功；无未捕获异常 / console error。哲风原图接口现返回 401 / 305（站点要求登录或人机验证），下载回落详情页 `pre_cache_file` 静态预览图（约 1100px），这是站点限制。

## v0.102

- **2026-11-09 v0.102（未发版）老郑优化新增「壁纸」模块**：侧栏「老郑优化」在「电脑信息」之后新增「壁纸」，三个固定壁纸源：哲风壁纸（`haowallpaper.com`，电脑壁纸 / 手机壁纸，只有浏览、不支持关键词搜索）、Wallspic（`wallspic.com/cn`，推荐 / 4K / 2K / 1080P / 8K / 热门 / 手机，支持搜索）、壁纸迷（`bizhimi.cn`，最新 + 宇宙星空 / 卡通动漫 等 11 个分类，支持搜索）。三个源都是服务端渲染页面，主进程 `electron/wallpaper.ts` 直接解析 HTML：哲风读 JSON-LD `ItemList` + 卡片分辨率，Wallspic 读 `window.mainGalleryTarget / mainAdaptiveGallery`（30 条/页），壁纸迷读卡片 `data-img-info` JSON（含 `largeUrl` 原图）。页面为瀑布流卡片（按宽高比占位）、源 / 分类 chips、搜索、分页、点击预览大图（左右切换 / Esc 关闭）、收藏（module=`wallpaper`，id=`源|条目 id`，payload 带 pageUrl / 尺寸，收藏页可直接回到预览）、保存图片（`wallpaper:save`，文件名用壁纸标题）；列表缓存 `laozheng.cache.v1.wallpaper`（源 / 分类 / 页码 / 列表），主进程 `cachedResponse` 列表 30 分钟、详情 7 天。哲风壁纸搜索会自动切到 Wallspic 并提示；哲风图片 CDN 只给约 1100px 的 `pre_cache_file` 预览图（原图需登录 / 额度），Wallspic 横图解析 `/3840x2160`、竖图取原比例，壁纸迷列表自带原图。CDP 实测：三源列表 12 / 30 / 57 条、分类 / 搜索 / 翻页 / 预览 / 收藏 / 收藏跳转正常，无异常。

## v0.101

- **2026-11-09 v0.101（未发版）收藏删除二次确认**：收藏管理页（覆盖全部模块，含直播收藏）点垃圾桶不再直接删除，先弹 `ConfirmDialog`「删除收藏 / 确定删除收藏「xxx」吗？删除后可在对应模块重新收藏。」，确认后才删除并 toast「已删除收藏「xxx」」；取消或点遮罩关闭不改数据。网格卡片（`.fav-remove`）与列表行（`.icon-btn.danger`）两处删除入口共用同一 `removing` 状态。CDP 实测：影视收藏 2 条 → 点删除弹确认 → 取消仍 2 条 → 再删确认后变 1 条并出现 toast，无未捕获异常。

## v0.100

- **2026-11-09 v0.100（未发版）直播卡片收藏 + 抖音卡死修复 + 清单分类下拉**：① 直播卡片封面右上角新增红心收藏按钮（复用 `.fav-heart`，红色，点一下收藏 / 取消，不进入房间）；② 移除直播「热门」chip，分类行只在有分类时显示下拉，下拉第一项「热门」为默认，选它回到热门；③ 抖音直播间 / 列表卡死修复：`electron/livePlatform/douyin.ts` 的 `executeJavaScript` 全部加 6 秒硬超时（`runScript`），`douyinRoom` 整体 40 秒兜底；渲染层 `livePlatformRoom` 45 秒 / `livePlatformList` 70 秒 / 分类 60 秒超时，超时显示「播放失败」而不是一直加载；从收藏打开直播改用 `switchPlatform` 恢复目标平台现场，避免把上一个平台的分区带过来；④ 清单搜索分类从 chips 改为搜索框前下拉（影视 / 图书 / 游戏 / 人物，默认影视）。实测：30 张直播卡片都有红心且开关不进入播放；抖音收藏开房约 30 秒内给出离线 / 失败提示，返回后抖音热门 19 条与分类（聊天 / 音乐 / …）正常加载，不再卡死；清单下拉默认 video。

## v0.99

- **2026-11-09 v0.99（未发版）直播页第二轮反馈**：① 收藏入口改为与其他模块一致的右上角心形图标（`ModuleShortcuts`，无文字，放在扫码登录右侧），点击进入全局收藏管理并直接定位「直播」；收藏页自带返回；`FavoritesPage` 新增直播模块（把 `data.liveFavorites` 转成统一收藏行，支持打开 / 删除），设置页收藏数计入直播。② 平台切换从 tab 行改为搜索栏前置下拉，默认 B站，只列启用源；平台 tab 行移除。③ 片源管理新增「直播源」卡片（`data.livePlatformSources`，默认 B站 / 斗鱼 / 抖音），与其它源统一支持添加 / 批量导入 / 整体测试 / 启停 / 编辑 / 删除 / 导出，整体导入导出含该字段；直播页平台下拉与卡片平台名读源配置；删空后直播页显示「还没有启用的直播源」。④ 抖音新增分区：`electron/livePlatform/douyin.ts` 新增 `douyinCategories`（隐藏窗口抓首页 `/categorynew/` 链接，缓存 30 分钟）与 `douyinCategoryRooms`（抓分类页卡片，复用封面解析），UI 单组分类只显示一个下拉。实测抖音分类「聊天」30 条 / 16 封面，B站 30 条 / 抖音热门 19 条全封面；收藏入口 / 返回 / 收藏管理「直播 1 条收藏」/ 片源管理「直播源 共 3 个 · 启用 3 · 有效 3 · 无效 0」均通过。

## v0.98

- **2026-11-09 v0.98（未发版）直播页按用户反馈收口**：① 平台名「哔哩哔哩」统一改「B站」（`LIVE_PLATFORMS` / `PLATFORM_NAMES` / 扫码提示）；② 收藏夹入口移到页面右上角，与扫码登录并排并显示数量，点开 / 再点返回；分类按钮行移除收藏与历史；③ 移除搜索模式按钮（搜索框已够用）；分类行只保留「热门」+ 分区 / 分类两个下拉，选分组自动带出第一个分类并切到分区列表，抖音无分区只显示热门；收藏夹视图隐藏平台 tab 与分类行；④ 刷新图标移到搜索按钮右侧，只有点刷新才重新请求；⑤ 每个平台在本次会话内保存浏览现场（模式 / 关键词 / 分区 / 页码 / 列表 / 分类），B站 / 斗鱼 / 抖音来回切换直接还原，不再自动刷新；新增列表请求序号，切平台 / 重进模块时旧响应不会覆盖新状态；⑥ 抖音列表封面改从卡片 CSS `background-image`（webcast-cover）解析，按房间聚合取信息最全的一条，兼容「点击进入直播间」遮罩链接，实测首页约 20 条全部带封面。

## v0.97

- **2026-11-09 v0.97（未发版）平台直播模块（B站 / 斗鱼 / 抖音，扫码登录，无弹幕）**：① 新增独立侧栏「直播」（key `liveRooms`，位于「电视」下面），与 IPTV「电视」模块分开；页面 `src/pages/LiveRoomsPage.tsx` 提供平台 tab、热门 / 分区 / 搜索 / 收藏 / 历史、房间卡片、播放页、清晰度与线路切换、扫码登录入口。② 主进程新增 `electron/livePlatform/`：`common.ts`（请求 / UA / 缓存 / 人气格式化）、`session.ts`（`persist:laozheng-live` 专用分区、官方登录窗、Cookie 读取 / 清除）、`auth.ts`（safeStorage 加密账号、B站 passport 二维码 generate/poll、斗鱼 / 抖音官方登录窗、B站 nav 校验、抖音 `sid_guard` 过期解析、斗鱼设备号）、`bilibili.ts`（`Room/get_info` + `get_anchor_in_room` + `Area/getList` + `Area/getListByAreaID`（热门 / 分区，`data` 是数组）+ `search/type` + `getRoomPlayInfo` HLS/FLV 排序）、`douyu.ts`（betard / allpage / mixList / searchShow / `websec/getEncryption` + `getH5PlayV1` 签名 = md5 迭代 + auth，FLV/HLS）、`douyin.ts`（隐藏 BrowserWindow 抓 `.m3u8/.flv`，主页 / 搜索页 DOM 抓卡片，官方登录窗；不移植 a_bogus）。③ 播放新增 `src/components/LivePlayer.tsx`：m3u8 走 hls.js、flv 走 mpegts.js，线路失败自动切换、同清晰度按钮去重；`main.ts` 请求层补 hdslb/bilivideo、douyucdn/edgesrv、douyincdn/bytefcdnrd 等域名的 Referer/UA 与 CORS。④ 数据：`AppData` 新增 `liveFavorites` / `liveHistory`（随备份 / 云同步，`normalizeLiveFavorites` / `normalizeLiveHistory`），Cookie 用 safeStorage 存 `userData/live-accounts.json`，不进备份。⑤ IPC / preload：`livePlatform:categories/list/room/loginStatus/qrStart/qrPoll/openLogin/logout`。⑥ 实测：B站热门 30 / 分区 12 组 116 区 / 搜索 30 / HLS 播放 readyState 4；斗鱼热门 40 / FLV 播放 readyState 4 / 清晰度 4 档；抖音热门 19 卡片 / 抓流 FLV 播放 readyState 4；收藏 1 条、历史 4 条已落盘；B站二维码弹窗图片生成。抖音首次进房约 10~15 秒；`npm run typecheck` / `npm run build` 通过。

## v0.96

- **2026-11-06 v0.96（未发版）洛雪音源收口 + 漫画源可配置 + 缓存目录 + 13 项反馈**：① **音乐**：洛雪音源只保留 `lx_fish`（fish 聚合音源，`platforms:['kg','tx']`，只搜酷狗 / QQ），玉宁熙 Pro / 独家音源从 `LX_MUSIC_SOURCES` 与老数据（`normalizeData` 按 id / 地址）移除；音乐页默认选中无名音乐（`mvmp3`），源下拉「全部源（3）/ 无名音乐 / 33ve / fish 聚合音源」；`fetchLxLyric` 补齐酷狗 krcs + QQ 歌词，`resolveMusic` 对 `lx~` 歌曲并行返回直链 + LRC；修复「勾选歌词下载后切换音源下载实际没带歌词」——`downloadWithLyricsRef` 同步记忆状态，且已拿到播放直链时下载仍会补一次歌词（洛雪源同样生效）。② **漫画源**：新增 `src/shared/comicSources.ts`（`ComicSource` / `DEFAULT_COMIC_SOURCES`：漫画客 + Komiic）、`data.comicSources`、`comic:testSource` / `comic:exportSources`；片源管理新增与其它源一致的「漫画源」卡片（添加 / 批量导入 / 整体测试 / 导出 / 启停 / 编辑 / 删除，新增默认全部有效）；ComicPage 完全由 `data.comicSources` 驱动，yumanhua IPC 全部支持 `baseUrl + sourceId`、ID 前缀 `ymh:<sourceId>:`；Komiic 下拉显示「Komiic（外网）」；漫画客章节合并详情页 20 条 + `/morechapter` 全量，按话数升序（支持 `第107.2话` 小数），解决集数不如网站新。③ **小说**：神书网 `shenpinwu` 因速度慢从模板选项 / 默认源 / 老数据迁移中移除（`electron/novel.ts` 解析代码与 `browserPage.ts` 保留，后续可恢复），小说源默认 9 个。④ **缓存目录**：`settings.json → cacheRoot`（默认 userData），`apiCache` / `imageCache` 全部改为动态读取；设置页「清理缓存」后新增「缓存目录」入口，`app:chooseCacheDir` 选目录后先清空旧目录的 `image-cache` / `api-cache` 再切换（返回值含释放大小），`CacheInfo` 增加 `dir`。⑤ **导航**：「观影」统一为「影视」，影视分类下榜单更新小字删除；导航顺序改为 小说 → 漫画 → 本子 → 图书，漫画去掉「外网」后缀。⑥ **新增源默认有效**：影视 / 短剧 / 小说 / 漫画 / 番号 / 补丁 / 音乐 / 电视 / 磁力源的新增、批量导入、整体导入一律 `testStatus:'ok' / testMsg:'可用' / testAt:Date.now()`，卡片统计默认「有效 N · 无效 0」。⑦ 已通过 typecheck / build；独立 user-data-dir + CDP 实测：漫画源卡片「共 2 个 · 启用 2 · 有效 2 · 无效 0」、漫画下拉「漫画客 / Komiic（外网）」且默认漫画客、漫画客详情 138 章且含最新 `第107.2话机翻`、音乐默认 `mvmp3`、fish 搜「晴天」40 首（kg + tx）、首条解析成功并返回 1453 字歌词、`cacheInfo.dir` 指向实际 userData。v0.95 上一轮的三脚本 / 神书网内容已被本轮覆盖。

## v0.94

- **2026-11-05 v0.94（未发版）观影改名为影视**：侧栏显示名（`FAV_MODULE_LABELS.watch`）、WatchPage 页面标题 `<h1>影视</h1>` 以及代码内注释「观影」字样全部统一改「影视」；模块 key（路由 / localStorage / 内部常量）仍用 `watch`，不破坏已有数据和缓存 key。改动文件：`src/utils/data.ts`、`src/pages/WatchPage.tsx`、`src/shared/douban.ts`、`src/shared/vod.ts`、`src/shared/h1.ts`、`src/pages/DramaPage.tsx`、`src/components/ItemDetail.tsx`。已通过 typecheck / build / dist；`release\老郑分享 Setup 0.94.exe`。

## v0.93

- **2026-11-05 v0.93（未发版）移除 duanju55 短剧源 + 有分集自动下一集**：① 按用户要求移除上一轮接的 duanju55 源（`src/shared/drama.ts` / `electron/drama.ts` 里的常量、适配器代码和入口分支全部回滚），默认短剧源只剩西饭一个；旧数据里残留的 duanju55 条目在 normalize 时自动丢弃（没有苹果CMS 地址）。② `src/components/VideoPlayer.tsx` 新增 `onEnded?: () => void` prop + `video.addEventListener('ended', ...)` 事件监听，用 ref 存回调避免 useEffect 依赖闭包；清理函数里同步 removeEventListener 防止切集后旧 ended 误触发。③ 三个有分集场景绑定自动下一集：**DramaPage**（短剧）找 `episodes[index+1]` 未锁定集；**WatchPage**（观影）先当前播放组内 `episodes[episodeIndex+1]`，播完切到下一个播放组；**MelonPage**（吃瓜）跳过 heading/image/text 块，找下一个 video 类型 block。单集/无分集页面（PsitePage/XSitePage/LivePage/ItemDetail 预告片）不绑定 onEnded。已通过 typecheck / build / dist；`release\老郑分享 Setup 0.93.exe`（约 107MB）。

## v0.92

- **2026-11-05 v0.92（已移除）接入免费五五短剧**：duanju55.com 因用户不喜欢已在 v0.93 整体移除，代码全部回滚。

## v0.91

- **2026-11-05 v0.91（未发版）观影热门分类改用公开榜单（参考 KVideo）**：v0.90 的「按片源逐个分类拉列表」在 39 个启用源时首屏要发几十个请求，现改为参考 KVideo：① 首页榜单走公开影视榜单接口 `movie.douban.com/j/search_subjects`（sort=recommend），每个分类只发 1 个请求（热门 = 电影热门 + 剧集热门，日韩电影 = 韩国 + 日本），20 条/页，电影 / 剧集交叉合并去重。10 个分类映射：热门（movie 热门 + tv 热门）/ 华语电影（movie 华语）/ 国产剧（tv 国产剧）/ 欧美电影（movie 欧美）/ 美剧（tv 美剧）/ 日韩电影（movie 韩国 + movie 日本）/ 韩剧（tv 韩剧）/ 日漫（tv 日本动画）/ 纪录片（tv 纪录片）/ 综艺（tv 综艺）。② 主进程新增 `fetchDoubanHot` + IPC `douban:hot`，`cachedResponse` 磁盘 + 内存缓存 1 小时（按豆瓣登录态分 key），实测重启后命中磁盘缓存 1.8ms；渲染进程再把热门第一页 40 条写 `laozheng.cache.v1.watch_hot_douban`（约 6.4KB），点侧栏 71ms 出 40 张卡片。③ 点海报不再需要先有片源列表：直接把片名填进搜索框并调用现有跨源并发搜索，结果实时追加；清空搜索回到当前分类。④ 卡片显示封面、评分（静态星标，不外链）、集数信息（如「29集全 / 更新至26集」）、电影 / 剧集标签；封面沿用 doubanio Referer 规则。⑤ 旧版 `watch_hot` / `watch_cats` 缓存挂载时自动清掉。已通过 typecheck / build；独立 user-data-dir + CDP 实测：冷启动首屏 503ms 出 40 张卡片、10 个分类 317~634ms、二次切回 5~166ms、8 张封面 naturalWidth>0、翻页第 2 页内容变化、点「国产剧」首张《小城良方》搜到对应片源、清空回国产剧、重启后 71ms 出缓存、IPC 磁盘缓存 1.8ms、无未捕获异常。v0.90 的按片源分类实现已被本次替换。

## v0.90

- **2026-11-05 v0.90（未发版，v0.91 已改为公开榜单）观影分类浏览**：① 观影默认页从「输入片名开始搜索」改为分类浏览，默认选中「热门」（各启用源 `ac=videolist&pg=N` 默认列表合并，按标题 + 年份去重），新增「热门 / 华语电影 / 国产剧 / 欧美电影 / 美剧 / 日韩电影 / 韩剧 / 日漫 / 纪录片 / 综艺」10 个固定分类；切换分类 / 片源自动回第 1 页，搜索时隐藏分类栏，清空搜索回到分类列表。② 分类映射：先按源分类名精确匹配，没有再做包含匹配；综艺展开到大陆 / 港台 / 日韩 / 欧美综艺，日漫匹配日韩 / 日本动漫，美剧匹配美剧 / 美国剧 / 欧美剧。片源普遍没有「华语电影 / 欧美电影 / 日韩电影」分类，兜底是每个源轮流取一个电影类型分类（动作片 / 喜剧片 / …，多源轮转），再按 `vod_area` 片源地 + 电影类型过滤；单源时列出该源全部电影类型。每个源每个分类只发 1 个请求（单源时按分类数发），6 并发，旧请求用序号作废。③ 缓存：热门第一页写 `laozheng.cache.v1.watch_hot`（截断 120 条、去掉播放地址，约 39KB），片源分类写 `laozheng.cache.v1.watch_cats`（按 `id@baseUrl` 判断失效），重开应用先显示缓存（实测点侧栏 160ms 出 120 张卡片），再后台刷新；切模块页面常驻不丢。无新增用户数据，导入导出 / 云同步不变。④ 分类卡片复用本子 / 漫画网格与番号卡片样式，带封面、更新集数徽章、时长、收藏红心；点击直接进播放页，返回保留当前分类与页码。已通过 typecheck / build；独立 user-data-dir + CDP 实测 10 个分类均有内容（热门 250+ / 华语电影 80 / 国产剧 62 / 欧美电影 182 / 美剧 74 / 日韩电影 33 / 韩剧 38 / 日漫 53 / 纪录片 100 / 综艺 152），搜索「沙丘」9 条、清空回分类列表，单源「非凡资源」热门 20 条与国产剧 20 条、播放 / 返回正常、收藏红心可切换，无未捕获异常。

## v0.89

- **2026-11-05 v0.89（未发版）按用户反馈移除 MYCOMIC**：v0.88 接入的 MYCOMIC 源内容不全（站内章节缺失较多），用户要求先移除；漫画页恢复为只有 Komiic 一个源。已删除 `electron/mycomic.ts` / `src/shared/mycomic.ts`，撤销 ComicPage 的源切换与 `mc:` 前缀逻辑、`mycomic:*` IPC / preload / 类型、`ComicSource='mycomic'` 与下载校验放行、main.ts 里 biccam.com 图片请求头；`src/pages/ComicPage.tsx` 已恢复到 v0.88 之前（HEAD）版本。版本号按规则递增到 v0.89。包子漫画仍未接入。

## v0.88

- **2026-11-05 v0.88（已撤销）漫画模块接入 MYCOMIC（国内直连）**：① 漫画页右上角新增 Komiic / MYCOMIC 源切换，默认沿用上次选择；MYCOMIC 显示「资料库 / 最热」，搜索框占位文案随源切换，Komiic 的分类 chips 只在 Komiic 源显示。② 新增 `electron/mycomic.ts`：MYCOMIC 站点在 Cloudflare 托管验证之后，普通 Node fetch 会 403；先用隐藏 BrowserWindow（partition `persist:mycomic`）过一次浏览器验证，再用该会话的 `session.fetch` 取 HTML，验证结果缓存 10 分钟；HTML 用 node-html-parser 解析列表 / 详情 / 章节图。③ 数据口径：列表 / 搜索每页 30 部，分页从页面 `?page=N` 链接解析；详情页 `x-data` 里的 chapters 数组为全量章节（新的在前，转成旧→新）；章节图取 `img.page` 的 `biccam.com/chapters/<id>/<n>-<hash>.jpg`，按页码排序。④ MYCOMIC 条目 ID 统一加 `mc:` 前缀，收藏 / 阅读进度 / 下载记录与 Komiic 数字 ID 隔离；收藏页点 MYCOMIC 收藏会自动切到该源并打开详情。⑤ 图片：`biccam.com` 需要 Referer `https://mycomic.com/`，已加入 `applyRequestHeaders` 与 `imageHeaders`，lzimg 磁盘缓存可正常落盘。⑥ 下载：`ComicSource` 增加 `mycomic`，`addComicBatchDownload` 校验放行，下载记录 sourceName 为 `MYCOMIC`，章节名直接用站点原始标题。⑦ 缓存：`comic.mycomic` 列表缓存 + `comic.source` 源偏好，均随 localStorage 缓存清理；收藏 / 进度沿用 AppData，导入导出 / 云同步不变。已通过 typecheck / build；CDP 实测：资料库 30 部、分页第 2 页 30 部、搜索「海贼王」11 部、详情《猎人游戏W》7 章 / 作者 / 标签、章节 26 张图全部 naturalWidth>0、收藏 `mc:55355` → 收藏页 → 详情回跳、下载单章 ok 且清理记录、切回 Komiic 20 部再切回 MYCOMIC 30 部，无未捕获异常。包子漫画已调研但未接入：章节页图片列表需额外用隐藏窗口渲染，且部分章节为 APP 限定。

## v0.87

- **2026-11-05 v0.87（未发版）番号源中文名 + 默认有效**：四个默认番号源改用中文名（与影视源内置列表一致）：`黄色仓库`（hsckzy.vip）/ `91麻豆`（91md.me）/ `奶香香`（Naixxzy.com）/ `精品资源`（www.jingpinx.com）；默认 `testStatus='ok' / testMsg='可用'`，片源管理显示「共 4 个 · 启用 4 · 有效 4 · 无效 0」；番号页下拉同步显示中文名。`normalizeH1Sources` 增加老数据迁移：`h1_fixed_1~4` 仍是 v0.86 英文名 / 空名字且地址未改时自动换成中文名，未测试的自动标记为有效；用户改过名字、地址或已有测试结果的保持原样。已用 esbuild 实测四种数据场景；CDP 实测下拉「全部源（4）/ 黄色仓库 / 91麻豆 / 奶香香 / 精品资源」、卡片「有效 4 · 无效 0」且每行显示「可用」。

## v0.86

- **2026-11-05 v0.86（未发版）番号模块合并 + 番号源**：① 侧栏「番1~番4」四个入口合并为单个「番号」（位置在本子下面；老 NavOrder 里的 h1_1~h1_4 会在 `orderedNavItems` 里被过滤，新 key 自动插到本子后面）。② 片源管理新增「番号源」卡片（默认四个原始外网采集站 hsckzy.vip / 91md.me / naixxzy.com / jingpinx.com，id 沿用 `h1_fixed_1~4`，旧收藏无需迁移）：与其它源统一支持添加源 / 批量导入（含导入内置）/ 整体测试 / 启停 / 编辑 / 删除 / 导出（新 IPC `h1:exportSources`）；「全部源」整体导入导出新增 `h1Sources`。③ 番号页搜索框前加「全部源（N）」下拉，默认全部源；全部源按分类名合并四个源的分类（同名分类记录各源自己的 type_id），切换单源后只显示该源分类并探测每类数量；全部源分页取各源同一页码合并、末页取最大值、总数求和；卡片副标题在全部源模式显示来源名。④ 数据 `data.h1Sources` 缺失时自动补默认四源，存在数组时以用户配置为准（删空保持为空）；`normalizeH1Sources` 逐字段校验。⑤ 缓存：默认全部源第一页写 `laozheng.cache.v1.h1_all`，重开应用先显示缓存（实测 41ms 出卡片）；切模块不卸载所以会话内不丢。⑥ 收藏入口按 payload.sourceId 解析到番号源（兼容旧 `h1_fixed_N` 与副标题片源名），进播放页时自动把下拉切到该源，返回列表保留该源分类。已通过 typecheck / build；独立 user-data-dir + CDP 实测：侧栏只有「番号」、下拉「全部源（4）/ hsckzy.vip / 91md.me / naixxzy.com / jingpinx.com」、全部源 42 个分类 69767 总数、单源分类数量显示、搜索 / 分类 / 翻页 / 收藏 → 收藏页 → 播放 → 返回（源保持 hsckzy.vip）均正常、停用源后下拉变「全部源（3）」、番号源卡片共 4 启用 4。本机网络只有 hsckzy.vip 可达，其余三源独立失败不影响结果（同页合并只展示成功源）。

## 其他记录（规则 / 发版 / 安装包）

- **2026-11-04 第二批 Legado 源调研（未接入）**：用户提供 `source-repo.zgqinc.gq/legado3/bookSource/bookSource_1~8.json`（站点显示 28180 个源）。该服务器约 6~11 KB/s，8 个 20MB+ 文件无法在合理时间全部下载，本轮只完整拿到 `bookSource_2.json`（3523 源，3388 个启用文字源）；另用同仓库 `old` 分支 zip 快照 `bookSource_22594.json`（22594 源，经 gh-proxy 下载）补充筛选。已完整验证两个免费聚合站：**开心文学网**（`www.kxwx.org` → `www.kxdu.net`，搜索/详情/目录/正文正常）和 **若雨中文**（`www.3yt.com` → `www.3yt.info`，搜索/详情/目录/正文正常）；搜索页存活但未逐站验证：中意文学、豆花文学、手机TXT小说、种田小说、猫九小说、猪猪书网、八零电子书；正版/VIP：创世、掌阅、潇湘、SF轻小说、梧桐七猫；阅读库/去读书本机不可达，平凡文学/书耽/爱久久依赖 JS/webView。完整记录见 `docs/NOVEL_SOURCES_SHORTLIST.md` 第六节，尚未写新源适配。

- **2026-11-04 小说源扩展调研与接入**：用户提供 Legado 书源合集 `https://legado.aoaostar.com/sources/b778fe6b.json`（3907 个源，3678 个启用文字小说源，1872 个依赖 JS，1549 个核心规则无 JS）。本应用是固定模板，不能直接导入；按「简单 CSS + 域名去重」筛出 29 源 / 14 站并实测搜索页，免费且可用只有 **九五小说**（95dushu.info）和 **玄幻阁**（xuanhuange.info），已按用户确认接入为固定模板 `95dushu` / `xuanhuange`（搜索 / 详情 / 目录 / 正文 / 下载全部实测通过）。17K、梧桐中文 / 七猫搜索页可用但属正版可能 VIP，未接入；其余 10 站失败、超时、跳广告或 0 结果。69书吧 / 顶点 / 笔趣阁⑲ / 笔趣阁7 / 衍墨轩等规则更复杂，需额外支持后再测。完整清单见 `docs/NOVEL_SOURCES_SHORTLIST.md`。

## v0.85

- **2026-11-04 v0.85（未发版）小说模块收口**：① 小说源默认 3 个：蚂蚁文学 + 九五小说 + 玄幻阁；老数据里的内置 bqg70 / bqg52 / biqugeco 在 `normalizeNovelSources` 中清理（手动添加的 `novel_*` 源保留），九五 / 玄幻通过 `config.novelExtraSeeded` 一次性补入老数据（删除后不再加回，显式清空书源也不会被重新补）；片源管理「小说源」卡片移到「补丁源」下面，并补「批量导入」（按地址猜模板，识别不到按蚂蚁文学）。② 侧栏「小说」固定在「磁力」下面：`orderedNavItems` 遇到旧拖动顺序里没有的新模块时，按默认顺序插到前一个模块后面，不再排到最底部。③ 小说页搜索框前统一「全部源（N）/ 单源」下拉（默认全部源，与音乐 / 短剧 / 电视 / 磁力一致）；以后带源模块都按这个口径。④ 首页 / 搜索解析作者、完结状态与封面：蚂蚁文学 `biquges.com` 会 301 到 `mayiwsk.info`，跟随 301 时 POST 会退化成 GET 丢参数，`electron/novel.ts` 记住落地域名 `canonicalBases`，搜索 / 状态补查直接请求真实域名；首页推荐没有状态列，按书名 8 并发补查（失败留空）；搜索表格 `完成/连载` 统一成 `完结/连载`，结果按书名/作者命中排序。⑤ 卡片补心形收藏（module=`novel`），副标题显示「作者 · 完结/连载」，封面加载失败回退占位图标，底部新增客户端分页器（24 条/页，搜索 50 条 → 3 页）。⑥ 详情新增「下载 TXT」：点击先弹「下载小说」确认框（书名 / 章节数 / 保存目录），确认后主进程按章节 5 并发抓正文，合并 UTF-8 BOM 的整本 TXT 到「下载目录/小说/<书名>.txt」，进度经 `novel:downloadProgress` 推送；下载管理新增「小说」分区与 `DownloadKind='novel'`。已通过 typecheck / build；esbuild 实测首页 30 条（作者 / 封面 / 状态齐全、耗时约 2.5s）、作者「唐家三少」50 条且 25 条作者命中、书名「夜无疆」首条命中、详情 862 章、3 章下载生成 `小说/苟在初圣魔门当人材.txt`（3408 字节）并写下载记录；独立 user-data-dir + CDP 实测：侧栏小说在磁力下面、下拉「全部源（1）/ 蚂蚁文学」、封面 naturalWidth>0、卡片红心可收藏、搜索作者/书名均命中且分页 3 页、详情作者/状态/封面/下载按钮正常、下载快捷入口进入「小说」分区。

- **2026-11-04 v0.85（未发版）暂时下线「无损音乐」默认源**：按用户要求移除 `DEFAULT_MUSIC_SOURCES` 里的 `hi`（flac.music.hi.cn），`normalizeData` 改为清理老数据里由 v0.83 自动补进来的内置 hi 源（`id === 'hi'` 且地址含 `music.hi.cn`；手动添加的同地址源 id 是 `music_*`，不会被删）。`electron/music.ts` 的 hi 适配器（酷我 / 网易云、网易云官方接口 + 酷我同名替代、官方歌词、`hi~` id）全部保留，后续要恢复只需把默认源加回来；v0.84 的音乐下载窗口、音质 / 大小选择、歌词记忆一并保留。已通过 typecheck / build；normalizeData 实测：带内置 hi 的旧数据加载后只剩 mvmp3 + 33ve，手动添加的 `music_xxx` 同地址源保留，删空仍为空。

## v0.84

- **2026-11-04 v0.84（未发版）网易云音源修复 + 音乐下载窗口**：① 网易云（wyy）修复：站点 `getUrl` 全量报「接口请求失败」，现在依次尝试站点 getUrl → 网易云官方匿名接口（`/api/song/enhance/player/url/v1`，免费歌给完整直链，会员歌只给 30~45 秒试听，试听不当作成功）→ 酷我同名同歌手替代音源；同时用网易云 `/api/song/lyric` 取歌词（会员曲回落酷我时也带网易云歌词）。② 搜索改为酷我 + 网易云并发（单边失败不影响另一边），`MusicSong` 增加 `origin / qualities`，列表显示「酷我 / 网易云」。③ 音乐下载窗口：移除每行「下载歌词」按钮，点下载（含「下载正在播放」）弹 `Modal`：按搜索结果 `minfo` 列出音质 / 大小（网易云只列 MP3 320 / 128，不展示匿名接口拿不到的 FLAC；无名音乐 / 33ve 补 `sizeHint`，显示「默认音质 · 3.9 MB」），歌词复选框默认不勾选，勾选状态写入 `localStorage.laozheng.music.downloadLyrics`，下次打开记住；确认后直接 `addDownload`（不再叠一层全局确认），勾选歌词时解析成功后一起写 `.lrc`，没有歌词则提示跳过。④ `resolveMusic` 增加 `quality` 参数（IPC / preload / 类型同步），主进程按选中的格式 / 码率解析，低音质只向下回退；缓存 key 带音质，避免 128 命中 FLAC。已通过 typecheck / build；esbuild 真实接口：测试 40 首、免费网易云曲走 music.126.net（HEAD 200 / 4.3MB）、VIP 曲回落酷我 FLAC（30MB）并带 2385 字歌词、酷我 FLAC/320/128 三档下载地址正确、33ve 正常；独立 user-data-dir + CDP：40 条结果（20 酷我 + 20 网易云）、播放网易云歌曲 255s 且有 57 行歌词、下载窗口显示 MP3 320 9.74MB / MP3 128 3.9MB、歌词默认不勾选、勾选后取消再开仍勾选、酷我窗口显示 FLAC 28.88Mb / 320 / 128；实测下载 MP3 128（4,086,643 字节）并同时生成 2,393 字节 `.lrc`。

## v0.83

- **2026-11-04 v0.83（未发版）音乐源新增「无损音乐」（flac.music.hi.cn）**：① 站点是 Vue + JSON 接口：搜索 `POST /ajax.php?act=search`（platform=kuwo、keyword、page、size=20），直链 `POST /ajax.php?act=getUrl`（platform、songid、format、bitrate、time、sign）；实测酷我 FLAC 可直连播放（HEAD 200 `audio/x-flac`），网易云（wyy）搜索正常但 getUrl 跨 3 个关键词 / 14 首歌全部 `code=-1 接口请求失败`，所以暂只接酷我。② `electron/music.ts` 按 baseUrl 主机名（`*.music.hi.cn`）自动识别，用户自定义源 id / 镜像地址同样生效；歌曲 id 编码为 `hi~kuwo~<songid>~<time>~<sign>`，收藏 / 下载后重开应用仍可直接解析；sign 只绑 songid（换 format / bitrate 仍有效），解析先请求 flac/2000（站点没有 FLAC 时会自动回 mp3），失败再降 320 / 128；签名失效时按歌名 + 歌手重搜刷新。③ `DEFAULT_MUSIC_SOURCES` 增加 `hi`（无损音乐 `https://flac.music.hi.cn`），老数据首次加载补一次（`config.musicHiSeeded = '1'`，删除后不再自动加回；音乐源列表为空时不补）。④ `resolveMusic` 增加可选 title / artists 参数（IPC / preload / 类型同步），`MusicPage` / `MusicPlayer` 带 baseUrl 或 `hi~` id 时走主进程解析，失败再回退按歌名搜索；该站没有歌词接口，歌词区显示「暂时没有歌词」。已通过 typecheck / build；esbuild 真实接口测试：音源测试 20 首、晴天 p1 12 条 / p2 14 条、首条解析 FLAC HEAD 200、故意改坏 sign 后按歌名刷新仍成功、自定义源 id 主机识别成功、33ve CMS 源搜索 30 条且解析正常、normalizeData 四种老数据场景符合预期；独立 user-data-dir + CDP 实测：音乐源下拉「全部源（3）/ 无名音乐 / 33ve / 无损音乐」，选无损音乐搜「晴天」12 条，点第一首播放时长 278s、进度 7.5s→12s，无页面异常。

## v0.82

- **2026-11-04 v0.82（未发版）导航交互与源配置收口**：① 切换「老郑分享 / 老郑优化」再切回来时回到该树上一次停留的模块（`lastNavRef`），不再固定跳回「清单」；② 侧栏导航项支持按住拖动排序（拖动即时换位，松手写入 `settings.json → navOrder`；`BackupSettings.navOrder` 随导出 / 云同步走，IPC `settings:getNavOrder / setNavOrder`），重开应用保持顺序；③ 电视页源下拉新增「全部源（N）」并作为默认，全部源并发加载所有启用源、频道分组显示为「源名 · 分组」；音乐 / 修改器的「全部源」补上数量；④ 片源管理「音乐源」卡片移到「短剧源」下面；⑤ 修改器源 / 音乐源补齐「批量导入」（复用 ImportModal 文本 / JSON）与「导出」（`trainers:exportSources` / `music:exportSources`），按钮与其它源一致。已通过 typecheck / build；独立 user-data-dir + CDP 实测：音乐 → 切优化 → 切回仍是音乐、拖动「清单」到第二位后刷新仍保持、电视全部源 302 个频道且分组带源名前缀、音乐下拉「全部源（2）」/ 修改器「全部源（1）」、卡片顺序为 影视→短剧→音乐→电视→磁力→修改器、修改器 / 音乐卡片均有 添加源 / 批量导入 / 整体测试 / 导出、音乐源批量导入新增 1 条成功。

## v0.81

- **2026-11-04 v0.81（未发版）电视 / 音乐源选择与音乐源可配置**：① 电视页把搜索栏提到状态判断之外，搜索框前新增电视源下拉（只列启用源，切换即加载频道；频道加载失败 / 无频道 / 全部停用时也能换源，全部停用显示专门空状态）。② 音乐源从 `electron/music.ts` 硬编码的 `SITES` 改为 `data.musicSources`（默认 `mvmp3` 无名音乐 `http://www.mvmp3.com`、`s33ve` 33ve `https://www.33ve.com`，字段 `id/name/baseUrl/enabled/testStatus/testMsg/testAt`，`normalizeMusicSources` 缺失时补默认、已有配置以用户为准、删空保持为空）；主进程 `searchMusic(sources, keyword, page)` / `resolveMusic(songId, platform, baseUrl?)`（缺 baseUrl 用 `DEFAULT_MUSIC_BASE_URLS` 兜底）/ `testMusicSource`（固定关键词 love 搜索计数）全部按传入源工作，搜索缓存 key 带源 id+地址；`MusicSong` 增加 `baseUrl`，播放器 `PlayerSong.baseUrl` 与收藏 payload `raw.baseUrl` 一起保存，自定义 / 镜像源在播放、下载、歌词下载、收藏回放全链路可用。③ 音乐页搜索框前加「全部源 / 单源」下拉，切源自动用当前关键词重搜；片源管理新增「音乐源」卡片（共/启用/有效/无效、添加、测试、整体测试、启停、编辑、删除），「全部源」导入导出与备份 / 云同步都带上 `musicSources`。已通过 typecheck / build；独立 user-data-dir 实测：音乐下拉为「全部源 / 无名音乐 / 33ve」、全部源与 33ve 各搜到 30 首、33ve 歌曲可正常播放、音乐源卡片测试返回「可用，搜索到 30 首」、停用 33ve 后音乐下拉只剩「全部源 / 无名音乐」并自动回到全部源、电视页下拉位于搜索框之前且加载 302 个频道。

## v0.80

- **2026-11-04 v0.80（未发版）音乐歌词下载**：音乐列表每行在「下载这首歌」按钮前新增「下载歌词」（`FileText` 图标）。点击时复用 `resolveSong` 解析直链响应里的 `lrc`，经新 IPC `music:saveLyrics` → `downloads.ts → saveMusicLyrics` 写入「下载目录/音乐/<歌手> - <歌名>.lrc」（UTF-8、同名自动加 `(2)`，不登记下载记录，避免下载管理出现不可播放的音频项）；空歌词提示「这首歌没有歌词」，保存成功 toast 绝对路径。`MusicPage` 的 `resolveSongUrl` 重构为返回完整 `MusicResolveResponse` 的 `resolveSong`（下载 / 歌词 / 下载正在播放共用）；`shared/music.ts` 新增 `MusicLyricsSaveResult`，types / preload 同步。已通过 typecheck / build；独立 user-data-dir 实测：搜索「唱 ado」30 条、按钮顺序为「下载歌词 / 下载这首歌 / 收藏」、点击生成 `Ado - 唱.lrc`（2945 字节、内容正确）、重复点击生成 `Ado - 唱 (2).lrc`、toast 显示完整路径。

## v0.79

- **2026-11-04 v0.79（未发版）修改器 / 游戏详情图片可点开大图**：沿用全局 `ImageViewer`（`openImageZoom` / `lz:image-zoom`）的单击放大能力，在 `DETAIL_IMAGE_SCOPE` 里补 `.cheat-detail-cover`（修改器详情封面）、`.game-detail-cover`（游戏详情封面，`GamePage` 封面 div 新增该类）与 `.game-shots`（两个模块的截图区）；图集仍按 `collectGallery` 取同一 section / 整页图片，支持上一张 / 下一张 / 保存 / 滚轮缩放。卡片网格里的 `.media-card` 封面仍只负责进详情，不会被放大层拦截。已通过 typecheck / build；CDP 实测修改器封面与截图、游戏截图均可打开放大层且「上一张」可用（图集 > 1），卡片点击仍正常进详情。

## v0.78

- **2026-11-04 v0.78（未发版）修改器卡片收藏 + 收藏行显示错位修复**：① 修改器列表卡片右上角新增收藏红心（与 X站 / P站 卡片同款 `.fav-heart`，module=`trainer`、id=`item.url`、payload 存 url/sourceId），详情页收藏与卡片收藏共用 `favOf(url)` + `toggleFav({ url, title, cover, sourceId, sourceName, version? })`。② 修复「收藏管理里每行显示错乱」：v0.69 侧栏品牌按钮用了全局类名 `.brand`，与收藏行 / 搜索结果 / 观影列表里的 `<span class="badge brand">` 撞名，`.brand { width: 100%; display: flex }` 把每行徽章拉满整行、`.row-main` 被挤成 0 宽，标题与副标题全部看不见；现侧栏改名为 `.sidebar-brand`（`App.tsx` + `styles.css`），`.badge.brand` 恢复紧凑。已通过 typecheck / build；用独立 user-data-dir + CDP 加载真实 data.json 实测：观影收藏 4 行标题 / 来源 / 时间正常（badge 39px、row-main 780px）、观影搜索结果徽章正常、修改器 15 张卡片均带红心、点红心 → 收藏管理「修改器」出现该条并可点回详情、再点取消收藏生效。

## v0.77

- **2026-11-03 v0.77（未发版）修改器收口：去掉在线 / 已安装页签 + 导航迁移**：① 按用户要求移除模块内「在线修改器 / 已安装」两个 chip，页面只保留在线搜索列表；已安装的训练器统一在「下载管理 → 修改器」分区里启动 / 打开目录 / 删除，模块不再维护第二套已安装 UI（下载后仍写 `data.installedTrainers`，暂时只作为备份数据）。② 导航「游戏修改」改名为「修改器」，从「老郑优化」移到「老郑分享」，位置在「游戏」下面；老郑优化只剩「电脑信息」。③ 页面标题同步改为「修改器」，右上角仍只有收藏 / 下载两个快捷入口。已通过 typecheck / build。

## v0.76

- **2026-11-03 v0.76（未发版）游戏修改收口：中文搜索 + 源管理精简 + 页面减负**：① 修改器源卡片移到「磁力源」下方；去掉「内置」角标与 `builtin` 概念，所有源都可以删除（删空保持为空，`normalizeTrainerSources` 只在没有 trainerSources 字段时补默认源）；添加 / 编辑源只保留风灵月影类型（名称 + 站点地址，可填镜像）。② MegaGames 暂时下线：默认源只保留 `fling`，`normalizeTrainerSources` 会丢弃历史数据里的 `megagames` 源；主进程适配器代码保留但 UI 不再暴露，后续要恢复只需加回默认源与类型选项。③ 中文搜索：风灵月影只有英文站，`translateGameName` 先用豆瓣游戏搜索（`searchSubjects('game')`）拿标题里的拉丁字母片段（如「黑神话：悟空 Black Myth: Wukong」→ `Black Myth: Wukong`），失败再读详情 `info` 的「又名 / 原名」，8 秒超时回退原关键词；`searchTrainers` 同时用中文与英文各搜一次并去重，响应带 `translatedFrom / translatedTo`，页面显示「中文名已自动按「X」搜索」。④ 页面减负：右上角只保留收藏 / 下载快捷入口，「在线修改器 / 已安装」移到标题下方，移除「打开目录」；详情页右上角只保留收藏，移除「原网页」。已通过 typecheck / build；CDP 实测「黑神话悟空」自动转 Black Myth: Wukong 返回 14 条并显示提示、右上角只剩两个图标、详情只剩收藏、修改器源顺序为磁力源之后且无「内置」字样、删除源成功、无未捕获异常。

## v0.75

- **2026-11-03 v0.75（未发版）游戏修改多源 + 下载管理 / 收藏 / 源管理接入**：① 新增第二个在线源 MegaGames（megagames.com）：搜索 `/results?query=` 解析 `.search-category` 的 Trainer 列表（过滤 PLITCH），最新列表解析 `.recent-trainers .card-home`；详情解析 `.trainer-title` / `.trainer-image` / JSON-LD `datePublished`、`<pre>` 内重新解析的正文（简介 / Num 修改项 / Launch Notes）、`.single-trainer-line a` 的 zip 直链（rocketcdn）。`searchTrainers` 改为多源并发 + 按游戏名归一化去重（`titleKey` 去掉版本号 / +N Trainer / 来源后缀），命中任一源失败不影响其它源。② 修改器源进片源管理（`data.trainerSources`，默认 `fling` 风灵月影 + `megagames` MegaGames，内置源不可删、可改名 / 改镜像地址）：支持启用 / 停用 / 单个与整体测试 / 添加自定义镜像 / 编辑 / 删除，并并入「全部源」整体导入导出（`AllSourcesBundle.trainerSources`）；测试走 `trainers:test`，结果写回源配置。③ 游戏修改页搜索栏前新增源下拉（默认「全部源」），卡片显示来源；右上角加收藏、下载、打开目录三个入口；详情加训练器收藏（module=`trainer`，payload 存 url/sourceId/version），收藏页新增「修改器」模块，可从收藏直接回到详情。④ 下载统一走下载管理：训练器落到「下载目录/修改器/<标题>/」，`downloadTrainer` 解压后 `registerLocalFile(kind='trainer')` 写下载记录；下载管理新增「修改器」分区（管理员启动 / 打开安装目录 / 删除），删除时整目录移入回收站；模块「已安装」页进入时自动扫描并清理文件已缺失的记录。⑤ 按用户要求移除「导入文件 / 导入文件夹 / 扫描目录 / Defender 白名单」按钮，对应 IPC 与主进程函数一并删除；「打开目录」移到右上角。已通过 typecheck / build；CDP 实测：全部源 43 条（风灵月影 15 + MegaGames 28 去重）、切源 MegaGames 30 条、搜索 elden 3 条、真实下载 1.9MB zip 解压 exe、下载管理「修改器」启动/目录/删除、收藏页回跳详情、修改器源测试（FLiNG 15 / MegaGames 30），无未捕获异常。

## v0.74

- **2026-11-03 v0.74（未发版）游戏修改模块（参考 dyang886/Game-Cheats-Manager）**：老郑优化新增「游戏修改」（`src/pages/GameCheatPage.tsx`），主进程 `electron/trainers.ts`：① 在线源为风灵月影 FLiNG（flingtrainer.com WordPress），无关键词取 `/category/trainer/page/N/` 最新列表、有关键词走 `/page/N/?s=` 搜索，解析文章卡片（标题 / 链接 / 封面 / 日期）与 `.pagination .next a` 判断下一页；详情解析 `h1.post-title`、og:image、`N Options / Game Version / Last Updated` 元信息、`p[style*=padding-left]` 修改项、Special Notes 段、下载附件表；列表 / 详情走 `apiCache`（搜索 30 分钟静默刷新、详情 12 小时）。② 下载：按文件头识别 zip(PK) / 自解压 exe(MZ) / rar / 7z，zip 用 adm-zip 逐条校验路径解压并摊平单层目录，exe / 压缩包直接落盘；统一放到「下载目录/游戏修改/<标题>/」，同名目录自动加 `(2)`；返回 `InstalledTrainer`（folder / exe / files / sizeBytes）。③ 已安装：记录存 `data.installedTrainers`（随导入导出与云同步走，只有目录信息、文件不参与备份）；支持本地 exe / zip / rar / 7z 导入、文件夹导入、扫描目录合并未登记记录、管理员权限启动（PowerShell `Start-Process -Verb RunAs`）、打开目录、移到回收站删除、一键 `Add-MpPreference -ExclusionPath` 添加 Defender 白名单（`Get-MpPreference` 先去重）；路径统一用 `resolveInsideRoot` 防目录穿越。④ 页面：在线修改器 / 已安装两个 chip，网格卡片 → 详情（封面、版本 / 功能数 / 更新时间徽章、下载附件、修改项折叠、反作弊提示、截图），已安装行显示文件数 / 大小 / 路径与「文件缺失」标记。已通过 typecheck / build；CDP 实测最新列表 15 张、搜索 elden 返回 2 条、详情 9 个版本附件 / 12 项折叠 / EAC 提示、真实下载 1.9MB 自解压 exe → 已安装行 → 回收站删除，无未捕获异常。

## v0.73

- **2026-11-03 v0.73（未发版）移除软件卸载 + 标题点击刷新 + 电脑信息落盘缓存**：① 按用户要求移除「软件卸载」：删除 `src/pages/SoftwarePage.tsx` / `src/shared/software.ts` / `electron/software.ts`，同步移除 App 导航项与 `software` 路由、IPC `software:*`、preload/API 类型与整段软件卸载 CSS；老郑优化现只剩「电脑信息」。② 所有页面标题（`h1.page-title`）点击 = 刷新当前页并回到初始状态：`App.tsx` 在 `.content` 上捕获点击，先把模块路由回退成 `leafRoute(activeNav)`（丢掉 focus / searchTitle 等入口参数，保留返回栈），再递增当前 `activeKey` 的 `navEpoch` 与 `refreshEpoch`；模块页的 slot 用 `key = key:refreshEpoch` 整页重新挂载，搜索词 / 结果 / 分页 / 弹层 / 播放页全部回到初始值（`ListDetailPage / FavoritesPage / DownloadsPage` 同样按 key 重挂载）；磁力额外清掉 `data.magnetSearch`，否则重新挂载又会恢复上次搜索结果；最后把内容区滚回顶部，标题增加 pointer / hover 反馈。③ 电脑信息结果落盘 `userData/system-info.json`：`collectSystemInfo(force)` 默认先读内存 → 再读磁盘缓存（校验 ok + entries 非空），只有 `force = true`（点页面标题或失败重试）才重新跑 PowerShell；重开应用进「电脑信息」不再等待采集。已验证 typecheck / build，并在运行中的 Electron 上实测：标题点击刷新无异常、缓存文件生成、重启后直接读缓存。

## v0.72

- **2026-11-03 v0.72（未发版）软件卸载接入 Geek Uninstaller 式清理 + 表格列宽拖动**：① 逆向 Geek Uninstaller 1.5.3.170（`d:\图吧工具箱202601\tools\其他工具\Geek Uninstaller\Geek Uninstaller.exe`）：本机无 Ghidra / IDA / Hopper，REA 无法反编译原生代码，改用 PE 静态结构 + 导入表 + 资源字符串取证；导入表含 `RegOpenKeyExW / RegEnumKeyExW / RegDeleteKeyW / SHFileOperationW / MoveFileExW / CreateProcessW / ShellExecuteExW`，资源里有 `CScannerNormal::ScanFiles / ScanRegistry / LoadDeskTopShortCuts / LoadStartMenuShortCuts`、`CScannerMSI / CScannerMetro / CScannerCustomRules`、`CUninstallProcess::WaitForProcessAndChildren`、`CInstallLocationFinder::FindAppDataFolders`，日志步骤为 `ScanIntallLocation / FindAppDataFolders / FindAppDataRegFolder / FindShortCuts / RegEnumsKeys HKCU·HKLM（含 wow64）`，提示文案 `statusScanning / statusLeftOverTracesFound / statusNothingFound / statusAllTracesRemoved / msgForceRemovalQuestion / msgUninstallFailed`，锁定文件走 `MoveFileEx` 的 `ERROR_ACCESS_DENIED / ERROR_SHARING_VIOLATION` → 重启后删除。② 按此行为重写 `electron/software.ts`：`runSoftwareUninstall` 用 PowerShell `Start-Process`（ShellExecute，自动 UAC）+ `WaitForExit(15min)`，再按「子进程树 + 安装目录 + 卸载器路径」轮询到全部退出；`scanSoftwareTraces` 扫安装目录、`%LOCALAPPDATA%`（含 `Programs`）、`%APPDATA%`、`%PROGRAMDATA%`、`LocalLow`、桌面 / 公共桌面 / 开始菜单 `.lnk`、卸载项、HKCU / HKLM（含 `WOW6432Node`）`Software` 键；名称匹配做归一化（去版本号 / 括号 / 符号），一级键只认完全相等，厂商键下再匹配产品键，避免误删 `Software\Google` 这类共享厂商键；`deleteSoftwareTraces` 删除前重新扫描，只删本次扫描存在的 id，并有系统目录 / 注册表根保护，占用文件用 P/Invoke `MoveFileEx(..., MOVEFILE_DELAY_UNTIL_REBOOT)` 登记重启删除；`forceRemoveSoftware` = 扫描后全删（不运行卸载器）。IPC 改为 `software:uninstall / scanTraces / deleteTraces / forceRemove`，参数传整个 `InstalledApp` 并在主进程收紧校验。③ PowerShell 执行改为临时 `.ps1`（UTF-8 BOM）+ `-File`：本机安全软件会按命令行长度拖慢 `-EncodedCommand`，8KB 脚本 12.7s、改文件后 3.8s。④ `SoftwarePage` 支持拖动表头调整列宽（`colgroup` + `table-layout: fixed`，宽度存 `localStorage.laozheng.software.columnWidths`），默认按时间倒序，列名「安装日期」改「时间」，卸载 / 强制按钮 `white-space: nowrap` 且操作列 sticky 右侧不被裁切；新增卸载后「清理残留」勾选弹层（卸载项仍在时默认不勾选并警告）、「强制」按钮、等待 / 扫描进度遮罩。已验证：typecheck / build；测试 HKCU + 临时目录的扫描与删除；CDP 端到端（假卸载项 → 卸载 → 扫描出 3 项 → 取消不删除 → 强制卸载删掉目录与卸载项、列表行消失）；拖拽 300→370 生效并持久化；按钮高度 34、无换行、操作列无溢出。

## v0.71

- **2026-11-03 v0.71（未发版）软件卸载 + 标题去小字**：① 老郑优化新增「软件卸载」（`src/pages/SoftwarePage.tsx`），主进程 `electron/software.ts` 读取 HKLM 64 位 / HKLM WOW6432Node / HKCU 三处卸载项，过滤系统组件、更新与隐藏项，按名称 + 版本 + 发布者去重；支持搜索、按名称 / 大小 / 安装时间排序、打开安装目录，确认后 `spawn` 软件自带 `UninstallString`（无则 `QuietUninstallString`），IPC `software:list / uninstall / openLocation`。② 页面标题后不再显示说明小字：移除电脑信息副标题，X站 / P站播放页删除标题旁元信息，下载 / 漫画 / 本子阅读页把章节信息并入标题；后续新页面同样不加标题说明。③ 主进程 PowerShell 执行封装抽到 `electron/powershell.ts`，电脑信息与软件卸载共用。已实测 50 个软件读取、搜索、排序、非法卸载参数拦截、确认框，无未捕获异常。

## v0.70

- **2026-11-03 v0.70（未发版）电脑信息补充**：系统增加 Windows 功能版本（注册表 `DisplayVersion`，本机实测 26H2）；显卡增加显存（优先读显卡类注册表 `HardwareInformation.qwMemorySize` / `MemorySize`，回退 `AdapterRAM`，避免 8GB 被 uint32 截成 4GB）；硬盘增加固态 / 机械（`MSFT_PhysicalDisk` 的 `MediaType` 3=HDD / 4=SSD，NVMe 兜底为固态，按 `DeviceId` 对应 `Win32_DiskDrive.Index`）。已用独立采集测试验证输出。

## v0.69

- **2026-11-03 v0.69（未发版）老郑优化导航 + 电脑信息**：侧栏顶部品牌改为按钮，点击「郑」图标或标题在「老郑分享 / 老郑优化」两套导航树之间切换（切换后进入该树第一个模块）；设置按钮移出导航树、固定在底部并用 `.sidebar-divider` 分割线隔开，切树时不变。老郑优化首期只有「电脑信息」模块（`src/pages/SysInfoPage.tsx`），主进程 `electron/sysinfo.ts` 用一次 PowerShell + WMI 采集型号 / 系统 / 处理器 / 主板 / 内存 / 显卡 / 显示器 / 硬盘 / 声卡 / 网卡，结果在本次运行内缓存；IPC `app:systemInfo`，类型在 `src/shared/sysinfo.ts`。已实测 10 类信息齐全、切树 / 设置 / 切回分享正常、无未捕获异常。

## 其他记录（规则 / 发版 / 安装包）

- **「优化」指令口径（2026-11-02 用户要求）**：以后用户说「优化」「整体优化」「检查一下」，默认执行全应用体检，不要只改表面。固定检查 9 类：① 路由 / 返回栈 / 常驻页面与切页暂停；② 搜索 / 分类 / 详情 / 章节 / 播放解析的异步竞态（旧响应不得覆盖新状态，返回后旧请求不得重开详情）；③ 播放器生命周期与 HLS 回退；④ 下载记录与文件一致性、并发锁、目录迁移不覆盖、特殊文件名编码、本地媒体读流错误；⑤ 数据源重复 URL / ID 冲突与测试结果持久化；⑥ 导入 / 云恢复 / 坏缓存 / 清单父子环 / 原子写；⑦ IPC 校验、`will-navigate`、外链与 preload 安全边界；⑧ 缓存登录态隔离、缓存自愈、更新下载锁与安装异常；⑨ 响应式卡片、吸顶、空状态与用户最新 UI 口径。流程：先静态审计列问题 → 修可确认的 bug → 版本号 +1 → `npm run build` → CDP 逐页冒烟（目标按 `out/renderer/index.html` 过滤，监听 `Runtime.exceptionThrown` 与 console error，覆盖全部侧栏页 + 详情进入/返回）→ `npm run dist` 出包并删旧包 → 更新本文件 → 按「问题清单 / 修复内容 / 验证结果 / 剩余限制 / 安装包」汇报；未明确说「发版」不得提交或上传 Release。

## v0.68

- **v0.68 发版记录（2026-11-03）**：commit `67681ab` / tag `v0.68` / **Release `432264174`**（https://github.com/Bug142857/LaoZheng/releases/tag/v0.68）；Actions run `41575430537` 构建并上传 `LaoZheng-0.68-Setup.exe`（107,185,255 字节，digest `sha256:0acead3573f8ac42644493a780462b691f74d7cbedaf2e13beba36bf3dcfb9ab`）。Release 说明已用 UTF-8 更新（更新选线 + 卸载选项）。**公开 Gist 清单已同步为 0.68**：`version=0.68 / url=tag 页 / exe=Release 资产直链 / notes=本次说明`，直连 raw 与 gh-proxy 均实测返回 0.68；gist 描述同步改为「老郑分享 PC 更新清单 0.68」。

- **2026-11-03 v0.68（已发版）卸载可选清除个人数据**：新增 `build/installer.nsh`（通过 `package.json → build.nsis.include` 引入），替换 NSIS 卸载欢迎页为自定义 nsDialogs 页：**默认不勾选**「同时清除个人数据」，勾选后卸载结束时 `RMDir /r "$APPDATA\laozheng-pc"`（清单 / 收藏 / 登录态 / 设置 / 缓存 / 下载记录），**不会删除**下载目录里的视频 / 漫画 / 音乐 / 图书；`--updated` 覆盖升级时强制跳过删除，静默卸载默认也不删。NSIS 坑：卸载回调函数必须用 `un.` 前缀（否则报 resolving create-page function）；`Var` 必须放进 `!ifdef BUILD_UNINSTALLER`（否则安装器构建报 warning 6001，electron-builder 把 warning 当错误）。已通过 `npm run dist`，本地测试包 `release/老郑分享 Setup 0.68.exe`（107,183,464 字节，SHA256 `EE03B802659908E2F9DD16313A806F08998CFF52E72AB044ECB9266BB40DDEEC`；发版资产以 CI 构建的 `LaoZheng-0.68-Setup.exe` 为准）。

## v0.67

- **2026-11-03 v0.67（未发版）更新检查 / 下载先测速选线**：用户反馈「点更新显示更新失败（网络不可用）」。现在 `app:checkUpdate` 与下载都先并发探测 3 条线路（直连 / gh-proxy.com / ghproxy.net）：检查用 `fetchJsonFastest` 并发请求、取最先完整返回的那条（GitHub API 与 Gist 清单都走同一套线路）；下载用 `Range: bytes=0-0` 只等响应头测速，按延迟从低到高排序，不可用线路排最后兜底；结果带 `line` 字段，设置页显示「线路 xxx」。本机实测：直连 `api.github.com` 与 gist 均 `fetch failed`；gh-proxy API 200（627ms）、gist 200、exe `206`；ghproxy API 403 但 gist / exe 206 → 选 gh-proxy。已通过 typecheck / build，本地安装包 `release/老郑分享 Setup 0.67.exe`（107,185,853 字节，SHA256 `4DC6B50638A1D9A88E5E15DEA5BEE4691D7751B2956252EBD1225851399CA129`，未发版）。⚠️ 公开 Gist 清单仍是 `version=0.5`（直连实测，不是镜像缓存），下次发版必须同步到 v0.67，否则 API 全挂时回退清单会误报「已是最新」。

## v0.66

- **2026-11-03 v0.66（已发版）片源管理统一 + 短剧源重构 + 导入导出**：① 片源管理四类源（影视 / 短剧 / 电视 / 磁力）全部默认折叠，标题右侧统一「共 N 个 · 启用 N · 有效 N · 无效 N」，按钮统一「添加源」、电视源「导入 M3U」改「批量导入」；顶部新增「全部源」整体导入 / 导出（影视 + 短剧 + 电视 + 磁力，按地址去重合并，含西饭短剧及其自定义地址）。② 短剧源只保留西饭默认项，旧红果 / 河马 / 自定义内置项在 normalize 时丢弃；西饭可改名、改接口地址（主进程按 baseUrl 请求，支持镜像）、可删除且显式空列表不会被自动加回；短剧源支持添加苹果CMS 源 / 批量导入（识别 `id=xifan` 恢复西饭）/ 整体测试 / 导出。③ 短剧页默认「全部源」，分类改为 chips（西饭接口无总数不显示，苹果CMS 显示精确数量），去掉「共 X 部」；新增收藏（收藏页短剧分区、可直接回到剧集）与下载本集。④ 清单管理新增导入 / 导出（清单 + 条目 + 关联；清单按名称 + 父级复用，条目按分类 + 豆瓣 ID 复用并重映射 ID，重复导入不产生重复数据）。已通过 typecheck / build。

## v0.65

- **2026-11-03 v0.65（未发版）短剧模块 + 首页移除 + 磁力缓存清理**：① 侧栏新增「短剧」（在观影下），参考 jackotom/hongguo-drama，主进程 `electron/drama.ts` 支持红果 / 西饭 / 河马 / 自定义（苹果CMS 影视源）四类短剧源，目录 / 分类 / 搜索 / 详情 / 分集 / 播放均已实测；短剧列表默认视图写 localStorage，重开应用先显示上次内容。② 片源管理新增「短剧源」折叠区（默认不展开），四个源可启停，自定义源可选择具体影视源；配置存 `data.dramaSources`，随导入导出与云同步走。③ 首页模块移除，启动默认进入清单。④ 磁力搜索结果只在本次运行期间保留：主进程 `data:load` 启动时清空 `magnetSearch` 并落盘。**已知限制**：红果官网公开页只给前 5 集 MP4，完整剧集仍需红果官方 App；河马多数分集标记付费锁定，西饭基本全免费。**

## v0.64

- **2026-11-03 v0.64（未发版）双端互通修正**：PC 导出 JSON 前递归去掉 null 字段（`stripNullFields`），因为 Android `org.json` 的 `optString` 会把 JSON null 读成字符串 `"null"`，手机端 `ifBlank { null }` 会把 `"null"` 当成真实封面 / 链接 / payload；手动导出与 WebDAV 云上传共用该处理。另修复 `parseFavPayload`：payload 为 `"null"` 或非对象时不再抛异常。核对手机端 `ExportJson.kt`：items / lists / listItems / vodSources / innerFavs / readProgress / config 字段一一对应，PC 扩展字段手机会忽略；手机端自己的电视源 / 下载记录等放在 `config` 快照里，PC 只原样保存、不会应用到 PC 模块。已用 esbuild 实测 `stripNullFields` 输出无 null 字段，typecheck / build 通过。

## v0.63

- **2026-11-03 v0.63（未发版）下载删除安全**：① 删除下载记录改为「先把文件移到回收站，成功后才删记录」：文件被播放器 / 下载器占用或无法进回收站时返回失败，记录与文件都保留，下载页提示「请关闭播放器后重试」，不再出现文件还在但记录消失；不再在回收站失败时静默彻底删除。② 删除成功时把记录写入 `userData/downloads-trash.json` 墓碑（最多 300 条）；文件从 Windows 回收站还原回原路径后，下次读取下载列表自动恢复对应记录（标题、片名、封面、大小等原样回来），只认应用删除过的记录，不会把用户随手放进目录的文件当成下载。③ 路径校验：记录里的 `playPath` 解析后必须在下载根目录内，`../` 等坏记录不删文件也不恢复。已用隔离测试实例实测：正常删除 `ok:true` 且文件进回收站；PowerShell 以 `FileShare.None` 占用文件后删除返回 `ok:false`、文件与记录都保留；模拟还原文件后记录自动回到列表。

## v0.62

- **2026-11-02 v0.62（未发版）全局审计修复**：① 各模块补「旧异步请求后到覆盖新状态」保护：SearchPage（切分类 / 清空）、WatchPage（搜索取消 + 详情 openSeq）、XSitePage（榜单 / 分类 requestSeq + 分类数量）、MagnetPage（换源取消旧搜索）、ListDetailPage（进入子清单清空搜索 / 弹窗状态）、ComicPage / BikaPage（章节 chapterSeq）、GamePage / BookPage / MelonPage（detailSeq）、PsitePage（playSeq）、MusicPage（清空取消搜索）；② 下载：媒体 URL 逐段 `encodeURIComponent`（文件名含 `# / %` 可播放），失败任务不再阻塞清理与目录迁移，媒体读流错误收掉响应避免主进程未捕获异常，迁移目录前检查同名文件避免覆盖，更新包下载加锁防止启动检查与手动下载并发共写 `.part`；③ 安全 / 缓存：主窗口 `will-navigate` 禁止被内容导航到远程页面，豆瓣 `subject:*` 缓存 key 带登录态作用域，影视源 / 电视源 / 磁力源新增与修改拒绝重复 URL 并保证 ID 唯一；④ 清单父子环（坏备份）在 `listCovers` 用 visited 防无限递归，设置页「立即安装」补异常捕获；⑤ 清理仓库根目录遗留的 butailing 调研临时脚本与 JSON。已通过 typecheck / build / CDP 逐页冒烟（首页、清单、观影、音乐、游戏、电视、吃瓜、磁力、图书、漫画、本子、番1~4、P站、X站、设置共 18 页 + 清单详情 / 返回），无未捕获异常与 console error。

## v0.61

- **2026-11-02 v0.61（未发版）数据 / 缓存审计修复**：① 修复导入 / 云恢复可能被旧的防抖保存覆盖（`replaceData` 先清 pending timer；保存状态只在最新数据落盘时才置 saved）；② 导入 / 云恢复校验升级为 items / lists / listItems 必须是数组，兼容 UTF-8 BOM；导出改为临时文件 + rename 原子写入；③ 备份里的 `magnetSearch` 逐字段校验（items 非数组 / 坏条目直接丢弃），防止 MagnetPage 崩溃；④ 电视源保存改为串行队列 + 唯一临时文件，整体测试并发回写不再互相覆盖；settings / magnet / downloads / sync 的临时文件也改为唯一名；⑤ api-cache 磁盘条目缺 value 按未命中处理，image-cache 发现损坏 / 非图片缓存自动删除重拉；⑥ 电视页在侧栏重进时重新读取 live-sources，导入备份后源列表即时更新；⑦ 导入 / 云恢复后设置页主题状态同步刷新。已通过 typecheck / build / CDP 冒烟（清单、磁力、电视、设置无异常）。已知残留：跨电脑导入的 downloadRoot 不做存在性校验；api-cache / image-cache 无容量上限，需要手动清理。

## v0.60

- **2026-11-02 v0.60（未发版）**：清单卡片改为随窗口宽度自适应，`@media (min-width: 1200px)` 才用大卡片，小于 1200px 自动回到原来的小卡片；清单首页 `.tile` 与清单详情 `.item-card` 同步生效。实测 1400px：首页 538×182（封面 104×136）、详情 538×182（封面 112×148）；1100px：首页 261×94（封面 52×68）、详情 263×96（封面 56×74）。

## v0.59

- **2026-11-02 v0.59（未发版）**：清单详情里的条目 / 子清单卡片也按原尺寸放大一倍：`.item-grid` 最小宽度 220→440、封面 56×74→112×148、标题 17px，默认窗口下每行 2 个（实测 470×182，与清单首页卡片一致）。已截图确认。

## v0.58

- **2026-11-02 v0.58（未发版）**：① 清单首页卡片按原尺寸放大一倍：网格最小宽度 240→460、封面 52×68→104×136、标题 16→18px，默认窗口下每行 2 个（实测 470×182）；② 清单内搜索结果详情补上「在线观看 / 下载」：`ListsPage → SearchPage → ItemDetail` 透传 `onWatch / onMagnet`，下载同样跳磁力页并自动搜索全部源，人物作品详情也支持。已用 CDP 实测：搜索「星际穿越」详情按钮为「在线观看 + 下载」，点下载进入磁力并带入片名自动搜索。

## v0.57

- **2026-11-02 v0.57（未发版）**：① 电视源测试结果写入 `userData/live-sources.json`（`testStatus / testMsg / testAt`），切模块 / 重开应用不丢，并随备份导入与云同步一起走；有效 / 无效统计直接按已保存结果计算，修改 M3U 地址会清空旧结果。② 清单首页卡片放大（网格 240→300、封面 52×68→68×90、标题 14.5→16px）。③ 清单影视条目详情去掉「在线观看」后的说明文字，新增「下载」按钮：带片名跳到磁力页并自动搜索全部磁力源。④ 调研 butailing.com（发布页实际入口为 butai0.com 等）：磁力 / 种子是服务端 VIP 权限（`sk=seed` 返回「请开通VIP后查看资源」，详情 `all_seeds` 为空、`need_vip=1`），无法绕过，未接入磁力源。已用 CDP 实测：卡片 315×124 / 封面 68×90、详情按钮「在线观看 + 下载」且无说明文字、点下载进入磁力并带入片名自动搜索、电视源测试后写入 live-sources.json。

## v0.66

- **v0.66 发版记录（2026-11-03）**：commit `0e7859f` / tag `v0.66` / Release https://github.com/Bug142857/LaoZheng/releases/tag/v0.66；Actions run `41572342159` 构建并上传 `LaoZheng-0.66-Setup.exe`（107,187,168 字节，digest `sha256:0a717467afed40fae8ef839aeb5c017e78e936f418c32e96e6a3c2eae15fe6fb`）。

- **v0.66 安装包（2026-11-03，已发版）**：本地 `release/老郑分享 Setup 0.66.exe`，107,187,182 字节，SHA256 `6D6DEACB3BF0A134FB1CB906FD3313A5634EE3247C88278F2BC62B817862FAC3`。

## v0.65

- **v0.65 安装包（2026-11-03，未发版）**：`release/老郑分享 Setup 0.65.exe`，107,180,605 字节，SHA256 `723F2D8C5EEA3CFF90D7EF96C3D7B25DBD2F300EDA60B685253BC56D83E8AE17`；`pack-artifact` 已删除旧的 0.64 安装包。

## v0.64

- **v0.64 安装包（2026-11-03，未发版）**：`release/老郑分享 Setup 0.64.exe`，107,167,936 字节，SHA256 `E89DC73FC93B7BCDA5BBE92E0DFE2426D9F743686C4EA220274975AFA794DF55`；`pack-artifact` 已删除旧的 0.63 安装包。

## v0.63

- **v0.63 安装包（2026-11-03，未发版）**：`release/老郑分享 Setup 0.63.exe`，107,169,748 字节，SHA256 `93A648A3E1E2D027098C5EF935BB474EA8427823E67F762CD530FBFB942E87A4`；`pack-artifact` 已删除旧的 0.62 安装包。

## v0.62

- **v0.62 安装包（2026-11-02，未发版）**：`release/老郑分享 Setup 0.62.exe`，107,167,086 字节，SHA256 `6F1411E8584A0218137D8623202DA1ACE2F8EC162EFABBC08E7CEE9F39D1DBCA`；`pack-artifact` 已删除旧的 0.61 安装包。

## v0.61

- **v0.61 安装包（2026-11-02，未发版）**：`release/老郑分享 Setup 0.61.exe`，107,167,976 字节，SHA256 `82E54F015AE2158ED8CBDB857589A19A046741DB5104E9112C3A8C489453BA03`；`pack-artifact` 已删除旧的 0.60 安装包。

## v0.56

- **2026-11-02 v0.56（未发版）**：① 所有导入 / 导出 / 保存文件对话框记住上次目录（`settings.json → lastDirs`，随备份与云同步走）；② 观影右上角下载入口移除，搜索框前新增片源选择（默认全部源，与磁力一致）；③ 磁力标题小字移除、「全部资源库」改「全部源」；结果小字改为 大小 · 时间 · 格式（不再显示 hash），操作只保留「复制磁力」；④ 磁力搜索改为实时追加 + 再点搜索按钮取消（取消保留已返回结果），普通源并发 5、隐藏浏览器源串行；⑤ 磁力搜索结果写入 `data.magnetSearch`，切模块 / 重开应用不丢，并随导入导出与云同步走；⑥ 默认磁力源改为用户 2026-11-02 重新导出的 18 个可用源（去掉 91BT / WUQIAN / SKRBT），`configVersion=4` 一次性迁移；⑦「磁力设置」改名「磁力源」并移入「片源管理」，按钮顺序调整为 添加 / 批量导入 / 整体测试 / 导出，移除打开日志与恢复默认；⑧ 移除磁力源底部两行说明与列表中「浏览器」小字。

## 其他记录（规则 / 发版 / 安装包）

- **2026-11-02 磁力搜索一期（v0.55，未发版）**：新增侧栏「磁力」（不带外网标志），主进程 `electron/magnet.ts` + `electron/magnetParse.ts`，默认资源库为 21 个（来自 2026-11-02 导出的 JSON，全部启用；文件 `src/shared/magnetSources.default.json`）；支持单源/全部搜索、分页、复制磁链、调起系统磁力下载器；「设置 → 磁力设置」支持资源库添加 / 修改 / 删除 / 批量导入 / 导出 / 启停 / 单个与整体检验 / 恢复默认；屏蔽广告、智能搜索、磁链去重改为内部固定开启，不再提供设置；结果支持大小/时间/名称升降序，默认大小降序。单个测试与搜索失败写入 `userData/magnet-test.log`，设置页可「打开日志」；不内置代理、不内置 BT 下载；过滤词表随包 `resources/magnet-filter-words.txt`。已用真实源与 CDP 验证搜索、导航和设置页。v0.54 按测试日志修正：列表超时 12s→20s、详情 8s→10s；列表/详情/API 超时或网络错误自动重试一次；整体测试只测已启用资源库且并发 4→2、详情并发 3→2；WebView2 源忽略反爬跳转产生的 ERR_ABORTED 后继续取最终页面；过滤导航/排序/分页详情链接，减少 DETAIL 误报。v0.55：默认资源库直接读取 `src/shared/magnetSources.default.json`（用户 2026-11-02 导出的 21 个源，全部启用），旧配置用 `configVersion=3` 一次性对齐；测试关键词统一改为 `saw`；WUQIAN 识别为站点人机验证、SKRBT 识别为域名已失效，测试日志给出明确原因而不是 0 条。

- 另：下载管理只在总目录显示「更改目录」，视频/漫画/本子/音乐/书籍子分区不再显示。

- 最新发布：**v0.109**（2026-11-09），Release 资产 `LaoZheng-0.109-Setup.exe`（108,100,148 字节），仓库已公开，应用内更新可用；Gist 清单已同步 0.109。

- v0.5 之后又完成 6 项：漫画/本子整本批量下载、下载页「本地打开」、Z-Library 账密保存 + 自动填表登录、更新包启动清理、pack-artifact 删除 `win-unpacked`、音乐 33ve 兜底。

- **2026-10-29 按手机端 v0.325 对齐 16 项**：侧栏品牌去掉「PC 端」并放大、导航改为 清单/观影/音乐/游戏/电视/吃瓜/图书/漫画/本子/番1~4/P站/X站；配置管理新增主题管理（显示模式 + 6 种主题色，本机 settings.json 持久化）、豆瓣登录（独立窗口取 Cookie，DPAPI 加密）、片源管理（影视源 + 电视源，从观影/电视页迁入）、清单管理（树形增删改）；数据管理只保留云同步 + 导入导出；下载页改目录时询问是否迁移旧内容并清理旧目录；配置管理新增清理缓存；版本更新改为点击即检查；清单封面优先取子清单/子项封面；观影搜索改为实时追加并带停止按钮；番1~番4 固定绑定手机端同款四个片源（不再依赖片源配置）；游戏/图书移除页内豆瓣收藏入口（豆瓣清单统一在「清单」）；删除 `CollectionPage`。

- **2026-10-29 第二轮 24 项界面/交互改造（v0.6 未完）**：

  ① 云同步增加坚果云官方教程链接（`https://help.jianguoyun.com/?p=2064`）；②③ 片源管理去掉小字说明/「只看已启用」/国内外网标记，影视源与电视源都加「整体测试 + 导出 + 有效/无效计数」，电视源每行加「测试 + 修改」，观影改为搜索全部已启用片源；④ 收藏管理改为按模块卡片（手机端 v0.325 口径），支持从模块右上角直达该模块收藏；⑤ 下载页不再显示目录路径，改为 视频/漫画/本子/音乐/书籍 分区切换；⑥⑦⑧ 清单支持网格/列表切换（默认网格）、子清单与条目同款卡片并列、封面为内部封面 4 宫格拼图、搜索框直接放在清单页、条目可点开详情页；⑨ 各模块页标题后的小字说明统一移除；⑩ 除首页/清单/设置外所有模块右上角加收藏与下载快捷入口；⑪ 电视去掉「IPv4 直播源 / 重载」整行，搜索框加搜索按钮，频道卡片可直接点心形收藏；⑫⑬⑭ 吃瓜分类显示数量、封面与正文图片改为主进程取图 + AES-128-CBC 解密（站点图床返回密文，key/iv 从 zzz.js 动态提取并内置实测兜底）、删除相关推荐；⑮⑯ 图书去掉右上角登录入口，Z-Library 登录改为真正打开窗口并新增「退出登录」，反爬失败时状态与提示同步；⑰⑱ 漫画列表改下拉（最近/热门/连载中/已完结）、加搜索返回按钮、分类带数量；⑲ 本子分类带数量；⑳ 番1~4 用 `ac=list` 取分类并逐类探测数量；㉑ P站排序改下拉、分类全展示并抓「Showing 1-x of N」数量；㉒ X站榜单改下拉、分类全展示并用列表 total 作数量；㉓ 模块页面改为常驻挂载（切页不卸载，搜索继续跑、状态互不干扰）；㉔ 列表/分类缓存落 localStorage，重开应用先显示上次内容。

- **2026-10-29 第三轮 28 项交互/详情改造（v0.6，仍未发版）**：云同步上传前自动 PROPFIND + 逐级 MKCOL（修复测试成功但上传 404）；收藏管理去掉「全部收藏」、11 个模块常显；下载管理改收藏同款模块卡片、删除改为移入系统回收站、配置管理下载项显示「文件数 + 总大小 + 目录」；清单页内嵌条目搜索，清单详情页内搜索并可移除条目、修复移除弹窗返回后才显示、封面按新加入排序；清单影视/图书/游戏条目详情改为逐条信息 + 评分黄星 + 简介/职员表/剧照/预告片/短评（热门/最新），影视条目可一键按名去观影搜源；观影/番1~4 点结果直接进播放页、默认最新集、集数倒序可切换、空分类隐藏、视频收藏带片源 payload 可续播并显示集数；VideoPlayer 按视频记录并续播进度；漫画/本子章节默认倒序、三种阅读模式（上下滑动 / 左右翻页滚轮缩放 / 网格）；全局内置音乐播放器（歌词同步、默认/单曲/顺序/随机、上下曲，覆盖音乐搜索/收藏/下载列表）；P站分页改 hasMore 不再只有 5 页、HLS 失败回退 mp4；X站/P站补 Referer/UA/Cookie 与 URL 归一化；Z-Library 搜索改先走分区直连、失败才回退隐藏窗口，并把 eapi 返回的数字 id/hash 转成字符串（修复「接口成功但显示 0 本」）；全局图片双击放大 + 右键保存；各模块补心形收藏；搜索再次点击可取消；侧栏进入模块统一回到首页（不回跳播放页）。

- 上述 v0.6 全部改动（含此前 6 项、手机端对齐 16 项与两轮共 52 项）**截至 2026-10-29 尚未提交、未发版**；开工前先 `git status` 确认，避免重复实现。

- 2026-10-29 追加：云同步识别 WebDAV 根目录（`/dav/` 或 `/`），自动使用并创建「老郑分享」子目录，修复坚果云 `PUT /dav/data.json` 404；下载仍会回退到旧根目录的 `data.json`。

- 2026-10-30 已生成 **v0.51** 安装包：`release/老郑分享 Setup 0.51.exe`（107,121,585 字节，SHA256 `0EC496E5FF6D8D877652F854AA09B7414996E3970F76AB0B8D2CF828FEADBCB4`，含随包 ffmpeg）。**按用户要求先不上传 GitHub 资产**，Release v0.51 已发布但暂无安装包附件（正文已注明「安装包暂缓上传」）。

- **2026-10-30 第四轮 60+ 项交互修正（v0.6，未发版）**：路由从「单层 backRef」改为真正的返回栈（`App.tsx` stack + push/back），清单逐级返回、收藏管理进条目返回收藏夹、模块右上角收藏/下载返回上一页且不越级；新增全局下载中心 `components/DownloadCenter.tsx`（所有模块下载先确认，左下角悬浮进度，失败任务取消时清理 `.part`/切片/新章节目录）与 `utils/download.ts` 事件入口；`ui.tsx` 新增 `Pagination`（5 个页码 + 首页/尾页 + 手填跳转）与 `LoadingBlock`（分类切换请稍等）；红心统一红色、详情标题超长省略；图片查看器去掉右键菜单与缩放按钮，底部只留保存并记住上次保存目录（`settings.lastImageDir`）；清单搜索结果可直接进详情（`SearchPage` 内置 `ItemDetail`/`PersonDetail`）、新增人物详情接口 `subject:person`（rexxar celebrity/personage/author 回退）与演职员/图书作者头像卡片、剧照/职员表/目录/游戏截图默认折叠「查看全部」；观影播放页去掉下载、返回走上一页；音乐默认单曲循环、歌词点击跳转、搜索结果带下载、收藏/下载列表按最近/歌手排序且更紧凑并显示时长；本子去掉排序下拉与刷新、最新/热门前置；P站/X站去掉下拉与详情弹窗（点卡片直进播放）、分类按钮前置；吃瓜/本子/漫画/图书/游戏/番1~4/X站/P站全部换新分页器；下载管理视频改网格、只留播放（系统播放器）+删除、去掉刷新；HLS 下载完成后用随包 ffmpeg（`@ffmpeg-installer`，打包后位于 `resources/app.asar.unpacked/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe`）无损合并为单个 mp4；新增 `downloads:playItem` / `downloads:readItem`（漫画按章返回本地图片、PDF 直接 iframe、EPUB 用 `adm-zip` 解包后按 OPF spine 打开）；Z-Library 状态增加今日已下载/额度探测（`/eapi/user/profile`，拿不到时提示以站点为准）；P站分类实际走 `/video?c=` 修复切换分类空列表，下载/切片补 phncdn Referer+Cookie；CSP 增加 `frame-src` 并开启 `plugins` 以便应用内看 PDF。**新增依赖 `@ffmpeg-installer/ffmpeg`、`adm-zip`（打包时 adm-zip 打进主进程 bundle，ffmpeg 作为生产依赖由 electron-builder 自动解包）。**

- **2026-10-30 第五轮 23 项交互修正（v0.6，未发版）**：① 图片查看器遮罩点击可关闭（只停止图片本身冒泡，双击图片才缩放）；② `.page-header` 全局吸顶（`position:sticky; top:-26px` + 负边距铺满左右留白），标题/副标题单行省略，按钮 `flex:0 0 auto` 不再被挤变形；③ P站播放根因是媒体签名地址会瞬时 403/410：`pResolve` 并发探测各清晰度 HLS，取最高可用 + 第二路回退，全部失败时重开视频页重试一次，仍失败则把最高清交给播放器，渲染进程 `mediaCache` 10 分钟过期（实测首卡可播放）；④ HLS 下载不合并的两个根因：ffmpeg 解析本地 m3u8 相对切片时以 cwd 为基准（`execFile` 未传 `cwd: folder`），以及 `app.isPackaged` 在 `electron .` 下也返回 true 导致只找安装包路径；`ffmpegBinary()` 改为同时列 dev / asar / resourcesPath 路径，`mergeHlsToMp4` 传 cwd；启动时 `repairLegacyHls()` 修复旧 `hls:true` 记录，并扫描「视频」下带 `index.m3u8` 的孤儿目录合并 + 补登记（实测本地 HLS 下载合并为 `video.mp4`、`hls:false`）；⑤ 所有模块在 focus/focusId 清理时清空内部播放/详情状态，`onExit` 先清状态再 pop；App 切页后暂停隐藏 slot 里的 video/audio；VideoPlayer 卸载时 pause + stopLoad + destroy + 清 src（实测切到设置后 P站视频 paused=true 且时间不再增长）；⑥ 观影默认最新集失败自动退到上一集（每次播放只退一次）；⑦ 清单演职员/剧照「查看全部」移到标题后，`SubjectFull.creditsTotal` 显示「共 N 人」，图书作者改用 `/book/{id}/credits`（带 id + 头像、可点进人物页），预告片增加关闭按钮，清单网格卡片显示评分；⑧ 人物详情重做：celebrity 接口只返回 `extra.info` 键值对 + `cover`，简介从 `m.douban.com/personage/{内部id}/` 的 meta description 取，作品解析 `o.work`，获奖解析 `/awards` 的 `celebrity_award` 模块，新增 `/photos`，最近作品按年份、收藏最多按 `rating.count`，照片/作品均可查看全部，作者走 `/author/{id}` + `/author/{id}/works`；⑨ 漫画去掉下拉与「返回漫画首页」，最近/热门 chips 放在分类前（默认最近），最近/热门/搜索用指数 + 二分探测末页并缓存，分页器显示共 N 页；⑩ 吃瓜正文视频改成「播放视频 / 下载」按钮下方的内嵌播放器（带关闭），不再跳播放页，正文过滤关键词 / 猜你喜欢 / 原文简介 / 版权声明等尾部文案；⑪ 图书下载去掉「阅读」只留「本地打开」，电视卡片红心去掉黑色圆底，配置管理收藏图标不再套用红心色，番1~4 封面显示 `vod_duration`。

- **2026-10-30 第六轮 16 项交互/缓存修正（v0.6，未发版）**：① 全局缓存：新增 `electron/imageCache.ts`（所有 http(s) 图片请求重定向到 `lzimg://`，按 URL 哈希落 `userData/image-cache`，重开应用秒开；豆瓣旧图床域名重写也在这里）与 `electron/apiCache.ts`（搜索 / 列表 / 详情响应落 `userData/api-cache`，只缓存成功响应）；吃瓜解密后的图片同样落盘；「清理缓存」新增 image-cache / api-cache。② 启动态：各模块重开应用回到默认分类 / 空搜索（吃瓜最新、P站推荐、X站最新、漫画最近、本子默认排序、游戏首页、番号第一页），默认列表与图片直接读缓存；localStorage 只写默认视图，避免搜索状态把默认缓存覆盖。③ 收藏管理每条 / 每卡增加删除按钮，番号 / P站 / X站改视频网格。④ 清单演职员表「查看全部」改为隐藏窗口打开豆瓣 celebrities 页（自动过 sec.douban.com JS 校验），拿到整页名单并按部门分组（实测 42 / 84 人），姓名去掉英文后缀、部门去掉英文。⑤ 人物详情修复：先 `personage/{id}` 解析 celebrity_id / author_id（搜索与演职员页给的 id 都是 personage），导演作品只留「导演」角色并剔除 `is_released=false`，作者走 author works；标题改为「导演作品 · 最新 / 热门」。⑥ 清单详情加载中不再显示「暂无」，次要数据最多等 6 秒；条目 / 人物 / 短评响应 7 天缓存。⑦ 分页器翻页后自动回到顶部。⑧ 观影收藏续播：`readProgress` 记录最后观看的集数（`vodEp|sourceId|vodId`），从收藏进入优先续该集。⑨ 番1~4 卡片与播放页补下载按钮；列表缺时长时后台补拉详情（前 16 条、并发 3）；时长只认真实时间，过滤 0 / HD。⑩ 吃瓜视频按钮去掉标题文字、改显示视频时长；下载补镜像 Referer，HLS 下载失败自动刷新播放列表换新签名，ffmpeg 合并区分 fMP4 / TS 并多一次转码兜底。⑪ 图书今日额度从详情移到搜索框右侧。⑫ P站 / X站从收藏进入先显示解析页、不再闪列表，进播放页自动回顶部；P站播放失败自动重解析一次，HLS 备线可退 mp4 直链，探测超时 15s→8s。

- **2026-10-30 第七轮 8 项修正（v0.6，未发版）**：① 所有分页器翻页后立即把 `.content` 滚到顶部（并补两帧，避免列表重渲染把位置带回去）；② 人物作品不再按导演 / 演员 / 编剧过滤，统一展示全部已上映作品（与豆瓣 creations 页一致），标题改为「作品 · 最新 / 热门」，卡片改为 96px 紧凑海报；③ 图书作者同时合并 celebrity 档案的照片 / 获奖 / 性别等，作者页不再空白（实测刘慈欣 44 张照片）；④ 图片查看器底部增加「上一张 / 保存 / 下一张」，支持键盘左右键，同一区块图片自动成组（漫画章节传整章列表）；⑤ 吃瓜正文过滤「最新域名 / 永久域名 / 可能你会感兴趣 / 热门吃瓜 / AI 成人短剧」等尾部推荐文案；⑥ 吃瓜视频时长：HLS 由主进程累加 `#EXTINF`（新增 `melon:duration`），直链用隐藏 video 元数据；实测页面显示「时长 9:56 / 0:13」；⑦ **HLS 下载不合并的真正根因**：播放列表的 `METHOD=AES-128` 没有引号，旧 `attr()` 只匹配带引号属性，导致密文被当明文保存、ffmpeg 无法解析；现同时支持带引号 / 无引号属性，启动时对旧的 `hls:true` 记录按远端 key 就地解密再合并（实测用户 97MB / 35MB 两条吃瓜下载都自动修成 video.mp4）；⑧ 下载记录新增 `referer`（吃瓜自动写入镜像 Referer），下载 / 重试 / 修复复用；HLS 切片失败时刷新播放列表换新签名。

- **2026-10-30 第八轮 4 项修正（v0.6，未发版）**：① 图片查看改为「详情页内图片单击打开」（剧照 / 人物照片 / 吃瓜正文 / 漫画），封面、卡片、按钮里的图片点击仍然只做跳转（实测详情图单击打开、按钮内图片不拦截）；② 人物作品卡片可点击进入对应条目详情页（`PersonWork.kind` 区分 movie / tv / book，`personWorkToItem` 转成条目结构），搜索页与清单详情页都支持逐级返回；③ HLS 下载不再建 `<标题>/video.mp4` 目录：切片先下到 `.hls-<taskId>` 临时目录，合并成功后重命名为「视频/<标题>.mp4」并删目录，失败才保留以标题命名的切片目录；启动时把旧的 `视频/<标题>/video.mp4` 自动平铺并删目录（实测三条视频记录全部变成扁平 mp4）；④ 番1~4 卡片去掉「播放 / 下载」按钮，点封面即播放，下载统一放在播放页。

- **2026-10-30 第九轮 7 项修正（v0.51，已发布）**：① 清单搜索结果详情右上角按收藏状态显示「加入清单」（未收藏）/「从清单移除」（已收藏，移除所有清单关联并删除条目）；详情打开时隐藏「我的清单」独占整页，侧栏重进清单会关闭详情；② 侧栏图书 / 漫画 / 本子 / 番1~4 / P站 / X站补回「外网」小字（`.nav-suffix`，共 9 个）；③ 缓存改为「永久命中 + 静默后台刷新」（`apiCache` 命中即返回，过期只后台更新；带播放直链的接口保留最长陈旧时间：vod/xsite/melon/zlib 6h、live 30min）；「清理缓存」同时清主进程内存缓存与 `localStorage` 列表缓存并自动重载，下载任务进行中不删 `.part`；下载页 / 左下角悬浮窗去掉轮询，改用 `downloads:changed` 事件；④ 备份补齐电视源、下载记录、本机设置（主题 / 下载目录 / 上次图片目录）：导出与云上传由主进程 `buildBackupPayload` 统一合并，导入 / 云恢复经 `data:applyExtras` 写回（下载记录按相对路径去重合并）；退出前 `data:saveSync` 同步落盘；data.json 损坏先另存 `.broken-*`，临时文件名加随机后缀避免竞态；⑤ 关闭窗口改为隐藏到右下角托盘（`resources/tray.png`，托盘菜单 显示 / 隐藏 / 退出；单实例再次启动会恢复窗口），托盘退出才真正关闭；⑥ **导入导出与云同步保持纯手动**，不做自动上传 / 下载；⑦ 人物作品等由详情内部再打开的条目，右上角自动显示收藏状态（新增 `components/CollectAction.tsx`：未收藏「加入清单」、已收藏显示所在清单并可「从清单移除」，弹层用 portal 挂到 body 避免被吸顶头裁剪）。实测（打包产物 + CDP）：搜索详情显示「加入清单」、清单详情显示「从清单移除」、外网小字 9 个、关窗后进程存活且 handle=0、二次启动恢复窗口、`applyBackupExtras` 幂等、`npm run build` 通过。

## v0.51

- **v0.51 发版记录（2026-10-30，安装包 2026-11-02 由 CI 补传）**：commit `6dca554` / tag `v0.51` / Release `428847993`（https://github.com/Bug142857/LaoZheng/releases/tag/v0.51）。安装包已由 GitHub Actions 自动构建并上传：`LaoZheng-0.51-Setup.exe`，107,124,070 字节，digest `sha256:66208d0bd7c86fd7a496387c0742a70fd33a9303a1f6f5f442f8f13ce8dfdf12`，Actions run `41371428560`（构建约 2 分钟）；Release 正文已改成正常下载说明。

## 其他记录（规则 / 发版 / 安装包）

- **GitHub 资产上传踩坑（2026-10-30）**：本机 Clash / TUN 会把 `uploads.github.com` 解析到假 IP `198.18.0.200`，107MB 安装包上传会长时间卡住（Node fetch 报 headers timeout、curl 写完无响应）。用 DoH 拿真实 IP（本次 `20.205.243.161`），再执行 `curl --resolve uploads.github.com:443:<真实IP> --noproxy "*" -H "Expect:" --data-binary @文件` 可直连；不过 2026-11-02 起已改用 GitHub Actions 构建上传，正常不再需要本机传包。

- **2026-11-02 GitHub Actions 自动构建（用户要求，替代本机上传）**：新增 `.github/workflows/build-release.yml`：`windows-latest` + Node 22 + `npm ci` + `npm run dist`，把安装包复制成 ASCII 资产 `LaoZheng-<版本>-Setup.exe` 并 `gh release upload --clobber`；推 `v*` tag 自动触发并自动建 Release，`workflow_dispatch` 可填 tag 补传。仓库 Actions Secrets 已配置 `ACCOUNTS_SEED`（内容为本机 `.secrets/accounts.json`，215 字节，用 tweetnacl-sealedbox-js 按 GitHub public key 加密后写入），CI 构建时还原 `.secrets/accounts.json`；未配置时用 `{}` 构建并 warning（无内置账号）。以后发版只需改版本号 → 提交 → push → 打 tag，不再本地打包 / 上传。

- **已知限制**：豆瓣 celebrities 整页名单依赖隐藏窗口通过 `sec.douban.com` 的 JS 校验（约 3 秒）；若长时间取不到会回退显示接口返回的主要演职员。旧版本已下载的加密 HLS 目录（切片不是 0x47/TS）无法在本地找回密钥，合并会失败并保留原目录。

- **版本号规则（2026-10-30 用户重新定义，2026-11-02 再次强调）**：当前 **v0.82**；**每次修改都必须先把版本号 +1**（`0.81 → 0.82 → 0.83 …`），即使不上传 GitHub / 不发 Release / 只是补功能或修 bug，也照样递增，不能攒到发版才改。
