/**
 * ==============================================================================
 * AIUI Workflow Optimizer & Adaptive Starting Point Detector
 * ==============================================================================
 * Solves:
 * 1. File Extension & Naming Rigidity (PascalCase vs kebab-case, .ts vs .js vs .mjs)
 * 2. Pre-flight Workspace Reconnaissance (Discovers existing work before planning)
 * 3. Starting Point Detection (VERIFICATION vs DEBUG vs RESUME vs FRESH)
 * 4. Robust Multi-format Test Result Parsing
 * 5. Workflow State Persistence (.aiui-workflow-state.json)
 * ==============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Convert string between naming conventions
 */
export function toKebabCase(str) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

export function toPascalCase(str) {
  return str
    .replace(/(?:^|[-_])(\w)/g, (_, c) => c.toUpperCase())
    .replace(/[-_]/g, '');
}

export function toCamelCase(str) {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function toSnakeCase(str) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

/**
 * Flexible file path resolver:
 * Matches filenames across case variants (PascalCase, kebab-case, snake_case),
 * extensions (.ts, .js, .mjs, .cjs), and common directories (root, src/, lib/).
 *
 * @param {string} rawPath - Requested file path (e.g. 'RateLimitedTaskExecutor.ts')
 * @param {string} [workspaceDir] - Workspace root directory
 * @returns {string|null} - Actual resolved path or null if not found
 */
export function resolveFlexibleFilePath(rawPath, workspaceDir = process.cwd()) {
  if (!rawPath) return null;
  const clean = String(rawPath).trim();

  // 1. Direct match (absolute or relative)
  const directPath = path.isAbsolute(clean) ? clean : path.resolve(workspaceDir, clean);
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  // 2. Dissect filename and directory
  const dirName = path.dirname(clean);
  const baseNameWithExt = path.basename(clean);
  const ext = path.extname(baseNameWithExt);
  const rawBaseName = baseNameWithExt.slice(0, baseNameWithExt.length - ext.length);

  // Candidate extensions
  const extensions = ['.js', '.ts', '.mjs', '.cjs', '.tsx', '.jsx', '.json', '.md', ''];
  if (ext && !extensions.includes(ext)) {
    extensions.unshift(ext);
  }

  // Candidate base name variants
  const baseVariants = new Set([
    rawBaseName,
    toKebabCase(rawBaseName),
    toPascalCase(rawBaseName),
    toCamelCase(rawBaseName),
    toSnakeCase(rawBaseName),
    rawBaseName.toLowerCase(),
  ]);

  // Handle common shorthand suffixes (e.g. RateLimitedTaskExecutor -> rate-limited-executor)
  if (rawBaseName.toLowerCase().includes('taskexecutor')) {
    const shortened = rawBaseName.replace(/taskexecutor/i, 'executor');
    baseVariants.add(toKebabCase(shortened));
    baseVariants.add(toPascalCase(shortened));
  }

  // Candidate search directories
  const candidateDirs = [
    dirName === '.' ? workspaceDir : path.resolve(workspaceDir, dirName),
    workspaceDir,
    path.resolve(workspaceDir, 'src'),
    path.resolve(workspaceDir, 'lib'),
    path.resolve(workspaceDir, 'scripts'),
    path.resolve(workspaceDir, 'test'),
    path.resolve(workspaceDir, 'tests'),
  ];

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;

    for (const b of baseVariants) {
      for (const e of extensions) {
        const candidate = path.join(dir, b + e);
        if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
          return candidate;
        }
      }
    }
  }

  // 3. Fallback: Shallow scan directory for fuzzy match
  try {
    const files = fs.readdirSync(workspaceDir);
    const simplifiedTarget = rawBaseName.toLowerCase().replace(/[-_]/g, '');

    for (const file of files) {
      const simplifiedFile = path.basename(file, path.extname(file)).toLowerCase().replace(/[-_]/g, '');
      if (simplifiedFile === simplifiedTarget || simplifiedFile.includes(simplifiedTarget) || simplifiedTarget.includes(simplifiedFile)) {
        const fullCandidate = path.join(workspaceDir, file);
        if (!fs.statSync(fullCandidate).isDirectory()) {
          return fullCandidate;
        }
      }
    }
  } catch {}

  return null;
}

