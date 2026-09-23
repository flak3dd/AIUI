import { execSync } from 'child_process';

const apiKey = process.env.FEATHERLESS_API_KEY;
if (!apiKey) {
  console.error('FEATHERLESS_API_KEY is required');
  process.exit(1);
}

const cmd = `curl -s -X POST https://api.featherless.ai/v1/chat/completions \
  -H "Authorization: Bearer ${apiKey}" \
  -H "Content-Type: application/json" \
  -d '{"model":"Qwen/Qwen2.5-Coder-32B-Instruct","messages":[{"role":"user","content":"Say HEALING_ONLINE"}],"max_tokens":10}'`;

try {
  const out = execSync(cmd, { encoding: 'utf-8' });
  console.log('Featherless response:\n', out);
} catch (err) {
  console.error('Error:', err.message);
}
