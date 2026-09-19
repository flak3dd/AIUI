# DGX Spark Workspace Runtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every chat’s workspace run on the DGX under `/tmp/spark-sandboxes/workspaceN` (new chat → new workspace), keep AIUI git on the Mac, sync via GitHub, auto-start Spark sandbox-runner on `:17330`, and keep SuperServe for isolated jobs only.

**Architecture:** Mac edits/pushes to `github.com/flak3dd/AIUI`. DGX sandbox-runner (in `~/abliterated_ui`) allocates `workspace1`, `workspace2`, … under `/tmp/spark-sandboxes/`, clones/pulls the repo into that dir, and runs all AIUI/dev commands there. SuperServe MicroVMs stay out of band for isolated jobs. Mac never hosts the runtime.

**Tech Stack:** Node.js sandbox-runner (`~/abliterated_ui/scripts/sandbox-runner.mjs`), systemd user unit, git + GitHub, optional small Mac ship script in AIUI, bash health checks.

**Spec:** `docs/superpowers/specs/2026-09-19-dgx-spark-workspace-runtime-design.md`

## Global Constraints

- Never run AIUI/dev workspace runtime on the Mac (no Vite/monitors/`npm` runtime as the live environment).
- Default workspace root: `/tmp/spark-sandboxes/` unless user overrides.
- Each new chat → new `workspaceN` directory; do not reuse another chat’s workspace by default.
- Sync: Mac `git push` → GitHub → DGX `git pull --ff-only` (or clone) into the chat workspace.
- No `git reset --hard` on main without explicit user ask.
- SuperServe = isolated jobs only; Spark = AIUI/dev.
- Runner listen port: `17330` (existing `SANDBOX_PORT`).
- All DGX file/process work for this plan runs on host `flak3dd` / `gx10`, not on the Mac checkout as a live server.

---

### Task 1: Workspace allocator (`workspaceN` + chat mapping)

**Files:**
- Create: `/home/flak3dd/abliterated_ui/scripts/sandbox-workspaces.mjs`
- Modify: `/home/flak3dd/abliterated_ui/scripts/sandbox-runner.mjs` (import allocator; wire `/api/sandbox/workspace`)
- Test: `/home/flak3dd/abliterated_ui/scripts/sandbox-workspaces.test.mjs`

**Interfaces:**
- Consumes: existing `SANDBOX_BASE_LOCAL` / `SANDBOX_BASE_REMOTE` (`/tmp/spark-sandboxes`)
- Produces:
  - `allocateWorkspace({ chatId, baseDir? }) → { envId: "workspaceN", path, chatId, created }`
  - `resolveWorkspace({ chatId|envId, baseDir? }) → { envId, path } | null`
  - `listWorkspaces(baseDir?) → Array<{ envId, path, chatId? }>`
  - Persistence file: `/tmp/spark-sandboxes/_registry.json` mapping `chatId → envId`

- [ ] **Step 1: Write the failing test**

```js
// sandbox-workspaces.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  allocateWorkspace,
  resolveWorkspace,
} from "./sandbox-workspaces.mjs";

const base = await mkdtemp(path.join(os.tmpdir(), "spark-ws-"));
try {
  const a = await allocateWorkspace({ chatId: "chat-a", baseDir: base });
  assert.equal(a.envId, "workspace1");
  assert.ok(a.path.endsWith("workspace1"));
  const b = await allocateWorkspace({ chatId: "chat-b", baseDir: base });
  assert.equal(b.envId, "workspace2");
  const again = await allocateWorkspace({ chatId: "chat-a", baseDir: base });
  assert.equal(again.envId, "workspace1"); // same chat reuses
  const resolved = await resolveWorkspace({ chatId: "chat-b", baseDir: base });
  assert.equal(resolved.envId, "workspace2");
} finally {
  await rm(base, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (on DGX): `cd ~/abliterated_ui && node --test scripts/sandbox-workspaces.test.mjs`

Expected: FAIL — module not found / export missing.

- [ ] **Step 3: Write minimal implementation**

```js
// sandbox-workspaces.mjs
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE = process.env.SANDBOX_BASE || "/tmp/spark-sandboxes";
const REGISTRY = "_registry.json";

async function loadRegistry(baseDir) {
  try {
    return JSON.parse(await readFile(path.join(baseDir, REGISTRY), "utf8"));
  } catch {
    return { next: 1, chats: {} };
  }
}

