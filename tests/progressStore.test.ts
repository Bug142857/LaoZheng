import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProgressStore, normalizeProgressEntry } from '../electron/progressStore'

const dirs: string[] = []

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lz-progress-'))
  dirs.push(dir)
  return join(dir, 'read-progress.json')
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('normalizeProgressEntry', () => {
  it('接受字符串与数字，并去掉首尾空白', () => {
    expect(normalizeProgressEntry(' video/1 ', ' 123 ')).toEqual({ key: 'video/1', value: '123' })
    expect(normalizeProgressEntry('vodEp|a|1', 2)).toEqual({ key: 'vodEp|a|1', value: '2' })
  })

  it('拒绝空 key / 超长 key / 非法值', () => {
    expect(normalizeProgressEntry('', '1')).toBeNull()
    expect(normalizeProgressEntry('x'.repeat(501), '1')).toBeNull()
    expect(normalizeProgressEntry('video/1', null)).toBeNull()
    expect(normalizeProgressEntry('video/1', {})).toBeNull()
    expect(normalizeProgressEntry('video/1', '')).toBeNull()
    expect(normalizeProgressEntry('video/1', 'x'.repeat(501))).toBeNull()
  })
})

describe('ProgressStore', () => {
  it('内存立即更新，flush 后落盘并可重新读取', async () => {
    const file = await tempFile()
    const store = new ProgressStore(file)
    await store.set('video/1', '88')
    await store.set('vodEp|s|1', '第 2 集|第 3 集')
    expect(store.peek()).toEqual({ 'video/1': '88', 'vodEp|s|1': '第 2 集|第 3 集' })

    await store.flush()
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, string>
    expect(raw['video/1']).toBe('88')

    const reloaded = new ProgressStore(file)
    expect(await reloaded.load()).toEqual({
      'video/1': '88',
      'vodEp|s|1': '第 2 集|第 3 集'
    })
  })

  it('replaceAll 会过滤坏数据并整体替换', async () => {
    const file = await tempFile()
    const store = new ProgressStore(file)
    await store.set('old/key', '1')
    await store.replaceAll({
      'video/2': '42',
      '': 'bad',
      'bad/value': null,
      ['x'.repeat(600)]: 'too-long'
    })
    expect(store.peek()).toEqual({ 'video/2': '42' })
  })

  it('flushSync 同步写入，退出前不丢最后一次进度', async () => {
    const file = await tempFile()
    const store = new ProgressStore(file)
    await store.set('video/3', '9')
    store.flushSync()
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, string>
    expect(raw['video/3']).toBe('9')
  })
})
