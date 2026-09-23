/**
 * CLI browser tools. Playwright-chromium only. No HTTP fallback and no host Chrome profile.
 * Sessions live in the supervisor and are closed before the next open.
 */
import { dispatchBrowserTool } from '../../../browser-runs/supervisor.mjs'

function asJson(result) {
  return JSON.stringify(result)
}

export async function browserOpenHandler(args) {
  return asJson(await dispatchBrowserTool('browser_open', args || {}))
}

export async function browserScreenshotHandler(args) {
  return asJson(await dispatchBrowserTool('browser_screenshot', args || {}))
}

export async function browserClickHandler(args) {
  const selector = typeof args === 'string' ? args : args?.selector
  return asJson(await dispatchBrowserTool('browser_click', { ...(args || {}), selector }))
}

export async function browserTypeHandler(args) {
  return asJson(await dispatchBrowserTool('browser_type', args || {}))
}

export async function browserConsoleLogsHandler(args) {
  return asJson(await dispatchBrowserTool('browser_console_logs', args || {}))
}

export const browser_open = browserOpenHandler
export const browser_screenshot = browserScreenshotHandler
export const browser_click = browserClickHandler
export const browser_type = browserTypeHandler
export const browser_console_logs = browserConsoleLogsHandler

export default {
  browser_open,
  browser_screenshot,
  browser_click,
  browser_type,
  browser_console_logs,
  browserOpenHandler,
  browserScreenshotHandler,
  browserClickHandler,
  browserTypeHandler,
  browserConsoleLogsHandler,
}
