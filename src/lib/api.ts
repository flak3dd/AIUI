/**
 * API client module - handles API communication, streaming chat completions,
 * model catalog fetching, and robust HTTP retry logic with exponential backoff & jitter.
 */

import type { ProviderConfig } from './providers.ts';
import {
  SPARK_DEFAULT_HOST,
  SPARK_DEFAULT_PORT,
  SPARK_TAILSCALE_HOST,
  sparkEndpointGroups,
} from './providers.ts';
import { resolveThinkingKwargs } from './thinkingOptions.ts';

/** WebKit says "Load failed"; Chromium says "Failed to fetch". */
export function isFetchNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message || '';
  return (
    err.name === 'TypeError' ||
    /load failed|failed to fetch|networkerror|network request failed|fetch failed/i.test(msg)
  );
}

function shouldSparkTailscaleFailover(err: unknown): boolean {
  if (isFetchNetworkError(err)) return true;
  if (!(err instanceof Error)) return false;
  return /HTTP 502|HTTP 503|HTTP 504|Unreachable|vLLM header timeout/i.test(err.message);
}

export function formatSparkUnreachableError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (/load failed|failed to fetch/i.test(raw)) {
    return new Error(
      `Spark vLLM unreachable (${raw}). LAN may be down — use route Both/Tailscale, or check :17332 / vLLM.`,
    );
  }
  return err instanceof Error ? err : new Error(raw);
}

function providerAlreadyHasTailscale(provider: ProviderConfig): boolean {
  const groups = provider.endpointGroups?.length
    ? provider.endpointGroups
    : [[provider.baseUrl, ...(provider.fallbackBaseUrls ?? [])]];
  return groups.some((group) =>
    group.some(
      (url) =>
        String(url).includes(SPARK_TAILSCALE_HOST) ||
        String(url).includes('/vllm-ts') ||
        String(url).includes(`/spark/${SPARK_TAILSCALE_HOST}/`),
    ),
  );
}

function sparkTailscaleFailoverProvider(provider: ProviderConfig): ProviderConfig {
  const groups = sparkEndpointGroups(SPARK_DEFAULT_HOST, SPARK_DEFAULT_PORT, true, 'tailscale');
  return {
    ...provider,
    baseUrl: groups[0][0],
    fallbackBaseUrls: groups[0].slice(1),
    endpointGroups: groups,
  };
}

export interface RetryOptions {
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  backoffFactor?: number;
  jitter?: boolean;
  retryableStatusCodes?: number[];
}

export interface ApiClientOptions {
  baseUrl?: string;
  timeout?: number;
  retry?: RetryOptions;
}

/**
 * Enterprise-grade ApiClient with exponential backoff, jitter, and status-aware retries.
 */
export class ApiClient {
  private baseUrl: string;
  private timeout: number;
  private retryOpts: Required<RetryOptions>;
  private totalRetries: number = 0;
  private totalRequests: number = 0;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl || 'https://api.example.com';
    this.timeout = options.timeout || 5000;
    this.retryOpts = {
      maxRetries: options.retry?.maxRetries ?? 3,
      initialBackoffMs: options.retry?.initialBackoffMs ?? 500,
      maxBackoffMs: options.retry?.maxBackoffMs ?? 8000,
      backoffFactor: options.retry?.backoffFactor ?? 2,
      jitter: options.retry?.jitter ?? true,
      retryableStatusCodes: options.retry?.retryableStatusCodes ?? [408, 429, 500, 502, 503, 504],
    };
  }

  async query(input: string, timeout?: number): Promise<string> {
    return this.queryWithRetry(input, { timeout });
  }

  async queryWithRetry(input: string, options?: { timeout?: number; retries?: number }): Promise<string> {
    const maxRetries = options?.retries ?? this.retryOpts.maxRetries;
    const timeout = options?.timeout ?? this.timeout;
    let attempt = 0;
    this.totalRequests++;

    while (true) {
      try {
        const url = `${this.baseUrl}/query`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input }),
          signal: AbortSignal.timeout(timeout),
        });

        if (!response.ok) {
          if (attempt < maxRetries && this.retryOpts.retryableStatusCodes.includes(response.status)) {
            attempt++;
            this.totalRetries++;
            const backoff = this.calculateBackoff(attempt, response);
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        return data.result ?? (typeof data === 'string' ? data : JSON.stringify(data));
      } catch (err: any) {
        if (
          attempt < maxRetries &&
          (err.name === 'TimeoutError' || err.name === 'AbortError' || err.message?.includes('fetch failed') || err.message?.includes('network'))
        ) {
          attempt++;
          this.totalRetries++;
          const backoff = this.calculateBackoff(attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
        throw err;
      }
    }
  }

  private calculateBackoff(attempt: number, response?: Response): number {
    if (response && response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) return seconds * 1000;
      }
    }
    let delay = this.retryOpts.initialBackoffMs * Math.pow(this.retryOpts.backoffFactor, attempt - 1);
    delay = Math.min(delay, this.retryOpts.maxBackoffMs);
    if (this.retryOpts.jitter) {
      const randomFactor = 0.75 + Math.random() * 0.5; // +/- 25%
      delay = Math.round(delay * randomFactor);
    }
    return delay;
  }

  async batchQuery(inputs: string[]): Promise<string[]> {
    return Promise.all(inputs.map((input) => this.query(input)));
  }

  getStats() {
    return {
      totalRequests: this.totalRequests,
      totalRetries: this.totalRetries,
    };
  }
}

