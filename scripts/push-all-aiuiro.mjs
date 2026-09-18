import { execSync } from 'child_process';

const AIUIRO_DIR = '/Users/adminuser/AIUIRO-216';

function run(cmd) {
  console.log(`\n> ${cmd}`);
  try {
    const out = execSync(cmd, { cwd: AIUIRO_DIR, encoding: 'utf-8' });
    if (out.trim()) console.log(out.trim());
    return { ok: true, output: out.trim() };
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    return { ok: false, error: err };
  }
}

console.log('=== COMMITTING ALL NEW SELF-HEALING ARTIFACTS IN AIUIRO-216 ===');
run('git status --short');
run('git add -A');
run('git status --short');
run('git commit -m "feat(self-healing): complete featherless ai autonomous self-healing suite and runner"');
run('git push origin main');
run('git ls-remote origin refs/heads/main');
run('git log -n 3 --oneline');
