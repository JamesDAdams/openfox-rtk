import { spawn, exec } from 'node:child_process'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execP = promisify(exec)

export interface RtkStatus {
  installed: boolean
  running?: boolean
  version?: string
  path?: string
  error?: string
}

export interface RtkRewriteResult {
  success: boolean
  rewritten: string
  changed: boolean
  error?: string
}

export interface ShellCompatibility {
  compatible: boolean
  warning?: {
    en: string
    fr: string
  }
}

const COMMON_RTK_PATHS = [
  '/usr/local/bin/rtk',
  '/opt/homebrew/bin/rtk',
  join(homedir(), '.cargo', 'bin', 'rtk'),
  join(homedir(), '.cargo', 'bin', 'rtk.exe'),
]

let activeRtkProcess: ReturnType<typeof spawn> | null = null
let isRtkRunning = false

export async function findRtkBinary(customPath?: string): Promise<string | null> {
  if (customPath && customPath.trim()) {
    try {
      await access(customPath.trim())
      return customPath.trim()
    } catch {
      return null
    }
  }

  for (const candidate of COMMON_RTK_PATHS) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // try next candidate
    }
  }

  return 'rtk'
}

export async function checkRtkAvailability(customPath?: string): Promise<RtkStatus> {
  const binary = await findRtkBinary(customPath)
  if (!binary) {
    return { installed: false, running: false, error: 'Custom RTK binary path does not exist' }
  }

  try {
    const versionOutput = await new Promise<string>((resolve, reject) => {
      const proc = spawn(binary, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 3000,
      })
      let out = ''
      let err = ''
      proc.stdout?.on('data', (d: Buffer) => {
        out += d.toString()
      })
      proc.stderr?.on('data', (d: Buffer) => {
        err += d.toString()
      })
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code === 0) {
          resolve(out.trim() || err.trim())
        } else {
          reject(new Error(`rtk --version exited with code ${code}: ${err.trim()}`))
        }
      })
    })

    const isRtk = versionOutput.toLowerCase().includes('rtk')
    if (isRtk) {
      return {
        installed: true,
        running: isRtkRunning,
        version: versionOutput,
        path: binary !== 'rtk' ? binary : undefined,
      }
    }

    return {
      installed: false,
      running: false,
      error: `Binary found but unexpected output: ${versionOutput}`,
    }
  } catch (err) {
    return {
      installed: false,
      running: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function installRtkCli(): Promise<{ success: boolean; message: string }> {
  try {
    const cmd = 'cargo install rtk-cli || brew install rtk || brew install rtk-cli'
    await execP(cmd)
    const check = await checkRtkAvailability()
    if (check.installed) {
      return { success: true, message: `RTK CLI installed successfully (${check.version ?? 'ready'}).` }
    }
    return { success: false, message: 'Installation command ran but rtk binary was not found in PATH.' }
  } catch (error) {
    return { success: false, message: `Installation failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export async function startRtkService(customPath?: string): Promise<{ success: boolean; message: string }> {
  const check = await checkRtkAvailability(customPath)
  if (!check.installed) {
    return { success: false, message: 'RTK CLI is not installed on this machine.' }
  }

  isRtkRunning = true
  return { success: true, message: 'RTK service initialized.' }
}

export async function stopRtkService(): Promise<{ success: boolean; message: string }> {
  if (activeRtkProcess) {
    try {
      activeRtkProcess.kill('SIGTERM')
    } catch {}
    activeRtkProcess = null
  }
  isRtkRunning = false
  return { success: true, message: 'RTK service stopped.' }
}

export async function restartRtkService(customPath?: string): Promise<{ success: boolean; message: string }> {
  await stopRtkService()
  await new Promise((resolve) => setTimeout(resolve, 200))
  return startRtkService(customPath)
}

export async function rewriteCommandWithRtk(command: string, customPath?: string): Promise<RtkRewriteResult> {
  if (!command || !command.trim()) {
    return { success: true, rewritten: command, changed: false }
  }

  const binary = await findRtkBinary(customPath)
  if (!binary) {
    return { success: false, rewritten: command, changed: false, error: 'RTK binary not found' }
  }

  try {
    const rewritten = await new Promise<string>((resolve, reject) => {
      const proc = spawn(binary, ['rewrite', command], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 3000,
      })
      let out = ''
      let err = ''
      proc.stdout?.on('data', (d: Buffer) => {
        out += d.toString()
      })
      proc.stderr?.on('data', (d: Buffer) => {
        err += d.toString()
      })
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code === 0 || code === 3) {
          resolve(out.trim())
        } else {
          reject(new Error(`rtk rewrite exited with code ${code}: ${err.trim()}`))
        }
      })
    })

    const result = rewritten || command
    return {
      success: true,
      rewritten: result,
      changed: result !== command,
    }
  } catch (err) {
    return {
      success: false,
      rewritten: command,
      changed: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function getRtkGainStats(): Promise<{ success: boolean; output: string; error?: string }> {
  const binary = await findRtkBinary()
  if (!binary) {
    return { success: false, output: '', error: 'RTK CLI not installed' }
  }

  try {
    const output = await new Promise<string>((resolve, reject) => {
      const proc = spawn(binary, ['gain'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 4000,
      })
      let out = ''
      let err = ''
      proc.stdout?.on('data', (d: Buffer) => {
        out += d.toString()
      })
      proc.stderr?.on('data', (d: Buffer) => {
        err += d.toString()
      })
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code === 0) {
          resolve(out.trim())
        } else {
          reject(new Error(`rtk gain exited with code ${code}: ${err.trim()}`))
        }
      })
    })

    return { success: true, output }
  } catch (err) {
    return {
      success: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export interface ParsedRtkGain {
  totalCommands: string
  inputTokens: string
  outputTokens: string
  tokensSaved: string
  savedPercent: string
  totalExecTime: string
  efficiencyPct: number
  commands: Array<{
    rank: string
    command: string
    count: string
    saved: string
    avgPct: string
    time: string
  }>
}

export function parseRtkGain(raw: string): ParsedRtkGain {
  const result: ParsedRtkGain = {
    totalCommands: '0',
    inputTokens: '0',
    outputTokens: '0',
    tokensSaved: '0',
    savedPercent: '0%',
    totalExecTime: '0s',
    efficiencyPct: 0,
    commands: [],
  }

  if (!raw) return result

  const lines = raw.split('\n')
  let inCommandTable = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const totalCmdsMatch = trimmed.match(/Total commands:\s*([0-9.,]+[a-zA-Z]?)/i)
    if (totalCmdsMatch) result.totalCommands = totalCmdsMatch[1] ?? '0'

    const inputMatch = trimmed.match(/Input tokens:\s*([0-9.,]+[a-zA-Z]?)/i)
    if (inputMatch) result.inputTokens = inputMatch[1] ?? '0'

    const outputMatch = trimmed.match(/Output tokens:\s*([0-9.,]+[a-zA-Z]?)/i)
    if (outputMatch) result.outputTokens = outputMatch[1] ?? '0'

    const savedMatch = trimmed.match(/Tokens saved:\s*([0-9.,]+[a-zA-Z]?)\s*\(([^)]+)\)/i)
    if (savedMatch) {
      result.tokensSaved = savedMatch[1] ?? '0'
      result.savedPercent = savedMatch[2] ?? '0%'
    }

    const execTimeMatch = trimmed.match(/Total exec time:\s*([^(]+)/i)
    if (execTimeMatch) result.totalExecTime = execTimeMatch[1]?.trim() ?? '0s'

    const efficiencyMatch = trimmed.match(/Efficiency meter:.*?([0-9.]+)%/i)
    if (efficiencyMatch) {
      result.efficiencyPct = parseFloat(efficiencyMatch[1] ?? '0')
    }

    if (trimmed.includes('By Command')) {
      inCommandTable = true
      continue
    }

    if (inCommandTable) {
      const rowMatch = trimmed.match(
        /^\s*(\d+)\.\s+(.*?)\s+(\d+)\s+([0-9.]+[a-zA-Z]?)\s+([0-9.]+%)\s+([0-9.]+(?:ms|s|m|h))\s*(.*)$/,
      )
      if (rowMatch) {
        result.commands.push({
          rank: rowMatch[1] ?? '',
          command: rowMatch[2]?.trim() ?? '',
          count: rowMatch[3] ?? '',
          saved: rowMatch[4] ?? '',
          avgPct: rowMatch[5] ?? '',
          time: rowMatch[6] ?? '',
        })
      }
    }
  }

  return result
}

export function checkShellCompatibility(shell?: string, platform = process.platform): ShellCompatibility {
  if (platform !== 'win32') {
    return { compatible: true }
  }

  const normalized = (shell || '').toLowerCase().trim()
  if (normalized === 'gitbash' || normalized === 'bash' || normalized === 'zsh') {
    return { compatible: true }
  }

  return {
    compatible: false,
    warning: {
      en: 'RTK only rewrites Unix-style commands — with cmd/PowerShell it will rarely apply and can break some commands. Git Bash is recommended.',
      fr: 'RTK ne réécrit que les commandes de type Unix — avec cmd/PowerShell, il s’appliquera rarement et peut casser certaines commandes. Git Bash est recommandé.',
    },
  }
}
