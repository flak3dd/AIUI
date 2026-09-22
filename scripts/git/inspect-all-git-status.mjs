import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const dirs = [
  { name: 'AIUI', path: '/Users/adminuser/AIUI' },
  { name: 'AIUIRO-216', path: '/Users/adminuser/AIUIRO-216' },
  { name: 'rork-checkout', path: '/Users/adminuser/rork-checkout-r----apps------io' },
  { name: 'r', path: '/Users/adminuser/r' },
  { name: 'bbase', path: '/Users/adminuser/bbase' }
];

console.log('=== MULTI-REPO GIT INSPECTION ===');

for (const d of dirs) {
  console.log(`\n========================================`);
  console.log(`Repository: ${d.name} (${d.path})`);
  console.log(`========================================`);
  if (!fs.existsSync(path.join(d.path, '.git'))) {
    console.log('Not a git repository.');
    continue;
  }
  try {
    const branch = execSync('git branch --show-current', { cwd: d.path, encoding: 'utf-8' }).trim();
    const remotes = execSync('git remote -v', { cwd: d.path, encoding: 'utf-8' }).trim();
    const status = execSync('git status --short', { cwd: d.path, encoding: 'utf-8' }).trim();
    console.log(`Branch: ${branch}`);
    console.log(`Remotes:\n${remotes}`);
    console.log(`Status:\n${status || '(clean)'}`);

    try {
      const unpushed = execSync(`git log origin/${branch}..HEAD --oneline`, { cwd: d.path, encoding: 'utf-8' }).trim();
      console.log(`Unpushed commits vs origin/${branch}:\n${unpushed || '(none)'}`);
    } catch (e) {
      console.log(`Unpushed check note: ${e.message.split('\n')[0]}`);
    }
  } catch (err) {
    console.log(`Error checking ${d.name}: ${err.message}`);
  }
}
