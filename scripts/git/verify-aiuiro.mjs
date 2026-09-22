import { execSync } from 'child_process';

const cwd = '/Users/adminuser/AIUIRO-216';

console.log('=== VERIFYING AIUIRO-216 SUITE ===');

console.log('1. python3 error_checker.py:');
try {
  const out1 = execSync('python3 error_checker.py', { cwd, encoding: 'utf-8' });
  console.log(out1.trim());
} catch (e) {
  console.log(e.stdout?.toString() || e.message);
}

console.log('\n2. python3 error_fixer.py:');
try {
  const out2 = execSync('python3 error_fixer.py', { cwd, encoding: 'utf-8' });
  console.log(out2.trim());
} catch (e) {
  console.log(e.stdout?.toString() || e.message);
}

console.log('\n3. python3 test_script.py:');
try {
  const out3 = execSync('python3 test_script.py', { cwd, encoding: 'utf-8' });
  console.log(out3.trim());
} catch (e) {
  console.log(e.stdout?.toString() || e.message);
}

console.log('\n4. git status:');
try {
  const out4 = execSync('git status', { cwd, encoding: 'utf-8' });
  console.log(out4.trim());
} catch (e) {
  console.log(e.message);
}
