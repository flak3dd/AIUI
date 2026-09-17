import fs from 'fs';

function parseEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
  return env;
}

const envVars = [
  'AI_API_KEY',
  'AI_BASE_URL',
  'AI_ENABLED',
  'AI_MODEL',
  'BPOINT_CARD_CSV',
  'BPOINT_CARD_CVV',
  'BPOINT_CARD_EXPIRY',
  'BPOINT_CARD_HOLDER',
  'BPOINT_CARD_NUMBER',
  'BPOINT_CARDS_QUEUE',
  'BPOINT_DRY_RUN',
  'BPOINT_DUMP_OUT',
  'BPOINT_DUMP_URL',
  'BPOINT_HEADLESS',
  'BRIGHTDATA_HOST',
  'BRIGHTDATA_PASS',
  'BRIGHTDATA_PORT',
  'BRIGHTDATA_USER',
  'CHECK_FAST',
  'CHECKOUT_FAST',
  'COOKIE_SECURE',
  'CORS_ORIGIN',
  'DEV_ALLOW_DEFAULT_PASSWORD',
  'LOGIN_PASSWORD',
  'NODE_ENV',
  'OPENAI_API_KEY',
  'PORT',
  'REGO_HEADLESS',
  'REGO_MAX_HITS',
  'REGO_MAX_PLATES',
  'REGO_START',
  'REGO_START_PLATE',
  'REGO_WORKERS',
  'SHELL',
  'SPARK_HOST',
  'SPARK_SSH_ALIAS',
  'VITEST',
];

// Load /Users/adminuser/r/.env if present
const rEnv = parseEnvFile('/Users/adminuser/r/.env');

// In-code defaults from ~/r source analysis
const defaults = {
  AI_BASE_URL: 'https://api.openai.com/v1',
  AI_ENABLED: 'true (if API key set)',
  AI_MODEL: 'gpt-4o-mini',
  BPOINT_CARD_HOLDER: 'John Smith',
  BPOINT_DRY_RUN: 'false',
  BPOINT_DUMP_OUT: '/tmp/bpoint_dump.html',
  BPOINT_DUMP_URL: 'https://bpoint.com.au/pay/tricare',
  BPOINT_HEADLESS: 'true',
  BRIGHTDATA_HOST: 'brd.superproxy.io',
  BRIGHTDATA_PORT: '33335',
  DEV_ALLOW_DEFAULT_PASSWORD: '1',
  NODE_ENV: 'development',
  PORT: '3050',
  REGO_HEADLESS: 'true',
  REGO_MAX_HITS: '0',
  REGO_MAX_PLATES: '0',
  REGO_WORKERS: '5',
  SHELL: process.env.SHELL || '/bin/zsh',
  SPARK_HOST: '192.168.4.103',
  SPARK_SSH_ALIAS: 'flak3dd',
};

const results = [];
for (const key of envVars) {
  const fileVal = rEnv[key];
  const procVal = process.env[key];
  const defVal = defaults[key];
  const current = fileVal !== undefined ? fileVal : (procVal !== undefined ? procVal : (defVal !== undefined ? defVal : '(not set)'));
  const source = fileVal !== undefined ? '~/r/.env' : (procVal !== undefined ? 'process.env' : (defVal !== undefined ? 'code-default' : 'none'));
  
  results.push({ key, value: current, source });
}

console.log(JSON.stringify(results, null, 2));
