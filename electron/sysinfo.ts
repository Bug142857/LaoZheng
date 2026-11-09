import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { formatBytes } from '../src/shared/downloads'
import type { SystemInfoEntry, SystemInfoResult } from '../src/shared/sysinfo'
import { runPowerShell } from './powershell'

interface RawCpu {
  name?: string
  cores?: number
  threads?: number
}

interface RawBoard {
  manufacturer?: string
  product?: string
}

interface RawMemory {
  capacity?: number
  speed?: number
  part?: string
}

interface RawGpu {
  name?: string
  driver?: string
  vram?: number
  width?: number
  height?: number
}

interface RawMonitor {
  manufacturer?: string
  name?: string
  year?: number
}

interface RawDesktopMonitor {
  name?: string
  width?: number
  height?: number
}

interface RawDisk {
  index?: number
  model?: string
  size?: number
}

interface RawPhysicalDisk {
  deviceId?: string
  mediaType?: number
  busType?: number
}

interface RawAudio {
  name?: string
}

interface RawNic {
  name?: string
  mac?: string
  speed?: number
  status?: number
}

interface RawSystemInfo {
  manufacturer?: string
  model?: string
  totalMemory?: number
  osCaption?: string
  osDisplayVersion?: string
  osBuild?: string
  osArch?: string
  cpu?: RawCpu[] | RawCpu
  board?: RawBoard[] | RawBoard
  memory?: RawMemory[] | RawMemory
  gpu?: RawGpu[] | RawGpu
  monitor?: RawMonitor[] | RawMonitor
  desktopMonitor?: RawDesktopMonitor[] | RawDesktopMonitor
  disk?: RawDisk[] | RawDisk
  physicalDisk?: RawPhysicalDisk[] | RawPhysicalDisk
  audio?: RawAudio[] | RawAudio
  nic?: RawNic[] | RawNic
}

const NIC_STATUS: Record<number, string> = {
  0: '未连接',
  1: '正在连接',
  2: '已连接',
  3: '正在断开',
  4: '硬件不存在',
  5: '已禁用',
  6: '硬件故障',
  7: '未连接',
  8: '正在验证',
  9: '验证成功',
  10: '验证失败',
  11: '地址无效',
  12: '需要凭据'
}

