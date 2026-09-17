import os from 'node:os';
import { execSync } from 'node:child_process';

const totalMemGB = (os.totalmem() / 1024 ** 3).toFixed(1);
const freeMemGB = (os.freemem() / 1024 ** 3).toFixed(1);
const usedMemGB = ((os.totalmem() - os.freemem()) / 1024 ** 3).toFixed(1);
const memPercent = (((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(1);

let vmInfo = '';
try {
  const vm = execSync('vm_stat', { encoding: 'utf8' });
  const lines = Object.fromEntries(
    vm.split('\n')
      .map(l => l.split(':'))
      .filter(p => p.length === 2)
      .map(([k, v]) => [k.trim(), parseInt(v.trim().replace('.', ''), 10) * 16384])
  );
  const wired = ((lines['Pages wired down'] || 0) / 1024 ** 3).toFixed(1);
  const active = ((lines['Pages active'] || 0) / 1024 ** 3).toFixed(1);
  const compressed = ((lines['Pages occupied by compressor'] || 0) / 1024 ** 3).toFixed(1);
  vmInfo = `(Wired: ${wired}GB | Active: ${active}GB | Compressed: ${compressed}GB)`;
} catch {}

console.log(`[MEMORY] Total: ${totalMemGB} GB | Used: ${usedMemGB} GB (${memPercent}%) | Free: ${freeMemGB} GB ${vmInfo}`);
console.log(`[LOAD AVG] 1m: ${os.loadavg()[0].toFixed(2)} | 5m: ${os.loadavg()[1].toFixed(2)} | 15m: ${os.loadavg()[2].toFixed(2)}`);

try {
  const ps = execSync('ps -A -o pid,%cpu,%mem,etime,command', { encoding: 'utf8' }).split('\n');
  const filters = ['vite', 'codebuddy', 'spark', 'vllm', 'monitor-agent', 'sandbox', 'mempalace', 'zsh', 'bash'];
  console.log('\n[CONSECUTIVE BASH & WORKINGS]');
  console.log(String('PID').padEnd(7) + String('%CPU').padEnd(6) + String('%MEM').padEnd(6) + String('ELAPSED').padEnd(12) + 'COMMAND');
  console.log('-'.repeat(75));
  for (const line of ps) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 5) {
      const cmd = parts.slice(4).join(' ');
      if (filters.some(f => cmd.toLowerCase().includes(f)) && !cmd.includes('sys-summary') && !cmd.includes('grep')) {
        const pid = parts[0].padEnd(7);
        const cpu = parts[1].padEnd(6);
        const mem = parts[2].padEnd(6);
        const el = parts[3].padEnd(12);
        const shortCmd = cmd.length > 44 ? cmd.substring(0, 41) + '...' : cmd;
        console.log(`${pid}${cpu}${mem}${el}${shortCmd}`);
      }
    }
  }
} catch (e) {
  console.log('Error inspecting processes:', e.message);
}
