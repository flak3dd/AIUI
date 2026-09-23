import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { describe, it } from 'node:test'
import { extractPdf, pdfPathError } from './pdf-ocr.mjs'

function writeSample(dest) {
  const py = `
import fitz, sys
doc = fitz.open()
page = doc.new_page()
page.insert_text((72, 72), "pymupdf local sample")
doc.save(sys.argv[1])
doc.close()
`
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-c', py, dest], { stdio: ['ignore', 'inherit', 'pipe'] })
    let err = ''
    child.stderr.on('data', (chunk) => {
      err += chunk
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(err || `sample pdf exited ${code}`))
    })
  })
}

describe('pdf ocr', () => {
  it('rejects non-pdf and relative paths', () => {
    assert.match(pdfPathError('notes.txt'), /pdf/)
    assert.match(pdfPathError('relative.pdf'), /absolute/)
    assert.match(pdfPathError('/tmp/../secret.pdf'), /traversal/)
  })

  it('reads an embedded text layer on this machine', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'aiui-pdf-'))
    const file = path.join(dir, 'sample.pdf')
    try {
      await writeSample(file)
      const result = await extractPdf(file, { maxPages: 2 })
      assert.equal(result.ok, true)
      assert.equal(result.engine, 'pymupdf4llm')
      assert.equal(result.pageCount, 1)
      assert.match(String(result.markdown || ''), /pymupdf local sample/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
