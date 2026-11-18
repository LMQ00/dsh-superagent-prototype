/** A person-started Session that selects the superagent main Session preset, through the chat Source and the Runtime. */
import { afterEach, expect, it, vi } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'
import { apply, chatTrigger } from '../src/sources/chat.ts'
import { KV } from '../src/kv.ts'
import type { Trigger } from '../src/core/index.ts'

let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })
const ROUTER = 'dsh-superagent-router'
const message = (id: string, text: string) => ({ type: 'user/message', data: { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } } })
const answer = (host: Host, id: string) => host.deliveries.mock.calls.map(([call]) => call).filter(call => call.sessionId === id)

it('takes a person message in a second main Session, answers there, and ignores a subagent message', async () => {
  h = await startRuntime()
  const settings = h.runtime.store.settings()
  h.runtime.store.saveSettings({ ...settings, policy: { ...settings.policy, sources: { ...settings.policy.sources, chat: { allowed: [{ id: 'operator' }] } } } })
  // The Source plugin registers the chat kind and listens to Session events.
  apply({ effect: (effect: () => unknown) => { effect() }, on: h.ctx.on.bind(h.ctx), orchestrator: h.runtime } as never)
  await vi.waitFor(() => expect(h!.runtime.health.chat).toMatchObject({ state: 'ready' }))
  const create = h.controller.create as unknown as (options: { sessionId: string }) => Promise<void>
  const header = (id: string, value: Record<string, unknown>) => { (h!.agents.get(id) as unknown as { session: { header: Record<string, unknown> } }).session.header = value }
  const ctx = h.ctx as unknown as { emit: (name: string, ...args: unknown[]) => void; parallel: (name: string, args: unknown) => Promise<void> }
  await create({ sessionId: 'second-main' }); header('second-main', { agentPreset: ROUTER })
  await ctx.parallel('agent/created', { agent: h.agents.get('second-main') })
  expect(h.runtime.isMain('second-main')).toBe(true)

  ctx.emit('session/event', { id: 'second-main' }, message('m-real', 'Add a dark mode'))
  await vi.waitFor(() => expect(h!.runtime.store.triggers.get(chatTrigger('m-real', 'second-main', 'Add a dark mode', '').id)).toBeDefined())
  const trigger = h.runtime.store.triggers.get(chatTrigger('m-real', 'second-main', 'Add a dark mode', '').id)!
  expect(trigger.meta).toMatchObject({ sessionId: 'second-main' })
  // The candidate for the request and the report about the work reach that conversation, not the home Session.
  await h.runtime.idle()
  expect(answer(h, 'second-main').some(call => JSON.parse(call.text).kind === 'candidate')).toBe(true)
  h.runtime.sessions.relay('report:second', '{"kind":"worker_report"}', trigger.id)
  await h.runtime.effects.idle('relay')
  expect(h.deliveries.mock.calls.at(-1)![0].sessionId).toBe('second-main')

  // A subagent inherits its parent's composition but has DSH's subagent markers: its task message is no request.
  await create({ sessionId: 'child-of-second' }); header('child-of-second', { parentSession: 'second-main', origin: 'subagent', delegationDepth: 1, agentPreset: ROUTER })
  await ctx.parallel('agent/created', { agent: h.agents.get('child-of-second') })
  expect(h.runtime.isMain('child-of-second')).toBe(false)
  ctx.emit('session/event', { id: 'child-of-second' }, message('m-child', 'Do the task my parent gave me'))
  await h.runtime.idle()
  expect(h.runtime.store.triggers.get(chatTrigger('m-child', 'child-of-second', 'Do the task my parent gave me', '').id)).toBeUndefined()
})

it('answers in the conversation of a Trigger that outlived the application, resuming that Session', async () => {
  h = await startRuntime(store => {
    store.set(KV.sessions.main('second-main'), true)
    store.triggers.save({ id: 'chat-second-1', source: 'chat', threads: [{ source: 'chat', id: 'm-1' }], actor: { source: 'chat', id: 'operator' },
      human: true, addressed: 'direct', at: '2026-09-09T00:00:00.000Z', text: 'Add a dark mode', meta: { messageId: 'm-1', sessionId: 'second-main' } } as Trigger)
  })
  expect(h.runtime.isMain('second-main')).toBe(true)
  expect(h.runtime.sessions.mainFor('chat-second-1')).toBe('second-main')
  const create = h.controller.create as unknown as (options: { sessionId: string }) => Promise<void>
  const resolve = h.controller.resolveAgent.getMockImplementation() as (id: string) => Promise<never>
  h.controller.resolveAgent.mockImplementation(async (id: string) => {
    if (id === 'second-main' && !h!.agents.has(id)) {
      await create({ sessionId: id })
      ;(h!.agents.get(id) as unknown as { session: { header: Record<string, unknown> } }).session.header = { agentPreset: ROUTER }
    }
    return resolve(id)
  })
  h.runtime.sessions.relay('report:resumed', '{"kind":"worker_report"}', 'chat-second-1')
  await h.runtime.effects.idle('relay')
  expect(h.deliveries.mock.calls.at(-1)![0].sessionId).toBe('second-main')
})
