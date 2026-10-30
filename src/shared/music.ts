/** 音乐模块共用类型（音源：无名音乐网 mvmp3 / 闪闪音乐网 s33ve） */

export type MusicPlatform = 'mvmp3' | 's33ve'

export interface MusicSong {
  id: string
  name: string
  artists: string
  album: string
  cover: string
  durationMs: number
  /** 音源标识；旧收藏里可能是 joox / netease */
  platform?: string
}

export interface MusicSearchResponse {
  ok: boolean
  items: MusicSong[]
  error?: string
}

export interface MusicResolveResponse {
  ok: boolean
  url?: string
  lrc?: string
  cover?: string
  name?: string
  singer?: string
  error?: string
}