/**
 * Pre-flight workspace scanner:
 * Discovers existing deliverables, tests, documentation, and config files.
 */
export function scanWorkspace(workspaceDir = process.cwd()) {
  const result = {
    workspaceDir,
    implementations: [],
    tests: [],
    docs: [],
    configs: [],
    allFiles: [],
  };

  const ignoredDirs = new Set(['node_modules', '.git', 'dist', 'build', '.superpowers', '.tempmediaStorage']);

  function walk(currentDir, depth = 0) {
    if (depth > 3) return;
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignoredDirs.has(entry.name) || entry.name.startsWith('.')) continue;

        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(workspaceDir, fullPath);

        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          result.allFiles.push(relPath);

          // Categorize
          if (/\.(test|spec)\.[a-zA-Z0-9]+$/i.test(entry.name) || /^test[-_].*\.[a-zA-Z0-9]+$/i.test(entry.name)) {
            result.tests.push(fullPath);
          } else if (/\.(md|markdown|txt)$/i.test(entry.name)) {
            result.docs.push(fullPath);
          } else if (/(package\.json|tsconfig\.json|pyproject\.toml|Makefile|CMakeLists\.txt)$/i.test(entry.name)) {
            result.configs.push(fullPath);
          } else if (/\.(js|ts|mjs|cjs|py|go|rs|cpp|c|java|swift)$/i.test(entry.name)) {
            result.implementations.push(fullPath);
          }
        }
      }
    } catch {}
  }

  walk(workspaceDir);

  // Convenience mappings for specific analysis and implementation files
  result.implementation = result.implementations[0] || null;
  result.testFile = result.tests[0] || null;
  result.complexityAnalysis = result.docs.find((d) => /complexity[-_]analysis/i.test(path.basename(d))) || null;
  result.distributedAnalysis = result.docs.find((d) => /distributed[-_](?:systems[-_])?analysis/i.test(path.basename(d))) || null;

  return result;
}

/**
 * Parse test output and exit code across multiple runner formats (node:test, jest, vitest, pytest).
 */
export function parseTestResults(output = '', exitCode = 0) {
  const text = String(output);

  // 1. Node.js native test runner: try multiple regex patterns
  const nodePatterns = [
    /#\s*tests\s+(\d+)[\s\S]*?#\s*pass\s+(\d+)[\s\S]*?#\s*fail\s+(\d+)/i,
    /#\s*tests\s+(\d+)[\s\S]*?#\s*pass\s+(\d+)(?:[\s\S]*?#\s*fail\s*(\d+))?/i,
    /tests\s+(\d+)[\s\S]*?pass\s+(\d+)[\s\S]*?fail\s+(\d+)/i,
  ];

  for (const pat of nodePatterns) {
    const m = text.match(pat);
    if (m) {
      const total = parseInt(m[1], 10);
      const pass = parseInt(m[2], 10);
      const fail = parseInt(m[3] || '0', 10);
      // If zero failures and at least 1 pass, tests succeeded (even if child process had exit code quirk)
      const ok = fail === 0 && pass > 0;
      return {
        runner: 'node:test',
        ok,
        total,
        pass,
        fail,
      };
    }
  }

  // Fallback for node test output
  const hasFailures = text.includes('# fail') && !text.includes('# fail 0');
  const hasPasses = text.includes('# pass');
  if (hasPasses) {
    return {
      runner: 'node:test',
      ok: !hasFailures,
      total: 0,
      pass: 1,
      fail: hasFailures ? 1 : 0,
    };
  }

  // 2. Jest / Vitest pattern: Tests: 4 passed, 4 total
  const jestMatch = text.match(/Tests:\s+(?:(\d+)\s+failed,\s+)?(\d+)\s+passed,\s+(\d+)\s+total/i);
  if (jestMatch) {
    const fail = parseInt(jestMatch[1] || '0', 10);
    const pass = parseInt(jestMatch[2], 10);
    const total = parseInt(jestMatch[3], 10);
    return {
      runner: 'jest/vitest',
      ok: exitCode === 0 && fail === 0 && pass > 0,
      total,
      pass,
      fail,
    };
  }

  // 3. Pytest pattern: 4 passed, 0 failed
  const pytestMatch = text.match(/(\d+)\s+passed(?:,\s+(\d+)\s+failed)?/i);
  if (pytestMatch) {
    const pass = parseInt(pytestMatch[1], 10);
    const fail = parseInt(pytestMatch[2] || '0', 10);
    return {
      runner: 'pytest',
      ok: exitCode === 0 && fail === 0 && pass > 0,
      total: pass + fail,
      pass,
      fail,
    };
  }

  // Fallback to exit code
  return {
    runner: 'generic',
    ok: exitCode === 0 && !/FAIL|ERROR|failed\b/i.test(text),
    total: 0,
    pass: 0,
    fail: exitCode === 0 ? 0 : 1,
  };
}

