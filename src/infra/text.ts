/** Word counting, string formatting and repository address utilities for IM message limits, templates and project sources. */
const words = new Intl.Segmenter('zh', { granularity: 'word' })
export const IM_WORDS = 100
export const NOTE_WORDS = 30
/** Counts word-like segments across Chinese, English, and mixed text, ignoring punctuation. */
export function wordCount(text: string): number {
  let count = 0
  for (const segment of words.segment(text)) if (segment.isWordLike) count++
  return count
}
/** Validates that an outgoing IM Markdown message does not exceed `IM_WORDS` (link labels and URLs both count toward the limit). */
export function checkedImText(text: string): string {
  const count = wordCount(text)
  if (count > IM_WORDS) throw new Error(`IM message has ${count} words; maximum is ${IM_WORDS}. Rewrite as a short high-level update. Do not split it into multiple messages.`)
  return text
}
export const fill = (template: string, values: Record<string, string>): string => template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '')
/** Case-insensitive comparison for GitHub logins and repository names. */
export const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
/**
 * Whether `value` is a repository URL rather than a path: `https://`, `ssh://`, `git://` or `file://`, or the scp-like
 * `git@host:owner/name`. A leading dash never counts, so git reads the value as an operand instead of an option. A password in
 * the URL is refused: it would reach the worker's prompt and the ticket's variables in plain text.
 */
export const repositoryUrl = (value: string): boolean => {
  const text = value.trim()
  if (!text || text.startsWith('-') || /\s/.test(text)) return false
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:\S+$/.test(text)) return true
  const match = /^(https?|ssh|git|file):\/\/([^/]*)(\/\S*)?$/.exec(text)
  if (!match) return false
  const [, scheme, authority] = match
  const at = authority!.lastIndexOf('@')
  if (at === -1) return true
  // An ssh login may name its account; any other userinfo is a password, which this refuses.
  return scheme === 'ssh' && !authority!.slice(0, at).includes(':')
}
export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
