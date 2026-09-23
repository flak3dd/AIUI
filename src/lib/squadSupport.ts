/**
 * Studio client for the async Abliteration support queue.
 *
 * Browser never calls api.abliteration.ai directly — all traffic goes through
 * the localhost Vite middleware `/api/squad-support` (same pattern as /api/http-get).
 *
 * Documented API (from src/lib/providers.ts + .env.example):
 *   base: https://api.abliteration.ai/v1
 *   path: /chat/completions
 *   auth env: VITE_ABLITERATION_API_KEY
 */

export const SQUAD_SUPPORT_MAX_CONTEXT_CHARS = 100_000
export const SQUAD_SUPPORT_MAX_RESULT_CHARS = 8_000
export const SQUAD_SUPPORT_MAX_IN_FLIGHT = 3

export type SquadEnqueueResult = {
  ok: boolean
  taskId?: string
  status?: string
  note?: string
  error?: string
}

export type SquadCollectResult = {
  ok: boolean
  taskId?: string
  status?: 'pending' | 'done' | 'error' | string
  pending?: boolean
  result?: string
  error?: string
}

/** Heuristic refusal for secret-looking payloads (mirrors CLI module). */
export function looksLikeSecretMaterial(text: string): boolean {
  const s = String(text || '')
  if (!s) return false
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(s)) return true
  if (/-----BEGIN PRIVATE KEY-----/.test(s)) return true
  if (/\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|password)\s*[:=]\s*\S+/i.test(s)) return true
  if (/\b(?:sk|pk|rk|ak)[_-][A-Za-z0-9]{16,}\b/.test(s)) return true
  if (/\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/.test(s)) return true
  if (/VITE_ABLITERATION_API_KEY\s*=\s*\S+/.test(s)) return true
  if (/FEATHERLESS_API_KEY\s*=\s*\S+/.test(s)) return true
  return false
}

export function validateSquadSupportPayload(
  task: unknown,
  context: unknown = '',
): { ok: true; task: string; context: string } | { ok: false; error: string } {
  const t = String(task || '').trim()
  const c = String(context || '')
  if (!t) return { ok: false, error: 'task is required' }
  if (t.length + c.length > SQUAD_SUPPORT_MAX_CONTEXT_CHARS) {
    return {
      ok: false,
      error: `Refused: combined task+context exceeds ${SQUAD_SUPPORT_MAX_CONTEXT_CHARS} characters.`,
    }
  }
  if (looksLikeSecretMaterial(t) || looksLikeSecretMaterial(c)) {
    return {
      ok: false,
      error:
        'Refused: payload looks like it contains an API key, password, or private key. Do not send secrets to squad_enqueue.',
    }
  }
  return { ok: true, task: t, context: c }
}

async function postSquadSupport(
  action: 'enqueue' | 'collect',
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch('/api/squad-support', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  })
  const payload = await res.json().catch(() => null)
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'squad-support proxy returned a non-JSON body' }
  }
  return payload as Record<string, unknown>
}

/** Studio enqueue via localhost Node proxy — returns task id immediately. */
export async function squadEnqueueViaProxy(args: {
  task: string
  context?: string
}): Promise<SquadEnqueueResult> {
  const validated = validateSquadSupportPayload(args.task, args.context)
  if (!validated.ok) return { ok: false, error: validated.error }
  try {
    const row = await postSquadSupport('enqueue', {
      task: validated.task,
      context: validated.context,
    })
    return {
      ok: Boolean(row.ok),
      ...(typeof row.taskId === 'string' ? { taskId: row.taskId } : {}),
      ...(typeof row.status === 'string' ? { status: row.status } : {}),
      ...(typeof row.note === 'string' ? { note: row.note } : {}),
      ...(typeof row.error === 'string' ? { error: row.error } : {}),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'squad_enqueue failed'
    return {
      ok: false,
      error:
        message.includes('NetworkError') ||
        message.includes('Failed to fetch') ||
        message.includes('Load failed')
          ? 'The browser could not reach /api/squad-support. Restart the Studio dev server and try again.'
          : message,
    }
  }
}

/** Studio collect via localhost Node proxy. */
export async function squadCollectViaProxy(args: {
  taskId: string
}): Promise<SquadCollectResult> {
  const taskId = String(args.taskId || '').trim()
  if (!taskId) return { ok: false, error: 'taskId is required' }
  try {
    const row = await postSquadSupport('collect', { taskId })
    return {
      ok: Boolean(row.ok),
      ...(typeof row.taskId === 'string' ? { taskId: row.taskId } : {}),
      ...(typeof row.status === 'string' ? { status: row.status } : {}),
      ...(typeof row.pending === 'boolean' ? { pending: row.pending } : {}),
      ...(typeof row.result === 'string' ? { result: row.result } : {}),
      ...(typeof row.error === 'string' ? { error: row.error } : {}),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'squad_collect failed'
    return {
      ok: false,
      error:
        message.includes('NetworkError') ||
        message.includes('Failed to fetch') ||
        message.includes('Load failed')
          ? 'The browser could not reach /api/squad-support. Restart the Studio dev server and try again.'
          : message,
    }
  }
}
