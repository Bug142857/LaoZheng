import { safeStorage } from 'electron'

/**
 * safeStorage 统一异步封装（Electron 45 起同步接口已废弃）。
 * 统一使用 enc: 前缀保存密文；系统不支持加密时退回 raw: + base64 明文标记。
 */

export async function encryptionAvailable(): Promise<boolean> {
  try {
    return await safeStorage.isAsyncEncryptionAvailable()
  } catch {
    return false
  }
}

export async function encryptSecret(value: string): Promise<string> {
  if (!value) return ''
  if (await encryptionAvailable()) {
    return `enc:${(await safeStorage.encryptStringAsync(value)).toString('base64')}`
  }
  return `raw:${Buffer.from(value, 'utf8').toString('base64')}`
}

export async function decryptSecret(value: string | undefined): Promise<string> {
  if (!value) return ''
  try {
    if (value.startsWith('enc:')) {
      const buf = Buffer.from(value.slice(4), 'base64')
      const first = await safeStorage.decryptStringAsync(buf)
      // 系统密钥轮换时 Electron 要求再解一次拿到最新明文
      if (first.shouldReEncrypt) {
        const second = await safeStorage.decryptStringAsync(buf)
        return second.result
      }
      return first.result
    }
    if (value.startsWith('raw:')) return Buffer.from(value.slice(4), 'base64').toString('utf8')
  } catch (err) {
    console.error('[secureStorage] 解密失败', err)
  }
  return ''
}
