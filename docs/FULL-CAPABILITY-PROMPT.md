# AIUI full-capability exercise prompt

Paste this into the AIUI chat with **Agent Mode ON**, **Auto-Bash ON**, **RAG ON**, **MemPalace auto-recall ON**, target **Local Mac** first. Use provider **Spark** if healthy, else Featherless/Abliteration.

---

## System / mission (optional paste into agent context)

You are Abliterated AI Systems Engineer in AIUI. Exercise every live capability end-to-end, report evidence (stdout, exit codes, tool names), and stop cleanly. Prefer tools over narration. Do not destroy unrelated files outside `/tmp/spark-sandboxes` or the session workspace.

---

## User prompt (copy everything below this line)

Run a **full capability smoke drill**. Work the checklist in order. After each step, show a one-line PASS/FAIL with the tool or path used.

### A. Providers & chat
1. Call `now` and report the UTC timestamp.
2. Call `list_models` (limit 10). Note which provider is active.
3. If any gated Meta/Gemma IDs appear, name the ungated alternative you would use (do not force a gated call).

### B. MemPalace memory
4. `memory_search` query: `AIUI stack ports sandbox MemPalace Spark`.
5. `memory_checkpoint` wing=`aiui`, room=`smoke-drill`, content= a short note that this drill ran (include timestamp from step 1).
6. `memory_search` again for `smoke-drill` and confirm the checkpoint is recallable.

### C. Cluster RAG
7. Ask (in plain chat, no tool required): what does the bundled knowledge say about this product’s stack ports? Expect RAG context if 📚 RAG is ON — quote any injected snippets you see.

### D. Auto Bash Shell (local_mac)
8. Via `bash` tool, target `local_mac`:
   - `pwd && whoami && date`
   - `ls -la /tmp/spark-sandboxes 2>/dev/null | head -20 || mkdir -p /tmp/spark-sandboxes && echo created`
9. Also emit a markdown fence the UI Auto-Bash can pick up:

```bash
echo "auto-bash-probe-$(date -u +%Y%m%dT%H%M%SZ)" && uname -a
```

10. Emit a tag form too: `<run>echo "run-tag-ok" && hostname</run>`

### E. Files in sandbox
11. `write_file` path=`/tmp/spark-sandboxes/aiui-smoke/README.md` content explaining this smoke drill (3–5 lines).
12. `read_file` that same path and confirm contents.
13. `bash`: `ls -la /tmp/spark-sandboxes/aiui-smoke`

### F. Containers (if sandbox supports it)
14. `list_linux_containers`.
15. `spawn_linux_container` with profile `minimal_alpine`, short TTL (e.g. 10 minutes), target `local_mac` if available else `dgx_spark`.
16. `bash` target `container`: `cat /etc/os-release | head -5` (or equivalent).
17. `destroy_linux_container` for the env you spawned. Re-list to confirm gone.
18. If spawn fails, record the error and continue — do not loop.

### G. HTTP tool
19. `http_get_json` on a public HTTPS URL (e.g. `https://httpbin.org/json`) — summarise keys returned. Never fetch secrets or private LAN URLs with this tool.

### H. AgentAnalyzer / anti-loop (self-check)
20. Do **not** repeat a failing command. If any step failed, one alternate strategy only, then mark FAIL and move on.
21. End with a compact scoreboard: steps 1–20 as PASS/FAIL/SKIP + one sentence on stack health.

### Constraints
- Prefer `local_mac` unless a step needs DGX.
- No `rm -rf /`, no touching `.env` secrets, no long GPU jobs.
- Keep tool stdout truncated in your summary; full detail stays in the terminal drawer.

When finished, say: **FULL-CAPABILITY DRILL COMPLETE**.