async function saveRegistry(baseDir, reg) {
  await mkdir(baseDir, { recursive: true });
  await writeFile(path.join(baseDir, REGISTRY), JSON.stringify(reg, null, 2));
}

export async function allocateWorkspace({ chatId, baseDir = DEFAULT_BASE }) {
  if (!chatId) throw new Error("chatId required");
  await mkdir(baseDir, { recursive: true });
  const reg = await loadRegistry(baseDir);
  if (reg.chats[chatId]) {
    const envId = reg.chats[chatId];
    const dir = path.join(baseDir, envId);
    await mkdir(dir, { recursive: true });
    return { envId, path: dir, chatId, created: false };
  }
  const envId = `workspace${reg.next}`;
  reg.next += 1;
  reg.chats[chatId] = envId;
  const dir = path.join(baseDir, envId);
  await mkdir(dir, { recursive: true });
  await saveRegistry(baseDir, reg);
  return { envId, path: dir, chatId, created: true };
}

export async function resolveWorkspace({
  chatId,
  envId,
  baseDir = DEFAULT_BASE,
}) {
  const reg = await loadRegistry(baseDir);
  const id = envId || (chatId ? reg.chats[chatId] : null);
  if (!id) return null;
  return { envId: id, path: path.join(baseDir, id), chatId: chatId || null };
}

