import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeData, stripNullFields } from '../src/shared/types'
import { formatBytes, formatEta, formatSpeed } from '../src/shared/downloads'
import { sniffImageMime } from '../src/shared/imageSniff'
import { createDataSnapshot, listDataSnapshots } from '../electron/snapshots'

describe('normalizeData（备份 / data.json 兜底）', () => {
  it('缺失或非法字段回退为空数组 / 空对象', () => {
    const data = normalizeData({ items: null, lists: 'bad', listItems: [null, 1], readProgress: [] })
    expect(data.items).toEqual([])
    expect(data.lists).toEqual([])
    expect(data.listItems).toEqual([])
    expect(data.readProgress).toEqual({})
    expect(data.innerFavs).toEqual([])
  })

  it('根清单缺 parentId 时补回 null，坏条目被丢弃', () => {
    const data = normalizeData({
      lists: [{ id: 1, name: '根' }, null, { id: 2, name: '子', parentId: 1 }]
    })
    expect(data.lists).toEqual([
      { id: 1, name: '根', parentId: null },
      { id: 2, name: '子', parentId: 1 }
    ])
  })

  it('保留合法进度与收藏数据', () => {
    const data = normalizeData({
      readProgress: { 'video/1': '120' },
      innerFavs: [{ module: 'watch', id: 'a' }]
    })
    expect(data.readProgress).toEqual({ 'video/1': '120' })
    expect(data.innerFavs).toHaveLength(1)
  })
})

describe('stripNullFields（导出给手机端）', () => {
  it('递归去掉 null，保留 false / 0 / 空字符串', () => {
    const out = stripNullFields({
      a: null,
      b: false,
      c: 0,
      d: '',
      nested: { e: null, f: 1 },
      list: [{ g: null, h: 2 }]
    })
    expect(out).toEqual({ b: false, c: 0, d: '', nested: { f: 1 }, list: [{ h: 2 }] })
  })
})

describe('图片类型嗅探', () => {
  it('识别 jpg / png / gif / webp / svg', () => {
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffImageMime(Buffer.from('89504e470d0a1a0a', 'hex'))).toBe('image/png')
    expect(sniffImageMime(Buffer.from('GIF89a', 'ascii'))).toBe('image/gif')
    expect(
      sniffImageMime(Buffer.from('524946460000000057454250', 'hex'))
    ).toBe('image/webp')
    expect(sniffImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBe(
      'image/svg+xml'
    )
  })

  it('非图片返回 null', () => {
    expect(sniffImageMime(Buffer.from('<html>403</html>'))).toBeNull()
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull()
  })
})

describe('下载速度 / ETA 格式化', () => {
  it('格式化速度与剩余时间', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatSpeed(1024 * 1024)).toBe('1.0 MB/s')
    expect(formatSpeed(0)).toBe('')
    expect(formatEta(65)).toBe('1:05')
    expect(formatEta(3660)).toBe('1:01:00')
    expect(formatEta(undefined)).toBe('')
  })
})

describe('覆盖前数据快照', () => {
  it('data.json 不存在时视为无需快照，存在时能生成并合并最新进度', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lz-snapshot-'))
    try {
      const dataFile = join(root, 'data.json')
      // 上次损坏被移走 / 首次启动：没有旧数据可保护，不能因此卡死导入
      expect(await createDataSnapshot(root, dataFile, 'import', {})).toBeNull()

      await writeFile(dataFile, JSON.stringify({ readProgress: { old: '1' } }), 'utf8')
      const info = await createDataSnapshot(root, dataFile, 'import', { 'video/1': '5' })
      expect(info?.reason).toBe('import')
      expect(await listDataSnapshots(root)).toHaveLength(1)

      const raw = JSON.parse(
        await readFile(join(root, 'snapshots', info!.name), 'utf8')
      ) as { readProgress: Record<string, string> }
      expect(raw.readProgress).toEqual({ old: '1', 'video/1': '5' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
