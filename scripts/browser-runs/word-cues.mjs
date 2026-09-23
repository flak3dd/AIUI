/**
 * Word cues the agent reads in user text. A cue is a necessary trigger:
 * without it, headed browser tools must not start; with it, they must.
 *
 * Owned by the browser-runs / nl-command path — import from here or via
 * nl-command.mjs re-exports. Do not invent a second cue parser elsewhere.
 */

/** Cue table: id → whole-word patterns that share the same intent. */
export const WORD_CUES = Object.freeze([
  {
    id: 'automate',
    action: 'headed_browser',
    // Verb forms only — not "automatic" or noun-only "automation" (e.g. "explain automation").
    pattern: /\bautomate(?:s|d|ing)?\b/i,
    description: 'Start headed Playwright Chromium browser automation via nl_automate / browser tools',
  },
])

export const WORD_CUE_SYSTEM_RULE = `Word cues (necessary triggers): The word "automate" (or automates/automating/automated as the same intent) is required to start headed browser automation. Without that cue, do not call nl_automate or browser_* tools and do not open a browser. With that cue, you must actually invoke nl_automate / open headed Playwright Chromium — do not only mention automation. Keep the origin allowlist; if the prompt names a URL whose origin is not allowlisted, refuse that navigation and say the origin is not allowlisted. Do not use Puppeteer, do not attach the daily Chrome profile, do not store cookies or screenshots in MemPalace, and do not treat HTTP 200 as proof. Never automate signup, login, CAPTCHA, or checkout.`

export function detectWordCues(text) {
  const raw = String(text || '')
  return WORD_CUES.filter((cue) => cue.pattern.test(raw)).map((cue) => ({
    id: cue.id,
    action: cue.action,
    description: cue.description,
  }))
}

export function hasWordCue(text, cueId = 'automate') {
  return detectWordCues(text).some((cue) => cue.id === cueId)
}

export function extractNamedHttpUrls(text) {
  const matches = String(text || '').matchAll(/\bhttps?:\/\/[^\s"'<>]+/gi)
  const urls = []
  for (const m of matches) {
    urls.push(m[0].replace(/[.,);:\]]+$/g, ''))
  }
  return urls
}

export function stripAutomateCue(text) {
  return String(text || '')
    .replace(/\bautomate(?:s|d|ing)?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Forbidden browser intents — refuse even when the automate cue is present. */
export function isForbiddenBrowserIntent(text) {
  return /\b(sign[\s-]?ups?|log[\s-]?ins?|captchas?|checkouts?)\b/i.test(String(text || ''))
}

/** Process-local turn gate so browser tools stay blocked unless a cue was seen. */
let sessionBrowserCueActive = false

export function setSessionBrowserCue(active) {
  sessionBrowserCueActive = active === true
}

export function isSessionBrowserCueActive() {
  return sessionBrowserCueActive
}

/** Update the session gate from raw user text (does not start the browser). */
export function syncSessionBrowserCueFromText(text) {
  const active = hasWordCue(text, 'automate')
  setSessionBrowserCue(active)
  return active
}
