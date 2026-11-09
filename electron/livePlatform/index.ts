import type {
  LiveCategoriesResult,
  LiveListKind,
  LiveListParams,
  LiveListResult,
  LivePlatformId,
  LiveRoomPlayback
} from '../../src/shared/livePlatform'
import {
  bilibiliCategories,
  bilibiliCategoryRooms,
  bilibiliRecommend,
  bilibiliRoom,
  bilibiliSearch,
  parseBilibiliRoomId
} from './bilibili'
import {
  douyuCategories,
  douyuCategoryRooms,
  douyuRecommend,
  douyuRoom,
  douyuSearch,
  parseDouyuRoomId
} from './douyu'
import {
  douyinCategories,
  douyinCategoryRooms,
  douyinRecommend,
  douyinRoom,
  douyinSearch,
  parseDouyinRoomId
} from './douyin'

export function liveCategories(platform: LivePlatformId): Promise<LiveCategoriesResult> {
  if (platform === 'bilibili') return bilibiliCategories()
  if (platform === 'douyu') return douyuCategories()
  return douyinCategories()
}

export function liveList(
  platform: LivePlatformId,
  kind: LiveListKind,
  params: LiveListParams = {}
): Promise<LiveListResult> {
  const page = Math.max(1, Math.floor(params.page ?? 1))
  if (kind === 'search') {
    const keyword = (params.keyword ?? '').trim()
    if (!keyword) return Promise.resolve({ items: [], hasMore: false })
    if (platform === 'bilibili') return bilibiliSearch(keyword, page)
    if (platform === 'douyu') return douyuSearch(keyword, page)
    return douyinSearch(keyword, page)
  }
  if (kind === 'category') {
    if (platform === 'bilibili') {
      return bilibiliCategoryRooms(params.parentId ?? '', params.areaId ?? '', page)
    }
    if (platform === 'douyu') return douyuCategoryRooms(params.areaId ?? '', page)
    return douyinCategoryRooms(params.areaId ?? '', page)
  }
  if (platform === 'bilibili') return bilibiliRecommend(page)
  if (platform === 'douyu') return douyuRecommend(page)
  return douyinRecommend()
}

export function liveRoom(
  platform: LivePlatformId,
  input: string,
  qualityId?: string
): Promise<LiveRoomPlayback> {
  if (platform === 'bilibili') {
    const roomId = parseBilibiliRoomId(input)
    return bilibiliRoom(roomId || input, qualityId)
  }
  if (platform === 'douyu') {
    const roomId = parseDouyuRoomId(input)
    return douyuRoom(roomId || input, qualityId)
  }
  const roomId = parseDouyinRoomId(input)
  return douyinRoom(roomId || input)
}
