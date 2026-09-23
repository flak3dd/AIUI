import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getStoredTarget,
  setStoredTarget,
  getStoredWorkspaceDir,
  setStoredWorkspaceDir,
  getActiveWorkspaceEnvId,
  setActiveWorkspaceEnvId,
  allocateChatWorkspace,
  resolveChatWorkspace,
} from './bashShell.ts'
import { runTool, applyToolCalls, AGENT_TOOLS } from './agent.ts'

test('Sandbox Target Enforcement: rejects local_mac and forces dgx_spark', () => {
  setStoredTarget('local_mac')
  assert.equal(getStoredTarget(), 'dgx_spark', 'local_mac target must be remapped to dgx_spark')
})

test('Sandbox Path Boundary: getStoredWorkspaceDir blocks /Users/adminuser', () => {
  setStoredWorkspaceDir('/Users/adminuser/Desktop')
  const dir = getStoredWorkspaceDir()
  assert.ok(!dir.includes('/Users/adminuser'), 'Stored workspace dir must not contain /Users/adminuser')
  assert.ok(dir.startsWith('/tmp/spark-sandboxes'), 'Stored workspace dir must default to /tmp/spark-sandboxes')
})

test('Sandbox Workspace Binding: getActiveWorkspaceEnvId and setActiveWorkspaceEnvId', () => {
  setActiveWorkspaceEnvId('workspace42')
  assert.equal(getActiveWorkspaceEnvId(), 'workspace42')
  // Sanitizes special characters
  setActiveWorkspaceEnvId('workspace;rm -rf /')
  assert.equal(getActiveWorkspaceEnvId(), 'workspace_rm_-rf__')
})

test('Sandbox Chat Allocation: allocateChatWorkspace returns deterministic fallback workspace', async () => {
  const wsA = await allocateChatWorkspace('test-chat-session-a')
  assert.ok(wsA.envId.startsWith('workspace'), 'Must allocate workspaceN')
  assert.ok(wsA.path.includes(wsA.envId), 'Path must contain workspaceN')

  const wsB = await allocateChatWorkspace('test-chat-session-b')
  assert.ok(wsB.envId.startsWith('workspace'), 'Must allocate workspaceN')

  // Calling again with same chat id returns consistent workspace
  const wsA2 = await allocateChatWorkspace('test-chat-session-a')
  assert.equal(wsA.envId, wsA2.envId, 'Same chatId must allocate same workspace')
})

test('Sandbox Tool Boundary: write_file blocks directory traversal and host paths', async () => {
  const mockProvider: any = { id: 'mock', name: 'Mock', apiKey: 'test' }

  // Directory traversal
  const res1 = await runTool('write_file', JSON.stringify({ path: '../../etc/passwd', content: 'test' }), mockProvider)
  const parsed1 = JSON.parse(res1)
  assert.equal(parsed1.ok, false)
  assert.ok(parsed1.error.includes('Directory traversal'))

  // Host path
  const res2 = await runTool('write_file', JSON.stringify({ path: '/Users/adminuser/secret.txt', content: 'test' }), mockProvider)
  const parsed2 = JSON.parse(res2)
  assert.equal(parsed2.ok, false)
  assert.ok(parsed2.error.includes('forbidden') || parsed2.error.includes('sandbox'))
})

test('Sandbox Tool Boundary: read_file blocks directory traversal and host paths', async () => {
  const mockProvider: any = { id: 'mock', name: 'Mock', apiKey: 'test' }

  // Directory traversal
  const res1 = await runTool('read_file', JSON.stringify({ path: '../../../etc/shadow' }), mockProvider)
  const parsed1 = JSON.parse(res1)
  assert.equal(parsed1.ok, false)
  assert.ok(parsed1.error.includes('Directory traversal'))

  // Host path
  const res2 = await runTool('read_file', JSON.stringify({ path: '/Users/adminuser/.bashrc' }), mockProvider)
  const parsed2 = JSON.parse(res2)
  assert.equal(parsed2.ok, false)
  assert.ok(parsed2.error.includes('forbidden') || parsed2.error.includes('sandbox'))
})

test('Sandbox Tool Boundary: set_workspace_dir blocks host paths', async () => {
  const mockProvider: any = { id: 'mock', name: 'Mock', apiKey: 'test' }

  const res = await runTool('set_workspace_dir', JSON.stringify({ dir: '/Users/adminuser/AIUI' }), mockProvider)
  const parsed = JSON.parse(res)
  assert.equal(parsed.ok, false)
  assert.ok(parsed.error.includes('forbidden') || parsed.error.includes('sandbox'))
})

test('Sandbox Agent Tools: schemas specify isolated DGX Spark sandbox', () => {
  const bashTool = AGENT_TOOLS.find((t) => t.function.name === 'bash')
  assert.ok(bashTool)
  assert.ok(bashTool.function.description.includes('DGX Spark sandbox'))
  assert.ok(!bashTool.function.description.includes('local Mac'))

  const writeTool = AGENT_TOOLS.find((t) => t.function.name === 'write_file')
  assert.ok(writeTool)
  assert.ok(writeTool.function.description.includes('sandbox workspace'))

  const readTool = AGENT_TOOLS.find((t) => t.function.name === 'read_file')
  assert.ok(readTool)
  assert.ok(readTool.function.description.includes('sandbox workspace'))
})
