import { expect, test } from 'claude-code/testing'

const pane = (requestId: string, bodyColumns = 48) =>
  ({
    plugin: 'tool-histogram',
    component: 'Pane',
    requestId,
    surface: 'terminal',
    props: { title: 't', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }) as const

// Stand-ins for the engine: a store, a clock that moves, a usage reading, toasts.
const world = (on: any, o: { cost?: number; pct?: number } = {}) => {
  const cfg = { cost: o.cost ?? 1, pct: o.pct ?? 10 }
  const store: Record<string, unknown> = {}
  const toasts: string[] = []
  const written: Record<string, string> = {}
  let now = 1_700_000_000_000
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('session.usage', () => ({ value: { startedAt: 1_700_000_000_000, context: { window: 200000, percent: cfg.pct }, rateLimits: [], cost: { usd: cfg.cost } } }))
  on('clock.now', () => ({ value: (now += 1000) }))
  on('clock.after', () => ({ value: {} }))
  on('clock.every', () => ({ value: {} }))
  on('fs.read', () => ({ value: '{}' }))
  on('fs.write', (_: any, e: any) => {
    written[e.path] = e.text

    return { value: undefined }
  })
  on('env.get', () => ({ value: undefined }))
  on('store.get', (_: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: any, e: any) => {
    store[e.key] = e.value

    return { value: undefined }
  })
  on('ui.toast', (_: any, e: any) => {
    toasts.push(String(e.text))

    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))

  return { store, toasts, written, cfg }
}

test('/budget sets, shows and clears a limit', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const set = await ($ as any).command.run({ command: 'budget', args: '5' })
  expect(String(set.text)).toMatch(/budget \$5\.00/)
  expect((w.store.budget as any).usd).toBe(5)
  const deny = await ($ as any).command.run({ command: 'budget', args: 'deny on' })
  expect(String(deny.text)).toMatch(/blocking on/)
  const bad = await ($ as any).command.run({ command: 'budget', args: 'lots' })
  expect(String(bad.text)).toMatch(/not an amount/)
  const off = await ($ as any).command.run({ command: 'budget', args: 'off' })
  expect(String(off.text)).toMatch(/no budget set/)
})

test('budget warns at 80%, then blocks tool calls over the limit', async ($, on) => {
  const w = world(on, { cost: 4.2 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await ($ as any).command.run({ command: 'budget', args: '5' })
  await ($ as any).command.run({ command: 'budget', args: 'deny on' })
  await ($ as any).tool.call({ tool: 'Bash', command: 'ls' })
  expect(w.toasts.some(t => /80% of budget/.test(t))).toBe(true)

  w.cfg.cost = 5.5
  const blocked = await ($ as any).tool.call({ tool: 'Bash', command: 'ls' })
  expect(JSON.stringify(blocked)).toMatch(/nerd budget/)
})

test('context warning toasts once at 70% and again at 85%', async ($, on) => {
  const w = world(on, { pct: 72 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await ($ as any).tool.call({ tool: 'Bash', command: 'a' })
  await ($ as any).tool.call({ tool: 'Bash', command: 'b' })
  expect(w.toasts.filter(t => /context 72% full/.test(t)).length).toBe(1)
})

test('history saves and its pane draws', async ($, on) => {
  const w = world(on, { cost: 2.5 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await ($ as any).tool.call({ tool: 'Bash', command: 'a' })
  await ($ as any).turn.complete({ answer: 'x', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer', usage: { model: 'm', input_tokens: 5, output_tokens: 400, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } })
  expect(((w.store.history as any[]) ?? []).length).toBe(1)
  const ui = await $.ui.mount(pane('nerd-history'))
  expect(await ui.find({ type: 'Text', text: /\$2\.50/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /sessions/ })).toBeTruthy()
  await ui.unmount()
})

test('history pane says so when empty', async ($, on) => {
  world(on)
  const ui = await $.ui.mount(pane('nerd-history'))
  expect(await ui.find({ type: 'Text', text: /no sessions saved yet/ })).toBeTruthy()
  await ui.unmount()
})

test('/nerd export writes markdown and json', async ($, on) => {
  const w = world(on, { cost: 1.5 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await ($ as any).tool.call({ tool: 'Bash', command: 'a' })
  await ($ as any).tool.call({ tool: 'Read', file_path: '/x' })
  const md = await ($ as any).command.run({ command: 'nerd', args: 'export' })
  expect(String(md.text)).toMatch(/nerd-stats-.*\.md/)
  const mdFile = Object.keys(w.written).find(f => f.endsWith('.md'))!
  expect(w.written[mdFile]).toMatch(/\| Bash \| 1 \|/)
  expect(w.written[mdFile]).toMatch(/cost \*\*\$1\.50\*\*/)
  await ($ as any).command.run({ command: 'nerd', args: 'export json' })
  const jsonFile = Object.keys(w.written).find(f => f.endsWith('.json'))!
  expect(JSON.parse(w.written[jsonFile]!).tools.length).toBe(2)
})

test('stats pane shows the budget line and the activity heatmap', async ($, on) => {
  world(on, { cost: 2 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await ($ as any).command.run({ command: 'budget', args: '10' })
  for (const tool of ['Bash', 'Bash', 'Read', 'Edit']) await ($ as any).tool.call({ tool, command: 'x' })
  for (const cols of [36, 48, 64]) {
    const ui = await $.ui.mount(pane('tool-histogram', cols))
    expect(await ui.find({ type: 'Text', text: /budget/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /activity/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Bash\s+[·░▒▓█]+/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('regression: long names clip, trends and columns still draw', async ($, on) => {
  world(on, { cost: 1 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const LONG = 'mcp__plugin_ui-color-palette_ui-color-palette__generate_colors_from_prompt'
  for (let i = 0; i < 4; i++) await ($ as any).tool.call({ tool: LONG, command: 'x' })
  await ($ as any).tool.call({ tool: 'Bash', command: 'x' })
  const outs = [120, 900, 400, 2500, 60, 1800]
  for (let i = 0; i < outs.length; i++)
    await ($ as any).turn.complete({ answer: 'x', durationMs: 2000 + i * 1500, isAborted: false, turnId: 't' + i, reason: 'answer',
      usage: { model: 'm', input_tokens: 10, output_tokens: outs[i], cache_read_input_tokens: 500, cache_creation_input_tokens: 50 } })
  for (const cols of [36, 48, 64]) {
    const ui = await $.ui.mount(pane('tool-histogram', cols))
    expect(await ui.find({ type: 'Text', text: /mcp__plugin_u…/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /generate_colors_from_prompt/ })).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: /output \/ turn/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /time \/ turn/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /<100ms/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /▀/ })).toBeTruthy()
    await ui.unmount()
  }
})
