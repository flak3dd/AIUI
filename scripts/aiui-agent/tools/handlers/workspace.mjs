import { ROOT_DIR } from '../../config.mjs';

/**
 * Handle set_workspace_dir tool invocation
 */
export function setWorkspaceDirHandler(args, ctx) {
  const dir = String(args.directory || '').trim();
  if (!dir) return JSON.stringify({ ok: false, error: 'Directory required' });
  ctx.workspaceDir = dir;
  if (args.target) ctx.target = args.target;
  return JSON.stringify({ ok: true, workspaceDir: ctx.workspaceDir, target: ctx.target });
}

/**
 * Handle get_workspace_dir tool invocation
 */
export function getWorkspaceDirHandler(ctx) {
  return JSON.stringify({
    ok: true,
    activeWorkspace: ctx.workspaceDir,
    target: ctx.target,
    presets: [
      { label: 'DGX Spark Sandbox', path: '/tmp/spark-sandboxes/web_session', target: 'dgx_spark' },
      { label: 'GX10 NVMe Workspaces', path: '/mnt/nvme/ocr_pipeline/workspaces', target: 'dgx_spark' },
      { label: 'AIUI Web App Root', path: ROOT_DIR, target: 'local_mac' },
    ],
  });
}
