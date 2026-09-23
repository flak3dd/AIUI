/**
 * Background Process Manager
 * Manages persistent background daemons (npm run dev, python server, docker compose, etc.)
 * Provides stream capture, readiness port probing, and graceful lifecycle management.
 */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import net from 'node:net';

class BackgroundProcessManager extends EventEmitter {
  constructor() {
    super();
    this.processes = new Map(); // id -> { child, stdoutBuffer, stderrBuffer, port, command, startTime }
    this.MAX_BUFFER_LINES = 1000;
  }

  /**
   * Start a background daemon process.
   * @param {object} options
   * @param {string} options.id - Unique process ID
   * @param {string} options.command - Shell command to run
   * @param {string} [options.cwd] - Working directory
   * @param {object} [options.env] - Environment variables
   * @param {number} [options.healthCheckPort] - Port to poll for readiness
   * @returns {object} { id, pid, startTime, status }
   */
  start({ id, command, cwd, env, healthCheckPort }) {
    if (this.processes.has(id)) {
      const existing = this.processes.get(id);
      return { id, status: 'already_running', pid: existing.child.pid, startTime: existing.startTime };
    }

    const child = spawn(command, {
      shell: true,
      cwd: cwd || process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    const startTime = Date.now();
    const entry = {
      id,
      command,
      child,
      stdoutBuffer: [],
      stderrBuffer: [],
      port: healthCheckPort || null,
      startTime,
      exitCode: null,
    };
    this.processes.set(id, entry);

    // Capture stdout with ring-buffer limit
    child.stdout.on('data', (data) => {
      const str = data.toString();
      entry.stdoutBuffer.push(str);
      if (entry.stdoutBuffer.length > this.MAX_BUFFER_LINES) {
        entry.stdoutBuffer.splice(0, entry.stdoutBuffer.length - this.MAX_BUFFER_LINES);
      }
      this.emit('log', { id, type: 'stdout', message: str });
    });

    // Capture stderr with ring-buffer limit
    child.stderr.on('data', (data) => {
      const str = data.toString();
      entry.stderrBuffer.push(str);
      if (entry.stderrBuffer.length > this.MAX_BUFFER_LINES) {
        entry.stderrBuffer.splice(0, entry.stderrBuffer.length - this.MAX_BUFFER_LINES);
      }
      this.emit('log', { id, type: 'stderr', message: str });
    });

    child.on('exit', (code) => {
      entry.exitCode = code;
      this.emit('exit', { id, code });
    });

    child.on('error', (err) => {
      entry.error = err.message;
      this.emit('error', { id, error: err.message });
    });

    this.emit('started', { id, pid: child.pid });
    return { id, pid: child.pid, startTime, status: 'started' };
  }

  /**
   * Check if a daemon is actively running.
   */
  isAlive(id) {
    const proc = this.processes.get(id);
    if (!proc) return false;
    return proc.child && !proc.child.killed && proc.exitCode === null;
  }

  /**
   * Read trailing lines from a daemon's stdout/stderr buffer.
   * @param {string} id - Process ID
   * @param {number} [lineCount=50] - Number of lines to return
   * @returns {string} - Trailing output
   */
  readOutput(id, lineCount = 50) {
    const proc = this.processes.get(id);
    if (!proc) return '';

    const allOutput = proc.stdoutBuffer.join('') + (proc.stderrBuffer.length ? '\n' + proc.stderrBuffer.join('') : '');
    const lines = allOutput.split('\n');
    return lines.slice(-lineCount).join('\n');
  }

  /**
   * Wait for a TCP port to become available.
   * @param {number} port - Port to poll
   * @param {number} [timeoutMs=15000] - Timeout in milliseconds
   * @returns {Promise<boolean>}
   */
  waitForPort(port, timeoutMs = 15000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tryConnect = () => {
        if (Date.now() - start >= timeoutMs) {
          return resolve(false);
        }
        const client = new net.Socket();
        client.setTimeout(1000);
        client.once('connect', () => {
          client.destroy();
          resolve(true);
        });
        client.once('timeout', () => {
          client.destroy();
          setTimeout(tryConnect, 250);
        });
        client.once('error', () => {
          client.destroy();
          setTimeout(tryConnect, 250);
        });
        client.connect(port, '127.0.0.1');
      };
      tryConnect();
    });
  }

  /**
   * Stop a background daemon.
   * @param {string} id - Process ID
   * @returns {object} { success: boolean, message: string }
   */
  stop(id) {
    const proc = this.processes.get(id);
    if (!proc) {
      return { success: false, message: `Process ${id} not found` };
    }

    try {
      proc.child.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.child.killed) {
          try { proc.child.kill('SIGKILL'); } catch {}
        }
      }, 3000);
    } catch {}

    this.processes.delete(id);
    this.emit('stopped', { id });
    return { success: true, message: `Stopped daemon ${id}` };
  }

  /**
   * List all currently running background daemons.
   */
  list() {
    const list = [];
    for (const [id, p] of this.processes.entries()) {
      list.push({
        id,
        command: p.command,
        pid: p.child.pid,
        alive: this.isAlive(id),
        port: p.port,
        startTime: p.startTime,
        uptimeSeconds: Math.round((Date.now() - p.startTime) / 1000),
      });
    }
    return list;
  }
}

// Singleton instance
const processManager = new BackgroundProcessManager();

export { BackgroundProcessManager };
export default processManager;
