function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: { attempts?: number; backups?: string[]; fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const attempts = options.attempts ?? 3
  const fetchImpl = options.fetchImpl ?? fetch
  const urls = [url, ...(options.backups ?? [])]
  let lastError: unknown
  for (const candidate of urls) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetchImpl(candidate, init)
        if (response.ok || response.status < 500 || attempt === attempts) return response
      } catch (err) {
        lastError = err
        if (attempt < attempts) await sleep(200 * attempt)
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Connection lost')
}
