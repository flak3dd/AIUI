#!/usr/bin/env node
/** Live natural-language web tasks against the allowlisted studio. */
const UI = process.env.AIUI_UI_URL || 'http://127.0.0.1:5173'

async function tool(name, arguments_) {
  const res = await fetch(`${UI}/api/browser-runs/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, arguments: arguments_ }),
  })
  const json = await res.json()
  return json
}

const tasks = [
  {
    say: 'Open the local studio and read the window title.',
    async run(sessionId) {
      const opened = await tool('browser_open', { url: `${UI}/` })
      if (!opened.ok) return { ok: false, detail: opened.error, sessionId }
      const title = await tool('browser_text', { sessionId: opened.sessionId, selector: '.term-title' })
      const text = title.text || ''
      return { ok: title.ok && text.trim().length > 0, detail: text.trim(), sessionId: opened.sessionId }
    },
  },
  {
    say: 'Open Settings, go to Health, and confirm the endpoint list is visible.',
    async run(sessionId) {
      const clicked = await tool('browser_click', { sessionId, selector: 'button[aria-label="Settings"]' })
      if (!clicked.ok) return { ok: false, detail: clicked.error, sessionId }
      const tab = await tool('browser_click', { sessionId, selector: 'button[role="tab"]:has-text("Health")' })
      if (!tab.ok) return { ok: false, detail: tab.error, sessionId }
      let text = ''
      let ok = false
      for (let attempt = 0; attempt < 8; attempt++) {
        const body = await tool('browser_text', { sessionId, selector: '.endpoint-health' })
        text = body.text || ''
        ok = body.ok && /Spark vLLM/.test(text) && /Key proxy/.test(text)
        if (ok) break
        await new Promise((resolve) => setTimeout(resolve, 700))
      }
      return { ok, detail: text.split('\n').filter(Boolean).slice(0, 10).join(' | '), sessionId }
    },
  },
  {
    say: 'Change the terminal theme to Dracula and confirm the menu shows it.',
    async run(sessionId) {
      const selected = await tool('browser_select', {
        sessionId,
        selector: 'select[aria-label="Terminal theme"]',
        value: 'dracula',
      })
      if (!selected.ok) return { ok: false, detail: selected.error, sessionId }
      const label = await tool('browser_text', { sessionId, selector: 'select[aria-label="Terminal theme"]' })
      const text = (label.text || '').trim()
      return { ok: label.ok && text === 'Dracula', detail: text, sessionId }
    },
  },
]

let sessionId
let failed = 0
for (const task of tasks) {
  const result = await task.run(sessionId)
  sessionId = result.sessionId || sessionId
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${task.say}`)
  console.log(`  ${result.detail || ''}`)
  if (!result.ok) failed += 1
}
if (sessionId) await tool('browser_close', { sessionId }).catch(() => {})
process.exit(failed ? 1 : 0)
