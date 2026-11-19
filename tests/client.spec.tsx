// @vitest-environment jsdom
import { act, useState, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiError, caller, usePoll } from '../src/client/api.ts'
import { apply } from '../src/client/index.tsx'
import { zh } from '../src/client/locales.ts'
import { SettingsSchema } from '../src/policy.ts'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

type Entry = { options: { name: string; id?: string; key?: string; order?: number; locale?: string; label?: () => string }; component: ComponentType<Record<string, unknown>> }
const t = ((key: keyof typeof zh) => zh[key] ?? key) as never
function fixture(listed: string[]) {
  const entries: Entry[] = []
  const dictionaries: Record<string, unknown> = {}
  const ctx = {
    slots: { inject: (_name: string, register: () => void) => register(), register: (options: Entry['options'], component: Entry['component']) => { entries.push({ options, component }); return () => {} } },
    locale: { register: (ns: string, value: unknown) => { dictionaries[ns] = value; return () => {} }, bind: () => t },
    effect: (effect: () => unknown) => { effect() },
    sessions: { list: { getSnapshot: () => ({ phase: 'ready', byId: Object.fromEntries(listed.map(id => [id, {}])) }) }, refresh: vi.fn(async () => {}) },
    uiWorkspace: { openSession: vi.fn() },
    // Omit config form service so Deployment renders read-only.
    get: () => undefined,
  }
  apply(ctx as never)
  const entry = (name: string) => entries.find(item => item.options.name === name)!
  return { ctx, entries, dictionaries, main: entry('main'), nav: entry('sidebar.panellist') }
}
async function render(entry: Entry, props: Record<string, unknown>) {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => { root.render(<entry.component {...props} />) })
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return { container, dispose: () => { act(() => { root.unmount() }); container.remove() } }
}
const openMaster = async (container: HTMLElement) => {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === zh.openMaster)!
  await act(async () => { button.click() })
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
const serve = (listed: { name: string; path: string }[] = [{ name: 'webapp', path: '/srv/webapp' },
  { name: 'api', path: '/srv/api' }]) => {
  let projects = listed
  let selected = projects.length ? 'webapp' : ''
  return vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const target = new URL(url, 'http://127.0.0.1')
    const path = target.pathname.replace('/orchestrator/api/', '')
    if (path === 'conversation') {
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as { session: string; project: string | null }
      const session = body?.session ?? target.searchParams.get('session')
      if (body !== undefined) selected = body.project ?? ''
      return Response.json({ session, master: session === 'master', selected: body === undefined ? selected : body.project, projects })
    }
    if (path === 'conversation/projects') {
      const body = JSON.parse(String(init!.body)) as { session: string; project: { name: string; path: string } }
      projects = [...projects, body.project]
      return Response.json({ session: body.session, master: true, selected: selected || null, projects })
    }
    if (path.startsWith('conversation/projects/')) {
      const name = decodeURIComponent(path.slice('conversation/projects/'.length))
      projects = projects.filter(project => project.name !== name)
      if (selected === name) selected = ''
      return Response.json({ session: target.searchParams.get('session'), master: true, selected: selected || null, projects })
    }
    if (path === 'overview') return Response.json({ problems: [], person: [], executor: { running: 0, queued: 0, maxWorkers: 3, idle: 0 }, flow: { triggers: 0, filtered: 0, judged: 0, accepted: 0, evaluating: 0 }, policyVersion: 'v' })
    if (path === 'state') return Response.json({ masterId: 'master', settings: SettingsSchema.parse({}), revisions: { policy: 0, eval: 0, executor: 0 }, sources: [], policy_version: 'v', health: {}, outgoing: [], load: { running: 0, queued: 0 },
      setup: { machine: { stateDir: '/srv/state', worktreeRoot: '/srv/state/worktrees', blockedCommands: [], promptMaxChars: 100000, admissionContextMaxPages: 10, admissionContextTimeoutMs: 15000 }, problem: null, feishuProblem: null, accounts: null } })
    return Response.json({ error: 'unavailable' }, { status: 503 })
}))
}
afterEach(() => { vi.unstubAllGlobals() })

it('registers a localized main panel, sidebar entry and Plugin Manager row page, and no settings section', () => {
  const { entries, dictionaries, main, nav } = fixture([])
  expect(entries.map(entry => entry.options.name)).toEqual(['main', 'sidebar.panellist', 'plugins.row.config', 'conversation.input.left'])
  expect(entries[2]!.options).toMatchObject({ key: 'dsh-superagent#dsh-superagent', locale: 'dshSuperagent' })
  expect(Object.keys(dictionaries)).toEqual(['dshSuperagent'])
  expect(main.options).toMatchObject({ key: 'dsh-superagent', locale: 'dshSuperagent' })
  expect(nav.options).toMatchObject({ id: 'dsh-superagent', order: 10, locale: 'dshSuperagent' })
  expect(nav.options.label?.()).toBe('Superagent')
})

