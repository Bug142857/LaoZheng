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
  // 内置资源库均已实测可用：新安装默认显示有效，之后手动测试再覆盖真实结果
  testStatus: 'ok',
  testMsg: '可用',
  testAt: 0
}))

/** 复制一份默认资源库，避免调用方直接改到常量 */
export function cloneDefaultMagnetSources(): MagnetSource[] {
  return DEFAULT_MAGNET_SOURCES.map((source) => ({
    ...source,
    api: source.api ? { ...source.api } : null
  }))
}
