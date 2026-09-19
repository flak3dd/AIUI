# DGX Spark Per-Chat Workspace Runtime — Operations & Guardrails

## 1. Core Operating Principle: Strict Machine Separation

| Machine | Allowed Actions | Strictly Prohibited Actions |
| :--- | :--- | :--- |
| **Mac Host** (Admin MacBook Pro) | • Edit code / documentation<br>• `git commit`<br>• `git push origin main` (via `./scripts/ship-to-dgx.sh`)<br>• View browser UI via DGX LAN/Tailscale URLs | • Running Vite dev servers (`npm run dev`)<br>• Running local background monitors or watchers<br>• Executing workspace build/test commands on Mac host |
| **DGX Spark** (`192.168.4.103` / `100.94.45.77`) | • All workspace runtime execution (`/tmp/spark-sandboxes/workspaceN`)<br>• Ephemeral sandbox containers & runners (`:17330`)<br>• Fast-forward git synchronization from GitHub<br>• vLLM GPU inference (`:8000`) | • Never hosting local git commits as root source of truth (syncs via GitHub only) |

---

## 2. Per-Chat Workspace Allocation & Directory Structure

* **Root Directory**: `/tmp/spark-sandboxes/` on DGX Spark.
* **Workspace Naming**: `workspace1`, `workspace2`, `workspace3`, ... assigned monotonically.
* **One Workspace Per Chat**: Every new conversation thread allocates a new, dedicated `workspaceN` directory.
* **Registry**: Persisted in `/tmp/spark-sandboxes/_registry.json`:
  ```json
  {
    "next": 3,
    "chats": {
      "chat_session_alpha": "workspace1",
      "chat_session_beta": "workspace2"
    }
  }
  ```

---

## 3. Workflow Lifecycle

```
[1. Mac Host]
   Edit files -> git commit -> ./scripts/ship-to-dgx.sh (git push origin HEAD)
                                      |
                                      v
[2. GitHub Sync Hub]            github.com/flak3dd/AIUI
                                      |
                                      v
[3. DGX Spark Runner]    POST /api/sandbox/sync { chatId: "..." }
                                      |
                                      v
[4. DGX Sandbox]        git clone / pull --ff-only into /tmp/spark-sandboxes/workspaceN
```

---

## 4. SuperServe Isolation Boundary

* **AIUI / Development Runtime**: Strictly hosted on DGX Spark bare-metal workspace directories (`/tmp/spark-sandboxes/workspaceN`).
* **SuperServe**: Exclusively used for out-of-band, isolated research and ephemeral microVM sandboxes. SuperServe control dirs (`~/superserve-*`) never replace the primary AIUI dev runtime.

---

## 5. Verification & Health Probes

* **Workspace Allocation**: `POST http://192.168.4.103:17330/api/sandbox/workspace`
* **Workspace List**: `GET http://192.168.4.103:17330/api/sandbox/workspaces`
* **Repo Fast-Forward Sync**: `POST http://192.168.4.103:17330/api/sandbox/sync`
* **Service Status**: `systemctl --user status spark-sandbox-runner.service`