// ------------------------------------------------------------------------------
// Browser API Transport & Chat Streaming (Preserving App.tsx Compatibility)
// ------------------------------------------------------------------------------

export type Role = 'user' | 'assistant' | 'system' | 'tool';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: Role;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  reasoning?: string;
}

export interface ModelInfo {
  id: string;
  gated?: boolean;
}

export class GatedModelError extends Error {
  model: string;
  code: string = 'model_gated_needs_oauth';
  constructor(message: string, model: string) {
    super(message);
    this.name = 'GatedModelError';
    this.model = model;
  }
}

function authHeaders(provider: ProviderConfig, extra: Record<string, string> = {}): HeadersInit {
  const headers: Record<string, string> = { ...extra };
  if (provider.apiKey) {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  }
  return headers;
}

const UPSTREAM_RETRY_STATUS = new Set([404, 502, 503, 504]);

type OpenedResponse = { response: Response; release: () => void };

function endpointGroups(provider: ProviderConfig): string[][] {
  if (provider.endpointGroups?.length) {
    return provider.endpointGroups
      .map((group) => group.map((url) => String(url || '').replace(/\/+$/, '')).filter(Boolean))
      .filter((group) => group.length > 0);
  }
  const single: string[] = [];
  for (const url of [provider.baseUrl, ...(provider.fallbackBaseUrls ?? [])]) {
    const clean = String(url || '').replace(/\/+$/, '');
    if (clean && !single.includes(clean)) single.push(clean);
  }
  return single.length ? [single] : [];
}

/**
 * Opens every endpoint group at once. The first response that is not a
 * gateway/route failure wins and the other requests are aborted.
 * Each group walks its own fallback list (Vite proxy, then key proxy, then direct).
 * The header timer is cleared once headers arrive so a live stream is not cut.
 */
