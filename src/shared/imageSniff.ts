/** 按文件头判断图片类型（豆瓣图床多数地址没有扩展名）；不是已知图片格式时返回 null */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png'
  if (buf.length >= 6 && buf.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif'
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (buf.length >= 12 && buf.subarray(4, 12).toString('ascii') === 'ftypavif') return 'image/avif'
  if (buf.length >= 12 && buf.subarray(4, 12).toString('ascii') === 'ftypavis') return 'image/avif'
  const head = buf.subarray(0, 200).toString('utf8').trimStart().toLowerCase()
  if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'image/svg+xml'
  return null
}
