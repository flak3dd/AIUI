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

/** Normalize allowlist arg: string[] (finite list) or { mode, origins }. */
export function normalizeAllowlist(allowlist) {
  if (Array.isArray(allowlist)) {
    return { mode: 'list', origins: allowlist }
  }
  if (allowlist && typeof allowlist === 'object') {
    const mode = allowlist.mode === 'all' ? 'all' : 'list'
    const origins = Array.isArray(allowlist.origins) ? allowlist.origins : []
    return { mode, origins }
  }
  return { mode: 'list', origins: [] }
}

function ipv4Octets(hostname) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!m) return null
  const octets = m.slice(1).map(Number)
  if (octets.some((n) => n > 255)) return null
  return octets
}

/** True when hostname is loopback, private, link-local, .local, or CGNAT — not a public website. */
export function isPrivateOrLocalHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') return true
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()

  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  if (host.endsWith('.local')) return true

  const v4 = ipv4Octets(host)
  if (v4) {
    const [a, b] = v4
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    return false
  }

  // IPv4-mapped IPv6 (:ffff:x.x.x.x)
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(host)
  if (mapped) return isPrivateOrLocalHostname(mapped[1])

  // IPv6 unique-local / link-local
  if (host.includes(':')) {
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true
    return false
  }

  return false
}

export function isPublicWebsiteHostname(hostname) {
  return !isPrivateOrLocalHostname(hostname)
}

function isOperatorLocalHost(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost'
}

/** Build a Set of scheme+host+port origins from allowlist entries (ignore path/hash/trailing slash). */
function listedOriginSet(origins) {
  const listed = new Set()
  for (const entry of origins || []) {
    if (typeof entry !== 'string' || !entry) continue
    try {
      listed.add(new URL(entry).origin)
    } catch {
      // skip malformed allowlist entries
    }
  }
  return listed
}

/**
 * Allowlist gate for browser_open / unattended navigation.
 * - mode "all": any http(s) public website hostname, PLUS any origin explicitly listed
 *   in allowlist.origins (including loopback/localhost; match scheme+host+port, ignore path/hash)
 * - mode "list" (default): exact origin must be in allowlist.origins
 * - Still refuses file:, user:pass URLs, and unlisted private/loopback hosts
 * - operatorStarted: also allows localhost / 127.0.0.1 even when not listed
 */
export function isOriginAllowlisted(url, allowlist, { operatorStarted = false } = {}) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.username || parsed.password) return false
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

  const { mode, origins } = normalizeAllowlist(allowlist)
  const origin = parsed.origin
  const host = parsed.hostname
  const listed = listedOriginSet(origins)

  if (listed.has(origin)) return true

  if (mode === 'all') {
    if (isPublicWebsiteHostname(host)) return true
    if (operatorStarted && isOperatorLocalHost(host)) return true
    return false
  }

  if (!operatorStarted) return false
  return isOperatorLocalHost(host)
}
