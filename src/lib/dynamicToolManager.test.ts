import test from 'node:test'
import assert from 'node:assert/strict'

function encodeBase64Utf8(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)))
  } catch {
    return btoa(str)
  }
}

test('dynamicToolManager — safe base64 encoding prevents shell quote breakage', () => {
  // Test with complex query containing single quotes, double quotes, and shell operators
  const rawSpec = {
    tool_name: 'web_search_duckduckgo',
    capability_needed: "Search engine for dork queries e.g. 'site:com.au wealth' or \"wealth com.au\"",
    parameters_spec: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: "Search query string, e.g. 'site:com.au wealth' || $(whoami) `cat /etc/passwd`",
        },
      },
    },
  }

  const specJson = JSON.stringify(rawSpec)
  const b64 = encodeBase64Utf8(specJson)

  // Base64 must contain only standard base64 characters
  assert.match(b64, /^[A-Za-z0-9+/=]+$/)

  // Decoded payload in Node must exactly match original
  const decoded = Buffer.from(b64, 'base64').toString('utf8')
  assert.equal(decoded, specJson)

  const parsed = JSON.parse(decoded)
  assert.equal(parsed.tool_name, 'web_search_duckduckgo')
  assert.ok(parsed.capability_needed.includes("'site:com.au wealth'"))
})

// http_get_json Layer 1 URL gate lives in scripts/aiui-agent/tools/http-get-url.mjs
// (see scripts/aiui-agent/tools/http-get-json.test.mjs). Private/LAN URLs are rejected there.

test('compactSessionsForStorage — prevents LocalStorage quota overflow', async () => {
  const { compactSessionsForStorage } = await import('./chatHistory.ts')

  // Generate 50 mock sessions with large outputs
  const sessions = Array.from({ length: 50 }, (_, i) => ({
    id: `sess_${i}`,
    title: `Session ${i}`,
    createdAt: Date.now() - i * 1000,
    updatedAt: Date.now() - i * 1000,
    model: 'qwen-abliterated',
    provider: 'local_vllm',
    pinned: i === 45, // one pinned session
    messages: [
      { id: `m1_${i}`, role: 'user' as const, content: `User query ${i}` },
      { id: `m2_${i}`, role: 'tool' as const, content: 'x'.repeat(5000) }, // 5KB tool output
      { id: `m3_${i}`, role: 'assistant' as const, content: 'a'.repeat(3000) }, // 3KB text
    ],
  }))

  const compacted = compactSessionsForStorage(sessions, 'sess_0', 20)

  // Should retain active session (sess_0), pinned session (sess_45), and cap at 20 max
  assert.ok(compacted.some((s) => s.id === 'sess_0'), 'Active session must be retained')
  assert.ok(compacted.some((s) => s.id === 'sess_45'), 'Pinned session must be retained')
  assert.ok(compacted.length <= 21, `Compacted length (${compacted.length}) must be <= 21`)

  // In non-active, non-pinned sessions, oversized outputs should be compacted
  const olderSession = compacted.find((s) => s.id !== 'sess_0' && !s.pinned)
  if (olderSession) {
    const toolMsg = olderSession.messages.find((m) => m.role === 'tool')
    assert.ok(toolMsg?.content.includes('[compacted for storage]'), 'Oversized tool message must be truncated')
  }

  // Active session must retain full original length
  const activeSession = compacted.find((s) => s.id === 'sess_0')
  const activeToolMsg = activeSession?.messages.find((m) => m.role === 'tool')
  assert.equal(activeToolMsg?.content.length, 5000, 'Active session tool messages must not be truncated')
})

test('BUILTIN_EXTERNAL_TOOLS contains all 6 curated advanced execution tools', async () => {
  const { BUILTIN_EXTERNAL_TOOLS } = await import('./dynamicToolManager.ts')

  const expectedTools = [
    'sqlite_query',
    'csv_stats_analyzer',
    'git_blame_inspector',
    'web_search_duckduckgo',
    'bin_lookup',
    'http_probe_advanced',
    'cve_lookup',
  ]

  for (const name of expectedTools) {
    const meta = BUILTIN_EXTERNAL_TOOLS[name]
    assert.ok(meta, `Tool ${name} must exist in BUILTIN_EXTERNAL_TOOLS`)
    assert.equal(meta.name, name)
    assert.equal(meta.verified, true, `${name} must be marked verified`)
    assert.equal(meta.enabled, true, `${name} must be marked enabled`)
    assert.ok(
      meta.runtime === 'python3' || meta.runtime === 'node',
      `${name} must have a valid runtime`
    )
    assert.ok(
      meta.entrypoint.startsWith('tools/acquired/'),
      `${name} entrypoint must point to tools/acquired/`
    )
    assert.ok(meta.description.length > 20, `${name} must have descriptive documentation`)
  }
})

