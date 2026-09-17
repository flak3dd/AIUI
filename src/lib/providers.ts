export type ProviderId = 'featherless' | 'abliteration' | 'spark'

/** Reactive rain mood mode. auto = derive from conversation, off = static, manual = user-picked. */
export type RainMode = 'auto' | 'off' | 'manual'

export interface ProviderConfig {
  id: ProviderId
  name: string
  baseUrl: string
  apiKey: string
  /** Local Spark / vLLM does not require a cloud API key. */
  requiresApiKey: boolean
}

export const FEATHERLESS_DIRECT_BASE = 'https://api.featherless.ai/v1'
/** Local cloud-key-proxy — injects FEATHERLESS_API_KEY server-side (avoids browser Cloudflare 1010). */
export const FEATHERLESS_PROXY_BASE = 'http://127.0.0.1:17332/featherless/v1'

export function usesCloudKeyProxy(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl)
    const hostOk = u.hostname === '127.0.0.1' || u.hostname === 'localhost'
    return hostOk && u.port === '17332' && /\/(featherless|abliteration)(\/|$)/.test(u.pathname)
  } catch {
    return false
  }
}

export const FEATHERLESS_PREFER = [
  'Qwen/Qwen2.5-7B-Instruct',
  'mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated',
  'Qwen/Qwen2.5-32B-Instruct',
  'Qwen/Qwen2.5-72B-Instruct',
  'mistralai/Mistral-Small-24B-Instruct-2501',
  'mistralai/Mistral-7B-Instruct-v0.3',
  'huihui-ai/Llama-3.3-70B-Instruct-abliterated',
  'Qwen/Qwen2.5-Coder-32B-Instruct',
  'Qwen/QwQ-32B',
  'Qwen/Qwen3-32B',
  'Qwen/Qwen3-235B-A22B',
  'deepseek-ai/DeepSeek-V3.2',
  'deepseek-ai/DeepSeek-R1-0528',
  'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
  'mistralai/Mistral-Large-Instruct-2411',
  'microsoft/phi-4',
  'NousResearch/Hermes-3-Llama-3.1-70B',
  'Sao10K/L3-8B-Stheno-v3.2',
  'Undi95/Meta-Llama-3.1-8B-Instruct-OAS',
  'nvidia/Llama-3.1-Nemotron-70B-Instruct-HF',
]

/** Official Meta/Gemma IDs that need HuggingFace OAuth on Featherless. */
export const FEATHERLESS_GATED_PREFER = [
  'meta-llama/Meta-Llama-3.1-8B-Instruct',
  'meta-llama/Meta-Llama-3.1-70B-Instruct',
  'meta-llama/Llama-3.3-70B-Instruct',
  'meta-llama/Llama-3.2-3B-Instruct',
  'google/gemma-3-27b-it',
]

export const UNGATED_ALTERNATIVE: Record<string, string> = {
  'meta-llama/Meta-Llama-3.1-8B-Instruct': 'mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated',
  'meta-llama/Meta-Llama-3.1-70B-Instruct': 'huihui-ai/Llama-3.3-70B-Instruct-abliterated',
  'meta-llama/Llama-3.3-70B-Instruct': 'huihui-ai/Llama-3.3-70B-Instruct-abliterated',
  'meta-llama/Llama-3.2-3B-Instruct': 'Qwen/Qwen2.5-7B-Instruct',
  'google/gemma-3-27b-it': 'Qwen/Qwen2.5-32B-Instruct',
}

export function isGatedModelId(id: string): boolean {
  if (!id) return false
  if (FEATHERLESS_GATED_PREFER.includes(id)) return true
  // Meta official orgs require HF oauth on featherless
  if (id.startsWith('meta-llama/') && !id.includes('abliterated')) return true
  return false
}

export const ABLITERATION_PREFER = [
  'abliterated-model',
  'abliterated-model-large',
  'abliterated-model-large-v2',
]

/** GX10 / vLLM served model ids (Qwen3.6-35B-A3B Abliterated NVFP4+MTP). */
export const SPARK_PREFER = ['qwen-abliterated']

