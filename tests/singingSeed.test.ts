import { describe, expect, it } from 'vitest'
import { mergeDefaultSingingVideos, type SingingVideo } from '../src/shared/singing'

function video(bvid: string, title: string, favAt = 1): SingingVideo {
  return {
    bvid,
    page: 1,
    title,
    originalTitle: 'B站原标题',
    cover: '',
    durationSec: 0,
    category: '测试',
    owner: '',
    favAt,
    addedAt: 1
  }
}

const DEFAULTS = [
  video('BV1Rc1gBaERq', '宇多田光：One Last Kiss', 100),
  video('BV1sD4y1c7rE', '山内瑞葵：aLIEz', 200)
]

describe('mergeDefaultSingingVideos（每次启动强制同步默认标题）', () => {
  it('强制覆盖默认条目的旧标题与 favAt，保留用户视频并补缺失条目', () => {
    const videos = [
      video('BV1Rc1gBaERq', '旧标题 A', 1),
      video('BV1aaaaaaaaa', '用户自己的视频', 9)
    ]
    const result = mergeDefaultSingingVideos(videos, DEFAULTS)
    expect(result.changed).toBe(true)
    expect(result.videos.map((v) => [v.bvid, v.title, v.favAt])).toEqual([
      ['BV1Rc1gBaERq', '宇多田光：One Last Kiss', 100],
      ['BV1aaaaaaaaa', '用户自己的视频', 9],
      ['BV1sD4y1c7rE', '山内瑞葵：aLIEz', 200]
    ])
  })

  it('再次启动且数据已一致时不产生改动', () => {
    const first = mergeDefaultSingingVideos([video('BV1Rc1gBaERq', '旧标题')], DEFAULTS)
    const second = mergeDefaultSingingVideos(first.videos, DEFAULTS)
    expect(second.changed).toBe(false)
    expect(second.videos).toBe(first.videos)
  })

  it('没有默认数据时不改动', () => {
    const videos = [video('BV1Rc1gBaERq', '旧标题')]
    const result = mergeDefaultSingingVideos(videos, [])
    expect(result.changed).toBe(false)
    expect(result.videos).toBe(videos)
  })

  it('默认标题为空时保留本地标题', () => {
    const result = mergeDefaultSingingVideos(
      [video('BV1Rc1gBaERq', '本地标题')],
      [video('BV1Rc1gBaERq', '', 1)]
    )
    expect(result.changed).toBe(false)
    expect(result.videos[0].title).toBe('本地标题')
  })
})
