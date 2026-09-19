# DGX Spark Workspace Runtime — Design

**Date:** 2026-09-19  
**Status:** Approved  
**Repo:** `github.com/flak3dd/AIUI` (source of truth on Mac; runtime on DGX only)

## Goal

Run all AIUI/dev workspace execution on the DGX (gx10 / flak3dd) via Spark sandbox-runner, keep the git working tree on the Mac, sync through GitHub, and use SuperServe MicroVMs only for isolated jobs — never as the main AIUI runtime.

## Hard constraints

1. **Never run the workspace on the Mac.** Agents, installs, daemons, Vite, monitors, and npm scripts for AIUI runtime execute on DGX only. Mac is thin client: edit, commit, push, and browse DGX URLs.
2. **Default Spark workspace root:** `/tmp/spark-sandboxes/` on DGX unless the user specifies another path.
3. **One workspace per chat:** each new chat creates a new directory under that root (`workspace1`, `workspace2`, …). Do not reuse another chat's workspace unless the user says so.
4. **Spark for AIUI/dev; SuperServe for isolated jobs only.**
5. **Sync:** Mac `git push` → GitHub `flak3dd/AIUI` → DGX `git pull` (or clone) into the active chat workspace (no rsync / no continuous watch as the primary path).
6. **No `git reset --hard` on main without an explicit ask.** Prefer `git pull --ff-only`; on divergence, stop and surface.

## Architecture

```
Mac AIUI checkout  --push-->  GitHub flak3dd/AIUI  --pull/clone-->  DGX
                                                              /tmp/spark-sandboxes/workspaceN
                                                                    |
                                                                    v
                                                         Spark sandbox-runner :17330
                                                         (AIUI/dev for that chat)
                                                                    |
                                                         (separate) SuperServe MicroVMs
                                                         for isolated jobs only
```

- **Mac:** Owns the human-facing git working tree. No AIUI runtime processes.
- **GitHub `flak3dd/AIUI`:** Sync hub.
- **DGX Spark workspaces:** Root `/tmp/spark-sandboxes/`. Chat 1 → `workspace1`, chat 2 → `workspace2`, etc. Each chat's agent/runtime cwd is that directory unless overridden.
- **DGX SuperServe:** Control/SDK on host; cloud MicroVMs for one-off isolated work only.

### Workspace naming

- Pattern: `/tmp/spark-sandboxes/workspace{N}` with `N` monotonically increasing (or runner-assigned unique id still under `/tmp/spark-sandboxes/`).
- **New chat ⇒ new workspace.** Never default to another chat's tree.
- User may override the path for a given chat; that override does not change the default for future chats.

### Note on `/tmp`

`/tmp/spark-sandboxes/` may be cleared on reboot. Recovery: systemd starts sandbox-runner; new chats allocate fresh `workspaceN` and clone/pull from GitHub. Do not treat Mac `127.0.0.1` as a fallback runtime.

## Components

| Component | Location | Role |
|-----------|----------|------|
| Mac AIUI checkout | Mac | Edit / commit / push only |
| GitHub remote | `flak3dd/AIUI` | Sync hub |
| Spark workspace root | DGX `/tmp/spark-sandboxes/` | Parent of per-chat workspaces |
| Per-chat workspace | `workspace1`, `workspace2`, … | Clone/pull + runtime cwd for that chat |
| sandbox-runner | DGX `:17330` | Create/attach sandboxes; map chat → workspace dir |
| AIUI stack (when that chat runs it) | DGX ports as allocated | App / monitors for that workspace |
| SuperServe | DGX control + cloud MicroVMs | Isolated jobs only |
| Agent guardrail | Memory / policy | Refuse Mac Shell for AIUI runtime |

## Data flow

### Happy path (new chat / AIUI/dev)

1. New chat starts → allocate next `/tmp/spark-sandboxes/workspaceN` on DGX.
2. Clone or pull `flak3dd/AIUI` into that workspace (after Mac has pushed any needed commits).
3. Edit on Mac → commit → `git push origin` when shipping changes into the hub.
4. In the chat's workspace on DGX: `git pull --ff-only` (or re-clone if empty after reboot).
5. If lockfile changed → `npm ci` **inside that workspace on DGX only**.
6. Spark runner runs processes with cwd = that workspace; Mac browser uses **DGX** LAN/Tailscale URLs.

### Isolated job path

1. Request one-off isolated work.
2. Launch SuperServe MicroVM from DGX control env.
3. Copy results/logs back; discard VM.
4. Chat Spark workspace stays up and untouched.

## Ops

- **systemd user unit** for Spark sandbox-runner on `:17330`: start on login/boot, restart on failure.
- Runner (or thin helper) creates `workspaceN` on new chat and records chat↔path mapping.
- Optional pull helper per workspace: fetch + `pull --ff-only` into that chat's dir.
- Health checks: curl runner `:17330` on DGX; per-workspace services on their DGX ports.
- Mac bookmarks / agent URLs must target gx10 (LAN or Tailscale), never Mac `127.0.0.1` for these services.

## Errors

- Non-ff pull → halt update; notify; no force without ask.
- Port bind failure → fail the unit/process; **do not** fall back to Mac runtime.
- SuperServe job failure → chat Spark workspace remains up; surface job logs only.
- Agent tries Mac `npm run dev` / monitors → refuse; redirect to DGX `/tmp/spark-sandboxes/workspaceN`.
- Missing mapping for chat → create next `workspaceN`; do not silently reuse another chat's workspace.

## Acceptance tests

1. Reboot gx10 → `:17330` listens without manual start.
2. Two new chats → two dirs `/tmp/spark-sandboxes/workspace1` and `workspace2` (or equivalent unique siblings); cwd isolation holds.
3. Mac push → pull inside a given `workspaceN` → change visible only there unless other workspaces pull too.
4. Spark serves from the chat's workspace; Mac browser hits **DGX** URL successfully.
5. Mac `127.0.0.1:1733x` does **not** count as success.
6. SuperServe MicroVM job runs without moving AIUI off Spark / without sharing another chat's workspace.
7. Agent policy: Mac Shell for AIUI runtime commands is rejected.

## Out of scope

- Moving the git repo off the Mac.
- Replacing Spark with SuperServe for daily AIUI.
- Chat-response optimizer feature completion (separate; when resumed, runtime still DGX-only per chat workspace).

## Decisions log

| Decision | Choice |
|----------|--------|
| Runtime host | DGX only |
| AIUI git tree | Stays on Mac |
| Sync | GitHub push (Mac) / pull (DGX) |
| Remote | `github.com/flak3dd/AIUI` |
| Approach | A — Spark for AIUI/dev; SuperServe for isolated jobs |
| Default workspace root | `/tmp/spark-sandboxes/` unless user overrides |
| Per chat | New `workspaceN` under that root |