test('getDynamicToolDefinitions produces valid OpenAI function schemas with [EXTERNAL TOOL] prefix', async () => {
  const { getDynamicToolDefinitions } = await import('./dynamicToolManager.ts')
  const defs = getDynamicToolDefinitions() as Array<{
    type: string
    function: {
      name: string
      description: string
      parameters: { type: string; properties: Record<string, unknown>; required?: string[] }
    }
  }>

  assert.ok(defs.length >= 7, 'Must define at least 7 dynamic external tools')

  const toolNames = defs.map((d) => d.function.name)
  assert.ok(toolNames.includes('bin_lookup'))
  assert.ok(toolNames.includes('http_probe_advanced'))
  assert.ok(toolNames.includes('csv_stats_analyzer'))
  assert.ok(toolNames.includes('sqlite_query'))
  assert.ok(toolNames.includes('web_search_duckduckgo'))
  assert.ok(toolNames.includes('git_blame_inspector'))
  assert.ok(toolNames.includes('cve_lookup'))

  for (const def of defs) {
    assert.equal(def.type, 'function')
    assert.ok(def.function.description.startsWith('[EXTERNAL TOOL]'), 'Must prefix description with [EXTERNAL TOOL]')
    assert.equal(def.function.parameters.type, 'object')
    assert.ok(def.function.parameters.properties, `${def.function.name} must have properties`)
  }

  // Verify bin_lookup parameter contract
  const binTool = defs.find((d) => d.function.name === 'bin_lookup')
  assert.ok(binTool?.function.parameters.properties.bin, 'bin_lookup must accept bin parameter')
  assert.deepEqual(binTool?.function.parameters.required, ['bin'])

  // Verify http_probe_advanced parameter contract
  const httpTool = defs.find((d) => d.function.name === 'http_probe_advanced')
  assert.ok(httpTool?.function.parameters.properties.url, 'http_probe_advanced must accept url parameter')
  assert.deepEqual(httpTool?.function.parameters.required, ['url'])

  // Verify cve_lookup parameter contract
  const cveTool = defs.find((d) => d.function.name === 'cve_lookup')
  assert.ok(cveTool?.function.parameters.properties.cve_id, 'cve_lookup must define cve_id property')
  assert.ok(cveTool?.function.parameters.properties.keyword, 'cve_lookup must define keyword property')
})

test('getCombinedAgentTools merges base tools, meta acquisition tools, and dynamic external tools', async () => {
  const { getCombinedAgentTools, TOOL_ACQUISITION_META_TOOLS } = await import('./dynamicToolManager.ts')

  const mockBaseTools = [
    { type: 'function', function: { name: 'bash', description: 'Run bash' } },
    { type: 'function', function: { name: 'write_file', description: 'Write file' } },
  ]

  const combined = getCombinedAgentTools(mockBaseTools) as Array<{
    type: string
    function: { name: string }
  }>

  const combinedNames = combined.map((t) => t.function.name)

  // Contains base tools
  assert.ok(combinedNames.includes('bash'))
  assert.ok(combinedNames.includes('write_file'))

  // Contains meta acquisition tools
  for (const metaTool of TOOL_ACQUISITION_META_TOOLS) {
    assert.ok(combinedNames.includes(metaTool.function.name))
  }

  // Contains all 7 external tools
  assert.ok(combinedNames.includes('sqlite_query'))
  assert.ok(combinedNames.includes('csv_stats_analyzer'))
  assert.ok(combinedNames.includes('git_blame_inspector'))
  assert.ok(combinedNames.includes('web_search_duckduckgo'))
  assert.ok(combinedNames.includes('bin_lookup'))
  assert.ok(combinedNames.includes('http_probe_advanced'))
  assert.ok(combinedNames.includes('cve_lookup'))

  assert.ok(combined.length >= mockBaseTools.length + TOOL_ACQUISITION_META_TOOLS.length + 7)
})

test('agentAnalyzer anti-loop suggestions prioritize external tools on command errors', async () => {
  const { getAntiLoopPromptSuggestions } = await import('./agentAnalyzer.ts')

  const suggestionsStagnant = getAntiLoopPromptSuggestions(
    {
      loopType: 'stagnant_error',
      suggestedAction: 'pivot_strategy',
      progressSummary: 'Repeated command failure',
    },
    'Process loan applicants CSV and lookup BINs'
  )

  const hasExternalToolOption = suggestionsStagnant.some(
    (s) => s.id === 'external-tool' && s.prompt.includes('csv_stats_analyzer')
  )
  assert.ok(hasExternalToolOption, 'Stagnant error must suggest external tools')

  const suggestionsIdentical = getAntiLoopPromptSuggestions(
    {
      loopType: 'identical_command',
      suggestedAction: 'pivot_strategy',
      progressSummary: 'Repeated identical command',
    },
    'Inspect database'
  )

  const hasIdenticalAltOption = suggestionsIdentical.some(
    (s) => s.id === 'external-tool-alt' && s.prompt.includes('sqlite_query')
  )
  assert.ok(hasIdenticalAltOption, 'Identical command loop must suggest external tool alternatives')
})

