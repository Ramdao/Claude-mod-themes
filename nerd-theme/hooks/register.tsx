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

const listing = (current: string) =>
  ['themes:', ...Object.keys(THEMES).map(n => `  ${n === current ? '*' : ' '} ${n}`), 'usage: /skin <name>'].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'skin', // /theme is built into Claude Code, so this one is /skin
      description: 'Switch the nerd color theme (cyan, amber, magenta, mono)',
    })

    return next(e)
  })

  on('command.run', { command: 'skin' }, async ($, e) => {
    const current = (await loadTheme($)).name
    const want = e.args.trim().toLowerCase()

    if (want === '' || !THEMES[want]) {
      return { text: (want === '' ? '' : `unknown theme "${want}"\n`) + listing(current) }
    }

    await $.fs.write(await themeFile($), JSON.stringify({ name: want, ...THEMES[want] }, null, 2))
    $.ui.toast(`theme: ${want}`)

    return { text: `theme set to ${want}. mods pick it up on their next redraw; the status line on its next refresh.` }
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

    return (
      <Box>
        <Text color={color}>{MARK.bar}</Text>
        <Box flexDirection="column">{await next(e)}</Box>
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
