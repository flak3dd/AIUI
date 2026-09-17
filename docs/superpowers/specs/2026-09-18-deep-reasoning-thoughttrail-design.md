# Deep Reasoning → ThoughtTrail Design

Date: 2026-09-18  
Repo: AIUI (`flak3dd/AIUI`)  
Status: Approved approach (user); awaiting spec review before implementation

## Problem

Thinking-capable models stream `delta.reasoning_content`, but AIUI today:

1. Force-sets `chat_template_kwargs.enable_thinking: false` for non-Abliteration providers.
2. Merges any `reasoning_content` into the normal answer `content` and feeds it through `onToken`.
3. Only shows `ThoughtTrail` when the answer text contains `<think>…</think>` tags.

So native reasoning never appears as a distinct trail above the answer, and users cannot opt into deeper thinking.

## Goal

- Show model `reasoning_content` as a **ThoughtTrail above each assistant answer**.
- Add a **Deep Reasoning** option that gates whether thinking is requested from the provider.
- Keep the existing `<think>` tag path as a fallback for models that only emit tags in content.

## Non-goals

- Changing agent round limits / thorough-build behaviour beyond reusing or clarifying the existing `deepBuild` control (see Toggle section).
- Building a new reasoning UI from scratch (reuse `ThoughtTrail`).
- Persisting raw reasoning to MemPalace by default (optional follow-up).
- Enabling thinking on Abliteration if the provider forbids `chat_template_kwargs` (keep current omit behaviour).

## Approaches considered

1. **Split stream + Deep Reasoning toggle (chosen)** — separate `reasoning` field; toggle gates `enable_thinking`.
2. Prompt-only `<think>` — weak for models that only emit `reasoning_content`.
3. Always-on thinking — higher latency/cost; no user control.

## Design

### 1. Streaming API (`src/lib/api.ts`)

- Extend `StreamHandlers` with optional `onReasoning?: (text: string) => void`.
- When `delta.reasoning_content` arrives:
  - Append to an internal `reasoning` accumulator (returned from `streamChat`).
  - Call `onReasoning` (not `onToken`).
  - **Do not** append reasoning into answer `content`.
- When `delta.content` arrives: keep current `onToken` / `content` behaviour.
- Return shape: `{ content, reasoning, tool_calls, finishReason, toolsStripped? }`.
- `buildStreamBody`:
  - Abliteration: still omit `chat_template_kwargs` (provider constraint).
  - Other providers: set `chat_template_kwargs.enable_thinking` to **`true` iff Deep Reasoning is on**, else `false`.
- Pass a boolean (or settings flag) into `buildStreamBody` / `streamChat` so the request matches the toggle. Prefer an explicit `enableThinking?: boolean` argument over reading settings inside `api.ts`.

### 2. Message model (`src/types/ui.ts`)

```ts
export type UiMessage = {
  // ...existing fields
  /** Native model reasoning / thinking trace (shown in ThoughtTrail) */
  reasoning?: string
}
```

- Session persistence already stores `messages`; include `reasoning` so trails survive reload.
- Do not put reasoning into OpenAI-history `content` when rebuilding API turns (answers only), unless a provider requires it — default: **omit reasoning from outbound chat history**.

### 3. App streaming (`src/App.tsx`)

- On assistant placeholder creation, initialize `reasoning: ''` (or omit until first chunk).
- `onReasoning`: append into the streaming assistant message’s `reasoning` field.
- `onToken`: append into `content` only.
- After stream completes, keep final `reasoning` on the message.
- Wire `enableThinking: settings.deepBuild` (see Toggle) into `streamChat` / body builder for both chat and agent paths that call the API.

### 4. UI (`MessageContent` / chat render path)

- Prefer `message.reasoning` for `ThoughtTrail` when non-empty.
- Still strip/parse `<think>…</think>` from `content` as today; if both exist, show **native reasoning first**, then tag-based blocks (or merge only if identical — prefer first-only to avoid duplicates).
- Pass `isStreaming` into `ThoughtTrail` while the assistant message is the in-flight one and reasoning is still growing.
- Place ThoughtTrail **above** the answer body.

### 5. Deep Reasoning toggle

- **Reuse existing `settings.deepBuild`** as the backing flag (already in Composer pill, Settings sheet, Command Palette).
- **Rename user-visible labels** to “Deep Reasoning” (subtitle may still mention thorough agent behaviour where `deepBuild` also bumps agent rounds — keep that behaviour; document it as combined “deeper think + more agent budget”).
- When OFF: `enable_thinking: false`; ThoughtTrail only if `<think>` tags or leftover stored `reasoning`.
- When ON: `enable_thinking: true` (non-Abliteration); native reasoning streams into ThoughtTrail.

If product later wants to split “thorough agent” from “model thinking”, introduce `settings.enableThinking` and migrate; out of scope for this change.

### 6. Tests

- Unit-test a small pure helper or body builder: `enableThinking` true/false → kwargs; Abliteration omits kwargs.
- Unit-test / lightweight test that reasoning chunks do not concatenate into `content` (extract reducer if needed).
- Manual: Spark (or local thinking model) with toggle ON → ThoughtTrail above answer; OFF → no thinking kwargs / no native trail.

## Success criteria

- With Deep Reasoning ON and a thinking model: reasoning appears in ThoughtTrail above the answer; answer body is free of duplicated reasoning text.
- With Deep Reasoning OFF: request does not ask for thinking (non-Abliteration); UI unchanged aside from any `<think>` fallback.
- Existing `<think>` ThoughtTrail behaviour still works.
- Abliteration requests still omit forbidden `chat_template_kwargs`.
- `tsc -b` clean; existing goal-check work unaffected (separate branch).

## Implementation notes (non-binding)

Likely touch: `src/lib/api.ts`, `src/types/ui.ts`, `src/App.tsx`, `src/components/MessageContent.tsx` (and/or ChatStage), Composer/Settings/CommandPalette labels, optional tiny helper + tests under `src/lib/`.
