/**
 * After a passing verification command, audit the edit before the turn may end.
 * A written file with no exit 0 is not proof. Secret paths and junk trees fail the gate.
 */
const SECRET_PATH = /(^|\/)\.env($|\.)|credentials\.json|id_rsa|\.pem$|node_modules\/|dist\//i

export interface CriticInput {
  filesModified: string[]
  verified: boolean
  diffStat?: string
}

export interface CriticResult {
  ok: boolean
  reasons: string[]
}

export function critiqueTurn(input: CriticInput): CriticResult {
  const files = (input.filesModified || []).map((f) => f.trim()).filter(Boolean)
  if (files.length === 0) return { ok: true, reasons: [] }

  const reasons: string[] = []
  if (!input.verified) {
    reasons.push('A file changed and no verification command has exited 0 since that edit.')
  }
  const secret = files.filter((f) => SECRET_PATH.test(f))
  if (secret.length) reasons.push(`Edit touches a secret or generated path: ${secret.slice(0, 3).join(', ')}`)
  const diff = (input.diffStat || '').trim()
  if (input.verified && !diff) {
    reasons.push('Verification passed but git diff --stat was not captured.')
  }
  if (diff && SECRET_PATH.test(diff)) {
    reasons.push('git diff --stat includes a secret or generated path.')
  }
  return { ok: reasons.length === 0, reasons }
}
