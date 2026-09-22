import fs from 'fs';

// Read existing or verify keys
const data = JSON.parse(fs.readFileSync('src/lib/scaffoldTemplates.json', 'utf8'));
console.log('Template count:', Object.keys(data).length);
// Verify required keys
const sampleKeys = ['generic', 'node-api', 'express-users', 'next-app', 'fastapi', 'go-api', 'helm-chart', 'k8s-basic', 'monorepo-turbo'];
for (const k of sampleKeys) {
  if (!data[k]) console.error('MISSING KEY:', k);
  else console.log(`✓ ${k}: ${data[k].name} (${Object.keys(data[k].files).length} files)`);
}
