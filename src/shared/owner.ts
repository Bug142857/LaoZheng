/** 老郑本人专用功能的本地密码：编辑软件默认经验、添加演唱默认视频 */
export const OWNER_PASSWORD = 'dblz'

export function isOwnerPassword(value: string): boolean {
  return value === OWNER_PASSWORD
}
