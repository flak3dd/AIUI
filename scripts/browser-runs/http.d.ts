declare module './scripts/browser-runs/http.mjs' {
  export function handleBrowserRunsRequest(req: unknown, res: unknown): Promise<void>
  export function isBrowserRunsLocalRequest(req: unknown): boolean
}
