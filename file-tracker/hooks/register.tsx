import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { TouchedFile } from '../types'

const PANE = 'file-tracker'
// The shared theme file lives in the Claude config dir (CLAUDE_CONFIG_DIR, else ~/.claude).
const themeFile = async ($: any): Promise<string> => {
  const cfg = await $.env.get('CLAUDE_CONFIG_DIR')
  if (cfg) return `${cfg}/nerd-theme.json`
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''

  return `${home}/.claude/nerd-theme.json`
}
const DEFAULT = { accent: '#22d3ee', value: '#4ade80', dim: '#6b7280', warn: '#fbbf24', bad: '#f87171' }

// ---- tweak me -------------------------------------------------------------
const MAX_ROWS = 20
// tool name -> [input field holding the path, counts as "write" or "edit"]
const WATCH: Record<string, [string, 'edits' | 'writes']> = {
  Edit: ['file_path', 'edits'],
  MultiEdit: ['file_path', 'edits'],
  Write: ['file_path', 'writes'],
  NotebookEdit: ['notebook_path', 'edits'],
}
// ---------------------------------------------------------------------------

const files = atom({ plugin: 'file-tracker', key: 'files' } as const, [], {
  shape: 'files-1',
})

const loadTheme = async ($: any) => {
  try {
    return { ...DEFAULT, ...JSON.parse((await $.fs.read(await themeFile($))) as string) }
  } catch {
    return DEFAULT
  }
}

const short = (p: string) => {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 3 ? '\u2026/' + parts.slice(-3).join('/') : parts.join('/')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'files',
      description: 'Open a pane listing files edited or written this session',
    })

    return next(e)
  })

  on('command.run', { command: 'files' }, async $ => {
    await $.ui.open({ id: PANE, title: 'touched files' })

    return { text: 'touched files pane opened.' }
  })

  on('tool.call', async ($, e, next) => {
    const watch = WATCH[e.tool]
    const ran = await next(e)

    if (watch && ran.deny === undefined && ran.isError !== true) {
      const input = e as unknown as Record<string, unknown>
      const path = input[watch[0]]

      if (typeof path === 'string') {
        const kind = watch[1]
        await update($, files, list => {
          const found = list.find(f => f.path === path)
          const item: TouchedFile = {
            path,
            edits: (found?.edits ?? 0) + (kind === 'edits' ? 1 : 0),
            writes: (found?.writes ?? 0) + (kind === 'writes' ? 1 : 0),
          }

          return found ? list.map(f => (f.path === path ? item : f)) : [...list, item]
        })
      }
    }

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const t = await loadTheme($)
    const list = [...(await read($, files))].sort((a, b) => b.edits + b.writes - (a.edits + a.writes))
    const shown = list.slice(0, MAX_ROWS)

    if (shown.length === 0) {
      return (
        <Box flexDirection="column">
          <Text color={t.accent}>$ git status --session</Text>
          <Text dimColor>nothing to commit, working tree clean</Text>
        </Box>
      )
    }

    const total = list.reduce((n, f) => n + f.edits + f.writes, 0)

    return (
      <Box flexDirection="column">
        <Text color={t.accent}>$ git status --session</Text>
        {shown.map(f => (
          <Text>
            <Text color={f.writes > 0 && f.edits === 0 ? t.warn : t.value}>
              {f.writes > 0 && f.edits === 0 ? 'A ' : 'M '}
            </Text>
            <Text>{short(f.path)}</Text>
            <Text dimColor>{` \u00D7${f.edits + f.writes}`}</Text>
          </Text>
        ))}
        <Text color={t.dim}>{'\u2500'.repeat(24)}</Text>
        <Text dimColor>{`\u03A3 ${list.length} files \u00B7 ${total} writes`}</Text>
      </Box>
    )
  })
}
