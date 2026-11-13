export type ToolCount = { tool: string; count: number; failed: number; totalMs: number; maxMs: number }
export type TurnStat = { inTok: number; outTok: number; cacheRead: number; cacheWrite: number; ms: number }
export type Alerts = { b80: boolean; b100: boolean; c70: boolean; c85: boolean }
export type Mark = { t: number; tool: string }

declare module 'claude-code' {
  interface PluginState {
    'tool-histogram': {
      counts: Shaped<ToolCount[]>
      turns: Shaped<TurnStat[]>
      durations: Shaped<number[]>
      alerts: Shaped<Alerts>
      marks: Shaped<Mark[]>
    }
  }
}
