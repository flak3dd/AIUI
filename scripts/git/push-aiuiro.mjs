import { execSync } from 'child_process';

const cwd = '/Users/adminuser/AIUIRO-216';

function run(cmd) {
  console.log(`\n> ${cmd}`);
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf-8' });
    if (out.trim()) console.log(out.trim());
    return { ok: true, output: out.trim() };
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    if (err.stdout?.toString()) console.log(`STDOUT: ${err.stdout.toString().trim()}`);
    if (err.stderr?.toString()) console.error(`STDERR: ${err.stderr.toString().trim()}`);
    return { ok: false, error: err };
  }
}

console.log('=== COMMITTING AND PUSHING TO AIUIRO-216 ===');
run('git config user.name "flak3dd"');
run('git config user.email "andrew098710@gmail.com"');
run('git status --short');
run('git add cron_job.sh error_checker.py error_fixer.py');
run('git status --short');
run('git commit -m "feat(automation): add error checker, error fixer scripts and cron runner"');
run('git push origin main');

console.log('\n=== VERIFY REMOTE HEAD ===');
run('git ls-remote origin refs/heads/main');
run('git log -n 2 --oneline');
run('git status');
