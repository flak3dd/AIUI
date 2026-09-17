import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function run(cmd, cwd = process.cwd()) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8' }).trim();
  } catch (err) {
    return `ERROR: ${err.message}`;
  }
}

console.log('=== CURRENT DIRECTORY ===');
console.log('cwd:', process.cwd());
console.log('.git exists in cwd?:', fs.existsSync(path.join(process.cwd(), '.git')));

console.log('\n=== GITHUB AUTH & GH CLI ===');
console.log('gh auth status:\n', run('gh auth status'));
console.log('ssh github:\n', run('ssh -T -o StrictHostKeyChecking=no git@github.com'));
console.log('gh repo list:\n', run('gh repo list --limit 10'));

console.log('\n=== CHECK SPECIFIC GITHUB REPOS ===');
for (const repo of ['flak3dd/AIUI', 'flak3dd/aiui', 'flak3dd/rego-ppsr-dashboard', 'flak3dd/r', 'flak3dd/web-api-app']) {
  console.log(`Checking ${repo}:`, run(`gh repo view ${repo} --json name,url,isPrivate`));
}
for (const dir of ['/Users/adminuser/AIUI', '/Users/adminuser/r', '/Users/adminuser/abliterated_ui']) {
  console.log(`\n--- ${dir} ---`);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    console.log('No .git directory');
    continue;
  }
  console.log('Branch:', run('git branch --show-current', dir));
  console.log('Recent commits:\n', run('git log -n 3 --oneline', dir));
  console.log('Remotes:\n', run('git remote -v', dir));
  console.log('Status summary:\n', run('git status --short', dir).slice(0, 500));
}
