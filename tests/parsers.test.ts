import { describe, expect, it } from 'vitest'
import { parseM3u } from '../src/shared/live'
import { parsePlayGroups, parseSourceImport } from '../src/shared/vod'
import { parseNewsFavPayload } from '../src/shared/news'
import { normalizeMusicQueue } from '../src/shared/music'
import { compareVersions } from '../src/shared/update'

describe('parseM3u', () => {
  it('解析 group-title / tvg-name / 逗号后的频道名', () => {
    const text = [
      '#EXTM3U',
      '#EXTINF:-1 group-title="央视" tvg-name="CCTV1",CCTV-1 综合',
      'http://example.com/cctv1.m3u8',
      '#EXTINF:-1 group-title="卫视",',
      'http://example.com/star.m3u8'
    ].join('\n')
    expect(parseM3u(text)).toEqual([
      { group: '央视', name: 'CCTV-1 综合', url: 'http://example.com/cctv1.m3u8' },
      { group: '卫视', name: 'star.m3u8', url: 'http://example.com/star.m3u8' }
    ])
  })

  it('同一地址只保留第一条，空分组回退「未分组」', () => {
    const text = [
      '#EXTINF:-1,频道 A',
      'http://example.com/a.m3u8',
      '#EXTINF:-1,频道 B',
      'http://example.com/a.m3u8',
      '#EXTINF:-1,频道 C',
      'http://example.com/c.m3u8'
    ].join('\n')
    const channels = parseM3u(text)
    expect(channels).toHaveLength(2)
    expect(channels[0].name).toBe('频道 A')
    expect(channels[0].group).toBe('未分组')
  })
})

describe('parseSourceImport', () => {
  it('支持 JSON 数组与单对象', () => {
    const list = parseSourceImport(
      JSON.stringify([{ name: '非凡', baseUrl: 'https://a.com/api.php/provide/vod' }])
    )
    expect(list.error).toBeUndefined()
    expect(list.sources).toHaveLength(1)
    expect(list.sources[0].baseUrl).toBe('https://a.com/api.php/provide/vod')

    const single = parseSourceImport(
      JSON.stringify({ url: 'https://b.com/api.php/provide/vod' })
    )
    expect(single.sources).toHaveLength(1)
    expect(single.sources[0].name).toContain('b.com')
  })

  it('支持一行一个「名称|地址」或裸地址', () => {
    const res = parseSourceImport(
      ['非凡|https://a.com/api.php/provide/vod', 'https://b.com/api.php/provide/vod'].join('\n')
    )
    expect(res.sources.map((s) => s.baseUrl)).toEqual([
      'https://a.com/api.php/provide/vod',
      'https://b.com/api.php/provide/vod'
    ])
  })

  it('空内容或无效行给出错误', () => {
    expect(parseSourceImport('   ').error).toBe('内容为空')
    expect(parseSourceImport('随便写点什么').error).toBeTruthy()
  })
})

describe('parsePlayGroups', () => {
  it('优先只保留 3u8 线路', () => {
    const groups = parsePlayGroups(
      '3u8线路$$$备用线路',
      '第1集$https://a.com/1.m3u8#第2集$https://a.com/2.m3u8$$$第1集$https://b.com/1.mp4'
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('3u8线路')
    expect(groups[0].episodes).toHaveLength(2)
    expect(groups[0].episodes[1].url).toBe('https://a.com/2.m3u8')
  })

  it('没有 3u8 时回退全部线路，空播放地址返回空数组', () => {
    const groups = parsePlayGroups('线路一', '第1集$https://b.com/1.mp4')
    expect(groups).toHaveLength(1)
    expect(groups[0].episodes).toHaveLength(1)
    expect(parsePlayGroups('线路一', '')).toEqual([])
  })
})

describe('parseNewsFavPayload', () => {
  it('解析收藏 payload，非法条目被过滤', () => {
    const payload = parseNewsFavPayload(
      JSON.stringify({
        category: 'news',
        page: 2,
        nodeId: 'node-1',
        name: '热榜',
        items: [
          { rank: 1, title: '标题一', url: 'https://example.com/1' },
          { rank: 2, title: '', url: 'https://example.com/2' },
          { rank: 3, title: '标题三', url: 'javascript:alert(1)' }
        ]
      })
    )
    expect(payload?.category).toBe('news')
    expect(payload?.page).toBe(2)
    expect(payload?.items).toHaveLength(2)
    expect(payload?.items[1].url).toBeNull()
  })

  it('缺少 nodeId 或 JSON 损坏返回 null', () => {
    expect(parseNewsFavPayload('{}')).toBeNull()
    expect(parseNewsFavPayload('not-json')).toBeNull()
  })
})

describe('normalizeMusicQueue', () => {
  it('只保留字段完整的条目并限制数量', () => {
    const queue = normalizeMusicQueue([
      { key: 'k1', id: '1', title: '歌一', artists: '歌手', cover: 'https://a/1.jpg' },
      ...Array.from({ length: 600 }, (_, i) => ({
        key: `k${i + 10}`,
        id: String(i + 10),
        title: `歌${i + 10}`,
        artists: '',
        cover: null
      })),
      // 超过 500 条之后的坏数据不会进入结果
      { key: '', id: 'bad', title: '坏数据', artists: '', cover: null }
    ])
    expect(queue).toHaveLength(500)
    expect(queue[0].key).toBe('k1')
  })

  it('非数组返回空队列', () => {
    expect(normalizeMusicQueue(null)).toEqual([])
    expect(normalizeMusicQueue({})).toEqual([])
  })
})

describe('compareVersions', () => {
  it('比较 v 前缀与三段式版本', () => {
    expect(compareVersions('v0.219', '0.218')).toBe(1)
    expect(compareVersions('0.219.0', '0.219')).toBe(0)
    expect(compareVersions('0.9', '0.10')).toBe(-1)
  })
})