export async function listWorkspaces(baseDir = DEFAULT_BASE) {
  const reg = await loadRegistry(baseDir);
  const out = [];
  for (const [chatId, envId] of Object.entries(reg.chats)) {
    out.push({ envId, path: path.join(baseDir, envId), chatId });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/abliterated_ui && node --test scripts/sandbox-workspaces.test.mjs`

Expected: PASS.

- [ ] **Step 5: Wire HTTP endpoints in sandbox-runner**

Add after existing sandbox routes:

- `POST /api/sandbox/workspace` body `{ chatId }` → `allocateWorkspace` → JSON `{ ok, envId, path, created }`
- `GET /api/sandbox/workspace?chatId=` → `resolveWorkspace`
- `GET /api/sandbox/workspaces` → `listWorkspaces`

When `envId` is omitted on materialize/exec/serve, if `chatId` is present, call `allocateWorkspace` first and use returned `envId`.

- [ ] **Step 6: Commit on DGX abliterated_ui (if that tree is a git repo); otherwise copy patch notes into AIUI docs commit later**

```bash
cd ~/abliterated_ui
git status 2>/dev/null || true
# If git repo:
git add scripts/sandbox-workspaces.mjs scripts/sandbox-workspaces.test.mjs scripts/sandbox-runner.mjs
git commit -m "feat(sandbox): allocate workspaceN per chat under /tmp/spark-sandboxes"
```

---

### Task 2: Git sync into a chat workspace (clone/pull AIUI)

**Files:**
- Create: `/home/flak3dd/abliterated_ui/scripts/sandbox-git-sync.mjs`
- Modify: `/home/flak3dd/abliterated_ui/scripts/sandbox-runner.mjs` (route `POST /api/sandbox/sync`)
- Create: `/Users/adminuser/AIUI/scripts/ship-to-dgx.sh` (Mac-side push helper only)
- Test: `/home/flak3dd/abliterated_ui/scripts/sandbox-git-sync.test.mjs`

**Interfaces:**
- Consumes: `allocateWorkspace` / workspace path
- Produces: `syncAiuiRepo({ workspacePath, remoteUrl?, branch? }) → { ok, action: "clone"|"pull", head }`
- Default remote: `https://github.com/flak3dd/AIUI.git` (or `git@github.com:flak3dd/AIUI.git` if SSH keys exist on DGX)
- Default branch: `main`
- Pull mode: `--ff-only` only

- [ ] **Step 1: Write failing test (mock exec or use temp bare repo)**

```js
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { syncAiuiRepo } from "./sandbox-git-sync.mjs";

const execFileP = promisify(execFile);

const root = await mkdtemp(path.join(os.tmpdir(), "aiui-sync-"));
const bare = path.join(root, "bare.git");
const ws = path.join(root, "workspace1");
try {
  await execFileP("git", ["init", "--bare", bare]);
  const seed = path.join(root, "seed");
  await mkdir(seed);
  await execFileP("git", ["-C", seed, "init"]);
  await execFileP("git", ["-C", seed, "config", "user.email", "t@t"]);
  await execFileP("git", ["-C", seed, "config", "user.name", "t"]);
  await writeFile(path.join(seed, "README.md"), "hi\n");
  await execFileP("git", ["-C", seed, "add", "."]);
  await execFileP("git", ["-C", seed, "commit", "-m", "init"]);
  await execFileP("git", ["-C", seed, "branch", "-M", "main"]);
  await execFileP("git", ["-C", seed, "remote", "add", "origin", bare]);
  await execFileP("git", ["-C", seed, "push", "-u", "origin", "main"]);

  const r1 = await syncAiuiRepo({
    workspacePath: ws,
    remoteUrl: bare,
    branch: "main",
  });
  assert.equal(r1.action, "clone");
  assert.equal(r1.ok, true);

  await writeFile(path.join(seed, "README.md"), "hi2\n");
  await execFileP("git", ["-C", seed, "add", "."]);
  await execFileP("git", ["-C", seed, "commit", "-m", "upd"]);
  await execFileP("git", ["-C", seed, "push"]);

  const r2 = await syncAiuiRepo({
    workspacePath: ws,
    remoteUrl: bare,
    branch: "main",
  });
  assert.equal(r2.action, "pull");
  assert.equal(r2.ok, true);
} finally {
  await rm(root, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run test — expect FAIL**

`cd ~/abliterated_ui && node --test scripts/sandbox-git-sync.test.mjs`

- [ ] **Step 3: Implement `syncAiuiRepo`**

Logic:
1. If `workspacePath` has no `.git` → `git clone --branch main <remote> <workspacePath>` (clone into path; if path non-empty without `.git`, clone into temp and require empty or use `git init` + fetch — prefer requiring empty dir or only syncing into allocated empty workspace).
2. Else → `git -C workspacePath fetch origin` then `git -C workspacePath pull --ff-only origin main`.
3. On non-ff failure → return `{ ok: false, error: "non-ff" }` — do not reset.
4. Return `{ ok, action, head: git rev-parse HEAD }`.

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Add `POST /api/sandbox/sync`**

Body: `{ chatId }` or `{ envId }`
1. Resolve/allocate workspace
2. Call `syncAiuiRepo`
3. Return sync result + `envId` + `path`

- [ ] **Step 6: Mac ship helper (no runtime)**

```bash
#!/usr/bin/env bash
# scripts/ship-to-dgx.sh — Mac only: push AIUI; does not start servers
set -euo pipefail
cd "$(dirname "$0")/.."
git push origin HEAD
echo "Pushed. On DGX: POST /api/sandbox/sync with this chat chatId (or ssh and pull in /tmp/spark-sandboxes/workspaceN)."
```

`chmod +x scripts/ship-to-dgx.sh` on Mac.

- [ ] **Step 7: Commit**

DGX runner changes + Mac `scripts/ship-to-dgx.sh` (Mac commit/push via normal AIUI git).

---

### Task 3: systemd user unit for sandbox-runner on DGX

**Files:**
- Create: `/home/flak3dd/.config/systemd/user/spark-sandbox-runner.service`
- Optional create: `/home/flak3dd/abliterated_ui/scripts/install-sandbox-runner-service.sh`

**Interfaces:**
- Consumes: `node ~/abliterated_ui/scripts/sandbox-runner.mjs`
- Produces: unit listening on `127.0.0.1:17330` (or `0.0.0.0` if LAN access required — set `SANDBOX_HOST=0.0.0.0` when Mac must hit DGX over Tailscale/LAN)

- [ ] **Step 1: Write unit file**

```ini
[Unit]
Description=Spark sandbox-runner (AIUI/dev workspaces)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/abliterated_ui
Environment=SANDBOX_PORT=17330
Environment=SANDBOX_HOST=0.0.0.0
Environment=SANDBOX_BASE=/tmp/spark-sandboxes
ExecStart=/usr/bin/node %h/abliterated_ui/scripts/sandbox-runner.mjs
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

- [ ] **Step 2: Enable linger + install**

```bash
mkdir -p ~/.config/systemd/user
# write unit file as above
loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now spark-sandbox-runner.service
systemctl --user status spark-sandbox-runner.service --no-pager
```

- [ ] **Step 3: Health check**

```bash
curl -sS -m2 http://127.0.0.1:17330/api/sandbox/workspaces
# Expect JSON (ok / list), not connection refused
```

- [ ] **Step 4: Reboot verification (or simulate)**

```bash
systemctl --user stop spark-sandbox-runner.service
systemctl --user start spark-sandbox-runner.service
curl -sS -m2 http://127.0.0.1:17330/api/sandbox/workspaces
```

Document that full reboot acceptance is required later (`Acceptance` in spec).

- [ ] **Step 5: Commit unit + install script into abliterated_ui or document path in AIUI `docs/`**

---

### Task 4: Agent / ops guardrails (Mac thin client)

**Files:**
- Modify or create: `/Users/adminuser/AIUI/docs/DGX-RUNTIME.md`
- Modify: agent memory is already set; add short pointer in `docs/superpowers/specs/2026-09-19-dgx-spark-workspace-runtime-design.md` status → Approved

**Interfaces:**
- Produces: written rules agents must follow

- [ ] **Step 1: Write `docs/DGX-RUNTIME.md`**

Include:
- Mac = edit/commit/push only
- Runtime = DGX `/tmp/spark-sandboxes/workspaceN`
- New chat → new workspace via `POST /api/sandbox/workspace`
- Sync via `POST /api/sandbox/sync` after Mac push
- Refuse Mac Shell for `npm run dev`, monitors, Vite
- SuperServe only for isolated jobs
- URLs: DGX LAN/Tailscale, never Mac `127.0.0.1` for runner/monitors

- [ ] **Step 2: Mark design spec Status: Approved**

- [ ] **Step 3: Commit on Mac AIUI and push**

```bash
cd /Users/adminuser/AIUI
git add docs/DGX-RUNTIME.md docs/superpowers/specs/2026-09-19-dgx-spark-workspace-runtime-design.md docs/superpowers/plans/2026-09-19-dgx-spark-workspace-runtime.md scripts/ship-to-dgx.sh
git commit -m "docs: DGX Spark per-chat workspace runtime plan and ops rules"
git push origin HEAD
```

---

### Task 5: SuperServe boundary smoke (isolated jobs only)

**Files:**
- Create: `/Users/adminuser/AIUI/docs/superpowers/plans/snippets/superserve-isolated-check.md` (checklist only; no new offensive tooling)

- [ ] **Step 1: Document check**

Verify on DGX:
1. Spark runner still owns AIUI workspaces under `/tmp/spark-sandboxes/workspaceN`.
2. SuperServe control remains under existing `~/superserve-*` paths.
3. Starting a SuperServe sandbox/job does not change Spark `workspaceN` cwd or stop `:17330`.

- [ ] **Step 2: Manual smoke**

```bash
# On DGX — runner up
curl -sS http://127.0.0.1:17330/api/sandbox/workspaces
# List superserve control dirs only; do not migrate AIUI into SuperServe
ls ~/superserve-linux ~/superserve-agent 2>/dev/null | head
```

- [ ] **Step 3: Record result in DGX-RUNTIME.md “Verification” section**

---

### Task 6: End-to-end acceptance

**Files:** none new (runbook)

- [ ] **Step 1: Two-chat isolation**

```bash
curl -sS -X POST http://127.0.0.1:17330/api/sandbox/workspace \
  -H "content-type: application/json" \
  -d '{"chatId":"e2e-chat-1"}'
curl -sS -X POST http://127.0.0.1:17330/api/sandbox/workspace \
  -H "content-type: application/json" \
  -d '{"chatId":"e2e-chat-2"}'
ls /tmp/spark-sandboxes
# Expect workspace1 and workspace2 (or next free N)
```

- [ ] **Step 2: Sync + file visible**

On Mac: commit a trivial doc touch → `./scripts/ship-to-dgx.sh`  
On DGX: `POST /api/sandbox/sync` with `chatId=e2e-chat-1` → confirm file in `/tmp/spark-sandboxes/workspace1`.

- [ ] **Step 3: Port policy**

From Mac: curl DGX Tailscale/LAN `:17330` succeeds; curling Mac `127.0.0.1:17330` is not the acceptance target.

- [ ] **Step 4: Runner restart**

`systemctl --user restart spark-sandbox-runner.service` → workspaces registry still loads; new chat gets next `workspaceN`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-19-dgx-spark-workspace-runtime.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with executing-plans checkpoints  

Which approach?
