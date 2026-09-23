import { dispatchBrowserTool, getAllowlistConfig } from './supervisor.mjs'
import { isOriginAllowlisted, originOf } from './proof.mjs'
import {
  WORD_CUES,
  WORD_CUE_SYSTEM_RULE,
  detectWordCues,
  hasWordCue,
  extractNamedHttpUrls,
  stripAutomateCue,
  isForbiddenBrowserIntent,
  setSessionBrowserCue,
  isSessionBrowserCueActive,
  syncSessionBrowserCueFromText,
} from './word-cues.mjs'

export {
  WORD_CUES,
  WORD_CUE_SYSTEM_RULE,
  detectWordCues,
  hasWordCue,
  extractNamedHttpUrls,
  stripAutomateCue,
  isForbiddenBrowserIntent,
  setSessionBrowserCue,
  isSessionBrowserCueActive,
  syncSessionBrowserCueFromText,
}

const STUDIO = 'http://127.0.0.1:5173/'

const THEME_VALUES = {
  dracula: 'dracula',
  nord: 'nord',
  'gruvbox dark': 'gruvbox',
  gruvbox: 'gruvbox',
  'catppuccin mocha': 'mocha',
  mocha: 'mocha',
  'tokyo night': 'tokyo',
  'solarized dark': 'solarized',
  'one dark': 'onedark',
  monokai: 'monokai',
  'rose pine': 'rose',
  'rosé pine': 'rose',
  'ayu dark': 'ayu',
  'github dark': 'github',
  horizon: 'horizon',
  matrix: 'matrix',
  synthwave: 'synth',
  'solarized light': 'solar-light',
  lumen: 'lumen',
}