/**
 * Intelligent Starting Point Detector:
 * Determines whether to run in VERIFICATION, DEBUG, RESUME, or FRESH mode.
 */
export function determineStartingPoint(workspaceDir = process.cwd(), goal = '') {
  const scan = scanWorkspace(workspaceDir);
  const state = loadWorkflowState(workspaceDir);

  // Check for test file candidates
  let testFile = scan.tests[0] || null;
  let hasTests = Boolean(testFile);
  let testsPassing = false;
  let testOutput = '';

  if (hasTests) {
    try {
      const relTest = path.relative(workspaceDir, testFile);
      testOutput = execSync(`node --test "${relTest}"`, {
        cwd: workspaceDir,
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const parsed = parseTestResults(testOutput, 0);
      testsPassing = parsed.ok;
    } catch (err) {
      testOutput = (err.stdout || '') + '\n' + (err.stderr || '');
      const parsed = parseTestResults(testOutput, err.status || 1);
      testsPassing = parsed.ok;
    }
  }

  // Check implementation deliverables
  const hasImpl = scan.implementations.length > 0;

  // 1. VERIFICATION MODE: All deliverables exist and tests pass
  if (hasImpl && hasTests && testsPassing) {
    return {
      mode: 'VERIFICATION',
      message: 'All deliverables exist and test assertions pass. Ready for rapid proof verification.',
      timeEstimate: '1-2 minutes',
      scan,
      testFile,
      testsPassing: true,
      state,
    };
  }

  // 2. DEBUG MODE: Deliverables exist but tests fail
  if (hasImpl && hasTests && !testsPassing) {
    return {
      mode: 'DEBUG',
      message: 'Implementation and test files exist, but test suite has failures. Targeting failing assertions.',
      timeEstimate: '3-5 minutes',
      scan,
      testFile,
      testsPassing: false,
      testOutput: testOutput.slice(0, 1000),
      state,
    };
  }

  // 3. RESUME MODE: Partial implementation or persisted prior milestone state
  if (hasImpl || (state && state.completedMilestones && state.completedMilestones.length > 0)) {
    return {
      mode: 'RESUME',
      message: 'Partial workspace artifacts detected. Resuming from last unfulfilled milestone.',
      timeEstimate: '5-8 minutes',
      scan,
      testFile,
      testsPassing: false,
      state,
    };
  }

  // 4. FRESH MODE: Clean workspace, start full pipeline
  return {
    mode: 'FRESH',
    message: 'Fresh workspace detected. Formulating full architectural deliberation and pipeline.',
    timeEstimate: '10-15 minutes',
    scan,
    testFile: null,
    testsPassing: false,
    state: null,
  };
}

/**
 * State persistence helpers (.aiui-workflow-state.json)
 */
export function saveWorkflowState(workspaceDir, stateUpdates) {
  try {
    const stateFile = path.resolve(workspaceDir, '.aiui-workflow-state.json');
    const existing = loadWorkflowState(workspaceDir) || {};
    const merged = {
      ...existing,
      ...stateUpdates,
      lastUpdated: Date.now(),
      isoTimestamp: new Date().toISOString(),
    };
    fs.writeFileSync(stateFile, JSON.stringify(merged, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function loadWorkflowState(workspaceDir) {
  try {
    const candidates = [
      path.resolve(workspaceDir, '.aiui-workflow-state.json'),
      path.resolve(workspaceDir, '.workflow-state.json'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return JSON.parse(fs.readFileSync(c, 'utf8'));
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Checks whether a directory or any of its parents is a Git repository.
 */
export function isGitRepo(workspaceDir = process.cwd()) {
  try {
    let curr = path.resolve(workspaceDir);
    while (curr && curr !== path.dirname(curr)) {
      if (fs.existsSync(path.join(curr, '.git'))) {
        return true;
      }
      curr = path.dirname(curr);
    }
  } catch {}
  return false;
}

/**
 * Connects and initializes a Git repository in the specified directory.
 * Safely creates basic .gitignore if none exists, runs `git init`, and returns status.
 */
export function initGitRepo(workspaceDir = process.cwd()) {
  try {
    const targetDir = path.resolve(workspaceDir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const gitDir = path.join(targetDir, '.git');
    let wasInitialized = false;
    if (!fs.existsSync(gitDir)) {
      execSync('git init', { cwd: targetDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      wasInitialized = true;
    }

    // Create standard .gitignore if none exists
    const gitignorePath = path.join(targetDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      const defaultIgnore = [
        'node_modules/',
        '.DS_Store',
        'dist/',
        'build/',
        '.env',
        '.env.local',
        '.tempmediaStorage/',
        '*.log',
      ].join('\n') + '\n';
      fs.writeFileSync(gitignorePath, defaultIgnore, 'utf8');
    }

    // Try initial add
    try {
      execSync('git add -A', { cwd: targetDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {}

    return {
      success: true,
      wasInitialized,
      targetDir,
      message: `Successfully connected Git repository in ${targetDir}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Detects if a user prompt asks for multiple steps, actions, or continuous workflows.
 * When true, a single tool or verification command MUST NEVER cause an early stop.
 */
export function isMultiStepPrompt(goal) {
  if (!goal) return false;
  const g = String(goal).trim();
  if (!g) return false;

  // 1. Numbered or bulleted items: 1., 2., or - [ ], or step 1/step 2
  if (/(?:^|\n)\s*(?:\d+[\.)]|step\s*\d|phase\s*\d|task\s*\d|[-*•]\s+\[?[ x]?\]?)/im.test(g)) {
    return true;
  }

  // 2. Sequential connectives: "then", "and then", "after that", "also", "next", "finally", etc.
  if (
    /\b(?:and\s+then|after\s+that|then\b|afterwards\b|next\b|also\b|additionally\b|finally\b|once\s+done|secondly\b|thirdly\b|plus\b|along\s+with)\b/i.test(
      g
    )
  ) {
    return true;
  }

  // 3. Multiple operational verbs: e.g. "build ... and test ...", "create ... and commit ...", "fix ... and verify ..."
  const opVerbs = [
    'create', 'write', 'implement', 'build', 'fix', 'modify', 'update',
    'add', 'delete', 'remove', 'deploy', 'ship', 'commit', 'push',
    'test', 'verify', 'check', 'run', 'inspect', 'clean', 'install',
    'refactor', 'benchmark',
  ];
  const verbRegex = new RegExp(`\\b(?:${opVerbs.join('|')})\\b`, 'gi');
  const matchedVerbs = g.match(verbRegex);
  if (matchedVerbs && matchedVerbs.length >= 2) {
    return true;
  }

  // 4. Prompts asking for exhaustive or complete multi-item work: "both", "all of", "every", "each"
  if (/\b(?:both\b|all\s+(?:of|the\b|files|tests|repos|endpoints)|each\s+(?:of|file|test|repo|endpoint)|and\s+everything)\b/i.test(g)) {
    return true;
  }

  return false;
}

/**
 * Validates whether an active execution plan has fulfilled all milestones.
 */
export function checkPlanCompletion(input) {
  const steps = input?.steps || [];
  if (steps.length === 0) {
    return { isComplete: true, remainingCount: 0 };
  }

  const uncompleted = steps.filter((s) => s.status !== 'completed' && s.status !== 'skipped');
  const activeStep = steps.find((s) => s.status === 'active') || uncompleted[0];

  if (uncompleted.length > 0) {
    return {
      isComplete: false,
      remainingCount: uncompleted.length,
      activeStep,
      directive: `Strategic Plan incomplete: ${uncompleted.length} milestone(s) remaining. Active: "${activeStep?.title}". Fulfill and verify all steps before terminating.`,
    };
  }

  return {
    isComplete: true,
    remainingCount: 0,
  };
}

