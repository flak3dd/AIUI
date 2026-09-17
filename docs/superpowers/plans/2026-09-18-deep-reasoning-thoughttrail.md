# Deep Reasoning ThoughtTrail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream model `reasoning_content` into a separate `UiMessage.reasoning` field, show it in `ThoughtTrail` above each answer, and gate `enable_thinking` behind the existing Deep (`deepBuild`) toggle (relabeled Deep Reasoning in the UI).

**Architecture:** Extract a pure helper that decides `chat_template_kwargs` from provider id + `enableThinking`. Extend `streamChat` to accumulate reasoning separately and emit `onReasoning` without merging into answer tokens. Persist `reasoning` on `UiMessage`, render via `ThoughtTrail` in `MessageContent`, and pass `settings.deepBuild` as `enableThinking` from `App.tsx`. Keep Abliteration omitting thinking kwargs.

**Tech Stack:** React 19 + TypeScript + Vite (AIUI), Node built-in test runner (`node --experimental-strip-types --test`), existing `ThoughtTrail` component.

**Spec:** `docs/superpowers/specs/2026-09-18-deep-reasoning-thoughttrail-design.md`

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

## File map

| File | Responsibility |
|------|----------------|
| Create: `src/lib/thinkingOptions.ts` | Pure helpers: thinking kwargs + optional stream delta classification |
| Create: `src/lib/thinkingOptions.test.ts` | Node tests for helpers |
| Modify: `src/lib/api.ts` | `buildStreamBody(…, enableThinking)`, `onReasoning`, separate accumulators, return `reasoning` |
| Modify: `src/types/ui.ts` | `reasoning?: string` on `UiMessage` |
| Modify: `src/App.tsx` | Wire `onReasoning`, pass `enableThinking: settings.deepBuild`, flush reasoning on message |
| Modify: `src/components/MessageContent.tsx` | Accept `reasoning` / `reasoningStreaming`; ThoughtTrail above answer |
| Modify: `src/components/ChatStage.tsx` | Pass `m.reasoning` (and streaming flag if available) into `MessageContent` |
| Modify: `src/components/Composer.tsx` | Relabel Deep pill → Deep Reasoning |
| Modify: `src/components/SettingsSheet.tsx` | Relabel Deep Build → Deep Reasoning + hint |
| Modify: `src/components/CommandPalette.tsx` | Relabel toggle title to Deep Reasoning |

---

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

### Task 2: Split reasoning in `streamChat`

**Files:**
- Modify: `src/lib/api.ts`
- Test: re-run `src/lib/thinkingOptions.test.ts` (no change expected); manually sanity-check types via `tsc -b`

**Interfaces:**
- Consumes: `resolveThinkingKwargs`, `classifyStreamDelta` from `./thinkingOptions`
- Produces:
  - `StreamHandlers.onReasoning?: (text: string) => void`
  - `streamChat(..., options?: { enableThinking?: boolean } | signal still 4th arg)` — **keep `signal` as 4th argument**; add optional 5th arg OR overload body: prefer adding `enableThinking?: boolean` onto an options object without breaking callers.

**Chosen signature (do not break existing call sites):**

```ts
export async function streamChat(
  provider: ProviderConfig,
  body: Record<string, unknown>,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  opts?: { enableThinking?: boolean },
): Promise<{
  content: string
  reasoning: string
  tool_calls: ToolCall[]
  finishReason: string | null
  toolsStripped?: boolean
}>
```

- [ ] **Step 1: Extend `StreamHandlers` and `buildStreamBody`**

Update types and body builder:

```ts
import { resolveThinkingKwargs, classifyStreamDelta } from './thinkingOptions'

export type StreamHandlers = {
  onToken: (text: string) => void
  onReasoning?: (text: string) => void
  onToolCalls?: (calls: ToolCall[]) => void
  onDone?: () => void
  onToolsStripped?: (reason: string) => void
}

function buildStreamBody(
  body: Record<string, unknown>,
  provider: ProviderConfig,
  enableThinking = false,
): Record<string, unknown> {
  const reqBody: Record<string, unknown> = { ...body, stream: true }
  const kwargs = resolveThinkingKwargs(provider.id, enableThinking)
  if (kwargs) reqBody.chat_template_kwargs = kwargs
  else delete reqBody.chat_template_kwargs
  return reqBody
}
```

- [ ] **Step 2: Update SSE loop to split reasoning**

Inside the delta handling block, replace content/reasoning merge with:

```ts
let reasoning = ''
// ...
const classified = classifyStreamDelta(delta)
if (classified.kind === 'content') {
  content += classified.text
  handlers.onToken(classified.text)
} else if (classified.kind === 'reasoning') {
  reasoning += classified.text
  handlers.onReasoning?.(classified.text)
}
```

