import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pdf_ocr.py')

export function pdfPathError(filePath) {
  const raw = String(filePath || '').trim()
  if (!raw) return 'Path required'
  if (raw.includes('..')) return 'Directory traversal is not allowed'
  if (!raw.toLowerCase().endsWith('.pdf')) return 'Path must be a .pdf file'
  if (!path.isAbsolute(raw)) return 'PDF path must be absolute'
  return null
}

export function extractPdf(filePath, options = {}) {
  const pathErr = pdfPathError(filePath)
  if (pathErr) return Promise.resolve({ ok: false, error: pathErr })
  const payload = JSON.stringify({
    path: filePath,
    maxPages: options.maxPages ?? 20,
    forceOcr: Boolean(options.forceOcr),
  })
  return new Promise((resolve) => {
    const child = spawn('python3', [PY], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ ok: false, error: 'PDF OCR timed out' })
    }, 60000)
    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.stderr.on('data', (chunk) => {
      err += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, error: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        const parsed = JSON.parse(out)
        resolve(parsed)
      } catch {
        resolve({
          ok: false,
          error:
            err.trim() ||
            `pymupdf4llm exited ${code}. Install with: python3 -m pip install pymupdf4llm`,
        })
      }
    })
    child.stdin.end(payload)
  })
}

export async function pdfOcrHandler(args) {
  const result = await extractPdf(args.path || args.filename, {
    maxPages: args.maxPages ?? args.max_pages,
    forceOcr: args.forceOcr ?? args.force_ocr,
  })
  return JSON.stringify(result)
}
