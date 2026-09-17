# Abliterated Studio — UI/UX Optimisation & Redesign Concept

**Scope:** `web-api-app` (primary) + alignment notes for Expo `abliterated_ui`  
**Date:** 2026-09-17 · **Status:** Phase A/B done · Phase C split shipped — ChatStage / Composer / SessionRail / tabbed SettingsSheet / virtual threads (≥40 msgs)

---

## 1. North star

**One calm “cockpit” for sovereign AI work** — chat is the stage; models, mesh, sandbox, and memory are instruments that stay out of the way until needed.

Today the product feels like a control panel that also chats. The redesign flips that: **chat-first, systems-second**, with progressive disclosure for power users.

---

## 2. Current-state diagnosis

### What’s working
- Strong dark identity (Dracula / Pythonista on web; obsidian + electric blue on Expo)
- Real agent loop: thought trail, inline run, sandbox targets, RAG, MemPalace
- Command palette + session history already exist as power-user foundations

### Friction (why it feels heavy)
| Issue | Evidence | User cost |
|---|---|---|
| **Split brand systems** | Web CSS = Dracula purple; Expo = electric blue / zinc | Looks like two products |
| **Monolith shell** | `App.tsx` ~1.8k after ChatStage/Composer/SettingsSheet split; `styles.css` still large | Easier to refine stage vs composer vs settings |
| **Chrome density** | Top bar + pills + toggles + drawers compete with messages | Cognitive load before first token |
| **Status noise** | Health probes, GPU pill, sandbox, MemPalace all visible | Operators love it; creators don’t |
| **Inconsistent density** | Mac traffic-light code chrome + glass panels + hero | Novelty over hierarchy |
| **Mobile / desktop gap** | Expo chat optimized; web still “dashboard-y” | Same mental model not shared |

### Jobs to be done (JTBD)
1. Ask / steer a local or cloud model quickly  
2. Run agentic fix loops with visible progress, not spam  
3. Peek at files / sandbox / memory only when stuck  
4. Trust that Spark / proxy / sandbox are healthy without staring at them  

---

## 3. Design principles

1. **Chat is 70% of the viewport** — everything else is rail or overlay.  
2. **One accent family** — unify web + Expo on a single token set (proposal below).  
3. **Silence by default** — status collapses to a single mesh pulse; expand on demand.  
4. **Thought = secondary, answer = primary** — trails stay one-line; expand never auto-opens when an answer exists.  
5. **Keyboard parity** — every primary action has a chord (`⌘K`, `⌘Enter`, `⌘.` stop).  
6. **Operator mode is a mode** — not the default chrome.

---

## 4. Visual system (unified tokens)

**Proposal: “Abliterated Night”** — zinc canvas + cyan/violet signal (bridge Expo blue and Dracula purple).

| Token | Value | Role |
|---|---|---|
| `--canvas` | `#09090B` | App background |
| `--surface` | `#121215` | Panels / bubbles |
| `--surface-2` | `#18181C` | Elevated / composer |
| `--border` | `rgba(255,255,255,0.08)` | Hairlines |
| `--text` | `#F4F4F5` | Primary |
| `--muted` | `#A1A1AA` | Meta |
| `--accent` | `#8B5CF6` | Primary actions (violet) |
| `--accent-2` | `#22D3EE` | Thinking / live / mesh |
| `--ok` | `#34D399` | Online / success |
| `--warn` | `#FBBF24` | Degraded |
| `--danger` | `#F43F5E` | Offline / errors |
| `--font-sans` | Inter / system | UI |
| `--font-mono` | JetBrains Mono / Fira Code | Code + telemetry |

**Typography scale:** 12 / 13 / 14 / 16 / 20 / 28 — no ornamental display fonts in product UI.  
**Radius:** 8 / 12 / 16. **Space:** 4-pt grid (match Expo `Space` scale).

---

## 5. Information architecture

```
┌─────────────── Abliterated Studio ────────────────┐
│ [≡] Sessions   Studio          [● Mesh]  [⌘K] [⚙] │
├────────┬──────────────────────────────┬───────────┤
│        │                              │ Context   │
│ Session│         Chat stage           │ (optional)│
│ rail   │   bubbles · thought · tools  │ files /   │
│ (240)  │                              │ sandbox / │
│        │                              │ memory    │
│        ├──────────────────────────────┤           │
│        │ Composer (sticky)            │           │
└────────┴──────────────────────────────┴───────────┘
```

### Regions
1. **Top bar (40px)** — product name, active model chip, single MeshPulse, command palette, settings.  
2. **Session rail** — history / pins / new chat (collapsible; hidden on narrow).  
3. **Chat stage** — messages only + empty QuickStart.  
4. **Context drawer** — Files · Sandbox · Memory · RAG (tabs; closed by default).  
5. **Composer** — multiline input, agent/deep toggles as *icons with labels on hover*, send / stop.

### Modes
| Mode | Chrome | Audience |
|---|---|---|
| **Create** (default) | Minimal top + composer | Daily chat / write |
| **Build** | Thought trail + agent tools visible | Agent / deep build |
| **Operate** | MeshPulse expanded, telemetry, endpoints | Debugging stack |

Toggle: `⌘.` cycles Create → Build → Operate (or Settings → Mode).

---

## 6. Key screen concepts

