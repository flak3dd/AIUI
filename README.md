# Abliterated Web with Integrated Auto Bash Shell

Standalone **Vite + React** web chat with native **Auto Bash Shell** and reasoning via Featherless / Abliteration / **Spark Qwen Flash** (LAN vLLM).

## Layout

```
src/            Vite + React chat UI
  components/   chat, terminal, shell, telemetry, overlays, visuals, commandspace, devin
  lib/          agent, providers, bash, memory
scripts/        CLI agent plus ops tools grouped by job
  aiui-agent/   autonomous agent (stable entry: scripts/aiui-agent.mjs)
  cluster/      Spark, DGX, Featherless
  monitors/     response and self-improvement monitors
  git/          repo and aiuiro sync
  install/      device install and client bundle
  memory/       MemPalace maintenance
  checks/       script checks and templates
tools/          acquired dynamic tools
docs/           design notes and figures
lab/            Python experiments (evolution, resilience, interfaces)
data/           samples, raw dumps, generated reports
bin/            launchers (aiui, matrix.sh)
```

`./aiui`, `npm run dev`, `scripts/aiui-agent.mjs`, and `scripts/restart-spark.mjs` stay at those paths so existing launchers keep working. New ops scripts go in the matching `scripts/` subdirectory. Generated reports go in `data/reports/`. Experiments stay in `lab/` and do not sit next to the app entrypoints.

## UI/UX redesign concept

See [docs/UI-UX-REDESIGN-CONCEPT.md](docs/UI-UX-REDESIGN-CONCEPT.md).

## One-command stack

Bring up the UI plus every local dependency (and Spark vLLM if it is down):

```bash
# from web-api-app/
./start-stack.sh
# or: npm run stack

# from repo root
npm run web-api:stack
./scripts/start-web-api-stack.sh status
./scripts/start-web-api-stack.sh stop
```

Starts: Spark `:8000` (SSH) · cloud-key-proxy `:17332` · sandbox `:17330` · MemPalace `:17333` · Vite UI `:5173`.

## Features

- **Integrated Auto Bash Shell**:
  - Connects to the local Mac sandbox runner (`http://127.0.0.1:17330`).
  - Supports execution targets: **Local Mac** (`/tmp/spark-sandboxes`) and **DGX Spark GB10** (`flak3dd`).
  - **Auto-Bash toggle**: Automatically executes code blocks (`bash`, `sh`, `python`, `node`) or `<run>cmd</run>` tags output by the assistant.
  - Interactive terminal drawer with `$ ` command prompt, quick diagnostic actions (`pwd`, `ls -la`, `uptime`, `whoami`), exit codes, and execution latency.
  - 1-click "⚡ Run in Bash" button directly on markdown code blocks.
- **Agent Mode with Live Tools**:
  - `bash`: Native execution inside the sandbox with real stdout/stderr.
  - `list_models`: Real cloud model enumeration.
  - `http_get_json`: Web API retrieval.
  - `now`: Browser UTC clock.
- **Gated Model 403 Auto-Handling**:
  - Detects Featherless `model_gated_needs_oauth` (e.g. `meta-llama/Meta-Llama-3.1-8B-Instruct` requiring HuggingFace OAuth).
  - Badges gated models with `🔒` in the model selector.
  - Provides a 1-click fallback to ungated equivalents (e.g. `mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated` or `Qwen/Qwen2.5-7B-Instruct`) and immediate re-try.

## ⚡ AIUI Terminal CLI Suite (`./aiui`)

Run the entire sovereign autonomous agent directly from your terminal:

```bash
# Launch interactive agent REPL
./aiui
# or: npm run cli / npm run terminal

# Launch interactive TUI Operations Suite
./aiui menu

# One-shot autonomous prompt
./aiui "Audit tests and fix any concurrency bugs"

# Ecosystem Telemetry Dashboard (:17330, :17332, :17333, Spark)
./aiui status

# TrueColor Featherless Cyber Matrix Screensaver
./aiui matrix

# Inspect active agent capability tools (15 dynamic tools)
./aiui tools
```

## 🌐 Installing the CLI

### Option A: Local Installation (On this Mac / Development Machine)
Since this repository is already on your machine, install and link the CLI directly into `~/.local/bin`:
```bash
bash ~/AIUI/scripts/install-device-cli.sh --local
source ~/.aiuirc
```
This configures your environment, detects your SSH key (`nvsync.key` / `id_ed25519`), and lets you run `aiui` from **any** directory on this machine.

