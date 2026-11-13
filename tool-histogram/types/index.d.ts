export type ToolCount = { tool: string; count: number; failed: number; totalMs: number; maxMs: number }
export type TurnStat = { inTok: number; outTok: number; cacheRead: number; cacheWrite: number; ms: number }

declare module 'claude-code' {
  interface PluginState {
    'tool-histogram': {
      counts: Shaped<ToolCount[]>
      turns: Shaped<TurnStat[]>
      durations: Shaped<number[]>
    }
  }
}
