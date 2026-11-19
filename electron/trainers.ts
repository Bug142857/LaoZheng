import type { TrainerDetailResponse, TrainerListItem, TrainerSearchResponse, TrainerSourceInput, TrainerTestResult } from '../src/shared/trainers'
import { fetchText, normalizeSource, sameHost, titleKey, translateGameName, type NormalizedSource } from './trainers/common'
import { ali213Downloads, ali213Search, parseAli213Detail } from './trainers/sites/ali213'
import { flingDetail, flingSearch } from './trainers/sites/fling'
import { gamerskySearch, parseGamerskyDetail } from './trainers/sites/gamersky'
import { megagamesDetail, megagamesSearch } from './trainers/sites/mega'
import { parse3dmDetail, threeDMSearch } from './trainers/sites/threeDm'

export { deleteTrainer, downloadTrainer, openTrainerFolder, runTrainer, scanTrainerLibrary, trainerRootDir } from './trainers/library'
export async function searchTrainers(
  sources: TrainerSourceInput[],
  keyword: string,
  page: number
): Promise<TrainerSearchResponse> {
  const safePage = Math.max(1, Math.min(500, Math.floor(page) || 1))
  const list = (Array.isArray(sources) ? sources : [])
    .map(normalizeSource)
    .filter((source): source is NormalizedSource => Boolean(source))
    .slice(0, 8)
  if (!list.length) {
    return { ok: false, items: [], page: safePage, hasMore: false, error: '没有启用的补丁源' }
  }
  const query = keyword.trim()
  // 中文关键词先尝试换成英文名（8 秒内没结果就按原关键词搜）
  const translated = query
    ? await Promise.race([
        translateGameName(query),
        new Promise<string>((resolve) => setTimeout(() => resolve(''), 8000))
      ])
    : ''
  const terms =
    translated && translated.toLowerCase() !== query.toLowerCase() ? [query, translated] : [query]
  const results = await Promise.allSettled(
    list.flatMap((source) =>
      terms.map((term) => {
        if (source.type === 'fling') return flingSearch(source, term, safePage)
        if (source.type === 'megagames') return megagamesSearch(source, term, safePage)
        if (source.type === '3dm') return threeDMSearch(source, term, safePage)
        if (source.type === 'gamersky') return gamerskySearch(source, term, safePage)
        return ali213Search(source, term, safePage)
      })
    )
  )

  const items: TrainerListItem[] = []
  const seen = new Set<string>()
  let hasMore = false
  let pageCount = 0
  const errors: string[] = []
  for (const result of results) {
    if (result.status === 'rejected') {
      errors.push((result.reason as Error).message)
      continue
    }
    hasMore = hasMore || result.value.hasMore
    pageCount = Math.max(pageCount, result.value.pageCount ?? 0)
    for (const item of result.value.items) {
      const key = titleKey(item.title) || item.url
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }
  const translatedInfo = translated ? { translatedFrom: query, translatedTo: translated } : {}

  if (!items.length) {
    if (errors.length === results.length) {
      return {
        ok: false,
        items: [],
        page: safePage,
        hasMore: false,
        pageCount,
        ...translatedInfo,
        error: errors[0] || '所有修改器源都不可用'
      }
    }
    return {
      ok: true,
      items: [],
      page: safePage,
      hasMore: false,
      pageCount,
      ...translatedInfo,
      error: query ? '没有找到匹配的补丁' : undefined
    }
  }
  return { ok: true, items, page: safePage, hasMore, pageCount, ...translatedInfo }
}

export async function trainerDetail(
  sourceInput: TrainerSourceInput,
  url: string
): Promise<TrainerDetailResponse> {
  const source = normalizeSource(sourceInput)
  if (!source) return { ok: false, trainer: null, error: '修改器源无效' }
  if (typeof url !== 'string' || !sameHost(url, source.baseUrl)) {
    return { ok: false, trainer: null, error: '链接无效' }
  }
  try {
    if (source.type === 'fling') return await flingDetail(source, url)
    if (source.type === 'megagames') return await megagamesDetail(source, url)
    if (source.type === '3dm') {
      const html = await fetchText(url, `${source.baseUrl}/`)
      return { ok: true, trainer: parse3dmDetail(html, url, source) }
    }
    if (source.type === 'gamersky') {
      const html = await fetchText(url, `${source.baseUrl}/`)
      return { ok: true, trainer: parseGamerskyDetail(html, url, source) }
    }
    const html = await fetchText(url, 'https://patch.ali213.net/')
    const trainer = parseAli213Detail(html, url, source)
    try {
      trainer.downloads = await ali213Downloads(url, url)
    } catch {
      // 移动版页面拿不到时至少保留详情
    }
    if (!trainer.downloads.length) {
      trainer.downloads = [
        { name: '打开原网页下载', url, date: trainer.updatedAt, size: '', external: true }
      ]
    }
    return { ok: true, trainer }
  } catch (err) {
    return { ok: false, trainer: null, error: (err as Error).message }
  }
}

export async function testTrainerSource(
  sourceInput: TrainerSourceInput
): Promise<TrainerTestResult> {
  const source = normalizeSource(sourceInput)
  if (!source) return { ok: false, error: '修改器源无效' }
  try {
    const result =
      source.type === 'fling'
        ? await flingSearch(source, '', 1)
        : source.type === 'megagames'
          ? await megagamesSearch(source, '', 1)
          : source.type === '3dm'
            ? await threeDMSearch(source, '', 1)
            : source.type === 'gamersky'
              ? await gamerskySearch(source, '', 1)
              : await ali213Search(source, '', 1)
    if (!result.items.length) return { ok: false, error: '页面能打开，但没有解析到修改器' }
    return {
      ok: true,
      count: result.items.length,
      message: `首页 ${result.items.length} 个修改器`
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
