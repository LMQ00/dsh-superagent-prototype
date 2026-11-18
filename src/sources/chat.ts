/** Chat Source: the person's own conversation with the main Session is the intake, so a request needs no account and no file. */
import type { Context } from '@deepseek-ai/cordis'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { key, type ChannelRef, type OutboundMessage, type Trigger } from '../core/index.ts'
import { health, sourceContext, type SourceContext } from './host.ts'
import { KV } from '../kv.ts'
import type { ChannelLink, Localized, SourceKind } from './kind.ts'

export const SOURCE = 'chat'
/** The single sender this Source speaks for: the person at this machine typing in the main Session. */
export const OPERATOR = 'operator'
/** The text of a user message, with the blocks that carry no words left out. */
export function messageText(message: { content: readonly { type: string; text?: string }[] }): string {
  return message.content.flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n').trim()
}
/** True for a message this installation itself delivered into the Session, which is never a person's request. */
export function ownMessage(source: { kind: string; plugin?: unknown } | undefined): boolean {
  return !!source && (source.kind === 'dsh-superagent' || (source.kind === 'plugin' && source.plugin === 'dsh-superagent'))
}
/** The project the person chose for a conversation, when the selection still names one. */
export function selectedProject(source: Pick<SourceContext, 'state'>, sessionId: string): string | undefined {
  const project = source.state.get(KV.sessions.project(sessionId))
  return typeof project === 'string' && project.trim() ? project : undefined
}
/** Builds the Trigger for one message of the main Session; each message is a Thread of its own, with the conversation's project when one is selected. */
export function chatTrigger(messageId: string, sessionId: string, text: string, at: string, project?: string): Trigger {
  return { id: key('chat-message', sessionId, messageId), source: SOURCE, threads: [{ source: SOURCE, id: messageId }],
    actor: { source: SOURCE, id: OPERATOR }, human: true, addressed: 'direct', at, text,
    channel: chatChannel(messageId), meta: { messageId, sessionId, ...project ? { project } : {} } }
}
export const chatChannel = (messageId: string): ChannelRef =>
  ({ source: SOURCE, thread: `${SOURCE}:${messageId}`, address: { message: messageId } })

/** Appends one user-facing message to `<stateDir>/outbox/chat.md`, once per message id; the panel shows the same text on its ticket. */
export async function sendChat(host: Pick<SourceContext, 'commands'>, message: OutboundMessage): Promise<'sent' | 'gone'> {
  const dir = join(host.commands.deployment.stateDir, 'outbox')
  const file = join(dir, 'chat.md')
  const marker = `<!-- dsh-superagent:${message.id} -->`
  await mkdir(dir, { recursive: true })
  const existing = await readFile(file, 'utf8').catch(() => '')
  if (existing.includes(marker)) return 'sent'
  await appendFile(file, `\n---\n\n${message.text}\n\n${marker}\n`, 'utf8')
  return 'sent'
}
export const chatLink = (address: Record<string, string>): ChannelLink => ({
  url: '', label: { zh: `主对话的消息 ${address.message ?? ''}`, en: `Message ${address.message ?? ''} in the main Session` } as Localized,
})

export const chatKind: SourceKind = {
  kind: SOURCE,
  title: { zh: '主对话', en: 'Main Session' },
  description: { zh: '主 Session 里这个人说的话就是入口：每条消息是一个候选，主 Session 判断后决定接成工单、并到已有工单、还是忽略。不需要任何账号或消息平台。',
    en: 'What the person writes in the main Session is the intake: every message becomes a candidate, and the main Session decides whether to accept it as a ticket, attach it to one, or ignore it. No account or messaging platform is involved.' },
  schema: z.object({}).strict(),
  fields: [],
  health: ['chat'],
  channel: { send: sendChat, link: chatLink },
  policy: {
    schema: z.object({ allowed: z.array(z.object({ id: z.string().trim().min(1).max(200), name: z.string().trim().max(100).optional() }).strict()).default([]) }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能在主对话里发起工作的人', en: 'People who may originate work in the main Session' },
      hint: { zh: '主对话只有一个固定身份 operator（就是这台机器前的人）。', en: 'The main Session has one fixed identity, operator: the person at this machine.' },
      columns: [{ key: 'id', type: 'text', label: { zh: '身份', en: 'Identity' } }] }],
    explicit: { zh: '名单里的身份在主对话里直接说话。', en: 'An identity on the list writes in the main Session.' },
  },
}

export const name = 'dsh-superagent-chat'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(chatKind), 'chat: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, chatKind)
    // Messages that arrive before setup resolves are held, and received in order once it has.
    const held: Trigger[] = []
    let ready = false
    void source.ready.then(() => {
      ready = true
      if (!source.configured()) { source.report('chat', health('paused', 'sourceOff')); return }
      for (const trigger of held.splice(0)) void source.receive(trigger)
      source.report('chat', health('ready', 'chatSession'))
    }).catch(() => { /* A source whose setup never resolves reports nothing. */ })
    const listener = ctx.on('session/event', (session, event) => {
      if (event.type !== 'user/message' || !ctx.orchestrator.isMain(String(session.id))) return
      const message = event.data
      if (message.role !== 'user' || ownMessage(message.source)) return
      const text = messageText(message)
      if (!text) return
      const trigger = chatTrigger(String(message.id), String(session.id), text, new Date().toISOString(), selectedProject(source, String(session.id)))
      source.atomic(() => source.threads.describe(`${SOURCE}:${trigger.meta.messageId}`, { label: text.slice(0, 80) }))
      if (ready && source.configured()) void source.receive(trigger)
      else held.push(trigger)
    })
    return () => { listener() }
  })
}