/** 一次 PowerShell 取完所有 WMI 信息，避免逐个分类启动进程 */
const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function TextFromBytes($value) {
  if ($null -eq $value) { return '' }
  if ($value -is [string]) { return $value }
  $chars = @()
  foreach ($item in $value) {
    if ($item -gt 0) { $chars += [char]$item }
  }
  return (-join $chars)
}
$cs = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$osDisplayVersion = "$((Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').DisplayVersion)"
$cpu = @(Get-CimInstance Win32_Processor)
$board = @(Get-CimInstance Win32_BaseBoard)
$memory = @(Get-CimInstance Win32_PhysicalMemory)
$gpu = @(Get-CimInstance Win32_VideoController)
$monitor = @(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID)
$desktopMonitor = @(Get-CimInstance Win32_DesktopMonitor)
$disk = @(Get-CimInstance Win32_DiskDrive)
$physicalDisk = @(Get-CimInstance -Namespace root\Microsoft\Windows\Storage -ClassName MSFT_PhysicalDisk)
$audio = @(Get-CimInstance Win32_SoundDevice)
$nic = @(Get-CimInstance Win32_NetworkAdapter -Filter "PhysicalAdapter=True")
$vramMap = @{}
foreach ($key in @(Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue)) {
  $props = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
  $desc = "$($props.DriverDesc)".Trim()
  if (-not $desc) { continue }
  $size = [double]$props.'HardwareInformation.qwMemorySize'
  if (-not $size) {
    $rawSize = $props.'HardwareInformation.MemorySize'
    if ($rawSize -is [byte[]] -and $rawSize.Length -ge 4) {
      $size = [double][BitConverter]::ToUInt32($rawSize, 0)
    }
  }
  if ($size -gt 0 -and -not $vramMap.ContainsKey($desc)) { $vramMap[$desc] = $size }
}
$payload = [pscustomobject]@{
  manufacturer = "$($cs.Manufacturer)"
  model = "$($cs.Model)"
  totalMemory = [double]$cs.TotalPhysicalMemory
  osCaption = "$($os.Caption)"
  osDisplayVersion = $osDisplayVersion
  osBuild = "$($os.BuildNumber)"
  osArch = "$($os.OSArchitecture)"
  cpu = @($cpu | ForEach-Object { [pscustomobject]@{ name = "$($_.Name)"; cores = [int]$_.NumberOfCores; threads = [int]$_.NumberOfLogicalProcessors } })
  board = @($board | ForEach-Object { [pscustomobject]@{ manufacturer = "$($_.Manufacturer)"; product = "$($_.Product)" } })
  memory = @($memory | ForEach-Object { [pscustomobject]@{ capacity = [double]$_.Capacity; speed = [int]$_.Speed; part = "$($_.PartNumber)" } })
  gpu = @($gpu | ForEach-Object {
    $name = "$($_.Name)".Trim()
    $vram = 0
    if ($vramMap.ContainsKey($name)) { $vram = [double]$vramMap[$name] }
    if (-not $vram) { $vram = [double]$_.AdapterRAM }
    [pscustomobject]@{ name = $name; driver = "$($_.DriverVersion)"; vram = $vram; width = [int]$_.CurrentHorizontalResolution; height = [int]$_.CurrentVerticalResolution }
  })
  monitor = @($monitor | ForEach-Object { [pscustomobject]@{ manufacturer = (TextFromBytes $_.ManufacturerName); name = (TextFromBytes $_.UserFriendlyName); year = [int]$_.YearOfManufacture } })
  desktopMonitor = @($desktopMonitor | ForEach-Object { [pscustomobject]@{ name = "$($_.Name)"; width = [int]$_.ScreenWidth; height = [int]$_.ScreenHeight } })
  disk = @($disk | ForEach-Object { [pscustomobject]@{ index = [int]$_.Index; model = "$($_.Model)"; size = [double]$_.Size } })
  physicalDisk = @($physicalDisk | ForEach-Object { [pscustomobject]@{ deviceId = "$($_.DeviceId)"; mediaType = [int]$_.MediaType; busType = [int]$_.BusType } })
  audio = @($audio | ForEach-Object { [pscustomobject]@{ name = "$($_.Name)" } })
  nic = @($nic | ForEach-Object { [pscustomobject]@{ name = "$($_.Name)"; mac = "$($_.MACAddress)"; speed = [double]$_.Speed; status = [int]$_.NetConnectionStatus } })
}
ConvertTo-Json -InputObject $payload -Depth 4 -Compress
`

let cached: SystemInfoResult | null = null
let diskLoaded = false

function cacheFile(): string {
  return join(app.getPath('userData'), 'system-info.json')
}

function normalizeCached(value: unknown): SystemInfoResult | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Partial<SystemInfoResult>
  if (input.ok !== true || !Array.isArray(input.entries) || input.entries.length === 0) return null
  const entries = input.entries.filter(
    (entry): entry is SystemInfoEntry =>
      Boolean(entry) &&
      typeof entry.key === 'string' &&
      typeof entry.label === 'string' &&
      Array.isArray(entry.lines)
  )
  if (entries.length === 0) return null
  return { ok: true, entries, collectedAt: Number(input.collectedAt) || 0 }
}

/** 上次采集结果落盘，重开应用先读缓存，不再重新跑 PowerShell */
async function readCached(): Promise<SystemInfoResult | null> {
  if (diskLoaded) return cached
  diskLoaded = true
  try {
    const text = await readFile(cacheFile(), 'utf8')
    const value = normalizeCached(JSON.parse(text))
    if (value) cached = value
    return value
  } catch {
    return null
  }
}

async function writeCached(value: SystemInfoResult): Promise<void> {
  try {
    await writeFile(cacheFile(), JSON.stringify(value), 'utf8')
  } catch {
    // 写缓存失败不影响本次结果
  }
}

/** 读取电脑信息；默认优先使用上次采集结果，force = true 时重新采集 */
export async function collectSystemInfo(force = false): Promise<SystemInfoResult> {
  if (!force) {
    if (cached) return cached
    const disk = await readCached()
    if (disk) return disk
  }
  try {
    const output = await runPowerShell(SCRIPT)
    const raw = JSON.parse(output) as RawSystemInfo
    const result: SystemInfoResult = {
      ok: true,
      entries: buildEntries(raw),
      collectedAt: Date.now()
    }
    cached = result
    diskLoaded = true
    await writeCached(result)
    return result
  } catch (err) {
    return {
      ok: false,
      entries: [],
      error: (err as Error).message,
      collectedAt: Date.now()
    }
  }
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value
  return value == null ? [] : [value]
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function joinParts(parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => !!part).join(' · ')
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function formatLinkSpeed(bps: number): string {
  if (!bps || bps <= 0 || bps > 1e12) return ''
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(bps >= 1e10 ? 0 : 1)} Gbps`
  if (bps >= 1e6) return `${Math.round(bps / 1e6)} Mbps`
  if (bps >= 1e3) return `${Math.round(bps / 1e3)} Kbps`
  return `${Math.round(bps)} bps`
}

