import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendLog, appendLogSync } from '../electron/logFile'

describe('日志轮转', () => {
  it('同步追加超过上限时改名为 .1', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lz-log-'))
    const file = join(dir, 'sync.log')
    try {
      appendLogSync(file, 'a'.repeat(20), 10)
      appendLogSync(file, 'b', 10)
      expect(await readFile(file, 'utf8')).toBe('b')
      expect(await readFile(`${file}.1`, 'utf8')).toBe('a'.repeat(20))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('异步追加超过上限时同样轮转', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lz-log-'))
    const file = join(dir, 'async.log')
    try {
      await appendLog(file, 'x'.repeat(20), 10)
      await appendLog(file, 'y', 10)
      expect(await readFile(file, 'utf8')).toBe('y')
      expect(await readFile(`${file}.1`, 'utf8')).toBe('x'.repeat(20))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