### 6.1 Empty state — QuickStart (refined)
- One headline: **What are we building?**  
- 4 cards max: Chat · Agent fix · Scaffold · Spark local  
- No wall of toggles; advanced goes to Settings  
- Soft mesh status under cards: `Spark · Proxy · Sandbox` as three dots

### 6.2 Conversation
- User bubbles: right, surface-2, no glow  
- Assistant: left, full-width readable column (`max-width: 720px` centered in stage)  
- Code blocks: **no fake traffic lights**; lang chip + Copy + Run  
- ThoughtTrail: single cycling line while live; completed steps as compact checklist (collapse “N earlier”)  
- Tool / bash results: inset terminal strip, not a second chat bubble style

### 6.3 Composer
- Sticky bottom glass surface  
- `Shift+Enter` newline · `Enter` send (document in ghost hint)  
- Left: `+` attach / context; Right: model chip · Agent · Send  
- Deep Build lives under Agent overflow menu (not always-on toggle)

### 6.4 MeshPulse (replaces GPU pill + diagnostics strip clutter)
- Idle: one green/amber/red dot + label `Mesh`  
- Hover / click: popover with Spark / Proxy / Sandbox / MemPalace latency  
- Matches Expo DiagnosticsStrip intent with less permanent chrome

### 6.5 Settings (sheet, not page dump)
Tabs: **Model · Mesh · Agent · Memory · Appearance**  
API keys masked; Spark host/port; proxy toggle; theme (Night / Classic Dracula)

---

## 7. UX optimisation (ship without full visual redesign)

Prioritised for impact / effort:

| # | Optimisation | Why |
|---|---|---|
| 1 | Cap message column width + increase line-height | Readability #1 |
| 2 | Collapse thought by default when answer present | Already started on Expo; port to web |
| 3 | MeshPulse consolidation | Cuts probe anxiety + visual noise |
| 4 | Defer model list fetch until picker open | Faster first paint |
| 5 | Virtualise long threads (`content-visibility` / windowing) | Large agent logs |
| 6 | Extract `ChatStage`, `Composer`, `SessionRail` from `App.tsx` | Enables iterative UI work |
| 7 | Reduce permanent toggles → overflow menus | Create mode calm |
| 8 | Unifyментировать keyboard map in palette footer | Power-user speed |
| 9 | Align web tokens to Expo Night palette | One brand |
| 10 | Respect `prefers-reduced-motion` on thought cycles | Accessibility |

---

## 8. Interaction & motion

- **Duration:** 120–180ms ease-out for drawers; no bounce  
- **Thought cycle:** 900ms step, pause when tab hidden  
- **Streaming:** caret / soft shimmer on assistant bubble only  
- **Toasts:** bottom-center, max 1 visible, 3s (success/error only)

---

## 9. Accessibility

- Focus rings use `--accent` (never remove outline)  
- Contrast ≥ WCAG AA on muted text against canvas  
- Hit targets ≥ 44px on touch; composer buttons ≥ 36px desktop  
- Screen reader: announce “assistant finished” / “tool failed” via live region  

---

## 10. Cross-app alignment (Expo ↔ web)

| Surface | Keep | Change |
|---|---|---|
| ThoughtTrail / cycling line | Shared concept | Shared copy + timing constants |
| InputDock behaviour | Multiline paste, Shift+Enter | Match web composer hints |
| Colors | Expo Night tokens | Port CSS vars on web to match |
| Mesh probing | 60s chat / 20s radar | Same intervals on web health UI |
| AgentRunCard | Overview freeze | Port compact trail to web |

---

## 11. Phased roadmap

### Phase A — Calm (3–5 days)
Token unify · MeshPulse · composer cleanup · thought collapse · column width  
*No new features — subtract chrome.*

### Phase B — Structure (1 week)
Split `App.tsx` into stage/rail/composer · session rail polish · settings sheet tabs  

### Phase C — Operate mode (optional)
Full telemetry drawer · endpoint matrix · Spark start/stop from UI (calls `start-stack.sh` status)

### Phase D — Visual craft
Optional Superdesign canvas variants (Night vs Classic Dracula) → pick one → implement  

---

## 12. Success metrics

- Time-to-first-keystroke on cold load ↓  
- Clicks before first send ≤ 1 (empty state → type)  
- % of session with Context drawer closed ≥ 80%  
- Subjective: “feels like Cursor chat, not a NOC board”

---

## 13. Open decisions (for you)

1. **Default mode:** Create or Build?  
2. **Brand:** Abliterated Night (zinc+violet) vs keep Classic Dracula on web only?  
3. **Session rail:** always visible on desktop, or `⌘B` toggle like VS Code?  
4. **Render on Superdesign canvas** for visual comps? (login required)

---

*Concept owner: Grok Bot · Surfaces: web-api-app + Expo chat*


---

## 12. Implementation notes (2026-09-17)

Shipped on web AIUI:
- Chat-first empty state (`QuickStartHero` — 4 plain cards)
- Composer progressive disclosure (`Options` / `Agent` always visible; model/provider/toggles behind Options)
- Calm CSS overlay on Boldface tokens (720px reading column, pill chrome, quieter header)
- Softened operator jargon in header/tools/toasts
- Mesh status collapsed to three dots on empty state

Still open: extract `ChatStage` / `Composer` / `SessionRail` from `App.tsx`; settings sheet tabs; virtualise long threads.
