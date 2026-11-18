import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { apply, chatTrigger } from '../src/sources/chat.ts'
import type { Assessor, Executor, Trigger } from '../src/core/index.ts'
import { Engine } from '../src/core/index.ts'
import { Store } from '../src/app/store.ts'
import { KV } from '../src/kv.ts'
import { SettingsSchema, settingsPolicy } from '../src/policy.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { Commands } from '../src/infra/commands.ts'
import { sourceContextOf, type SourceContextDeps } from '../src/app/source-context.ts'
import type { SourceKind } from '../src/sources/kind.ts'
import { testDeployment } from './fixtures/deployment.ts'

/** A stand-in for the host: it captures the Session listener and the Source context the kind registers against. */
function host(options: { ready?: Promise<void>; configured?: () => boolean; project?: string; main?: string[] } = {}) {
  const received: Trigger[] = []
  const reported: [string, unknown][] = []
  const described: [string, unknown][] = []
  const source = {
    ready: options.ready ?? Promise.resolve(),
    configured: options.configured ?? (() => true),
    report: (entry: string, value: unknown) => { reported.push([entry, value]) },
    receive: async (trigger: Trigger) => { received.push(trigger); return 'stored' as const },
    atomic: <T>(work: () => T): T => work(),
    state: { get: () => options.project, set: () => {}, keys: () => [] },
    threads: { describe: (key: string, description: unknown) => { described.push([key, description]) } },
  }
  const kinds: string[] = []
  const handlers = new Map<string, (session: unknown, event: unknown) => void>()
  const ctx = {
    on: (name: string, handler: (session: unknown, event: unknown) => void) => { handlers.set(name, handler); return () => handlers.delete(name) },
    effect: (effect: () => unknown) => { effect() },
    orchestrator: { masterId: 'orchestrator-local', isMain: (id: string) => id === 'orchestrator-local' || options.main?.includes(id) === true,
      sources: { register: (kind: { kind: string }) => { kinds.push(kind.kind); return () => {} } },
      context: () => source },
  }
  return { ctx, handlers, received, reported, described, kinds }
}
const message = (id: string, text: string, source: unknown = { kind: 'user' }) =>
  ({ type: 'user/message', data: { id, role: 'user', content: [{ type: 'text', text }], source } })

describe('the chat Source plugin', () => {
  it('registers its kind and turns every main-Session message into a request, and nothing else', async () => {
    const h = host()
    apply(h.ctx as never)
    expect(h.kinds).toEqual(['chat'])
    // The Source reports ready once its setup promise resolves, which is a microtask after mounting.
    await h.ctx.orchestrator.context().ready
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(h.reported.map(([entry, value]) => [entry, (value as { state: string }).state])).toEqual([['chat', 'ready']])
    const listener = h.handlers.get('session/event')!
    const main = { id: 'orchestrator-local' }
    listener(main, message('msg-1', 'Add a dark mode to webapp.'))
    expect(h.received.map(trigger => trigger.text)).toEqual(['Add a dark mode to webapp.'])
    expect(h.described[0]![0]).toBe('chat:msg-1')
    // Another Session's message, the agent's own turn, a message this installation delivered, and one without words are not requests.
    listener({ id: 'worker-ticket1' }, message('msg-2', 'from a worker'))
    listener(main, { type: 'assistant/message', data: { id: 'msg-3' } })
    listener(main, message('msg-4', 'a notice from dsh-superagent', { kind: 'dsh-superagent', form: 'notice' }))
    listener(main, { type: 'user/message', data: { id: 'msg-5', role: 'user', content: [{ type: 'image' }], source: { kind: 'user' } } })
    expect(h.received).toHaveLength(1)
  })

  it('takes requests from a Session that runs the main Session preset, and from no other', async () => {
    const h = host({ main: ['second-main'] })
    apply(h.ctx as never)
    await new Promise(resolve => setTimeout(resolve, 0))
    const listener = h.handlers.get('session/event')!
    listener({ id: 'second-main' }, message('msg-1', 'Ship the changelog.'))
    expect(h.received.map(trigger => trigger.text)).toEqual(['Ship the changelog.'])
    expect(h.received[0]?.meta).toMatchObject({ sessionId: 'second-main' })
    // A Session that runs another preset is not a main Session.
    listener({ id: 'someone-else' }, message('msg-2', 'a stranger'))
    expect(h.received).toHaveLength(1)
  })

  it('attaches the project the conversation selected to each request of that conversation', async () => {
    const h = host({ project: 'webapp' })
    apply(h.ctx as never)
    await new Promise(resolve => setTimeout(resolve, 0))
    h.handlers.get('session/event')!({ id: 'orchestrator-local' }, message('msg-1', 'Fix the README typo.'))
    expect(h.received[0]?.meta).toMatchObject({ sessionId: 'orchestrator-local', project: 'webapp' })
  })

  it('holds a message that arrives before setup resolves a deployment', async () => {
    const ready = Promise.resolve()
    const h = host({ ready, configured: () => false })
    apply(h.ctx as never)
    await ready
    await new Promise(resolve => setTimeout(resolve, 0))
    h.handlers.get('session/event')!({ id: 'orchestrator-local' }, message('msg-1', 'a request'))
    expect(h.received).toEqual([])
    // Setup still has no deployment, so the Source reports itself off instead of receiving.
    expect(h.reported.at(-1)).toEqual(['chat', expect.objectContaining({ state: 'paused' })])
  })
})

