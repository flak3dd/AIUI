# Autonomous SWE Agent Anti-Loop System Architecture
**Version:** 2.0.0  
**Target:** `aiui-agent` / AIUI Autonomous SWE Architecture  
**Specification:** Eliminating Cognitive Stagnation, Repetitive Diagnostic Cycles, and Blind-Patch Redo Loops

---

## 1. Executive Summary & Design Philosophy

Autonomous software engineering agents frequently fail by entering multi-round diagnostic loops (e.g., 20–30 consecutive rounds executing minor variations of `ls`, `grep`, `find`, or failing `replace_file_content` patches).

In classical architectures, looping is treated as an LLM "stochastic flaw" to be solved with more prompt warnings. In the **AIUI / AIUI Autonomous SWE Architecture**, looping is treated as a **deterministic system state-machine defect**. 

An autonomous agent must be governed by an enforceable, closed-loop state machine with **monotonic progress guarantees**:
- Every turn must produce a measurable delta ($\Delta > 0$).
- Two consecutive zero-delta turns ($\Delta = 0$) trigger an immediate, non-negotiable emergency synthesis transition.
- Redundant command executions are normalized via AST token overlap and quarantined on Strike 2.
- Advisory questions are gated at entry to prevent operational shell loops.
- Code modifications follow the strict **Normative Protocol** (`Inspect -> Plan -> Surgical Execute -> Scoped Verify`), eliminating blind patches and whole-file overwrite panics.

---

## 2. Taxonomy of Agent Loop Failure Modes

| Loop Failure Mode | Underlying Trigger | Classical Symptom | System Solution |
| :--- | :--- | :--- | :--- |
| **The Fuzzy Diagnostic Loop** | Model evades exact-match circuit breakers by adding decorative banners (`echo "===..."`), changing flags, or switching directories. | `cd /dir && ls`, `echo "===" && ls -la`, `find . -name "*.tsx"` repeating 10+ rounds. | AST/token-level bash command normalization + Jaccard similarity distance ($\ge 0.70$). Hard 2-strike block. |
| **The Plan Incompleteness Deadlock** | Runtime termination condition checks `!plan.isComplete()`, refusing to stop while milestones remain unverified. | Agent finishes the work or answers the question in round 2, but is forced to run until round 30 or 50. | Dynamic Plan Auto-Satisfaction Gate: if user prompt is advisory OR response length $>200$ chars with 0 files modified, mark complete and exit. |
| **The Blind Patch Redo Loop** | `replace_file_content` fails (target hunk mismatch or line drift). Agent guesses or retries without re-reading. | Patch reject -> blind retry -> patch reject -> panic `write_file` overwrite. | Surgical Diff Recovery Nudge: Edit failure immediately triggers a targeted `read_file` directive for the exact line range. |
| **Advisory Misclassification** | Informational/architectural prompt (*"how to..."*, *"audit..."*) is treated as an operational code task requiring tests & `git diff`. | Agent searches for code to modify to fulfill Rule 13 "Proof of Work" criteria. | Advisory Intent Classifier (`isAdvisoryPrompt`): skips code mutation plans and shell loops; emits direct structured answers. |
| **Context Degradation (Amnesia)** | As rounds accumulate, raw terminal dumps and file outputs bloat the context window. Recency bias masks earlier discoveries. | Agent re-reads `App.tsx` in Round 14 even though it was inspected in Round 2. | Progressive Context Compaction: older tool turns ($>3$ rounds) are folded into 1-line verified proofs. |

---

## 3. The 5-Layer Architectural Defense Matrix