Return `{ content, reasoning, tool_calls, finishReason, toolsStripped }`.

- [ ] **Step 3: Thread `opts?.enableThinking` through recursive fallback**

When `streamChat` retries without tools, pass the same `opts` through:

```ts
const fallback = await streamChat(provider, fallbackBody, handlers, signal, opts)
return { ...fallback, toolsStripped: true }
```

And use:

```ts
body: JSON.stringify(buildStreamBody(body, provider, opts?.enableThinking === true)),
```

- [ ] **Step 4: Typecheck**

Run: `./node_modules/.bin/tsc -b --pretty false`  
Expected: exit 0 (App may still ignore new return field — that is fine)

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(api): stream reasoning_content separately from answer tokens"
```

---

### Task 3: `UiMessage.reasoning` + App wiring

**Files:**
- Modify: `src/types/ui.ts`
- Modify: `src/App.tsx` (assistant placeholder, `onReasoning`, `streamChat` opts, final flush)

**Interfaces:**
- Consumes: `streamChat` with `onReasoning` + `opts.enableThinking`
- Produces: assistant `UiMessage` objects may include `reasoning?: string`

- [ ] **Step 1: Extend type**

```ts
export type UiMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** Native model reasoning / thinking trace for ThoughtTrail */
  reasoning?: string
  // ...existing fields unchanged
}
```

- [ ] **Step 2: Wire streaming in `App.tsx`**

Near the existing `streamChat` call (~line 655):

1. Initialize `let reasoningAcc = ''` beside `let acc = ''`.
2. Create assistant message with `reasoning: ''` optional.
3. Add handler:

```ts
onReasoning: (t) => {
  reasoningAcc += t
  if (!streamFlushRafRef.current) {
    streamFlushRafRef.current = requestAnimationFrame(() => {
      streamFlushRafRef.current = 0
      const contentSnap = acc
      const reasoningSnap = reasoningAcc
      setMessages((msgs) =>
        msgs.map((msg) =>
          msg.id === assistantId
            ? { ...msg, content: contentSnap, reasoning: reasoningSnap }
            : msg,
        ),
      )
    })
  }
},
```

4. Update `onToken` flush to also write current `reasoningAcc` (same map pattern) so content/reasoning stay in sync.
5. Pass enable flag:

```ts
const result = await streamChat(
  activeProvider(settingsRef.current),
  body,
  { onToken, onReasoning, onToolsStripped },
  controller.signal,
  { enableThinking: Boolean(settingsRef.current.deepBuild) },
)
```

6. After stream, final flush must set both `content: acc` and `reasoning: reasoningAcc` (or omit reasoning if empty).
7. Confirm history rebuild (`working.push({ role, content: m.content })`) still **does not** send `reasoning`.

- [ ] **Step 3: Typecheck**

Run: `./node_modules/.bin/tsc -b --pretty false`  
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add src/types/ui.ts src/App.tsx
git commit -m "feat(chat): persist streamed reasoning on assistant messages"
```

---

### Task 4: ThoughtTrail above answers

**Files:**
- Modify: `src/components/MessageContent.tsx`
- Modify: `src/components/ChatStage.tsx`

**Interfaces:**
- Consumes: `ThoughtTrail` (`thoughtText`, `isStreaming`)
- Produces: `MessageContent` props `reasoning?: string`, `reasoningStreaming?: boolean`

- [ ] **Step 1: Extend `MessageContent` props and render order**

```tsx
export interface MessageContentProps {
  content: string
  reasoning?: string
  reasoningStreaming?: boolean
  // ...existing props
}

export function MessageContent({
  content,
  reasoning,
  reasoningStreaming = false,
  // ...
}: MessageContentProps) {
  // existing <think> parse → thinkBlocks + contentWithoutThink

  const nativeReasoning = reasoning?.trim() ?? ''
  const tagBlocks = thinkBlocks.filter((b) => b !== nativeReasoning)

  return (
    <div>
      {nativeReasoning ? (
        <ThoughtTrail thoughtText={nativeReasoning} isStreaming={reasoningStreaming} />
      ) : null}
      {tagBlocks.map((thinkContent, tidx) => (
        <ThoughtTrail key={`think_${tidx}`} thoughtText={thinkContent} />
      ))}
      {/* existing parts map for answer body using contentWithoutThink */}
    </div>
  )
}
```

Preserve existing early-return / code-block behaviour; only change how trails are sourced/ordered.

- [ ] **Step 2: Pass props from `ChatStage`**

```tsx
<MessageContent
  content={/* existing */}
  reasoning={m.role === 'assistant' ? m.reasoning : undefined}
  reasoningStreaming={Boolean(busy && m.id === lastAssistantId)}
  // ...existing
/>
```

