import type { Register } from 'claude-code'

// The one file every nerd mod (and statusline.js) reads its colors from.
// The shared theme file lives in the Claude config dir (CLAUDE_CONFIG_DIR, else ~/.claude).
const themeFile = async ($: any): Promise<string> => {
  const cfg = await $.env.get('CLAUDE_CONFIG_DIR')
  if (cfg) return `${cfg}/nerd-theme.json`
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''

  return `${home}/.claude/nerd-theme.json`
}

// ---- tweak me: add your own themes here -----------------------------------
const THEMES: Record<string, Record<string, string>> = {
  // accent = your prompts; value = Claude's body text; head/code/bold = Claude's headings, `code`, **bold**
  cyan:    { accent: '#22d3ee', value: '#4ade80', dim: '#6b7280', warn: '#fbbf24', bad: '#f87171', head: '#fbbf24', code: '#f472b6', bold: '#a78bfa' },
  amber:   { accent: '#fbbf24', value: '#fcd34d', dim: '#78716c', warn: '#fb923c', bad: '#f87171', head: '#67e8f9', code: '#f472b6', bold: '#86efac' },
  magenta: { accent: '#e879f9', value: '#a78bfa', dim: '#6b7280', warn: '#fbbf24', bad: '#f87171', head: '#67e8f9', code: '#fbbf24', bold: '#86efac' },
  mono:    { accent: '#e5e7eb', value: '#9ca3af', dim: '#6b7280', warn: '#d1d5db', bad: '#f87171', head: '#ffffff', code: '#d1d5db', bold: '#ffffff' },
  nord:    { accent: '#88c0d0', value: '#d8dee9', dim: '#6b7a90', warn: '#ebcb8b', bad: '#bf616a', head: '#81a1c1', code: '#a3be8c', bold: '#b48ead' },
  gruvbox: { accent: '#fabd2f', value: '#ebdbb2', dim: '#928374', warn: '#fe8019', bad: '#fb4934', head: '#b8bb26', code: '#d3869b', bold: '#83a598' },
  solarized: { accent: '#268bd2', value: '#93a1a1', dim: '#657b83', warn: '#b58900', bad: '#dc322f', head: '#2aa198', code: '#cb4b16', bold: '#859900' },
  dracula: { accent: '#bd93f9', value: '#f8f8f2', dim: '#6272a4', warn: '#f1fa8c', bad: '#ff5555', head: '#ff79c6', code: '#50fa7b', bold: '#8be9fd' },
  tokyo:   { accent: '#7aa2f7', value: '#c0caf5', dim: '#565f89', warn: '#e0af68', bad: '#f7768e', head: '#bb9af7', code: '#9ece6a', bold: '#7dcfff' },
}
const DEFAULT = 'cyan'

// Tool-row marker glyphs.
const MARK = { bar: '\u258E' } // ▎
// ---------------------------------------------------------------------------

const loadTheme = async ($: any) => {
  try {
    return { name: DEFAULT, ...THEMES[DEFAULT], ...JSON.parse((await $.fs.read(await themeFile($))) as string) }
  } catch {
    return { name: DEFAULT, ...THEMES[DEFAULT] }
  }
}

// How long each call took, by tool_use_id, for the card under its row.
const took = new Map<string, number>()

const lines = (text: unknown): number => (typeof text === 'string' && text !== '' ? text.split('\n').length : 0)

// What a call changed, as '+3 −1'; empty for tools that change no file.
const delta = (tool: string, input: unknown): { add: number; del: number } | null => {
  const i = (input ?? {}) as Record<string, unknown>
  if (tool === 'Edit') return { add: lines(i.new_string), del: lines(i.old_string) }
  if (tool === 'Write') return { add: lines(i.content), del: 0 }
  if (tool === 'MultiEdit' && Array.isArray(i.edits)) {
    return i.edits.reduce((n: { add: number; del: number }, x: any) => ({ add: n.add + lines(x?.new_string), del: n.del + lines(x?.old_string) }), { add: 0, del: 0 })
  }

  return null
}

const took2 = (ms: number): string => (ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)

