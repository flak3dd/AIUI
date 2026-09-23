/**
 * Providers module - manages AI model providers, settings storage, endpoint routing,
 * and ProviderManager lifecycle supervision (initialization, health checks, failover).
 */

export type ProviderId = 'spark' | 'featherless' | 'abliteration';

export type SparkRoute = 'lan' | 'tailscale' | 'both';

export type RainMode = 'auto' | 'off' | 'manual';
export type LaserMode = 'auto' | 'off' | 'manual';

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  baseUrl: string;
  /** Tried in order when baseUrl refuses the connection or returns 502/503/504. */
  fallbackBaseUrls?: string[];
  /**
   * One chain per Spark NIC. Chains are opened together and the first
   * successful response is streamed. Each chain falls through its own URLs.
   */
  endpointGroups?: string[][];
  apiKey?: string;
  requiresApiKey: boolean;
}

export type ProviderStatus =
  | 'uninitialized'
  | 'initializing'
  | 'healthy'
  | 'degraded'
  | 'offline'
  | 'shutting_down';

export interface ProviderHealth {
  status: ProviderStatus;
  latencyMs?: number;
  lastChecked?: number;
  error?: string;
}

export interface ProviderEntry {
  name: string;
  provider: any;
  priority?: number;
  health: ProviderHealth;
}

/**
 * Enterprise ProviderManager with full lifecycle supervision, health monitoring, and automatic failover.
 */
export class ProviderManager {
  private providers: Map<string, ProviderEntry>;
  private activeProviderName: string = 'default';
  private listeners: Map<string, Set<Function>>;

  constructor() {
    this.providers = new Map();
    this.listeners = new Map();
  }

  register(name: string, provider: any, priority = 10): void {
    this.providers.set(name, {
      name,
      provider,
      priority,
      health: { status: 'uninitialized' },
    });
    if (this.providers.size === 1) {
      this.activeProviderName = name;
    }
    this.emit('registered', { name, provider });
  }

  unregister(name: string): boolean {
    const deleted = this.providers.delete(name);
    if (deleted && this.activeProviderName === name) {
      const next = this.providers.keys().next().value;
      this.activeProviderName = next || 'default';
    }
    return deleted;
  }

  async init(): Promise<void> {
    for (const [, entry] of this.providers.entries()) {
      entry.health.status = 'initializing';
      if (typeof entry.provider?.init === 'function') {
        try {
          await entry.provider.init();
          entry.health.status = 'healthy';
        } catch (err: any) {
          entry.health.status = 'degraded';
          entry.health.error = err.message;
        }
      } else {
        entry.health.status = 'healthy';
      }
      entry.health.lastChecked = Date.now();
    }
    this.emit('initialized', { count: this.providers.size });
  }

  async healthCheck(name?: string): Promise<Record<string, ProviderHealth>> {
    const targets = name
      ? ([this.providers.get(name)].filter(Boolean) as ProviderEntry[])
      : Array.from(this.providers.values());
    const results: Record<string, ProviderHealth> = {};

    for (const entry of targets) {
      const t0 = performance.now();
      try {
        if (typeof entry.provider?.healthCheck === 'function') {
          const healthy = await entry.provider.healthCheck();
          entry.health.status = healthy ? 'healthy' : 'degraded';
        } else if (entry.provider?.baseUrl) {
          const res = await fetch(`${entry.provider.baseUrl}/models`, {
            signal: AbortSignal.timeout(3000),
          });
          entry.health.status = res.ok ? 'healthy' : 'degraded';
        } else {
          entry.health.status = 'healthy';
        }
        entry.health.latencyMs = Math.round(performance.now() - t0);
        entry.health.error = undefined;
      } catch (err: any) {
        entry.health.status = 'offline';
        entry.health.latencyMs = Math.round(performance.now() - t0);
        entry.health.error = err.message;
      }
      entry.health.lastChecked = Date.now();
      results[entry.name] = { ...entry.health };
    }

    return results;
  }

  get(name: string): any {
    const entry = this.providers.get(name);
    if (entry && entry.health.status !== 'offline') {
      return entry.provider;
    }
    return this.getDefaultProvider();
  }

  getActive(): any {
    return this.get(this.activeProviderName);
  }

  getActiveName(): string {
    return this.activeProviderName;
  }

  setActive(name: string): boolean {
    if (this.providers.has(name)) {
      const prev = this.activeProviderName;
      this.activeProviderName = name;
      this.emit('active_changed', { from: prev, to: name });
      return true;
    }
    return false;
  }

  failover(failedName?: string): string | null {
    const current = failedName || this.activeProviderName;
    const currentEntry = this.providers.get(current);
    if (currentEntry) {
      currentEntry.health.status = 'degraded';
    }

    const candidates = Array.from(this.providers.values())
      .filter((e) => e.name !== current && e.health.status !== 'offline')
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    if (candidates.length > 0) {
      const next = candidates[0];
      this.activeProviderName = next.name;
      this.emit('failover', { from: current, to: next.name });
      return next.name;
    }

    return null;
  }

