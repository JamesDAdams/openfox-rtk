import {
  checkRtkAvailability,
  installRtkCli,
  startRtkService,
  stopRtkService,
  restartRtkService,
  rewriteCommandWithRtk,
  checkShellCompatibility,
  getRtkGainStats,
  parseRtkGain,
  type RtkStatus,
  type RtkRewriteResult,
} from './client.js'

export interface LocalizedString {
  en: string
  fr: string
}

export interface PluginContext {
  settings(scope?: 'global' | 'project', projectId?: string): Record<string, unknown>
  publish(panelId: string | undefined, key: string, value: unknown): void
  notify(request: {
    title: LocalizedString
    body?: LocalizedString
    level?: 'info' | 'success' | 'warning' | 'error'
  }): void
  logger: {
    debug(msg: string, ctx?: Record<string, unknown>): void
    info(msg: string, ctx?: Record<string, unknown>): void
    warn(msg: string, ctx?: Record<string, unknown>): void
    error(msg: string, ctx?: Record<string, unknown>): void
  }
}

export interface PluginRegistry {
  readonly context: PluginContext
  registerSettings(schema: any): void
  registerRpc(method: string, handler: any): void
  registerTool(tool: any): void
  registerSettingsTab(tab: any): void
  registerUiAction(action: any): void
  registerUiBadge(badge: any): void
  registerUiPanel(panel: any): void
  registerUiComponent(component: any): void
}

let pollInterval: NodeJS.Timeout | null = null
let activeRegistry: PluginRegistry | null = null

function readShowHeaderButton(context: PluginContext): boolean {
  const settings = context.settings() ?? {}
  return settings['showHeaderButton'] !== false
}