/** Friendly labels for the model picker (ids still sent to the API). */
export const MODEL_LABELS: Record<string, string> = {
  'qwen-abliterated': 'Qwen3.6-35B-A3B Abliterated NVFP4+MTP',
  'qwen-flash': 'Qwen3.6-35B-A3B Abliterated NVFP4+MTP (alias → qwen-abliterated)',
}

export function modelLabel(id: string): string {
  return MODEL_LABELS[id] || id
}

export const SPARK_DEFAULT_HOST = '192.168.4.103'
export const SPARK_DEFAULT_PORT = 8000

const STORAGE_KEY = 'abliterated_web_api_settings_v1'

import type { AbliterationLevel, LaserMode } from './abliterationLevel'
export type { AbliterationLevel, LaserMode } from './abliterationLevel'

export interface StoredSettings {
  provider: ProviderId
  featherlessBaseUrl: string
  featherlessApiKey: string
  abliterationBaseUrl: string
  abliterationApiKey: string
  /** Spark LAN host (no scheme), e.g. 192.168.4.103 */
  sparkHost: string
  sparkPort: number
  /**
   * When true (default), browser on localhost / LAN uses cloud-key-proxy
   * http://127.0.0.1:17332/spark/<host>/<port>/v1 — same pattern as Expo web.
   */
  sparkUseProxy: boolean
  /** Optional; Spark/vLLM usually needs none. */
  sparkApiKey: string
  model: string
  agentMode: boolean
  deepBuild: boolean
  clusterRag?: boolean
  temperature?: number
  maxTokens?: number
  agentMaxRounds?: number
  customSystemPrompt?: string
  rainMode?: RainMode
  rainMoodManual?: string
  laserMode?: LaserMode
  laserLevelManual?: AbliterationLevel
  workspaceDir?: string
}

/**
 * Resolve OpenAI-compatible /v1 base for Spark.
 * Prefer :17332/spark/... proxy when the page is localhost/LAN http (CORS / Firefox LNA).
 */
export function resolveSparkBaseUrl(
  host: string,
  port: number,
  useProxy = true,
): string {
  const h = String(host || SPARK_DEFAULT_HOST)
    .trim()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0]
  const p = Number(port) > 0 ? Number(port) : SPARK_DEFAULT_PORT

  if (typeof window !== 'undefined' && useProxy) {
    const pageHost = window.location.hostname || ''
    const protocol = window.location.protocol || ''
    const pagePort = window.location.port || ''
    const envHost = import.meta.env.VITE_SPARK_HOST || SPARK_DEFAULT_HOST
    const envPort =
      Number(import.meta.env.VITE_SPARK_PORT || SPARK_DEFAULT_PORT) || SPARK_DEFAULT_PORT
    // Vite same-origin proxy when settings match vite.config.ts target
    if (
      protocol === 'http:' &&
      (pageHost === 'localhost' || pageHost === '127.0.0.1') &&
      (pagePort === '5173' || pagePort === '5174' || pagePort === '') &&
      h === envHost &&
      p === envPort
    ) {
      return `${window.location.origin}/spark-vllm/v1`
    }
    // Expo-style cloud-key-proxy (supports arbitrary host/port in the path)
    if (protocol === 'http:' && (pageHost === 'localhost' || pageHost === '127.0.0.1')) {
      return `http://127.0.0.1:17332/spark/${h}/${p}/v1`
    }
    if (
      protocol === 'http:' &&
      (pageHost.startsWith('192.168.') ||
        pageHost.startsWith('10.') ||
        pageHost.endsWith('.local'))
    ) {
      return `http://${pageHost}:17332/spark/${h}/${p}/v1`
    }
  }

  return `http://${h}:${p}/v1`
}

