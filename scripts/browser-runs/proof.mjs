/** A stored run counts only when an executor wrote these fields. HTTP 200 alone does not. */
export function isCountableBrowserRun(record) {
  if (!record || record.executorRan !== true) return false
  if (record.engine !== 'playwright-chromium') return false
  if (typeof record.finalUrl !== 'string' || !record.finalUrl) return false
  if (typeof record.httpStatus !== 'number') return false
  if (!record.domAssertion || record.domAssertion.ok !== true) return false
  if (typeof record.consoleErrorCount !== 'number') return false
  if (!record.screenshot || typeof record.screenshot.bytes !== 'number' || record.screenshot.bytes <= 0) return false
  const steps = Array.isArray(record.steps) ? record.steps : []
  const click = steps.find((step) => step.action === 'click')
  const typed = steps.find((step) => step.action === 'type')
  if (!click || click.ok !== true || click.engine !== 'playwright-chromium') return false
  if (!typed || typed.ok !== true || typed.engine !== 'playwright-chromium') return false
  return true
}

export function originOf(url) {
  const parsed = new URL(url)
  return parsed.origin
}

export function isOriginAllowlisted(url, allowlist, { operatorStarted = false } = {}) {
  let origin
  try {
    origin = originOf(url)
  } catch {
    return false
  }
  const listed = new Set(allowlist || [])
  if (listed.has(origin)) return true
  if (!operatorStarted) return false
  const host = new URL(origin).hostname
  return host === '127.0.0.1' || host === 'localhost'
}