  async shutdown(): Promise<void> {
    for (const [, entry] of this.providers.entries()) {
      entry.health.status = 'shutting_down';
      if (typeof entry.provider?.shutdown === 'function') {
        try {
          await entry.provider.shutdown();
        } catch {}
      }
      entry.health.status = 'offline';
    }
    this.emit('shutdown', {});
  }

  getAll(): Map<string, any> {
    const map = new Map<string, any>();
    for (const [k, v] of this.providers.entries()) {
      map.set(k, v.provider);
    }
    return map;
  }

  getStatus(): Record<string, ProviderHealth> {
    const status: Record<string, ProviderHealth> = {};
    for (const [name, entry] of this.providers.entries()) {
      status[name] = { ...entry.health };
    }
    return status;
  }

  on(event: string, fn: Function): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  private emit(event: string, payload: any): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of set) {
        try {
          fn(payload);
        } catch {}
      }
    }
  }

  private getDefaultProvider(): any {
    const first = this.providers.values().next().value;
    return first?.provider || { type: 'default', enabled: true };
  }
}

// ------------------------------------------------------------------------------
// Settings & Provider Configuration (Preserving App.tsx Compatibility)
// ------------------------------------------------------------------------------

export const SPARK_DEFAULT_HOST = '192.168.4.103';
export const SPARK_DEFAULT_PORT = 8000;
/** Tailscale address of the same DGX. Used when the LAN NIC is unreachable. */
export const SPARK_TAILSCALE_HOST = '100.66.147.53';
/** Local cloud-key-proxy. Spark routes are /spark/<host>/<port>/v1. */
export const SPARK_KEY_PROXY_ORIGIN = 'http://127.0.0.1:17332';
export const FEATHERLESS_PROXY_BASE = 'http://127.0.0.1:17330/v1';

export const SPARK_PREFER = [
  'qwen-abliterated',
  'Qwen/Qwen2.5-Coder-32B-Instruct',
  'Qwen/Qwen2.5-32B-Instruct',
];

export const FEATHERLESS_PREFER = [
  'Qwen/Qwen2.5-Coder-32B-Instruct',
  'mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated',
];

export const FEATHERLESS_GATED_PREFER = [
  'meta-llama/Meta-Llama-3.1-8B-Instruct',
  'meta-llama/Meta-Llama-3.1-70B-Instruct',
];

export const ABLITERATION_PREFER = [
  'abliterated-model',
];

export const UNGATED_ALTERNATIVE: Record<string, string> = {
  'meta-llama/Meta-Llama-3.1-8B-Instruct': 'mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated',
  'meta-llama/Meta-Llama-3.1-70B-Instruct': 'mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated',
};

export interface StoredSettings {
  provider: ProviderId;
  featherlessBaseUrl: string;
  featherlessApiKey: string;
  abliterationBaseUrl: string;
  abliterationApiKey: string;
  sparkHost: string;
  sparkPort: number;
  sparkUseProxy: boolean;
  /** LAN only, Tailscale only, or both NICs raced for the first live stream. */
  sparkRoute: SparkRoute;
  sparkApiKey: string;
  model: string;
  agentMode: boolean;
  deepBuild: boolean;
  clusterRag?: boolean;
  temperature?: number;
  maxTokens?: number;
  agentMaxRounds?: number;
  customSystemPrompt?: string;
  rainMode?: string;
  rainMoodManual?: string;
  laserMode?: string;
  laserLevelManual?: number;
  workspaceDir?: string;
  /** When true (default), chat loop may pull response optimizer nudges/policy. */
  optimizeChatResponses?: boolean;
}

const STORAGE_KEY = 'aiui_settings_v1';

export function isGatedModelId(modelId: string): boolean {
  return FEATHERLESS_GATED_PREFER.includes(modelId);
}

export function modelLabel(modelId: string): string {
  if (!modelId) return 'Unknown';
  return modelId.split('/').pop() || modelId;
}

export function normalizeSparkHost(host: string): string {
  return String(host || SPARK_DEFAULT_HOST)
    .trim()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0];
}

function browserDevPort(): string {
  if (typeof window === 'undefined') return '';
  return window.location?.port || '';
}

/** Vite dev (:5173–5175) and preview (:4173) — same-origin /vllm-* + /mempalace-bridge proxies. */
export function isViteDevPort(port = browserDevPort()): boolean {
  return port === '5173' || port === '5174' || port === '5175' || port === '4173';
}

export function normalizeSparkRoute(value: unknown): SparkRoute {
  if (value === 'lan' || value === 'tailscale' || value === 'both') return value;
  return 'both';
}

function urlsForSparkHost(host: string, port: number, useProxy: boolean): string[] {
  const urls: string[] = [];
  const onVite = isViteDevPort();
  // Same-origin prefixes are fixed in vite.config.ts, so they only apply to the baked hosts.
  if (useProxy && onVite && host === SPARK_DEFAULT_HOST) urls.push('/vllm-lan/v1');
  if (useProxy && onVite && host === SPARK_TAILSCALE_HOST) urls.push('/vllm-ts/v1');
  if (useProxy) urls.push(`${SPARK_KEY_PROXY_ORIGIN}/spark/${host}/${port}/v1`);
  urls.push(`http://${host}:${port}/v1`);
  return urls;
}

