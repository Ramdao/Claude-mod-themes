import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Failure } from '../types'

const PANE = 'failure-log'
// The shared theme file lives in the Claude config dir (CLAUDE_CONFIG_DIR, else ~/.claude).
const themeFile = async ($: any): Promise<string> => {
  const cfg = await $.env.get('CLAUDE_CONFIG_DIR')
  if (cfg) return `${cfg}/nerd-theme.json`
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''

  return `${home}/.claude/nerd-theme.json`
}
const DEFAULT = { accent: '#22d3ee', value: '#4ade80', dim: '#6b7280', warn: '#fbbf24', bad: '#f87171' }

// ---- tweak me -------------------------------------------------------------
const KEEP = 100 // failures remembered
const SHOW = 10 // failures listed in the pane
const WIDTH = 60 // truncate target / reason to this many chars
// ---------------------------------------------------------------------------

const failures = atom({ plugin: 'failure-log', key: 'failures' } as const, [], {
  shape: 'failures-1',
})

const loadTheme = async ($: any) => {
  try {
    return { ...DEFAULT, ...JSON.parse((await $.fs.read(await themeFile($))) as string) }
  } catch {
    return DEFAULT
  }
}

const clip = (s: string) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > WIDTH ? one.slice(0, WIDTH - 1) + '\u2026' : one
}

// What the call was aimed at: the command, the path, or the pattern.
const targetOf = (e: unknown) => {
  const i = e as Record<string, unknown>
  const pick = i.command ?? i.file_path ?? i.notebook_path ?? i.pattern ?? i.url ?? ''

  return clip(String(pick))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'fails',
      description: 'Open a pane listing failed or denied tool calls',
    })

    return next(e)
  })

  on('command.run', { command: 'fails' }, async $ => {
    await $.ui.open({ id: PANE, title: 'failures' })

    return { text: 'failures pane opened.' }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const isDenied = ran.deny !== undefined
    const isFailed = !isDenied && ran.isError === true

    if (isDenied || isFailed) {
      const reason = isDenied ? String(ran.deny) : typeof ran.text === 'string' ? ran.text : 'error'
      await update($, failures, list => {
        const n = (list[list.length - 1]?.n ?? 0) + 1
        const item: Failure = { n, tool: e.tool, target: targetOf(e), reason: clip(reason) }

        return [...list, item].slice(-KEEP)
      })
    }

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const t = await loadTheme($)
    const list = await read($, failures)

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text color={t.accent}>$ tail -f stderr</Text>
          <Text dimColor>(empty) all green so far</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text color={t.accent}>$ tail -f stderr</Text>
        {list.slice(-SHOW).reverse().map(f => (
          <Box flexDirection="column">
            <Text>
              <Text color={t.bad}>{`#${f.n} \u2717 `}</Text>
              <Text color={t.value}>{f.tool}</Text>
              <Text dimColor>{` ${f.target}`}</Text>
            </Text>
            <Text dimColor>{`   \u2514\u2500 ${f.reason}`}</Text>
          </Box>
        ))}
        <Text color={t.dim}>{'\u2500'.repeat(24)}</Text>
        <Text dimColor>{`\u03A3 ${list.length} failures (showing last ${Math.min(SHOW, list.length)})`}</Text>
      </Box>
    )
  })
}
