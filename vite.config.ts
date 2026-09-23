import net from 'node:net'
import type { Connect } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const SPARK_LAN_HOST = '192.168.4.103'
const SPARK_TAILSCALE_HOST = '100.66.147.53'

function probePort(host: string, port: number, timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

async function pickSparkHost(preferred: string, port: number): Promise<string> {
  const hosts = [...new Set([preferred, SPARK_TAILSCALE_HOST, SPARK_LAN_HOST].filter(Boolean))]
  for (const host of hosts) {
    if (await probePort(host, port)) return host
  }
  return preferred
}

function isLoopbackRemote(addr: string | undefined): boolean {
  if (!addr) return false
  let a = addr.trim()
  if (a.startsWith('::ffff:')) a = a.slice(7)
  return a === '127.0.0.1' || a === '::1' || a === 'localhost'
}

function hostHeaderIsLocal(hostHeader: string | string[] | undefined): boolean {
  const raw = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader
  const host = String(raw || '')
    .trim()
    .toLowerCase()
    .split(':')[0]
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

function assertBrowserRunsLocal(req: IncomingMessage): boolean {
  const remote = req.socket?.remoteAddress
  if (remote) return isLoopbackRemote(remote)
  return hostHeaderIsLocal(req.headers?.host)
}

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const sparkPort = Number(env.VITE_SPARK_PORT || '8000') || 8000
  const preferred = env.VITE_SPARK_HOST || SPARK_LAN_HOST
  const sparkHost = await pickSparkHost(preferred, sparkPort)
  const sparkTarget = `http://${sparkHost}:${sparkPort}`
  console.log(`[vite] Spark vLLM proxy target ${sparkTarget} (LAN ${SPARK_LAN_HOST}, Tailscale ${SPARK_TAILSCALE_HOST})`)

  return {
    plugins: [
      react(),
      {
        name: 'browser-runs-api',
        configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
          server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
            if (!req.url?.startsWith('/api/browser-runs')) return next()
            if (!assertBrowserRunsLocal(req)) {
              res.statusCode = 403
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: 'browser-runs API is localhost-only' }))
              return
            }
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error JS module without adjacent types under nodenext
            const { handleBrowserRunsRequest } = await import('./scripts/browser-runs/http.mjs')
            await handleBrowserRunsRequest(req, res)
          })
        },
      },
      {
        name: 'agent-runs-api',
        configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
          server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
            if (!req.url?.startsWith('/api/agent-runs')) return next()
            // @ts-expect-error JS module without adjacent types under nodenext
            const { handleAgentRunsRequest } = await import('./scripts/agent-runs/http.mjs')
            await handleAgentRunsRequest(req, res)
          })
        },
      },
      {
        name: 'endpoints-api',
        configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
          server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
            if (!req.url?.startsWith('/api/endpoints')) return next()
            if (!assertBrowserRunsLocal(req)) {
              res.statusCode = 403
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: 'endpoints API is localhost-only' }))
              return
            }
            // @ts-expect-error JS module without adjacent types under nodenext
            const { handleEndpointsRequest } = await import('./scripts/endpoints/http.mjs')
            await handleEndpointsRequest(req, res)
          })
        },
      },
    ],
    server: {
      host: '127.0.0.1',
      proxy: {
        // Fixed per-NIC routes so the UI switch can stream one or both.
        '/vllm-lan': {
          target: `http://${SPARK_LAN_HOST}:${sparkPort}`,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/vllm-lan/, ''),
        },
        '/vllm-ts': {
          target: `http://${SPARK_TAILSCALE_HOST}:${sparkPort}`,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/vllm-ts/, ''),
        },
        // Legacy same-origin alias. Follows whichever NIC is actually listening.
        '/gx10-vllm': {
          target: sparkTarget,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/gx10-vllm/, ''),
        },
        '/spark-vllm': {
          target: sparkTarget,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/spark-vllm/, ''),
        },
        '/mempalace-bridge': {
          target: 'http://127.0.0.1:17333',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/mempalace-bridge/, ''),
        },
      },
    },
  }
})
