import { execSync } from 'child_process';
import path from 'path';

function run(cmd, cwd) {
  console.log(`\n[${path.basename(cwd)}] > ${cmd}`);
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

console.log('=== SYNCING AND PUSHING AIUIRO-216 & AIUI ===');

// 1. AIUIRO-216: pull --rebase and push
const aiuiroDir = '/Users/adminuser/AIUIRO-216';
console.log('\n--- Syncing AIUIRO-216 ---');
run('git config user.name "flak3dd"', aiuiroDir);
run('git config user.email "andrew098710@gmail.com"', aiuiroDir);
run('git fetch origin main', aiuiroDir);
run('git log origin/main -n 2 --oneline', aiuiroDir);
run('git pull --rebase origin main', aiuiroDir);
run('git push origin main', aiuiroDir);
run('git ls-remote origin refs/heads/main', aiuiroDir);
run('git log -n 2 --oneline', aiuiroDir);

// 2. AIUI: stage, commit, and push
const aiuiDir = '/Users/adminuser/AIUI';
console.log('\n--- Syncing AIUI ---');
run('git config user.name "flak3dd"', aiuiDir);
run('git config user.email "andrew098710@gmail.com"', aiuiDir);
run('git add package.json src/ scripts/', aiuiDir);
run('git status --short', aiuiDir);
run('git commit -m "feat(ui): assist mode segmented control, deep reasoning chips, and featherless self-healing integration"', aiuiDir);
run('git push origin main', aiuiDir);
run('git ls-remote origin refs/heads/main', aiuiDir);
run('git log -n 2 --oneline', aiuiDir);
