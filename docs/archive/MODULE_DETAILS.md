# 老郑分享 · 模块实现细节归档

> 来源：`docs/AI_PROJECT_MEMORY.md`「一、7. 各模块实现口径」「6. 当前进度」，以及原 `.trae-cn` project_memory 的模块规则，原文搬运。
> 主文件每个模块只保留 ≤3 行索引；需要完整接口 / 解析 / 站点规则时读本文件（先 Grep 关键字再 offset 读）。

### 7. 各模块实现口径

#### 7.1 条目搜索（`electron/douban.ts`）

- 网络请求全部在主进程，渲染进程只走 `subject:search` / `subject:detail`，参数白名单校验。
- 影视：`movie.douban.com/subject_search?...&cat=1002`（按 labels 的「剧集/电视」或 URL `/tv/` 区分）+ `www.douban.com/search?cat=1002` 兜底合并；
- 图书：`book.douban.com/subject_search?...&cat=1001`（`window.__DATA__`，过滤 `/series/` 丛书）；游戏：`www.douban.com/search?cat=3114`；人物：`cat=1065`（只展示不落库）。
- `window.__DATA__` 用**括号配对**截取；反爬 / 空壳页面显式抛错并重试，不静默返回空。
- 详情走 `m.douban.com/rexxar/api/v2/{movie|tv|book|game}/{id}`（移动 UA + m.douban Referer）；`category` 用中文 label（电影/剧集/图书/游戏），按 `category + doubanId` 去重。
- UI 硬约束：界面文案不出现「豆瓣」、无「在豆瓣打开」外链、搜索必须显式分类。

#### 7.2 观影 / 番N（`electron/vod.ts`）

- 苹果CMS V10：`?ac=videolist&wd=` 搜索、`&ids=` 详情；`vod_play_url` 按 `$$$` 分组、`#` 分集、第一个 `$` 切名称/URL；默认只留 3u8 线路，全无 3u8 才回退。
- 标题归一化匹配：精确 3 分、互相包含 2 分、同年份 +1，低于 2 分不展示。
- 渲染进程按 6 并发逐源搜索，结果随返回实时追加；片源测速区分 ok / dead / proxy，`regionManual` 为 true 时不覆盖手选目录。
- 观影分类（v0.91）：首页榜单走公开影视榜单 `movie.douban.com/j/search_subjects`（sort=recommend），每个分类 1 个请求；主进程 `cachedResponse` 缓存 1 小时（按豆瓣登录态分 key），渲染进程缓存热门第一页 `watch_hot_douban`；10 个分类按电影 / 剧集标签映射，热门与日韩电影合并两个榜单交叉去重；点海报直接按片名跨源搜索片源，不再为首页拉几十个采集源。
- 番1~番4 = 第 1~4 个「已启用且 region=proxy」的片源，复用观影搜索/播放，收藏 module = `h1`。

#### 7.2.1 短剧（`electron/drama.ts` / `src/pages/DramaPage.tsx`）

- 参考 `jackotom/hongguo-drama`，四个源：`hongguo`（红果官网）、`xifan`（西饭 App 接口）、`hema`（河马官网）、`custom`（复用影视源里的苹果CMS）。
- 红果：目录 `/category/{real-drama|comic-drama|ai-drama}`、榜单 `/rank/hot-drama` 解析页面内 `_ROUTER_DATA` / `<article>`；搜索 `GET /api/search/result?aid=8662&query=&page=`；详情 `/player/{seriesId}` 取 `seriesDetail.vid_list`；播放抓 `/player/{sid}/{vid}` 的 ld+json `VideoObject.contentUrl`（仅公开前 N 集，超出会 302 回第 1 集并带 `pc_locked_episode`）。
- 西饭：`/xifan/drama/portalPage`（分类 / 列表）、`/xifan/search/getSearchList`、`/xifan/drama/getDuanjuInfo`（详情 / 分集 / playUrl，`unlock !== true` 视为锁定）。
- 河马：`/browse` 与 `/browse/{slug}/{page}` 解析 `__NEXT_DATA__`；搜索 `POST /seo/video/6007`；详情 `/drama/{bookId}`；播放 `chapterVideoVo.mp4720p || mp4`，`isCharge !== '0'` 为付费锁定。
- 自定义：`seriesId` = `vod_id`，分集 id = `线路:集数`；详情 / 播放都走现有 `fetchVodDetail`，播放地址与观影一致（HLS 走 hls.js）。
- 主进程 IPC：`drama:catalog` / `drama:detail` / `drama:play`，全部做来源与参数白名单校验；目录缓存 10 分钟、详情 10 分钟、播放地址 1 分钟且最长陈旧 2 分钟。
- 页面默认列表按源写 `localStorage`（`drama_<sourceId>`），上次源写 `drama_last`；分类超过 12 个时改用下拉，避免河马 100+ 题材铺满页面。
- 片源管理「短剧源」折叠区默认收起；内置源可改名 / 改地址 / 删除，自定义源必须填苹果CMS 地址。
- v0.117 现状：红果 / 河马代码保留兼容旧数据，新配置只有 `xifan` + `rou07` 两个内置源；`rou07` 复用 `electron/shuangkan.ts`（见 v0.117 记录），`seriesId` 就是站点 `/s/<id>` 的 id，分集播放走 `/v/<id>` 的 ev 解码，搜索 `/search?q=&tab=series` 只有一页；`DramaPage` 用 `isBuiltinDramaSource()` 判断内置源，不再逐处比较 `xifan`。

#### 7.3 电视（`electron/live.ts`）

- 电视源单独存 `userData/live-sources.json`（首次启动播种内置 IPv4 源），不进备份 JSON。
- M3U 解析：`group-title` / `tvg-name` / 逗号后频道名，同一地址只留第一条；网络源 20s 超时，本地导入存 `content`。

#### 7.4 音乐（`electron/music.ts`）

- 无名音乐网（mvmp3）：`GET /so.php?wd=&page=` 解析 `<li>` 卡片，`POST /style/js/play.php` 表单 `id + type=dance|music|mp3` 拿直链与歌词；直链缓存 4 分钟。
- 33ve 兜底：与 mvmp3 同一套建站系统，接口完全一致；mvmp3 搜索失败或空结果时自动搜 33ve，歌曲 `platform = s33ve`，播放时按 platform 选站点。旧收藏回退依次试 mvmp3 → 33ve。
- 播放直链来自酷我 CDN，只需 UA（请求层已统一补 UA）。

#### 7.4.1 小说（`electron/novel.ts` / `src/pages/NovelPage.tsx`）

