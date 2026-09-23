/**
 * AIUI AGENT MODULE
 * Sovereign autonomous coding agent architecture.
 */

export { AiuiAgent } from './core/agent.mjs';
export { SystemPromptEngine } from './core/system-prompt.mjs';
export { CircuitBreakerManager, computeActionSignature } from './core/circuit-breaker.mjs';
export { formatToolOutputForContext, cleanAccidentalLineNumbers } from './core/output-curator.mjs';

export { AGENT_TOOLS } from './tools/registry.mjs';
export { executeTool } from './tools/executor.mjs';
export { executeBashCommand } from './tools/handlers/bash.mjs';
export { readFileHandler, writeFileHandler, fileReadCache } from './tools/handlers/fs.mjs';

export { callLlm } from './transport/llm-client.mjs';
export { checkServices, runOptimizationPass } from './transport/telemetry.mjs';
export { runBenchmarkSuite, measureStreamingLlm, getGpuSnapshot } from './tools/handlers/benchmark.mjs';

export {
  CLI_SKINS,
  getSkin,
  rgb,
  bgRgb,
  stripAnsi,
  gradient,
  c,
} from './ui/skins.mjs';

export {
  renderCard,
  badge,
  LiveSpinner,
  formatRunningTime,
  renderStatusDashboard,
} from './ui/components.mjs';

export { runCli } from './cli.mjs';

export * from './config.mjs';
