/** Built-in prompt sections, role policies, and transcript projections for orchestrator and worker Sessions. */
import { bundledSkills, promptFile } from './skill-files.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
export { textPage } from './cards.ts'

/** Built-in host-delivery and tool-usage rules shared by all Sessions; a team may override them (`builtInParts`). */
export const sharedPrompt = promptFile('shared')
export const masterPrompt = promptFile('orchestrator')
export const workerPrompt = promptFile('worker')
/** Built-in policy sections referenced by role prompts; a team may override them. */
export const guides: Readonly<Record<string, string>> = Object.fromEntries(['subscriptions', 'replies', 'dispatch', 'work']
  .map(name => [name, promptFile(name)]))
/** Bundled Source skills registered by dsh-superagent; a team may override their text. */
export const sourceSkills: Readonly<Record<'feishu' | 'github', string>> = { feishu: bundledSkills.feishu.content, github: bundledSkills.github.content }
export const cliNotes = promptFile('cli')
/** Default text for the team-editable prompt sections (communication, ticket scope, and PR delivery). */
export const teamDefaults = {
  communication: promptFile('team/communication'), scope: promptFile('team/scope'), delivery: promptFile('team/delivery'),
}

/**
 * Built-in texts a local installation puts in place of the ones above, which assume a remote with pull requests and a
 * chat transport: work is committed to the ticket branch only, and user-facing messages are recorded in the panel and
 * appended to the state directory's outbox.
 */
export const localPrompts = {
  shared: promptFile('local/shared'), orchestrator: promptFile('local/orchestrator'), worker: promptFile('local/worker'),
  admission: promptFile('local/admission'), subscriptions: promptFile('local/subscriptions'),
  work: promptFile('local/work'), replies: promptFile('local/replies'), dispatch: promptFile('local/dispatch'),
  communication: promptFile('local/communication'), delivery: promptFile('local/delivery'),
  handoff: { orchestrator: promptFile('local/handoff-orchestrator'), worker: promptFile('local/handoff-worker') },
}

export const mainAdmissionPolicy = promptFile('admission')

const handoff = { shared: promptFile('handoff'), orchestrator: promptFile('handoff-orchestrator'), worker: promptFile('handoff-worker') }
export const handoffPolicy = (role: 'orchestrator' | 'worker'): string => `${handoff.shared}\n${handoff[role]}`

export const autoMergeThreshold = (lines: number): string => `it changes fewer than ${lines} lines (additions plus deletions);`

/** Retains message content while omitting streamed chunks, usage accounting, and reasoning blocks. */
export function transcriptEntry(event: SessionEvent) {
  if (event.type !== 'user/message' && event.type !== 'tool/result' && event.type !== 'assistant/message') return undefined
  const message = event.type === 'user/message' ? event.data : event.data.message
  return { type: event.type, message: { role: message.role, content: message.content.filter(block => block.type !== 'reasoning') } }
}