- 默认书源 3 个：蚂蚁文学（`https://www.biquges.com`，实际 301 到 `http://www.mayiwsk.info`）、九五小说（`http://www.95dushu.info`）、玄幻阁（`http://www.xuanhuange.info`）；后两个是固定模板 `95dushu` / `xuanhuange`，书籍编号都是纯数字，目录按 `floor(id/1000)` 分目录。
- `canonicalBases` 记住 301 落地域名，搜索 / 详情 / 正文直接请求真实域名，避免 POST 跟随 301 退化成 GET 丢搜索参数。
- 九五：搜索 `GET /modules/article/search.php?ie=gbk&searchkey=`（结果表 `.grid tr`，作者 / 最新 / 状态齐全），详情 `/bookbook/{id}.html`（`.con_limg` 封面、`.r_cons` 简介、`fullflag("连载中")` 状态），目录 `/{dir}/{id}/` 的 `.novel_list dd a`，正文 `.yuedu_zhengwen`；首页 `.book` 卡片会并发抓详情页补作者 / 状态。
- 玄幻阁：搜索 `GET /modules/article/search.php?s=7673184438602983814&s={key}&searchtype=articlename`（`#sitebox dl`，作者 / 状态在 `.book_other`），详情 `/files/article/html/{dir}/{id}/`（`#bookimg` 封面、`#count .pd_r` 作者 / 分类 / 状态、`#chapterlist li a` 目录），正文 `#content`（开头「随机推荐：」行已在 `JUNK_LINE_PATTERNS` 里过滤）；首页推荐卡片 `dl` 6 条，并发抓详情补状态。
- 首页 / 搜索解析封面、作者、书名；搜索表格状态 `完成/连载`、`连载中/已完结` 统一成 `完结/连载`；搜索同时匹配书名与作者（作者命中排在书名之后）。
- 页面统一口径：搜索框前「全部源（N）/ 单源」下拉（默认全部源）；卡片副标题「作者 · 完结/连载」；封面加载失败回退占位图标；卡片右上角心形收藏（module=`novel`，id=`sourceId|bookId`）；列表客户端分页 24 条/页。
- 整本下载：详情页「下载 TXT」把已加载章节（最多 2 万章）按 5 并发抓正文，合并 UTF-8 BOM 的 TXT 到「下载目录/小说/<书名>.txt」，进度走 `novel:downloadProgress`；下载记录 `kind='novel'`，下载管理有「小说」分区。
- 带源模块统一约定：搜索框前放「全部源（N）/ 单源」下拉（音乐 / 短剧 / 电视 / 磁力 / 小说），新模块照此实现。

#### 7.5 下载（`electron/downloads.ts`）

- 目录：系统下载目录/老郑分享/{视频,音乐,漫画,图书,小说}；记录 `userData/downloads.json`。
- **下载前必须先提示（2026-11-04 用户硬性要求）**：所有带下载功能的入口都要先弹确认，不允许点击即直接下载。普通视频 / 音乐 / 番剧 / 吃瓜 / P站 / X站走 `requestDownload` → `DownloadCenter` 的「确认下载」；漫画 / 本子批量走各自 `ConfirmDialog`；图书走「下载图书」确认；音乐走音质 / 大小选择窗口；小说走「下载小说」确认框。新模块照此实现。
- 漫画批量：`downloads:addComicBatch` 接收整本 chapters（每章 urls），按章串行、章内 5 并发写入 `漫画/<书名>/<章节>/0001.jpg…`，同序号文件跳过（断点续传），完成后写 `meta.json`（source/comicId/title/cover/chapters）；单章下载复用同一接口。
- 下载页「本地打开」走 `shell.openPath`：文件用系统默认应用打开，目录型（漫画）打开文件夹。
- 直链：流式写 `.part` → rename，按 Content-Length 报进度。
- HLS：master 选最高码率 → 解析切片 / EXT-X-KEY / EXT-X-MAP → 5 并发下载、AES-128-CBC 解密（无 IV 时按序号构造）→ 生成本地 `index.m3u8`。
- 本地播放：`http://127.0.0.1:{随机端口}/media/...` 提供 Range + CORS；端口每次启动变化，列表时动态拼 `playUrl`。

#### 7.6 X站 / P站

- X站（pektino）：`/api/media?range&page&per_page&sort=favorite&category&lang`、`/api/tags`、`/api/media/{url_cd}`；直链在 video.twimg.com，可直连。
- P站：列表/搜索网页解析 `li[data-video-vkey]`，详情从 `mediaDefinitions` 数组（括号配对截取）选最高数值清晰度 HLS，失败退 mp4 / 全页正则；带年龄 cookie。**P站 CDN 对部分节点校验 Referer，请求层对 `*.phncdn.com` 统一补 `Referer: https://www.pornhub.com/`**。
- 收藏 module 分别 `xsite`（id = urlCd）/ `psite`（id = vkey）。

#### 7.7 吃瓜（`electron/melon.ts`）

- 着陆页 `www.ipqegzvg.cc` 是 Base64 混淆，解码提取镜像 + 兜底列表，逐个探活（页面须含 `post-card`），301 后采纳落地 origin。
- 列表：`article div.post-card`，封面在 `loadBannerDirect('...')`；翻页跟随站点 next；正文 `[itemprop=articleBody]`，视频在 `.dplayer[data-config]` 的 `video.url`（HLS，auth_key 有时效）。
- 图片真实地址在 img 任意属性里（src 是占位图）；`txt-apps` / `table` / `blockquote` / banner 全部跳过。

#### 7.8 云同步 / 更新

- WebDAV：配置存 `userData/sync.json`，密码用 `safeStorage` 加密；上传 PUT `{目录}/data.json`，恢复 GET 并校验 items/lists/listItems；测试连接用 PROPFIND（207/200）。
- 更新：`app:checkUpdate` 先查 GitHub Releases API（公开仓库可匿名读 exe 资产），失败回退公开 Gist 清单（`gist_id=802551160083623580189fc536724d65`，字段 `version / url / exe / notes`）。**检查与下载都先测速选线**：直连 / gh-proxy.com / ghproxy.net 三条线路并发探测（检查用并发请求取最先完整返回，下载用 `Range: bytes=0-0` 只等响应头），可用的按延迟从低到高排序，不可用的排最后兜底；完成后 `spawn` 安装包打开 NSIS 安装向导并退出应用。**仓库必须公开**，否则匿名读取 Release 资产会 404。应用启动时会清空 `userData/updates` 里的旧安装包。

#### 7.9 播放与请求层规则（`electron/main.ts setupRequestRules`）

