/**
 * Local Sandbox Runner & Remote GX10 Bash Shell Integration (:17330).
 * Connects web-api-app to the active sandbox-runner daemon on the Mac.
 */

import { resolveVerificationGateCommand } from './goalVerification.ts';
import { fetchWithRetry } from './resilientFetch.ts';

export type ExecutionTarget = 'local_mac' | 'dgx_spark' | 'container';

export interface LinuxContainerInfo {
  containerName: string;
  envId: string;
  target: 'dgx_spark' | 'local_mac';
  profile: string;
  image: string;
  status: string;
  uptimeSeconds?: number;
  remainingSeconds?: number;
  workspacePath: string;
  enableGpu?: boolean;
}

export interface SpawnContainerOptions {
  envId?: string;
  profile?: 'python_data' | 'gpu_spark' | 'minimal_alpine';
  target?: 'dgx_spark' | 'local_mac';
  extraPackages?: string[];
  timeoutMinutes?: number;
  enableGpu?: boolean;
  baseUrl?: string;
}

export interface SpawnContainerResult {
  ok: boolean;
  containerName?: string;
  containerId?: string;
  envId?: string;
  profile?: string;
  target?: string;
  image?: string;
  status?: string;
  workspacePath?: string;
  expiresAt?: number;
  durationMs?: number;
  error?: string;
  alreadyRunning?: boolean;
}

export interface BashExecResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  target: ExecutionTarget;
  cwd?: string;
  timestamp: string;
  error?: string;
  inContainer?: boolean;
  containerName?: string;
}

export interface SandboxStatus {
  online: boolean;
  url: string;
  latencyMs?: number;
  lastChecked?: string;
  error?: string;
}

const DEFAULT_SANDBOX_URL = 'http://127.0.0.1:17330';
const STORAGE_TARGET_KEY = 'abliterated_bash_target';
const STORAGE_AUTO_EXEC_KEY = 'abliterated_auto_bash_enabled';
const STORAGE_SANDBOX_URL_KEY = 'abliterated_sandbox_url';
const STORAGE_WORKSPACE_DIR_KEY = 'abliterated_workspace_dir';
const STORAGE_ACTIVE_WORKSPACE_ENVID_KEY = 'abliterated_active_workspace_envid';

let inMemoryActiveWorkspaceEnvId = 'workspace1';

export function getActiveWorkspaceEnvId(): string {
  try {
    const val = localStorage.getItem(STORAGE_ACTIVE_WORKSPACE_ENVID_KEY);
    if (val && val.trim()) return val.trim();
  } catch {
    /* ignore */
  }
  return inMemoryActiveWorkspaceEnvId || 'workspace1';
}

