import { rgb, bgRgb, c, gradient, stripAnsi } from './skins.mjs';

/**
 * ANSI-Aware Word Wrapper
 * Wraps text to maxWidth without clipping characters or corrupting ANSI escape codes.
 * Carries active ANSI styles forward across line breaks and safely resets at the end.
 */
export function wrapAnsi(text, maxWidth = 80) {
  if (!text) return [''];
  const lines = String(text).split('\n');
  const wrapped = [];

  for (const rawLine of lines) {
    if (stripAnsi(rawLine).length <= maxWidth) {
      wrapped.push(rawLine);
      continue;
    }

    let currentLine = '';
    let currentVisibleLength = 0;
    let activeStyles = '';

    // Tokenize into words and whitespace while preserving ANSI codes
    const tokens = rawLine.match(/(\x1b\[[0-9;?]*[a-zA-Z]|[\S]+|\s+)/g) || [rawLine];

    for (const token of tokens) {
      if (token.startsWith('\x1b[')) {
        // ANSI escape sequence
        currentLine += token;
        if (token === '\x1b[0m') {
          activeStyles = '';
        } else {
          activeStyles += token;
        }
        continue;
      }

      const tokenLen = token.length;

      if (currentVisibleLength + tokenLen <= maxWidth) {
        currentLine += token;
        currentVisibleLength += tokenLen;
      } else {
        // If it's pure whitespace at the boundary, skip it
        if (/^\s+$/.test(token)) {
          if (currentLine.length > 0) {
            wrapped.push(currentLine + c.reset);
            currentLine = activeStyles;
            currentVisibleLength = 0;
          }
          continue;
        }

        // Push existing line
        if (currentLine.length > 0) {
          wrapped.push(currentLine + c.reset);
          currentLine = activeStyles;
          currentVisibleLength = 0;
        }

        // If single word exceeds maxWidth, break it hard
        if (tokenLen > maxWidth) {
          let wordRem = token;
          while (wordRem.length > maxWidth) {
            wrapped.push(activeStyles + wordRem.slice(0, maxWidth) + c.reset);
            wordRem = wordRem.slice(maxWidth);
          }
          currentLine = activeStyles + wordRem;
          currentVisibleLength = wordRem.length;
        } else {
          currentLine += token;
          currentVisibleLength += tokenLen;
        }
      }
    }

    if (currentLine.length > 0) {
      wrapped.push(currentLine + (activeStyles ? c.reset : ''));
    }
  }

  return wrapped;
}

/**
 * Basic syntax highlighting for code fences in CLI
 */
function tintCodeLine(line, lang = '') {
  const commentColor = rgb(120, 110, 150); // Lavender Muted
  const keywordColor = rgb(190, 80, 255);  // Neon Purple
  const stringColor = rgb(140, 255, 60);   // Lime Green
  const numColor = rgb(180, 255, 90);      // Electric Lime
  const reset = c.reset;

  let tinted = line;

  // Comments
  if (/^\s*(?:\/\/|#|--)/.test(tinted)) {
    return commentColor + line + reset;
  }

  // Double and single quoted strings
  tinted = tinted.replace(/(["'`])(?:(?=(\\?))\2.)*?\1/g, (m) => `${stringColor}${m}${reset}`);

  // Common language keywords
  const keywords = /\b(const|let|var|function|return|if|else|for|while|import|from|export|default|class|async|await|try|catch|throw|new|typeof|def|class|self|True|False|None|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE)\b/g;
  tinted = tinted.replace(keywords, (m) => `${keywordColor}\x1b[1m${m}${reset}`);

  // Numbers
  tinted = tinted.replace(/\b(\d+)\b/g, `${numColor}$1${reset}`);

  return tinted;
}

/**
 * Renders Markdown into ANSI terminal formatted lines with rich syntax highlighting,
 * boxed code blocks, GitHub callout alerts, headers, and bullet styling.
 */
export function renderTerminalMarkdown(markdown, { skin, width = 80 }) {
  if (!markdown) return [];
  const s = skin;
  const p = rgb(...s.primary);
  const sec = rgb(...s.secondary);
  const acc = rgb(...s.accent);
  const gold = rgb(...s.gold);
  const mut = rgb(...s.muted);
  const bColor = rgb(...s.border);
  const bActive = rgb(...s.borderActive);
  const succ = rgb(...s.success);
  const dang = rgb(...s.danger);
  const warn = rgb(...s.warning);
  const reset = c.reset;

  const rawLines = String(markdown).split('\n');
  const output = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const trimmed = raw.trim();

    // 1. Fenced Code Blocks (```lang)
    const codeFenceMatch = raw.match(/^```([a-zA-Z0-9_-]*)/);
    if (codeFenceMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = codeFenceMatch[1] || 'code';
        codeBlockLines = [];
      } else {
        // Closing code block -> render framed box
        inCodeBlock = false;
        const boxWidth = Math.min(width, 86);
        const langTag = ` [ ${codeBlockLang} ] `;
        const topFill = Math.max(0, boxWidth - 4 - langTag.length);
        output.push(`${bColor}╭─${reset}${gold}\x1b[1m${langTag}${reset}${bColor}${'─'.repeat(topFill)}╮${reset}`);

        codeBlockLines.forEach((cLine, lineIdx) => {
          const lineNum = String(lineIdx + 1).padStart(3, ' ');
          const tinted = tintCodeLine(cLine, codeBlockLang);
          const visible = stripAnsi(cLine);
          const maxInner = boxWidth - 8;
          let displayLine = tinted;
          if (visible.length > maxInner) {
            displayLine = cLine.slice(0, maxInner - 1) + '…';
          }
          const pad = Math.max(0, maxInner - stripAnsi(displayLine).length);
          output.push(`${bColor}│${reset} ${c.dim}${lineNum} │${reset} ${displayLine}${' '.repeat(pad)} ${bColor}│${reset}`);
        });

        output.push(`${bColor}╰${'─'.repeat(boxWidth - 2)}╯${reset}`);
        codeBlockLang = '';
        codeBlockLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(raw);
      continue;
    }

    // 2. GitHub-Style Callout Alerts (> [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION])
    const alertMatch = raw.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)/i);
    if (alertMatch) {
      const type = alertMatch[1].toUpperCase();
      const extra = alertMatch[2] ? ` ${alertMatch[2]}` : '';
      let alertColor = p;
      let alertIcon = 'ℹ NOTE';
      if (type === 'TIP') { alertColor = succ; alertIcon = '💡 TIP'; }
      if (type === 'IMPORTANT') { alertColor = sec; alertIcon = '⚡ IMPORTANT'; }
      if (type === 'WARNING') { alertColor = warn; alertIcon = '⚠️ WARNING'; }
      if (type === 'CAUTION') { alertColor = dang; alertIcon = '🛑 CAUTION'; }

      output.push(`${alertColor}┃\x1b[1m ${alertIcon}${reset}${extra ? ` ${mut}${extra}${reset}` : ''}`);
      continue;
    }

    // Blockquote continuation
    if (/^>\s?/.test(raw)) {
      const quoteText = raw.replace(/^>\s?/, '');
      const wrapped = wrapAnsi(quoteText, width - 6);
      wrapped.forEach((wl) => {
        output.push(`${bActive}┃${reset}  ${mut}${wl}${reset}`);
      });
      continue;
    }

    // 3. Headers
    // H1 (# Header)
    if (/^#\s+/.test(raw)) {
      const title = raw.replace(/^#\s+/, '').trim();
      output.push('');
      output.push(`${p}\x1b[1m═══ ${title.toUpperCase()} ${'═'.repeat(Math.max(0, width - title.length - 8))}${reset}`);
      output.push('');
      continue;
    }

    // H2 (## Header)
    if (/^##\s+/.test(raw)) {
      const title = raw.replace(/^##\s+/, '').trim();
      output.push('');
      output.push(`${sec}\x1b[1m─── ${title} ${'─'.repeat(Math.max(0, width - title.length - 8))}${reset}`);
      continue;
    }

    // H3 (### Header)
    if (/^###\s+/.test(raw)) {
      const title = raw.replace(/^###\s+/, '').trim();
      output.push(`${acc}\x1b[1m◆ ${title}${reset}`);
      continue;
    }

    // 4. Horizontal Rules (--- or ***)
    if (/^[-*_]{3,}$/.test(trimmed)) {
      output.push(`${bColor}${'─'.repeat(width)}${reset}`);
      continue;
    }

    // 5. Checklist Items (- [x], - [ ])
    const checkMatch = raw.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)/);
    if (checkMatch) {
      const indent = checkMatch[1] || '';
      const isChecked = checkMatch[2].toLowerCase() === 'x';
      const itemText = checkMatch[3];
      const icon = isChecked ? `${succ}\x1b[1m✔ [DONE]   ${reset}` : `${mut}○ [PENDING]${reset}`;
      const wrapped = wrapAnsi(itemText, width - indent.length - 14);
      wrapped.forEach((wl, idx) => {
        if (idx === 0) {
          output.push(`${indent} ${icon} ${isChecked ? succ : mut}${wl}${reset}`);
        } else {
          output.push(`${indent}            ${mut}${wl}${reset}`);
        }
      });
      continue;
    }

    // 6. Bullet Lists (*, -, +)
    const bulletMatch = raw.match(/^(\s*)[-*+]\s+(.*)/);
    if (bulletMatch) {
      const indent = bulletMatch[1] || '';
      const itemText = bulletMatch[2];
      const bulletGlyph = `${sec}›${reset}`;
      const wrapped = wrapAnsi(itemText, width - indent.length - 4);
      wrapped.forEach((wl, idx) => {
        if (idx === 0) {
          output.push(`${indent} ${bulletGlyph} ${formatInlineMarkdown(wl, skin)}`);
        } else {
          output.push(`${indent}   ${formatInlineMarkdown(wl, skin)}`);
        }
      });
      continue;
    }

    // 7. Numbered Lists (1., 2.)
    const numMatch = raw.match(/^(\s*)(\d+[\.)])\s+(.*)/);
    if (numMatch) {
      const indent = numMatch[1] || '';
      const numLabel = `${gold}\x1b[1m${numMatch[2]}${reset}`;
      const itemText = numMatch[3];
      const wrapped = wrapAnsi(itemText, width - indent.length - 6);
      wrapped.forEach((wl, idx) => {
        if (idx === 0) {
          output.push(`${indent} ${numLabel} ${formatInlineMarkdown(wl, skin)}`);
        } else {
          output.push(`${indent}    ${formatInlineMarkdown(wl, skin)}`);
        }
      });
      continue;
    }

    // 8. Plain text paragraphs
    if (trimmed.length === 0) {
      output.push('');
      continue;
    }

    const wrapped = wrapAnsi(raw, width);
    wrapped.forEach((wl) => {
      output.push(formatInlineMarkdown(wl, skin));
    });
  }

  return output;
}

/**
 * Formats inline Markdown tokens: `code`, **bold**, *italic*
 */
export function formatInlineMarkdown(text, skin) {
  if (!text) return '';
  const s = skin;
  const gold = rgb(...s.gold);
  const reset = c.reset;

  let formatted = text;

  // Inline code (`code`)
  formatted = formatted.replace(/`([^`]+)`/g, `${gold}\x1b[1m$1${reset}`);

  // Bold (**bold**)
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, `\x1b[1m$1\x1b[22m`);

  // Italic (*italic*)
  formatted = formatted.replace(/(^|[^\*])\*([^*]+)\*([^\*]|$)/g, `$1\x1b[3m$2\x1b[23m$3`);

  return formatted;
}
