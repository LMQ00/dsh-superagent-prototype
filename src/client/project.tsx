/** Composer project seat of the main Session: picks which registered project the conversation's requests route to. */
import { useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ApiResponse } from '../app/api.ts'
import type { T } from './text.ts'
import STYLES from './project.css?raw'

type Conversation = ApiResponse<'GET conversation'>
export interface ProjectSelectProps { sessionId: SessionId; t: T }

/** Call one management route with the same-origin marker the panel uses; the caller owns failures. */
async function request(path: string, method = 'GET', body?: unknown): Promise<Conversation> {
  const headers: Record<string, string> = { 'x-orchestrator-request': '1' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`/orchestrator/api/${path}`, { method, headers, ...body === undefined ? {} : { body: JSON.stringify(body) } })
  if (!response.ok) throw new Error(`dsh-superagent answered ${response.status}`)
  return await response.json() as Conversation
}

/**
 * Render the project chip beside the other composer controls. It reads the conversation's selection and the
 * registered projects, hides outside the main Session and while no project is registered, and saves a pick.
 */
export function ProjectSelect({ sessionId, t }: ProjectSelectProps) {
  const [value, setValue] = useState<Conversation>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    const load = async () => {
      try {
        const next = await request(`conversation?session=${encodeURIComponent(String(sessionId))}`)
        if (live.current) { setValue(next); setFailed(false) }
      } catch {
        // The management routes answer only after setup; a failed read leaves the seat as it was.
      }
    }
    void load()
    const timer = setInterval(() => { if (!document.hidden) void load() }, 5000)
    return () => { live.current = false; clearInterval(timer) }
  }, [sessionId])
  const choose = async (project: string) => {
    setBusy(true)
    setFailed(false)
    try {
      const next = await request('conversation', 'PUT', { session: String(sessionId), project: project || null })
      if (live.current) setValue(next)
    } catch {
      if (live.current) setFailed(true)
    } finally {
      if (live.current) setBusy(false)
    }
  }
  if (!value?.master || value.projects.length === 0) return null
  return <span className="dt-project-seat">
    <style>{STYLES}</style>
    <span className="dt-project-label" aria-hidden>{t('projectLabel')}</span>
    <select className="dt-project-select" aria-label={t('projectTarget')} title={t('projectTarget')}
      value={value.selected ?? ''} disabled={busy}
      onChange={event => { void choose(event.target.value) }}>
      <option value="">{t('projectNone')}</option>
      {value.projects.map(project => <option key={project.name} value={project.name}>{project.name}</option>)}
    </select>
    {failed && <span className="dt-project-error" role="status">{t('projectSaveFailed')}</span>}
  </span>
}