export function setActiveWorkspaceEnvId(envId: string) {
  const clean = String(envId || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
  if (!clean) return;
  inMemoryActiveWorkspaceEnvId = clean;
  try {
    localStorage.setItem(STORAGE_ACTIVE_WORKSPACE_ENVID_KEY, clean);
  } catch {
    /* ignore */
  }
}

export interface WorkspaceInfo {
  envId: string;
  path: string;
  chatId?: string;
  created?: boolean;
}

/**
 * Allocate or resolve a dedicated sandbox workspace for a chat session.
 * Always binds chats to /tmp/spark-sandboxes/workspaceN.
 */
export async function allocateChatWorkspace(
  chatId: string,
  baseUrl = getSandboxBaseUrl(),
): Promise<WorkspaceInfo> {
  const cleanChatId = String(chatId || '').trim();
  if (!cleanChatId) {
    return {
      envId: 'workspace1',
      path: '/tmp/spark-sandboxes/workspace1',
      chatId: 'default',
      created: false,
    };
  }

  try {
    const res = await fetch(`${baseUrl}/api/sandbox/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: cleanChatId }),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const json = (await res.json()) as { ok: boolean; envId: string; path: string; created?: boolean };
      if (json.ok && json.envId) {
        setActiveWorkspaceEnvId(json.envId);
        return {
          envId: json.envId,
          path: json.path || `/tmp/spark-sandboxes/${json.envId}`,
          chatId: cleanChatId,
          created: json.created,
        };
      }
    }
  } catch {
    // fallback if runner workspace endpoint not yet reachable
  }

  // Deterministic local workspace index based on chatId
  let hash = 0;
  for (let i = 0; i < cleanChatId.length; i++) {
    hash = (hash * 31 + cleanChatId.charCodeAt(i)) >>> 0;
  }
  const fallbackEnvId = `workspace${(hash % 30) + 1}`;
  setActiveWorkspaceEnvId(fallbackEnvId);
  return {
    envId: fallbackEnvId,
    path: `/tmp/spark-sandboxes/${fallbackEnvId}`,
    chatId: cleanChatId,
    created: false,
  };
}

/**
 * Resolve an existing sandbox workspace for a chat session or envId.
 */
export async function resolveChatWorkspace(
  chatIdOrEnvId: string,
  baseUrl = getSandboxBaseUrl(),
): Promise<WorkspaceInfo | null> {
  const clean = String(chatIdOrEnvId || '').trim();
  if (!clean) return null;
  try {
    const res = await fetch(`${baseUrl}/api/sandbox/workspace?chatId=${encodeURIComponent(clean)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json = (await res.json()) as { ok: boolean; envId: string; path: string };
      if (json.ok && json.envId) {
        return {
          envId: json.envId,
          path: json.path || `/tmp/spark-sandboxes/${json.envId}`,
          chatId: clean,
        };
      }
    }
  } catch {
    // fallback
  }
  return null;
}

export function getStoredWorkspaceDir(_target: ExecutionTarget = getStoredTarget()): string {
  try {
    const val = localStorage.getItem(STORAGE_WORKSPACE_DIR_KEY);
    if (val && val.trim() && !val.includes('/Users/adminuser') && !val.includes('/Users/')) return val.trim();
  } catch {
    /* ignore */
  }
  const envId = getActiveWorkspaceEnvId();
  return `/tmp/spark-sandboxes/${envId}`;
}

export function setStoredWorkspaceDir(dir: string) {
  try {
    const trimmed = (dir || '').trim();
    if (trimmed && !trimmed.includes('/Users/adminuser') && !trimmed.includes('/Users/')) {
      localStorage.setItem(STORAGE_WORKSPACE_DIR_KEY, trimmed);
    } else {
      localStorage.removeItem(STORAGE_WORKSPACE_DIR_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function getStoredTarget(): ExecutionTarget {
  try {
    const val = localStorage.getItem(STORAGE_TARGET_KEY);
    if (val === 'container') return 'container';
    return 'dgx_spark';
  } catch {
    return 'dgx_spark';
  }
}

export function setStoredTarget(target: ExecutionTarget) {
  try {
    const safeTarget = target === 'local_mac' ? 'dgx_spark' : target;
    localStorage.setItem(STORAGE_TARGET_KEY, safeTarget);
  } catch {
    /* ignore */
  }
}

export function getStoredAutoBash(): boolean {
  try {
    const val = localStorage.getItem(STORAGE_AUTO_EXEC_KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

export function setStoredAutoBash(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_AUTO_EXEC_KEY, enabled ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

export function getSandboxBaseUrl(): string {
  try {
    return localStorage.getItem(STORAGE_SANDBOX_URL_KEY) || DEFAULT_SANDBOX_URL;
  } catch {
    return DEFAULT_SANDBOX_URL;
  }
}

export function setSandboxBaseUrl(url: string) {
  try {
    localStorage.setItem(STORAGE_SANDBOX_URL_KEY, url);
  } catch {
    /* ignore */
  }
}

let healthCache: { status: SandboxStatus; ts: number } | null = null;

/** Check if the local sandbox runner (:17330) is healthy and reachable (cached 2.5s) */
export async function checkSandboxHealth(baseUrl = getSandboxBaseUrl()): Promise<SandboxStatus> {
  const now = Date.now();
  if (healthCache && now - healthCache.ts < 2500 && healthCache.status.url === baseUrl) {
    return healthCache.status;
  }

  const t0 = performance.now();
  try {
    const res = await fetchWithRetry(`${baseUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    const latencyMs = Math.round(performance.now() - t0);
    if (res.ok) {
      const status: SandboxStatus = {
        online: true,
        url: baseUrl,
        latencyMs,
        lastChecked: new Date().toLocaleTimeString(),
      };
      healthCache = { status, ts: now };
      return status;
    }
    const failedStatus: SandboxStatus = {
      online: false,
      url: baseUrl,
      latencyMs,
      lastChecked: new Date().toLocaleTimeString(),
      error: `HTTP ${res.status}`,
    };
    healthCache = { status: failedStatus, ts: now };
    return failedStatus;
  } catch (err: unknown) {
    const failedStatus: SandboxStatus = {
      online: false,
      url: baseUrl,
      lastChecked: new Date().toLocaleTimeString(),
      error: err instanceof Error ? err.message : 'Connection refused',
    };
    healthCache = { status: failedStatus, ts: now };
    return failedStatus;
  }
}

/** Execute a command inside the sandbox runner on local Mac or remote DGX Spark */
export async function executeBashCommand(
  command: string,
  target: ExecutionTarget = getStoredTarget(),
  envId?: string,
  baseUrl = getSandboxBaseUrl(),
  cwd?: string,
): Promise<BashExecResult> {
  const t0 = performance.now();
  const timestamp = new Date().toLocaleTimeString();

  const trimmed = command.trim();
  if (!trimmed) {
    return {
      ok: false,
      command,
      stdout: '',
      stderr: 'Empty command',
      exitCode: 1,
      durationMs: 0,
      target,
      timestamp,
      error: 'Empty command',
    };
  }

  // Preflight sanitization: Resolve verification gates, strip assertion suffixes, and add package.json guard
  const sanitizedCmd = resolveVerificationGateCommand(trimmed);

  // Enforce zero host execution: All workspace execution runs strictly on DGX Spark sandbox
  const safeTarget: ExecutionTarget = target === 'local_mac' ? 'dgx_spark' : target;
  const effectiveEnvId = envId && envId !== 'web_session' ? envId : getActiveWorkspaceEnvId();
  let workingDir = cwd || getStoredWorkspaceDir(safeTarget);
  // Guarantee sandbox path boundary: remap any Mac host path or escape attempts into /tmp/spark-sandboxes/workspaceN
  if (
    workingDir.includes('/Users/adminuser') ||
    workingDir.includes('/Users/') ||
    workingDir.startsWith('/home/') ||
    workingDir.includes('..')
  ) {
    workingDir = `/tmp/spark-sandboxes/${effectiveEnvId}`;
  }

  try {
    const res = await fetchWithRetry(`${baseUrl}/api/sandbox/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        envId: effectiveEnvId,
        cmd: sanitizedCmd,
        target: safeTarget,
        cwd: workingDir,
      }),
      signal: AbortSignal.timeout(60000),
    });

    const durationMs = Math.round(performance.now() - t0);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        ok: false,
        command: trimmed,
        stdout: '',
        stderr: errText || `Sandbox error HTTP ${res.status}`,
        exitCode: res.status,
        durationMs,
        target,
        timestamp,
        error: `Sandbox error HTTP ${res.status}`,
      };
    }

    const json = (await res.json()) as {
      ok: boolean;
      stdout?: string;
      stderr?: string;
      exitCode?: number;
      error?: string;
    };

    return {
      ok: json.ok && (json.exitCode === 0 || json.exitCode === undefined),
      command: trimmed,
      stdout: json.stdout || '',
      stderr: json.stderr || json.error || '',
      exitCode: json.exitCode ?? (json.ok ? 0 : 1),
      durationMs,
      target,
      cwd: workingDir,
      timestamp,
      error: json.error,
    };
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - t0);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      command: trimmed,
      stdout: '',
      stderr: `Failed to connect to sandbox runner at ${baseUrl}: ${msg}.\nMake sure 'npm run sandbox:watch' or 'npm run sandbox' is running.`,
      exitCode: -1,
      durationMs,
      target,
      cwd: workingDir,
      timestamp,
      error: msg,
    };
  }
}

/** Extract executable shell commands from markdown code blocks or <run>/<bash> tags */
export function extractShellCommands(text: string): string[] {
  const commands: string[] = [];

  // 1. Match <run>cmd</run> or <bash>cmd</bash> or <cmd>cmd</cmd>
  const tagRegex = /<(run|bash|cmd)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(text)) !== null) {
    const cmd = (match[2] || '').trim();
    if (cmd && !commands.includes(cmd)) commands.push(cmd);
  }

  // 2. Match markdown blocks: ```bash\n$ cmd\n``` or ```sh\n$ cmd\n```
  const mdDollarRegex = /```(?:bash|sh|zsh|shell)\s*\n(?:\$\s*)([^\n]+(?:\n(?:\s*&&|\\\n|\s*\|)[^\n]+)*)\n```/gi;
  while ((match = mdDollarRegex.exec(text)) !== null) {
    const cmd = (match[1] || '').trim();
    if (cmd && !commands.includes(cmd)) commands.push(cmd);
  }

  // 3. Match pure bash blocks: ```bash\ncmd\n```
  const mdPureRegex = /```(?:bash|sh|zsh|shell)\s*\n([\s\S]*?)\n```/gi;
  while ((match = mdPureRegex.exec(text)) !== null) {
    const raw = (match[1] || '').trim();
    // Ignore blocks that look like config or output
    if (raw && !raw.startsWith('#') && !raw.includes('```') && !commands.includes(raw)) {
      // Strip leading '$ ' if present on first line
      const clean = raw.replace(/^\$\s+/, '').trim();
      if (clean && !commands.includes(clean)) commands.push(clean);
    }
  }

  return commands;
}

/**
 * Spawn an ephemeral Linux container with pre-installed tools on DGX Spark or local host.
 */
export async function spawnLinuxContainer(opts: SpawnContainerOptions = {}): Promise<SpawnContainerResult> {
  const baseUrl = opts.baseUrl || getSandboxBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/api/sandbox/container/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        envId: opts.envId || `agent_${Date.now()}`,
        profile: opts.profile || 'python_data',
        target: opts.target || 'dgx_spark',
        extraPackages: opts.extraPackages || [],
        timeoutMinutes: opts.timeoutMinutes || 30,
        enableGpu: opts.enableGpu || false,
      }),
      signal: AbortSignal.timeout(45000),
    });
    return (await res.json()) as SpawnContainerResult;
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Teardown and destroy an ephemeral Linux container.
 */
export async function destroyLinuxContainer(
  envId: string,
  target: 'dgx_spark' | 'local_mac' = 'dgx_spark',
  baseUrl = getSandboxBaseUrl()
): Promise<{ ok: boolean; containerName?: string; error?: string }> {
  const safeTarget = target === 'local_mac' ? 'dgx_spark' : target;
  try {
    const res = await fetch(`${baseUrl}/api/sandbox/container/destroy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envId, target: safeTarget }),
      signal: AbortSignal.timeout(15000),
    });
    return (await res.json()) as { ok: boolean; containerName?: string; error?: string };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * List active Linux sandbox containers currently running.
 */
export async function listLinuxContainers(baseUrl = getSandboxBaseUrl()): Promise<{
  ok: boolean;
  containers: LinuxContainerInfo[];
  profiles?: Record<string, unknown>;
  error?: string;
}> {
  try {
    const res = await fetch(`${baseUrl}/api/sandbox/container/list`, {
      signal: AbortSignal.timeout(5000),
    });
    return (await res.json()) as {
      ok: boolean;
      containers: LinuxContainerInfo[];
      profiles?: Record<string, unknown>;
    };
  } catch (err: unknown) {
    return {
      ok: false,
      containers: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
