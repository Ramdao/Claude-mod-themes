import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Stats } from '../types'

// ---- tweak me -------------------------------------------------------------
// Colors come from the active /theme (nerd-theme.json); these are fallbacks.
// The shared theme file lives in the Claude config dir (CLAUDE_CONFIG_DIR, else ~/.claude).
const themeFile = async ($: any): Promise<string> => {
  const cfg = await $.env.get('CLAUDE_CONFIG_DIR')
  if (cfg) return `${cfg}/nerd-theme.json`
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''

  return `${home}/.claude/nerd-theme.json`
}
const DEFAULT = { accent: '#22d3ee', value: '#4ade80', dim: '#6b7280', warn: '#fbbf24', bad: '#f87171' }
const STYLE = {
  prompt: '>_', // shell prompt
  gap: ' ',
}
// ---------------------------------------------------------------------------

const loadTheme = async ($: any) => {
  try {
    return { ...DEFAULT, ...JSON.parse((await $.fs.read(await themeFile($))) as string) }
  } catch {
    return DEFAULT
  }
}

const EMPTY: Stats = { startedAt: 0, turns: 0, tools: 0, lastSeconds: null }
const stats = atom({ plugin: 'nerd-band', key: 'stats' } as const, EMPTY, {
  shape: 'stats-1',
})

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

export const register: Register = on => {
  let turnStart = 0

  on('session.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, stats, s => (s.startedAt === 0 ? { ...s, startedAt: now } : s))

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    turnStart = await $.clock.now()

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await update($, stats, s => ({ ...s, tools: s.tools + 1 }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    const seconds = turnStart === 0 ? null : Math.round((now - turnStart) / 1000)
    await update($, stats, s => ({ ...s, turns: s.turns + 1, lastSeconds: seconds }))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, stats)

    if (e.props.hasSurvey || s.startedAt === 0) {
      return next(e)
    }

    const now = await $.clock.now()
    const t = await loadTheme($)
    const { Box, Text } = $.ui.resolve(e)
    const last = s.lastSeconds === null ? '--' : `${s.lastSeconds}s`
    const fields: [string, string][] = [
      ['uptime', clock(now - s.startedAt)],
      ['turns', String(s.turns)],
      ['exec', String(s.tools)],
      ['Δt', last],
    ]

    return (
      <Box>
        <Text color={t.accent} bold>{STYLE.prompt} </Text>
        {fields.map(([k, v]) => (
          <Text>
            <Text color={t.dim}>[</Text>
            <Text color={t.accent}>{k} </Text>
            <Text color={t.value}>{v}</Text>
            <Text color={t.dim}>]</Text>
            <Text>{STYLE.gap}</Text>
          </Text>
        ))}
      </Box>
    )
  })
}