function vendorModel(manufacturer: string, model: string): string {
  if (!model) return manufacturer
  if (!manufacturer) return model
  return model.toLowerCase().includes(manufacturer.toLowerCase()) ? model : `${manufacturer} ${model}`
}

function buildEntries(raw: RawSystemInfo): SystemInfoEntry[] {
  const modelLines = [vendorModel(clean(raw.manufacturer), clean(raw.model))].filter(Boolean)

  const osCaption = clean(raw.osCaption).replace(/^Microsoft\s+/i, '')
  const osLines = [
    joinParts([
      osCaption,
      clean(raw.osDisplayVersion),
      clean(raw.osArch),
      clean(raw.osBuild) ? `Build ${clean(raw.osBuild)}` : ''
    ])
  ].filter(Boolean)

  const cpuLines = toArray(raw.cpu)
    .map((cpu) => {
      const cores = num(cpu.cores)
      const threads = num(cpu.threads)
      return joinParts([
        clean(cpu.name),
        cores > 0 && threads > 0
          ? `${cores} 核 ${threads} 线程`
          : threads > 0
            ? `${threads} 线程`
            : ''
      ])
    })
    .filter(Boolean)

  const boardLines = toArray(raw.board)
    .map((board) => vendorModel(clean(board.manufacturer), clean(board.product)))
    .filter(Boolean)

  const memoryModules = toArray(raw.memory)
    .map((memory) =>
      joinParts([
        num(memory.capacity) > 0 ? formatBytes(num(memory.capacity)) : '',
        num(memory.speed) > 0 ? `${num(memory.speed)} MHz` : '',
        clean(memory.part)
      ])
    )
    .filter(Boolean)
  const moduleTotal = toArray(raw.memory).reduce(
    (sum, memory) => sum + num(memory.capacity),
    0
  )
  const totalMemory = moduleTotal || num(raw.totalMemory)
  const memoryLines =
    memoryModules.length > 1 && totalMemory > 0
      ? [`共 ${formatBytes(totalMemory)}`, ...memoryModules]
      : memoryModules.length > 0
        ? memoryModules
        : totalMemory > 0
          ? [`共 ${formatBytes(totalMemory)}`]
          : []

  const gpus = toArray(raw.gpu)
  const gpuLines = gpus
    .map((gpu) =>
      joinParts([
        clean(gpu.name),
        num(gpu.vram) > 0 ? `显存 ${formatBytes(num(gpu.vram))}` : '',
        clean(gpu.driver) ? `驱动 ${clean(gpu.driver)}` : '',
        num(gpu.width) > 0 && num(gpu.height) > 0
          ? `${num(gpu.width)} × ${num(gpu.height)}`
          : ''
      ])
    )
    .filter(Boolean)

  const primaryResolution = gpus
    .map((gpu) =>
      num(gpu.width) > 0 && num(gpu.height) > 0
        ? `${num(gpu.width)} × ${num(gpu.height)}`
        : ''
    )
    .find(Boolean)

  const monitorLines = toArray(raw.monitor)
    .map((monitor) => {
      const name = clean(monitor.name)
      const vendor = clean(monitor.manufacturer)
      const label =
        name && vendor && !name.toLowerCase().startsWith(vendor.toLowerCase())
          ? `${vendor} ${name}`
          : name || vendor
      return joinParts([label, num(monitor.year) > 0 ? `${num(monitor.year)} 年` : ''])
    })
    .filter(Boolean)
  if (monitorLines.length === 0) {
    monitorLines.push(
      ...toArray(raw.desktopMonitor)
        .map((monitor) =>
          joinParts([
            clean(monitor.name),
            num(monitor.width) > 0 && num(monitor.height) > 0
              ? `${num(monitor.width)} × ${num(monitor.height)}`
              : ''
          ])
        )
        .filter(Boolean)
    )
  }
  if (monitorLines.length > 0 && primaryResolution) {
    monitorLines[0] = joinParts([monitorLines[0], primaryResolution])
  } else if (monitorLines.length === 0 && primaryResolution) {
    monitorLines.push(`当前分辨率 ${primaryResolution}`)
  }

  const diskMedia = new Map<string, string>()
  for (const physical of toArray(raw.physicalDisk)) {
    const id = clean(physical.deviceId)
    if (!id) continue
    const mediaType = num(physical.mediaType)
    const busType = num(physical.busType)
    // MSFT_PhysicalDisk：3 = HDD，4 = SSD，5 = SCM；BusType 17 = NVMe
    const label =
      mediaType === 3
        ? '机械'
        : mediaType === 4 || mediaType === 5 || busType === 17
          ? '固态'
          : ''
    if (label) diskMedia.set(id, label)
  }

  const diskLines = toArray(raw.disk)
    .map((disk) => {
      const fallback = /nvme|ssd/i.test(clean(disk.model)) ? '固态' : ''
      return joinParts([
        clean(disk.model),
        num(disk.size) > 0 ? formatBytes(num(disk.size)) : '',
        diskMedia.get(String(num(disk.index))) ?? fallback
      ])
    })
    .filter(Boolean)

  const audioLines = unique(toArray(raw.audio).map((audio) => clean(audio.name)).filter(Boolean))

  const nicLines = unique(
    toArray(raw.nic)
      .filter((nic) => clean(nic.mac))
      .filter((nic) => !/bluetooth|virtual|tunnel|loopback|wan miniport|蓝牙|虚拟/i.test(clean(nic.name)))
      .map((nic) =>
        joinParts([
          clean(nic.name),
          clean(nic.mac) ? `MAC ${clean(nic.mac)}` : '',
          formatLinkSpeed(num(nic.speed)),
          NIC_STATUS[num(nic.status)] ?? ''
        ])
      )
      .filter(Boolean)
  )

  const entry = (key: string, label: string, lines: string[]): SystemInfoEntry => ({
    key,
    label,
    lines: lines.length > 0 ? lines : ['未获取到']
  })

  return [
    entry('model', '型号', modelLines),
    entry('os', '系统', osLines),
    entry('cpu', '处理器', cpuLines),
    entry('board', '主板', boardLines),
    entry('memory', '内存', memoryLines),
    entry('gpu', '显卡', gpuLines),
    entry('monitor', '显示器', monitorLines),
    entry('disk', '硬盘', diskLines),
    entry('audio', '声卡', audioLines),
    entry('network', '网卡', nicLines)
  ]
}

