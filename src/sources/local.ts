/** Local Source: turns request files in a local inbox directory into Triggers, and appends replies to a local outbox. No external account. */
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { key, type ChannelRef, type OutboundMessage, type Trigger } from '../core/index.ts'
import { family } from '../kv.ts'
import { health, sourceContext, type Health, type SourceContext } from './host.ts'
import type { ChannelLink, Localized, SourceKind } from './kind.ts'

export const SOURCE = 'local'
/** The single identity this Source speaks for: the person at this machine. It matches the default Policy of a local installation. */
export const OPERATOR = 'operator'
const OUTBOX = 'outbox'

const LocalConfigSchema = z.object({
  inbox: z.string().trim().default(''),
  pollSeconds: z.number().int().min(2).max(3600).default(5),
  failuresBeforeError: z.number().int().min(1).max(20).default(3),
}).strict()
export type LocalConfig = z.infer<typeof LocalConfigSchema>
/** The inbox directory a configuration names, or `<stateDir>/inbox` by default. */
export const inboxDirectory = (config: Pick<LocalConfig, 'inbox'>, stateDir: string): string =>
  config.inbox ? resolve(config.inbox) : join(stateDir, 'inbox')
const outboxDirectory = (stateDir: string): string => join(stateDir, OUTBOX)
/** The digest of a request file's text, which decides whether its content has been ingested already. */
const digest = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 32)
/** KV key of the digest last ingested for one inbox file. */
const seen = family<string>('local-inbox-seen')

export const localChannel = (file: string): ChannelRef => ({ source: SOURCE, thread: `${SOURCE}:${file}`, address: { file } })
/**
 * Builds the Trigger for one inbox file. The file is a Thread and its content the request, so editing it again is a
 * follow-up on the same Thread; the id follows the content, so unchanged text is never ingested twice.
 */
export function localTrigger(file: string, text: string, at: string, path: string): Trigger {
  return { id: key('local-request', file, digest(text)), source: SOURCE, threads: [{ source: SOURCE, id: file }],
    actor: { source: SOURCE, id: OPERATOR }, human: true, addressed: 'direct', at, text,
    channel: localChannel(file), url: `file://${path}`, meta: { file, path } }
}

/** Appends one user-facing message to `<stateDir>/outbox/<thread>.md`, once per message id. */
export async function sendLocal(host: Pick<SourceContext, 'commands'>, message: OutboundMessage): Promise<'sent' | 'gone'> {
  const dir = outboxDirectory(host.commands.deployment.stateDir)
  const file = join(dir, `${message.channel.address.file ?? 'inbox'}.md`)
  const marker = `<!-- dsh-superagent:${message.id} -->`
  await mkdir(dir, { recursive: true })
  const existing = await readFile(file, 'utf8').catch(() => '')
  if (existing.includes(marker)) return 'sent'
  await appendFile(file, `\n---\n\n${message.text}\n\n${marker}\n`, 'utf8')
  return 'sent'
}
export function localLink(address: Record<string, string>): ChannelLink {
  const file = address.file ?? 'inbox'
  const label: Localized = { zh: `本地收件箱：${file}`, en: `Local inbox: ${file}` }
  return { url: `file://${file}`, label }
}

