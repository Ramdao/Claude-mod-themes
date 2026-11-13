import { expect, test } from 'claude-code/testing'

const stubs = (on: any, written: Record<string, string> = {}) => {
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: 1 }))
  on('fs.read', () => ({ value: '{}' }))
  on('env.get', () => ({ value: undefined }))
  on('fs.write', (_: any, e: any) => {
    written[e.path] = e.text

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
}

test('/skin lists the new themes and switches to one', async ($, on) => {
  const written: Record<string, string> = {}
  stubs(on, written)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const list = await ($ as any).command.run({ command: 'skin', args: '' })
  for (const n of ['nord', 'gruvbox', 'solarized', 'dracula', 'tokyo']) expect(String(list.text)).toContain(n)
  expect(String(list.text)).toContain('/skin random')
  await ($ as any).command.run({ command: 'skin', args: 'dracula' })
  const file = Object.values(written)[0]!
  expect(JSON.parse(file).name).toBe('dracula')
  expect(JSON.parse(file).accent).toBe('#bd93f9')
})

test('/skin random picks a different real theme', async ($, on) => {
  const written: Record<string, string> = {}
  stubs(on, written)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await ($ as any).command.run({ command: 'skin', args: 'random' })
  expect(String(r.text)).toMatch(/theme set to (amber|magenta|mono|nord|gruvbox|solarized|dracula|tokyo)\b/)
  expect(JSON.parse(Object.values(written)[0]!).name).not.toBe('cyan')
})

const row = (tool: string, input: unknown, extra: Record<string, unknown> = {}) =>
  ({ plugin: 'nerd-theme', component: 'ToolUse', requestId: 'tu1', surface: 'terminal',
    props: { tool_use_id: 'tu1', tool, input, isRunning: false, isErrored: false, isInterrupted: false, ...extra } }) as any

test('an Edit row gets a +/- card; a plain Read does not', async ($, on) => {
  stubs(on)
  const ui = await $.ui.mount(row('Edit', { old_string: 'a\nb', new_string: 'c\nd\ne' }))
  expect(!!(await ui.find({ type: 'Text', text: /\+3/ })), '+3').toBe(true)
  expect(!!(await ui.find({ type: 'Text', text: /−2/ })), '−2').toBe(true)
  await ui.unmount()
  const ui2 = await $.ui.mount(row('Read', { file_path: '/x' }))
  expect(!!(await ui2.find({ type: 'Text', text: /└/ })), 'no card').toBe(false)
  await ui2.unmount()
  const ui3 = await $.ui.mount(row('Write', { content: 'x\ny' }, { isRunning: true }))
  expect(!!(await ui3.find({ type: 'Text', text: /└/ })), 'no card while running').toBe(false)
  await ui3.unmount()
})
