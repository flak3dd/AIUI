/**
 * Browser-side mirror of scripts/browser-runs/word-cues.mjs patterns.
 * Detection authority and tests live in nl-command / word-cues (Node).
 * This file only lets the Studio send path know whether to call the cue API
 * and gate browser tools — it must stay identical to WORD_CUES patterns.
 */

const AUTOMATE_CUE = /\bautomate(?:s|d|ing)?\b/i

export const WORD_CUE_SYSTEM_RULE =
  'Word cues (necessary triggers): The word "automate" (or automates/automating/automated as the same intent) is required to start headed browser automation. Without that cue, do not call nl_automate or browser_* tools and do not open a browser. With that cue, you must actually invoke nl_automate / open headed Playwright Chromium — do not only mention automation. Keep the origin allowlist; if the prompt names a URL whose origin is not allowlisted, refuse that navigation and say the origin is not allowlisted. Do not use Puppeteer, do not attach the daily Chrome profile, do not store cookies or screenshots in MemPalace, and do not treat HTTP 200 as proof. Never automate signup, login, CAPTCHA, or checkout.'

export function hasAutomateCue(text: string): boolean {
  return AUTOMATE_CUE.test(String(text || ''))
}

/** Turn-scoped gate for browser_* / nl_automate in the web agent tool runner. */
let turnBrowserCueActive = false

export function setTurnBrowserCue(active: boolean): void {
  turnBrowserCueActive = active === true
}

export function isTurnBrowserCueActive(): boolean {
  return turnBrowserCueActive
}

export type AutomateCueApiResult = {
  ok?: boolean
  triggered?: boolean
  started?: boolean
  sessionId?: string
  error?: string
  text?: string
  url?: string
  cues?: Array<{ id: string; action?: string }>
}

/** Code-path enforcement: POST user text to the single nl-command cue runner. */
export async function enforceAutomateCue(text: string): Promise<AutomateCueApiResult> {
  if (!hasAutomateCue(text)) {
    setTurnBrowserCue(false)
    return { ok: true, triggered: false, started: false }
  }
  try {
    const res = await fetch('/api/browser-runs/cue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    const json = (await res.json()) as AutomateCueApiResult
    setTurnBrowserCue(json.triggered === true)
    return json
  } catch (err) {
    setTurnBrowserCue(true)
    return {
      ok: false,
      triggered: true,
      started: false,
      error: err instanceof Error ? err.message : 'cue enforcement failed',
    }
  }
}
