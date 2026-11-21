import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeLocalPcFields, normalizeData, stripNullFields } from '../src/shared/types'
import { formatBytes, formatEta, formatSpeed } from '../src/shared/downloads'
import { sniffImageMime } from '../src/shared/imageSniff'
import {
  createDataSnapshot,
  ensureDailySnapshot,
  listDataSnapshots,
  writeDataSnapshot
} from '../electron/snapshots'

describe('normalizeData（备份 / data.json 兜底）', () => {
  it('缺失或非法字段回退为空数组 / 空对象', () => {
    const data = normalizeData({ items: null, lists: 'bad', listItems: [null, 1], readProgress: [] })
    expect(data.items).toEqual([])
    expect(data.lists).toEqual([])
    expect(data.listItems).toEqual([])
    expect(data.readProgress).toEqual({})
    expect(data.innerFavs).toEqual([])
  })

  it('收藏缺 subtitle 等字段时补齐，收藏页搜索 / 排序不会崩', () => {
    const data = normalizeData({
      innerFavs: [
        { module: 'music', id: '1', title: '歌', savedAt: 1 },
        { module: 'music', title: '没有 id' },
        { id: 'x', title: '没有 module' }
      ]
    })
    expect(data.innerFavs).toHaveLength(1)
    expect(data.innerFavs[0].subtitle).toBe('')
    expect(data.innerFavs[0].durationSec).toBe(0)
  })

  it('影视源归一化：同一地址可保留国内 / 代理两条，重复 id 只留第一条', () => {
    const data = normalizeData({
      vodSources: [
        { id: 'a', name: '源A-国内', baseUrl: 'https://a.test' },
        { id: 'b', name: '源B-代理', baseUrl: 'https://a.test', region: 'proxy' },
        { id: 'a', name: '重复 id', baseUrl: 'https://c.test' },
        { id: '', name: '没有 id', baseUrl: 'https://d.test' },
        { id: 'e', name: '没有地址', baseUrl: '' }
      ]
    })
    expect(data.vodSources.map((source) => source.id)).toEqual(['a', 'b'])
    expect(data.vodSources[1].region).toBe('proxy')
  })

  it('导入手机端 / 旧版备份时，缺失的 PC 扩展字段保留本机现值', () => {
    const current = normalizeData({
      localShortcuts: [
        { id: 'a', name: '桌面', path: 'C:\\Users\\me\\Desktop', kind: 'folder' }
      ],
      toolNotes: { steam: '<p>经验</p>' }
    })
    const incoming = mergeLocalPcFields(
      { items: [], lists: [], listItems: [] },
      normalizeData({ items: [], lists: [], listItems: [] }),
      current
    )
    expect(incoming.localShortcuts).toEqual(current.localShortcuts)
    expect(incoming.toolNotes).toEqual(current.toolNotes)
    // 备份里显式带了字段（哪怕是空数组）仍以备份为准
    const explicit = mergeLocalPcFields(
      { items: [], lists: [], listItems: [], localShortcuts: [] },
      normalizeData({ items: [], lists: [], listItems: [], localShortcuts: [] }),
      current
    )
    expect(explicit.localShortcuts).toEqual([])
  })

  it('旧备份里的番号源与番号收藏会被忽略', () => {
    const data = normalizeData({
      h1Sources: [
        { id: 'h1_fixed_1', name: '旧番号源', baseUrl: 'https://example.com/api.php/provide/vod' }
      ],
      innerFavs: [
        { module: 'h1', id: 'h1_fixed_1|1', title: '番号收藏', subtitle: '', savedAt: 1 },
        { module: 'watch', id: 'src|2', title: '影视收藏', subtitle: '', savedAt: 2 }
      ]
    })
    expect('h1Sources' in data).toBe(false)
    expect(data.innerFavs.map((fav) => fav.module)).toEqual(['watch'])
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

  it('导入前完整快照带电视源 / 磁力源 / 本机设置，恢复时能读回', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lz-snapshot-full-'))
    try {
      const info = await writeDataSnapshot(root, 'import', {
        version: 1,
        items: [],
        lists: [],
        listItems: [],
        liveSources: [{ id: 'live_1', name: '电视源', url: 'http://example.com/live.m3u', content: '' }],
        magnetSources: [{ id: 'magnet_1', name: '磁力源', baseUrl: 'http://example.com', enabled: true }],
        settings: { theme: 'dark', accent: 'purple', downloadRoot: 'D:\\laozheng\\download' }
      })
      expect((await listDataSnapshots(root)).some((item) => item.name === info.name)).toBe(true)
      const data = normalizeData(
        JSON.parse(await readFile(join(root, 'snapshots', info.name), 'utf8'))
      )
      expect(data.liveSources).toHaveLength(1)
      expect(data.magnetSources).toHaveLength(1)
      expect(data.settings?.downloadRoot).toBe('D:\\laozheng\\download')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('每日自动快照写入完整备份，同一天只生成一份', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lz-snapshot-auto-'))
    try {
      const dataFile = join(root, 'data.json')
      const info = await ensureDailySnapshot(root, dataFile, undefined, async () => ({
        version: 1,
        items: [],
        lists: [],
        listItems: [],
        liveSources: [{ id: 'live_auto', name: '电视源', url: 'http://example.com/live.m3u', content: '' }],
        settings: { theme: 'system', accent: 'purple', downloadRoot: 'D:\\auto' }
      }))
      expect(info?.reason).toBe('auto')
      const data = normalizeData(
        JSON.parse(await readFile(join(root, 'snapshots', info!.name), 'utf8'))
      )
      expect(data.liveSources).toHaveLength(1)
      expect(data.settings?.downloadRoot).toBe('D:\\auto')
      // 当天已有自动快照：不再生成，也不应再调用完整备份构建
      const again = await ensureDailySnapshot(root, dataFile, undefined, async () => {
        throw new Error('同一天不应重复构建快照')
      })
      expect(again).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
