import { spawn } from 'node:child_process'

/** 以管理员身份启动外部程序（UAC 弹窗由系统接管） */
export async function runElevatedProcess(exePath: string, workingDir?: string): Promise<void> {
  const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`
  const script = [
    `$exe = ${quote(exePath)}`,
    `$dir = ${quote(workingDir ?? '')}`,
    'if ($dir) { Start-Process -FilePath $exe -WorkingDirectory $dir -Verb RunAs }',
    'else { Start-Process -FilePath $exe -Verb RunAs }'
  ].join('\r\n')
  await runPowerShell(script, 20_000)
}

/** 执行 PowerShell 脚本（-EncodedCommand 避免引号转义），返回 UTF-8 标准输出 */
export function runPowerShell(script: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')
      ],
      { windowsHide: true }
    )
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('PowerShell 执行超时'))
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0 && stdout.trim()) {
        resolve(stdout)
        return
      }
      reject(new Error(stderr.trim() || `PowerShell 退出码 ${code}`))
    })
  })
}
