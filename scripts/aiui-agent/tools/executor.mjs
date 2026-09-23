import { dynamicToolManager } from '../../dynamic-tool-manager.mjs';
import { renderCard, badge } from '../ui/components.mjs';
import { rgb, c } from '../ui/skins.mjs';

import { bashToolHandler, sshToolHandler } from './handlers/bash.mjs';
import { readFileHandler, writeFileHandler } from './handlers/fs.mjs';
import {
  replaceFileContentHandler,
  multiReplaceFileContentHandler,
} from './handlers/diff.mjs';
import {
  grepSearchHandler,
  getFileOutlineHandler,
} from './handlers/search.mjs';
import {
  startDaemonHandler,
  readDaemonLogsHandler,
  stopDaemonHandler,
  listDaemonsHandler,
} from './handlers/daemon.mjs';
import {
  browserOpenHandler,
  browserScreenshotHandler,
  browserClickHandler,
  browserTypeHandler,
  browserConsoleLogsHandler,
} from './handlers/browser.mjs';
import { webUnblockerHandler } from './handlers/unblocker.mjs';
import { spawnSubagentHandler } from '../core/subagent.mjs';
import { handOffRun } from '../transport/n8n-handoff.mjs';
import { readRun, updateRun } from '../core/run-record.mjs';
import {
  spawnContainerHandler,
  destroyContainerHandler,
  listContainersHandler,
} from './handlers/containers.mjs';
import { memorySearchHandler, memoryCheckpointHandler } from './handlers/memory.mjs';
import { listScaffoldsHandler, applyScaffoldHandler } from './handlers/scaffolds.mjs';
import {
  listModelsHandler,
  httpGetJsonHandler,
  nowHandler,
  base64Handler,
} from './handlers/utils.mjs';
import {
  setWorkspaceDirHandler,
  getWorkspaceDirHandler,
} from './handlers/workspace.mjs';

/**
 * Central tool dispatcher routing calls to built-in handlers,
 * surgical intelligence handlers, subagents, or dynamic tools.
 */
