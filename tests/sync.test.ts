import { describe, expect, it } from 'vitest'
import { parseWebDavLastModified, shouldWarnUploadConflict } from '../src/shared/sync'

describe('parseWebDavLastModified', () => {
  it('解析带命名空间的 getlastmodified', () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/dav/data.json</d:href>
          <d:propstat>
            <d:prop><d:getlastmodified>Wed, 20 Nov 2026 09:15:00 GMT</d:getlastmodified></d:prop>
          </d:propstat>
        </d:response>
      </d:multistatus>`
    const time = parseWebDavLastModified(xml)
    expect(time).toBe(Date.parse('Wed, 20 Nov 2026 09:15:00 GMT'))
  })

  it('没有时间字段或时间无效时返回 null', () => {
    expect(parseWebDavLastModified('')).toBeNull()
    expect(parseWebDavLastModified('<d:multistatus><d:prop/></d:multistatus>')).toBeNull()
    expect(
      parseWebDavLastModified('<d:getlastmodified>not-a-date</d:getlastmodified>')
    ).toBeNull()
  })
})

describe('shouldWarnUploadConflict', () => {
  it('云端拿不到时间时不拦截上传', () => {
    expect(shouldWarnUploadConflict(null, 1000)).toBe(false)
  })

  it('云端比本机新超过 5 秒才提示', () => {
    expect(shouldWarnUploadConflict(10_000, 1_000)).toBe(true)
    expect(shouldWarnUploadConflict(12_000, 10_000)).toBe(false)
    expect(shouldWarnUploadConflict(5_000, 10_000)).toBe(false)
  })
})