it('opens a listed Session through the workspace from the main panel', async () => {
  serve()
  const { ctx, main } = fixture(['master'])
  const view = await render(main, { t })
  await openMaster(view.container)
  expect(ctx.uiWorkspace.openSession).toHaveBeenCalledExactlyOnceWith('master')
  view.dispose()
})

it('reports a Session missing from the catalog in the interface language', async () => {
  serve()
  const { ctx, main } = fixture([])
  const view = await render(main, { t })
  await openMaster(view.container)
  expect(ctx.uiWorkspace.openSession).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain(zh.sessionNotListed)
  view.dispose()
})

it('shows and saves the project the main conversation routes to, and hides outside that Session', async () => {
  serve()
  const { entries } = fixture(['master'])
  const seat = entries.find(item => item.options.name === 'conversation.input.left')!
  const view = await render(seat, { sessionId: 'master', t })
  const select = view.container.querySelector('select')!
  expect([...select.options].map(option => option.textContent)).toEqual(['未选择项目', 'webapp', 'api'])
  expect(select.value).toBe('webapp')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'api')
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls
  expect(calls.at(-1)?.[0]).toContain('conversation')
  expect(calls.at(-1)?.[1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ session: 'master', project: 'api' }) })
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(select.value).toBe('api')
  view.dispose()
  const other = await render(seat, { sessionId: 'worker', t })
  expect(other.container.querySelector('select')).toBeNull()
  other.dispose()
})

