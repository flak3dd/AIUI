import { execSync } from 'child_process';

const apiKey = 'rc_a939625b5ebea3e527e07ee81d1d3ac10a77be72203eed6e53c3a81f4174a86a';
const cmd = `curl -s -X POST https://api.featherless.ai/v1/chat/completions \
  -H "Authorization: Bearer ${apiKey}" \
  -H "Content-Type: application/json" \
  -d '{"model":"Qwen/Qwen2.5-7B-Instruct","messages":[{"role":"user","content":"Say HEALING_ONLINE"}],"max_tokens":10}'`;

try {
  const out = execSync(cmd, { encoding: 'utf-8' });
  console.log('Featherless response:\n', out);
} catch (err) {
  console.error('Error:', err.message);
}