- hls.js 需要 `blob:` MediaSource：CSP 必须含 `media-src 'self' blob: http: https:` 与 `worker-src blob:`（v0.2.0 曾因此播放全黑，实测已修）。
- 单一 `onBeforeSendHeaders`：豆瓣图片补 m.douban Referer + iPhone UA；`*.phncdn.com` 补 pornhub Referer + 移动 UA；`komiic.com/cc` 的 `/api/image/*` 注入 `Cookie: komiic-access-token` 与完整路径 Referer；`*.picacomic.com / *.go2778.com` 补 `okhttp/3.8.1` UA；其余 media / m3u8 分片补移动 UA。
- 单一 `onHeadersReceived`：对 xhr / media 注入 `Access-Control-Allow-Origin: *`（远端多数流不带 CORS，必须注入）。
- `onBeforeRequest`：`qnmob*.doubanio.com` 重写到 `img2.doubanio.com`。
- `node-html-parser` 通过 `externalizeDepsPlugin({ exclude: [...] })` 打进主进程 bundle，避免安装包漏依赖。

#### 7.10 内置账号 / 本子 / 漫画（v0.4.0）

**账号仓库（`electron/accounts.ts`）**

- 账密与 token 用 `safeStorage`（Windows DPAPI）加密后存 `userData/accounts.json`，任何日志 / 备份 / 代码都不出现明文。
- 首次启动从种子导入：安装包 `resources/accounts.seed.json`（electron-builder `extraResources` 由本机 `.secrets/accounts.json` 生成），开发态回退 `app.getAppPath()/.secrets/accounts.json` 与 `cwd/.secrets/accounts.json`；`.secrets/` 已 gitignore。
- 状态机 `ok / failed / pending / unknown`，变化时向所有窗口广播 `accounts:changed`；设置页「账号管理」只显示用户名与状态。
- 账号 seed 缺字段时按站补齐，不覆盖已有 token。

**哔咔（`electron/bika.ts`）**

- 常量与手机端 `BikaClient.kt` 完全一致（API_KEY / SECRET / NONCE / 伪造头）；签名 `HmacSHA256(SECRET, lowercase(path+query+time+nonce+METHOD+api-key))`，不含域名。
- 双域名 `picaapi.picacomic.com` → `picaapi.go2778.com` 自动回退；401 清 token 后内置账密静默重登并重试一次。
- 接口：`auth/sign-in`、`categories`、`comics?page&c&s`、`comics/advanced-search?page`、`comics/{id}`、`comics/{id}/eps?page`（并行拉全部分页）、`comics/{id}/order/{order}/pages?page`（并行）。
- 图片 `fileServer + /static/ + path`，仅需 UA，不需要 token；请求层统一补 `okhttp/3.8.1`。
- 实测（2026-10-28）：登录 OK、分类 40、列表 20 条 / 7236 页、详情 / 章节 / 单章 86 图、图片 200 JPEG。

**Komiic（`electron/komiic.ts`）**

- `POST /api/login {email,password}` 拿 token（24h），本地缓存 20h 后自动续期；GraphQL `POST /api/query` 带 Origin/Referer/Sec-Fetch 与 `Authorization: Bearer`。
- 双主机 `komiic.com` → `komiic.cc`；GraphQL 报 token 失效时清缓存重登再试一轮。
- 查询：`recentUpdate / hotComics / comicByCategories / searchComics / allCategory / comicById / chaptersByComicId / imagesByChapterId`，分页 `limit=20, offset, orderBy, status, asc:false`。
- 章节图 URL 形如 `/api/image/{kid}?c={comicId}&ch={chapterId}`，主进程请求头注入 Cookie（只放 `komiic-access-token`，不能混空值 Cookie）与 `https://komiic.com/comic/{c}/chapter/{ch}` Referer。
- 实测（2026-10-28）：登录 OK、分类 71、最近 20 部、详情 / 9 章、单章 23 图 200。

**无忧（`electron/wygamer.ts`）**

- WordPress + Zibll：账密 AJAX 需要滑块验证，但 `slidercaptcha.min.js` 的校验纯前端（`Math.abs(block.left - x) < 8` 且轨迹方差非 0），`getX` 自己会请求 `action/captcha.php` 拿 token。
- 方案：隐藏 `BrowserWindow`（`persist:wygamer` 分区）填表点登录 → 轮询 `.slidercaptcha` 实例拿到 `x` → 合成 `pointerdown/move/up`（26 步、带 y 抖动）拖到 `x/ratio` → 前端自动重提 → 轮询 `wordpress_logged_in_*` Cookie 判定成功；最多 3 次，失败才降级为可见窗口让用户手动滑。
- 成功后 Cookie 持久化在分区，启动先校验会话（首页 body.logged-in），有效则直接复用；`remember=forever`，每次启动访问首页会续期。
- 实测（2026-10-28）：首次自动滑块登录成功、会话校验 true。

**页面**

- `BikaPage` / `ComicPage`：列表缓存、搜索、分类、详情、章节、纵向阅读（上一话/下一话），收藏分别写 `h2` / `comic`；切模块时 `.content` 自动回到顶部。
- 阅读进度：打开章节成功取到图片后写 `readProgress["comic/{id}"]` / `readProgress["bika/{id}"]`；详情页给「继续阅读」并高亮上次章节。
- 「下载本章」走 `downloads:addImages`，图片并发 5 张写入 `下载目录/老郑分享/漫画/<书名> 第x话/0001.jpg…`，下载库记为目录型（`folder: true`）。
- 图片全部由渲染进程 `<img>` 直连，主进程请求层补头，不经过 base64 中转。

**无忧游戏库（`electron/wygamer.ts` 追加部分）**

- 请求走 `persist:wygamer` 分区的 `session.fetch`，自动带登录 Cookie；列表 `posts.posts-item`（封面取 `data-src`），分类用 WP REST，翻页扫 `/page/N` 最大值。
- 详情：`h1.article-title`、`.pay-attr`、`.pay-box a[href*=/pay-download/]`、`.article-content` 截图与正文、`[data-clipboard-tag=解压密码]`。
- 网盘链接：`/pay-download/{id}?key=&down_id=` 会 302 到 pan.xunlei / pan.quark 等分享页，取 `res.url`；解析失败再用 meta refresh / location 兜底。实测（2026-10-28）：首页 24 条、详情属性 / 4 个下载按钮 / 6 张截图 / 解压密码 `sygua.cc`、夸克链接解析成功。

**Z-Library（`electron/zlib.ts`）**

