# Refine Agent Response Workflow System (Updated)

**Date:** 2026-09-19  
**Status:** Ready for implementation review  
**Target:** abliterated-ide harness (`harnessGates.ts`, `turnWorkflow.ts`, `verifyDone.ts`, `systemPrompt.ts`, `useAgentLoop.ts`)  
**Goal:** Cut trial-and-error edit cycles (blind patch → fail → backtrack) without turning every turn into ceremony.

---

## Verdict on the prior draft

---

## Non-goals

- No full rewrite of the agent loop architecture.
- Only ban *uninspected* writes to existing paths.
- No silent Mac workspace runtime (DGX `/tmp/spark-sandboxes/workspaceN` remains the execution home when this harness drives Spark/AIUI work).

---

## Target workflow (normative)

```
Inspect (read exact lines / signatures / imports)
    → Plan & Validate (name files, symbols, risk, success checks)
    → Surgical Execute (minimal diff / write only inspected targets)
    → Scoped Verify (typecheck/lint/test only what changed; or compile the touched module)
```

**Blind patch rule:** Emitting a diff or `write_file` against a path whose relevant lines were not loaded this turn (or marked still-valid from an earlier inspect in the same turn) is a gate failure.

**Create exception:** `write_file` to a path that does not exist may proceed without a prior read. If the path exists on disk, treat as edit → inspect required.

**Tool-error rule:** Non-zero exit, empty target, or patch reject → inject recovery nudge → force inspect (or re-read failed path) → only then allow new edit fences. Do **not** mark the parent goal failed or wipe completed inspect steps.

---

## Proposed changes

### 1. `systemPrompt.ts` — Pre-Execution Context Verification Protocol

**MODIFY** active `SYSTEM_PROMPT` with a **short** block (aim ≤12 lines), e.g.:

```text
## Pre-Execution Context Verification
Before any edit to an existing file:
1. Read the exact target lines (and imports/signatures you will touch).
2. Confirm path, symbol names, and call contracts still match reality.
3. Prefer surgical diffs over full-file rewrites.
Never blind-patch: editing without those lines in context causes patch failures and redo loops.
On tool error / empty target / patch reject: re-inspect that path before writing again.
New files: create allowed without a prior read; if the path already exists, inspect first.
After edits: scoped verify (touched files/symbols only) before claiming done.
```

**Do not** duplicate the entire harness doc into the prompt.

---

### 2. `harnessGates.ts` — Harder inspect-before-write

**MODIFY** `needsInspectBeforeWrite`:

- Return **true** for every edit to a path that already exists (including `write_file` overwrite).
- Return **false** only when creating a path that does not exist (stat/missing).
- Treat “context stale” if the last inspect for that path is absent this turn OR file mtime/hash changed since inspect (if hash already available; otherwise same-turn inspect flag is enough for v1).

**ADD** `buildContextValidationErrorNudge(toolResult)`:

- Trigger when tool result has error, non-zero exit, `not found`, empty grep/read target, or patch apply failure.
- Nudge content: name the path, quote the error briefly, instruct: re-read target → adjust plan → then edit. No generic “try again.”

---

### 3. `turnWorkflow.ts` — Phase tracking without full reset

**MODIFY** `buildTurnPlan` / `syncStepsFromRun`:

- Steps expose: `inspect` → `validate` → `edit` → `verify` (names can map to existing step enums).
- `edit` cannot become `active` until required paths have `inspect` satisfied.
- On tool error during `edit` or `verify`:
  - Mark current edit/verify step `pending` or `blocked` (not `done`).
  - Re-activate `inspect` for the failed path only.
  - Preserve completed inspect/validate for untouched paths.

---

### 4. `useAgentLoop.ts` — Intercept failures before next codegen

**MODIFY** tool-result handling:

- After tool failure / non-zero exit, **before** the next model turn that may emit code fences:
  1. Append `buildContextValidationErrorNudge(...)`.
  2. Set gate flag `requireInspectBeforeEdit = true` for implicated paths.
- Do not auto-emit fix patches in the harness itself — only force the model through inspect again.

---

### 5. `verifyDone.ts` — Scoped verify (explicit)

**MODIFY** done criteria:

- “Done” requires scoped verify evidence for touched paths (diagnostics clean on those files, or targeted test/smoke named in the plan).
- Full `npm test` / monorepo smoke is **optional** unless the plan marked cross-cutting risk.
- Align with existing `verifyDone` helpers; don’t invent a second done channel.

---

## Implementation tasks (bite-sized)

### Task A — Prompt protocol
- [ ] Patch `SYSTEM_PROMPT` with the short Pre-Execution block above.
- [ ] Grep prompt tests / snapshots; update expected strings.

### Task B — Gates
- [ ] Extend `needsInspectBeforeWrite` for existing-file `write_file`.
- [ ] Add `buildContextValidationErrorNudge` + unit tests (error, empty target, patch reject, clean success → no nudge).

### Task C — Turn workflow
- [ ] Track per-path inspect satisfaction in turn state.
- [ ] On tool error: demote edit/verify for failed path; keep other path progress.
- [ ] Tests: happy path inspect→edit; error mid-edit reopens inspect only.

### Task D — Agent loop interception
- [ ] Wire nudge injection in `useAgentLoop.ts` on tool failure.
- [ ] Integration/smoke: failed `apply_patch` then next model message contains nudge and gate blocks edit until read.

### Task E — Scoped verify
- [ ] Tighten `verifyDone.ts` to accept scoped evidence; document full-suite as opt-in.

---

## Verification plan

### Automated
```bash
npm run smoke
npm run test:agent-mode
```
(Plus any existing harness unit targets for gates/workflow.)

### Manual
1. Multi-file edit request: confirm reads land before first patch.
2. Introduce a deliberate patch miss / wrong symbol: confirm nudge + re-read before next write.
3. New file create: confirm no forced pre-read.
4. Overwrite existing via `write_file`: confirm inspect required.
5. Claim done after edit: confirm scoped verify ran; full suite not forced.

### Success metrics ( qualitatively )
- Fewer “patch failed / file changed / cannot find context” redo loops in agent transcripts.
- No increase in turns spent only on ritual reads for brand-new files.

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Prompt too long → model ignores | Keep ≤12 lines; enforce in gates not prose |
| Over-blocking on creates | Explicit non-existent path exception |
| Error handler resets whole turn | Path-scoped demotion only |
| Verify becomes full CI every time | Scoped-by-default in `verifyDone` |
| Stale inspect same turn after external edit | Optional hash/mtime check in v2 if needed |

---

## Open questions

None blocking. Optional later:
- Persist inspect fingerprints across turns for long sessions?
- Auto-run file-level tsc vs IDE diagnostics only?

---

## Execution note

When implementing against Spark/AIUI-connected workspaces, run the harness and tests from the **DGX** workspace under `/tmp/spark-sandboxes/workspaceN` (or the active chat workspace), not as a Mac-local runtime — Mac remains git/edit client only.
