import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Alerts, Mark, ToolCount, TurnStat } from '../types'

const PANE = 'tool-histogram'
const HISTORY_PANE = 'nerd-history'

// ---- tweak me -------------------------------------------------------------
const STYLE = {
  bar: '█',
  maxBar: 20, // widest bar, in cells
  maxRows: 8, // most tools listed
  maxTurns: 40, // turns kept for sparklines
  spark: '▁▂▃▄▅▆▇█',
  pie: 20, // pie diameter in columns (rows = half of it)
  slowMs: 15000, // a tool running longer than this shows in the status line
  heatRows: 5, // tools in the activity heatmap
  heat: ' ░▒▓█',
}
// The shared theme file lives in the Claude config dir (CLAUDE_CONFIG_DIR, else ~/.claude).
const themeFile = async ($: any): Promise<string> => {
  const cfg = await $.env.get('CLAUDE_CONFIG_DIR')
  if (cfg) return `${cfg}/nerd-theme.json`
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''

  return `${home}/.claude/nerd-theme.json`
}
const DEFAULT = { accent: '#22d3ee', value: '#4ade80', dim: '#6b7280', warn: '#fbbf24', bad: '#f87171' }
// ---------------------------------------------------------------------------

const loadTheme = async ($: any) => {
  try {
    return { ...DEFAULT, ...JSON.parse((await $.fs.read(await themeFile($))) as string) }
  } catch {
    return DEFAULT
  }
}

const counts = atom({ plugin: 'tool-histogram', key: 'counts' } as const, [], { shape: 'counts-2' })
const turns = atom({ plugin: 'tool-histogram', key: 'turns' } as const, [], { shape: 'turns-1' })
const durations = atom({ plugin: 'tool-histogram', key: 'durations' } as const, [], { shape: 'durations-1' })
const alerts = atom({ plugin: 'tool-histogram', key: 'alerts' } as const, { b80: false, b100: false, c70: false, c85: false }, { shape: 'alerts-1' })
const marks = atom({ plugin: 'tool-histogram', key: 'marks' } as const, [], { shape: 'marks-1' })

// Tool-duration histogram buckets (upper bound in ms, label).
const BUCKETS: [number, string][] = [
  [100, '<100ms'],
  [500, '<500ms'],
  [1000, '<1s'],
  [5000, '<5s'],
  [Infinity, '5s+'],
]

const COL_ROWS = 6 // column chart height in rows (8 levels per row)
const COL_GAP = 1

// Cut a label to w cells, ending in an ellipsis when it was shortened.
const clip = (s: string, w: number): string => (s.length > w ? s.slice(0, Math.max(1, w - 1)) + '…' : s)

const center = (s: string, w: number): string => {
  const left = Math.max(0, Math.floor((w - s.length) / 2))

  return (' '.repeat(left) + s).padEnd(w).slice(0, w)
}

type Run = { text: string; fg?: string; bg?: string }

// A pie drawn in text. Every cell is two stacked pixels: '▀' coloured by the
// top pixel's slice (foreground) and the bottom pixel's slice (background).
// Slices run clockwise from 12 o'clock; adjacent same-style cells are merged.
const pieRows = (slices: { frac: number; color: string }[], d: number): Run[][] => {
  const edges: number[] = []
  let acc = 0
  for (const s of slices) edges.push((acc += s.frac))
  const r = d / 2
  const pick = (px: number, py: number): number => {
    const dx = px + 0.5 - d / 2
    const dy = py + 0.5 - d / 2
    if (Math.sqrt(dx * dx + dy * dy) > r) return -1
    let ang = Math.atan2(dx, -dy) / (2 * Math.PI)
    if (ang < 0) ang += 1
    const i = edges.findIndex(e => ang <= e)

    return i < 0 ? slices.length - 1 : i
  }
  const rows: Run[][] = []
  for (let cy = 0; cy < d / 2; cy++) {
    const runs: Run[] = []
    for (let x = 0; x < d; x++) {
      const top = pick(x, cy * 2)
      const bot = pick(x, cy * 2 + 1)
      let ch = ' '
      let fg: string | undefined
      let bg: string | undefined
      if (top >= 0 && bot >= 0) {
        fg = slices[top]!.color
        if (top === bot) ch = '█'
        else {
          ch = '▀'
          bg = slices[bot]!.color
        }
      } else if (top >= 0) {
        ch = '▀'
        fg = slices[top]!.color
      } else if (bot >= 0) {
        ch = '▄'
        fg = slices[bot]!.color
      }
      const last = runs[runs.length - 1]
      if (last && last.fg === fg && last.bg === bg) last.text += ch
      else runs.push({ text: ch, fg, bg })
    }
    rows.push(runs)
  }

  return rows
}

