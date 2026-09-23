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
        name: 'agent-events',
        configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
          const events: { type: string; at: string; detail: unknown }[] = []
          server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
            if (!req.url?.startsWith('/api/agent-events')) return next()
            if (!assertBrowserRunsLocal(req)) {
              res.statusCode = 403
              res.end('localhost only')
              return
            }
            if (req.method === 'POST') {
              const chunks: Buffer[] = []
              for await (const chunk of req) chunks.push(Buffer.from(chunk))
              let detail: unknown = {}
              try {
                detail = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
              } catch {
                detail = {}
              }
              const type = typeof (detail as { type?: string }).type === 'string' ? (detail as { type: string }).type : 'agent:event'
              events.push({ type, at: new Date().toISOString(), detail })
              if (events.length > 50) events.shift()
              res.statusCode = 204
              res.end()
              return
            }
            res.statusCode = 200
            res.setHeader('Content-Type', 'text/event-stream')
            res.setHeader('Cache-Control', 'no-cache')
            for (const event of events) {
              res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
            }
            res.end()
          })
        },
      },
      {
        name: 'http-get-api',
        configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
          server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
            if (req.method !== 'POST' || !req.url?.startsWith('/api/http-get')) return next()
            if (!assertBrowserRunsLocal(req)) {
              res.statusCode = 403
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: 'http-get API is localhost-only' }))
              return
            }
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(Buffer.from(chunk))
            let body: { url?: string } = {}
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
            } catch {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
              return
            }
            const { httpGetJsonHandler } = await import('./scripts/aiui-agent/tools/handlers/utils.mjs')
            const result = await httpGetJsonHandler({ url: body.url })
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(result)
          })
        },
      },
      {
        name: 'pdf-ocr-api',
        configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
          server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
            if (req.method !== 'POST' || !req.url?.startsWith('/api/pdf-ocr')) return next()
            if (!assertBrowserRunsLocal(req)) {
              res.statusCode = 403
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: 'pdf-ocr API is localhost-only' }))
              return
            }
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(Buffer.from(chunk))
            let body: { path?: string; maxPages?: number; forceOcr?: boolean } = {}
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
            } catch {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
              return
            }
            const { extractPdf } = await import('./scripts/aiui-agent/tools/pdf-ocr.mjs')
            const result = await extractPdf(body.path, { maxPages: body.maxPages, forceOcr: body.forceOcr })
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(result))
          })
        },
      },
      {
        name: 'squad-support-api',
        configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
          // Seed Abliteration env from Vite loadEnv so the in-process queue uses the same keys as .env.example
          if (env.VITE_ABLITERATION_API_KEY && !process.env.VITE_ABLITERATION_API_KEY) {
            process.env.VITE_ABLITERATION_API_KEY = env.VITE_ABLITERATION_API_KEY
          }
          if (env.VITE_ABLITERATION_BASE_URL && !process.env.VITE_ABLITERATION_BASE_URL) {
            process.env.VITE_ABLITERATION_BASE_URL = env.VITE_ABLITERATION_BASE_URL
          }
          if (env.VITE_ABLITERATION_MODEL && !process.env.VITE_ABLITERATION_MODEL) {
            process.env.VITE_ABLITERATION_MODEL = env.VITE_ABLITERATION_MODEL
          }
          server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
            if (req.method !== 'POST' || !req.url?.startsWith('/api/squad-support')) return next()
            if (!assertBrowserRunsLocal(req)) {
              res.statusCode = 403
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: 'squad-support API is localhost-only' }))
              return
            }
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(Buffer.from(chunk))
            let body: { action?: string; task?: string; context?: string; taskId?: string } = {}
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
            } catch {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
              return
            }
            const { squadEnqueueHandler, squadCollectHandler } = await import(
              './scripts/aiui-agent/tools/squad-support.mjs'
            )
            const action = String(body.action || '').trim()
            let raw: string
            if (action === 'enqueue') {
              raw = squadEnqueueHandler({ task: body.task, context: body.context })
            } else if (action === 'collect') {
              raw = squadCollectHandler({ taskId: body.taskId })
            } else {
              raw = JSON.stringify({ ok: false, error: 'action must be enqueue or collect' })
            }
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(raw)
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
