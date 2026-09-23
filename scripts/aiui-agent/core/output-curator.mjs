// ==========================================
// 🛡️ Output Curation & Anti-Overflow Engine
// ==========================================

/**
 * Curates tool output for the LLM context window:
 * 1. Safely unpacks JSON responses from read_file so code is readable with line numbers and markers.
 * 2. Enforces generous limits (64,000 chars, 1,000 lines) so files up to 1,000 lines are never truncated.
 * 3. Safely trims massive log dumps with clear navigation hints.
 */
export function formatToolOutputForContext(text, maxChars = 32000, maxLines = 800) {
  if (!text) return text;

  // Safe JSON extraction for read_file to prevent JSON string truncation or escaped newline bloat
  try {
    if (typeof text === 'string' && (text.startsWith('{"ok":true') || text.startsWith('{"ok": false') || text.includes('"content":'))) {
      const parsed = JSON.parse(text);
      if (parsed && parsed.ok && typeof parsed.content === 'string' && parsed.path) {
        const lines = parsed.content.split('\n');
        const count = parsed.lineCount || lines.length;
        const total = parsed.totalLines || lines.length;
        const start = parsed.startLine || 1;
        const rangeStr = `Lines ${start} to ${start + count - 1} of ${total}`;

        if (lines.length <= maxLines && parsed.content.length <= maxChars) {
          return `[FILE INSPECTED: ${parsed.path} | ${rangeStr}]\n${parsed.content}\n[END OF FILE: ${parsed.path} | Retained in working context memory. DO NOT re-read. Required next step: write_file to edit, or bash to test.]`;
        }
      }
    }
  } catch {}

  let curated = text;
  const lines = text.split('\n');
  if (lines.length > maxLines) {
    const headN = Math.floor(maxLines * 0.4);
    const tailN = Math.floor(maxLines * 0.6);
    const omitted = lines.length - headN - tailN;
    curated = [
      ...lines.slice(0, headN),
      '',
      `... [${omitted} lines omitted; use read_file with start_line and line_count to inspect this specific section] ...`,
      '',
      ...lines.slice(-tailN),
    ].join('\n');
  }
  if (curated.length <= maxChars) return curated;
  const half = Math.floor((maxChars - 200) / 2);
  const head = curated.slice(0, half);
  const tail = curated.slice(curated.length - half);
  const omitted = curated.length - (head.length + tail.length);
  return `${head}\n\n... [${omitted} characters truncated; use targeted start_line / line_count] ...\n\n${tail}`;
}

/**
 * Strips accidental line-number prefixes (e.g. " 218 | ...") from code replacement buffers
 * before writing to filesystem to prevent syntax corruption.
 */
export function cleanAccidentalLineNumbers(content) {
  if (!content || typeof content !== 'string') return content;
  if (/^\s*\d{1,5}\s*\|\s/m.test(content)) {
    return content.replace(/^\s*\d{1,5}\s*\|\s?/gm, '');
  }
  return content;
}

/**
 * Compacts historical tool outputs older than 3 turns to prevent context window overflow
 * and attention dilution while preserving recent tool context.
 */
function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * Checkpoint the live turn into one user prompt so the agent can keep working
 * after the model rejects the transcript for context length.
 */
export function buildContextContinuation(goal, turnMessages = []) {
  const lines = [];
  const recent = Array.isArray(turnMessages) ? turnMessages.slice(-8) : [];
  for (const msg of recent) {
    if (!msg || msg.role === 'system') continue;
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      const names = msg.tool_calls.map((tc) => tc?.function?.name).filter(Boolean);
      lines.push(`- assistant called: ${names.join(', ') || 'tool'}`);
    }
    const body = typeof msg.content === 'string' ? msg.content : '';
    if (!body.trim()) continue;
    lines.push(`- ${msg.role}: ${clip(body, 360)}`);
  }
  const progress = lines.slice(-8).join('\n') || '- no prior steps recorded';
  return [
    '[CONTEXT CONTINUATION]',
    'The previous model call did not fit in the context window. Continue the same task from this checkpoint.',
    'Do not restart. Do not repeat finished work. Take the next concrete step.',
    '',
    `Goal: ${clip(goal, 1800)}`,
    '',
    'Recent progress:',
    progress,
  ].join('\n');
}

export function compactHistoricTurnMessages(turnMessages = [], currentRound = 1) {
  if (!Array.isArray(turnMessages) || turnMessages.length < 8) return turnMessages;

  // Keep the most recent 4 messages uncompacted
  const preserveRecentCount = 4;
  const thresholdIdx = turnMessages.length - preserveRecentCount;

  return turnMessages.map((msg, idx) => {
    if (idx < thresholdIdx && msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 300) {
      const lines = msg.content.split('\n').filter(Boolean);
      const firstLine = (lines[0] || '').slice(0, 100);
      return {
        ...msg,
        content: `[Historical Tool Output Verified & Compacted]: "${firstLine}..." (${lines.length} lines archived from earlier round)`,
      };
    }
    return msg;
  });
}

