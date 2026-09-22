import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  try {
    const out = execSync(cmd, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...opts,
    });
    if (out.trim()) console.log(out.trim());
    return { ok: true, output: out.trim() };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : '';
    const stdout = err.stdout ? err.stdout.toString().trim() : '';
    console.error(`ERROR: ${err.message}`);
    if (stdout) console.log(`STDOUT: ${stdout}`);
    if (stderr) console.error(`STDERR: ${stderr}`);
    return { ok: false, error: err, stderr, stdout };
  }
}

async function main() {
  console.log('=== STARTING GIT SYNC FOR AIUI ===');
  const cwd = process.cwd();
  console.log('Target directory:', cwd);

  // 1. Git init if not already initialized
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    console.log('Initializing git repository...');
    run('git init -b main');
  } else {
    run('git checkout -B main');
  }

  // 2. Set author identity if needed
  run('git config user.name "flak3dd"');
  run('git config user.email "andrew098710@gmail.com"');

  // 3. Stage files
  console.log('Staging files...');
  run('git add .');

  // Check status
  const statusRes = run('git status --short');

  // 4. Commit
  const defaultMsg = 'feat(agent): dotpoint thinking logic and consolidated bash workings section';
  const commitMsg = process.argv[2] || defaultMsg;
  console.log('Committing changes...');
  run(`git commit -m "${commitMsg}"`);

  // 5. Push to origin main
  console.log('Pushing to origin main...');
  const pushRes = run('git push origin main');
  if (!pushRes.ok) {
    run('git push -u origin main');
  }

  console.log('\n=== FINAL REPO STATUS ===');
  run('git status');
  run('git log -n 2 --oneline');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