const bump = (list: ToolCount[], tool: string, isFail: boolean, ms: number): ToolCount[] => {
  const f = list.find(c => c.tool === tool)
  const next: ToolCount = {
    tool,
    count: (f?.count ?? 0) + 1,
    failed: (f?.failed ?? 0) + (isFail ? 1 : 0),
    totalMs: (f?.totalMs ?? 0) + ms,
    maxMs: Math.max(f?.maxMs ?? 0, ms),
  }

  return f ? list.map(c => (c.tool === tool ? next : c)) : [...list, next]
}

// A small column chart as strings, top row first: `rows` rows, 8 levels each.
const trend = (xs: number[], rows = 3): string[] => {
  const peak = Math.max(1, ...xs)

  return Array.from({ length: rows }, (_, i) => rows - 1 - i).map(row =>
    xs
      .map(x => {
        const fill = Math.max(0, Math.min(8, Math.round(x <= 0 ? 0 : Math.max(1, (x / peak) * rows * 8)) - row * 8))

        return fill === 0 ? ' ' : STYLE.spark[fill - 1]
      })
      .join(''),
  )
}

const gauge = (frac: number, width = 20): string => {
  const f = Number.isFinite(frac) ? Math.max(0, Math.min(1, frac)) : 0
  const filled = Math.round(f * width)

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const k = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`)
const dur = (ms: number): string => (ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)
const pct = (n: number, of: number): string => `${of > 0 ? Math.round((n / of) * 100) : 0}%`.padStart(4)

// ---- budget, alerts, history ---------------------------------------------
type Budget = { usd: number | null; deny: boolean }

const getBudget = async ($: any): Promise<Budget> => {
  const v = (await $.store.get('budget')) as Partial<Budget> | undefined

  return { usd: typeof v?.usd === 'number' && v.usd > 0 ? v.usd : null, deny: v?.deny === true }
}

const usageOf = async ($: any): Promise<any | null> => {
  try {
    return await $.session.usage()
  } catch {
    return null
  }
}

const ctxPct = (u: any): number => {
  const c = u?.context
  if (!c) return 0

  return c.percent ?? (c.tokens !== undefined && c.window ? (c.tokens / c.window) * 100 : 0)
}

const money = (n: number): string => `$${n.toFixed(2)}`

// Toast once as spend and context cross their limits; reset when they fall back.
const watch = async ($: any) => {
  const u = await usageOf($)
  if (!u) return
  const b = await getBudget($)
  const cost: number = u.cost?.usd ?? 0
  const bf = b.usd ? cost / b.usd : 0
  const cp = ctxPct(u)
  const say: string[] = []
  await update($, alerts, (a: Alerts) => {
    say.length = 0
    const n = { ...a }
    if (bf >= 1 && !a.b100) {
      n.b100 = n.b80 = true
      say.push(`⛔ budget reached: ${money(cost)} of ${money(b.usd ?? 0)}${b.deny ? ' · new tool calls are blocked' : ''}`)
    } else if (bf >= 0.8 && !a.b80) {
      n.b80 = true
      say.push(`⚠ 80% of budget used: ${money(cost)} of ${money(b.usd ?? 0)}`)
    }
    if (cp >= 85 && !a.c85) {
      n.c85 = n.c70 = true
      say.push(`⚠ context ${Math.round(cp)}% full · consider /compact`)
    } else if (cp >= 70 && !a.c70) {
      n.c70 = true
      say.push(`context ${Math.round(cp)}% full`)
    }
    if (cp < 50) n.c70 = n.c85 = false

    return n
  })
  for (const m of say) $.ui.toast(m, { timeoutMs: 7000 })
}

type Session = { id: number; at: number; cost: number; turns: number; tools: number; failed: number; out: number; top: [string, number][] }
const HISTORY_KEEP = 30

// One row per session, keyed by when it began; rewritten as the session goes on.
const saveHistory = async ($: any) => {
  const u = await usageOf($)
  if (!u) return
  const cs = [...(await read($, counts))].sort((a, b) => b.count - a.count)
  const ts = [...(await read($, turns))]
  const tools = cs.reduce((n, c) => n + c.count, 0)
  if (tools === 0 && ts.length === 0) return
  const rec: Session = {
    id: u.startedAt,
    at: await $.clock.now(),
    cost: u.cost?.usd ?? 0,
    turns: ts.length,
    tools,
    failed: cs.reduce((n, c) => n + c.failed, 0),
    out: ts.reduce((n, x) => n + x.outTok, 0),
    top: cs.slice(0, 5).map(c => [c.tool, c.count]),
  }
  const old = ((await $.store.get('history')) as Session[] | undefined) ?? []
  await $.store.set('history', [...old.filter(s => s.id !== rec.id), rec].sort((a, b) => a.id - b.id).slice(-HISTORY_KEEP))
}

const stamp = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')

  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// The session's numbers as markdown or JSON, for a standup or a PR.
const exportText = async ($: any, kind: 'md' | 'json'): Promise<string> => {
  const u = await usageOf($)
  const cs = [...(await read($, counts))].sort((a, b) => b.count - a.count)
  const ts = [...(await read($, turns))]
  const durs = [...(await read($, durations))]
  const total = cs.reduce((n, c) => n + c.count, 0)
  const failed = cs.reduce((n, c) => n + c.failed, 0)
  const sum = (f: (x: TurnStat) => number) => ts.reduce((n, x) => n + f(x), 0)
  const hist = BUCKETS.map(([hi, name], i) => {
    const lo = i === 0 ? 0 : (BUCKETS[i - 1]?.[0] ?? 0)

    return { bucket: name, calls: durs.filter(d => d >= lo && d < hi).length }
  })
  const cost: number = u?.cost?.usd ?? 0
  const when = stamp(await $.clock.now())
  if (kind === 'json') {
    return JSON.stringify(
      {
        generated: when,
        cost,
        contextPercent: Math.round(ctxPct(u)),
        turns: ts.length,
        tools: cs.map(c => ({ tool: c.tool, calls: c.count, failed: c.failed, avgMs: Math.round(c.totalMs / c.count), maxMs: c.maxMs })),
        durationHistogram: hist,
        tokens: { in: sum(x => x.inTok), out: sum(x => x.outTok), cacheRead: sum(x => x.cacheRead), cacheWrite: sum(x => x.cacheWrite) },
        perTurn: ts.map(x => ({ outTokens: x.outTok, ms: x.ms })),
      },
      null,
      2,
    )
  }
  const rows = cs.map(c => `| ${c.tool} | ${c.count} | ${c.failed} | ${dur(c.totalMs / c.count)} | ${dur(c.maxMs)} | ${pct(c.count, total).trim()} |`)

  return [
    `# nerd stats · ${when}`,
    '',
    `- cost **${money(cost)}** · turns **${ts.length}** · tool calls **${total}**${failed > 0 ? ` (${failed} failed)` : ''} · context ${Math.round(ctxPct(u))}%`,
    `- tokens: in ${k(sum(x => x.inTok))} · out ${k(sum(x => x.outTok))} · cache read ${k(sum(x => x.cacheRead))} / write ${k(sum(x => x.cacheWrite))}`,
    '',
    '## Tools',
    '',
    '| tool | calls | failed | avg | max | share |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    '## Tool duration',
    '',
    '| bucket | calls |',
    '| --- | ---: |',
    ...hist.map(h => `| ${h.bucket} | ${h.calls} |`),
    '',
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'nerd',
      description: 'Session stats pane. /nerd history · /nerd export [md|json]',
    })
    await $.command.register({
      name: 'budget',
      description: 'Spend limit: /budget 5 · /budget off · /budget deny on|off',
    })

    return next(e)
  })

  on('command.run', { command: 'nerd' }, async ($, e) => {
    const [sub = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (sub === 'history') {
      await saveHistory($)
      await $.ui.open({ id: HISTORY_PANE, title: 'nerd history' })

      return { text: 'nerd history pane opened.' }
    }
    if (sub === 'export') {
      const kind = arg === 'json' ? 'json' : 'md'
      const name = `nerd-stats-${stamp(await $.clock.now()).replace(/[: ]/g, '-')}.${kind}`
      await $.fs.write(name, await exportText($, kind))

      return { text: `stats written to ${name} (in the working directory)` }
    }
    await $.ui.open({ id: PANE, title: 'nerd stats' })

    return { text: 'nerd stats pane opened.' }
  })

  on('command.run', { command: 'budget' }, async ($, e) => {
    const a = e.args.trim().toLowerCase()
    const b = await getBudget($)
    const show = (x: Budget) => (x.usd ? `budget ${money(x.usd)}` : 'no budget set') + ` · blocking ${x.deny ? 'on' : 'off'}`
    const save = async (x: Budget) => {
      await $.store.set('budget', x)
      await update($, alerts, (al: Alerts) => ({ ...al, b80: false, b100: false }))

      return { text: show(x) }
    }
    if (a === '') return { text: show(b) + '\n/budget <usd> · /budget off · /budget deny on|off' }
    if (a === 'off') return save({ ...b, usd: null })
    if (a.startsWith('deny')) return save({ ...b, deny: /\b(on|true|1|yes)\b/.test(a) })
    const n = parseFloat(a.replace('$', ''))

    return Number.isFinite(n) && n > 0 ? save({ ...b, usd: n }) : { text: `"${a}" is not an amount. try /budget 5` }
  })

  on('session.end', async ($, e, next) => {
    await saveHistory($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const b = await getBudget($)
    if (b.deny && b.usd) {
      const spent: number = (await usageOf($))?.cost?.usd ?? 0
      if (spent >= b.usd) {
        return { deny: `nerd budget: ${money(spent)} of ${money(b.usd)} spent. /budget <usd> raises it, /budget deny off stops blocking.` }
      }
    }
    const t0 = await $.clock.now()
    // A call that runs long shows a live timer in the status line.
    let every: { cancel: () => void } | undefined
    let shown = false
    const late = $.clock.after(STYLE.slowMs, () => {
      shown = true
      every = $.clock.every(1000, async () => {
        $.ui.status(`⏱ ${clip(e.tool, 28)} running ${Math.round(((await $.clock.now()) - t0) / 1000)}s`)
      })
    })
    const ran = await next(e)
    late.cancel()
    every?.cancel()
    if (shown) $.ui.status(undefined)
    const ms = (await $.clock.now()) - t0
    const isFail = ran.deny !== undefined || ran.isError === true
    await update($, counts, list => bump(list, e.tool, isFail, ms))
    await update($, durations, list => [...list, ms].slice(-500))
    await update($, marks, (list: Mark[]) => [...list, { t: t0, tool: e.tool }].slice(-600))
    await watch($)

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u && !e.agentId) {
      const row: TurnStat = {
        inTok: u.input_tokens,
        outTok: u.output_tokens,
        cacheRead: u.cache_read_input_tokens,
        cacheWrite: u.cache_creation_input_tokens,
        ms: e.durationMs,
      }
      await update($, turns, list => [...list, row].slice(-STYLE.maxTurns))
    }
    await watch($)
    await saveHistory($)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e) as any
    const t = await loadTheme($)
    const W: number = Math.max(36, Math.min(64, (e as any).props?.bodyColumns ?? 48))
    const heading = (title: string) => (
      <Text>
        <Text color={t.accent}>{`── ${title} `}</Text>
        <Text color={t.dim}>{'─'.repeat(Math.max(2, W - title.length - 4))}</Text>
      </Text>
    )

    const durs = [...(await read($, durations))]
    const hist = BUCKETS.map(([hi, name], i) => {
      const lo = i === 0 ? 0 : (BUCKETS[i - 1]?.[0] ?? 0)

      return { name, n: durs.filter(d => d >= lo && d < hi).length }
    })
    const histPeak = Math.max(1, ...hist.map(b => b.n))
    // Column chart: fast = green, slow = red; widths fit the pane.
    const colW = Math.max(6, Math.min(8, Math.floor((W - 2) / hist.length) - COL_GAP))
    const speed = [t.value, t.accent, t.warn, '#fb923c', t.bad]
    const list = [...(await read($, counts))].sort((a, b) => b.count - a.count)
    const ts = [...(await read($, turns))]
    let usage: any = { context: { window: 0 } }
    let usageErr = ''
    try {
      usage = await $.session.usage()
    } catch (err) {
      usageErr = String((err as Error)?.message ?? err)
    }
    const top = list.slice(0, STYLE.maxRows)
    const peak = Math.max(1, ...top.map(c => c.count))
    const label = Math.min(14, Math.max(4, ...top.map(c => c.tool.length)))
    const barMax = Math.max(6, Math.min(STYLE.maxBar, W - label - 14))
    const total = list.reduce((n, c) => n + c.count, 0)
    const failed = list.reduce((n, c) => n + c.failed, 0)

    const sum = (f: (x: TurnStat) => number) => ts.reduce((n, x) => n + f(x), 0)
    const inTok = sum(x => x.inTok)
    const outTok = sum(x => x.outTok)
    const cacheRead = sum(x => x.cacheRead)
    const cacheWrite = sum(x => x.cacheWrite)
    const promptTotal = inTok + cacheRead + cacheWrite
    const hit = promptTotal > 0 ? cacheRead / promptTotal : 0
    const ctx = usage.context
    const ctxFrac = ctx.percent !== undefined ? ctx.percent / 100 : ctx.tokens !== undefined && ctx.window ? ctx.tokens / ctx.window : 0
    const ctxColor = ctxFrac > 0.85 ? t.bad : ctxFrac > 0.6 ? t.warn : t.value
    const slow = [...list].sort((a, b) => b.totalMs / b.count - a.totalMs / a.count).slice(0, 3)

    // Per-turn trend charts: the latest turns that fit beside a 6-cell axis.
    const AXIS = 6
    const fit = Math.max(8, W - AXIS - 1)
    const series = (f: (x: TurnStat) => number) => {
      const xs = ts.slice(-fit).map(f)

      return { rows: trend(xs), peak: Math.max(0, ...xs), last: xs[xs.length - 1] ?? 0 }
    }
    const outSeries = series(x => x.outTok)
    const timeSeries = series(x => x.ms)
    // Axis labels: the peak on the top row, 0 on the bottom.
    const axis = (i: number, peakLabel: string) => (i === 0 ? peakLabel : i === 2 ? '0' : '').padStart(AXIS - 1) + ' '

    // Stacked token bar: input / output / cache read / cache write.
    const tokW = Math.min(40, W - 2)
    const tokParts = [
      { name: 'in', n: inTok, color: t.accent },
      { name: 'out', n: outTok, color: t.warn },
      { name: 'cache r', n: cacheRead, color: t.value },
      { name: 'cache w', n: cacheWrite, color: t.bad },
    ]
    const tokTotal = tokParts.reduce((n, p) => n + p.n, 0)
    let used = 0
    const tokCells = tokParts.map((p, i) => {
      const end = Math.round((tokParts.slice(0, i + 1).reduce((n, q) => n + q.n, 0) / Math.max(1, tokTotal)) * tokW)
      const cells = Math.max(0, end - used)
      used = Math.max(used, end)

      return { ...p, cells }
    })

    // Pie of tool-call share: top 5 tools plus "other".
    const palette = [t.accent, t.value, t.warn, t.bad, t.head ?? '#67e8f9', t.dim]
    const share = top.slice(0, 5).map((c, i) => ({ name: c.tool, n: c.count, color: palette[i] ?? t.dim }))
    const rest = total - share.reduce((n, s) => n + s.n, 0)
    if (rest > 0) share.push({ name: 'other', n: rest, color: palette[5] ?? t.dim })
    const shareLabel = Math.max(6, Math.min(14, W - 33, Math.max(4, ...share.map(s => s.name.length))))
    const rows = total > 0 ? pieRows(share.map(s => ({ frac: s.n / total, color: s.color })), STYLE.pie) : []
    const budget = await getBudget($)
    const spent: number = usage.cost?.usd ?? 0
    const budgetFrac = budget.usd ? spent / budget.usd : 0
    const budgetColor = budgetFrac >= 1 ? t.bad : budgetFrac >= 0.8 ? t.warn : t.value

    // Activity heatmap: when each of the top tools ran, across the session so far.
    const mk = [...(await read($, marks))]
    const nowMs = await $.clock.now()
    const heatLabel = Math.min(10, label)
    const heatCols = Math.max(12, Math.min(40, W - heatLabel - 3))
    const heatStart = mk[0]?.t ?? nowMs
    const heatSpan = Math.max(60000, nowMs - heatStart)
    const heatRows = top.slice(0, STYLE.heatRows).map((c, i) => {
      const cells = new Array<number>(heatCols).fill(0)
      for (const m of mk) {
        if (m.tool === c.tool) {
          const at = Math.min(heatCols - 1, Math.floor(((m.t - heatStart) / heatSpan) * heatCols))
          cells[at] = (cells[at] ?? 0) + 1
        }
      }

      return { name: c.tool, color: palette[i] ?? t.dim, cells }
    })
    const heatPeak = Math.max(1, ...heatRows.flatMap(r => r.cells))
    const heatChar = (n: number): string =>
      n === 0 ? '·' : (STYLE.heat[Math.min(STYLE.heat.length - 1, Math.max(1, Math.ceil((n / heatPeak) * (STYLE.heat.length - 1))))] ?? '█')

    const runProps = (r: Run) => ({ ...(r.fg ? { color: r.fg } : {}), ...(r.bg ? { backgroundColor: r.bg } : {}) })

    return (
      <Box flexDirection="column">
        <Text color={t.accent}>$ nerd --stats</Text>
        {usageErr !== '' && <Text color={t.bad}>{clip(`usage unavailable: ${usageErr}`, W)}</Text>}

        {heading('session')}
        <Text>
          <Text color={t.value}>cost  </Text>
          <Text>{usage.cost ? `$${usage.cost.usd.toFixed(2)}` : 'n/a'}</Text>
          <Text dimColor>{`   turns ${ts.length}   tools ${total}`}</Text>
          {failed > 0 && <Text color={t.bad}>{`   ✗${failed} failed`}</Text>}
        </Text>
        <Text>
          <Text color={t.value}>ctx   </Text>
          <Text color={ctxColor}>{gauge(ctxFrac)}</Text>
          <Text dimColor>{` ${Math.round(ctxFrac * 100)}%  ${ctx.tokens !== undefined ? k(ctx.tokens) : '?'}/${k(ctx.window)}`}</Text>
        </Text>

        {budget.usd !== null && (
          <Text>
            <Text color={t.value}>budget </Text>
            <Text color={budgetColor}>{gauge(budgetFrac)}</Text>
            <Text dimColor>{` ${Math.round(budgetFrac * 100)}%  ${money(spent)}/${money(budget.usd)}${budget.deny ? '  blocking' : ''}`}</Text>
          </Text>
        )}

        <Text> </Text>
        {heading('tools')}
        {top.length === 0 ? (
          <Text dimColor>(null) no exec yet</Text>
        ) : (
          <Box flexDirection="column">
            {top.map(c => (
              <Text>
                <Text color={t.value}>{clip(c.tool, label).padEnd(label)} </Text>
                <Text color={t.accent}>{STYLE.bar.repeat(Math.max(1, Math.round((c.count / peak) * barMax))).padEnd(barMax)}</Text>
                <Text>{` ${String(c.count).padStart(3)}`}</Text>
                <Text dimColor>{` ${pct(c.count, total)}`}</Text>
                {c.failed > 0 && <Text color={t.bad}>{` ✗${c.failed}`}</Text>}
              </Text>
            ))}
            <Text dimColor>slowest avg</Text>
            {slow.map(c => (
              <Text>
                <Text color={t.value}>{clip(c.tool, label).padEnd(label)} </Text>
                <Text color={t.warn}>{dur(c.totalMs / c.count).padStart(7)}</Text>
                <Text dimColor>{`  max ${dur(c.maxMs)}`}</Text>
              </Text>
            ))}
          </Box>
        )}

        <Text> </Text>
        {heading('tool share')}
        {total === 0 ? (
          <Text dimColor>(null) no exec yet</Text>
        ) : (
          <Box flexDirection="row" gap={2}>
            <Box flexDirection="column">
              {rows.map(runs => (
                <Text>
                  {runs.map(r => (
                    <Text {...runProps(r)}>{r.text}</Text>
                  ))}
                </Text>
              ))}
            </Box>
            <Box flexDirection="column">
              {share.map(s => (
                <Text>
                  <Text color={s.color}>■ </Text>
                  <Text>{clip(s.name, shareLabel).padEnd(shareLabel)}</Text>
                  <Text>{` ${String(s.n).padStart(3)}`}</Text>
                  <Text dimColor>{` ${pct(s.n, total)}`}</Text>
                </Text>
              ))}
            </Box>
          </Box>
        )}

        <Text> </Text>
        {heading('activity')}
        {mk.length === 0 ? (
          <Text dimColor>(null) no exec yet</Text>
        ) : (
          <Box flexDirection="column">
            {heatRows.map(r => (
              <Text>
                <Text color={r.color}>{clip(r.name, heatLabel).padEnd(heatLabel)} </Text>
                <Text color={r.color}>{r.cells.map(heatChar).join('')}</Text>
              </Text>
            ))}
            <Text dimColor>{`${''.padEnd(heatLabel)} -${dur(heatSpan)}${' '.repeat(Math.max(1, heatCols - dur(heatSpan).length - 4))}now`}</Text>
          </Box>
        )}

        <Text> </Text>
        {heading('tool duration')}
        {durs.length === 0 ? (
          <Text dimColor>(null) no timings yet</Text>
        ) : (
          <Box flexDirection="column">
            {Array.from({ length: COL_ROWS }, (_, i) => COL_ROWS - 1 - i).map(row => (
              <Text>
                {hist.map((bucket, bi) => {
                  const fill = Math.max(0, Math.min(8, Math.round(bucket.n === 0 ? 0 : Math.max(1, (bucket.n / histPeak) * COL_ROWS * 8)) - row * 8))

                  return <Text color={speed[bi]}>{(fill === 0 ? ' ' : STYLE.spark[fill - 1]!).repeat(colW) + ' '.repeat(COL_GAP)}</Text>
                })}
              </Text>
            ))}
            <Text color={t.dim}>{'▔'.repeat(hist.length * (colW + COL_GAP) - COL_GAP)}</Text>
            <Text>
              {hist.map((bucket, bi) => (
                <Text color={speed[bi]}>{center(String(bucket.n), colW) + ' '.repeat(COL_GAP)}</Text>
              ))}
            </Text>
            <Text dimColor>
              {hist.map(bucket => center(clip(bucket.name, colW), colW) + ' '.repeat(COL_GAP)).join('')}
            </Text>
          </Box>
        )}

        <Text> </Text>
        {heading('tokens')}
        {ts.length === 0 ? (
          <Text dimColor>(null) no completed turns yet</Text>
        ) : (
          <Box flexDirection="column">
            <Text>
              <Text color={t.value}>cache </Text>
              <Text color={t.accent}>{gauge(hit)}</Text>
              <Text dimColor>{` ${Math.round(hit * 100)}% hit`}</Text>
            </Text>
            <Text dimColor>{`in ${k(inTok)} · out ${k(outTok)} · cache r ${k(cacheRead)} / w ${k(cacheWrite)}`}</Text>
            <Text>
              {tokCells.map(p => (
                <Text color={p.color}>{'█'.repeat(p.cells)}</Text>
              ))}
            </Text>
            <Text>
              {tokCells.map(p => (
                <Text color={p.color}>{`■ ${p.name} ${pct(p.n, tokTotal).trim()}  `}</Text>
              ))}
            </Text>
            <Text> </Text>
            <Text>
              <Text color={t.value}>output / turn </Text>
              <Text dimColor>{`peak ${k(outSeries.peak)} · avg ${k(outTok / ts.length)} · last ${k(outSeries.last)}`}</Text>
            </Text>
            {outSeries.rows.map((line, i) => (
              <Text>
                <Text dimColor>{axis(i, k(outSeries.peak))}</Text>
                <Text color={t.accent}>{line.slice(0, -1)}</Text>
                <Text color={t.value}>{line.slice(-1)}</Text>
              </Text>
            ))}
            <Text> </Text>
            <Text>
              <Text color={t.value}>time / turn </Text>
              <Text dimColor>{`peak ${dur(timeSeries.peak)} · avg ${dur(sum(x => x.ms) / ts.length)} · last ${dur(timeSeries.last)}`}</Text>
            </Text>
            {timeSeries.rows.map((line, i) => (
              <Text>
                <Text dimColor>{axis(i, dur(timeSeries.peak))}</Text>
                <Text color={t.warn}>{line.slice(0, -1)}</Text>
                <Text color={t.bad}>{line.slice(-1)}</Text>
              </Text>
            ))}
          </Box>
        )}

        <Text> </Text>
        <Text dimColor>{`Σ ${total} exec · ${list.length} bin · exit 0`}</Text>
      </Box>
    )
  })

  // /nerd history: one row per past session, kept between sessions in $.store.
  on('ui.render', { component: 'Pane', requestId: HISTORY_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e) as any
    const t = await loadTheme($)
    const W: number = Math.max(36, Math.min(64, (e as any).props?.bodyColumns ?? 48))
    const list = ((await $.store.get('history')) as Session[] | undefined) ?? []
    const rows = list.slice(-14).reverse()
    const heading = (title: string) => (
      <Text>
        <Text color={t.accent}>{`── ${title} `}</Text>
        <Text color={t.dim}>{'─'.repeat(Math.max(2, W - title.length - 4))}</Text>
      </Text>
    )

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text color={t.accent}>$ nerd --history</Text>
          <Text dimColor>(null) no sessions saved yet. they save as you work.</Text>
        </Box>
      )
    }

    const peak = Math.max(0.01, ...rows.map(s => s.cost))
    const totalCost = list.reduce((n, s) => n + s.cost, 0)
    const totalTools = list.reduce((n, s) => n + s.tools, 0)
    const byTool = new Map<string, number>()
    for (const s of list) for (const [name, n] of s.top) byTool.set(name, (byTool.get(name) ?? 0) + n)
    const best = [...byTool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    const barMax = Math.max(6, Math.min(16, W - 40))

    return (
      <Box flexDirection="column">
        <Text color={t.accent}>$ nerd --history</Text>
        {heading(`last ${rows.length} sessions`)}
        <Text dimColor>{`${'when'.padEnd(11)} ${'cost'.padStart(7)}  ${'turns'.padStart(5)} ${'tools'.padStart(5)}  spend`}</Text>
        {rows.map(s => (
          <Text>
            <Text color={t.value}>{stamp(s.id).padEnd(11)} </Text>
            <Text>{money(s.cost).padStart(7)}</Text>
            <Text dimColor>{`  ${String(s.turns).padStart(5)} ${String(s.tools).padStart(5)}  `}</Text>
            <Text color={s.failed > 0 ? t.warn : t.accent}>{'█'.repeat(Math.max(1, Math.round((s.cost / peak) * barMax)))}</Text>
            {s.failed > 0 && <Text color={t.bad}>{` ✗${s.failed}`}</Text>}
          </Text>
        ))}

        <Text> </Text>
        {heading('totals')}
        <Text>
          <Text color={t.value}>cost </Text>
          <Text>{money(totalCost)}</Text>
          <Text dimColor>{`   avg ${money(totalCost / list.length)}/session   ${list.length} sessions   ${totalTools} tool calls`}</Text>
        </Text>
        {best.map(([name, n]) => (
          <Text>
            <Text color={t.value}>{clip(name, 14).padEnd(14)} </Text>
            <Text dimColor>{`${n} calls · ${pct(n, totalTools).trim()}`}</Text>
          </Text>
        ))}
        <Text> </Text>
        <Text dimColor>{`Σ ${list.length} sessions kept (max ${HISTORY_KEEP}) · exit 0`}</Text>
      </Box>
    )
  })
}
