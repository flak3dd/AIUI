/**
 * MemPalace browser client & Persistent LRU Memory Storage
 * Manages persistent memory storage, MCP bridge communication, and high-performance LRU caching.
 */

import { fetchWithRetry } from './resilientFetch';

export interface LRUCacheOptions {
  capacity?: number;
  defaultTtlMs?: number;
}

export interface LRUCacheEntry<T = string> {
  value: T;
  expiresAt?: number;
}

export interface MemoryPalaceStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  capacity: number;
  hitRatio: number;
}

/**
 * High-performance LRU Cache Memory Storage Engine.
 * Supports capacity limits, LRU eviction, TTL expiration, and hit/miss metrics.
 */
export class MemoryPalace<T = string> {
  private cache: Map<string, LRUCacheEntry<T>>;
  private capacity: number;
  private defaultTtlMs?: number;
  private hits: number = 0;
  private misses: number = 0;
  private evictions: number = 0;

  constructor(options: LRUCacheOptions = {}) {
    this.capacity = options.capacity || 500;
    this.defaultTtlMs = options.defaultTtlMs;
    this.cache = new Map();
  }

  /**
   * Look up an item in memory. If found and not expired, updates LRU position.
   */
  lookup(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check TTL expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    // Move to most-recently-used position (delete and re-insert)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  /**
   * Store an item in memory. Evicts the least-recently-used item if capacity exceeded.
   */
  store(key: string, value: T, ttlMs?: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Evict oldest (first key in Map iterator)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this.evictions++;
      }
    }

    const ttl = ttlMs !== undefined ? ttlMs : this.defaultTtlMs;
    const expiresAt = ttl ? Date.now() + ttl : undefined;
    this.cache.set(key, { value, expiresAt });
  }

  /**
   * Check existence without altering LRU order.
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Peek value without altering LRU order.
   */
  peek(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  getCapacity(): number {
    return this.capacity;
  }

  getStats(): MemoryPalaceStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      size: this.cache.size,
      capacity: this.capacity,
      hitRatio: total > 0 ? this.hits / total : 0,
    };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }
}

// ------------------------------------------------------------------------------
// MemPalace Bridge & Network Client Methods (Preserving App.tsx Compatibility)
// ------------------------------------------------------------------------------

export interface MemPalaceStatus {
  online: boolean;
  url: string;
  latencyMs?: number;
  totalDrawers?: number;
  wings?: Record<string, number>;
  error?: string;
}

export interface MemPalaceHit {
  text: string;
  wing: string;
  room: string;
  source_file?: string;
  similarity?: number;
}

export interface MemPalaceSearchResult {
  results: MemPalaceHit[];
  total?: number;
}

export interface MemPalaceCheckpointResult {
  added: unknown[];
  duplicates: unknown[];
  errors: unknown[];
  diary?: unknown;
}

export interface MemPalaceDiaryEntry {
  date?: string;
  timestamp?: string;
  topic?: string;
  content?: string;
}

const DEFAULT_MEMPALACE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MEMPALACE_URL) ||
  'http://127.0.0.1:17333';
const STORAGE_MEMPALACE_URL_KEY = 'abliterated_mempalace_url';
const STORAGE_AUTO_RECALL_KEY = 'abliterated_mempalace_auto_recall';
const STORAGE_AUTO_CHECKPOINT_KEY = 'abliterated_mempalace_auto_checkpoint';

export function getMempalaceBaseUrl(): string {
  try {
    const stored = localStorage.getItem(STORAGE_MEMPALACE_URL_KEY);
    if (stored) return stored;
  } catch {}
  if (typeof window !== 'undefined' && (window.location.port === '5173' || window.location.port === '5174')) {
    return `${window.location.origin}/mempalace-bridge`;
  }
  return DEFAULT_MEMPALACE_URL;
}

export function setMempalaceBaseUrl(url: string) {
  try {
    localStorage.setItem(STORAGE_MEMPALACE_URL_KEY, url);
  } catch {}
}

