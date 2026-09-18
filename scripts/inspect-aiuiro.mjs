import { execSync } from 'child_process';

function run(cmd, cwd = '/Users/adminuser/AIUIRO-216') {
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf-8' });
    return out.trim();
  } catch (err) {
    return `ERROR: ${err.message}\nSTDOUT: ${err.stdout?.toString()}\nSTDERR: ${err.stderr?.toString()}`;
  }
}

console.log('=== AIUIRO-216 FULL GIT STATUS ===');
console.log(run('git status -u'));

console.log('=== AIUIRO-216 DIFF ===');
console.log(run('git diff --stat'));

console.log('=== AIUIRO-216 LOG ===');
console.log(run('git log -n 3 --oneline'));
