import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTerminalLines,
  extractFileMutation,
  inferLanguage,
  formatMonologueState,
} from './commandSpaceEngine.ts'

describe('commandSpaceEngine', () => {
  describe('parseTerminalLines', () => {
    it('correctly classifies standard stdout and commands', () => {
      const { lines, heatmap } = parseTerminalLines('hello world\nline 2', 'echo hello')
      assert.equal(lines.length, 3)
      assert.equal(lines[0].type, 'command')
      assert.equal(lines[0].text, '$ echo hello')
      assert.equal(lines[1].type, 'stdout')
      assert.equal(lines[1].text, 'hello world')
      assert.equal(heatmap.length, 1)
      assert.equal(heatmap[0].type, 'command')
    })

    it('identifies Python tracebacks and error lines in heatmap', () => {
      const output = [
        'Starting worker...',
        'Traceback (most recent call last):',
        '  File "worker.py", line 42, in <module>',
        'ZeroDivisionError: division by zero',
        'Done.',
      ].join('\n')

      const { lines, heatmap } = parseTerminalLines(output, 'python3 worker.py')
      assert.equal(lines.some((l) => l.type === 'traceback'), true)
      assert.equal(lines.some((l) => l.type === 'error'), true)
      assert.equal(heatmap.some((h) => h.type === 'traceback'), true)
      assert.equal(heatmap.some((h) => h.type === 'error'), true)
    })
  })

  describe('extractFileMutation', () => {
    it('detects cat << EOF file writes', () => {
      const cmd = `cat << 'EOF' > /tmp/test.py
import sys
print("hello")
EOF`
      const mutation = extractFileMutation(cmd)
      assert.notEqual(mutation, null)
      assert.equal(mutation?.path, '/tmp/test.py')
      assert.equal(mutation?.mutationType, 'cat_eof')
      assert.equal(mutation?.content?.includes('import sys'), true)
    })

    it('detects write_file json payload', () => {
      const payload = JSON.stringify({ path: 'src/utils.ts', content: 'export const x = 1' })
      const mutation = extractFileMutation('write_file', payload)
      assert.notEqual(mutation, null)
      assert.equal(mutation?.path, 'src/utils.ts')
      assert.equal(mutation?.mutationType, 'write_file')
      assert.equal(mutation?.content, 'export const x = 1')
    })

    it('detects sed -i mutations', () => {
      const cmd = 'sed -i "s/foo/bar/g" config.json'
      const mutation = extractFileMutation(cmd)
      assert.notEqual(mutation, null)
      assert.equal(mutation?.path, 'config.json')
      assert.equal(mutation?.mutationType, 'sed')
    })
  })

  describe('inferLanguage', () => {
    it('maps extensions correctly', () => {
      assert.equal(inferLanguage('app.py'), 'python')
      assert.equal(inferLanguage('Component.tsx'), 'typescript')
      assert.equal(inferLanguage('server.mjs'), 'javascript')
      assert.equal(inferLanguage('deploy.sh'), 'bash')
      assert.equal(inferLanguage('schema.sql'), 'sql')
      assert.equal(inferLanguage('config.yml'), 'yaml')
      assert.equal(inferLanguage('unknown.xyz'), 'plaintext')
    })
  })

  describe('formatMonologueState', () => {
    it('formats thinking, execution, and error states', () => {
      const thinking = formatMonologueState('thinking', 'Planning unit test structure')
      assert.equal(thinking.stateTag, 'AGENT_REASONING')
      assert.equal(thinking.detail?.includes('Planning unit test structure'), true)

      const exec = formatMonologueState('running_cmd', 'npm test', 1, 14)
      assert.equal(exec.stateTag, 'SHELL_EXEC')
      assert.equal(exec.detail?.includes('npm test (14s)'), true)

      const err = formatMonologueState('error', 'Traceback on line 12')
      assert.equal(err.stateTag, 'CRITICAL_FAULT')
      assert.equal(err.level, 'error')
    })
  })
})
