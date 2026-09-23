#!/usr/bin/env node
/**
 * Prune and Archive MemPalace Test/Browser Wings.
 * 
 * Safely backs up ~/.mempalace/palace/chroma.sqlite3,
 * exports all matching drawers to ~/.mempalace/archive/<wing>_<date>.json,
 * and deletes them from Chroma vector and metadata tables using the official
 * MemPalace ChromaCollection API.
 * 
 * Usage:
 *   node scripts/memory/prune-mempalace-wings.mjs [--apply] [--pattern <regex>] [--dry-run]
 *   npm run mempalace:prune
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const home = os.homedir();
const palaceDir = path.join(home, '.mempalace', 'palace');
const dbPath = path.join(palaceDir, 'chroma.sqlite3');
const archiveDir = path.join(home, '.mempalace', 'archive');
const pythonBin = path.join(home, '.local', 'share', 'uv', 'tools', 'mempalace', 'bin', 'python');
const hallwaysPath = path.join(home, '.mempalace', 'hallways.json');

const args = process.argv.slice(2);
const isApply = args.includes('--apply');
const patternIndex = args.indexOf('--pattern');
const patternStr = patternIndex !== -1 && args[patternIndex + 1] ? args[patternIndex + 1] : 'test|smoke|browser';
const wingRegex = new RegExp(patternStr, 'i');

console.log('=== MEMPALACE TEST WINGS PRUNE & ARCHIVE ===');
console.log(`Palace DB: ${dbPath}`);
console.log(`Archive Dir: ${archiveDir}`);
console.log(`Matching pattern: ${wingRegex}`);
console.log(`Mode: ${isApply ? 'APPLY (Modifications will be made)' : 'DRY RUN (Use --apply to execute)'}\n`);

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}`);
  process.exit(1);
}

// 1. Inspect wings in SQLite
const db = new DatabaseSync(dbPath, { readOnly: true });
const wings = db.prepare(`
  SELECT string_value as wing, count(*) as count 
  FROM embedding_metadata 
  WHERE key = 'wing' 
  GROUP BY string_value 
  ORDER BY count DESC
`).all();

const targetWings = wings.filter(w => wingRegex.test(w.wing));
const totalDrawers = wings.reduce((s, w) => s + Number(w.count), 0);
const targetDrawers = targetWings.reduce((s, w) => s + Number(w.count), 0);
db.close();

console.log(`Total drawers in palace: ${totalDrawers}`);
console.log(`Target noisy wings found: ${targetWings.length} (${targetDrawers} drawers, ${((targetDrawers / totalDrawers) * 100).toFixed(1)}%):`);
for (const tw of targetWings) {
  console.log(`  - ${tw.wing}: ${tw.count} drawers`);
}

if (targetWings.length === 0) {
  console.log('\nNo matching noisy wings found! Palace is already clean.');
  process.exit(0);
}

if (!isApply) {
  console.log('\n[DRY RUN COMPLETED] To archive and purge these wings from Chroma, rerun with:');
  console.log('  npm run mempalace:prune -- --apply');
  process.exit(0);
}

// 2. Perform safety backup
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(palaceDir, `chroma.sqlite3.bak.${timestamp}`);
console.log(`\nCreating SQLite backup at ${backupPath}...`);
fs.copyFileSync(dbPath, backupPath);
console.log('Backup created successfully.');

if (!fs.existsSync(archiveDir)) {
  fs.mkdirSync(archiveDir, { recursive: true });
}

// 3. Export drawers and delete via MemPalace Python API
console.log('\nArchiving and purging target wings via MemPalace ChromaCollection API...');

const targetWingNames = targetWings.map(w => w.wing);
const pyScript = `
import os, json
from mempalace import palace

palace_path = os.path.expanduser("~/.mempalace/palace")
archive_dir = os.path.expanduser("~/.mempalace/archive")
target_wings = ${JSON.stringify(targetWingNames)}

drawers_col = palace.get_collection(palace_path)
closets_col = palace.get_closets_collection(palace_path)
total_deleted = 0

for wing in target_wings:
    print(f"Processing wing: {wing}")
    
    # 1. Purge from drawers collection
    records = drawers_col.get(where={"wing": wing}, include=["metadatas", "documents"])
    ids = records.get("ids", [])
    count = len(ids)
    if count > 0:
        archive_file = os.path.join(archive_dir, f"{wing}_drawers_${timestamp}.json")
        archive_data = {
            "wing": wing,
            "type": "drawers",
            "count": count,
            "archived_at": "${new Date().toISOString()}",
            "records": [
                {
                    "id": ids[i],
                    "document": records["documents"][i] if records.get("documents") else "",
                    "metadata": records["metadatas"][i] if records.get("metadatas") else {},
                }
                for i in range(count)
            ]
        }
        with open(archive_file, "w", encoding="utf-8") as f:
            json.dump(archive_data, f, indent=2)
        drawers_col.delete(ids=ids)
        total_deleted += count
        print(f"  Drawers: archived {count} and purged from Chroma.")

    # 2. Purge from closets collection
    closet_records = closets_col.get(where={"wing": wing}, include=["metadatas", "documents"])
    closet_ids = closet_records.get("ids", [])
    closet_count = len(closet_ids)
    if closet_count > 0:
        closet_archive_file = os.path.join(archive_dir, f"{wing}_closets_${timestamp}.json")
        closet_archive_data = {
            "wing": wing,
            "type": "closets",
            "count": closet_count,
            "archived_at": "${new Date().toISOString()}",
            "records": [
                {
                    "id": closet_ids[i],
                    "document": closet_records["documents"][i] if closet_records.get("documents") else "",
                    "metadata": closet_records["metadatas"][i] if closet_records.get("metadatas") else {},
                }
                for i in range(closet_count)
            ]
        }
        with open(closet_archive_file, "w", encoding="utf-8") as f:
            json.dump(closet_archive_data, f, indent=2)
        closets_col.delete(ids=closet_ids)
        total_deleted += closet_count
        print(f"  Closets: archived {closet_count} and purged from Chroma.")

print(f"PURGE_COMPLETE: {total_deleted}")
`;


try {
  const result = execSync(`"${pythonBin}" -c '${pyScript.replace(/'/g, "'\\''")}'`, { encoding: 'utf-8' });
  console.log(result);
} catch (err) {
  console.error('Error during Python purge:', err.message);
  process.exit(1);
}

// 4. Clean up hallways.json
if (fs.existsSync(hallwaysPath)) {
  try {
    const rawHallways = JSON.parse(fs.readFileSync(hallwaysPath, 'utf-8'));
    if (Array.isArray(rawHallways.hallways)) {
      const initialCount = rawHallways.hallways.length;
      rawHallways.hallways = rawHallways.hallways.filter(
        h => !targetWingNames.includes(h.wing) && !wingRegex.test(h.wing || '')
      );
      const removedHallways = initialCount - rawHallways.hallways.length;
      if (removedHallways > 0) {
        fs.writeFileSync(hallwaysPath, JSON.stringify(rawHallways, null, 2), 'utf-8');
        console.log(`Cleaned ${removedHallways} obsolete hallways from ${hallwaysPath}`);
      }
    }
  } catch (err) {
    console.warn('Notice: could not clean hallways.json:', err.message);
  }
}

// 5. Post-purge verification
const verifyDb = new DatabaseSync(dbPath, { readOnly: true });
const remainingWings = verifyDb.prepare(`
  SELECT string_value as wing, count(*) as count 
  FROM embedding_metadata 
  WHERE key = 'wing' 
  GROUP BY string_value 
  ORDER BY count DESC
`).all();

const newTotal = remainingWings.reduce((s, w) => s + Number(w.count), 0);
const remainingTestish = remainingWings.filter(w => wingRegex.test(w.wing));
const newTestishCount = remainingTestish.reduce((s, w) => s + Number(w.count), 0);
const newTestishShare = newTotal > 0 ? (newTestishCount / newTotal) : 0;
verifyDb.close();

console.log('\n=== POST-PURGE VERIFICATION ===');
console.log(`Total remaining drawers: ${newTotal}`);
console.log(`Testish drawers: ${newTestishCount} (${(newTestishShare * 100).toFixed(1)}%)`);
console.log('\nRemaining Wings:');
for (const rw of remainingWings) {
  console.log(`  - ${rw.wing}: ${rw.count}`);
}

console.log('\nMemPalace test/browser noise successfully resolved!');
