/** Composer project seat of the main Session: picks which registered project the conversation's requests route to, and manages the registry. */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ApiResponse } from '../app/api.ts'
import { Icon } from './controls.tsx'
import type { T } from './text.ts'
import STYLES from './project.css?raw'

type Conversation = ApiResponse<'GET conversation'>
export interface ProjectSelectProps { sessionId: SessionId; t: T }

/** A failed management call with the status and the issue paths the host reported. */
class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly issues: readonly string[]) { super(message) }
}
/** Call one management route with the same-origin marker the panel uses; the caller owns failures. */
async function request(path: string, method = 'GET', body?: unknown): Promise<Conversation> {
  const headers: Record<string, string> = { 'x-orchestrator-request': '1' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`/orchestrator/api/${path}`, { method, headers, ...body === undefined ? {} : { body: JSON.stringify(body) } })
  if (!response.ok) {
    const value = await response.json().catch(() => undefined) as { error?: unknown; issues?: unknown } | undefined
    const issues = Array.isArray(value?.issues) ? value.issues.flatMap(issue => {
      const path = issue && typeof issue === 'object' ? (issue as { path?: unknown }).path : undefined
      return typeof path === 'string' ? [path] : []
    }) : []
    throw new RequestError(typeof value?.error === 'string' ? value.error : `dsh-superagent answered ${response.status}`,
      response.status, issues)
  }
  return await response.json() as Conversation
}
/** Identify which project field the host refused, so the popover can name it in the interface language. */
function refusedField(failure: unknown): 'name' | 'path' | undefined {
  if (!(failure instanceof RequestError)) return undefined
  if (failure.issues.some(path => path === 'name' || path.endsWith('.name'))) return 'name'
  if (failure.issues.some(path => path === 'path' || path.endsWith('.path'))) return 'path'
  return undefined
}
const POPOVER_WIDTH = 320

/**
 * Render the project chip beside the other composer controls. It reads the conversation's selection and the
 * registered projects, hides outside the main Session, saves a pick, and opens a popover that adds and removes projects.
 */