function getHeaderComponent(installed: boolean, show: boolean) {
  if (!show) {
    return {
      type: 'stack' as const,
      direction: 'row' as const,
      children: [],
    }
  }

  const dotColor = installed ? '#22c55e' : '#ef4444'
  const tooltipText = installed
    ? { en: 'RTK: Active (Click to view token savings)', fr: 'RTK : Actif (Cliquer pour voir les économies de tokens)' }
    : { en: 'RTK: Not installed (Click to configure in Settings)', fr: 'RTK : Non installé (Cliquer pour configurer)' }

  return {
    type: 'button' as const,
    variant: 'ghost' as const,
    label: { en: 'RTK', fr: 'RTK' },
    tooltip: tooltipText,
    icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><image href="https://avatars.githubusercontent.com/u/258253854?s=60&amp;v=4" x="1" y="2" width="18" height="18" preserveAspectRatio="xMidYMid slice"/><circle cx="19" cy="5" r="3.5" fill="${dotColor}" stroke="#0f172a" stroke-width="1.5"/></svg>`,
    onActivate: {
      kind: 'openPanel' as const,
      panelId: 'rtk-dashboard',
    },
  }
}

function buildDashboardNodes(gainOutput: string, installed: boolean) {
  const parsed = parseRtkGain(gainOutput)

  return [
    {
      type: 'card' as const,
      title: { en: 'Token Savings Overview', fr: 'Vue d’ensemble des économies de tokens' },
      subtitle: {
        en: 'Metrics aggregated across all commands executed through RTK (Global Scope).',
        fr: 'Métriques agrégées sur l’ensemble des commandes exécutées avec RTK (Portée globale).',
      },
      children: [
        {
          type: 'keyValue' as const,
          items: [
            { key: { en: 'Total Commands', fr: 'Commandes totales' }, value: parsed.totalCommands },
            { key: { en: 'Input Tokens', fr: 'Tokens d’entrée' }, value: parsed.inputTokens },
            { key: { en: 'Output Tokens', fr: 'Tokens de sortie' }, value: parsed.outputTokens },
            {
              key: { en: 'Tokens Saved', fr: 'Tokens économisés' },
              value: `${parsed.tokensSaved} (${parsed.savedPercent})`,
            },
            { key: { en: 'Total Execution Time', fr: 'Temps d’exécution total' }, value: parsed.totalExecTime },
          ],
        },
        { type: 'divider' as const },
        {
          type: 'progress' as const,
          label: { en: 'Overall Token Reduction', fr: 'Réduction globale de tokens' },
          value: parsed.efficiencyPct,
          max: 100,
          tone: 'success' as const,
        },
      ],
    },
    ...(parsed.commands.length > 0
      ? [
          {
            type: 'card' as const,
            title: { en: 'Savings by Command', fr: 'Économies par Commande' },
            subtitle: {
              en: 'Top commands optimized by RTK ranked by total token savings.',
              fr: 'Top des commandes optimisées par RTK classées par volume de tokens économisés.',
            },
            children: [
              {
                type: 'table' as const,
                columns: [
                  { en: '#', fr: '#' },
                  { en: 'Command', fr: 'Commande' },
                  { en: 'Count', fr: 'Nombre' },
                  { en: 'Tokens Saved', fr: 'Tokens Économisés' },
                  { en: 'Avg %', fr: 'Moy. %' },
                  { en: 'Avg Time', fr: 'Temps Moy.' },
                ],
                rows: parsed.commands.map((c) => [
                  c.rank,
                  c.command,
                  c.count,
                  c.saved,
                  c.avgPct,
                  c.time,
                ]),
              },
            ],
          },
        ]
      : [
          {
            type: 'card' as const,
            title: { en: 'By Command Breakdown', fr: 'Détail par commande' },
            children: [
              {
                type: 'text' as const,
                muted: true,
                text: {
                  en: installed
                    ? 'No command breakdown available yet. Run commands with RTK to populate metrics.'
                    : 'RTK CLI is not installed.',
                  fr: installed
                    ? 'Aucun détail de commande disponible pour le moment. Exécutez des commandes pour enrichir les métriques.'
                    : 'Le CLI RTK n’est pas installé.',
                },
              },
            ],
          },
        ]),
    {
      type: 'stack' as const,
      direction: 'row' as const,
      justify: 'end' as const,
      gap: 'sm' as const,
      children: [
        {
          type: 'button' as const,
          label: { en: 'Refresh Stats', fr: 'Rafraîchir les stats' },
          variant: 'default' as const,
          icon: 'refresh',
          onActivate: { kind: 'rpc' as const, method: 'refreshGainStats' },
        },
      ],
    },
  ]
}

async function updateLiveStatus(context: PluginContext): Promise<RtkStatus> {
  try {
    const showHeader = readShowHeaderButton(context)
    const status = await checkRtkAvailability()

    const headerNode = getHeaderComponent(status.installed, showHeader)
    // Keep the registered node in sync: a client that loads later renders it as-is,
    // so a stale node shows a header button the user disabled.
    activeRegistry?.registerUiComponent({ id: 'rtk-header-btn', zone: 'header.actions', component: headerNode })
    context.publish('rtk-header-btn', 'content', headerNode)

    const statusLabel = status.installed
      ? `● Installed (${status.version ?? 'ready'})`
      : `○ RTK CLI not found`
    const statusTone = status.installed ? 'success' : 'danger'

    context.publish('rtk-settings-status', 'statusText', statusLabel)
    context.publish('rtk-settings-status', 'statusTone', statusTone)

    const gainRes = await getRtkGainStats()
    const dashboardNodes = buildDashboardNodes(gainRes.output, status.installed)
    context.publish('rtk-dashboard', 'content', dashboardNodes)

    return status
  } catch {
    return { installed: false, running: false }
  }
}

export function register(registry: PluginRegistry): void {
  const context = registry.context

  // 1. Settings Schema
  registry.registerSettings({
    fields: [
      {
        key: 'daemonStatus',
        type: 'status',
        section: {
          en: 'RTK Token Optimizer Status & Controls',
          fr: 'Statut et Contrôles de l’optimiseur RTK',
        },
        label: {
          en: 'CLI Status',
          fr: 'Statut du CLI',
        },
        rpcMethod: 'getStatus',
      },
      {
        key: 'installCli',
        type: 'button',
        label: {
          en: 'Install RTK CLI',
          fr: 'Installer le CLI RTK',
        },
        buttonLabel: {
          en: 'Install via Cargo / Brew',
          fr: 'Installer via Cargo / Brew',
        },
        buttonVariant: 'primary',
        rpcMethod: 'installCli',
        width: 'full',
        hideWhenInstalled: true,
      },
      {
        key: 'startProxy',
        type: 'button',
        label: {
          en: 'Check RTK',
          fr: 'Vérifier RTK',
        },
        buttonLabel: {
          en: 'Check Status',
          fr: 'Vérifier l’état',
        },
        buttonVariant: 'primary',
        rpcMethod: 'startProxy',
        width: 'half',
      },
      {
        key: 'restartProxy',
        type: 'button',
        label: {
          en: 'Restart RTK',
          fr: 'Relancer RTK',
        },
        buttonLabel: {
          en: 'Restart',
          fr: 'Relancer',
        },
        buttonVariant: 'secondary',
        rpcMethod: 'restartProxy',
        width: 'half',
      },
      {
        key: 'stopProxy',
        type: 'button',
        label: {
          en: 'Close / Stop RTK',
          fr: 'Fermer / Arrêter RTK',
        },
        buttonLabel: {
          en: 'Close / Stop',
          fr: 'Fermer / Arrêter',
        },
        buttonVariant: 'danger',
        rpcMethod: 'stopProxy',
        width: 'half',
      },
      {
        key: 'enabled',
        type: 'boolean',
        section: {
          en: 'Token Optimization Settings',
          fr: 'Paramètres d’optimisation des jetons',
        },
        label: {
          en: 'Enable RTK Token Optimization',
          fr: 'Activer l’optimisation de jetons RTK',
        },
        description: {
          en: 'Filter and rewrite shell commands through RTK to reduce token usage.',
          fr: 'Filtre et réécrit les commandes shell via RTK pour réduire la consommation de jetons.',
        },
        default: true,
      },
      {
        key: 'showHeaderButton',
        type: 'boolean',
        label: {
          en: 'Show Header Button',
          fr: 'Afficher le bouton dans l’en-tête',
        },
        description: {
          en: 'Show a quick-access button with live status dot in the OpenFox header bar.',
          fr: 'Affiche un bouton d’accès rapide avec pastille d’état dans l’en-tête OpenFox.',
        },
        default: false,
      },
    ],
  })

  // 2. Header UI Component
  activeRegistry = registry
  registry.registerUiComponent({
    id: 'rtk-header-btn',
    zone: 'header.actions',
    component: getHeaderComponent(false, readShowHeaderButton(context)),
  })

  // 3. UI Dashboard Modal Panel (rtk gain metrics)
  registry.registerUiPanel({
    id: 'rtk-dashboard',
    title: { en: 'RTK Token Savings', fr: 'Économies de Tokens RTK' },
    size: '3xl',
    content: buildDashboardNodes('', false),
  })

  // Plugins menu row: clicking the plugin name opens the same dashboard as the header button.
  registry.registerUiAction({
    id: 'rtk-menu',
    slot: 'plugin.menu',
    label: { en: 'RTK Token Optimizer', fr: 'RTK Token Optimizer' },
    onActivate: { kind: 'openPanel', panelId: 'rtk-dashboard' },
  })

  // 4. RPC Methods
  registry.registerRpc('getStatus', async () => {
    const status = await checkRtkAvailability()
    const shellInfo = checkShellCompatibility()

    await updateLiveStatus(context)

    return {
      ...status,
      shellInfo,
    }
  })

  registry.registerRpc('getGainStats', async () => {
    const res = await getRtkGainStats()
    return res
  })

  registry.registerRpc('refreshGainStats', async () => {
    const status = await checkRtkAvailability()
    const gainRes = await getRtkGainStats()
    const dashboardNodes = buildDashboardNodes(gainRes.output, status.installed)
    context.publish('rtk-dashboard', 'content', dashboardNodes)
    return gainRes
  })

  registry.registerRpc('startProxy', async () => {
    const res = await startRtkService()
    await updateLiveStatus(context)
    return res
  })

  registry.registerRpc('stopProxy', async () => {
    const res = await stopRtkService()
    await updateLiveStatus(context)
    return res
  })

  registry.registerRpc('restartProxy', async () => {
    const res = await restartRtkService()
    await updateLiveStatus(context)
    return res
  })

  registry.registerRpc('installCli', async () => {
    context.notify({
      title: { en: 'Installing RTK CLI...', fr: 'Installation du CLI RTK...' },
      level: 'info',
    })
    const res = await installRtkCli()
    await updateLiveStatus(context)
    context.notify({
      title: {
        en: res.success ? 'RTK Installed' : 'Installation Failed',
        fr: res.success ? 'RTK Installé' : 'Échec de l’installation',
      },
      body: { en: res.message, fr: res.message },
      level: res.success ? 'success' : 'error',
    })
    return res
  })

  registry.registerRpc('refreshStatus', async () => {
    const status = await updateLiveStatus(context)
    return status
  })

  registry.registerRpc('rewriteCommand', async (params: Record<string, unknown>): Promise<RtkRewriteResult> => {
    const command = typeof params['command'] === 'string' ? params['command'] : ''
    return rewriteCommandWithRtk(command)
  })

  registry.registerRpc('checkShell', async (params: Record<string, unknown>) => {
    const shell = typeof params['shell'] === 'string' ? params['shell'] : undefined
    return checkShellCompatibility(shell)
  })

  // 6. Tool: rtk_rewrite
  registry.registerTool({
    name: 'rtk_rewrite',
    description: 'Rewrite a shell command through RTK (Rust Token Killer) for optimal token efficiency.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to rewrite',
        },
      },
      required: ['command'],
    },
    execute: async (args: Record<string, unknown>) => {
      const command = typeof args['command'] === 'string' ? args['command'] : ''
      if (!command) {
        return { success: false, error: 'Command argument is required' }
      }

      const res = await rewriteCommandWithRtk(command)

      if (!res.success) {
        return {
          success: false,
          output: command,
          error: res.error,
        }
      }

      return {
        success: true,
        output: res.rewritten,
      }
    },
  })

  // 7. Initial Status & Metrics Hydration
  void updateLiveStatus(context)

  if (!pollInterval) {
    pollInterval = setInterval(() => {
      void updateLiveStatus(context)
    }, 5000)
    pollInterval.unref?.()
  }
}

export async function deactivate(): Promise<void> {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
  await stopRtkService()
}

export * from './client.js'
