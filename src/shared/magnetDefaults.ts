import raw from './magnetSources.default.json'
import type { MagnetSource } from './magnet'

/**
 * 默认磁力资源库：直接使用用户导出的 2026-11-02 配置（18 个可用源）。
 * JSON 与「片源管理 → 磁力源 → 导出」格式一致，后续更新只要替换这个文件即可。
 */

interface DefaultSourceFile {
  version?: number
  sources?: MagnetSource[]
}

const data = raw as unknown as DefaultSourceFile

export const DEFAULT_MAGNET_SOURCES: MagnetSource[] = (data.sources ?? []).map((source) => ({
  ...source,
  api: source.api ?? null,
  testStatus: null,
  testMsg: null,
  testAt: 0
}))

/** 复制一份默认资源库，避免调用方直接改到常量 */
export function cloneDefaultMagnetSources(): MagnetSource[] {
  return DEFAULT_MAGNET_SOURCES.map((source) => ({
    ...source,
    api: source.api ? { ...source.api } : null
  }))
}
