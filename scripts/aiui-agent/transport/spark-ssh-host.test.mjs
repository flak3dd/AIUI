import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  resolveSparkSshHost,
  resetSparkSshHostCache,
} from './spark-ssh-host.mjs';

describe('resolveSparkSshHost', () => {
  beforeEach(() => {
    resetSparkSshHostCache();
  });

  it('selects Tailscale when LAN:22 is connection-refused', async () => {
    const lan = '192.168.4.103';
    const ts = '100.66.147.53';
    const probed = [];

    const probe = async (host) => {
      probed.push(host);
      if (host === lan) return { ok: false, refused: true, error: 'ECONNREFUSED' };
      if (host === ts) return { ok: true, refused: false };
      return { ok: false, refused: false, error: 'unexpected' };
    };

    const result = await resolveSparkSshHost({
      configuredHost: lan,
      fallbackHost: ts,
      probe,
    });

    assert.equal(result.host, ts);
    assert.equal(result.usedFallback, true);
    assert.equal(result.bothRefused, false);
    assert.deepEqual(probed, [lan, ts]);
    assert.notEqual(result.host, lan);
  });

  it('keeps configured host when primary TCP succeeds', async () => {
    const lan = '192.168.4.103';
    const ts = '100.66.147.53';
    let calls = 0;
    const probe = async (host) => {
      calls += 1;
      return host === lan
        ? { ok: true, refused: false }
        : { ok: false, refused: true, error: 'ECONNREFUSED' };
    };

    const result = await resolveSparkSshHost({
      configuredHost: lan,
      fallbackHost: ts,
      probe,
    });

    assert.equal(result.host, lan);
    assert.equal(result.usedFallback, false);
    assert.equal(calls, 1);
  });

  it('does not loop when both hosts refuse', async () => {
    const lan = '192.168.4.103';
    const ts = '100.66.147.53';
    const probed = [];
    const probe = async (host) => {
      probed.push(host);
      return { ok: false, refused: true, error: 'ECONNREFUSED' };
    };

    const result = await resolveSparkSshHost({
      configuredHost: lan,
      fallbackHost: ts,
      probe,
    });

    assert.equal(result.bothRefused, true);
    assert.equal(result.usedFallback, false);
    assert.equal(result.host, lan);
    assert.deepEqual(probed, [lan, ts]);

    // Cached: second call must not re-probe / loop
    const again = await resolveSparkSshHost({
      configuredHost: lan,
      fallbackHost: ts,
      probe,
    });
    assert.deepEqual(probed, [lan, ts]);
    assert.equal(again.bothRefused, true);
  });
});
