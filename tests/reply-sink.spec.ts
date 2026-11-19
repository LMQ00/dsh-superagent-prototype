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

let h: Host | undefined
const started: string[] = []
afterEach(async () => { await h?.stop(); h = undefined; for (const directory of started.splice(0)) rmSync(directory, { recursive: true, force: true }) })

/** The agent's Session, with its events under the test's control. */
const sessionOf = (host: Host, id: string) => (host.agents.get(id) as unknown as { session: {
  append: ReturnType<typeof vi.fn>; snapshotEvents: () => unknown[]; header?: Record<string, unknown> } }).session

it('shows a reply in its own conversation once, as the main Session\'s message', async () => {
  h = await startRuntime()
  const master = h.runtime.masterId, session = sessionOf(h, master)
  h.runtime.sessions.speak(master, key('reply', 'trigger', 'hello'), 'The change is ready for review.')
  expect(session.append).toHaveBeenCalledTimes(1)
  const [type, data] = session.append.mock.calls[0]!
  expect(type).toBe('assistant/message')
  expect(data.message.content).toEqual([{ type: 'text', text: 'The change is ready for review.' }])
  expect(data.message.role).toBe('assistant')
  // The same message id is shown once, however often its delivery is retried.
  h.runtime.sessions.speak(master, key('reply', 'trigger', 'hello'), 'The change is ready for review.')
  expect(session.append).toHaveBeenCalledTimes(1)
})

it('waits for the open step to end before showing a reply, so a tool call keeps its result', async () => {
  h = await startRuntime()
  const master = h.runtime.masterId, session = sessionOf(h, master)
  const call = { type: 'assistant/message', data: { turn: 2, step: 3, message: { role: 'assistant', content: [{ type: 'tool-call', id: 'call-1' }] } } }
  session.snapshotEvents = () => [call]
  h.runtime.sessions.speak(master, key('reply', 'waiting', 'x'), 'Queued until the step ends.')
  expect(session.append).not.toHaveBeenCalled()
  h.ctx.emit('session/event', session as never, { type: 'tool/result', data: { turn: 2, step: 3, message: { toolCallId: 'call-1' } } } as never)
  expect(session.append).not.toHaveBeenCalled()
  h.ctx.emit('session/event', session as never, { type: 'step/end', data: { turn: 2, step: 3 } } as never)
  expect(session.append).toHaveBeenCalledTimes(1)
  expect(session.append.mock.calls[0]![1]).toMatchObject({ turn: 2, step: 3, message: { content: [{ type: 'text', text: 'Queued until the step ends.' }] } })
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
  // A conversation that is gone is dropped, and nothing is shown there.
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

it('shows a waiting reply when the Session goes idle without ending a step', async () => {
  h = await startRuntime()
  const master = h.runtime.masterId, session = sessionOf(h, master)
  session.snapshotEvents = () => [{ type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'tool-call', id: 'call-1' }] } } }]
  h.runtime.sessions.speak(master, key('reply', 'idle', 'x'), 'Shown when the Session idles.')
  expect(session.append).not.toHaveBeenCalled()
  h.ctx.emit('agent/status', { agent: h.agents.get(master), status: 'idle' } as never)
  expect(session.append).toHaveBeenCalledTimes(1)
})

it('leaves a reply unshown when its Session refuses the message, and tries it again', async () => {
  h = await startRuntime()
  const master = h.runtime.masterId, session = sessionOf(h, master)
  const append = vi.fn(() => { throw new Error('Session is closed') })
  session.append = append
  h.runtime.sessions.speak(master, key('reply', 'closed', 'x'), 'Cannot be shown.')
  expect(append).toHaveBeenCalledTimes(1)
  expect(h.runtime.store.get(KV.sessions.spoken(key('reply', 'closed', 'x')))).toBeUndefined()
  session.snapshotEvents = () => []
  h.runtime.sessions.speak(master, key('reply', 'closed', 'x'), 'Cannot be shown.')
  expect(append).toHaveBeenCalledTimes(2)
})
