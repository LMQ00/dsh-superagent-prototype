/** Tests for scripts/install.mjs: which profile it chooses, and that it installs the checkout into it. */
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
let home: string
let calls: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'install-script-'))
  mkdirSync(join(home, 'profiles'))
  mkdirSync(join(home, 'bin'))
  calls = join(home, 'calls.txt')
  // A `dsh` that records its arguments; the script reads the recorded lines back.
  writeFileSync(join(home, 'bin', 'dsh'), `#!/bin/sh\nprintf '%s\\n' "$@" >> '${calls}'\nexit 0\n`, { mode: 0o755 })
})
afterEach(() => rmSync(home, { recursive: true, force: true }))
const profile = (name: string): void => { mkdirSync(join(home, 'profiles', name)) }
const run = (args: string[], env: Record<string, string | undefined> = {}) => new Promise<{ code: number; stdout: string; stderr: string }>(done => {
  const { DSH_PROFILE: _ignored, ...rest } = process.env
  execFile(process.execPath, [join(root, 'scripts', 'install.mjs'), ...args], {
    env: { ...rest, DSH_HOME: home, PATH: `${join(home, 'bin')}:${process.env.PATH}`, ...env },
    timeout: 20_000,
  }, (error, stdout, stderr) => done({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr }))
})
const installed = (): string[] => readFileSync(calls, 'utf8').trim().split('\n')
const spec = `link:${root}`

it('installs into the profile that runs the session, such as desktop', async () => {
  profile('desktop'); profile('web')
  const result = await run([], { DSH_PROFILE: 'desktop' })
  expect(result).toMatchObject({ code: 0, stdout: expect.stringContaining('into the desktop profile') })
  expect(installed()).toEqual(['plugin', '--profile', 'desktop', 'add', spec])
})
it('lets --profile choose another profile, and reads DSH_PROFILE_DIR when no name is exported', async () => {
  profile('desktop'); profile('web')
  expect((await run(['--profile', 'web'], { DSH_PROFILE: 'desktop' })).code).toBe(0)
  expect(installed()).toEqual(['plugin', '--profile', 'web', 'add', spec])
  rmSync(calls, { force: true })
  expect((await run([], { DSH_PROFILE_DIR: join(home, 'profiles', 'desktop') })).code).toBe(0)
  expect(installed()).toEqual(['plugin', '--profile', 'desktop', 'add', spec])
})
it('falls back to web, then superagent, then the only profile', async () => {
  profile('desktop'); profile('web'); profile('superagent')
  expect((await run([])).code).toBe(0)
  expect(installed()).toEqual(['plugin', '--profile', 'web', 'add', spec])
  rmSync(calls, { force: true })
  rmSync(join(home, 'profiles', 'web'), { recursive: true })
  expect((await run([])).stdout).toContain('into the superagent profile')
  rmSync(calls, { force: true })
  rmSync(join(home, 'profiles', 'superagent'), { recursive: true })
  expect((await run([])).stdout).toContain('into the desktop profile')
})
it('refuses a named profile that does not exist, and a home with no choice', async () => {
  profile('web')
  const missing = await run(['--profile', 'desktop'])
  expect(missing).toMatchObject({ code: 1, stderr: expect.stringContaining('profile "desktop" does not exist') })
  rmSync(join(home, 'profiles', 'web'), { recursive: true })
  expect(await run([])).toMatchObject({ code: 1, stderr: expect.stringContaining('no profile exists') })
})
it('refuses an empty --profile instead of guessing', async () => {
  profile('web')
  expect(await run(['--profile='])).toMatchObject({ code: 1, stderr: expect.stringContaining('--profile needs a value') })
  expect(() => installed()).toThrow()
})
it('prints the command without installing with --dry-run', async () => {
  profile('desktop')
  const result = await run(['--dry-run'], { DSH_PROFILE: 'desktop' })
  expect(result).toMatchObject({ code: 0, stdout: expect.stringContaining(`dsh plugin --profile desktop add ${spec}`) })
  expect(() => installed()).toThrow()
})