If `ChatStage` does not currently receive `busy` / last assistant id, either:
- pass `reasoningStreaming={false}` always (acceptable MVP), or
- add optional `streamingMessageId?: string | null` prop to `ChatStage` from `App.tsx`.

Prefer adding `streamingMessageId` when `busy` for better UX.

- [ ] **Step 3: Typecheck**

Run: `./node_modules/.bin/tsc -b --pretty false`  
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add src/components/MessageContent.tsx src/components/ChatStage.tsx src/App.tsx
git commit -m "feat(ui): show native reasoning in ThoughtTrail above answers"
```

---

### Task 5: Relabel Deep Reasoning toggle

**Files:**
- Modify: `src/components/Composer.tsx`
- Modify: `src/components/SettingsSheet.tsx`
- Modify: `src/components/CommandPalette.tsx`

**Interfaces:**
- Consumes: existing `settings.deepBuild` / `persist`
- Produces: user-visible copy only (no new setting key)

- [ ] **Step 1: Update labels**

Composer pill:
- `title="Deep Reasoning — enable model thinking + thorough agent budget"`
- visible text: `🧠 Deep Reasoning` (or keep short `🧠 Deep` if space-constrained; tooltip must say Deep Reasoning)
- toast: `Deep Reasoning ${next ? 'on' : 'off'}`

SettingsSheet:
- Label: `Deep Reasoning`
- Hint: `Request model thinking traces (ThoughtTrail) and use a larger agent budget when Agent mode is on.`

CommandPalette:
- Title: `Toggle Deep Reasoning (${deepBuild ? 'Currently ON' : 'Currently OFF'})`

- [ ] **Step 2: Typecheck + unit tests**

Run:
```bash
node --experimental-strip-types --test src/lib/thinkingOptions.test.ts
./node_modules/.bin/tsc -b --pretty false
```
Expected: tests pass, tsc exit 0

- [ ] **Step 3: Commit**

```bash
git add src/components/Composer.tsx src/components/SettingsSheet.tsx src/components/CommandPalette.tsx
git commit -m "feat(ui): relabel Deep Build toggle as Deep Reasoning"
```

---

### Task 6: Verification pass

**Files:** none new (manual + automated checks)

- [ ] **Step 1: Automated**

```bash
node --experimental-strip-types --test src/lib/thinkingOptions.test.ts
./node_modules/.bin/tsc -b --pretty false
npm run lint
```

Expected: tests pass; tsc clean; lint no new errors in touched files

- [ ] **Step 2: Manual checklist (record results in commit message or PR body)**

1. Deep Reasoning OFF + Spark/Featherless: network payload has `enable_thinking: false` (or equivalent kwargs); answer streams normally; no native ThoughtTrail unless `<think>` tags appear.
2. Deep Reasoning ON + thinking-capable model: payload has `enable_thinking: true`; ThoughtTrail appears above answer; answer body does not duplicate the reasoning text.
3. Abliteration + Deep Reasoning ON: payload has **no** `chat_template_kwargs`.
4. Session reload: `reasoning` still shows on persisted assistant messages (if sessions persist full `UiMessage` objects).

- [ ] **Step 3: Push branch / open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: Deep Reasoning ThoughtTrail" --body "## Summary
- Split \`reasoning_content\` into \`UiMessage.reasoning\`
- Gate \`enable_thinking\` via Deep Reasoning (\`deepBuild\`) toggle
- Show ThoughtTrail above answers

## Test plan
- [ ] Unit tests for thinking kwargs helper
- [ ] tsc / lint clean
- [ ] Manual: toggle on/off + Abliteration omit kwargs
"
```

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Separate `onReasoning` / no merge into content | Task 2 |
| Return/accumulate reasoning | Task 2–3 |
| `enable_thinking` gated by toggle | Task 1–2, 3 |
| Abliteration omits kwargs | Task 1–2 |
| `UiMessage.reasoning` | Task 3 |
| ThoughtTrail above answer | Task 4 |
| `<think>` fallback | Task 4 |
| Deep Reasoning labels on existing `deepBuild` | Task 5 |
| Omit reasoning from outbound history | Task 3 step 2.7 |
| Tests for kwargs helper | Task 1 |
| Manual verification | Task 6 |

## Placeholder scan

No TBD/TODO steps; code blocks included for each implementation step.

## Type consistency

- Flag: `deepBuild` → passed as `enableThinking` boolean into `streamChat` opts
- Kwargs key: `enable_thinking`
- Delta field: `reasoning_content`
- Handler: `onReasoning`
- Message field: `reasoning`
- UI prop: `reasoning` / `reasoningStreaming`
- Component: `ThoughtTrail` + `thoughtText` / `isStreaming`