export function defaultSettings(): StoredSettings {
  const sparkHost =
    import.meta.env.VITE_SPARK_HOST || SPARK_DEFAULT_HOST
  const sparkPort = Number(import.meta.env.VITE_SPARK_PORT || SPARK_DEFAULT_PORT) || SPARK_DEFAULT_PORT
  const provider =
    (import.meta.env.VITE_DEFAULT_PROVIDER as ProviderId) || 'spark'
  return {
    provider,
    featherlessBaseUrl:
      import.meta.env.VITE_FEATHERLESS_BASE_URL || FEATHERLESS_PROXY_BASE,
    featherlessApiKey: import.meta.env.VITE_FEATHERLESS_API_KEY || '',
    abliterationBaseUrl:
      import.meta.env.VITE_ABLITERATION_BASE_URL || 'https://api.abliteration.ai/v1',
    abliterationApiKey: import.meta.env.VITE_ABLITERATION_API_KEY || '',
    sparkHost,
    sparkPort,
    sparkUseProxy: import.meta.env.VITE_SPARK_USE_PROXY !== 'false',
    sparkApiKey: import.meta.env.VITE_SPARK_API_KEY || '',
    model:
      provider === 'spark'
        ? SPARK_PREFER[0]
        : provider === 'abliteration'
          ? ABLITERATION_PREFER[0]
          : FEATHERLESS_PREFER[0],
    agentMode: false,
    deepBuild: false,
    clusterRag: true,
    temperature: 0.7,
    maxTokens: 4096,
    agentMaxRounds: 8,
    rainMode: 'auto',
    rainMoodManual: 'focus',
    laserMode: 'auto',
    laserLevelManual: 3,
    workspaceDir: '/Users/adminuser/AIUI',
  }
}

export function loadSettings(): StoredSettings {
  const base = defaultSettings()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const parsed = { ...base, ...JSON.parse(raw) } as StoredSettings
    if (typeof parsed.sparkPort === 'string') {
      parsed.sparkPort = Number(parsed.sparkPort) || SPARK_DEFAULT_PORT
    }
    // Prefer local cloud-key-proxy over direct Featherless (CF 1010 on some clients)
    if (
      !parsed.featherlessBaseUrl ||
      parsed.featherlessBaseUrl === FEATHERLESS_DIRECT_BASE ||
      parsed.featherlessBaseUrl === 'https://api.featherless.ai' ||
      parsed.featherlessBaseUrl.replace(/\/$/, '') === FEATHERLESS_DIRECT_BASE
    ) {
      parsed.featherlessBaseUrl = FEATHERLESS_PROXY_BASE
    }
    // Auto-migrate away from gated Meta/Gemma defaults that 403 without HF OAuth
    if (
      parsed.provider === 'featherless' &&
      FEATHERLESS_GATED_PREFER.includes(parsed.model)
    ) {
      parsed.model = FEATHERLESS_PREFER[0]
    }
    return parsed
  } catch {
    return base
  }
}

export function saveSettings(s: StoredSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

export function activeProvider(s: StoredSettings): ProviderConfig {
  if (s.provider === 'spark') {
    return {
      id: 'spark',
      name: 'Spark Qwen3.6-35B-A3B Abliterated NVFP4+MTP',
      baseUrl: resolveSparkBaseUrl(s.sparkHost, s.sparkPort, s.sparkUseProxy).replace(/\/$/, ''),
      apiKey: s.sparkApiKey || '',
      requiresApiKey: false,
    }
  }
  if (s.provider === 'abliteration') {
    return {
      id: 'abliteration',
      name: 'Abliteration',
      baseUrl: s.abliterationBaseUrl.replace(/\/$/, ''),
      apiKey: s.abliterationApiKey,
      requiresApiKey: true,
    }
  }
  const featherBase = s.featherlessBaseUrl.replace(/\/$/, '')
  const viaProxy = usesCloudKeyProxy(featherBase)
  return {
    id: 'featherless',
    name: viaProxy ? 'Featherless (via proxy)' : 'Featherless',
    baseUrl: featherBase,
    apiKey: s.featherlessApiKey,
    // Proxy injects FEATHERLESS_API_KEY; browser key optional
    requiresApiKey: !viaProxy,
  }
}

/** Native OpenAI tool_calls / tool_choice — Spark vLLM only (needs --enable-auto-tool-choice). */
export function providerSupportsNativeTools(provider: ProviderId): boolean {
  return provider === 'spark'
}

export function preferFor(provider: ProviderId): string[] {
  if (provider === 'abliteration') return ABLITERATION_PREFER
  if (provider === 'spark') return SPARK_PREFER
  return FEATHERLESS_PREFER
}

export function mergeCatalog(provider: ProviderId, ids: string[]): string[] {
  const prefer = preferFor(provider)
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [...prefer, ...ids]) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out.slice(0, 250)
}