export function ProjectSelect({ sessionId, t }: ProjectSelectProps) {
  const [value, setValue] = useState<Conversation>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ left: number; bottom: number; maxHeight: number }>()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [wrote, setWrote] = useState(false)
  const [addError, setAddError] = useState<string>()
  const [removing, setRemoving] = useState<string>()
  const [removeError, setRemoveError] = useState<string>()
  const live = useRef(true)
  // Bumped around every mutation so a poll that started earlier cannot overwrite the newer registry.
  const generation = useRef(0)
  const seat = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => {
    live.current = true
    const load = async () => {
      const started = generation.current
      try {
        const next = await request(`conversation?session=${encodeURIComponent(String(sessionId))}`)
        if (live.current && started === generation.current) { setValue(next); setFailed(false) }
      } catch {
        // The management routes answer only after setup; a failed read leaves the seat as it was.
      }
    }
    void load()
    const timer = setInterval(() => { if (!document.hidden) void load() }, 5000)
    return () => { live.current = false; clearInterval(timer) }
  }, [sessionId])
  /** Run one mutation and take its answer, discarding polls that started before it or while it ran. */
  const change = async (mutation: () => Promise<Conversation>): Promise<Conversation> => {
    generation.current++
    try {
      const next = await mutation()
      if (live.current) setValue(next)
      return next
    } finally {
      generation.current++
    }
  }
  useEffect(() => {
    if (!open) return
    const place = () => {
      const rect = seat.current?.getBoundingClientRect()
      if (!rect) return
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8))
      // Keep the popover inside the window when the seat sits high, as it does before the first message.
      const next = { left, bottom: window.innerHeight - rect.top + 6, maxHeight: Math.max(120, Math.min(460, rect.top - 16)) }
      // Scrolling the popover's own list reaches this listener too; an unchanged placement keeps React from re-rendering it.
      setAt(previous => previous && previous.left === next.left && previous.bottom === next.bottom
        && previous.maxHeight === next.maxHeight ? previous : next)
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (panel.current?.contains(target) || seat.current?.contains(target)) return
      setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    const focus = requestAnimationFrame(() => first.current?.focus())
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      cancelAnimationFrame(focus)
    }
  }, [open])
  const choose = async (project: string) => {
    setBusy(true)
    setFailed(false)
    try {
      await change(() => request('conversation', 'PUT', { session: String(sessionId), project: project || null }))
    } catch {
      if (live.current) setFailed(true)
    } finally {
      if (live.current) setBusy(false)
    }
  }
  const add = async (event: FormEvent) => {
    event.preventDefault()
    const project = { name: name.trim(), path: path.trim() }
    if (!project.name || !project.path) return
    if (value?.projects.some(item => item.name === project.name)) { setAddError(t('projectExists')); return }
    setWrote(true)
    setAddError(undefined)
    try {
      await change(() => request('conversation/projects', 'POST', { session: String(sessionId), project }))
      if (!live.current) return
      setName('')
      setPath('')
    } catch (failure) {
      if (!live.current) return
      const field = refusedField(failure)
      setAddError(failure instanceof RequestError && failure.status === 409 ? t('projectConflict')
        : field === 'name' ? t('projectNameInvalid') : field === 'path' ? t('projectPathInvalid') : t('projectAddFailed'))
    } finally {
      if (live.current) setWrote(false)
    }
  }
  const remove = async (project: string) => {
    setRemoving(project)
    setRemoveError(undefined)
    try {
      const next = await change(() => request(`conversation/projects/${encodeURIComponent(project)}?session=${encodeURIComponent(String(sessionId))}`, 'DELETE'))
      if (!live.current) return
      // Keep keyboard focus in the panel: the removed row's button is gone, so move to the row that took its place.
      const index = Math.max(0, value?.projects.findIndex(item => item.name === project) ?? 0)
      const target = next.projects[Math.min(index, next.projects.length - 1)]
      requestAnimationFrame(() => {
        if (target) panel.current?.querySelector<HTMLButtonElement>(`button[data-project="${target.name}"]`)?.focus()
        else first.current?.focus()
      })
    } catch (failure) {
      if (!live.current) return
      // A project another panel removed is already gone; show the registry as it is instead of a repeated failure.
      if (failure instanceof RequestError && failure.status === 404) {
        try { await change(() => request(`conversation?session=${encodeURIComponent(String(sessionId))}`)) }
        catch { /* The poll keeps the last known registry. */ }
        return
      }
      setRemoveError(failure instanceof RequestError && failure.status === 409 ? t('projectConflict') : t('projectRemoveFailed'))
    } finally {
      if (live.current) setRemoving(undefined)
    }
  }
  if (!value?.master) return null
  const toggle = () => { setOpen(!open); setAddError(undefined); setRemoveError(undefined) }
  const manage = <button ref={trigger} type="button" className="dt-project-manage" aria-label={t('projectManage')}
    title={t('projectManage')} aria-haspopup="dialog" aria-expanded={open} aria-controls="dsh-superagent-project-panel" onClick={toggle}>
    <Icon name="settings" size={14} />
  </button>
  return <span className="dt-project-seat" ref={seat}>
    <style>{STYLES}</style>
    {value.projects.length === 0
      ? <button ref={trigger} type="button" className="dt-project-addbtn" aria-haspopup="dialog" aria-expanded={open}
        aria-controls="dsh-superagent-project-panel" onClick={toggle}><Icon name="plus" size={14} />{t('projectAdd')}</button>
      : <>
        <span className="dt-project-label" aria-hidden>{t('projectLabel')}</span>
        <select className="dt-project-select" aria-label={t('projectTarget')} title={t('projectTarget')}
          value={value.selected ?? ''} disabled={busy}
          onChange={event => { void choose(event.target.value) }}>
          <option value="">{t('projectNone')}</option>
          {value.projects.map(project => <option key={project.name} value={project.name}>{project.name}</option>)}
        </select>
        {manage}
      </>}
    {failed && <span className="dt-project-error" role="status">{t('projectSaveFailed')}</span>}
    {open && at && createPortal(<div ref={panel} id="dsh-superagent-project-panel" className="dt-project-pop"
      role="dialog" aria-label={t('projectManage')} style={{ left: at.left, bottom: at.bottom, maxHeight: at.maxHeight }}>
      <div className="dt-project-pop-head">
        <span className="dt-project-pop-title">{t('projectManage')}</span>
        <button type="button" className="dt-project-iconbtn" aria-label={t('close')} onClick={() => { setOpen(false); trigger.current?.focus() }}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <p className="dt-project-hint">{t('projectManageHint')}</p>
      <ul className="dt-project-list">
        {value.projects.length === 0
          ? <li className="dt-project-hint">{t('projectNoneRegistered')}</li>
          : value.projects.map(project => <li key={project.name} className="dt-project-row">
            <span className="dt-project-row-main">
              <span className="dt-project-row-name">{project.name}</span>
              <span className="dt-project-row-path" title={project.path}>{project.path}</span>
            </span>
            <button type="button" className="dt-project-iconbtn dt-project-remove" data-project={project.name}
              disabled={removing === project.name} aria-label={t('projectRemoveLabel', { name: project.name })} title={t('projectRemove')}
              onClick={() => { void remove(project.name) }}><Icon name="trash" size={14} /></button>
          </li>)}
      </ul>
      <form className="dt-project-form" onSubmit={event => { void add(event) }}>
        <label className="dt-project-field">{t('projectName')}
          <input ref={first} className="dt-project-input" value={name} placeholder="webapp" spellCheck={false} required
            maxLength={40} onChange={event => { setName(event.target.value); setAddError(undefined) }} />
        </label>
        <label className="dt-project-field">{t('projectPath')}
          <input className="dt-project-input dt-project-path" value={path} placeholder="https://github.com/me/webapp"
            spellCheck={false} required onChange={event => { setPath(event.target.value); setAddError(undefined) }} />
        </label>
        {addError && <p className="dt-project-error" role="alert">{addError}</p>}
        <button type="submit" className="dt-project-submit" disabled={wrote || !name.trim() || !path.trim()}>{t('projectAddSubmit')}</button>
      </form>
      {removeError && <p className="dt-project-error" role="alert">{removeError}</p>}
    </div>, document.body)}
  </span>
}
