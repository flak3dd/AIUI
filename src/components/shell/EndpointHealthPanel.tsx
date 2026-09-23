import { useCallback, useEffect, useState } from 'react'
import { fetchWithRetry } from '../../lib/resilientFetch.ts'

type EndpointRow = {
  id: string
  name: string
  url: string
  up: boolean
  status: number
  ms: number
  via?: 'primary' | 'backup'
  attempts?: number
  error?: string
}

type ActionName = 'start' | 'stop' | 'heal'

export function EndpointHealthPanel() {
  const [rows, setRows] = useState<EndpointRow[]>([])
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [note, setNote] = useState('')

  const refresh = useCallback(async () => {
    try {
      const res = await fetchWithRetry('/api/endpoints/health', {}, { attempts: 3 })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setRows(json.endpoints || [])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Health check failed')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 4000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const act = async (id: string, action: ActionName) => {
    setBusyId(id)
    setNote('')
    try {
      const res = await fetch('/api/endpoints/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
      const json = await res.json()
      setNote(json.message || json.error || (json.ok ? 'Done' : 'Action failed'))
      await refresh()
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="endpoint-health">
      <div className="endpoint-health-head">
        <p className="hint">Live connectivity. Start brings a down service up. Heal restarts it. Stop is refused for this studio page.</p>
        <button type="button" className="ghost btn-sm" onClick={() => void refresh()}>Refresh</button>
      </div>
      {error && <p className="hint endpoint-health-error">{error}</p>}
      <ul className="endpoint-health-list">
        {rows.map((row) => (
          <li key={row.id} className={`endpoint-health-row ${row.up ? 'up' : 'down'}`}>
            <span className={`endpoint-dot ${row.up ? 'ok' : 'bad'}`} aria-hidden="true" />
            <div className="endpoint-health-meta">
              <strong>{row.name}</strong>
              <span>
                {row.up ? `Up${row.via === 'backup' ? ' via backup' : ''} · ${row.ms} ms` : `Down after ${row.attempts || 3} tries`}
                {' · '}
                {row.url.replace('http://', '')}
              </span>
            </div>
            <div className="endpoint-health-actions">
              <button type="button" className="btn-sm ghost" disabled={busyId === row.id} onClick={() => void act(row.id, 'start')}>Start</button>
              <button type="button" className="btn-sm ghost" disabled={busyId === row.id || row.id === 'studio'} onClick={() => void act(row.id, 'stop')}>Stop</button>
              <button type="button" className="btn-sm ghost" disabled={busyId === row.id} onClick={() => void act(row.id, 'heal')}>Heal</button>
            </div>
          </li>
        ))}
      </ul>
      {note && <p className="hint">{note}</p>}
    </div>
  )
}
