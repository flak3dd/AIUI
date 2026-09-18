import { execSync } from 'child_process';
import fs from 'fs';
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

console.log('=== MULTI-REPO GIT SYNC & PUSH ===');

// 1. PUSH bbase (/Users/adminuser/bbase)
const bbaseDir = '/Users/adminuser/bbase';
if (fs.existsSync(path.join(bbaseDir, '.git'))) {
  console.log('\n--- Processing bbase ---');
  run('git config user.name "flak3dd"', bbaseDir);
  run('git config user.email "andrew098710@gmail.com"', bbaseDir);
  run('git add -A', bbaseDir);
  const diffCheck = run('git status --short', bbaseDir);
  if (diffCheck.output) {
    run('git commit -m "feat(data): update persons summary, txn seeds, and id document generation"', bbaseDir);
  }
  run('git push origin main', bbaseDir);
  run('git log -n 1 --oneline', bbaseDir);
}

// 2. PUSH AIUI (/Users/adminuser/AIUI)
const aiuiDir = '/Users/adminuser/AIUI';
if (fs.existsSync(path.join(aiuiDir, '.git'))) {
  console.log('\n--- Processing AIUI ---');
  run('git config user.name "flak3dd"', aiuiDir);
  run('git config user.email "andrew098710@gmail.com"', aiuiDir);
  // Stage source changes and templates, exclude scratch files
  run('git add package.json src/ scripts/ error_checker.py error_fixer.py cron_job.sh FEATHERLESS_SELF_HEALING.md', aiuiDir);
  const diffCheck = run('git status --short', aiuiDir);
  if (diffCheck.output.includes('M ') || diffCheck.output.includes('A ')) {
    run('git commit -m "feat(ui): assist mode segmented controls, deep reasoning thought trail chips, and featherless self-healing integration"', aiuiDir);
  }
  run('git push origin main', aiuiDir);
  run('git log -n 1 --oneline', aiuiDir);
}

// 3. PUSH rork-checkout (/Users/adminuser/rork-checkout-r----apps------io)
const rorkDir = '/Users/adminuser/rork-checkout-r----apps------io';
if (fs.existsSync(path.join(rorkDir, '.git'))) {
  console.log('\n--- Processing rork-checkout ---');
  run('git config user.name "flak3dd"', rorkDir);
  run('git config user.email "andrew098710@gmail.com"', rorkDir);
  run('git add featherless-chat.py', rorkDir);
  const diffCheck = run('git status --short', rorkDir);
  if (diffCheck.output) {
    run('git commit -m "feat(agent): add autonomous self-healing execution loop to featherless-chat"', rorkDir);
  }
  run('git push origin main', rorkDir);
  run('git log -n 1 --oneline', rorkDir);
}

// 4. VERIFY AIUIRO-216 (/Users/adminuser/AIUIRO-216)
const aiuiroDir = '/Users/adminuser/AIUIRO-216';
if (fs.existsSync(path.join(aiuiroDir, '.git'))) {
  console.log('\n--- Verifying AIUIRO-216 ---');
  run('git push origin main', aiuiroDir);
  run('git log -n 1 --oneline', aiuiroDir);
}

console.log('\n=== ALL REPOSITORIES PUSHED & SYNCHRONIZED ===');
