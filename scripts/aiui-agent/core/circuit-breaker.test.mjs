import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CircuitBreakerManager, canonicalFetchUrl } from './circuit-breaker.mjs';

const PAGE = 'https://pay.ddmmzf.com/x_mgr/start/index.html';

describe('cross-tool page fetch breaker', () => {
  it('treats hash routes on the same document as one page', () => {
    const open = canonicalFetchUrl('browser_open', { url: `${PAGE}#/user` });
    const probe = canonicalFetchUrl('http_probe_advanced', { url: `${PAGE}#/user/login/redirect=%2F` });
    const curl = canonicalFetchUrl('bash', {
      command: `curl -sS -o /dev/null -w "%{http_code}" ${PAGE}#/user/login/redirect=%2F`,
    });
    assert.equal(open, `${PAGE}`);
    assert.equal(probe, open);
    assert.equal(curl, open);
  });

  it('blocks the curl follow-up after browser_open of the same page', () => {
    const breaker = new CircuitBreakerManager('/tmp', 'test');
    const first = breaker.evaluateAction('browser_open', { url: `${PAGE}#/user` });
    const second = breaker.evaluateAction('http_probe_advanced', { url: `${PAGE}#/user/login/redirect=%2F` });
    const third = breaker.evaluateAction('bash', {
      command: `curl -sS -k ${PAGE} | head -n 20`,
    });
    assert.equal(first.isCircuitBreaker, false);
    assert.equal(second.isCircuitBreaker, true);
    assert.equal(third.isCircuitBreaker, true);
    assert.match(third.breakerResponse, /already fetched/i);
  });
});