export async function executeTool(name, argsJson, ctx = {}) {
  let args = {};
  try {
    args = typeof argsJson === 'string' ? JSON.parse(argsJson) : (argsJson || {});
  } catch {
    args = {};
  }

  if (ctx.logVerbose) {
    ctx.logVerbose(`Calling tool ${name}`, args);
  }

  // Core execution tools
  if (name === 'hand_off_run') {
    const record = readRun(ctx.runRecord?.id) || readRun(args.runId)
    const handed = await handOffRun(record)
    if (handed.ok && record) updateRun(record.id, { status: 'handed_off' })
    return JSON.stringify(handed)
  }

  if (name === 'bash') {
    return await bashToolHandler(args, ctx);
  }

  // Surgical Diff Intelligence (Pillar 1)
  if (name === 'replace_file_content') {
    return await replaceFileContentHandler(args, ctx);
  }

  if (name === 'multi_replace_file_content') {
    return await multiReplaceFileContentHandler(args, ctx);
  }

  // Fast Ripgrep Discovery & AST Outlines (Pillar 1)
  if (name === 'grep_search') {
    return await grepSearchHandler(args, ctx);
  }

  if (name === 'get_file_outline') {
    return await getFileOutlineHandler(args, ctx);
  }

  // File I/O
  if (name === 'write_file') {
    return await writeFileHandler(args, ctx);
  }

  if (name === 'read_file') {
    return await readFileHandler(args, ctx);
  }

  // Persistent Daemons & Background Process Supervisor (Pillar 3)
  if (name === 'start_daemon') {
    return await startDaemonHandler(args, ctx);
  }

  if (name === 'read_daemon_logs') {
    return await readDaemonLogsHandler(args, ctx);
  }

  if (name === 'stop_daemon') {
    return await stopDaemonHandler(args, ctx);
  }

  if (name === 'list_daemons') {
    return await listDaemonsHandler(args, ctx);
  }

  // Headless Browser Automation (Pillar 4)
  if (name === 'browser_open') {
    return await browserOpenHandler(args, ctx);
  }

  if (name === 'browser_screenshot') {
    return await browserScreenshotHandler(args, ctx);
  }

  if (name === 'browser_click') {
    return await browserClickHandler(args, ctx);
  }

  if (name === 'browser_type') {
    return await browserTypeHandler(args, ctx);
  }

  if (name === 'browser_console_logs') {
    return await browserConsoleLogsHandler(args, ctx);
  }

  // Bright Data Web Unlocker (Anti-Bot Bypass & Manual Expect Elements)
  if (name === 'web_unblocker') {
    return await webUnblockerHandler(args, ctx);
  }

  // Hierarchical Multi-Agent Subagent Delegation (Pillar 5)
  if (name === 'spawn_subagent') {
    return await spawnSubagentHandler(args, ctx);
  }

  // Remote & Container tools
  if (name === 'ssh') {
    return await sshToolHandler(args, ctx);
  }

  if (name === 'spawn_linux_container') {
    return await spawnContainerHandler(args, ctx);
  }

  if (name === 'destroy_linux_container') {
    return await destroyContainerHandler(args, ctx);
  }

  if (name === 'list_linux_containers') {
    return await listContainersHandler();
  }

  // Memory & Context tools
  if (name === 'memory_search') {
    return await memorySearchHandler(args);
  }

  if (name === 'memory_checkpoint') {
    return await memoryCheckpointHandler(args);
  }

  // Utilities
  if (name === 'list_models') {
    return await listModelsHandler(args, ctx);
  }

  if (name === 'http_get_json') {
    return await httpGetJsonHandler(args);
  }

  if (name === 'now') {
    return nowHandler();
  }

  if (name === 'base64') {
    return base64Handler(args);
  }

  if (name === 'list_scaffolds') {
    return await listScaffoldsHandler(args);
  }

  if (name === 'apply_scaffold') {
    return await applyScaffoldHandler(args, ctx);
  }

  if (name === 'set_workspace_dir') {
    return setWorkspaceDirHandler(args, ctx);
  }

  if (name === 'get_workspace_dir') {
    return getWorkspaceDirHandler(ctx);
  }

  // Dynamic tool manager integrations
  if (name === 'research_and_acquire_tool') {
    const res = await dynamicToolManager.researchAndAcquireTool(args);
    if (res.ok && res.definition) {
      if (ctx.dynamicTools && !ctx.dynamicTools.some((t) => t.function.name === res.toolName)) {
        ctx.dynamicTools.push(res.definition);
      }
      if (ctx.log && ctx.skin) {
        ctx.log(
          renderCard({
            title: `🧩 DYNAMIC TOOL ACQUIRED: ${res.toolName}`,
            badge: badge('✔ HOT-LOADED', ctx.skin.success, [15, 35, 25]),
            lines: [
              `${rgb(...ctx.skin.gold)}${res.message}${c.reset}`,
              `${rgb(...ctx.skin.muted)}Entrypoint: ${c.reset}${res.entrypoint}`,
              `${rgb(...ctx.skin.muted)}Smoke Test: ${c.reset}Exit code ${res.smokeTest?.exitCode ?? 0}`,
            ],
            skin: ctx.skin,
            width: 76,
          })
        );
      }
    }
    return JSON.stringify(res, null, 2);
  }

  if (name === 'list_acquired_tools') {
    const list = dynamicToolManager.listAcquiredTools();
    return JSON.stringify({ ok: true, count: list.length, tools: list }, null, 2);
  }

  if (name === 'remove_acquired_tool') {
    const res = dynamicToolManager.removeTool(args.tool_name);
    if (ctx.dynamicTools) {
      ctx.dynamicTools = ctx.dynamicTools.filter((t) => t.function.name !== args.tool_name);
    }
    return JSON.stringify(res);
  }

  // Check if tool is an acquired dynamic tool
  if (dynamicToolManager.registry.tools?.[name]) {
    return await dynamicToolManager.executeTool(name, argsJson);
  }

  // JIT Unknown Tool Auto-Synthesis Fallback
  try {
    if (ctx.log && ctx.skin) {
      ctx.log(`  ${rgb(...ctx.skin.warning)}⚡ JIT Tool Discovery Triggered for '${name}'...${c.reset}`);
    }
    const jitRes = await dynamicToolManager.autoSynthesizeMissingTool(name, argsJson);
    if (jitRes.ok) {
      if (ctx.dynamicTools && !ctx.dynamicTools.some((t) => t.function.name === jitRes.toolName)) {
        ctx.dynamicTools.push(jitRes.definition);
      }
      if (ctx.log && ctx.skin) {
        ctx.log(
          renderCard({
            title: `⚡ JIT TOOL SYNTHESIZED & EXECUTED: ${name}`,
            badge: badge('✔ JIT ACTIVE', ctx.skin.accent, [30, 15, 35]),
            lines: [
              `Tool was automatically synthesized, tested, and executed mid-response.`,
            ],
            skin: ctx.skin,
            width: 76,
          })
        );
      }
      return jitRes.executionResult;
    }
  } catch (jitErr) {
    if (ctx.logVerbose) {
      ctx.logVerbose('JIT Synthesis failed', jitErr.message);
    }
  }

  return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
}
