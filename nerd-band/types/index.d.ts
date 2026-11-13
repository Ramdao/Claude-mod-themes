export type Stats = {
  startedAt: number
  turns: number
  tools: number
  lastSeconds: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'nerd-band': { stats: Shaped<Stats> }
  }
}
