import { spawn } from 'node:child_process';

const SSH_KEY = '"/Users/adminuser/Library/Application Support/NVIDIA/Sync/config/nvsync.key"';
const SPARK_HOST = process.env.SPARK_HOST || '100.66.147.53';
const SPARK_USER = 'flak3dd';

async function sshExec(cmd) {
  const keyClean = SSH_KEY.replace(/^"|"$/g, '');
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ssh',
      [
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=8',
        '-o', 'StrictHostKeyChecking=no',
        '-i', keyClean,
        `${SPARK_USER}@${SPARK_HOST}`,
        'bash -s',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(stderr || `Exited with code ${code}`));
    });
    child.on('error', reject);
    child.stdin.write(cmd);
    child.stdin.end();
  });
}

console.log('=== INSPECTING /tmp/spark-sandboxes ON DGX SPARK ===');
try {
  const res = await sshExec(`
    echo "--- WEB_SESSION LISTING ---"
    ls -la /tmp/spark-sandboxes/web_session/ 2>/dev/null
    echo ""
    echo "--- CHECKING FOR NESTED tmp/ ---"
    find /tmp/spark-sandboxes/web_session/ -name "*error_checker*" -o -name "*tmp*" 2>/dev/null
  `);

  console.log(res.stdout);
} catch (err) {
  console.error('Error:', err.message);
}
