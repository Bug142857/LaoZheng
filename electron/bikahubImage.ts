import { createCipheriv, createDecipheriv } from 'node:crypto'

/**
 * 哔咔（bikahub.net）图床把原图做了一层 AES-CBC 变体加密：
 * 密文最后 16 字节是临时 IV，先用它加密空数据得到补齐块，再用固定 IV 解密。
 * 这段逻辑与站点前端 image-transfer.worker 完全一致。
 */
const KEY = Buffer.from('f5d965df75336270', 'ascii')
const IV = Buffer.from('97b60394abc2fbe1', 'ascii')

/** 解密哔咔加密图片；不是该格式 / 解密失败返回 null */
export function decryptBikahubImage(buf: Buffer): Buffer | null {
  if (buf.length < 32 || buf.length % 16 !== 0) return null
  try {
    const cipher = createCipheriv('aes-128-cbc', KEY, buf.subarray(buf.length - 16))
    const padding = Buffer.concat([cipher.update(Buffer.alloc(0)), cipher.final()])
    const decipher = createDecipheriv('aes-128-cbc', KEY, IV)
    return Buffer.concat([decipher.update(Buffer.concat([buf, padding])), decipher.final()])
  } catch {
    return null
  }
}