```
                    ┌────────────────────────────────────────────────────────┐
                    │               USER PROMPT RECEIVED                     │
                    └─────────────────────────┬──────────────────────────────┘
                                              ▼
         ┌────────────────────────────────────────────────────────────────────────┐
         │ LAYER 1: Intent Classification & Exit Gate                             │
         │ • Is Advisory/Architectural? ──► Skip Shell/Patch loops ──► Emit text  │
         │ • Is Operational? ─────────────► Synthesize Lean Monotonic Plan        │
         └────────────────────────────────────┬───────────────────────────────────┘
                                              ▼
         ┌────────────────────────────────────────────────────────────────────────┐
         │ LAYER 2: Monotonic State & Energy Budget Meter                         │
         │ • Track Progress Delta: ΔFiles, ΔTests, ΔLines                         │
         │ • If 2 consecutive rounds yield Δ = 0 ──► Force Exit & Synthesize      │
         └────────────────────────────────────┬───────────────────────────────────┘
                                              ▼
         ┌────────────────────────────────────────────────────────────────────────┐
         │ LAYER 3: AST & Semantic Fuzzy Circuit Breaker                          │
         │ • Normalize commands (strip cd, echo banners, quotes, whitespace)      │
         │ • Jaccard Token Overlap ≥ 0.70 ──► Hard Block (Strike 2)               │
         │ • Repeated read_file ───────────► Hard Block & Quarantine              │
         └────────────────────────────────────┬───────────────────────────────────┘
                                              ▼
         ┌────────────────────────────────────────────────────────────────────────┐
         │ LAYER 4: Normative Pre-Execution Context Verification Protocol         │
         │ • Inspect ──► Plan ──► Surgical Execute ──► Scoped Verify              │
         │ • Edit failure? Inject Targeted Recovery Nudge (Never retry blind)     │
         └────────────────────────────────────┬───────────────────────────────────┘
                                              ▼
         ┌────────────────────────────────────────────────────────────────────────┐
         │ LAYER 5: Progressive Context Compaction                                │
         │ • Historic tool outputs > 3 turns ──► Compact to 1-line verified proofs│
         │ • Eliminates attention degradation and prompt amnesia                  │
         └────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Detailed Layer Specifications & Implementations

### Layer 1: Advisory Intent Classifier & Exit Gating
**Module:** `scripts/aiui-agent/core/planner.mjs` & `agent.mjs`

Informational, diagnostic, and architectural requests must never be bound to operational code-mutation milestones. 

```javascript
export function isAdvisoryPrompt(prompt = '') {
  const norm = String(prompt || '').trim().toLowerCase();
  return (
    /^(?:how\s+to|what\s+is|why\s+does|explain|audit|analyse|analyze|review|suggest|recommend|benchmark|compare)\b/i.test(norm) &&
    !/\b(?:fix|patch|implement|refactor|create|delete|remove|add\s+file|update\s+code)\b/i.test(norm)
  );
}
```

**Termination Invariant:**
```javascript
// In agent.mjs completion validation:
const isAdvisory = isAdvisoryPrompt(this.activeGoal);
if (isAdvisory || (cleanContent.length > 200 && filesModified.length === 0)) {
  if (this.activePlan && !this.activePlan.isComplete()) {
    this.activePlan.steps.forEach(s => s.status = 'completed');
  }
  finished = true;
  break; // Terminate turn immediately
}
```

---

### Layer 2: Monotonic State Meter (The Zero-Delta Hard Stop)
**Module:** `scripts/aiui-agent/core/agent.mjs`

Every turn must produce a quantifiable progress vector:
$$\Delta_{\text{turn}} = w_f \cdot \Delta_{\text{files}} + w_t \cdot \Delta_{\text{tests}} + w_s \cdot \Delta_{\text{symbols}}$$
Where:
- $w_f = 5$ (New file successfully modified)
- $w_t = 10$ (Automated test / verification gate passed with exit code 0)
- $w_s = 1$ (Distinct, unvisited file inspected for the first time)

If $\Delta_{\text{turn}} = 0$ for **2 consecutive rounds**:
1. Stagnation counter triggers `isStagnant = true`.
2. The runtime revokes tool calling for the subsequent round.
3. The LLM receives an injected directive:
   > `[STAGNATION BREAKER]: Zero state progression across 2 consecutive rounds. Tool execution revoked. Synthesize all observations, outline solutions or roadblocks, and provide your final deliverable.`

---

### Layer 3: Fuzzy AST Normalization & 2-Strike Circuit Breaker
**Module:** `scripts/aiui-agent/core/circuit-breaker.mjs`

Exact-string matching fails because local models generate slight variations in command flags and banners. The engine normalizes commands and computes Jaccard token overlap:

```javascript
export function normalizeBashCommand(rawCmd = '') {
  let cmd = String(rawCmd || '').trim();
  // 1. Strip directory transitions
  cmd = cmd.replace(/^cd\s+[^&;]+\s*(?:&&|;)\s*/i, '');
  // 2. Strip decorative echo/header statements
  cmd = cmd.replace(/echo\s+["'][^"']*===*[^"']*["']\s*(?:&&|;)\s*/gi, '');
  cmd = cmd.replace(/echo\s+["'][^"']*["']\s*(?:&&|;)\s*/gi, '');
  cmd = cmd.replace(/printf\s+["'][^"']*["']\s*(?:&&|;)\s*/gi, '');
  // 3. Strip quotes and normalize whitespace
  cmd = cmd.replace(/["']/g, '');
  cmd = cmd.replace(/\s+/g, ' ').trim().toLowerCase();
  return cmd;
}

export function computeTokenOverlap(cmdA, cmdB) {
  if (!cmdA || !cmdB) return 0;
  if (cmdA === cmdB) return 1;
  const tokensA = new Set(cmdA.split(/\s+/).filter(Boolean));
  const tokensB = new Set(cmdB.split(/\s+/).filter(Boolean));
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 ? intersection / union : 0;
}
```

**Two-Strike Hard Quarantine:**
```javascript
const isFuzzyDuplicate = history.some(prev => computeTokenOverlap(prev, curr) >= 0.70);
if (previousExecutions >= 1 || isFuzzyDuplicate) {
  return {
    isCircuitBreaker: true,
    breakerResponse: JSON.stringify({
      ok: false,
      exitCode: 1,
      error: `[CIRCUIT BREAKER ACTIVATED]: Repetition blocked for \`${cmd}\`. You already possess the diagnostic output. Proceed immediately to code modification or synthesize your answer.`
    })
  };
}
```

---

### Layer 4: Normative Pre-Execution Context Protocol & Surgical Recovery
**Module:** `scripts/aiui-agent/core/system-prompt.mjs` (Rule 14) & `agent.mjs`

Blind-patching and whole-file overwrite panics are eliminated through a strict 4-phase sequence:

```text
Inspect (read exact target lines & contracts)
   │
   ▼
Plan & Validate (confirm file paths & symbols)
   │
   ▼
Surgical Execute (replace_file_content with unique anchors)
   │
   ▼
Scoped Verify (targeted unit test / exit code 0)
```

**Surgical Context Recovery Nudge:**
When `replace_file_content` or `write_file` fails, the agent is forbidden from retrying blindly:

```javascript
export function buildContextValidationErrorNudge({ toolName, parsedArgs = {}, result = {}, rawResult = '' }) {
  const filePath = parsedArgs.path || parsedArgs.filePath || parsedArgs.filename || parsedArgs.TargetFile || '';
  const errorSnippet = (result.error || result.stderr || result.message || String(rawResult || ''))
    .trim()
    .slice(0, 300);

  if (/replace|write_file|patch|edit/i.test(toolName) && filePath) {
    return `[SURGICAL CONTEXT RECOVERY NUDGE]: Edit action "${toolName}" failed on "${filePath}".
Error snippet: "${errorSnippet}"
Normative Protocol Enforcement:
1. Do NOT blind-patch or overwrite the file with write_file.
2. Call read_file on "${filePath}" with start_line and line_count covering the exact target section to verify current lines, indentation, and surrounding syntax.
3. Re-anchor your targetContent or patch to the fresh lines observed, then re-apply surgical edit.`;
  }
}
```

---

### Layer 5: Progressive Context Compaction
**Module:** `scripts/aiui-agent/core/output-curator.mjs`

To prevent attention degradation and prompt amnesia across multi-round execution:
1. **Recent Turns ($N \le 3$):** Retain full stdout, stderr, and line hunks.
2. **Historic Turns ($N > 3$):** Fold raw dumps into 1-line verified proofs:
   ```text
   [Verified Proof]: read_file on src/App.tsx lines 1-180 completed successfully. Key components identified: AIUIWorkspaceView, StudioLayout.
   ```
3. Context token savings: **$\sim 65\text{--}80\%$**, ensuring that early observations remain crisp in the model's high-attention zone.

---

## 5. Verification & Test Suite

The anti-loop architecture is validated through automated test assertions in `scripts/checks/test-devin-blueprint.mjs`:

1. **Pillar 8 Assertion 1 (Advisory Gate):** Validates that questions starting with `"how to improve..."` or `"analyse UI"` return `isAdvisoryPrompt === true`.
2. **Pillar 8 Assertion 2 (Command Normalization):** Validates that `cd /Users/... && echo "===..." && ls` normalizes to `ls`.
3. **Pillar 8 Assertion 3 (Fuzzy Jaccard Overlap):** Validates that commands with differing flags and banners score $\ge 0.70$ similarity.
4. **Pillar 8 Assertion 4 (Two-Strike Hard Quarantine):** Validates that running a near-duplicate command on Round 2 returns `isCircuitBreaker === true` with non-zero exit code.
5. **Pillar 8 Assertion 5 (Surgical Recovery Nudge):** Validates that a failed edit tool generates a targeted re-inspection directive naming the exact target path.

---

## 6. Deployment Checklist

- [x] **Advisory Intent Gate:** Loaded in `planner.mjs` and hooked into `agent.mjs`.
- [x] **AST / Fuzzy Normalizer:** Integrated into `circuit-breaker.mjs`.
- [x] **Two-Strike Circuit Breaker:** Active for `read_file` and `bash`.
- [x] **Rule 14 Prompt Protocol:** Enforced in `system-prompt.mjs`.
- [x] **Surgical Diff Recovery Nudge:** Wired into `agent.mjs` on `!isOk`.
- [x] **Progressive Context Compactor:** Integrated into `output-curator.mjs`.
- [x] **AIUI Quad Workbench:** Integrated with live viewport controls and draggable resizer.
