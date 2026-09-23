import { SANDBOX_RUNNER_URL } from '../../config.mjs';

/**
 * Handle spawn_linux_container tool invocation
 */
export async function spawnContainerHandler(args, ctx) {
  try {
    const res = await fetch(`${SANDBOX_RUNNER_URL}/api/container/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        envId: args.envId || ctx.envId,
        profile: args.profile || 'python_data',
        target: args.target || ctx.target,
        timeoutMinutes: args.timeoutMinutes || 30,
        enableGpu: Boolean(args.enableGpu),
      }),
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json();
    return JSON.stringify(json);
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

/**
 * Handle destroy_linux_container tool invocation
 */
export async function destroyContainerHandler(args, ctx) {
  try {
    const res = await fetch(`${SANDBOX_RUNNER_URL}/api/container/destroy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envId: args.envId, target: args.target || ctx.target }),
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json();
    return JSON.stringify(json);
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

/**
 * Handle list_linux_containers tool invocation
 */
export async function listContainersHandler() {
  try {
    const res = await fetch(`${SANDBOX_RUNNER_URL}/api/container/list`, { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    return JSON.stringify(json);
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}
