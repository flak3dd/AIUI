import fs from 'fs';

const existing = JSON.parse(fs.readFileSync('src/lib/scaffoldTemplates.json', 'utf8'));
const existingKeys = Object.keys(existing);
console.log('Existing count:', existingKeys.length);
console.log('Existing keys:', existingKeys);
