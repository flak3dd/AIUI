import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const cwd = '/Users/adminuser/spacedrop';

console.log('=== INSPECTING SPACEDROP GIT STATE ===');
console.log('Exists:', fs.existsSync(cwd));
console.log('.git exists:', fs.existsSync(path.join(cwd, '.git')));

if (fs.existsSync(path.join(cwd, '.git'))) {
  try {
    console.log('Remotes:\n', execSync('git remote -v', { cwd, encoding: 'utf-8' }).trim());
  } catch (e) { console.log('Remotes error:', e.message); }
  try {
    console.log('Branch:\n', execSync('git branch -a', { cwd, encoding: 'utf-8' }).trim());
  } catch (e) { console.log('Branch error:', e.message); }
  try {
    console.log('Status:\n', execSync('git status --short', { cwd, encoding: 'utf-8' }).trim());
  } catch (e) { console.log('Status error:', e.message); }
  try {
    console.log('Recent commits:\n', execSync('git log -n 3 --oneline', { cwd, encoding: 'utf-8' }).trim());
  } catch (e) { console.log('Log error:', e.message); }
} else {
  console.log('Not a git repository. Checking gh repo list to see if a remote repo exists...');
  try {
    console.log(execSync('gh repo list --limit 15', { encoding: 'utf-8' }));
  } catch (e) { console.log('gh error:', e.message); }
}