/** Hosts selected by the Spark route switch. `both` races LAN and Tailscale. */
export function sparkHostsForRoute(route: SparkRoute, host?: string): string[] {
  const lan = normalizeSparkHost(host || SPARK_DEFAULT_HOST);
  if (route === 'tailscale') return [SPARK_TAILSCALE_HOST];
  if (route === 'lan') return [lan];
  const hosts = [lan];
  if (!hosts.includes(SPARK_TAILSCALE_HOST)) hosts.push(SPARK_TAILSCALE_HOST);
  return hosts;
}

/**
 * One fallback chain per selected NIC.
 * `both` returns two chains so the client can open them together.
 */
export function sparkEndpointGroups(
  host: string,
  port: number,
  useProxy = true,
  route: SparkRoute = 'both',
): string[][] {
  const p = Number(port) > 0 ? Number(port) : SPARK_DEFAULT_PORT;
  return sparkHostsForRoute(route, host).map((h) => urlsForSparkHost(h, p, useProxy));
}

export function sparkEndpointUrls(
  host: string,
  port: number,
  useProxy = true,
  route: SparkRoute = 'both',
): string[] {
  const urls: string[] = [];
  for (const group of sparkEndpointGroups(host, port, useProxy, route)) {
    for (const url of group) {
      if (!urls.includes(url)) urls.push(url);
    }
  }
  return urls;
}

export function resolveSparkBaseUrl(
  host: string,
  port: number,
  useProxy = true,
  route: SparkRoute = 'both',
): string {
  return sparkEndpointUrls(host, port, useProxy, route)[0];
}

export function defaultSettings(): StoredSettings {
  return {
    provider: 'spark',
    featherlessBaseUrl: FEATHERLESS_PROXY_BASE,
    featherlessApiKey: '',
    abliterationBaseUrl: 'https://api.abliteration.ai/v1',
    abliterationApiKey: '',
    sparkHost: SPARK_DEFAULT_HOST,
    sparkPort: SPARK_DEFAULT_PORT,
    sparkUseProxy: true,
    sparkRoute: 'both',
    sparkApiKey: '',
    model: SPARK_PREFER[0],
    agentMode: false,
    deepBuild: false,
    clusterRag: true,
    temperature: 0.7,
    maxTokens: 4096,
    agentMaxRounds: 8,
    workspaceDir: '/Users/adminuser/AIUI',
  };
}

export function loadSettings(): StoredSettings {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    return {
      ...base,
      ...parsed,
      sparkRoute: normalizeSparkRoute(parsed.sparkRoute),
    };
  } catch {
    return base;
  }
}

export function saveSettings(s: StoredSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

export function activeProvider(s: StoredSettings): ProviderConfig {
  if (s.provider === 'spark') {
    const route = normalizeSparkRoute(s.sparkRoute);
    const groups = sparkEndpointGroups(s.sparkHost, s.sparkPort, s.sparkUseProxy, route);
    return {
      id: 'spark',
      name: 'Spark DGX vLLM',
      baseUrl: groups[0][0],
      fallbackBaseUrls: groups[0].slice(1),
      endpointGroups: groups,
      apiKey: s.sparkApiKey || '',
      requiresApiKey: false,
    };
  }
  if (s.provider === 'abliteration') {
    return {
      id: 'abliteration',
      name: 'Abliteration AI',
      baseUrl: s.abliterationBaseUrl,
      apiKey: s.abliterationApiKey,
      requiresApiKey: true,
    };
  }
  return {
    id: 'featherless',
    name: 'Featherless AI',
    baseUrl: s.featherlessBaseUrl,
    apiKey: s.featherlessApiKey,
    requiresApiKey: true,
  };
}

export type AssistMode = 'chat' | 'agent' | 'deep';

export function getAssistMode(s: Pick<StoredSettings, 'agentMode' | 'deepBuild'>): AssistMode {
  if (s.agentMode && s.deepBuild) return 'deep';
  if (s.agentMode) return 'agent';
  return 'chat';
}

export function applyAssistMode(s: StoredSettings, mode: AssistMode): StoredSettings {
  if (mode === 'chat') return { ...s, agentMode: false, deepBuild: false };
  if (mode === 'agent') return { ...s, agentMode: true, deepBuild: false };
  return { ...s, agentMode: true, deepBuild: true };
}

export function providerSupportsNativeTools(provider: ProviderId): boolean {
  return provider === 'spark' || provider === 'featherless' || provider === 'abliteration';
}

export function preferFor(provider: ProviderId): string[] {
  if (provider === 'abliteration') return ABLITERATION_PREFER;
  if (provider === 'spark') return SPARK_PREFER;
  return FEATHERLESS_PREFER;
}

export function mergeCatalog(provider: ProviderId, ids: string[]): string[] {
  const prefer = preferFor(provider);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...prefer, ...ids]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(0, 250);
}
