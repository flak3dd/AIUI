#!/usr/bin/env node
/**
 * MemPalace DB & Memory Hygiene Inspector.
 * 
 * Reports drawer counts, wing distribution, testish noise ratio,
 * and evaluates whether the sys-self-improvement monitor's noise metric will fire.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const home = os.homedir();
const dbPath = path.join(home, '.mempalace', 'palace', 'chroma.sqlite3');
const archiveDir = path.join(home, '.mempalace', 'archive');

console.log('=== MEMPALACE DATABASE & HYGIENE STATUS ===');
console.log(`Palace Path: ${dbPath}`);

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}`);
  process.exit(1);
}

try {
  const db = new DatabaseSync(dbPath, { readOnly: true });

  const wings = db.prepare(`
    SELECT string_value as wing, count(*) as count 
    FROM embedding_metadata 
    WHERE key = 'wing' 
    GROUP BY string_value 
    ORDER BY count DESC
  `).all();

  const totalDrawers = wings.reduce((s, w) => s + Number(w.count), 0);
  const testish = wings.filter(w => /test|smoke|browser/i.test(w.wing));
  const testishCount = testish.reduce((s, w) => s + Number(w.count), 0);
  const testishShare = totalDrawers > 0 ? (testishCount / totalDrawers) : 0;

  console.log('\n--- WING BREAKDOWN ---');
  console.table(wings);

  console.log('--- METRIC EVALUATION ---');
  console.log(`Total Drawers:        ${totalDrawers}`);
  console.log(`Test/Browser Drawers: ${testishCount}`);
  console.log(`Testish Share:        ${(testishShare * 100).toFixed(1)}% (Threshold: 35.0%)`);
  console.log(`Total Drawers > 800:  ${totalDrawers > 800 ? 'YES (Trigger condition 1 met)' : 'NO (Trigger condition 1 NOT met)'}`);
  console.log(`Testish Share >= 35%: ${testishShare >= 0.35 ? 'YES (Trigger condition 2 met)' : 'NO (Trigger condition 2 NOT met)'}`);

  const metricFires = totalDrawers > 800 && testishShare >= 0.35;
  if (metricFires) {
    console.log('\n⚠️  ALERT: mempalace-noisy-test-wings (MEDIUM) WOULD FIRE!');
    console.log('Action: Run `npm run mempalace:prune:apply` to archive and purge noisy drawers.');
  } else {
    console.log('\n✅ CLEAN: mempalace-noisy-test-wings (MEDIUM) WILL NOT FIRE.');
    console.log('Palace memory noise is within nominal limits.');
  }

  // Check archives
  if (fs.existsSync(archiveDir)) {
    const archives = fs.readdirSync(archiveDir);
    console.log(`\nArchived Wing Snapshots in ${archiveDir}: ${archives.length} files`);
    for (const a of archives.slice(0, 5)) {
      console.log(`  - ${a}`);
    }
    if (archives.length > 5) console.log(`  ... and ${archives.length - 5} more`);
  }

  db.close();
} catch (err) {
  console.error('Error:', err);
  process.exit(1);
}
