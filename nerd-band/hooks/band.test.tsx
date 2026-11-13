import { expect, test } from 'claude-code/testing'

test('band shows cost, context, trend and top tool', async ($, on) => {
  let now = 1_700_000_100_000
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('session.usage', () => ({ value: { startedAt: 1_700_000_000_000, context: { window: 200000, percent: 31 }, rateLimits: [], cost: { usd: 1.2 } } }))
  on('clock.now', () => ({ value: (now += 4000) }))
  on('fs.read', () => ({ value: '{}' }))
  on('env.get', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const tool of ['Bash', 'Bash', 'Read']) await ($ as any).tool.call({ tool, command: 'x' })
  for (let i = 0; i < 3; i++) {
    await ($ as any).prompt.submit({ text: 'hi', origin: { kind: 'composer' } })
    await ($ as any).turn.complete({ answer: 'x', durationMs: 1000, isAborted: false, turnId: 't' + i, reason: 'answer' })
  }
  const ui = await $.ui.mount({ plugin: 'nerd-band', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', props: { hasSurvey: false } } as any)
  const row = await ui.find({ type: 'Text', text: /cost/ })
  expect(!!row, 'cost').toBe(true)
  expect(!!(await ui.find({ type: 'Text', text: /\$1\.20/ })), '$1.20').toBe(true)
  expect(!!(await ui.find({ type: 'Text', text: /31%/ })), 'ctx').toBe(true)
  expect(!!(await ui.find({ type: 'Text', text: /Bash 67%/ })), 'top tool').toBe(true)
  expect(!!(await ui.find({ type: 'Text', text: /[▁▂▃▄▅▆▇█]{2,}/ })), 'trend').toBe(true)
  await ui.unmount()
})