it('manages the project registry from the composer seat', async () => {
  serve()
  const { entries } = fixture(['master'])
  const seat = entries.find(item => item.options.name === 'conversation.input.left')!
  const view = await render(seat, { sessionId: 'master', t })
  const manage = view.container.querySelector<HTMLButtonElement>('button[aria-label="管理项目"]')!
  expect(manage.getAttribute('aria-expanded')).toBe('false')
  await act(async () => { manage.click() })
  const pop = document.querySelector<HTMLElement>('[role="dialog"][aria-label="管理项目"]')!
  expect(pop.textContent).toContain('webapp')
  expect(pop.textContent).toContain('/srv/api')
  // Removing a project calls its own route; the list comes back without it.
  const remove = [...pop.querySelectorAll('li')].find(row => row.textContent?.includes('api'))!.querySelector('button')!
  await act(async () => {
    remove.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  let calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls
  expect(calls.at(-1)?.[0]).toContain('conversation/projects/api?session=master')
  expect(calls.at(-1)?.[1]).toMatchObject({ method: 'DELETE' })
  expect(pop.textContent).not.toContain('/srv/api')
  // Adding one posts the trimmed name and source, then clears the form.
  const inputs = [...pop.querySelectorAll('input')]
  await act(async () => {
    const set = (element: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set(inputs[0]!, ' api ')
    set(inputs[1]!, ' /srv/api ')
  })
  await act(async () => {
    [...pop.querySelectorAll('button')].find(button => button.textContent === '添加')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls
  expect(calls.at(-1)?.[0]).toContain('conversation/projects')
  expect(calls.at(-1)?.[1]).toMatchObject({ method: 'POST',
    body: JSON.stringify({ session: 'master', project: { name: 'api', path: '/srv/api' } }) })
  expect(inputs.map(input => input.value)).toEqual(['', ''])
  expect(pop.textContent).toContain('/srv/api')
  view.dispose()
})

it('ignores a poll that started before a project was removed', async () => {
  vi.useFakeTimers()
  try {
    let projects = [{ name: 'webapp', path: '/srv/webapp' }, { name: 'api', path: '/srv/api' }]
    let poll: ((value: Response) => void) | undefined
    let reads = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const target = new URL(url, 'http://127.0.0.1')
      const path = target.pathname.replace('/orchestrator/api/', '')
      const view = () => Response.json({ session: 'master', master: true, selected: 'webapp', projects })
      if (path === 'conversation') {
        reads++
        // Hold the second read, the poll that runs while the removal is in flight.
        if (reads > 1 && poll === undefined) return await new Promise<Response>(resolve => { poll = resolve })
        return view()
      }
      if (path.startsWith('conversation/projects/')) {
        projects = projects.filter(project => project.name !== decodeURIComponent(path.slice('conversation/projects/'.length)))
        return view()
      }
      return Response.json({ error: 'unavailable' }, { status: 503 })
    }))
    const { entries } = fixture(['master'])
    const seat = entries.find(item => item.options.name === 'conversation.input.left')!
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container)
    await act(async () => { root.render(<seat.component sessionId="master" t={t} />) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="管理项目"]')!.click() })
    const pop = document.querySelector<HTMLElement>('[role="dialog"][aria-label="管理项目"]')!
    // The interval starts a read that stays unanswered until after the removal.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(poll).toBeDefined()
    await act(async () => {
      [...pop.querySelectorAll('li')].find(row => row.textContent?.includes('api'))!.querySelector('button')!.click()
      await Promise.resolve(); await Promise.resolve()
    })
    expect(pop.textContent).not.toContain('/srv/api')
    // Its stale answer must not put the removed project back.
    await act(async () => {
      poll!(Response.json({ session: 'master', master: true, selected: 'webapp', projects: [{ name: 'webapp', path: '/srv/webapp' },
        { name: 'api', path: '/srv/api' }] }))
      await Promise.resolve(); await Promise.resolve()
    })
    expect(pop.textContent).not.toContain('/srv/api')
    act(() => { root.unmount() }); container.remove()
  } finally { vi.useRealTimers() }
})

it('adds the first project from the seat when the registry is empty', async () => {
  serve([])
  const { entries } = fixture(['master'])
  const seat = entries.find(item => item.options.name === 'conversation.input.left')!
  const view = await render(seat, { sessionId: 'master', t })
  expect(view.container.querySelector('select')).toBeNull()
  const add = [...view.container.querySelectorAll('button')].find(button => button.textContent === '添加项目')!
  await act(async () => { add.click() })
  const pop = document.querySelector<HTMLElement>('[role="dialog"][aria-label="管理项目"]')!
  expect(pop.textContent).toContain('还没有登记项目。')
  const inputs = [...pop.querySelectorAll('input')]
  await act(async () => {
    const set = (element: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set(inputs[0]!, 'webapp')
    set(inputs[1]!, '/srv/webapp')
  })
  await act(async () => {
    [...pop.querySelectorAll('button')].find(button => button.textContent === '添加')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls
  expect(calls.at(-1)?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ session: 'master',
    project: { name: 'webapp', path: '/srv/webapp' } }) })
  // The saved project replaces the add-only seat with the select.
  expect(view.container.querySelector('select')?.value).toBe('')
  expect([...view.container.querySelectorAll('option')].map(option => option.textContent)).toEqual(['未选择项目', 'webapp'])
  expect([...view.container.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === '管理项目')).toBe(true)
  view.dispose()
})

it('polls one request at a time, keeps the data while new dependencies load, and polls less while hidden', async () => {
  vi.useFakeTimers()
  const calls: { limit: number; done: (value: string[]) => void }[] = []
  let shown: { data?: string[]; limit: number } = { limit: 0 }
  let setLimit = (_limit: number) => {}
  function Harness() {
    const [limit, update] = useState(1)
    setLimit = update
    const { data } = usePoll(() => new Promise<string[]>(done => { calls.push({ limit, done }) }), [limit], 1000)
    shown = { ...data ? { data } : {}, limit }
    return null
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => { root.render(<Harness />) })
  expect(calls).toHaveLength(1)
  // A slow response holds the next poll back instead of overlapping.
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(calls).toHaveLength(1)
  await act(async () => { calls[0]!.done(['a']) })
  expect(shown.data).toEqual(['a'])
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(calls).toHaveLength(2)
  await act(async () => { setLimit(2) })
  expect(shown).toEqual({ data: ['a'], limit: 2 })
  await act(async () => { calls[2]!.done(['a', 'b']) })
  expect(shown.data).toEqual(['a', 'b'])
  // A late response to the superseded request must not replace the newer result.
  await act(async () => { calls[1]!.done(['stale']) })
  expect(shown.data).toEqual(['a', 'b'])
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  await act(async () => { calls[3]!.done(['a', 'b']) })
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(calls).toHaveLength(4)
  hidden.mockRestore()
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  expect(calls).toHaveLength(5)
  act(() => { root.unmount() })
  vi.useRealTimers()
})

it('tells a dsh-superagent that does not answer from a record it does not have, and words each failure by what failed', async () => {
  const messages = { offline: 'offline', notRunning: 'not running', serverError: (status: number) => `server ${status}`,
    requestFailed: (status: number) => `request ${status}`, setup: () => 'setup', user: ({ code }: { code: string }) => `user ${code}` }
  const call = caller(() => messages)
  const failure = async (answer: () => Promise<Response>) => {
    vi.stubGlobal('fetch', vi.fn(answer))
    const error = await call('GET tickets/:id', { id: 't1' }).then(() => undefined, (thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(ApiError)
    const { message, status, missing, details } = error as ApiError
    return { message, status, missing, unreachable: !!details.unreachable }
  }
  expect(await failure(async () => { throw new TypeError('Failed to fetch') })).toEqual({ message: 'offline', status: 0, missing: false,
    unreachable: true })
  // DSH's web server answers an empty 404 while dsh-superagent's routes are unregistered.
  expect(await failure(async () => new Response(null, { status: 404 }))).toEqual({ message: 'not running', status: 404, missing: false,
    unreachable: true })
  expect(await failure(async () => new Response(null, { status: 502 }))).toEqual({ message: 'server 502', status: 502, missing: false,
    unreachable: true })
  expect(await failure(async () => new Response('<html>Bad request</html>', { status: 400 }))).toEqual({ message: 'request 400',
    status: 400, missing: false, unreachable: false })
  expect(await failure(async () => Response.json({ error: 'Unknown ticket', code: 'unknownTicket' }, { status: 404 }))).toEqual({
    message: 'user unknownTicket', status: 404, missing: true, unreachable: false })
})
