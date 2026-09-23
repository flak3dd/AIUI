# Stack overlap removal plan

Date: 2026-09-23. Status: plan only. Nothing in this list was added, and nothing already in the tree was deleted.

MemPalace stays the only long-term memory. Playwright stays the only browser engine. Superpowers is vendored as markdown under `skills/superpowers/`, not installed as a host-permission plugin.

## Do not add

These are absent. Leave them absent.

| Proposal | Why it stays out |
| --- | --- |
| Mem0 or Zep beside MemPalace | A second store for the same facts splits recall and write-back. Palace drawers, the knowledge graph, and the diary are the write path. |
| Filesystem MCP plus the native file tools plus another sandbox | `read_file`, `replace_file_content`, and `write_file` already exist. A third filesystem server would make the model pick at random. |
| Puppeteer and Browser Use next to Playwright | One browser engine. Adding the other two makes the model thrash between sessions. |
| Stripe or other live payment MCPs | No human-approval gate and no allowlist exist yet. |
| Marketplace plugins that spawn a local MCP with host permissions | Treat that install like running an unsigned binary. Skills land as files in this repo, reviewed in git. |

## Already present

### 1. Unsandboxed shell is a file API

`executeBashCommand` in `scripts/aiui-agent/tools/handlers/bash.mjs` runs `exec` on the host when the target is local. `writeFileHandler` in `scripts/aiui-agent/tools/handlers/fs.mjs` writes with `fs.writeFileSync` on the host for the same local target. The sandbox runner is only attempted after those fast paths, and only for non-local targets.

Removal, when scheduled:

1. Keep `read_file`, `replace_file_content`, and `write_file` as the only file mutations, rooted at the workspace.
2. Reject absolute paths outside that workspace.
3. Send `bash` to the sandbox runner first. If the runner is down, refuse host `exec` instead of falling through, except for an explicit operator override.
4. Leave verification commands (`npm test`, `node --test`) on that same jailed path.

### 2. Three ways to write the same file

Local `fs`, `POST /api/sandbox/materialize`, and SSH `cat > file` all write bytes. The model can succeed on one and report another.

Removal, when scheduled:

1. One writer per target. Local workspace uses the native file tools. DGX uses the sandbox runner.
2. Delete the SSH `cat` fallback after the runner path is the one that is tested.
3. Do not add a filesystem MCP on top.

### 3. Playwright is installed as a tool, and the prompt offers browser actions

`scripts/aiui-agent/tools/handlers/browser.mjs` loads Playwright and falls back to HTTP. Puppeteer and Browser Use are not in the repo. `docs/DEVIN_AUTONOMOUS_SWE_BLUEPRINT.md` still has an open item to install Playwright again.

Removal, when scheduled:

1. Do not add Puppeteer or Browser Use.
2. Keep the HTTP fallback for a status check only. Interaction stays on Playwright.
3. Close the blueprint item so a second install is not scheduled.

### 4. Search tool does not read robots.txt

`tools/acquired/web_search_duckduckgo.py` fetches DuckDuckGo HTML with a browser user agent and no robots check. That is a scraper against a site this project does not own.

Removal, when scheduled:

1. Stop shipping that script as an acquired tool, or gate it on a recorded allowlist.
2. Do not add further scrapers that skip robots or the site's terms.
3. Public docs and APIs stay on `http_get_json` against URLs the operator named.

### 5. Dynamic tool acquisition runs new code on the host

The system prompt advertises `research_and_acquire_tool`. Acquired tools under `tools/acquired/` execute with `python3` or node on the machine.

Removal, when scheduled:

1. Default the acquirer off.
2. New tools enter `tools/acquired/` only through review in git, the same as any other code.
3. Do not point the acquirer at a plugin marketplace.

## Not in this tree

No Mem0, Zep, Puppeteer, Browser Use, Stripe, or filesystem MCP package references showed up in the source search on 2026-09-23. The in-process LRU in `src/lib/mempalace.ts` is a client cache, not a second palace. Local RAG is a static dataset, not a write-back of the same decisions.