- 隐藏 `BrowserWindow`（`persist:zlib`）打开当日线路首页，接口在页面内 `fetch`，绕过 DiamWall；线路从 `getzlib.com/zh` 解析，兜底 `z-lib.sk / zh.z-lib.sk`。
- 搜索必须 POST 表单（GET 恒 400「未找到请求的书」）；详情用 GET；未登录文案统一换成可操作提示。
- 登录：设置页保存账号密码（`safeStorage` 加密到 `userData/zlib-account.json`）；启动时 `autoZlibLogin()` 静默填表登录，失败再打开可见窗口并预填账号密码。登录窗口的输入框用原生 setter + input/change 事件填写，再点提交。
- 下载：打开站点 `/dl/{token}`，监听 `will-download` 同步 `setSavePath` 到 `下载目录/老郑分享/图书`，完成后 `registerLocalFile` 登记下载库。

#### 7.11 壁纸（`electron/wallpaper.ts` / `src/pages/WallpaperPage.tsx`，v0.107）

- 导航：只有一套侧栏导航，壁纸在「小说」之后、「漫画」之前；硬件（原「电脑信息」，v0.110 改名）不在导航里，应用默认页 = 硬件，点侧栏顶部「老郑分享」进入。类型与收藏 payload 口径在 `src/shared/wallpaper.ts`。
- 壁纸源：`data.wallpaperSources` 可增删改（`id/name/baseUrl/template/enabled/testStatus/testMsg/testAt`），`template` 支持 `wallspic` / `bizhimi` 两种站点模板；默认顺序「壁纸迷 → Wallspic」，默认 `testStatus='ok'` / `testMsg='可用'`；缺失补默认、删空不补回，老数据里 Wallspic 在前会在 `normalizeWallpaperSources` 里调换；渲染层列表缓存 key 是 `wallpaper2`。源配置随整份备份、云同步、整体导入导出走。片源管理「壁纸源」卡片位于「番号源」之后，支持添加源 / 批量导入 / 整体测试 / 导出，每行测试 / 停用启用 / 修改 / 删除。
- 站点口径：Wallspic 列表 `/album/<种类/设备>`（翻页 `?page=`，搜索 `/search/<kw>`）、壁纸迷电脑 `/` 或 `/?cat=<id>`、手机 `/wallpaper/mobile-wallpaper`。壁纸迷手机分类读手机页「标签」区（`.archive-tags a.bc-tag`，20 个），列表 `/wallpaper/mobile-wallpaper?tag=<slug>`、翻页 `/page/N?tag=<slug>`；数量用 `data-tag-id` + WordPress REST `/wp-json/wp/v2/posts?categories=5626&tags=<id>&per_page=1` 的 `X-WP-Total`（失败则隐藏该数量）；电脑分类读筛选分类（42 个）。
- 解析：Wallspic 读 `window.mainGalleryTarget`（pages / total）与 `window.mainAdaptiveGallery.list`（每页 30 条，thumbnail / original / labels）；壁纸迷读卡片 `data-img-info` JSON（title / url / largeUrl / dimensions / tags）。原图：Wallspic 详情页解析 `attachments/originals/...`，壁纸迷 `largeUrl` 为堆糖 `origin`；Wallspic 预览用列表 500px 缩略图，不额外解析详情。
- IPC：`wallpaperList` / `wallpaperCategories` / `wallpaperResolve` 第一个参数是 `WallpaperSourceRef`（id / template / baseUrl），主进程校验；列表缓存 30 分钟、分类缓存 12 小时，缓存 key 带 `源 id / 模板 / baseUrl`；`exportWallpaperSources` 导出 `id/name/baseUrl/template/enabled`。
- 页面：瀑布流（`column-width: 230px`，按宽高比占位）、搜索框前置壁纸源下拉、设备 / 分类两个下拉（参考直播，分类带站点数量）、分页、右上角收藏 / 下载快捷入口；卡片左上角下载、右上角红心；缩略图加载失败的卡片直接不显示，整页都失效时显示空状态；预览层显示大图 / 分辨率 / 大小 / 标签 / 收藏 / 下载，左 / 右 / Esc 切换，点黑色遮罩关闭，预览图彻底失败时提示并退出。点页面标题「壁纸」会先清 `wallpaper2` 缓存再重挂载，回到默认页（壁纸迷 · 电脑 · 全部）；侧栏进入仍恢复上次浏览现场。
- 返回栈：从收藏进入壁纸时 `focus` = 详情，X / Esc / 遮罩关闭等同「返回收藏页」（`closePreview` 调 `onExit`）；`App.pushRoute` 对同一张壁纸不重复入栈；`focus` 消失时清掉残留预览，避免返回后再次弹出图片。
- 缓存与收藏：列表缓存 `laozheng.cache.v1.wallpaper`（源 id / 设备 / 分类 / 页码 / 列表，搜索态不写）；收藏 `module='wallpaper'`、id=`${sourceId}|${item.id}`，payload 存 `source/pageUrl/thumb/width/height/fullUrl/previewUrl/sizeText/tags`；收藏管理页「壁纸」模块网格点击回到壁纸模块并直接打开预览；源删除 / 停用时从收藏打开会提示。
- 图片缓存：`lzimg://` 图片磁盘缓存对所有图床补默认 UA（`VOD_UA`）；chaoxing 等图床对无 UA 请求返回 403，会表现为「壁纸图片损坏」，已修复。壁纸迷堆糖缩略图会把 `.thumb.500_0` 升级成 `.thumb.2000_0` 作预览图；`largeUrl` 只在下载时取。
- 下载：下载管理 → 壁纸分区有「设为壁纸 / 打开 / 删除」；`downloads:setWallpaper` 校验记录 / 文件 / 图片格式，webp / avif / gif 先用 `nativeImage` 转 jpg，再走 PowerShell P/Invoke `SystemParametersInfo(20, ...)` 设置 Windows 桌面壁纸（填充模式）。
- 已知限制：Wallspic 会返回已删除条目的旧缩略图地址（图片本身 404），这类卡片现在直接隐藏；Wallspic 竖图原图可能数 MB，预览需等 2~3 秒；两个站点都需要能访问外网。

---

## 附 A：原「6. 当前进度」原文

### 6. 当前进度（PC 端 v0.5 已发布，v0.6 开发中，2026-10-28）

