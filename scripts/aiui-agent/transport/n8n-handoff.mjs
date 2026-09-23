const N8N_WEBHOOK = process.env.N8N_INTAKE_URL || 'http://127.0.0.1:5678/webhook/durable-intake'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function handOffRun(record) {
  if (!record?.id) return { ok: false, error: 'No run record to hand off' }
  let lastError = 'n8n unreachable'
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(N8N_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: record.id,
          goal: record.goal,
          checkpoint: record.checkpoint,
          status: record.status,
        }),
        signal: AbortSignal.timeout(8000),
      })
      const text = await res.text()
      if (res.ok) return { ok: true, runId: record.id, body: text.slice(0, 300) }
      lastError = `n8n HTTP ${res.status}`
      if (res.status < 500) return { ok: false, error: lastError, body: text.slice(0, 300) }
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'n8n unreachable'
    }
    if (attempt < 3) await sleep(200 * attempt)
  }
  return { ok: false, error: lastError }
}
