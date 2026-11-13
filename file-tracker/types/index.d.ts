export type TouchedFile = { path: string; edits: number; writes: number }

declare module 'claude-code' {
  interface PluginState {
    'file-tracker': { files: Shaped<TouchedFile[]> }
  }
}
