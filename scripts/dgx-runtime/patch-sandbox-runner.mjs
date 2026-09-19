import fs from 'node:fs';
import path from 'node:path';

const RUNNER_FILE = process.argv[2] || path.resolve(process.env.HOME || '', 'abliterated_ui/scripts/sandbox-runner.mjs');

if (!fs.existsSync(RUNNER_FILE)) {
  console.error(`Runner file not found at ${RUNNER_FILE}`);
  process.exit(1);
}

let content = fs.readFileSync(RUNNER_FILE, 'utf8');

// 1. Add imports if not present
if (!content.includes('sandbox-workspaces.mjs')) {
  const importTarget = "import {\n  CONTAINER_PROFILES,";
  const newImports = `import {\n  allocateWorkspace,\n  resolveWorkspace,\n  listWorkspaces,\n} from './sandbox-workspaces.mjs';\nimport { syncAiuiRepo } from './sandbox-git-sync.mjs';\n`;
  content = content.replace(importTarget, `${newImports}${importTarget}`);
}

// 2. Add routes before 404 handler
const routesHook = "// 404 Catch-All";
const newRoutes = `
    // --- WORKSPACE & GIT SYNC ROUTES ---
    if (pathname === '/api/sandbox/workspace' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      if (!body.chatId) return sendJson(res, 400, { ok: false, error: 'chatId required' });
      try {
        const ws = await allocateWorkspace({ chatId: body.chatId, baseDir: SANDBOX_BASE_REMOTE });
        return sendJson(res, 200, { ok: true, ...ws });
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    if (pathname === '/api/sandbox/workspace' && req.method === 'GET') {
      const chatId = url.searchParams.get('chatId');
      const envId = url.searchParams.get('envId');
      const ws = await resolveWorkspace({ chatId, envId, baseDir: SANDBOX_BASE_REMOTE });
      if (!ws) return sendJson(res, 404, { ok: false, error: 'Workspace not found' });
      return sendJson(res, 200, { ok: true, ...ws });
    }

    if (pathname === '/api/sandbox/workspaces' && req.method === 'GET') {
      const list = await listWorkspaces(SANDBOX_BASE_REMOTE);
      return sendJson(res, 200, { ok: true, workspaces: list });
    }

    if (pathname === '/api/sandbox/sync' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const chatId = body.chatId;
      let envId = body.envId;
      let wsPath;
      if (chatId) {
        const ws = await allocateWorkspace({ chatId, baseDir: SANDBOX_BASE_REMOTE });
        envId = ws.envId;
        wsPath = ws.path;
      } else if (envId) {
        const ws = await resolveWorkspace({ envId, baseDir: SANDBOX_BASE_REMOTE });
        wsPath = ws ? ws.path : path.join(SANDBOX_BASE_REMOTE, envId);
      } else {
        return sendJson(res, 400, { ok: false, error: 'chatId or envId required' });
      }
      const result = await syncAiuiRepo({
        workspacePath: wsPath,
        remoteUrl: body.remoteUrl,
        branch: body.branch,
      });
      return sendJson(res, result.ok ? 200 : 500, { ...result, envId });
    }
`;

if (!content.includes('/api/sandbox/workspace') && content.includes(routesHook)) {
  content = content.replace(routesHook, `${newRoutes}\n    ${routesHook}`);
}

fs.writeFileSync(RUNNER_FILE, content, 'utf8');
console.log(`✔ Successfully patched ${RUNNER_FILE} with workspace & git sync routes!`);
