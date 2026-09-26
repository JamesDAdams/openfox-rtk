import { describe, it, expect, vi, beforeEach } from 'vitest'
import { register } from './index.js'
import * as client from './client.js'

describe('openfox-rtk plugin', () => {
  let mockRegistry: any
  let registeredSettings: any = null
  let registeredRpcs = new Map<string, Function>()
  let registeredTools = new Map<string, any>()
  let registeredComponents = new Map<string, any>()
  let registeredPanels = new Map<string, any>()
  let registeredActions = new Map<string, any>()
  let mockContextSettings: Record<string, unknown> = {}

  beforeEach(() => {
    registeredRpcs.clear()
    registeredTools.clear()
    registeredComponents.clear()
    registeredPanels.clear()
    registeredActions.clear()
    mockContextSettings = {}

    mockRegistry = {
      context: {
        settings: () => mockContextSettings,
        publish: vi.fn(),
        notify: vi.fn(),
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      },
      registerSettings: vi.fn((schema) => {
        registeredSettings = schema
      }),
      registerRpc: vi.fn((name, handler) => {
        registeredRpcs.set(name, handler)
      }),
      registerTool: vi.fn((tool) => {
        registeredTools.set(tool.name, tool)
      }),
      registerUiComponent: vi.fn((component) => {
        registeredComponents.set(component.id, component)
      }),
      registerUiPanel: vi.fn((panel) => {
        registeredPanels.set(panel.id, panel)
      }),
      registerSettingsTab: vi.fn(),
      registerUiAction: vi.fn((action) => {
        registeredActions.set(action.id, action)
      }),
      registerUiBadge: vi.fn(),
    }
  })

  it('registers settings, RPCs, components, panels, and tools on register()', () => {
    register(mockRegistry)

    expect(mockRegistry.registerSettings).toHaveBeenCalled()
    expect(registeredSettings.fields).toHaveLength(7)
    const installField = registeredSettings.fields.find((f: any) => f.key === 'installCli')
    expect(installField?.hideWhenInstalled).toBe(true)

    expect(registeredRpcs.has('getStatus')).toBe(true)
    expect(registeredRpcs.has('getGainStats')).toBe(true)
    expect(registeredRpcs.has('refreshGainStats')).toBe(true)
    expect(registeredRpcs.has('startProxy')).toBe(true)
    expect(registeredRpcs.has('stopProxy')).toBe(true)
    expect(registeredRpcs.has('restartProxy')).toBe(true)
    expect(registeredRpcs.has('installCli')).toBe(true)
    expect(registeredRpcs.has('refreshStatus')).toBe(true)
    expect(registeredRpcs.has('rewriteCommand')).toBe(true)
    expect(registeredRpcs.has('checkShell')).toBe(true)

    expect(registeredTools.has('rtk_rewrite')).toBe(true)
    expect(registeredPanels.has('rtk-dashboard')).toBe(true)
    expect(registeredComponents.has('rtk-header-btn')).toBe(true)
    expect(registeredActions.get('rtk-menu')).toMatchObject({
      slot: 'plugin.menu',
      onActivate: { kind: 'openPanel', panelId: 'rtk-dashboard' },
    })
  })

  it('hides the header button by default', () => {
    register(mockRegistry)

    const field = registeredSettings.fields.find((f: any) => f.key === 'showHeaderButton')
    expect(field?.default).toBe(false)
  })

  it('handles getStatus and getGainStats RPCs', async () => {
    vi.spyOn(client, 'checkRtkAvailability').mockResolvedValue({
      installed: true,
      version: 'rtk 0.1.0',
      path: '/usr/local/bin/rtk',
    })
    vi.spyOn(client, 'getRtkGainStats').mockResolvedValue({
      success: true,
      output: 'Tokens saved: 582.5M (90.4%)',
    })

    register(mockRegistry)
    const getStatusHandler = registeredRpcs.get('getStatus')!
    const result = await getStatusHandler()

    expect(result.installed).toBe(true)
    expect(result.version).toBe('rtk 0.1.0')

    const getGainStatsHandler = registeredRpcs.get('getGainStats')!
    const gainResult = await getGainStatsHandler()
    expect(gainResult.output).toBe('Tokens saved: 582.5M (90.4%)')
  })

  it('handles startProxy, stopProxy, and restartProxy RPCs', async () => {
    vi.spyOn(client, 'startRtkService').mockResolvedValueOnce({ success: true, message: 'Started' })
    vi.spyOn(client, 'stopRtkService').mockResolvedValueOnce({ success: true, message: 'Stopped' })
    vi.spyOn(client, 'restartRtkService').mockResolvedValueOnce({ success: true, message: 'Restarted' })

    register(mockRegistry)
    const startHandler = registeredRpcs.get('startProxy')!
    const stopHandler = registeredRpcs.get('stopProxy')!
    const restartHandler = registeredRpcs.get('restartProxy')!

    const startRes = await startHandler()
    expect(startRes.success).toBe(true)

    const stopRes = await stopHandler()
    expect(stopRes.success).toBe(true)

    const restartRes = await restartHandler()
    expect(restartRes.success).toBe(true)
  })

  it('handles installCli RPC', async () => {
    vi.spyOn(client, 'installRtkCli').mockResolvedValueOnce({ success: true, message: 'Installed' })

    register(mockRegistry)
    const installHandler = registeredRpcs.get('installCli')!
    const result = await installHandler()

    expect(result.success).toBe(true)
  })

  it('handles rewriteCommand RPC', async () => {
    vi.spyOn(client, 'rewriteCommandWithRtk').mockResolvedValueOnce({
      success: true,
      rewritten: 'rtk git status',
      changed: true,
    })

    register(mockRegistry)
    const rewriteHandler = registeredRpcs.get('rewriteCommand')!
    const result = await rewriteHandler({ command: 'git status' })

    expect(result.success).toBe(true)
    expect(result.rewritten).toBe('rtk git status')
    expect(result.changed).toBe(true)
  })

  it('handles checkShell RPC for Windows and Unix', async () => {
    register(mockRegistry)
    const checkShellHandler = registeredRpcs.get('checkShell')!
    expect(await checkShellHandler({ shell: 'cmd' })).toBeDefined()

    const winCmd = client.checkShellCompatibility('cmd', 'win32')
    expect(winCmd.compatible).toBe(false)
    expect(winCmd.warning).toBeDefined()

    const winBash = client.checkShellCompatibility('gitbash', 'win32')
    expect(winBash.compatible).toBe(true)
    expect(winBash.warning).toBeUndefined()

    const linux = client.checkShellCompatibility('sh', 'linux')
    expect(linux.compatible).toBe(true)
  })

  it('executes rtk_rewrite tool successfully', async () => {
    vi.spyOn(client, 'rewriteCommandWithRtk').mockResolvedValueOnce({
      success: true,
      rewritten: 'rtk cargo test',
      changed: true,
    })

    register(mockRegistry)
    const tool = registeredTools.get('rtk_rewrite')
    const res = await tool.execute({ command: 'cargo test' })

    expect(res.success).toBe(true)
    expect(res.output).toBe('rtk cargo test')
  })

  it('executes rtk_rewrite tool with empty command', async () => {
    register(mockRegistry)
    const tool = registeredTools.get('rtk_rewrite')
    const res = await tool.execute({ command: '' })

    expect(res.success).toBe(false)
    expect(res.error).toBeDefined()
  })

  describe('header button visibility', () => {
    it('registers an empty header slot when the setting is off', () => {
      mockContextSettings = { showHeaderButton: false }
      vi.spyOn(client, 'checkRtkAvailability').mockReturnValue(new Promise(() => {}) as any)

      register(mockRegistry)

      expect(registeredComponents.get('rtk-header-btn')?.component).toEqual({
        type: 'stack',
        direction: 'row',
        children: [],
      })
    })

    it('re-registers the header button when the setting changes', async () => {
      mockContextSettings = { showHeaderButton: true }
      vi.spyOn(client, 'checkRtkAvailability').mockResolvedValue({
        installed: true,
        version: 'rtk 0.1.0',
      })
      vi.spyOn(client, 'getRtkGainStats').mockResolvedValue({ success: true, output: '' })

      register(mockRegistry)
      await registeredRpcs.get('getStatus')!()
      expect(registeredComponents.get('rtk-header-btn')?.component.type).toBe('button')

      mockContextSettings = { showHeaderButton: false }
      await registeredRpcs.get('getStatus')!()

      expect(registeredComponents.get('rtk-header-btn')?.component).toEqual({
        type: 'stack',
        direction: 'row',
        children: [],
      })
    })
  })
})
