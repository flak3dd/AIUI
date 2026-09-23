/**
 * Tool Handlers for Background Daemon Supervision
 * Exposes start_daemon, read_daemon_logs, stop_daemon, and list_daemons.
 */

import processManager from '../../core/process-manager.mjs';

/**
 * Starts a background daemon and optionally awaits its port readiness.
 */
export async function startDaemonHandler(args, ctx = {}) {
  const command = args?.command || args?.cmd;
  const id = args?.id || args?.name;
  const port = args?.port ? parseInt(args.port, 10) : undefined;
  const cwd = args?.cwd || ctx.workspaceDir || process.cwd();

  if (!command) {
    return JSON.stringify({ ok: false, error: 'Command is required', exitCode: 1 });
  }
  if (!id) {
    return JSON.stringify({ ok: false, error: 'Process ID / name is required', exitCode: 1 });
  }

  try {
    const res = processManager.start({ id, command, cwd, healthCheckPort: port });

    let portReady = null;
    if (port) {
      portReady = await processManager.waitForPort(port, 15000);
    }

    return JSON.stringify({
      ok: true,
      id,
      pid: res.pid,
      command,
      status: res.status,
      port,
      portReady: port ? portReady : undefined,
      exitCode: 0,
      message: `Started background daemon "${id}" (PID ${res.pid})${port ? ` on port ${port} (ready: ${portReady})` : ''}`,
    });
  } catch (err) {
    return JSON.stringify({ ok: false, error: `Failed to start daemon: ${err.message}`, exitCode: 1 });
  }
}

/**
 * Reads trailing logs from an active daemon.
 */
export async function readDaemonLogsHandler(args, ctx = {}) {
  const id = args?.id || args?.name;
  const lineCount = parseInt(args?.lines || args?.line_count || 50, 10);

  if (!id) {
    return JSON.stringify({ ok: false, error: 'Process ID is required', exitCode: 1 });
  }

  const logs = processManager.readOutput(id, lineCount);
  const alive = processManager.isAlive(id);

  return JSON.stringify({
    ok: true,
    id,
    alive,
    lineCount: logs ? logs.split('\n').length : 0,
    logs: logs || '(No output recorded yet)',
    exitCode: 0,
  });
}

/**
 * Stops an active daemon.
 */
export async function stopDaemonHandler(args, ctx = {}) {
  const id = args?.id || args?.name;
  if (!id) {
    return JSON.stringify({ ok: false, error: 'Process ID is required', exitCode: 1 });
  }

  const res = processManager.stop(id);
  return JSON.stringify({
    ok: res.success,
    id,
    message: res.message,
    exitCode: res.success ? 0 : 1,
  });
}

/**
 * Lists all active daemons.
 */
export async function listDaemonsHandler(args, ctx = {}) {
  const list = processManager.list();
  return JSON.stringify({
    ok: true,
    count: list.length,
    daemons: list,
    exitCode: 0,
  });
}

export default {
  start_daemon: startDaemonHandler,
  read_daemon_logs: readDaemonLogsHandler,
  stop_daemon: stopDaemonHandler,
  list_daemons: listDaemonsHandler,
  startDaemonHandler,
  readDaemonLogsHandler,
  stopDaemonHandler,
  listDaemonsHandler,
};