describe('a message in the main Session, through the intake', () => {
  it('becomes a Trigger on its own Thread and a candidate the main Session is asked to assess', async () => {
    const store = new Store(join(mkdtempSync(join(tmpdir(), 'chat-intake-')), 'db.sqlite'))
    store.set(KV.sessions.project('orchestrator-local'), 'webapp')
    store.saveSettings(SettingsSchema.parse({ eval: { mode: 'auto' }, sources: { chat: { enabled: true, config: {} } },
      policy: { sources: { chat: { allowed: [{ id: 'operator', name: 'Operator' }] } } } }))
    const sources = new SourceRegistry(() => store.settings(), new HealthBoard())
    const assessor: Assessor = { request: vi.fn(() => {}) }
    const executor: Executor = { start: vi.fn(() => {}), deliver: vi.fn(() => {}), stop: vi.fn(() => {}) }
    const engine = new Engine({ repo: store, scope: sources, policy: () => settingsPolicy(store.settings(), sources), assessor, executor,
      outbox: { send: () => {}, status: () => undefined, withdraw: () => {} } })
    const deployment = testDeployment()
    const deps: SourceContextDeps = { store, engine, outbox: { send: () => {} }, commands: new Commands(() => deployment, {}, new AbortController().signal),
      sources, deployment, ready: Promise.resolve(), configured: () => true,
      receive: trigger => { const result = engine.receive(trigger); engine.evaluateDue(); return result } }
    const handlers = new Map<string, (session: unknown, event: unknown) => void>()
    const ctx = {
      on: (name: string, handler: (session: unknown, event: unknown) => void) => { handlers.set(name, handler); return () => {} },
      effect: (effect: () => unknown) => { effect() },
      orchestrator: { masterId: 'orchestrator-local', isMain: (id: string) => id === 'orchestrator-local',
        sources: { register: (kind: SourceKind) => sources.register(kind) },
        context: (kind: { kind: string; health: readonly string[] }) => sourceContextOf(deps, kind) },
    }
    apply(ctx as never)
    await new Promise(resolve => setTimeout(resolve, 0))
    handlers.get('session/event')!({ id: 'orchestrator-local' },
      { type: 'user/message', data: { id: 'msg-1', role: 'user', content: [{ type: 'text', text: 'Add a dark mode to webapp.' }],
        source: { kind: 'user' } } })
    await new Promise(resolve => setTimeout(resolve, 0))
    const trigger = store.triggers.get(chatTrigger('msg-1', 'orchestrator-local', '', '').id)
    expect(trigger?.text).toBe('Add a dark mode to webapp.')
    expect(trigger?.meta.project).toBe('webapp')
    // A person writing in the main Session is an explicit request, so the gate keeps it and an assessment starts.
    expect(store.threads.get('chat:msg-1')).toMatchObject({ evaluating: { strength: 'explicit' } })
    expect(assessor.request).toHaveBeenCalledTimes(1)
    store.close()
  })
})
