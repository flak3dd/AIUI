## Global Constraints

- Reuse `settings.deepBuild` as the Deep Reasoning flag (no new settings key).
- Abliteration must still omit `chat_template_kwargs` entirely.
- Non-Abliteration: `chat_template_kwargs.enable_thinking` is `true` only when Deep Reasoning is on; otherwise `false`.
- Never append `reasoning_content` into answer `content`.
- Do not send `reasoning` back in outbound chat history (only `content`).
- Keep `<think>…</think>` ThoughtTrail fallback in `MessageContent`.
- Prefer native reasoning trail when both native `reasoning` and `<think>` blocks exist (avoid duplicate display of the same text when identical; if both differ, show native first, then tag blocks).
- YAGNI: no MemPalace persistence of reasoning; no split of deepBuild into two settings.
- TDD: failing tests before implementation for helpers.
- Frequent commits after each task.

### Task 1: Pure thinking helper + tests

**Files:**
- Create: `src/lib/thinkingOptions.ts`
- Create: `src/lib/thinkingOptions.test.ts`
- Modify: `tsconfig.app.json` — ensure `src/**/*.test.ts` is excluded from app compile (add exclude if missing)

**Interfaces:**
- Consumes: `ProviderId` from `src/lib/providers.ts` (`'featherless' | 'abliteration' | 'spark'`)
- Produces:
  - `resolveThinkingKwargs(providerId: ProviderId | string, enableThinking: boolean): { enable_thinking: boolean } | undefined`
  - `classifyStreamDelta(delta: { content?: unknown; reasoning_content?: unknown }): { kind: 'content' | 'reasoning' | 'none'; text: string }`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveThinkingKwargs, classifyStreamDelta } from './thinkingOptions.ts'

describe('resolveThinkingKwargs', () => {
  it('omits kwargs for abliteration even when thinking enabled', () => {
    assert.equal(resolveThinkingKwargs('abliteration', true), undefined)
    assert.equal(resolveThinkingKwargs('abliteration', false), undefined)
  })

  it('sets enable_thinking true for spark/featherless when enabled', () => {
    assert.deepEqual(resolveThinkingKwargs('spark', true), { enable_thinking: true })
    assert.deepEqual(resolveThinkingKwargs('featherless', true), { enable_thinking: true })
  })

  it('sets enable_thinking false when disabled', () => {
    assert.deepEqual(resolveThinkingKwargs('spark', false), { enable_thinking: false })
  })
})

describe('classifyStreamDelta', () => {
  it('prefers content over reasoning when both present', () => {
    assert.deepEqual(
      classifyStreamDelta({ content: 'Hi', reasoning_content: 'think' }),
      { kind: 'content', text: 'Hi' },
    )
  })

  it('routes reasoning_content alone to reasoning', () => {
    assert.deepEqual(
      classifyStreamDelta({ reasoning_content: 'step 1' }),
      { kind: 'reasoning', text: 'step 1' },
    )
  })

  it('returns none for empty delta', () => {
    assert.deepEqual(classifyStreamDelta({}), { kind: 'none', text: '' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/thinkingOptions.test.ts`  
Expected: FAIL (module not found / exports missing)

- [ ] **Step 3: Write minimal implementation**

```ts
export function resolveThinkingKwargs(
  providerId: string,
  enableThinking: boolean,
): { enable_thinking: boolean } | undefined {
  if (providerId === 'abliteration') return undefined
  return { enable_thinking: enableThinking }
}

export function classifyStreamDelta(delta: {
  content?: unknown
  reasoning_content?: unknown
}): { kind: 'content' | 'reasoning' | 'none'; text: string } {
  if (typeof delta.content === 'string' && delta.content) {
    return { kind: 'content', text: delta.content }
  }
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
    return { kind: 'reasoning', text: delta.reasoning_content }
  }
  return { kind: 'none', text: '' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/thinkingOptions.test.ts`  
Expected: pass (6 tests)

- [ ] **Step 5: Exclude tests from `tsc` if needed**

If `./node_modules/.bin/tsc -b` errors on the test file, add to `tsconfig.app.json`:

```json
"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/thinkingOptions.ts src/lib/thinkingOptions.test.ts tsconfig.app.json
git commit -m "feat(thinking): add pure thinking kwargs helpers"
```

---
