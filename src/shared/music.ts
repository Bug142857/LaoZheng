/** 音乐模块共用类型（当前音源：无名音乐网，与手机端 MvMp3 一致） */

export interface MusicSong {
  id: string
  name: string
  artists: string
  album: string
  cover: string
  durationMs: number
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