- 可运行桌面框架：左侧导航（清单 / 观影 / 短剧 / 音乐 / 游戏 / 电视 / 吃瓜 / 磁力 / 图书 / 漫画 / 本子 / 番1~4 / P站 / X站 / 设置），**启动默认进入清单**（v0.65 起首页模块移除），深浅色跟随系统，数据保存状态指示。
- **搜索**：影视 / 图书 / 游戏 / 人物四类；结果可拉详情写入 `items` 并加入指定清单；已收藏显示所在清单。
- **观影 + 番1~番4**：片源管理（增删改 / 启停 / 测速 / 批量导入 / 内置 73 源）、跨源并发搜索（结果实时追加）、线路与剧集选择、hls.js 播放、收藏、下载。观影默认进入「热门」分类浏览，固定分类为热门 / 华语电影 / 国产剧 / 欧美电影 / 美剧 / 日韩电影 / 韩剧 / 日漫 / 纪录片 / 综艺；榜单走公开影视榜单（每个分类 1 个请求，点海报再按片名搜片源，v0.91）。
- **短剧（v0.65）**：侧栏「短剧」在观影下；红果 / 西饭 / 河马 / 自定义四源切换，支持分类 / 榜单 / 搜索 / 分页 / 详情 / 选集 / 播放；默认列表按源写 localStorage，重开应用先显示上次内容；片源管理里的「短剧源」默认折叠，可启停与选择自定义影视源。
- **电视**：M3U 网络源 / 本地导入、频道分组与搜索、HLS 播放、收藏；电视源独立存 `userData/live-sources.json`，PC 备份 / 云同步时作为 `liveSources` 扩展字段一起走；手机端不读取该字段（手机端电视源在自己的 `config` 快照里）。
- **音乐**：无名音乐网（mvmp3）搜索 / 分页 / 直链解析 / 播放 / 歌词 / 收藏 / 下载；mvmp3 无结果或报错时自动用 33ve 兜底，歌曲带 `platform` 区分音源。
- **X站**：pektino 排行榜（每周/每月/总榜）、分类、详情、直链播放、收藏、下载。
- **P站**：推荐/最新/最热/人气/高分、分类、搜索、mediaDefinitions 解流（HLS 优先）、播放、收藏、下载。
- **吃瓜**：镜像自动发现、分类 / 搜索 / 翻页、正文图文混排、视频播放与下载、收藏。
- **磁力**：单源 / 全部源搜索、实时追加、排序、复制磁链；搜索结果只在本次运行期间保留，重开应用由主进程 `data:load` 清空 `magnetSearch`（切模块仍保留）。
- **本子（哔咔）**：内置账号自动登录、分类 / 排序 / 搜索 / 翻页、详情、章节、纵向图片阅读（上一话/下一话）、阅读进度与「继续阅读」、整本 / 单章批量下载（断点续传）、收藏（module = `h2`）。
- **漫画（Komiic）**：最近更新 / 热门 / 分类 / 搜索、加载更多、详情、章节、纵向图片阅读、阅读进度与「继续阅读」、整本 / 单章批量下载、收藏（module = `comic`）。
- **游戏（无忧）**：首页 / 分类 / 搜索 / 详情、属性表、解压密码复制、pay-download → 网盘链接解析（浏览器打开 / 复制）、收藏（module = `game`，id = 站点文章 id）；豆瓣游戏收藏保留为页内页签。
- **图书（Z-Library）**：登录窗口过 DiamWall，页面内 fetch 搜索 / 详情，`/dl/{token}` 下载到「图书」目录并登记下载库；设置页可保存账号密码（safeStorage 加密），启动静默自动登录，失败时打开窗口并自动填写表单；收藏 id = `{bookId}|{hash}`；豆瓣图书收藏保留为页内页签。
- **补丁（v0.77，老郑分享 → 游戏下方；原「修改器」）**：风灵月影 / 3DM / 游民星空 / 游侠网在线搜索 / 详情 / 下载，搜索栏前源下拉默认「全部源」；详情（版本 / 修改项或存档说明 / 反作弊说明 / 截图 / 多版本附件），直接文件一键下载自动解压到「下载目录/修改器」，网盘地址提供「打开链接」；补丁源在片源管理里启停 / 测试 / 增删改；下载记录进下载管理「修改器」分区（管理员启动 / 打开目录 / 删除）；模块右上角收藏、下载，收藏页有「补丁」模块。
- **壁纸（v0.102，老郑优化 → 壁纸）**：哲风壁纸 / Wallspic / 壁纸迷三源浏览、分类、搜索、分页、大图预览、收藏与保存图片；详见 7.11。
- **收藏跳转**：收藏行可点击回到对应模块（漫画 / 本子 / 游戏 / 图书 / X站 / P站 / 吃瓜 / 音乐按歌名回退播放 / 电视直链 / 观影或番号收藏直链播放）。
- **下载**：视频直链、HLS 切片合并、音乐、漫画/本子整本或单章批量下载（`漫画/<书名>/<章节>/0001.jpg` + `meta.json`，同序号跳过可续传）、Z-Library 图书；下载页可用系统默认应用打开 / 播放 / 删除。
- **设置**：数据概览、导入导出、数据目录、账号管理、Z-Library 登录、WebDAV 云同步、检查更新（并发测速直连 / gh-proxy / ghproxy，选最快线路读 GitHub API → 后台下载 → 打开安装向导）。

---

## 附 B：原 project_memory.md 模块规则原文

