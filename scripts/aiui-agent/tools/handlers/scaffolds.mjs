import { SANDBOX_RUNNER_URL, SCAFFOLD_CATALOG } from '../../config.mjs';

/**
 * Handle list_scaffolds tool invocation
 */
export async function listScaffoldsHandler(args) {
  const list = Object.values(SCAFFOLD_CATALOG).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    fileCount: Object.keys(s.files || {}).length,
  }));
  let results = list;
  if (args.query) {
    const q = String(args.query).toLowerCase();
    results = list.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );
  }
  return JSON.stringify({ ok: true, total: results.length, scaffolds: results });
}

/**
 * Handle apply_scaffold tool invocation
 */
export async function applyScaffoldHandler(args, ctx) {
  const template = SCAFFOLD_CATALOG[args.templateId];
  if (!template) {
    return JSON.stringify({ ok: false, error: `Scaffold template ${args.templateId} not found` });
  }

  const projName = args.projectName || 'app';
  const filePayload = {};
  for (const [filePath, content] of Object.entries(template.files || {})) {
    filePayload[filePath] = { content: content.replaceAll('{{PROJECT_NAME}}', projName) };
  }

  try {
    const res = await fetch(`${SANDBOX_RUNNER_URL}/api/sandbox/materialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        envId: ctx.envId,
        target: args.target || ctx.target,
        files: filePayload,
        replaceAll: false,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      return JSON.stringify({
        ok: true,
        templateId: args.templateId,
        projectName: projName,
        writtenFiles: Object.keys(filePayload),
        message: `Successfully scaffolded ${args.templateId} with ${Object.keys(filePayload).length} files`,
      });
    }
  } catch {}

  // Fallback: write each file sequentially
  let written = 0;
  for (const [filePath, item] of Object.entries(filePayload)) {
    await ctx.executeTool('write_file', {
      path: filePath,
      content: item.content,
      target: args.target || ctx.target,
    });
    written++;
  }
  return JSON.stringify({ ok: true, templateId: args.templateId, writtenFilesCount: written });
}