function openFirstEndpoint(
  provider: ProviderConfig,
  path: string,
  init: RequestInit,
  headerTimeoutMs: number,
  userSignal?: AbortSignal,
): Promise<OpenedResponse> {
  const groups = endpointGroups(provider);
  return new Promise((resolve, reject) => {
    if (userSignal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    if (!groups.length) {
      reject(new Error('No endpoint configured'));
      return;
    }

    let settled = false;
    let pending = 0;
    let lastError: unknown = null;
    const controllers: AbortController[] = [];
    const cleanups: Array<() => void> = [];

    const abortOthers = (keep?: AbortController) => {
      for (const controller of controllers) {
        if (controller !== keep) controller.abort();
      }
    };

    const cleanupOthers = (keep?: () => void) => {
      for (const cleanup of cleanups) {
        if (cleanup !== keep) cleanup();
      }
    };

    const fail = (err: unknown) => {
      lastError = err;
      pending -= 1;
      if (!settled && pending <= 0) {
        for (const cleanup of cleanups) cleanup();
        reject(lastError instanceof Error ? lastError : new Error(`Unreachable ${path}`));
      }
    };

    const launch = (urls: string[], index: number) => {
      const base = urls[index];
      const controller = new AbortController();
      controllers.push(controller);
      pending += 1;
      const timer = setTimeout(() => controller.abort(new Error('vLLM header timeout')), headerTimeoutMs);
      const onUserAbort = () => controller.abort(userSignal?.reason);
      if (userSignal) {
        if (userSignal.aborted) controller.abort(userSignal.reason);
        else userSignal.addEventListener('abort', onUserAbort);
      }
      const cleanup = () => {
        clearTimeout(timer);
        userSignal?.removeEventListener('abort', onUserAbort);
      };
      cleanups.push(cleanup);

      fetch(`${base}${path}`, { ...init, signal: controller.signal })
        .then(async (response) => {
          clearTimeout(timer);
          if (settled) {
            await response.body?.cancel().catch(() => {});
            return;
          }
          const tryNext = UPSTREAM_RETRY_STATUS.has(response.status) && index + 1 < urls.length;
          if (tryNext) {
            await response.body?.cancel().catch(() => {});
            pending -= 1;
            launch(urls, index + 1);
            return;
          }
          if (!response.ok && UPSTREAM_RETRY_STATUS.has(response.status)) {
            await response.body?.cancel().catch(() => {});
            fail(new Error(`HTTP ${response.status} ${base}${path}`));
            return;
          }
          settled = true;
          abortOthers(controller);
          cleanupOthers(cleanup);
          resolve({
            response,
            release: cleanup,
          });
        })
        .catch((err) => {
          clearTimeout(timer);
          if (settled) return;
          if (userSignal?.aborted) {
            settled = true;
            abortOthers();
            for (const fn of cleanups) fn();
            reject(err);
            return;
          }
          if (index + 1 < urls.length) {
            pending -= 1;
            launch(urls, index + 1);
            return;
          }
          fail(err);
        });
    };

    for (const group of groups) launch(group, 0);
  });
}

export async function fetchModels(provider: ProviderConfig): Promise<ModelInfo[]> {
  if (provider.requiresApiKey && !provider.apiKey) return [];
  let opened: OpenedResponse | null = null;
  try {
    opened = await openFirstEndpoint(
      provider,
      '/models',
      { headers: authHeaders(provider) },
      provider.id === 'spark' ? 4000 : 8000,
    );
    if (!opened.response.ok) return [];
    const json = await opened.response.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    return rows
      .map((d: { id?: string; is_gated?: boolean }) => ({
        id: String(d.id || ''),
        gated: Boolean(d.is_gated),
      }))
      .filter((d: ModelInfo) => d.id);
  } catch {
    return [];
  } finally {
    opened?.release();
  }
}

export type StreamHandlers = {
  onToken: (text: string) => void;
  onReasoning?: (text: string) => void;
  onToolCalls?: (calls: ToolCall[]) => void;
  onDone?: () => void;
  onToolsStripped?: (reason: string) => void;
};

export async function streamChat(
  provider: ProviderConfig,
  body: Record<string, unknown>,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  opts?: { enableThinking?: boolean; skipSparkFailover?: boolean },
): Promise<{
  content: string;
  reasoning: string;
  tool_calls: ToolCall[];
  finishReason: string | null;
  toolsStripped?: boolean;
}> {
  const reqBody: Record<string, unknown> = { ...body, stream: true };
  if (provider.id === 'spark') {
    const thinking = resolveThinkingKwargs(provider.id, Boolean(opts?.enableThinking));
    if (thinking) reqBody.chat_template_kwargs = thinking;
  }
  let opened: OpenedResponse;
  try {
    opened = await openFirstEndpoint(
      provider,
      '/chat/completions',
      {
        method: 'POST',
        headers: authHeaders(provider, {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        }),
        body: JSON.stringify(reqBody),
      },
      provider.id === 'spark' ? 12000 : 90000,
      signal,
    );
  } catch (err) {
    // LAN-only (or dead LAN chain) → one Tailscale retry so Studio chat does not die with "Load failed".
    if (
      provider.id === 'spark' &&
      !opts?.skipSparkFailover &&
      shouldSparkTailscaleFailover(err) &&
      !providerAlreadyHasTailscale(provider)
    ) {
      return streamChat(sparkTailscaleFailoverProvider(provider), body, handlers, signal, {
        ...opts,
        skipSparkFailover: true,
      });
    }
    throw provider.id === 'spark' ? formatSparkUnreachableError(err) : err;
  }
  const res = opened.response;
  try {

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 403 && errText.includes('gated')) {
      throw new GatedModelError(`chat/completions HTTP ${res.status}: ${errText}`, String(body.model || ''));
    }
    throw new Error(`chat/completions HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let finishReason: string | null = null;
  const toolAcc = new Map<number, ToolCall>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() || '';
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') {
        handlers.onDone?.();
        continue;
      }
      try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
        const delta = choice?.delta || {};
        if (delta.content) {
          content += delta.content;
          handlers.onToken(delta.content);
        }
        const reasoningDelta = delta.reasoning_content || delta.reasoning;
        if (typeof reasoningDelta === 'string' && reasoningDelta) {
          reasoning += reasoningDelta;
          handlers.onReasoning?.(reasoningDelta);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = typeof tc.index === 'number' ? tc.index : 0;
            const prev = toolAcc.get(idx) || {
              id: tc.id || `call_${idx}`,
              type: 'function' as const,
              function: { name: '', arguments: '' },
            };
            if (tc.id) prev.id = tc.id;
            if (tc.function?.name) prev.function.name += tc.function.name;
            if (tc.function?.arguments) prev.function.arguments += tc.function.arguments;
            toolAcc.set(idx, prev);
          }
        }
      } catch {}
    }
  }

  const tool_calls = [...toolAcc.values()].filter((t) => t.function.name);
  if (tool_calls.length) handlers.onToolCalls?.(tool_calls);
  handlers.onDone?.();
  return { content, reasoning, tool_calls, finishReason };
  } finally {
    opened.release();
  }
}
