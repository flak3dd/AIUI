# Spark / Huihui smoke-test prompt

Use after `qwen-abliterated` (THe-Plague Qwen3.6-35B-A3B NVFP4+MTP) is up on `:8000`. In AIUI: provider **Spark**, model **Spark Qwen / qwen-abliterated**, Agent Mode optional (OFF is fine for this smoke).

---

## User prompt (copy below)

Run a short **Spark smoke test**. Be concise; show PASS/FAIL per step.

1. Reply with exactly one line: `SMOKE_OK` plus the UTC time (use `now` if Agent Mode is on, otherwise your best clock).
2. Answer in one sentence: what model name you believe you are (`qwen-abliterated` expected).
3. Compute `17 * 19` and show only the number.
4. Emit a bash block the Auto-Bash drawer can run (do not claim you executed it unless Auto-Bash is on):

```bash
echo "aiui-spark-smoke-$(date -u +%Y%m%dT%H%M%SZ)" && uname -s
```

5. End with: `SPARK SMOKE COMPLETE`

If you cannot complete a step, mark it FAIL and continue.