test('git_blame_inspector executes and returns structured git provenance JSON', async () => {
  const { spawnSync } = await import('node:child_process')
  const { resolve } = await import('node:path')

  const scriptPath = resolve(process.cwd(), 'tools/acquired/git_blame_inspector.mjs')
  const proc = spawnSync('node', [scriptPath, '--file-path', 'package.json', '--start-line', '1', '--end-line', '10'], {
    encoding: 'utf8',
  })

  assert.equal(proc.status, 0, `git_blame_inspector exited with non-zero: ${proc.stderr}`)
  const output = JSON.parse(proc.stdout)
  assert.equal(output.ok, true)
  assert.equal(output.filePath, 'package.json')
  assert.ok(Array.isArray(output.lines), 'Output must contain lines array')
  assert.ok(output.lines.length > 0, 'Lines array must not be empty')
  assert.ok(output.lines[0].hash, 'Each blame line must have a commit hash')
})

test('cve_lookup executes and returns normalized CVSS score and vulnerability details', async () => {
  const { spawnSync } = await import('node:child_process')
  const { resolve } = await import('node:path')

  const scriptPath = resolve(process.cwd(), 'tools/acquired/cve_lookup.py')
  const proc = spawnSync('python3', [scriptPath, '--cve-id', 'CVE-2024-3094'], {
    encoding: 'utf8',
  })

  assert.equal(proc.status, 0, `cve_lookup exited with non-zero: ${proc.stderr}`)
  const output = JSON.parse(proc.stdout)
  assert.equal(output.ok, true)
  assert.ok(output.results && output.results.length > 0)
  const cve = output.results[0]
  assert.equal(cve.cveId, 'CVE-2024-3094')
  assert.equal(cve.cvss.score, 10.0)
  assert.equal(cve.cvss.severity, 'CRITICAL')
  assert.ok(cve.description.includes('xz') || cve.description.includes('liblzma'))
  assert.ok(Array.isArray(cve.cwes) && cve.cwes.includes('CWE-506'))
})
test('getWorkflowContextTools dynamically prunes tools based on intent and phase', async () => {
  const { getWorkflowContextTools, getCombinedAgentTools } = await import('./dynamicToolManager.ts')

  const baseTools = [
    { type: 'function', function: { name: 'bash', description: 'Run bash' } },
    { type: 'function', function: { name: 'read_file', description: 'Read file' } },
    { type: 'function', function: { name: 'write_file', description: 'Write file' } },
  ]

  // Scenario 1: Security/CVE prompt in inspect phase
  const secTools = getWorkflowContextTools(baseTools, 'Check CVE-2024-3094 vulnerability details', 'inspect', 4) as Array<{
    function: { name: string }
  }>
  const secNames = secTools.map((t) => t.function.name)

  // Must include base tools
  assert.ok(secNames.includes('bash'))
  assert.ok(secNames.includes('read_file'))
  assert.ok(secNames.includes('write_file'))

  // Must prioritize cve_lookup
  assert.ok(secNames.includes('cve_lookup'), 'Must include cve_lookup for CVE prompt')

  // Overall tool count must be significantly pruned compared to full combined list
  const fullTools = getCombinedAgentTools(baseTools)
  assert.ok(secTools.length < fullTools.length, `Pruned tools (${secTools.length}) must be less than full tools (${fullTools.length})`)

  // Scenario 2: SQL query prompt
  const sqlTools = getWorkflowContextTools(baseTools, 'SELECT * FROM users in example.db', 'inspect', 4) as Array<{
    function: { name: string }
  }>
  const sqlNames = sqlTools.map((t) => t.function.name)
  assert.ok(sqlNames.includes('sqlite_query'), 'Must include sqlite_query for SQL prompt')
})

test('http_probe_advanced executes via raw curl bypass and returns structured HTTP metrics', async () => {
  const { executeDynamicTool } = await import('./dynamicToolManager.ts')

  // Probe local Vite server or fallback endpoint
  const resStr = await executeDynamicTool('http_probe_advanced', JSON.stringify({
    url: 'http://127.0.0.1:5173',
    method: 'GET',
    follow_redirects: true,
  }))

  const res = JSON.parse(resStr)
  assert.equal(typeof res.statusCode, 'number')
  assert.equal(typeof res.latencyMs, 'number')
  assert.ok(res.method === 'raw_curl_verified' || res.ok !== undefined)
})

