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
const routesHook = "return sendJson(res, 404, { ok: false, error: 'Not Found' });";
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

    // --- DYNAMIC TOOLS FAST-PATH ROUTES ---
    if (pathname === '/api/tools/dynamic' && req.method === 'GET') {
      try {
        const { dynamicToolManager } = await import('../dynamic-tool-manager.mjs');
        return sendJson(res, 200, { ok: true, tools: dynamicToolManager.registry.tools || {} });
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    if (pathname === '/api/tools/acquire' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const { dynamicToolManager } = await import('../dynamic-tool-manager.mjs');
        const result = await dynamicToolManager.researchAndAcquireTool(body);
        return sendJson(res, result.ok ? 200 : 400, result);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    if (pathname === '/api/tools/exec' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const { dynamicToolManager } = await import('../dynamic-tool-manager.mjs');
        const rawRes = await dynamicToolManager.executeTool(body.toolName, body.args);
        let parsed = null;
        try { parsed = JSON.parse(rawRes); } catch {}
        return sendJson(res, 200, parsed || { ok: true, raw: rawRes });
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }
`;

if (!content.includes('/api/sandbox/workspace') && content.includes(routesHook)) {
  content = content.replace(routesHook, `${newRoutes}\n    ${routesHook}`);
}

// 3. Remove any reference to the ssh|base64|bash chain from sandbox-runner
if (content.includes('echo ${b64} | base64 -d | bash')) {
  if (!content.includes('spawn')) {
    content = content.replace("import { exec, execFile } from 'node:child_process';", "import { exec, execFile, spawn } from 'node:child_process';");
  }
  const oldSshRemoteRegex = /async function sshRemote\s*\([\s\S]*?echo \$\{b64\} \| base64 -d \| bash[\s\S]*?\n\}/;
  const cleanSshRemote = `async function sshRemote(script, timeout = 30000) {
  const isLocal = process.env.USER === 'flak3dd' || (process.arch === 'arm64' && process.platform === 'linux');
  return new Promise((resolve, reject) => {
    const cmd = isLocal ? 'bash' : 'ssh';
    const args = isLocal
      ? ['-s']
      : [
          '-o', 'ProxyCommand=none',
          '-o', 'StrictHostKeyChecking=no',
          '-o', 'ConnectTimeout=10',
          '-o', 'ControlMaster=auto',
          '-o', \`ControlPath=\${SSH_CONTROL_PATH}\`,
          '-o', 'ControlPersist=10m',
          '-i', NVSYNC_SSH_KEY,
          'flak3dd@100.66.147.53',
          'bash -s',
        ];
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(\`Execution timed out after \${timeout}ms\`));
    }, timeout);
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(stderr.trim() || \`Process exited with code \${code}\`));
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.stdin.write(String(script));
    child.stdin.end();
  });
}`;
  content = content.replace(oldSshRemoteRegex, cleanSshRemote);
}

// 4. Remove base64 pipe file write in materialize
if (content.includes('echo ${b64} | base64 -d >')) {
  const oldWriteRegex = /const b64 = Buffer\.from\(fileData\.content \|\| ''\)\.toString\('base64'\);\s*commands\.push\(`echo \$\{b64\} \| base64 -d > \$\{JSON\.stringify\(abs\)\}`\);/;
  const cleanWrite = `const marker = \`__AIUI_EOF_\${Date.now()}_\${Math.random().toString(36).slice(2)}__\`;
          commands.push(\`cat << '\${marker}' > \${JSON.stringify(abs)}\\n\${fileData.content || ''}\\n\${marker}\`);`;
  content = content.replace(oldWriteRegex, cleanWrite);
}

// 5. Disable wrapper in /tmp/spark-sandboxes/direct_curl.sh if present
const directCurlPath = '/tmp/spark-sandboxes/direct_curl.sh';
if (fs.existsSync(directCurlPath)) {
  try {
    let curlContent = fs.readFileSync(directCurlPath, 'utf8');
    curlContent = curlContent.replace(/ssh .\/base64.*/g, '# wrapper disabled');
    fs.writeFileSync(directCurlPath, curlContent, 'utf8');
    console.log(`✔ Neutralized ssh|base64 wrappers in ${directCurlPath}`);
  } catch (err) {
    console.warn(`Could not patch ${directCurlPath}:`, err.message);
  }
}

fs.writeFileSync(RUNNER_FILE, content, 'utf8');
console.log(`✔ Successfully patched ${RUNNER_FILE} with workspace routes and clean execution!`);
