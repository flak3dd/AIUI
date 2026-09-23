export const MAX_BROWSER_WINDOWS = 4

export type DurableBrowserRunStep = {
  action: string
  ok: boolean
  engine: string
  selector?: string
  error?: string
}

export type DurableBrowserRun = {
  id: string
  engine: string
  executorRan?: boolean
  finalUrl: string
  httpStatus: number
  domAssertion?: {
    ok?: boolean
    selector?: string
    actual?: string | null
    expected?: string
    reason?: string
  }
  consoleErrorCount: number
  screenshot?: { path?: string; bytes?: number }
  steps?: DurableBrowserRunStep[]
  countable?: boolean
  /** 'passed' | 'failed' from finished runs; 'running' while the session is live. */
  terminal?: string
  endedAt?: string
}

export type BrowserOpenResult = {
  ok: boolean
  error?: string
  url?: string
  status?: number
  engine?: string
  sessionId?: string
  maxSessions?: number
  activeSessions?: number
}

export async function fetchLatestBrowserRun(): Promise<DurableBrowserRun | null> {
  const res = await fetch('/api/browser-runs/latest')
  if (!res.ok) throw new Error(`browser runs HTTP ${res.status}`)
  const json = await res.json()
  return json.record ?? null
}

export async function fetchBrowserRunById(id: string): Promise<DurableBrowserRun | null> {
  const res = await fetch(`/api/browser-runs/latest?id=${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`browser runs HTTP ${res.status}`)
  const json = await res.json()
  return json.record ?? null
}

export async function runDurableBrowserProof(): Promise<{ ok: boolean; record?: DurableBrowserRun; error?: string }> {
  const res = await fetch('/api/browser-runs/proof', { method: 'POST' })
  const json = await res.json()
  return json
}

export async function openAllowlistedPage(url: string): Promise<BrowserOpenResult> {
  const res = await fetch('/api/browser-runs/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'browser_open', arguments: { url } }),
  })
  return res.json()
}

export async function closeBrowserSession(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/browser-runs/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'browser_close', arguments: { sessionId } }),
  })
  return res.json()
}

/** Stored Playwright screenshot for a specific run/session id (not an iframe capture). */
export function latestScreenshotUrl(runId?: string): string {
  if (runId) return `/api/browser-runs/screenshot?id=${encodeURIComponent(runId)}`
  return `/api/browser-runs/screenshot`
}