function clickSelector(label) {
  const name = label.trim().replace(/["']/g, '')
  const key = name.toLowerCase()
  if (key === 'settings') return 'button[aria-label="Settings"]'
  if (key === 'health') return 'button[role="tab"]:has-text("Health")'
  return `button:has-text("${name}")`
}

function themeValue(label) {
  const key = label.trim().replace(/["']/g, '').toLowerCase()
  return THEME_VALUES[key] || key
}

export function parseNaturalLanguageCommand(instruction) {
  const clauses = String(instruction || '')
    .split(/\s*(?:,|\band then\b|\bthen\b|\band\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean)
  return clauses.map(parseClause)
}

function parseClause(text) {
  if (/open the (local )?studio/i.test(text)) return { action: 'open', url: STUDIO }
  if (/\b(local\s+)?proof\s+page\b/i.test(text)) return { action: 'open', url: STUDIO }
  const url = text.match(/\bopen\s+(https?:\/\/\S+)/i)
  if (url) return { action: 'open', url: url[1].replace(/[.,]$/, '') }
  const bareUrl = text.match(/^(https?:\/\/\S+)$/i)
  if (bareUrl) return { action: 'open', url: bareUrl[1].replace(/[.,]$/, '') }
  const tab = text.match(/(?:go to|open|switch to)\s+(?:the\s+)?(.+?)\s+tab/i)
  if (tab) return { action: 'click', selector: `button[role="tab"]:has-text("${tab[1].trim()}")`, label: tab[1].trim() }
  if (/\bhealth\b/i.test(text) && /\b(go to|open|show)\b/i.test(text)) {
    return { action: 'click', selector: clickSelector('Health'), label: 'Health' }
  }
  const click = text.match(/(?:click|press|open)\s+(?:the\s+)?["']?(.+?)["']?$/i)
  if (click && !/studio/i.test(click[1])) return { action: 'click', selector: clickSelector(click[1]), label: click[1].trim() }
  if (/read the (window )?title/i.test(text)) return { action: 'text', selector: '.term-title' }
  if (/(endpoint list|health panel|endpoint health)/i.test(text)) return { action: 'text', selector: '.endpoint-health' }
  const theme = text.match(/(?:change|set|switch)\s+the\s+(?:terminal\s+)?theme\s+to\s+(.+)/i)
  if (theme) {
    return { action: 'select', selector: 'select[aria-label="Terminal theme"]', value: themeValue(theme[1]) }
  }
  const typed = text.match(/type\s+["'](.+?)["']\s+into\s+(.+)/i)
  if (typed) return { action: 'type', selector: typed[2].trim(), text: typed[1] }
  return { action: 'unknown', text }
}

/**
 * Code-path enforcement for the "automate" word cue.
 * Starts headed Playwright Chromium via the browser-runs supervisor when the cue is present.
 * No-ops when the cue is absent. Refuses non-allowlisted named URLs and forbidden intents.
 */
export async function maybeRunAutomateCue(text, { allowlist } = {}) {
  const cues = detectWordCues(text)
  if (!cues.some((c) => c.id === 'automate')) {
    setSessionBrowserCue(false)
    return { triggered: false, started: false, cues: [], ok: true }
  }

  setSessionBrowserCue(true)

  if (isForbiddenBrowserIntent(text)) {
    return {
      triggered: true,
      started: false,
      cues,
      ok: false,
      error: 'Refusing signup, login, CAPTCHA, or checkout automation.',
    }
  }

  const config =
    allowlist != null
      ? Array.isArray(allowlist)
        ? { mode: 'list', origins: allowlist }
        : allowlist
      : getAllowlistConfig()
  const namedUrls = extractNamedHttpUrls(text)
  for (const url of namedUrls) {
    if (!isOriginAllowlisted(url, config, { operatorStarted: false })) {
      return {
        triggered: true,
        started: false,
        cues,
        ok: false,
        error: `Origin not allowlisted: ${originOf(url)}. Refusing that navigation.`,
        refusedUrl: url,
      }
    }
  }

  let instruction = stripAutomateCue(text)
  if (!instruction) instruction = 'open the local studio'

  // Prefer a real open step: if the stripped instruction does not parse to any open,
  // open the local studio headed so the cue still starts the browser.
  let plan = parseNaturalLanguageCommand(instruction)
  if (!plan.some((step) => step.action === 'open')) {
    if (namedUrls.length) {
      plan = [{ action: 'open', url: namedUrls[0] }, ...plan.filter((s) => s.action !== 'unknown')]
    } else if (/\b(local\s+)?proof\s+page\b/i.test(text) || /\bstudio\b/i.test(text)) {
      plan = [{ action: 'open', url: STUDIO }, ...plan.filter((s) => s.action !== 'unknown')]
    } else {
      plan = [{ action: 'open', url: STUDIO }, ...plan.filter((s) => s.action !== 'unknown')]
    }
  }

  const result = await runNaturalLanguageCommandPlan(plan)
  const opened = result.steps?.find((s) => s.action === 'open' && s.ok)
  return {
    triggered: true,
    started: result.ok === true || Boolean(result.sessionId),
    cues,
    ok: result.ok,
    sessionId: result.sessionId,
    url: opened?.detail || (plan.find((s) => s.action === 'open') || {}).url,
    text: result.text,
    steps: result.steps,
    error: result.ok ? undefined : result.error || result.steps?.find((s) => !s.ok)?.detail,
    engine: 'playwright-chromium',
    headless: false,
  }
}

async function runNaturalLanguageCommandPlan(plan) {
  if (!plan.length) return { ok: false, error: 'No command to run', steps: [] }
  let sessionId
  const steps = []
  for (const step of plan) {
    if (step.action === 'unknown') {
      steps.push({ ok: false, error: `Could not understand: ${step.text}` })
      break
    }
    let result
    if (step.action === 'open') {
      // Always headed (visible) for cue-driven automation — never Puppeteer, never daily profile.
      result = await dispatchBrowserTool('browser_open', { url: step.url, headless: false })
    } else if (step.action === 'click') {
      result = await dispatchBrowserTool('browser_click', { sessionId, selector: step.selector })
    } else if (step.action === 'type') {
      result = await dispatchBrowserTool('browser_type', { sessionId, selector: step.selector, text: step.text })
    } else if (step.action === 'select') {
      result = await dispatchBrowserTool('browser_select', { sessionId, selector: step.selector, value: step.value })
    } else {
      result = await dispatchBrowserTool('browser_text', { sessionId, selector: step.selector })
    }
    sessionId = result.sessionId || sessionId
    if (step.action === 'open' && result.ok) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const ready = await dispatchBrowserTool('browser_text', { sessionId, selector: 'button[aria-label="Settings"]' })
        if (ready.ok) break
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }
    if (step.action === 'text' && step.selector === '.endpoint-health' && result.ok && !/Spark vLLM/.test(result.text || '')) {
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        const again = await dispatchBrowserTool('browser_text', { sessionId, selector: step.selector })
        if (again.ok && /Spark vLLM/.test(again.text || '')) {
          result = again
          break
        }
      }
    }
    steps.push({
      action: step.action,
      ok: result.ok === true,
      detail: result.text || result.error || result.url || step.label || step.value || '',
    })
    if (!result.ok) break
  }
  const text = [...steps].reverse().find((step) => step.detail)?.detail || ''
  return { ok: steps.length > 0 && steps.every((step) => step.ok), sessionId, text, steps }
}

export async function runNaturalLanguageCommand(instruction) {
  const plan = parseNaturalLanguageCommand(instruction)
  return runNaturalLanguageCommandPlan(plan)
}
