/** 请求层统一 UA / Referer：渲染进程请求、主进程取图与 IPC 保存图片共用 */
export const IMAGE_REFERER = 'https://m.douban.com/'
export const IMAGE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
export const VOD_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
export const KOMIIC_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
export const BIKA_UA = 'okhttp/3.8.1'
/** Z-Library 封面 CDN 校验桌面浏览器 UA 与站点 Referer */
export const ZLIB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
/** 公开更新清单：私有仓库的 Releases 匿名 API 不可见，这里只公开版本号与发布页地址 */