- **导航口径（2026-11-10 v0.110，当前）**：只保留一套侧栏导航「老郑分享」，不再有「老郑优化」树与品牌点击切换；硬件（原「电脑信息」，`sysinfo`）不显示在导航列表里，应用默认页 = 硬件，点侧栏顶部「老郑分享」进入；导航顺序为 清单 → 影视 → 短剧 → 音乐 → 游戏 → 补丁 → 电视 → 直播 → 吃瓜 → 磁力 → 小说 → 壁纸 → 漫画 → 本子 → 图书 → 番号 → P站 → X站。片源管理的整体导入 / 整体导出按钮在页面左上角。爽看导航项不显示「外网」标记，无 external 标识。
- **爽看模块规则**：默认接入地址为 `https://rou07.net/v`；若该站点无法访问，需从 `https://x99dh.net/` 内的爽看模块的优选访问列表中查找可用链接作为替代。爽看模块仅包含视频源，不包含短剧源。爽看源在片源管理中需与其他源保持统一：移除源名称后的内置文字，增加导出和批量导入按钮，支持与其他源一致的增删改、测试、启停、导入导出流程。爽看模块的加载动画需与其他模块保持统一。爽看源导出格式与短剧源一致，可直接互相导入。爽看分类二级下拉的标签数量需从标签名中剥离，不显示在下拉选项中。爽看新增的四个源默认全有效，分类直接铺开不使用下拉列表；爽看播放流请求必须携带对应站点的 Cookie 与 Referer，否则会返回 5 秒提示片而非完整视频。
- **爽看播放鉴权规则（2026-11-11 v0.122 第二轮，当前）**：① 提示片根因有两层：站点主域要鉴权（Cookie+Referer），**重定向后的 CDN 网关（`jre*.vc*.top/.sbs/.cc/.com` 等共享网关）对 master / variant / 分片 / AES key 每个请求都单独检查**，任何一跳裸 UA 都只回 `player.centercdn.top/tip.ts` 假清单。实现：`gohome.ts` `skMediaHosts` 存完整 `{referer, cookie, ua}`；requestSite / psite getHtml 成功后登记站点主域；`main.ts` `onBeforeRedirect` 把重定向目标域名继承同一份鉴权；`applyRequestHeaders` 的 skMedia 只对非 image 资源生效。② 肉视频 `/api/hls` **不能注入站点 Cookie/Referer/桌面 UA**（网关随机分流到质量不一的边缘节点）：`SiteResolver.mediaAuth=false` 关闭登记；`resolveSkMediaPlay` **串行**探测候选 UA（并行会因会话粘性互相干扰），只取 UA 结果登记、**返回原始 `/api/hls/<id>` 入口不锁节点**（锁节点后一次坏节点就整段失败）。③ **网关 302 会被 Chromium 缓存**：hls.js 的重试会一直回到同一个边缘节点，节点坏了整段播不了（网络层每次 fetch 会重新分流，所以纯网络测试看不出来）。`VideoPlayer` 必须用 hls.js 的 `xhrSetup` 对 `/api/hls/` 的 URL 追加一次性随机参数再 `xhr.open`，让每次请求（含 hls.js 自己的 6 次重试）重新分流；对伪装成 `index.png` 的清单在 `main.ts` 补 `Accept: */*`（部分节点按图片给 206）。④ 播放器 hls.js 配 manifest/level/frag 重试（6/6/8 次）；`LEVEL_LOADED` 检测首分片含 `/tip.` 直接报错，不静默播提示片。⑤ 片源管理状态：`normalizeShuangkanSources` 对内置源继承预设 testStatus 且 testMsg 为空时借用预设文案「可用」。⑥ **KVS（第五个源）详情页会被站点 CDN 缓存约 3 小时，缓存页里的 `var stream` 播放令牌（约 3 小时有效）往往已过期**，直接播就是 410 / 提示片——`pppDetail` 必须走 `freshPath()`（`/v/<id>/?t=<随机>`）强制回源拿新令牌；「时间戳判断 + 410/403 探活」保留作兜底，真正失效的视频仍明确报「播放权限已失效」。⑦ 节点池会随时间翻转，rou07 偶发整段不可播是站点端问题（串行探测 + 每次重试重新分流已兜底），不要试图用固定 UA / 固定节点解决。
- **爽看镜像翻页规则（2026-11-11 v0.123，当前）**：① 镜像网页的分页条只渲染当前页附近几页（P站只到 1~9），**不要用分页条判断末页**：P站移动版从页面内嵌 `"resultsCount":N`（兼容 `VIDEO_FILTER_resultsCount=N`）反推，`pages = 1 + ceil((N-30)/42)`（第 1 页 30 条、第 2 页起 42 条）；搜索镜像最多第 100 页（101 起 404）、分类实测 ~451 页，分别封顶 100 / 451；`PListResponse.totalPages` 与 `hasMore` 都以该口径为准。② PPP（KVS）搜索分页是 AJAX：`?page=N` 无效、`/search/<kw>/N/` 404，必须走 `/search/?q=<kw>&mode=async&function=get_block&block_id=list_videos_videos_list_search_result&q=<kw>&category_ids=&sort_by=&from_videos=N&from_albums=N`，`from_videos` 与 `from_albums` 必须作为两个独立参数（`from_videos+from_albums=N` 会一直返回第一页）。③ X站镜像会把搜索请求当首页返回，`xvidSearch` 以「标题是否含关键词」判定，不支持就提示「该源不支持搜索，请改用分类浏览」，不要返回首页列表或空列表。
- **肉视频分类规则**：肉视频的一级下拉为现有视频库的固定分类，二级下拉为选择一级分类后动态加载的对应子分类，无需包含短剧库。
- **短剧模块新增内置源规则**：新增默认内置源「肉视频短剧」，接入地址为 `https://rou07.net/series`；若该站点无法访问，需从 `https://x99dh.net/` 内的对应模块优选访问列表中查找可用链接作为替代。该源自动启用，无需用户手动添加，老数据自动补全。
- **哔咔小说 / 漫画口径（2026-11-10 v0.110，当前）**：小说源模板 `bikahub`（`id=bikahub`，名称「哔咔小说」，地址 `https://bikahub.net`）、漫画源模板 `bikahub`（名称「哔咔漫画」），都可在片源管理里增删改 / 批量导入 / 整体测试 / 导出 / 启停；漫画源默认顺序是 漫画客 → Komiic → 哔咔漫画，新漫画 ID 前缀 `bkh:`，收藏 / 阅读进度按该前缀回到源；小说分类 9 个（dushi / xiaoyaun / luanlun / xuanhuan / chuanyue / wuxia / qihuan / jiakonglishi / tongren），漫画分类 20 个（riman / tongren / hanman / … / bl）。主进程 `electron/bikahub.ts` 解析 Nuxt `__NUXT_DATA__`：列表 key `novel-list-page` / `comic-list`，搜索走 API `/api/v1/search?keyword=<kw>&type=novel|comic&page=N&pageSize=100`（逐页到空页、最多 6 页、按 id 去重；API id 是数字要转字符串），详情 `novel-detail-<id>` / `comic-detail-<id>`（章节全量在 payload），小说正文 `/novel/read/<id>/<order>` 的 `.novel-reader-pc-copy p`，漫画图 `/reader/<id>/<order>` payload 的 `detail.pages[].src`。分类数量：漫画 20 / 小说 9 个分类逐个取第一页 payload 的 `total`，IPC `bikahub:categoryCounts` / `novel:categoryCounts`，缓存 10 分钟；哔咔漫画页不显示「热门」，小说分类 Pagination 用 `totalPages`。站点返回 5xx / 429 / 网络错误时读 `/go-home` 的「国内可用地址」与「永久访问地址」，探活后自动换镜像并缓存 10 分钟；bikahub.net 本身打不开时依次试 bikago.net / mlaridyo.cc / 7ed43.dojqybrcm.com 的 go-home。图床（`pic.drleao.cn` 等）是 AES-CBC 变体加密，必须经 `electron/bikahubImage.ts` 解密（key `f5d965df75336270` / iv `97b60394abc2fbe1`，密文末 16 字节作临时 IV），图片缓存与漫画下载都要走这一步，否则图片显示空白 / 下载文件损坏。老数据由 `config.bikahubNovelSeeded` / `config.bikahubComicSeeded` 各补一次，删空不补回。
- **头牌漫画口径（2026-11-10 v0.114，当前）**：漫画源模板 `tptoon`，默认源 `id=tptoon` / 名称「头牌漫画」/ `https://tptoon.net`，默认顺序 漫画客 → Komiic → 哔咔漫画 → 头牌漫画；漫画 ID 前缀 `tpt:`（镜像源 `tpt_<sourceId>:`），收藏 / 阅读进度按前缀回到源；老数据由 `config.tptoonComicSeeded` 首次补一次，删空不补回。片源管理模板下拉、批量导入、整体导入导出、`comic:testSource`、下载白名单（`ComicSource` 增加 `tptoon`）都已支持。主进程 `electron/tptoon.ts`：最近 `/update/`、热门 `/ranking/`、分类 7 个（hanman / riman / 3d / doujin / single / short / other），翻页 `/<slug>/index_N.html`；详情 `/book/<id>.html`（标题 / 封面 / 作者 / 分类 / 简介 / 末章 + 全量目录），少数书目录是 `/cchapter/`，章节 ID 用 `c<数字>` 记住路径；章节图取 `/chapter/<id>.html` 或 `/cchapter/<id>.html` 的 `img.comic_img[data-original]`，一章多页继续拼 `_1`、`_2`；搜索走 `POST /e/search/index.php` 的 `show=title&keyboard=<UTF-8 kw>`，跟随后 `res.url` 为空，必须从结果页分页链接认 `/so/<id>_N.html`，一次最多 10 页（20 条/页），前端按 24 条/页分页。站点打不开时读 `https://tpmh8.cc/` 地址发布页，筛 `tptoon|tpmh|toupai|toonmh|mttoon|rrtoon|mhqun|bbmh|dybqg|qqmh` 域名并发探活，探活必须用 `/update/`（签名 + `.mipui-xs-item-list`），只用首页会把模板相同但路径不同的 `mhqun.com` 误判成镜像；结果缓存 10 分钟。列表接口不返回总页数，`ComicPage` 对 `tptoon` 的 `lastPage` 用 0 表示未知，靠 `hasMore` + 「尾页」探测（韩漫实测 195 页）。分类数量：`tptoonComicCategoryCounts` 对 7 个分类二分探末页 `/<slug>/index_N.html`（404 / 空页越界），按 `(末页-1)*30 + 末页条数` 折算，4 并发，主进程 `tptoon:categoryCounts` 磁盘缓存 24 小时；首次约 36 秒，之后立即显示；实测 韩漫 5833 / 日漫 18943 / 3D 2042 / 同人誌 24264 / 单行本 2783 / 短篇 6708 / 其他 24606。
- **禁漫天堂漫画源规则**：默认接入地址为 `https://18comic66.com/enter`；若该站点无法访问，需从 `https://x99dh.net/` 内的禁漫天堂模块的优选访问列表中查找可用链接作为替代。章节图还原规则：id ≥ 220980 的章节图为纵向分段倒序存储，需通过隐藏 offscreen 窗口 + canvas 重排后输出；分段数计算规则为 `md5(aid+page)` 末位映射到 [2..20]，其中 268850~421925 取模 10、≥421926 取模 8。站点自动换址逻辑：先通过 `/status.html` 的 `ok` 标识 + `/enter` 验签探活，失败则读取 `https://x99dh.net/` 页面内 `JTVC...` 开头的 base64 数据，解码后筛选名称含「禁漫」的条目，合并 `url` 与 `urls[]` 线路并发探活，取第一条可用地址缓存 10 分钟。
- **壁纸模块口径（2026-11-09 v0.107，当前）**：壁纸源存在 `data.wallpaperSources`，字段 `id/name/baseUrl/template/enabled/testStatus/testMsg/testAt`，`template` 只有 `wallspic` / `bizhimi`；默认顺序「壁纸迷 → Wallspic」，默认两源 `testStatus='ok'` / `testMsg='可用'`，缺失补默认、删空不补回；老数据 Wallspic 在前会被 `normalizeWallpaperSources` 调换；渲染层壁纸缓存 key 是 `wallpaper2`（升级后首次进入默认壁纸迷）。源配置随整份备份 / 云同步 / 整体导入导出走。片源管理「壁纸源」卡片在「番号源」之后，支持添加源 / 批量导入 / 整体测试 / 导出 + 每行测试 / 停用启用 / 修改 / 删除，不要再写「固定内置源」「分类自动同步」之类说明。壁纸页：搜索框前置源下拉，设备 / 分类两个下拉（参考直播，分类带站点数量），不是 chips。壁纸迷手机分类读手机页「标签」区（`.archive-tags a.bc-tag`，全部 + 20 个标签），列表 `/wallpaper/mobile-wallpaper?tag=<slug>`、翻页 `/page/N?tag=<slug>`；数量用 `data-tag-id` + WordPress REST `/wp-json/wp/v2/posts?categories=5626&tags=<id>&per_page=1` 的 `X-WP-Total`（失败隐藏数量）；电脑 42 分类。分类缓存 key 已升到 `wallpaper:categories:v5`。缩略图加载失败的卡片直接不显示（不显示占位），整页失效给空状态；预览图彻底失败提示并退出。下载：Wallspic 解析 `attachments/originals`、壁纸迷用 `largeUrl` 的堆糖 `origin`；`downloads:add` 白名单必须保留 `wallpaper`。坏图：图片缓存请求必须带兜底 UA（`VOD_UA`），chaoxing 等图床无 UA 会 403。返回栈：从收藏进入壁纸的预览是详情，X / Esc / 遮罩关闭 = 返回收藏页；`App.pushRoute` 对同一张壁纸不重复入栈；`focus` 消失时清掉残留预览。预览层点黑色遮罩（stage 空白处）必须能关闭。
- **下载壁纸设为桌面（2026-11-09 v0.106）**：下载管理 → 壁纸分区每张卡片有「设为壁纸 / 打开 / 删除」；主进程 `downloads:setWallpaper` 校验下载记录、文件存在、图片格式，webp / avif / gif 先用 `nativeImage` 转 jpg，再通过 PowerShell P/Invoke `SystemParametersInfo(20, ...)` 设为 Windows 桌面壁纸（WallpaperStyle=10 填充）；preload 暴露 `window.laozheng.setWallpaper(id)`。
- **壁纸 v0.103/v0.104 历史补充**：哲风壁纸整源已下线，旧收藏点击提示已下线；哲风原图接口 401 / 305 属站点限制。壁纸下载 kind=`wallpaper`，`downloads:add` 白名单漏了会报「下载参数无效」。X站搜索是标签检索（按 code / 多语言别名匹配），不是全文搜索，搜索固定走 range=all。
- **直播模块口径（2026-11-09 v0.100）**：每张直播卡片封面右上角有红心收藏按钮（`.fav-heart`），点击只收藏 / 取消，不进入房间；直播分类行不再有「热门」chip，只在有分类时显示下拉，下拉第一项「热门」= 默认热门列表，选它回到热门。抖音相关请求必须带硬超时：`electron/livePlatform/douyin.ts` 的 `executeJavaScript` 统一走 `runScript`（6 秒），`douyinRoom` 整体 40 秒兜底；渲染层 `livePlatformRoom` 45 秒 / `livePlatformList` 70 秒 / 分类 60 秒，超时显示「播放失败」而不是一直加载。从收藏打开直播要用 `switchPlatform` 恢复目标平台现场，不要直接 `setPlatform`，否则会把上一个平台的分区带到抖音。清单搜索分类也已改成搜索框前下拉（影视 / 图书 / 游戏 / 人物，默认影视）。
- **直播模块旧口径（2026-11-09 v0.98）**：页面右上角固定「收藏夹（数量）+ 扫码登录」，分类行只有「热门」+ 分区 / 分类两个下拉；刷新图标在搜索按钮右侧，只有点刷新才重新请求；每个平台在本次会话内保存浏览现场（模式 / 关键词 / 分区 / 页码 / 列表 / 分类），B站 / 斗鱼 / 抖音来回切换直接还原、不自动刷新；抖音列表封面从卡片 CSS `background-image`（webcast-cover）解析并按房间聚合取信息最全的一条，不要再用 `img` 首图。
- **短剧模块口径（2026-11-06 v0.92，已于 v0.93 移除）**：duanju55.com 免费短剧源已按用户要求整体回滚，默认短剧源只剩西饭。
- **漫画源历史口径（2026-11-05，已被 v0.110 / v0.113 覆盖）**：漫画模块恢复为只有 Komiic 一个源；v0.88 的 MYCOMIC 因站内章节不全已整源移除（`electron/mycomic.ts` / `src/shared/mycomic.ts` 已删除，`mycomic:*` IPC / preload / 类型、`mc:` 前缀、`ComicSource='mycomic'`、biccam.com 图片请求头均已撤销；ComicPage 已恢复 HEAD 版本）。包子漫画仍未接入。
- **观影模块口径（2026-11-05 v0.91，参考 KVideo）**：默认进入分类浏览（热门），固定分类「热门 / 华语电影 / 国产剧 / 欧美电影 / 美剧 / 日韩电影 / 韩剧 / 日漫 / 纪录片 / 综艺」；分类不要按几十个采集源拉列表，首页榜单改走公开影视榜单 `movie.douban.com/j/search_subjects`（sort=recommend），每个分类 1 个请求，20 条/页；热门 = movie 热门 + tv 热门，日韩电影 = movie 韩国 + movie 日本，两个榜单交叉合并去重；其余分类一一对应 movie/tv 标签。主进程 `fetchDoubanHot` + IPC `douban:hot`，`cachedResponse` 磁盘 + 内存缓存 1 小时；渲染进程缓存热门第一页 `laozheng.cache.v1.watch_hot_douban`（40 条，约 6KB）。点海报不直接播放，而是把片名填进搜索框调用现有跨源搜索，清空搜索回到当前分类；卡片显示封面、评分（静态星标、不外链）、集数信息与电影 / 剧集标签。旧版 `watch_hot` / `watch_cats` 缓存挂载时清理。无新增用户数据，导入导出 / 云同步不变。
- **番号模块口径（2026-11-05）**：`data.h1Sources` 存番号源，默认四个源用中文名「黄色仓库（hsckzy.vip）/ 91麻豆（91md.me）/ 奶香香（Naixxzy.com）/ 精品资源（www.jingpinx.com）」，id `h1_fixed_1~4`，默认 `testStatus='ok' / testMsg='可用'`；缺失自动补、删空不补回；v0.86 英文名老数据在 `normalizeH1Sources` 里自动换中文名并标记有效（用户改过名字 / 地址 / 测试结果的保持原样）。番号页默认「全部源」，分类按名称合并（各源记自己的 type_id），切单源只显示该源分类并探测数量；全部源分页取各源同页合并、末页最大值、总数求和；缓存 `laozheng.cache.v1.h1_all`；收藏按 payload.sourceId 回到对应源。片源管理「番号源」与其它源统一（添加 / 批量导入 / 整体测试 / 启停 / 编辑 / 删除 / 导出），全部源导入导出含 `h1Sources`。
- **双端互通口径（2026-11-03 核对手机端 ExportJson.kt）**：items / lists / listItems / vodSources / innerFavs / readProgress / config 双向兼容；PC 扩展 liveSources / downloads / magnetSources / magnetSearch / settings 手机端忽略且手机再导出会丢，不要经手机中转 PC 扩展；手机 config 里的电视源/下载记录 PC 只原样保存不应用；下载文件不互通（用户已确认不需要）；导出前必须去 null。
- **「优化」指令口径（2026-11-02 用户要求）**：以后用户说「优化」「整体优化」「检查一下」时，不要只改表面，按下面的全面体检清单展开，最后给出「问题清单 / 修复内容 / 验证结果 / 剩余限制」。
- **新功能硬规则（2026-11-02 用户强调）**：以后每个新增功能都必须同时有缓存（切模块/重开不丢）、进入导入导出、进入云同步，不能再漏。
- **回复结构硬规则（2026-11-10 用户两次指出反馈退化）**：每轮任务结束后的最终回复必须按「接入内容 → 验证结果 → 剩余限制 → 安装包链接」四段输出，即使只修一个小 bug 也不能只回一句「已修复」。上下文被压缩后也照此执行，不要省略验证数据。
- **播放器规则**：所有视频播放模块必须提供清晰度选择功能，默认自动选择最高清晰度；清晰度选择控件统一放置在播放器右上角。
- **站点自动恢复规则**：站点返回 500 错误时，需自动切换到同站点的可用镜像线路，无需用户手动操作。