export function getAutoRecall(): boolean {
  try {
    return localStorage.getItem(STORAGE_AUTO_RECALL_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setAutoRecall(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_AUTO_RECALL_KEY, enabled ? 'true' : 'false');
  } catch {}
}

export function getAutoCheckpoint(): boolean {
  try {
    return localStorage.getItem(STORAGE_AUTO_CHECKPOINT_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setAutoCheckpoint(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_AUTO_CHECKPOINT_KEY, enabled ? 'true' : 'false');
  } catch {}
}

export async function checkMempalaceHealth(baseUrl = getMempalaceBaseUrl()): Promise<MemPalaceStatus> {
  const t0 = performance.now();
  try {
    const res = await fetchWithRetry(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(2500),
    });
    const latencyMs = Math.round(performance.now() - t0);
    if (res.ok) {
      const json = await res.json();
      return {
        online: Boolean(json.mcpReady),
        url: baseUrl,
        latencyMs,
      };
    }
    return {
      online: false,
      url: baseUrl,
      latencyMs,
      error: `HTTP ${res.status}`,
    };
  } catch (err: unknown) {
    return {
      online: false,
      url: baseUrl,
      error: err instanceof Error ? err.message : 'Connection refused',
    };
  }
}

export async function searchMemory(
  query: string,
  opts?: { wing?: string; room?: string; limit?: number },
  baseUrl = getMempalaceBaseUrl(),
): Promise<MemPalaceSearchResult> {
  const res = await fetchWithRetry(`${baseUrl}/mcp/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      limit: opts?.limit ?? 5,
      ...(opts?.wing ? { wing: opts.wing } : {}),
      ...(opts?.room ? { room: opts.room } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`MemPalace search HTTP ${res.status}`);
  }
  const json = await res.json();
  const result = json.result || json;
  return {
    results: Array.isArray(result.results) ? result.results : [],
    total: result.total,
  };
}

export async function checkpointMemory(
  items: Array<{ wing: string; room: string; content: string }>,
  diary?: { agent_name: string; entry: string; topic?: string },
  baseUrl = getMempalaceBaseUrl(),
): Promise<MemPalaceCheckpointResult> {
  const res = await fetchWithRetry(`${baseUrl}/mcp/checkpoint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items,
      ...(diary ? { diary } : {}),
      added_by: 'web-api-app',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`MemPalace checkpoint HTTP ${res.status}`);
  }
  const json = await res.json();
  const result = json.result || json;
  return {
    added: result.added || [],
    duplicates: result.duplicates || [],
    errors: result.errors || [],
    diary: result.diary,
  };
}

export type PalaceToolResult = {
  ok: boolean
  result?: unknown
  error?: string
}

async function postPalaceTool(
  path: string,
  body: Record<string, unknown>,
  baseUrl = getMempalaceBaseUrl(),
): Promise<PalaceToolResult> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.ok === false) {
      return { ok: false, error: json.error || `HTTP ${res.status}`, result: json.result }
    }
    return { ok: true, result: json.result ?? json }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'palace tool failed' }
  }
}

export function addDrawer(
  item: { wing: string; room: string; content: string; added_by?: string },
  baseUrl = getMempalaceBaseUrl(),
) {
  return postPalaceTool(
    '/mcp/add-drawer',
    {
      wing: item.wing,
      room: item.room,
      content: item.content,
      added_by: item.added_by || 'aiui-orchestrator',
    },
    baseUrl,
  )
}

export function queryKnowledge(
  entity: string,
  opts?: { asOf?: string; direction?: 'outgoing' | 'incoming' | 'both' },
  baseUrl = getMempalaceBaseUrl(),
) {
  return postPalaceTool(
    '/mcp/kg-query',
    {
      entity,
      direction: opts?.direction || 'both',
      ...(opts?.asOf ? { as_of: opts.asOf } : {}),
    },
    baseUrl,
  )
}

export function addKnowledgeTriple(
  triple: { subject: string; predicate: string; object: string; valid_from?: string },
  baseUrl = getMempalaceBaseUrl(),
) {
  return postPalaceTool('/mcp/kg-add', triple, baseUrl)
}

export function traversePalace(
  startRoom: string,
  maxHops = 2,
  baseUrl = getMempalaceBaseUrl(),
) {
  return postPalaceTool(
    '/mcp/traverse',
    { start_room: startRoom, max_hops: Math.min(2, Math.max(1, maxHops)) },
    baseUrl,
  )
}

export function recordDiary(
  agent: string,
  entry: string,
  topic?: string,
  wing?: string,
  baseUrl = getMempalaceBaseUrl(),
) {
  return postPalaceTool(
    '/mcp/diary-write',
    {
      agent_name: agent,
      entry,
      ...(topic ? { topic } : {}),
      ...(wing ? { wing } : {}),
    },
    baseUrl,
  )
}

export async function writeDiary(
  agent: string,
  entry: string,
  topic?: string,
  baseUrl = getMempalaceBaseUrl(),
): Promise<{ success: boolean }> {
  const res = await fetch(`${baseUrl}/mcp/diary-write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: agent, entry, ...(topic ? { topic } : {}) }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`MemPalace diary-write HTTP ${res.status}`);
  }
  const json = await res.json();
  const result = json.result || json;
  return { success: Boolean(result.success) };
}

export async function readDiary(
  agent: string,
  lastN = 10,
  baseUrl = getMempalaceBaseUrl(),
): Promise<{ entries: MemPalaceDiaryEntry[] }> {
  const params = new URLSearchParams({ agent_name: agent, last_n: String(lastN) });
  const res = await fetch(`${baseUrl}/mcp/diary-read?${params}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`MemPalace diary-read HTTP ${res.status}`);
  }
  const json = await res.json();
  const result = json.result || json;
  return { entries: result.entries || [] };
}

export async function getMempalaceStatus(
  baseUrl = getMempalaceBaseUrl(),
): Promise<{ totalDrawers: number; wings: Record<string, number> }> {
  const res = await fetch(`${baseUrl}/mcp/status`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`MemPalace status HTTP ${res.status}`);
  }
  const json = await res.json();
  const result = json.result || json;
  return {
    totalDrawers: result.total_drawers || 0,
    wings: result.wings || {},
  };
}

export function filterNoisyMempalaceResults(results: MemPalaceHit[]): MemPalaceHit[] {
  return results.filter((r) => r.text && r.text.length > 10);
}
