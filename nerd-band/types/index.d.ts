export type Stats = {
  startedAt: number
  turns: number
  tools: number
  lastSeconds: number | null
  recent: number[] // seconds of the last turns
  byTool: Record<string, number> // calls per tool
}

declare module 'claude-code' {
  interface PluginState {
    'nerd-band': { stats: Shaped<Stats> }
  }
}
