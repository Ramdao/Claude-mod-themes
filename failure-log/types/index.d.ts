export type Failure = { n: number; tool: string; target: string; reason: string }

declare module 'claude-code' {
  interface PluginState {
    'failure-log': { failures: Shaped<Failure[]> }
  }
}
