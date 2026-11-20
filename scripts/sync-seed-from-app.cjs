#!/usr/bin/env node
/**
 * 发版前同步默认种子：
 * 把本机应用数据里的「软件使用经验」和「演唱视频」合并进 resources/default-seed.json。
 *
 * 用法：
 *   npm run seed:sync                 读取 %APPDATA%/laozheng-pc/data.json
 *   npm run seed:sync -- 备份.json    读取指定的导出备份
 *
 * 只更新这两类数据，其余种子字段（片源 / 清单）保持原样；合并时保留种子里的
 * 字段顺序，并自动跳过没有变化的写入。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const seedPath = path.join(repoRoot, 'resources', 'default-seed.json')
const arg = process.argv[2]
const defaultDataPath = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'laozheng-pc',
  'data.json'
)
const dataPath = arg ? path.resolve(arg) : defaultDataPath

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    console.error(`[seed:sync] 无法读取${label}：${file}`)
    console.error(`[seed:sync] ${err.message}`)
    process.exit(1)
  }
}

function orderedVideo(base, next) {
  if (!base) return next
  const merged = {}
  for (const key of Object.keys(base)) {
    merged[key] = next[key] !== undefined ? next[key] : base[key]
  }
  for (const key of Object.keys(next)) {
    if (!(key in merged)) merged[key] = next[key]
  }
  return merged
}

const seed = readJson(seedPath, '默认种子')
const data = readJson(dataPath, '应用数据')

const beforeNotes = JSON.stringify(seed.toolNotes || {})
const beforeVideos = JSON.stringify(seed.singingVideos || [])

// 软件使用经验：只更新 / 追加，不删除种子里已有但应用数据缺失的条目
const notes = data.toolNotes
if (notes && typeof notes === 'object' && !Array.isArray(notes)) {
  const merged = { ...(seed.toolNotes || {}) }
  for (const [key, html] of Object.entries(notes)) {
    if (typeof html === 'string') merged[key] = html
  }
  seed.toolNotes = merged
}

// 演唱视频：按 bvid 合并，保留种子里的字段顺序；应用里有而种子里没有的补进来
const videos = data.singingVideos
if (Array.isArray(videos) && videos.length) {
  const seedVideos = Array.isArray(seed.singingVideos) ? seed.singingVideos : []
  const byBvid = new Map(seedVideos.map((video) => [video.bvid, video]))
  const merged = []
  const seen = new Set()
  for (const video of videos) {
    if (!video || typeof video.bvid !== 'string' || seen.has(video.bvid)) continue
    seen.add(video.bvid)
    merged.push(orderedVideo(byBvid.get(video.bvid), video))
  }
  for (const video of seedVideos) {
    if (video && typeof video.bvid === 'string' && !seen.has(video.bvid)) {
      merged.push(video)
      seen.add(video.bvid)
    }
  }
  seed.singingVideos = merged
}

const afterNotes = JSON.stringify(seed.toolNotes || {})
const afterVideos = JSON.stringify(seed.singingVideos || [])
const changed = beforeNotes !== afterNotes || beforeVideos !== afterVideos

if (changed) {
  const tmp = `${seedPath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(seed, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, seedPath)
}

console.log(`[seed:sync] 数据来源：${dataPath}`)
console.log(
  `[seed:sync] 软件使用经验 ${Object.keys(seed.toolNotes || {}).length} 篇，演唱视频 ${(seed.singingVideos || []).length} 个`
)
console.log(`[seed:sync] ${changed ? '默认种子已更新' : '默认种子没有变化，未写入'}`)
