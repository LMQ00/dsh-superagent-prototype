import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsSchema } from '../src/policy.ts'
import type { Ticket } from '../src/core/index.ts'
import { ticketExecution } from '../src/executor/dsh.ts'
import { defaultPrepare } from '../src/executor/project-prepare.ts'
import { environmentOf } from '../src/app/execution-environment.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { chatTrigger, messageText, ownMessage } from '../src/sources/chat.ts'
import { testDeployment } from './fixtures/deployment.ts'

const ticket = (): Ticket => ({ id: 'ticket-0123456789abcdef', origin: { triggerId: 'tr1', triggerIds: [] },
  mandate: { strength: 'explicit', policyVersion: 'v1', basis: { rules: [] }, actor: { source: 'chat', id: 'operator' }, scope: '' } } as unknown as Ticket)

describe('the project a ticket works in', () => {
  it('sends a ticket named with a project to that project\'s own directory under the work root', () => {
    const settings = SettingsSchema.parse({ executor: { projects: [{ name: 'webapp', path: '/srv/webapp' }] } })
    const acceptance = { kind: 'accept', title: 'Fix', scope: 'the typo', reason: 'r', name: 'fix-typo', project: 'webapp' } as const
    const execution = ticketExecution(ticket(), acceptance as never, settings, '/state')
    // One level deeper than an unprojected ticket, so two projects never share a directory name.
    expect(execution.directory).toBe('/state/work/webapp/fix-typo-ticket-01234')
    expect(execution.project).toEqual({ name: 'webapp', path: '/srv/webapp' })
    expect(execution.assignment).toContain('prepared from /srv/webapp')
    // Without a project the directory stays where it was.
    expect(ticketExecution(ticket(), { ...acceptance, project: undefined } as never, settings, '/state'))
      .toMatchObject({ directory: '/state/work/fix-typo-ticket-01234' })
    expect(ticketExecution(ticket(), { ...acceptance, project: undefined } as never, settings, '/state')).not.toHaveProperty('project')
  })

  it('gives a project without a prepare command a worktree of a repository, and a copy of anything else', () => {
    const root = mkdtempSync(join(tmpdir(), 'projects-'))
    const repo = join(root, 'repo'), plain = join(root, 'plain')
    mkdirSync(join(repo, '.git'), { recursive: true }); mkdirSync(plain)
    writeFileSync(join(plain, 'README.md'), 'hello')
    expect(defaultPrepare({ path: repo }, '/state/work/repo/t1')).toBe(
      "git -C '" + repo + "' worktree add --quiet -B \"agent/$DSH_SUPERAGENT_NAME\" '/state/work/repo/t1'")
    expect(defaultPrepare({ path: plain }, '/state/work/plain/t1')).toBe(
      "mkdir -p '/state/work/plain/t1' && cp -a '" + plain + "'/. '/state/work/plain/t1'/")
    // A quote in a path is escaped rather than closing the quoted string early.
    expect(defaultPrepare({ path: "/tmp/it's here" }, '/state/t')).toContain("'/tmp/it'\\''s here'/.")
  })

  it('hands the worker the project name and directory, and nothing else when the ticket has no project', () => {
    const settings = SettingsSchema.parse({ executor: { projects: [{ name: 'webapp', path: '/srv/webapp' }] } })
    const deployment = testDeployment()
    const sources = new SourceRegistry(() => settings)
    const variables = (project?: { name: string; path: string }) => Object.fromEntries(environmentOf({ deployment, sources, settings,
      ticket: { id: 't1', name: 'fix-typo', directory: '/state/work/webapp/fix-typo', ...project ? { project } : {} } }).map(variable => [variable.key, variable.value]))
    expect(variables({ name: 'webapp', path: '/srv/webapp' })).toMatchObject({ DSH_SUPERAGENT_PROJECT: 'webapp', DSH_SUPERAGENT_PROJECT_DIR: '/srv/webapp' })
    expect(variables()).toMatchObject({ DSH_SUPERAGENT_PROJECT: '', DSH_SUPERAGENT_PROJECT_DIR: '' })
  })
})

describe('the main Session as the intake', () => {
  it('turns one message into a request of its own Thread, with the person at this machine as its sender', () => {
    const trigger = chatTrigger('msg-1', 'orchestrator-abc', 'Add a dark mode to webapp.', '2026-09-01T00:00:00.000Z')
    expect(trigger).toMatchObject({ source: 'chat', threads: [{ source: 'chat', id: 'msg-1' }],
      actor: { source: 'chat', id: 'operator' }, human: true, addressed: 'direct', text: 'Add a dark mode to webapp.',
      channel: { source: 'chat', address: { message: 'msg-1' } }, meta: { messageId: 'msg-1', sessionId: 'orchestrator-abc' } })
    // The same message is the same request; another one on the same Session is not.
    expect(chatTrigger('msg-1', 'orchestrator-abc', 'x', 'now').id).toBe(trigger.id)
    expect(chatTrigger('msg-2', 'orchestrator-abc', 'x', 'now').id).not.toBe(trigger.id)
  })

  it('reads the words of a message, and never takes what this installation delivered itself for a request', () => {
    expect(messageText({ content: [{ type: 'text', text: 'Fix the typo.' }, { type: 'image' }, { type: 'text', text: 'In README.' }] }))
      .toBe('Fix the typo.\nIn README.')
    expect(messageText({ content: [{ type: 'image' }] })).toBe('')
    expect(ownMessage({ kind: 'dsh-superagent' })).toBe(true)
    expect(ownMessage({ kind: 'plugin', plugin: 'dsh-superagent' })).toBe(true)
    expect(ownMessage({ kind: 'user' })).toBe(false)
    expect(ownMessage(undefined)).toBe(false)
  })
})
