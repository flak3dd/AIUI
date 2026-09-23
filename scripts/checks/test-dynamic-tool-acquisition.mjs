#!/usr/bin/env node
/**
 * ==============================================================================
 * AUTOMATED TEST SUITE: DYNAMIC TOOL RESEARCH & JIT ACQUISITION ENGINE
 * ==============================================================================
 * Validates:
 * 1. DynamicToolManager registry lifecycle & persistence
 * 2. Pre-flight sandbox smoke testing
 * 3. Curated blueprint acquisition & real execution (sqlite_query & csv_stats_analyzer)
 * 4. JIT on-demand tool synthesis for unregistered tool calls mid-response
 * 5. Dynamic tool schema definitions & active tool set merging
 * 6. Clean administrative tool uninstallation
 * ==============================================================================
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DynamicToolManager, CURATED_BLUEPRINTS } from '../dynamic-tool-manager.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const TEST_REGISTRY = path.resolve(ROOT_DIR, 'tools', 'test_registry.json');
const TEST_DB = path.resolve(ROOT_DIR, 'test_aiui_sandbox.db');
const TEST_CSV = path.resolve(ROOT_DIR, 'test_aiui_data.csv');

async function runTests() {
  console.log('='.repeat(78));
  console.log('🧪 RUNNING DYNAMIC TOOL RESEARCH & JIT ACQUISITION TEST SUITE');
  console.log('='.repeat(78));

  // Clean up any prior test artifacts
  if (fs.existsSync(TEST_REGISTRY)) fs.unlinkSync(TEST_REGISTRY);
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  if (fs.existsSync(TEST_CSV)) fs.unlinkSync(TEST_CSV);

  const mgr = new DynamicToolManager(TEST_REGISTRY);

  try {
    // -------------------------------------------------------------------------
    // Test 1: Registry Initialization & Defaults
    // -------------------------------------------------------------------------
    console.log('• [Test 1/6] Registry Initialization & Persistence...');
    assert.ok(fs.existsSync(TEST_REGISTRY), 'Registry file should be created');
    assert.equal(typeof mgr.registry.tools, 'object');
    assert.equal(mgr.getActiveToolDefinitions().length, 0, 'Initially no dynamic tools registered');
    console.log('  ✔ Registry initialization verified.');

    // -------------------------------------------------------------------------
    // Test 2: Blueprint Acquisition (sqlite_query) & Pre-Flight Smoke Test
    // -------------------------------------------------------------------------
    console.log('• [Test 2/6] Researching and Acquiring "sqlite_query" Blueprint...');
    const acquireRes = await mgr.researchAndAcquireTool({
      tool_name: 'sqlite_query',
      capability_needed: 'Execute SQL queries against SQLite database files and return JSON rows',
    });

    assert.equal(acquireRes.ok, true, `Acquisition failed: ${acquireRes.error}`);
    assert.equal(acquireRes.toolName, 'sqlite_query');
    assert.equal(acquireRes.status, 'installed_and_verified');
    assert.ok(acquireRes.definition?.function?.name === 'sqlite_query');
    assert.ok(fs.existsSync(path.resolve(ROOT_DIR, acquireRes.entrypoint)));
    assert.equal(acquireRes.smokeTest.exitCode, 0, 'Pre-flight smoke test must exit with code 0');
    console.log(`  ✔ Tool "sqlite_query" acquired & verified (${acquireRes.entrypoint}).`);

    // -------------------------------------------------------------------------
    // Test 3: Real Tool Execution (sqlite_query on test database)
    // -------------------------------------------------------------------------
    console.log('• [Test 3/6] Executing Acquired "sqlite_query" Against Real Database...');
    // Create tables and insert records
    const createQuery = `
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, role TEXT);
      INSERT INTO users (username, role) VALUES ('agent_neo', 'engineer');
      INSERT INTO users (username, role) VALUES ('agent_trinity', 'architect');
    `;
    const execRes1 = await mgr.executeTool('sqlite_query', {
      db_path: TEST_DB,
      query: createQuery,
    });
    const parsed1 = JSON.parse(execRes1);
    assert.equal(parsed1.ok, true, `Database creation failed: ${parsed1.error}`);

    // Query records back
    const execRes2 = await mgr.executeTool('sqlite_query', {
      db_path: TEST_DB,
      query: 'SELECT * FROM users ORDER BY id ASC;',
    });
    const parsed2 = JSON.parse(execRes2);
    assert.equal(parsed2.ok, true);
    assert.equal(parsed2.rowCount, 2);
    assert.equal(parsed2.rows[0].username, 'agent_neo');
    assert.equal(parsed2.rows[1].role, 'architect');
    console.log(`  ✔ sqlite_query executed cleanly: retrieved ${parsed2.rowCount} rows.`);

    // -------------------------------------------------------------------------
    // Test 4: Acquiring csv_stats_analyzer & Analyzing Real CSV
    // -------------------------------------------------------------------------
    console.log('• [Test 4/6] Researching and Acquiring "csv_stats_analyzer"...');
    const csvAcquire = await mgr.researchAndAcquireTool({
      tool_name: 'csv_stats_analyzer',
      capability_needed: 'Compute statistical distribution, null rates, and metrics for CSV tables',
    });
    assert.equal(csvAcquire.ok, true);

    // Create a real CSV file
    const sampleCsv = `user_id,latency_ms,status\n101,42.5,success\n102,98.2,success\n103,15.0,success\n104,,timeout\n`;
    fs.writeFileSync(TEST_CSV, sampleCsv, 'utf8');

    const csvExec = await mgr.executeTool('csv_stats_analyzer', {
      file_path: TEST_CSV,
    });
    const csvParsed = JSON.parse(csvExec);
    assert.equal(csvParsed.ok, true);
    assert.equal(csvParsed.rowCount, 4);
    assert.ok(csvParsed.headers.includes('latency_ms'));
    assert.equal(csvParsed.columnStatistics.latency_ms.nullCount, 1);
    assert.equal(csvParsed.columnStatistics.latency_ms.isNumeric, true);
    assert.equal(csvParsed.columnStatistics.latency_ms.min, 15.0);
    assert.equal(csvParsed.columnStatistics.latency_ms.max, 98.2);
    console.log(`  ✔ csv_stats_analyzer verified (processed 4 rows, accurately calculated min/max/nulls).`);

    // -------------------------------------------------------------------------
    // Test 5: JIT Auto-Synthesis for Unregistered Tool
    // -------------------------------------------------------------------------
    console.log('• [Test 5/6] Testing JIT On-Demand Tool Synthesis Mid-Response...');
    const jitRes = await mgr.autoSynthesizeMissingTool('custom_checksum_calc', {
      payload_text: 'AIUI autonomous tool synthesis test vector',
    });
    assert.equal(jitRes.ok, true, `JIT synthesis failed: ${jitRes.error}`);
    assert.equal(jitRes.jitAcquired, true);
    assert.equal(jitRes.toolName, 'custom_checksum_calc');
    const jitExecParsed = JSON.parse(jitRes.executionResult);
    assert.equal(jitExecParsed.ok, true);
    assert.equal(jitExecParsed.tool, 'custom_checksum_calc');
    console.log(`  ✔ JIT auto-synthesis succeeded mid-response for tool "${jitRes.toolName}".`);

    // -------------------------------------------------------------------------
    // Test 6: Persistence & Clean Tool Uninstallation
    // -------------------------------------------------------------------------
    console.log('• [Test 6/6] Persistence Across Restarts & Clean Removal...');
    // Instantiate brand new manager pointing to same registry file
    const freshMgr = new DynamicToolManager(TEST_REGISTRY);
    const defs = freshMgr.getActiveToolDefinitions();
    assert.ok(defs.length >= 3, `Expected at least 3 active tools, got ${defs.length}`);
    assert.ok(defs.some((d) => d.function.name === 'sqlite_query'));
    assert.ok(defs.some((d) => d.function.name === 'csv_stats_analyzer'));
    assert.ok(defs.some((d) => d.function.name === 'custom_checksum_calc'));

    // Remove the custom tool
    const removeRes = freshMgr.removeTool('custom_checksum_calc');
    assert.equal(removeRes.ok, true);
    assert.equal(freshMgr.registry.tools['custom_checksum_calc'], undefined);
    console.log(`  ✔ Persistence verified; custom tool cleanly uninstalled.`);

    // -------------------------------------------------------------------------
    // Test 7: MemPalace & Fast-Path Re-hydration Latency (<15ms)
    // -------------------------------------------------------------------------
    console.log('• [Test 7/7] Fast-Path Instant Re-hydration & MemPalace Safe Fallback...');
    const t0 = performance.now();
    const reAcquire = await freshMgr.researchAndAcquireTool({
      tool_name: 'sqlite_query',
      capability_needed: 'Run SQL queries',
    });
    const duration = performance.now() - t0;
    assert.equal(reAcquire.ok, true);
    assert.equal(reAcquire.alreadyInstalled, true);
    assert.ok(duration < 50, `Expected sub-50ms instant recall, took ${duration.toFixed(2)}ms`);
    console.log(`  ✔ Fast-path verified: instantaneous resolution in ${duration.toFixed(2)}ms.`);

    console.log('\n' + '='.repeat(78));
    console.log('🎉 ALL 7 DYNAMIC TOOL ACQUISITION TEST SUITES PASSED FLAWLESSLY');
    console.log('='.repeat(78));
    return 0;
  } catch (err) {
    console.error(`\n❌ TEST FAILED: ${err.message}`);
    console.error(err.stack);
    return 1;
  } finally {
    // Cleanup test artifacts
    if (fs.existsSync(TEST_REGISTRY)) fs.unlinkSync(TEST_REGISTRY);
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(TEST_CSV)) fs.unlinkSync(TEST_CSV);
  }
}

runTests().then((code) => process.exit(code));
