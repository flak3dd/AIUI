/**
 * Decide whether a bash command counts as real goal verification.
 * Exit 0 alone is not enough — exploratory cmds and path substrings like
 * `tests/` must not trip early-stop.
 */

export type GoalVerifyInput = {
  command?: string | null
  exitCode?: number | null
  stdout?: string | null
  stderr?: string | null
}

/** Commands that explore / prepare and must never count as "done". */
const NON_VERIFY_HEAD =
  /^(?:sudo\s+)?(?:mkdir|ls|ll|dir|find|pwd|cd|echo|cat|head|tail|tree|stat|file|which|type|true|false|test|\[|touch|chmod|chown|cp|mv|rm|rmdir|ln|sleep|date|whoami|hostname|uname|env|printenv|export|clear|history)\b/i

/** Soft success sinks that make any preceding failure look like exit 0. */
const ALWAYS_SUCCEED_TAIL = /(?:\|\||;)\s*(?:echo|true)\b/i

/**
 * Real verification / test runners — word-boundary aware.
 * Deliberately avoids bare `test` so `mkdir …/tests/e2e` does not match.
 */
const REAL_VERIFY =
  /(?:^|[;&|]\s*)(?:sudo\s+)?(?:npm\s+(?:run\s+)?test\b|npm\s+run\s+verify\b|npx\s+vitest\b|npx\s+playwright\s+test\b|yarn\s+(?:run\s+)?test\b|pnpm\s+(?:run\s+)?test\b|bun\s+test\b|vitest(?:\s|$)|pytest\b|py\.test\b|python(?:3(?:\.\d+)?)?\s+-m\s+(?:pytest|unittest)\b|go\s+test\b|cargo\s+test\b|mix\s+test\b|dotnet\s+test\b|mvn\s+test\b|gradle(?:w)?\s+test\b|make\s+test\b|ctest\b|playwright\s+test\b|jest\b|mocha\b|ava\b|tap\b|phpunit\b|rspec\b|bats\b|shellcheck\b|oxlint\b|eslint\b|tsc\s+-b\b|tsc\s+--noEmit\b|curl\b)/i

export function isNonVerificationCommand(command: string): boolean {
  const c = command.trim()
  if (!c) return true
  if (ALWAYS_SUCCEED_TAIL.test(c)) return true
  // strip env assignments at the front: FOO=1 BAR=2 mkdir ...
  const withoutEnv = c.replace(/^(?:[A-Za-z_][\w]*=\S*\s+)+/, '')
  if (NON_VERIFY_HEAD.test(withoutEnv)) return true
  return false
}

export function isRealVerificationCommand(command: string): boolean {
  const c = command.trim()
  if (!c || isNonVerificationCommand(c)) return false
  return REAL_VERIFY.test(c)
}

/**
 * True only when a real verify/test runner ran and exited 0.
 * Optional stdout: if provided and the command looks like a runner, empty
 * output is still allowed (some runners are quiet); soft-success tails already rejected.
 */
export function shouldCountAsGoalVerified(input: GoalVerifyInput): boolean {
  const command = (input.command || '').trim()
  if (!command) return false
  if (input.exitCode !== 0) return false
  if (!isRealVerificationCommand(command)) return false
  return true
}

/** Stage helper: treat as verification/completion only for real runners. */
export function isVerificationStageCommand(command: string): boolean {
  return isRealVerificationCommand(command)
}
