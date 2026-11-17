/** The prepare command a project that sets none gets: a git worktree of the project, or a copy of a directory that is not a repository. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../policy.ts'

/** Single-quote one path for `sh -c`, so spaces and quotes in it survive. */
const quote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'"

/**
 * The command that lays out one ticket directory from a project. A repository gets a worktree on a fresh branch named after
 * the ticket, which `-B` lets a retried ticket take back instead of failing; anything else is copied.
 */
export function defaultPrepare(project: Pick<Project, 'path'>, directory: string): string {
  const target = quote(directory)
  if (existsSync(join(project.path, '.git'))) {
    return 'git -C ' + quote(project.path) + ' worktree add --quiet -B "agent/$DSH_SUPERAGENT_NAME" ' + target
  }
  return 'mkdir -p ' + target + ' && cp -a ' + quote(project.path) + '/. ' + target + '/'
}
