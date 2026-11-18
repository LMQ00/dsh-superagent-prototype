#!/usr/bin/env node
/**
 * Install dsh-superagent into the DeepSeek Harness profile that runs this session, or one named with `--profile`.
 *
 * Model shell calls receive `DSH_PROFILE` and `DSH_PROFILE_DIR` from the running Host, including DeepSeek Harness
 * Desktop, whose profile is `desktop`. Without those variables, the checkout installs into `web` when it exists, then
 * `superagent`, then the only profile there is. The script runs `dsh plugin --profile <profile> add link:<checkout>`.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const USAGE = `Usage: node scripts/install.mjs [--profile <name>] [--dsh <path>] [--dry-run]

Installs this checkout into a DeepSeek Harness profile. Without --profile, the
profile that runs this session (DSH_PROFILE) is used; in DeepSeek Harness Desktop
that is the desktop profile.`

/** Read the value of `--name value` or `--name=value`, returning undefined when absent. */
function option(argv, name) {
  const index = argv.findIndex(word => word === `--${name}` || word.startsWith(`--${name}=`))
  if (index === -1) return undefined
  const word = argv[index]
  const value = word.includes('=') ? word.slice(word.indexOf('=') + 1) : argv[index + 1]
  if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`--${name} needs a value`)
  return value
}

/** The profile directories under a Harness home. */
function profilesIn(home) {
  const directory = join(home, 'profiles')
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
}

/**
 * Choose the profile to install into.
 * @param explicit - `--profile`, which wins over every other source.
 * @param env - environment of the installing process.
 * @param profiles - profile names that exist under the Harness home.
 * @returns the profile name and where it came from.
 */
export function chooseProfile(explicit, env, profiles) {
  if (explicit) {
    if (!profiles.includes(explicit)) throw new Error(`profile "${explicit}" does not exist; create it first, or choose one of: ${profiles.join(', ') || 'none'}`)
    return { profile: explicit, source: '--profile' }
  }
  const named = env.DSH_PROFILE?.trim()
  if (named) {
    if (!profiles.includes(named)) throw new Error(`the running Host names profile "${named}", but it is not under ${join(env.DSH_HOME ?? '', 'profiles')}`)
    return { profile: named, source: 'the running Host (DSH_PROFILE)' }
  }
  const directory = env.DSH_PROFILE_DIR?.trim()
  if (directory) {
    const name = basename(directory)
    if (profiles.includes(name)) return { profile: name, source: 'the running Host (DSH_PROFILE_DIR)' }
  }
  for (const candidate of ['web', 'superagent']) {
    if (profiles.includes(candidate)) return { profile: candidate, source: 'a default name' }
  }
  if (profiles.length === 1) return { profile: profiles[0], source: 'the only profile' }
  throw new Error(profiles.length
    ? `several profiles exist (${profiles.join(', ')}); name one with --profile`
    : 'no profile exists; create one first, then run this script there')
}

/** Quote one argument for a `cmd.exe` command line, so a path with spaces stays one argument. */
const cmdQuote = value => /[\s"&|<>^()]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
/** Run a program, going through `cmd.exe` for a Windows command name or batch file, which Windows cannot start directly. */
function run(program, argv, env) {
  const windows = process.platform === 'win32' && !/\.exe$/i.test(program)
  return windows
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', [program, ...argv].map(cmdQuote).join(' ')], { stdio: 'inherit', env })
    : spawnSync(program, argv, { stdio: 'inherit', env })
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); return 0 }
  const env = { ...process.env }
  const home = env.DSH_HOME?.trim() ? env.DSH_HOME : join(homedir(), '.dsh')
  env.DSH_HOME = home
  const profiles = profilesIn(home)
  const { profile, source } = chooseProfile(option(argv, 'profile'), env, profiles)
  const dsh = option(argv, 'dsh') ?? env.DSH_BIN ?? 'dsh'
  const command = [dsh, 'plugin', '--profile', profile, 'add', `link:${ROOT}`]
  console.log(`Installing dsh-superagent into the ${profile} profile (${join(home, 'profiles', profile)}), from ${source}.`)
  if (argv.includes('--dry-run')) {
    console.log(command.join(' '))
    return 0
  }
  const result = run(dsh, command.slice(1), env)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${dsh} exited with ${result.status ?? result.signal}`)
  console.log(`Installed dsh-superagent into ${profile}. Restart that profile's Host to load it.`)
  return 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
