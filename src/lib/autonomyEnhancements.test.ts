import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Agent, AgentMetrics } from './agent.ts';
import { MemoryPalace } from './mempalace.ts';
import { ApiClient } from './api.ts';
import { ProviderManager } from './providers.ts';

describe('Autonomy Enhancement 1: TypeScript Generics on Agent', () => {
  interface CustomSessionContext {
    sessionId: string;
    userId: string;
    role: 'admin' | 'dev';
  }

  interface QueryPayload {
    command: string;
    priority: number;
  }

  interface ResponsePayload {
    status: string;
    output: string;
  }

  class MockGenericApiClient extends ApiClient {
    async query(input: string): Promise<string> {
      return JSON.stringify({ status: 'success', output: `Processed: ${input}` });
    }
  }

  it('initializes agent with strongly typed context and handles process calls', async () => {
    const memory = new MemoryPalace();
    const agent = new Agent<QueryPayload, ResponsePayload, CustomSessionContext>({
      api: new MockGenericApiClient(),
      memory,
      context: {
        sessionId: 'sess_abc123',
        userId: 'user_456',
        role: 'admin',
      },
    });

    const ctx = agent.getContext();
    assert.equal(ctx.sessionId, 'sess_abc123');
    assert.equal(ctx.role, 'admin');

    agent.setContext({ role: 'dev' });
    assert.equal(agent.getContext().role, 'dev');

    const result = await agent.process({ command: 'deploy-cluster', priority: 1 });
    assert.equal(result.status, 'success');
    assert.ok(result.output.includes('deploy-cluster'));
  });

  it('supports batch processing with generic types', async () => {
    const agent = new Agent<string, string>({
      api: new MockGenericApiClient(),
    });

    const results = await agent.batchProcess(['Task A', 'Task B', 'Task C']);
    assert.equal(results.length, 3);
  });
});

describe('Autonomy Enhancement 2: True LRU Caching in MemoryPalace', () => {
  it('evicts least-recently-used item when capacity is reached', () => {
    const cache = new MemoryPalace({ capacity: 3 });
    cache.store('item1', 'val1');
    cache.store('item2', 'val2');
    cache.store('item3', 'val3');
    assert.equal(cache.size(), 3);

    // Access item1 to make it MRU (most recently used)
    // Cache order becomes: item2 (oldest), item3, item1 (newest)
    assert.equal(cache.lookup('item1'), 'val1');

    // Add item4 -> item2 must be evicted!
    cache.store('item4', 'val4');
    assert.equal(cache.size(), 3);
    assert.equal(cache.lookup('item2'), undefined, 'item2 should be evicted by LRU');
    assert.equal(cache.lookup('item1'), 'val1', 'item1 should still be present');
    assert.equal(cache.lookup('item3'), 'val3', 'item3 should still be present');
    assert.equal(cache.lookup('item4'), 'val4', 'item4 should still be present');
  });

  it('enforces TTL expiration correctly', async () => {
    const cache = new MemoryPalace({ capacity: 5, defaultTtlMs: 40 });
    cache.store('tempKey', 'tempVal');
    assert.equal(cache.lookup('tempKey'), 'tempVal');

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(cache.lookup('tempKey'), undefined, 'Expired entry should return undefined');
  });

  it('tracks hit and miss statistics', () => {
    const cache = new MemoryPalace({ capacity: 10 });
    cache.store('test', 'value');

    cache.lookup('test'); // hit
    cache.lookup('test'); // hit
    cache.lookup('missing'); // miss

    const stats = cache.getStats();
    assert.equal(stats.hits, 2);
    assert.equal(stats.misses, 1);
    assert.equal(stats.size, 1);
    assert.ok(stats.hitRatio > 0.6);
  });
});

describe('Autonomy Enhancement 3: Exponential Backoff & Retry Logic in ApiClient', () => {
  it('retries on failure and tracks retry counters', async () => {
    const client = new ApiClient({
      baseUrl: 'http://127.0.0.1:59999', // non-existent port
      timeout: 50,
      retry: {
        maxRetries: 2,
        initialBackoffMs: 10,
        maxBackoffMs: 30,
        jitter: false,
      },
    });

    let failed = false;
    try {
      await client.query('failing query');
    } catch {
      failed = true;
    }

    assert.equal(failed, true);
    const stats = client.getStats();
    assert.equal(stats.totalRequests, 1);
    assert.equal(stats.totalRetries, 2);
  });
});

describe('Autonomy Enhancement 4: Provider Lifecycle Management in ProviderManager', () => {
  it('supports registration, initialization, health check, and failover', async () => {
    const pm = new ProviderManager();

    let sparkInit = false;
    let sparkShutdown = false;

    pm.register(
      'primary_spark',
      {
        init: async () => { sparkInit = true; },
        healthCheck: async () => true,
        shutdown: async () => { sparkShutdown = true; },
      },
      100
    );

    pm.register(
      'secondary_featherless',
      {
        healthCheck: async () => true,
      },
      50
    );

    await pm.init();
    assert.equal(sparkInit, true);

    const health = await pm.healthCheck();
    assert.equal(health.primary_spark.status, 'healthy');
    assert.equal(health.secondary_featherless.status, 'healthy');

    assert.equal(pm.getActiveName(), 'primary_spark');

    // Failover to secondary
    const newActive = pm.failover('primary_spark');
    assert.equal(newActive, 'secondary_featherless');
    assert.equal(pm.getActiveName(), 'secondary_featherless');

    await pm.shutdown();
    assert.equal(sparkShutdown, true);
  });
});

describe('Autonomy Enhancement 5: Structured Logging & Execution Metrics in Agent', () => {
  class MockMetricsApiClient extends ApiClient {
    async query(input: string): Promise<string> {
      await new Promise((r) => setTimeout(r, 10));
      return `Processed: ${input}`;
    }
  }

  it('records execution latency, turn index, cache ratios, and logs to hook', async () => {
    const logEvents: any[] = [];
    const agent = new Agent({
      api: new MockMetricsApiClient(),
      logger: (level, msg, data) => {
        logEvents.push({ level, msg, data });
      },
    });

    // Turn 1: Miss
    await agent.process('Turn 1 query');
    // Turn 2: Hit
    await agent.process('Turn 1 query');

    const metrics = agent.getMetrics();
    assert.equal(metrics.totalTurns, 2);
    assert.equal(metrics.cacheHits, 1);
    assert.equal(metrics.cacheMisses, 1);
    assert.equal(metrics.cacheHitRatio, 0.5);
    assert.ok(metrics.totalDurationMs >= 10);
    assert.ok(logEvents.length >= 2, 'Logger should receive structured log events');
  });
});
