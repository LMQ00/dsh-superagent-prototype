import { describe, expect, it } from 'vitest'
import { composePrompt, composeSkill, defaultPrompts } from '../src/app/prompts.ts'
import { LOCAL_ALLOWED, LOCAL_RULE, PolicyConfigSchema } from '../src/policy.ts'

describe('a local installation, which names no repository', () => {
  const local = defaultPrompts(true), remote = defaultPrompts()
  const worker = composePrompt(local, 'worker'), main = composePrompt(local, 'orchestrator')

  it('works on a local branch and reports, instead of pushing to a remote it does not have', () => {
    expect(worker).toContain('Commit as the author the Delivery requirements section names')
    expect(worker).toContain('This deployment has no pull request and no such CLI, so never push and never open a pull request.')
    expect(local.delivery).toContain('There is no CI and no approval pipeline')
    expect(local.delivery).toContain('person reviews and merges locally')
    expect(local.delivery).not.toMatch(/auto-merge|PR description|gh api/)
  })

  it('names no GitHub or Feishu transport anywhere in either role prompt', () => {
    for (const text of [worker, main]) {
      // Every part either role reads is the local text: no gh, no lark-cli, no review bots, no IM delivery.
      expect(text).not.toMatch(/\bgh\b|lark-cli|posts on GitHub|automated agent, not a human|IM message|review bots/)
      expect(text).toContain('orchestrator_report')
    }
  })

  it('keeps the GitHub texts of a repository installation as they are', () => {
    expect(remote.overrides).toBeUndefined()
    expect(remote.delivery).toContain('auto-merge')
    expect(composePrompt(remote, 'worker')).toMatch(/\bPR\b/)
    expect(composeSkill(remote, 'github')).toContain('gh')
  })

  it('starts the Policy of a local installation with its own rule and the person at this machine', () => {
    const policy = PolicyConfigSchema.parse({})
    // The parse defaults stay as every installation has them; Runtime adds the local pair once, on a first start.
    expect(policy.rules.map(rule => rule.id)).toEqual(['copy', 'visual'])
    expect(policy.sources).toEqual({})
    expect(LOCAL_RULE.id).toBe('local')
    expect(LOCAL_ALLOWED).toEqual([{ id: 'operator', name: 'Operator' }])
  })
})