const listing = (current: string) =>
  ['themes:', ...Object.keys(THEMES).map(n => `  ${n === current ? '*' : ' '} ${n}`), 'usage: /skin <name> · /skin random'].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'skin', // /theme is built into Claude Code, so this one is /skin
      description: 'Switch the nerd color theme (cyan, amber, magenta, mono, nord, gruvbox, solarized, dracula, tokyo) or /skin random',
    })

    return next(e)
  })

  on('command.run', { command: 'skin' }, async ($, e) => {
    const current = (await loadTheme($)).name
    const asked = e.args.trim().toLowerCase()
    const others = Object.keys(THEMES).filter(n => n !== current)
    const want = asked === 'random' ? (others[Math.floor(Math.random() * others.length)] ?? current) : asked

    if (want === '' || !THEMES[want]) {
      return { text: (want === '' ? '' : `unknown theme "${want}"\n`) + listing(current) }
    }

    await $.fs.write(await themeFile($), JSON.stringify({ name: want, ...THEMES[want] }, null, 2))
    $.ui.toast(`theme: ${want}`)

    return { text: `theme set to ${want}. mods pick it up on their next redraw; the status line on its next refresh.` }
  })

  // Time every call so its row can show how long it took.
  on('tool.call', async ($, e, next) => {
    const id = (e as any).tool_use_id as string | undefined
    const t0 = await $.clock.now()
    const ran = await next(e)
    if (id) {
      took.set(id, (await $.clock.now()) - t0)
      if (took.size > 300) took.delete(took.keys().next().value as string)
    }

    return ran
  })

  // Color-code every tool row by status: running / ok / failed / interrupted.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const t = await loadTheme($)
    const { Box, Text } = $.ui.resolve(e)
    const color = e.props.isInterrupted
      ? t.dim
      : e.props.isErrored
        ? t.bad
        : e.props.isRunning
          ? t.warn
          : t.value

    // A card line under a finished call: how long it took and what it changed.
    const ms = took.get(e.props.tool_use_id)
    const d = delta(e.props.tool, e.props.input)
    const slow = ms !== undefined && ms >= 1000
    const card = !e.props.isRunning && !e.props.isInterrupted && (slow || (d !== null && d.add + d.del > 0))

    return (
      <Box>
        <Text color={color}>{MARK.bar}</Text>
        <Box flexDirection="column">
          {await next(e)}
          {card && (
            <Text>
              <Text color={t.dim}>{'└ '}</Text>
              {slow && <Text color={(ms ?? 0) >= 10000 ? t.warn : t.dim}>{took2(ms ?? 0)}</Text>}
              {slow && d !== null && d.add + d.del > 0 && <Text color={t.dim}>{' · '}</Text>}
              {d !== null && d.add + d.del > 0 && <Text color={t.value}>{`+${d.add}`}</Text>}
              {d !== null && d.del > 0 && <Text color={t.bad}>{` −${d.del}`}</Text>}
            </Text>
          )}
        </Box>
      </Box>
    )
  })

  // Color the prompts you type (the "> ..." rows) in the theme's accent color.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin.kind !== 'composer') return next(e)

    const t = await loadTheme($)
    const { Text } = $.ui.resolve(e)

    return <Text color={t.accent}>{`> ${e.props.text}`}</Text>
  })

  // Color Claude's replies in the theme's value color. Drawn as plain text, so
  // markdown (code fences, tables, bold, links) shows as written.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)

    const t = await loadTheme($)
    const { Box, Text } = $.ui.resolve(e)
    const p = THEMES[t.name] ?? t
    const head = p.head ?? t.warn
    const code = p.code ?? t.warn
    const strong = p.bold ?? t.value

    // Split one line into `code`, **bold** and plain runs.
    const inline = (line: string) =>
      line.split(/(`[^`]+`|\*\*[^*]+\*\*)/).filter(Boolean).map(s =>
        s.startsWith('`') && s.endsWith('`') && s.length > 1 ? (
          <Text color={code}>{s}</Text>
        ) : s.startsWith('**') && s.endsWith('**') && s.length > 4 ? (
          <Text color={strong} bold>{s.slice(2, -2)}</Text>
        ) : (
          <Text color={t.value}>{s}</Text>
        ),
      )

    let fenced = false
    const rows = String(e.props.text).split('\n').map(line => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced
        return <Text color={t.dim}>{line}</Text>
      }
      if (line === '') return <Text> </Text>
      if (fenced) return <Text color={code}>{line}</Text>
      if (/^#{1,6}\s/.test(line)) return <Text color={head} bold>{line}</Text>
      if (/^\s*([-*]|\d+\.)\s/.test(line)) {
        const m = line.match(/^(\s*(?:[-*]|\d+\.)\s)(.*)$/)!
        return (
          <Text>
            <Text color={head}>{m[1] ?? ''}</Text>
            {inline(m[2] ?? '')}
          </Text>
        )
      }
      return <Text>{inline(line)}</Text>
    })

    return (
      <Box>
        <Text color={t.value}>{e.props.isFirstOfReply ? '● ' : '  '}</Text>
        <Box flexDirection="column">{rows}</Box>
      </Box>
    )
  })
}