export const localKind: SourceKind<LocalConfig> = {
  kind: SOURCE,
  title: { zh: '本地收件箱', en: 'Local inbox' },
  description: { zh: '读一个本地目录里的请求文件，不需要任何外部账号：每个文件是一个线索，文件内容变了就是这条线索上的一条新请求；回复写到状态目录的 outbox 下。',
    en: 'Reads request files from a local directory and needs no external account: each file is a Thread, changed content is a new request on it, and replies are appended under the state directory\'s outbox.' },
  schema: LocalConfigSchema,
  fields: [
    { key: 'inbox', type: 'text', pattern: '^(/.*)?$', label: { zh: '收件箱目录', en: 'Inbox directory' },
      hint: { zh: '写绝对路径，或留空用 <状态目录>/inbox。目录里每个 .md 或 .txt 文件是一条线索：写进内容就发起一次请求，再改这个文件就是同一线索上的后续请求。', en: 'An absolute path, or empty for <stateDir>/inbox. Every .md or .txt file in it is a Thread: writing to it raises a request, and editing it again is a follow-up on the same Thread.' } },
    { key: 'pollSeconds', type: 'number', advanced: true, min: 2, max: 3600, label: { zh: '扫描间隔 / 秒', en: 'Scan interval / seconds' },
      hint: { zh: '多久看一次收件箱目录。', en: 'How often the inbox directory is read.' } },
    { key: 'failuresBeforeError', type: 'number', advanced: true, min: 1, max: 20, label: { zh: '连续失败几次后报告异常', en: 'Failed scans before reporting an error' },
      hint: { zh: '单次失败会在下一次扫描时重试，不必报告。', en: 'A single failure is retried on the next scan and need not be reported.' } },
  ],
  health: ['local'],
  channel: { send: sendLocal, link: localLink },
  find: query => {
    const name = query.trim().replace(/^local:/, '')
    return { threads: name ? [`${SOURCE}:${name}`] : [], terms: [] }
  },
  environment: {
    variables: [
      { key: 'DSH_SUPERAGENT_LOCAL_INBOX', description: { zh: '本地收件箱目录的绝对路径；请求文件都在这里。', en: 'Absolute path of the local inbox directory that holds the request files.' } },
      { key: 'DSH_SUPERAGENT_LOCAL_REQUEST', description: { zh: '接下这个工单的请求文件的绝对路径；不是本地来的工单时为空。', en: 'Absolute path of the request file that started the ticket; empty when the ticket did not come from the local inbox.' } },
    ],
    values: ({ deployment, config, trigger }) => {
      const stateDir = deployment.stateDir
      const file = trigger?.meta.file
      return { DSH_SUPERAGENT_LOCAL_INBOX: inboxDirectory(config, stateDir),
        DSH_SUPERAGENT_LOCAL_REQUEST: typeof file === 'string' ? String(trigger?.meta.path ?? join(inboxDirectory(config, stateDir), file)) : '' }
    },
  },
}

export const name = 'dsh-superagent-local'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(localKind), 'local: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, localKind)
    const controller = new AbortController()
    // Unhandled rejections terminate the DSH process, so a failure escaping the scan loop is reported as source health instead.
    const running = watch(source, controller.signal).catch((error: unknown) => { source.report('local', { state: 'error', detail: String(error) }) })
    return async () => { controller.abort(); await running }
  })
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> => new Promise(resolve => {
  const timer = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
})
/** Returns an error health once `failures` consecutive scans fail, or undefined so a single failure stays quiet. */
export function pollFailure(failures: number, threshold: number, error: unknown): Health | undefined {
  return failures >= threshold ? health('error', 'pollFailures', { count: String(failures), error: String(error) }) : undefined
}

async function watch(ctx: SourceContext, signal: AbortSignal): Promise<void> {
  let failures = 0
  await ctx.ready
  // Setup restarts dsh-superagent once it resolves the accounts; until then nothing is read.
  if (!ctx.configured()) { ctx.report('local', health('paused', 'setupPending')); return }
  while (!signal.aborted) {
    const config = ctx.config<LocalConfig>(SOURCE)
    try {
      if (!config) { ctx.report('local', health('paused', 'sourceOff')); await sleep(5000, signal); continue }
      await scan(ctx, config, signal)
      failures = 0
    } catch (error) {
      failures += 1
      const failed = pollFailure(failures, config?.failuresBeforeError ?? 3, error)
      if (failed) ctx.report('local', failed)
    }
    await sleep((config?.pollSeconds ?? 5) * 1000, signal)
  }
}

/** Reads every request file once, ingesting the ones whose content changed. */
async function scan(ctx: SourceContext, config: LocalConfig, signal: AbortSignal): Promise<void> {
  const dir = inboxDirectory(config, ctx.deployment.stateDir)
  await mkdir(dir, { recursive: true })
  const names = (await readdir(dir)).filter(name => !name.startsWith('.') && /\.(md|txt)$/i.test(name)).sort()
  for (const name of names) {
    if (signal.aborted) return
    const path = join(dir, name)
    const info = await stat(path).catch(() => undefined)
    if (!info?.isFile()) continue
    const text = await readFile(path, 'utf8')
    const current = digest(text)
    if (ctx.state.get(seen(name)) === current || !text.trim()) {
      if (!text.trim()) ctx.state.set(seen(name), current)
      continue
    }
    const trigger = localTrigger(name, text, new Date(info.mtimeMs).toISOString(), path)
    ctx.threads.describe(`${SOURCE}:${name}`, { label: name, url: `file://${path}` })
    await ctx.receive(trigger)
    ctx.atomic(() => ctx.state.set(seen(name), current))
  }
  ctx.report('local', health('ready', 'localInbox', { path: dir }))
}
