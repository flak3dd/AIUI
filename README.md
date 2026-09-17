# Abliterated Web with Integrated Auto Bash Shell

Standalone **Vite + React** web chat with native **Auto Bash Shell** and reasoning via Featherless / Abliteration / **Spark Qwen Flash** (LAN vLLM).


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
