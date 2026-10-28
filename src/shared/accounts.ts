export type AccountSite = 'bika' | 'komiic' | 'wygamer'

export type AccountState = 'ok' | 'failed' | 'pending' | 'unknown'

export interface AccountStatus {
  site: AccountSite
  title: string
  username: string
  status: AccountState
  message: string
  updatedAt: number
  /** 是否全自动登录（无需用户操作） */
  automatic: boolean
}

export interface AccountsView {
  items: AccountStatus[]
}

export interface AccountActionResult {
  ok: boolean
  message: string
}

/** 三个站点的展示名与说明（设置页 / 提示共用） */
export const ACCOUNT_SITE_META: Record<AccountSite, { title: string; desc: string; automatic: boolean }> = {
  bika: { title: '哔咔', desc: '本子模块 · 签名接口自动登录', automatic: true },
  komiic: { title: 'Komiic 漫画', desc: '漫画模块 · GraphQL 自动登录', automatic: true },
  wygamer: { title: '无忧游戏', desc: '游戏资源站 · 自动通过滑块验证', automatic: true }
}