---

### Option B: Universal Terminal Pull & Install (Any Other Computer on Network)
To install on other computers across the LAN (Mac, Linux, WSL) without cloning the full repo:

1. **Start the installer server on the host machine:**
   ```bash
   npm run serve:install
   # Listens on 0.0.0.0:17333 and serves install.sh & the client tarball
   ```

2. **On any other machine on your local network, run:**
   ```bash
   curl -fsSL http://192.168.4.50:17333/install.sh | bash
   ```

   Or if the host IP is different:
   ```bash
   curl -fsSL http://<HOST_IP>:17333/install.sh | bash -s -- --bridge <HOST_IP> --host 192.168.4.103
   ```

Once installed, navigate to **any local directory** on that device and run:
```bash
cd /path/to/any/project

# One-shot task execution in that directory:
aiui "Analyze src/index.ts and fix the build errors"

# Interactive REPL with real-time user interjections:
aiui
```

### ⚡ Real-Time User Interjection & Steering
While the agent is actively executing autonomous multi-turn loops or waiting on tools/LLMs:
- **Steer dynamically**: Type any instruction or correction directly in your terminal and press `Enter`. The agent captures your input in real time and steers its next step immediately!
- **Instant Abort**: Type `stop`, `cancel`, `/abort`, or press `Ctrl+C` to cleanly halt the current turn and return to the REPL prompt without terminating your session.

### 🔑 SSH Key Configuration for Remote DGX Spark Execution
- During installation, new users are automatically prompted for their SSH private key (`~/.ssh/id_ed25519`, `~/.ssh/id_rsa`, or custom path).
- You can also set or change your SSH key at any time from within the interactive REPL:
  ```bash
  /ssh-key ~/.ssh/id_ed25519
  ```
- *Note: Model inference works out of the box without an SSH key directly over high-speed HTTP (:8000). The SSH key is only required when delegating remote bash commands to the DGX cluster (`aiui -t dgx_spark`).*

## Setup

```bash
cd web-api-app
npm install
npm run dev
```

Open http://localhost:5173.

## Environment & Keys

Configure keys in `web-api-app/.env` or directly in the **Settings** drawer:
- `VITE_FEATHERLESS_API_KEY`: Featherless cloud API key
- `VITE_ABLITERATION_API_KEY`: Abliteration sovereign cloud key
- `VITE_SPARK_HOST` / `VITE_SPARK_PORT`: DGX Spark vLLM (default `192.168.4.103:8000`)
- Sandbox runner defaults to `http://127.0.0.1:17330` (managed via `npm run sandbox:watch` in `abliterated_ui`).
- Spark proxy: `npm run cloud-proxy` in `abliterated_ui` → `:17332/spark/...`


## Spark Qwen3.6-35B-A3B Abliterated (NVFP4+MTP)

Served as `qwen-abliterated` from [THe-Plague/Qwen3.6-35B-A3B-abliterated-NVFP4-MTP](https://huggingface.co/THe-Plague/Qwen3.6-35B-A3B-abliterated-NVFP4-MTP).

1. In the toolbar **Tap** dropdown, choose **Spark**.
2. Model picker shows **Qwen3.6-35B-A3B Abliterated NVFP4+MTP** (`qwen-abliterated`).
3. Settings → set Spark host/port (defaults `192.168.4.103:8000`). Completions always send `chat_template_kwargs: { enable_thinking: false }`.

### CORS / LAN caveat (browser on Mac)

Browsers (especially Firefox) often block direct fetches to `http://192.168.x.x:8000` (CORS or Local Network Access). With **Use cloud-key-proxy** enabled (default):

1. **`npm run dev` (Vite :5173)** — same-origin `/spark-vllm/v1/...` proxy (see `vite.config.ts`) when host/port match `.env` defaults.
2. **Otherwise / Expo-style** — `http://127.0.0.1:17332/spark/<host>/<port>/v1/...` (supports Settings host/port). Start from repo root:

```bash
npm run cloud-proxy
```

Then:

```bash
cd web-api-app && npm run dev
```

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — Production TypeScript build
- `npm run preview` — Vite preview server
