import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import {
  __setSquadSupportTestHooks,
  looksLikeSecretMaterial,
  validateSquadSupportPayload,
  resolveAbliterationSupportConfig,
  ABLITERATION_DEFAULT_MODEL,
  squadEnqueue,
  squadCollect,
  extractChatContent,
  SQUAD_SUPPORT_MAX_CONTEXT_CHARS,
  SQUAD_SUPPORT_MAX_RESULT_CHARS,
} from './squad-support.mjs'

const TEST_MODEL = 'abliterated-model'

describe('resolveAbliterationSupportConfig', () => {
  it('defaults to the live Abliteration model id', () => {
    assert.equal(ABLITERATION_DEFAULT_MODEL, 'abliterated-model')
    const cfg = resolveAbliterationSupportConfig({
      VITE_ABLITERATION_API_KEY: 'test-key',
    })
    assert.equal(cfg.model, 'abliterated-model')
  })

  it('honors VITE_ABLITERATION_MODEL override', () => {
    const cfg = resolveAbliterationSupportConfig({
      VITE_ABLITERATION_API_KEY: 'test-key',
      VITE_ABLITERATION_MODEL: 'abliterated-model-large',
    })
    assert.equal(cfg.model, 'abliterated-model-large')
  })
})

describe('squad support validation', () => {
  it('refuses secret-looking payloads', () => {
    assert.equal(looksLikeSecretMaterial('api_key=sk_live_abcdefghijklmnop'), true)
    assert.equal(looksLikeSecretMaterial('-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----'), true)
    assert.equal(looksLikeSecretMaterial('password: hunter2'), true)
    assert.equal(looksLikeSecretMaterial('summarize this log file'), false)
  })

  it('refuses oversize combined payload', () => {
    const big = 'x'.repeat(SQUAD_SUPPORT_MAX_CONTEXT_CHARS)
    const v = validateSquadSupportPayload('t', big)
    assert.equal(v.ok, false)
    assert.match(String(v.error), /exceeds/)
  })
})

describe('squad_enqueue / squad_collect async loop', () => {
  beforeEach(() => {
    __setSquadSupportTestHooks(null)
  })
  afterEach(() => {
    __setSquadSupportTestHooks(null)
  })

  it('fail closed when API key is missing', () => {
    __setSquadSupportTestHooks({
      resolveConfig: () => ({
        baseUrl: 'https://api.abliteration.ai/v1',
        apiKey: '',
        model: TEST_MODEL,
      }),
    })
    const out = squadEnqueue({ task: 'summarize the plan' })
    assert.equal(out.ok, false)
    assert.match(String(out.error), /VITE_ABLITERATION_API_KEY/)
  })

  it('refuses secrets at enqueue', () => {
    __setSquadSupportTestHooks({
      resolveConfig: () => ({
        baseUrl: 'https://api.abliteration.ai/v1',
        apiKey: 'test-key-not-real',
        model: TEST_MODEL,
      }),
    })
    const out = squadEnqueue({
      task: 'review config',
      context: 'VITE_ABLITERATION_API_KEY=ak_should_not_leak_this_value_here',
    })
    assert.equal(out.ok, false)
    assert.match(String(out.error), /Refused/)
  })

  it('enqueue returns taskId immediately and collect sees done after mock completion', async () => {
    let resolveFetch
    const fetchGate = new Promise((r) => {
      resolveFetch = r
    })

    __setSquadSupportTestHooks({
      resolveConfig: () => ({
        baseUrl: 'https://api.abliteration.ai/v1',
        apiKey: 'test-key-not-real',
        model: TEST_MODEL,
      }),
      fetchImpl: async (url, init) => {
        assert.match(String(url), /\/chat\/completions$/)
        const headers = init?.headers || {}
        const auth = headers.Authorization || headers.authorization
        assert.match(String(auth), /^Bearer /)
        const body = JSON.parse(String(init?.body || '{}'))
        assert.equal(body.model, TEST_MODEL)
        await fetchGate
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'compact support result' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      },
    })

    const enq = squadEnqueue({
      task: 'Analyze this long plan',
      context: 'step1; step2; step3',
    })
    assert.equal(enq.ok, true)
    assert.ok(enq.taskId)
    assert.equal(enq.status, 'queued')

    const pending = squadCollect({ taskId: enq.taskId })
    assert.equal(pending.ok, true)
    assert.equal(pending.pending, true)
    assert.equal(pending.status, 'pending')

    resolveFetch()
    // Allow microtasks for the in-flight worker to finish
    for (let i = 0; i < 20; i++) {
      const snap = squadCollect({ taskId: enq.taskId })
      if (snap.status === 'done') {
        assert.equal(snap.ok, true)
        assert.equal(snap.result, 'compact support result')
        assert.ok(String(snap.result).length <= SQUAD_SUPPORT_MAX_RESULT_CHARS)
        return
      }
      await new Promise((r) => setTimeout(r, 5))
    }
    assert.fail('support task did not complete')
  })

  it('extractChatContent reads OpenAI-shaped bodies', () => {
    assert.equal(
      extractChatContent({ choices: [{ message: { content: ' hello ' } }] }),
      'hello',
    )
    assert.equal(extractChatContent({ choices: [] }), '')
  })

  it('never ok:true done without a real result body', async () => {
    __setSquadSupportTestHooks({
      resolveConfig: () => ({
        baseUrl: 'https://api.abliteration.ai/v1',
        apiKey: 'test-key-not-real',
        model: TEST_MODEL,
      }),
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    })
    const enq = squadEnqueue({ task: 'empty response path' })
    assert.equal(enq.ok, true)
    for (let i = 0; i < 40; i++) {
      const snap = squadCollect({ taskId: enq.taskId })
      if (snap.status === 'error' || (snap.status === 'done' && snap.ok === false)) {
        assert.equal(snap.ok, false)
        return
      }
      if (snap.pending) {
        await new Promise((r) => setTimeout(r, 5))
        continue
      }
      break
    }
    const final = squadCollect({ taskId: enq.taskId })
    assert.equal(final.ok, false)
  })
})
