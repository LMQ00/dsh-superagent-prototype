/** A local installation's chat Channel is the person's conversation: replies show there as the main Session's messages. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'
import { apply as applyChat, chatTrigger } from '../src/sources/chat.ts'
import { Outbox } from '../src/app/outbox.ts'
import { Store } from '../src/app/store.ts'
import { key, type ChannelRef, type OutboundMessage } from '../src/core/index.ts'
import { KV } from '../src/kv.ts'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'

let h: Host | undefined
const started: string[] = []
afterEach(async () => { await h?.stop(); h = undefined; for (const directory of started.splice(0)) rmSync(directory, { recursive: true, force: true }) })
/** A turn ends after the message that failed a reply arrived; the sink shows it outside that publication. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const sessionOf = (host: Host, id: string) => (host.agents.get(id) as unknown as { session: {
  append: ReturnType<typeof vi.fn>; snapshotEvents: () => unknown[]; header?: Record<string, unknown> } }).session
const assistant = (turn: number, step: number, content: unknown[]) => ({ type: 'assistant/message', data: { turn, step, message: { role: 'assistant', content } } })

it('shows a reply in its own conversation once the turn is closed, and once per message id', async () => {
  h = await startRuntime()
  const master = h.runtime.masterId, session = sessionOf(h, master)
  session.snapshotEvents = () => [{ type: 'turn/end', data: { turn: 1 } }]
  h.runtime.sessions.speak(master, key('reply', 'trigger', 'hello'), 'The change is ready for review.')
  await settle()
  expect(session.append).toHaveBeenCalledTimes(1)
  const [type, data] = session.append.mock.calls[0]!
  expect(type).toBe('assistant/message')
  expect(data.message.content).toEqual([{ type: 'text', text: 'The change is ready for review.' }])
  h.runtime.sessions.speak(master, key('reply', 'trigger', 'hello'), 'The change is ready for review.')
  await settle()
  expect(session.append).toHaveBeenCalledTimes(1)
})

it('waits for an open turn to end, and appends after that publication returns', async () => {
  h = await startRuntime()
  const master = h.runtime.masterId, session = sessionOf(h, master)
  const events: { type: string; data: unknown }[] = [assistant(2, 3, [{ type: 'tool-call', id: 'call-1' }])]
  session.snapshotEvents = () => events
  h.runtime.sessions.speak(master, key('reply', 'waiting', 'x'), 'Queued until the turn ends.')
  await settle()
  expect(session.append).not.toHaveBeenCalled()
  // A Session refuses an append made inside its own event publication, so the flush must not run there.
  events.push({ type: 'turn/end', data: { turn: 2 } })
  h.ctx.emit('session/event', session as never, { type: 'turn/end', data: { turn: 2 } } as never)
  expect(session.append).not.toHaveBeenCalled()
  await settle()
  expect(session.append).toHaveBeenCalledTimes(1)
  expect(session.append.mock.calls[0]![1]).toMatchObject({ turn: 2, step: 3, message: { content: [{ type: 'text', text: 'Queued until the turn ends.' }] } })
})

it('opens a Session that is not loaded, so a reply reaches a conversation nobody has open', async () => {
  h = await startRuntime()
  const resolved = await (h.controller.create as unknown as (options: { sessionId: string }) => Promise<void>)({ sessionId: 'session-later' })
  void resolved
  const agent = h.agents.get('session-later')!
  const session = sessionOf(h, 'session-later')
  session.snapshotEvents = () => [{ type: 'turn/end', data: { turn: 1 } }]
  h.agents.delete('session-later')
  const restore = h.controller.resolveAgent as unknown as ReturnType<typeof vi.fn>
  restore.mockImplementation(async (id: string) => id === 'session-later' ? { agent } : { error: { code: 'session/not-found', message: 'gone' } })
  h.runtime.sessions.speak('session-later', key('reply', 'later', 'x'), 'Shown without the person opening it.')
  await settle()
  expect(restore).toHaveBeenCalledWith('session-later')
  expect(session.append).toHaveBeenCalledTimes(1)
})

it('keeps a reply that its Session refused, and shows it on the next flush', async () => {
  h = await startRuntime()
  const master = h.runtime.masterId, session = sessionOf(h, master)
  const events: unknown[] = [{ type: 'turn/end', data: { turn: 1 } }]
  session.snapshotEvents = () => events
  const refused = vi.fn(() => { throw new Error('Session is closed') })
  session.append = refused
  h.runtime.sessions.speak(master, key('reply', 'refused', 'x'), 'Retried later.')
  await settle()
  expect(refused).toHaveBeenCalledTimes(1)
  expect(h.runtime.store.get(KV.sessions.spoken(key('reply', 'refused', 'x')))).toBeUndefined()
  session.append = vi.fn()
  h.ctx.emit('session/event', session as never, { type: 'turn/end', data: { turn: 1 } } as never)
  await settle()
  expect(session.append).toHaveBeenCalledTimes(1)
  expect(h.runtime.store.get(KV.sessions.spoken(key('reply', 'refused', 'x')))).toBe(true)
})

it('shows each delivered message through the sink, and leaves a dropped one alone', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-superagent-sink-')); started.push(directory)
  const store = new Store(join(directory, 'orchestrator.sqlite'))
  const handlers = new Map<string, (payload: unknown, key: string) => Promise<void>>()
  const effects = { handle: (kind: string, run: (payload: unknown, key: string) => Promise<void>) => { handlers.set(kind, run) },
    enqueue: vi.fn(), cancel: vi.fn(), idle: async () => {} } as never
  const speak = vi.fn()
  const sent: OutboundMessage[] = []
  const sources = { instance: () => ({ enabled: true }), channelAllowed: () => true,
    send: async (message: OutboundMessage) => { sent.push(message); return 'sent' as const } } as never
  const outbox = new Outbox({ store, effects, sources, commands: {} as never, speak, paused: () => false })
  const channel: ChannelRef = { source: 'chat', thread: 'chat:m-1', address: { message: 'm-1' } }
  outbox.send({ id: 'reply-1', channel, text: 'Hello', kind: 'reply', sessionId: 'session-a' })
  await handlers.get('reply')!({}, 'reply-1')
  expect(sent.map(message => message.id)).toEqual(['reply-1'])
  expect(speak).toHaveBeenCalledWith(expect.objectContaining({ id: 'reply-1', sessionId: 'session-a' }))
  speak.mockClear()
  const gone = { instance: () => ({ enabled: true }), channelAllowed: () => true, send: async () => 'gone' as const } as never
  const dropping = new Outbox({ store, effects, sources: gone, commands: {} as never, speak, paused: () => false })
  dropping.send({ id: 'reply-2', channel, text: 'Lost', kind: 'reply', sessionId: 'session-a' })
  await handlers.get('reply')!({}, 'reply-2')
  expect(speak).not.toHaveBeenCalled()
  store.close()
})

it('names the conversation\'s Session on the acknowledgement it queues for a chat request', async () => {
  h = await startRuntime()
  const settings = h.runtime.store.settings()
  h.runtime.store.saveSettings({ ...settings, policy: { ...settings.policy, sources: { ...settings.policy.sources, chat: { allowed: [{ id: 'operator' }] } } } })
  applyChat({ effect: (effect: () => unknown) => { effect() }, on: h.ctx.on.bind(h.ctx), orchestrator: h.runtime } as never)
  const trigger = chatTrigger('m-ack', h.runtime.masterId, 'Add a dark mode', '')
  h.runtime.receive(trigger)
  await h.runtime.idle()
  await h.route({ kind: 'accept', trigger_id: trigger.id, title: 'Add dark mode', worktree_name: 'dark-mode', acknowledgement: '收到：加暗色模式。' })
  const receipt = h.runtime.store.receipts.get(key('ack', trigger.id))
  expect(receipt).toMatchObject({ kind: 'acknowledgement', sessionId: h.runtime.masterId })
})

it('shows a local installation\'s acknowledgement in the conversation the request came from', async () => {
  h = await startRuntime(undefined, { local: true })
  const session = sessionOf(h, h.runtime.masterId)
  const settings = h.runtime.store.settings()
  h.runtime.store.saveSettings({ ...settings, policy: { ...settings.policy, sources: { ...settings.policy.sources, chat: { allowed: [{ id: 'operator' }] } } } })
  applyChat({ effect: (effect: () => unknown) => { effect() }, on: h.ctx.on.bind(h.ctx), orchestrator: h.runtime } as never)
  const trigger = chatTrigger('m-local', h.runtime.masterId, 'Add a dark mode', '')
  h.runtime.receive(trigger)
  await h.runtime.idle()
  await h.route({ kind: 'accept', trigger_id: trigger.id, title: 'Add dark mode', worktree_name: 'dark-mode', acknowledgement: '收到：加暗色模式。' })
  await h.runtime.outbox.sent()
  await settle()
  const shown = session.append.mock.calls.find(call => call[0] === 'assistant/message' && call[1].message.content.some((block: { text?: string }) => block.text === '收到：加暗色模式。'))
  expect(shown).toBeDefined()
})

it('treats a Session as the main Session when its log selected the router preset, though its header names another', async () => {
  h = await startRuntime()
  const create = h.controller.create as unknown as (options: { sessionId: string }) => Promise<void>
  await create({ sessionId: 'second-main' })
  const session = sessionOf(h, 'second-main')
  session.header = { agentPreset: 'standard' }
  session.snapshotEvents = () => [{ type: 'agent-preset/selected', data: { agentPreset: 'dsh-superagent-router' } }]
  const ctx = h.ctx as unknown as { parallel: (name: string, args: unknown) => Promise<void> }
  await ctx.parallel('agent/created', { agent: h.agents.get('second-main') })
  expect(h.runtime.isMain('second-main')).toBe(true)
  expect(h.tools.get('second-main')?.has('orchestrator_route')).toBe(true)
})

it('confirms the boundary the sink keeps: an append inside a Session publication is refused', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create('session-publication' as never, { meta: { cwd: '/tmp' } } as never)
  const appended = (text: string) => session.append('assistant/message', { turn: 1, step: 1,
    message: { id: 'm' + text, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'p', model: 'm' } } as never,
    stream: [] } as never, { surfaceOp: 'append' })
  let inside: unknown
  ctx.on('session/event', (_session, event) => {
    if (event.type !== 'turn/end') return
    try { appended('inside') } catch (error) { inside = error }
  })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } } as never)
  expect(String(inside)).toMatch(/cannot reenter/)
  await new Promise(resolve => queueMicrotask(resolve as () => void))
  expect(() => appended('after')).not.toThrow()
})
