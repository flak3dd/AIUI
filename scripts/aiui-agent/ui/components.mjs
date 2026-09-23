import readline from 'node:readline';
import { rgb, bgRgb, c, gradient, stripAnsi } from './skins.mjs';
import { renderTerminalMarkdown, wrapAnsi, formatInlineMarkdown } from './markdown.mjs';

export { renderTerminalMarkdown, wrapAnsi, formatInlineMarkdown };

export function badge(text, fgRgb, bgRgbArr) {
  const fg = rgb(...fgRgb);
  const bg = bgRgb(...(bgRgbArr || [30, 41, 59]));
  return `${bg}${fg} ${text} ${c.reset}`;
}

export function renderCard({ title, badge: bText, lines = [], footer, skin, width = 76 }) {
  const s = skin;
  const bColor = rgb(...s.border);
  const bActive = rgb(...s.borderActive);
  const titleColor = rgb(...s.primary);
  const contentWidth = width - 4; // interior padding

  const padContent = (str, len) => {
    const visualLen = stripAnsi(str).length;
    const diff = Math.max(0, len - visualLen);
    return str + ' '.repeat(diff);
  };

  const topBorder = bColor + '╭' + '─'.repeat(width - 2) + '╮' + c.reset;
  const bottomBorder = bColor + '╰' + '─'.repeat(width - 2) + '╯' + c.reset;
  const midBorder = bColor + '├' + '─'.repeat(width - 2) + '┤' + c.reset;

  let headerLine = '';
  if (title) {
    const rawTitle = ` ${title} `;
    const bPart = bText ? ` ${bText} ` : '';
    const leftPart = `${bActive}╭─${c.reset}${titleColor}\x1b[1m${rawTitle}${c.reset}`;
    const visualLeft = 2 + stripAnsi(rawTitle).length;
    const visualRight = stripAnsi(bPart).length + 1;
    const fillCount = Math.max(0, width - visualLeft - visualRight - 1);
    headerLine = `${leftPart}${bColor}${'─'.repeat(fillCount)}${c.reset}${bPart}${bColor}─╮${c.reset}`;
  } else {
    headerLine = topBorder;
  }

  const flattenedLines = [];
  for (const item of lines) {
    if (typeof item === 'string' && item.includes('\n')) {
      flattenedLines.push(...item.split('\n'));
    } else {
      flattenedLines.push(item);
    }
  }

  const renderedLines = flattenedLines.map((l) => {
    return `${bColor}│${c.reset}  ${padContent(l, contentWidth)}  ${bColor}│${c.reset}`;
  });

  let footerPart = '';
  if (footer) {
    const visualFooter = stripAnsi(footer).length + 2;
    const fillLeft = Math.max(0, width - visualFooter - 3);
    footerPart = `${bColor}╰${'─'.repeat(fillLeft)} ${c.dim}${footer}${c.reset} ${bColor}─╯${c.reset}`;
  } else {
    footerPart = bottomBorder;
  }

  return [headerLine, ...renderedLines, footerPart].join('\n');
}

export function formatRunningTime(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) {
    return `${totalSec}s`;
  }
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) {
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m ${secs}s`;
}

export class LiveSpinner {
  constructor(labelOrOptions, skin, maybeOptions = {}) {
    let opts = {};
    if (labelOrOptions && typeof labelOrOptions === 'object') {
      opts = labelOrOptions;
      this.label = opts.label || 'Running tools';
      this.skin = opts.skin || skin || { primary: [0, 240, 255], gold: [251, 191, 36], muted: [148, 163, 184], warning: [245, 158, 11] };
    } else {
      opts = maybeOptions || {};
      this.label = labelOrOptions || 'Running tools';
      this.skin = skin || { primary: [0, 240, 255], gold: [251, 191, 36], muted: [148, 163, 184], warning: [245, 158, 11] };
    }

    this.showTimer = Boolean(opts.showTimer);
    this.allowInterrupt = opts.allowInterrupt !== undefined ? Boolean(opts.allowInterrupt) : this.showTimer;
    this.onInterrupt = opts.onInterrupt || null;
    this.startTime = opts.startTime || null;

    this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.idx = 0;
    this.timer = null;
    this.isEscPending = false;
    this.escResetTimeout = null;
    this.rawModeSet = false;
    this.keyListener = null;
    this.isTty = Boolean(process.stdout && process.stdout.isTTY);
  }

  render() {
    const frame = this.frames[this.idx % this.frames.length];
    const coloredFrame = `${rgb(...(this.skin?.primary || [0, 240, 255]))}${frame}${c.reset}`;

    if (this.showTimer) {
      const elapsedMs = Date.now() - (this.startTime || Date.now());
      const elapsedStr = formatRunningTime(elapsedMs);
      const action = this.label || 'Running tools';
      const middleDot = `${c.dim}·${c.reset}`;
      const timeDisplay = `${rgb(...(this.skin?.gold || [251, 191, 36]))}${elapsedStr}${c.reset}`;
      const hintDisplay = this.isEscPending
        ? `${rgb(...(this.skin?.warning || [245, 158, 11]))}\x1b[1m(esc again to interrupt)${c.reset}`
        : `${rgb(...(this.skin?.muted || [148, 163, 184]))}${c.dim}(esc twice to interrupt)${c.reset}`;

      try {
        process.stdout.write(`\r\x1b[2K  ${coloredFrame} ${action} ${middleDot} ${timeDisplay} ${hintDisplay}   \x1b[K`);
      } catch {}
    } else {
      const cols = process.stdout?.columns || 80;
      const maxLabelLen = Math.max(15, cols - 7);
      const safeLabel = truncateAnsi(this.label, maxLabelLen);
      try {
        process.stdout.write(`\r\x1b[2K  ${coloredFrame} ${safeLabel}   \x1b[K`);
      } catch {}
    }
  }

  start() {
    this.startTime = this.startTime || Date.now();

    // Process-level safety hook: ensure cursor is always restored on exit
    if (!LiveSpinner._exitHookRegistered) {
      LiveSpinner._exitHookRegistered = true;
      process.on('exit', () => {
        try { process.stdout.write('\x1b[?25h'); } catch {}
      });
    }

    if (!this.isTty) {
      const plain = stripAnsi(this.label);
      process.stdout.write(`  ● ${plain}\n`);
      return;
    }

    try {
      process.stdout.write('\x1b[?25l');
    } catch {}

    // Setup keyboard listener for ESC-twice interrupt
    if (this.allowInterrupt && process.stdin.isTTY) {
      try {
        readline.emitKeypressEvents(process.stdin);
        if (!process.stdin.isRaw) {
          process.stdin.setRawMode(true);
          this.rawModeSet = true;
          process.stdin.resume();
        }

        this.keyListener = (str, key) => {
          const isEscape = (key && key.name === 'escape') || str === '\x1b';
          if (isEscape) {
            if (this.isEscPending) {
              // Second ESC within timeout: trigger interrupt
              this.isEscPending = false;
              if (this.escResetTimeout) {
                clearTimeout(this.escResetTimeout);
                this.escResetTimeout = null;
              }
              this.stop();
              if (typeof this.onInterrupt === 'function') {
                this.onInterrupt();
              }
            } else {
              // First ESC: prompt user to press again
              this.isEscPending = true;
              this.render();
              if (this.escResetTimeout) clearTimeout(this.escResetTimeout);
              this.escResetTimeout = setTimeout(() => {
                this.isEscPending = false;
                this.render();
              }, 1500);
            }
          } else if ((key && key.ctrl && key.name === 'c') || str === '\x03') {
            if (this.rawModeSet) {
              this.stop();
              process.kill(process.pid, 'SIGINT');
            }
          }
        };

        process.stdin.on('keypress', this.keyListener);
      } catch {}
    }

    this.render();
    this.timer = setInterval(() => {
      this.idx++;
      this.render();
    }, 80);
  }

  stop(finalText) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.escResetTimeout) {
      clearTimeout(this.escResetTimeout);
      this.escResetTimeout = null;
    }
    if (this.keyListener) {
      try {
        process.stdin.removeListener('keypress', this.keyListener);
      } catch {}
      this.keyListener = null;
    }
    if (this.rawModeSet) {
      try {
        process.stdin.setRawMode(false);
      } catch {}
      this.rawModeSet = false;
    }

    try {
      process.stdout.write('\r\x1b[2K\x1b[?25h');
    } catch {}

    if (finalText) {
      console.log(finalText);
    }
  }
}

export function renderStatusDashboard(status, s) {
  const rows = [
    { name: 'DGX Spark SSH', ep: '100.66.147.53:22', ok: status.sparkSsh.ok, ms: status.sparkSsh.ms, desc: status.isNativeSpark ? 'Native host' : 'Direct key auth' },
    { name: 'Sandbox Runner', ep: '17330', ok: status.runner.ok, ms: status.runner.ms, desc: 'Container manager' },
    { name: 'MemPalace Vector DB', ep: '17333', ok: status.mempalace.ok, ms: status.mempalace.ms, desc: 'Context memory' },
    { name: 'Cloud Key Proxy', ep: '17332', ok: status.cloudProxy.ok, ms: status.cloudProxy.ms, desc: 'LLM gateway' },
  ];

  const lines = [];
  lines.push(` ${c.dim}${'SERVICE'.padEnd(23)} ${'PORT/HOST'.padEnd(16)} STATUS    LATENCY    DESCRIPTION${c.reset}`);
  lines.push(` ${rgb(...s.border)}${'─'.repeat(70)}${c.reset}`);

  for (const r of rows) {
    const icon = r.ok ? `${rgb(...s.success)}● ONLINE ${c.reset}` : `${rgb(...s.danger)}○ OFFLINE${c.reset}`;
    const lat = r.ms !== undefined ? `${r.ms}ms`.padEnd(10) : '--        ';
    const line = ` ${rgb(...s.primary)}${r.name.padEnd(23)}${c.reset} ${rgb(...s.muted)}${r.ep.padEnd(16)}${c.reset} ${icon}  ${rgb(...s.gold)}${lat}${c.reset} ${c.dim}${r.desc}${c.reset}`;
    lines.push(line);
  }

  return renderCard({
    title: '⚡ ECOSYSTEM TELEMETRY DASHBOARD',
    badge: badge('SYSTEM MESH', s.primary, s.badgeBg),
    lines,
    skin: s,
    width: 76,
  });
}

export const AIUI_ASCII_LOGO = [
  "             +++++++++++++++++++++++            ++++++++           ++++++++                +++++++        ++++++++             ",
  "             ++++++++++++++++++++++++++         +++++++++++        +++++++++++             ++++++++++     +++++++++++          ",
  "             +++++++++++++++++++++++ +          ++++++++  +        ++++++++ ++             +++++++ +      ++++++++  +          ",
  "             +++++++++++++++++++++++ + +        ++++++++  +        ++++++++ ++             +++++++ +      ++++++++  +          ",
  "         ++++++++            +++++++            ++++++++  +        ++++++++ ++             +++++++ +      ++++++++  +          ",
  "         ++++++++ +++++++++++++++++++++         ++++++++  +        ++++++++ ++             +++++++ +      ++++++++  +          ",
  "         ++++++++ ++         +++++++ +          ++++++++  +        ++++++++ ++             +++++++ +      ++++++++  +          ",
  "         ++++++++ ++         +++++++ + +        ++++++++  +        ++++++++ ++             +++++++ +      ++++++++  +          ",
  "         +++++++++++++++++++++++++++ + +        ++++++++  +        ++++++++ ++             +++++++ +      ++++++++  +          ",
  "         +++++++++++++++++++++++++++ + +        ++++++++  +        ++++++++ ++             +++++++ +      ++++++++  +          ",
  "         +++++++++++++++++++++++++++ + +        ++++++++  +        ++++++++ ++             +++++++ +      ++++++++  +          ",
  "         +++++++++++++++++++++++++++ + +        ++++++++  +        ++++++++ ++             +++++++ +      ++++++++  +          ",
  "         ++++++++            +++++++ + +        ++++++++  +        ++++++++ ++             +++++++ +      ++++++++  +          ",
  "         ++++++++ ++++++++++++++++++ + +        ++++++++  +        ++++++++ ++             +++++++ +      ++++++++  +          ",
  "         ++++++++ ++         +++++++ + +        ++++++++  +        ++++++++ ++             +++++++ +      ++++++++  +          ",
  "         ++++++++ ++         +++++++ + +        ++++++++  +        ++++++++ +              +++++++ +      ++++++++  +          ",
  "         ++++++++ ++         +++++++ + +        ++++++++  +         +  +++++++++++++++++++++++     +      ++++++++  +          ",
  "         ++++++++ ++         +++++++ + +        ++++++++  +         + ++++++++++++++++++++++++ +++++      ++++++++  +          ",
  "         ++++++++ ++         +++++++ + +        ++++++++  +            +++++++++++++++++++++++ +          ++++++++  +          ",
  "         ++++++++ ++         +++++++ + +        ++++++++  +            +++++++++++++++++++++++ + +        ++++++++  +          ",
  "          +       ++         + +     + +         ++       +             +                      + +         +        +          ",
  "          + ++++++++         + +++++++ +         ++++++++ +             + ++++++++++++++++++++++ +         ++++++++ +          ",
];

export function renderCliLogo(skin) {
  const p = rgb(...(skin?.primary || [0, 240, 255]));
  const r = c.reset;
  return AIUI_ASCII_LOGO.map((l) => `${p}${l}${r}`).join('\n');
}

export function truncateAnsi(str, maxLen) {
  const raw = String(str || '');
  if (stripAnsi(raw).length <= maxLen) return raw;

  let visibleCount = 0;
  let result = '';
  let inEscape = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '\x1b') {
      inEscape = true;
      result += char;
      continue;
    }
    if (inEscape) {
      result += char;
      if (/[a-zA-Z]/.test(char) && char !== '[') inEscape = false;
      continue;
    }
    if (visibleCount < maxLen - 1) {
      result += char;
      visibleCount++;
    } else {
      result += '…' + c.reset;
      break;
    }
  }
  return result;
}

export function padAnsi(str, targetLen) {
  const truncated = truncateAnsi(str, targetLen);
  const visualLen = stripAnsi(truncated).length;
  const padLen = Math.max(0, targetLen - visualLen);
  return truncated + ' '.repeat(padLen);
}

export function renderCodeBuddyHeroCard({
  title = 'AIUI Code v2.154.0',
  workspaceDir = process.cwd(),
  webUiUrl = 'http://127.0.0.1:5173',
  mode = 'Auto · high',
  model = 'Qwen2.5-Coder-32B',
  recentActivity = 'No recent activity',
  skin,
  width = null,
}) {
  const s = skin;
  const bColor = rgb(...s.border);
  const titleColor = rgb(...s.primary);
  const mutedColor = rgb(...s.muted);
  const textColor = c.reset;
  const dimColor = c.dim;

  const termCols = (process.stdout && process.stdout.columns) ? process.stdout.columns : 110;
  const totalWidth = width || Math.min(Math.max(termCols - 2, 85), 110);
  const leftWidth = 35;
  const rightWidth = Math.max(30, totalWidth - leftWidth - 3);

  const p = rgb(...s.primary);
  const sec = rgb(...s.secondary);
  const acc = rgb(...s.accent);
  const gold = rgb(...s.gold);
  const mut = rgb(...s.muted);
  const r = c.reset;

  const leftLines = [
    '                                   ',
    `   ${bColor}╭───────────────────────────╮${r}   `,
    `   ${bColor}│${r}  ${gold}◆${r}  ${acc}S O V E R E I G N${r}  ${gold}◆${r}  ${bColor}│${r}   `,
    `   ${bColor}╰───────────────────────────╯${r}   `,
    '                                   ',
    `    ${p}██████╗${r}  ${p}██╗${r}  ${sec}██╗   ██╗${r} ${acc}██╗${r}    `,
    `   ${p}██╔══██╗${r}  ${p}██║${r}  ${sec}██║   ██║${r} ${acc}██║${r}    `,
    `   ${p}███████║${r}  ${p}██║${r}  ${sec}██║   ██║${r} ${acc}██║${r}    `,
    `   ${p}██╔══██║${r}  ${p}██║${r}  ${sec}██║   ██║${r} ${acc}██║${r}    `,
    `   ${p}██║  ██║${r}  ${p}██║${r}  ${sec}╚██████╔╝${r} ${acc}██║${r}    `,
    `   ${p}╚═╝  ╚═╝${r}  ${p}╚═╝${r}   ${sec}╚═════╝${r}  ${acc}╚═╝${r}    `,
    '                                   ',
    `     ${gold}◈${r}  ${mut}NEURAL CLUSTER MESH${r}  ${gold}◈${r}     `,
  ];

  const midDivider = `${bColor}${'─'.repeat(rightWidth)}${r}`;

  const rightLines = [
    ` ${textColor}Tips for getting started${r}`,
    ` ${mutedColor}Run /init to create an AGENTS.md or AIUI.md file with instruction…${r}`,
    ` ${mutedColor}Open Web UI in browser for a richer interactive experience.${r}`,
    ` ${mutedColor}Press / to use commands, @ to mention files.${r}`,
    midDivider,
    ` ${textColor}Recent activity${r}`,
    ` ${mutedColor}${recentActivity}${r}`,
    midDivider,
    ` ${rgb(...s.primary)}${webUiUrl}${r}`,
    ` ${mutedColor}${mode}${r}`,
    ` ${mutedColor}${workspaceDir}${r}`,
    ' ',
    ' ',
  ];

  const titleText = ` ${title} `;
  const topPrefix = `${bColor}╭───${r}${titleColor}\x1b[1m${titleText}${r}${bColor}`;
  const topFill = Math.max(0, totalWidth - 4 - stripAnsi(titleText).length - 1);
  const topBorder = `${topPrefix}${'─'.repeat(topFill)}╮${r}`;
  const bottomBorder = `${bColor}╰${'─'.repeat(totalWidth - 2)}╯${r}`;

  const renderedRows = [];
  const maxLines = Math.max(leftLines.length, rightLines.length);
  for (let i = 0; i < maxLines; i++) {
    const leftRaw = leftLines[i] || ' '.repeat(leftWidth);
    const rightRaw = rightLines[i] || ' ';
    const leftFormatted = padAnsi(leftRaw, leftWidth);
    const rightFormatted = padAnsi(rightRaw, rightWidth);
    renderedRows.push(`${bColor}│${r}${leftFormatted}${bColor}│${r}${rightFormatted}${bColor}│${r}`);
  }

  const fullDivider = `${bColor}${'─'.repeat(termCols || totalWidth)}${r}`;

  return {
    card: [topBorder, ...renderedRows, bottomBorder].join('\n'),
    divider: fullDivider,
  };
}

/**
 * Renders the 4-Pillar Cognitive Deliberation Matrix card
 */
export function renderThinkingMatrix({ deliberation, skin, width = 78 }) {
  const s = skin;
  const lines = [];

  if (deliberation.intent) {
    lines.push(`${rgb(...s.primary)}\x1b[1m🎯 Target Intent & Scope:${c.reset}`);
    lines.push(`  ${rgb(...s.text || [248, 250, 252])}${deliberation.intent}${c.reset}`);
    lines.push('');
  }

  if (deliberation.decomposition && deliberation.decomposition.length) {
    lines.push(`${rgb(...s.secondary)}\x1b[1m📋 Problem Decomposition:${c.reset}`);
    deliberation.decomposition.forEach((d) => {
      lines.push(`  ${rgb(...s.accent)}›${c.reset} ${rgb(...s.muted)}${d}${c.reset}`);
    });
    lines.push('');
  }

  if (deliberation.architecture && deliberation.architecture.length) {
    lines.push(`${rgb(...s.gold)}\x1b[1m🏛️  Architecture & Target Invariants:${c.reset}`);
    deliberation.architecture.forEach((a) => {
      lines.push(`  ${rgb(...s.accent)}›${c.reset} ${rgb(...s.muted)}${a}${c.reset}`);
    });
    lines.push('');
  }

  if (deliberation.risks && deliberation.risks.length) {
    lines.push(`${rgb(...s.danger)}\x1b[1m⚠️  Failure Modes & Anti-Patterns to Avoid:${c.reset}`);
    deliberation.risks.forEach((r) => {
      lines.push(`  ${rgb(...s.danger)}•${c.reset} ${rgb(...s.muted)}${r}${c.reset}`);
    });
    lines.push('');
  }

  if (deliberation.verificationCriteria && deliberation.verificationCriteria.length) {
    lines.push(`${rgb(...s.success)}\x1b[1m🧪 Verification Gates & Proof Criteria:${c.reset}`);
    deliberation.verificationCriteria.forEach((v) => {
      lines.push(`  ${rgb(...s.success)}✔${c.reset} ${rgb(...s.muted)}${v}${c.reset}`);
    });
  }

  return renderCard({
    title: '🧠 COGNITIVE DELIBERATION MATRIX',
    badge: badge('4-PILLAR REASONING', s.secondary, s.badgeBg),
    lines,
    footer: 'Phase 1: Cognitive Analysis & Architectural Invariants',
    skin: s,
    width,
  });
}

/**
 * Renders the Strategic Execution Plan card with live milestone tracking
 */
export function renderPlanCard({ plan, skin, width = 78 }) {
  const s = skin;
  const lines = [];

  const completed = plan.getCompletedCount();
  const total = plan.steps.length;
  const pct = Math.round(plan.getProgressRatio() * 100);

  // Goal banner
  lines.push(`${rgb(...s.primary)}\x1b[1mGoal:${c.reset} ${rgb(...s.muted)}${plan.goal}${c.reset}`);
  lines.push(`${rgb(...s.borderActive)}${'┄'.repeat(width - 6)}${c.reset}`);
  lines.push('');

  // Render steps grouped by phase or sequentially
  plan.steps.forEach((step, idx) => {
    let icon = `${rgb(...s.muted)}○ [PENDING]${c.reset}`;
    let titleStr = `${rgb(...s.muted)}${step.title}${c.reset}`;
    let phaseBadge = `[${step.phase}]`;

    if (step.status === 'completed') {
      icon = `${rgb(...s.success)}\x1b[1m✔ [DONE]   ${c.reset}`;
      titleStr = `${rgb(...s.success)}${step.title}${c.reset}`;
    } else if (step.status === 'active') {
      icon = `${rgb(...s.gold)}\x1b[1m▶ [ACTIVE] ${c.reset}`;
      titleStr = `${rgb(...s.gold)}\x1b[1m${step.title}${c.reset}`;
    } else if (step.status === 'failed') {
      icon = `${rgb(...s.danger)}\x1b[1m✘ [FAILED] ${c.reset}`;
      titleStr = `${rgb(...s.danger)}${step.title}${c.reset}`;
    } else if (step.status === 'skipped') {
      icon = `${c.dim}⊘ [SKIP]   ${c.reset}`;
      titleStr = `${c.dim}${step.title}${c.reset}`;
    }

    lines.push(` ${icon} ${titleStr} ${c.dim}${phaseBadge}${c.reset}`);

    if (step.targetFiles && step.targetFiles.length) {
      lines.push(`    ${rgb(...s.muted)}Files:${c.reset} ${c.dim}${step.targetFiles.join(', ')}${c.reset}`);
    }
    if (step.verificationGate && step.status !== 'completed') {
      lines.push(`    ${rgb(...s.accent)}Gate:${c.reset}  ${c.dim}${step.verificationGate}${c.reset}`);
    }
    if (step.evidence) {
      lines.push(`    ${rgb(...s.success)}Proof:${c.reset} ${c.dim}${step.evidence}${c.reset}`);
    }
    if (step.error) {
      lines.push(`    ${rgb(...s.danger)}Error:${c.reset} ${c.dim}${step.error}${c.reset}`);
    }

    if (idx < plan.steps.length - 1) {
      lines.push('');
    }
  });

  const planBadge = plan.isComplete()
    ? badge(`✔ 100% COMPLETE`, s.success, [15, 35, 25])
    : badge(`${completed}/${total} MILESTONES (${pct}%)`, s.gold, [35, 25, 10]);

  return renderCard({
    title: `📋 STRATEGIC PLAN: ${plan.title.slice(0, 38)}`,
    badge: planBadge,
    lines,
    footer: `${completed}/${total} completed · ${pct}% · Milestone lifecycle active`,
    skin: s,
    width,
  });
}

/**
 * Compact, modern Workflow Stage Board rendering plan milestones cleanly.
 */
export function renderWorkflowStageBoard({ plan, skin, width = 78 }) {
  const s = skin;
  const lines = [];
  const completed = plan.getCompletedCount();
  const total = plan.steps.length;
  const pct = Math.round(plan.getProgressRatio() * 100);

  // Goal banner
  lines.push(`${rgb(...s.primary)}\x1b[1mGoal:${c.reset} ${rgb(...s.muted)}${plan.goal}${c.reset}`);
  lines.push(`${rgb(...s.borderActive)}${'┄'.repeat(Math.max(10, width - 6))}${c.reset}`);

  plan.steps.forEach((step, idx) => {
    let icon = `${rgb(...s.muted)}○${c.reset}`;
    let titleStr = `${rgb(...s.muted)}${step.title}${c.reset}`;
    let badgeText = `${c.dim}[${step.phase}]${c.reset}`;

    if (step.status === 'completed') {
      icon = `${rgb(...s.success)}\x1b[1m✔${c.reset}`;
      titleStr = `${rgb(...s.success)}${step.title}${c.reset}`;
    } else if (step.status === 'active') {
      icon = `${rgb(...s.gold)}\x1b[1m▶${c.reset}`;
      titleStr = `${rgb(...s.gold)}\x1b[1m${step.title}${c.reset}`;
      badgeText = `${rgb(...s.gold)}[ACTIVE]${c.reset}`;
    } else if (step.status === 'failed') {
      icon = `${rgb(...s.danger)}\x1b[1m✘${c.reset}`;
      titleStr = `${rgb(...s.danger)}${step.title}${c.reset}`;
    }

    lines.push(`  ${icon} [${idx + 1}/${total}] ${titleStr} ${badgeText}`);
  });

  const planBadge = plan.isComplete()
    ? badge('✔ 100% COMPLETE', s.success, [15, 35, 25])
    : badge(`${completed}/${total} MILESTONES (${pct}%)`, s.gold, [35, 25, 10]);

  return renderCard({
    title: `📋 WORKFLOW: ${plan.title.slice(0, 42)}`,
    badge: planBadge,
    lines,
    footer: `${completed}/${total} completed · ${pct}% · Milestone lifecycle active`,
    skin: s,
    width,
  });
}

/**
 * Calculates adaptive, responsive terminal width constrained to optimal bounds
 */
export function getResponsiveWidth(defaultWidth = 84, maxWidth = 98) {
  const cols = process.stdout && process.stdout.columns ? process.stdout.columns : defaultWidth;
  return Math.min(Math.max(cols - 4, 70), maxWidth);
}

/**
 * Stage 1: Renders the 5-Stage Cognitive Progression Protocol card with distinct visual sub-blocks
 */
export function renderCognitiveProgressionCard({ thoughts, round, maxRounds, skin, width = 84 }) {
  const s = skin;
  const contentWidth = width - 8;
  const p = rgb(...s.primary);
  const sec = rgb(...s.secondary);
  const acc = rgb(...s.accent);
  const gold = rgb(...s.gold);
  const succ = rgb(...s.success);
  const mut = rgb(...s.muted);
  const bColor = rgb(...s.border);
  const reset = c.reset;

  const stagePatterns = [
    {
      num: 1,
      id: 'OBSERVE',
      name: 'STAGE 1: OBSERVE & RECALL CONTEXT',
      icon: '👁️',
      color: s.primary,
      regex: /(?:^|\n)(?:[*#\s-]*STAGE\s*1\s*[:\s—]+(?:\[?OBSERVE[^\]\n]*\]?)?|\[?OBSERVE\s*(?:&|\+)?\s*RECALL[^\]\n]*\]?)([\s\S]*?)(?=(?:[*#\s-]*STAGE\s*[2-5]|\[?(?:ORIENT|DECIDE|ACT|VERIFY)|$))/i,
    },
    {
      num: 2,
      id: 'ORIENT',
      name: 'STAGE 2: ORIENT & CONTEXT AUDIT',
      icon: '🧭',
      color: s.secondary,
      regex: /(?:^|\n)(?:[*#\s-]*STAGE\s*2\s*[:\s—]+(?:\[?ORIENT[^\]\n]*\]?)?|\[?ORIENT(?:\s*:\s*CONTEXT\s*AUDIT)?[^\]\n]*\]?)([\s\S]*?)(?=(?:[*#\s-]*STAGE\s*[3-5]|\[?(?:DECIDE|ACT|VERIFY)|$))/i,
    },
    {
      num: 3,
      id: 'DECIDE',
      name: 'STAGE 3: DECIDE & SURGICAL DIFF',
      icon: '🎯',
      color: s.gold,
      regex: /(?:^|\n)(?:[*#\s-]*STAGE\s*3\s*[:\s—]+(?:\[?DECIDE[^\]\n]*\]?)?|\[?DECIDE(?:\s*:\s*SURGICAL\s*DIFF)?[^\]\n]*\]?)([\s\S]*?)(?=(?:[*#\s-]*STAGE\s*[4-5]|\[?(?:ACT|VERIFY)|$))/i,
    },
    {
      num: 4,
      id: 'ACT',
      name: 'STAGE 4: ACT & PROGRESSIVE MUTATION',
      icon: '⚡',
      color: s.accent,
      regex: /(?:^|\n)(?:[*#\s-]*STAGE\s*4\s*[:\s—]+(?:\[?ACT[^\]\n]*\]?)?|\[?ACT(?:\s*:\s*PROGRESSIVE\s*MUTATION)?[^\]\n]*\]?)([\s\S]*?)(?=(?:[*#\s-]*STAGE\s*5|\[?VERIFY|$))/i,
    },
    {
      num: 5,
      id: 'VERIFY',
      name: 'STAGE 5: VERIFY & DIRECT PROOF',
      icon: '🛡️',
      color: s.success,
      regex: /(?:^|\n)(?:[*#\s-]*STAGE\s*5\s*[:\s—]+(?:\[?VERIFY[^\]\n]*\]?)?|\[?VERIFY(?:\s*:\s*DIRECT\s*PROOF)?[^\]\n]*\]?)([\s\S]*?)$/i,
    },
  ];

  const detectedStages = [];
  for (const st of stagePatterns) {
    const m = thoughts.match(st.regex);
    if (m && m[1] && m[1].trim()) {
      detectedStages.push({
        ...st,
        content: m[1].trim(),
      });
    }
  }

  const lines = [];

  if (detectedStages.length >= 2) {
    detectedStages.forEach((st, idx) => {
      const stageHeader = `${st.icon}  \x1b[1m${st.name}\x1b[22m`;
      lines.push(`${rgb(...st.color)}${stageHeader}${reset}`);

      const stageLines = st.content.split('\n').filter(Boolean);
      stageLines.forEach((l) => {
        const clean = l.replace(/^[-*•›]\s*/, '').trim();
        if (!clean) return;
        const wrapped = wrapAnsi(clean, contentWidth - 4);
        wrapped.forEach((wl, wIdx) => {
          if (wIdx === 0) {
            lines.push(`  ${rgb(...st.color)}›${reset} ${mut}${formatInlineMarkdown(wl, s)}${reset}`);
          } else {
            lines.push(`    ${mut}${formatInlineMarkdown(wl, s)}${reset}`);
          }
        });
      });

      if (idx < detectedStages.length - 1) {
        lines.push('');
      }
    });
  } else {
    const rawParagraphs = thoughts.split(/\n\s*\n/);
    rawParagraphs.forEach((para, pIdx) => {
      const trimmed = para.trim();
      if (!trimmed) return;
      const pLines = trimmed.split('\n');
      pLines.forEach((pl) => {
        const isBullet = /^[-*•›]/.test(pl.trim());
        const cleanText = pl.replace(/^[-*•›]\s*/, '').trim();
        const wrapped = wrapAnsi(cleanText, contentWidth - 4);
        wrapped.forEach((wl, wIdx) => {
          if (wIdx === 0) {
            const bullet = isBullet ? `${sec}›${reset}` : `${p}◈${reset}`;
            lines.push(` ${bullet} ${mut}${formatInlineMarkdown(wl, s)}${reset}`);
          } else {
            lines.push(`   ${mut}${formatInlineMarkdown(wl, s)}${reset}`);
          }
        });
      });
      if (pIdx < rawParagraphs.length - 1 && lines.length < 24) {
        lines.push('');
      }
    });
  }

  return renderCard({
    title: '🧠 COGNITIVE PROGRESSION PROTOCOL',
    badge: badge(`ROUND ${round}/${maxRounds} · REASONING`, s.secondary, s.badgeBg),
    lines,
    footer: detectedStages.length >= 2
      ? `${detectedStages.length}/5 cognitive progression stages evaluated`
      : `${lines.length} deliberation statements`,
    skin: s,
    width,
  });
}

/**
 * Stage 3: Renders categorized tool actions (Reconnaissance, Mutation, Shell Execution, Circuit Breaker)
 */
export function renderToolExecutionStage({
  toolName,
  parsedArgs = {},
  toolArgs = '',
  rawResult = '',
  parsed = {},
  evalResult = {},
  isCircuitBreaker = false,
  skin,
  width = 84,
  target,
}) {
  const s = skin;
  const p = rgb(...s.primary);
  const sec = rgb(...s.secondary);
  const gold = rgb(...s.gold);
  const succ = rgb(...s.success);
  const dang = rgb(...s.danger);
  const mut = rgb(...s.muted);
  const bColor = rgb(...s.border);
  const reset = c.reset;
  const contentWidth = width - 8;

  let stageName = '⚙️  SHELL EXECUTION';
  let stageBadgeColor = s.primary;
  let stageType = 'EXECUTION';

  if (['read_file', 'grep', 'grep_search', 'get_file_outline', 'memory_search', 'list_models', 'http_get_json', 'cve_lookup', 'bin_lookup'].includes(toolName)) {
    stageName = '🔍 RECONNAISSANCE & DISCOVERY';
    stageBadgeColor = s.secondary;
    stageType = 'RECON';
  } else if (['write_file', 'replace_file_content', 'multi_replace_file_content', 'apply_scaffold'].includes(toolName)) {
    stageName = '✂️  SURGICAL MUTATION & CODE PATCH';
    stageBadgeColor = s.accent;
    stageType = 'MUTATION';
  } else if (['start_daemon', 'read_daemon_logs', 'stop_daemon', 'list_daemons'].includes(toolName)) {
    stageName = '⚡ BACKGROUND DAEMON SUPERVISOR';
    stageBadgeColor = s.warning;
    stageType = 'DAEMON';
  } else if (['browser_open', 'browser_screenshot', 'browser_click', 'browser_type', 'browser_console_logs'].includes(toolName)) {
    stageName = '🌐 HEADLESS BROWSER AUDIT';
    stageBadgeColor = s.primary;
    stageType = 'BROWSER';
  } else if (toolName === 'spawn_subagent') {
    stageName = '🤖 HIERARCHICAL SUBAGENT DELEGATION';
    stageBadgeColor = s.gold;
    stageType = 'SUBAGENT';
  } else if (isCircuitBreaker) {
    stageName = '🛑 ANTI-LOOP INTERCEPT';
    stageBadgeColor = s.danger;
    stageType = 'CIRCUIT_BREAKER';
  } else if (toolName === 'bash') {
    const cmd = (parsedArgs.command || parsedArgs.cmd || '').toLowerCase();
    if (cmd.includes('test') || cmd.includes('pytest') || cmd.includes('check') || cmd.includes('diff') || cmd.includes('verify')) {
      stageName = '🧪 VERIFICATION PASS';
      stageBadgeColor = s.success;
      stageType = 'VERIFY';
    }
  }

  const isOk = !isCircuitBreaker && parsed.ok !== false && (parsed.exitCode === undefined || parsed.exitCode === 0);
  const ms = parsed.durationMs ? `${parsed.durationMs}ms` : '';
  const exitBadgeText = isCircuitBreaker
    ? 'BREAKER TRIPPED'
    : parsed.exitCode !== undefined
    ? (isOk ? `✔ EXIT 0 ${ms ? `· ${ms}` : ''}` : `✘ EXIT ${parsed.exitCode} ${ms ? `· ${ms}` : ''}`)
    : (isOk ? `✔ SUCCESS ${ms ? `· ${ms}` : ''}` : '✘ FAILED');

  const statusBadge = isOk
    ? badge(exitBadgeText, s.success, [15, 35, 25])
    : badge(exitBadgeText, s.danger, [45, 15, 20]);

  const lines = [];

  lines.push(`${rgb(...stageBadgeColor)}\x1b[1m${stageName}${reset} ${c.dim}[Tool: ${toolName}]${reset}`);
  lines.push(`${bColor}${'─'.repeat(contentWidth)}${reset}`);

  if (toolName === 'bash') {
    const cmd = parsedArgs.command || parsedArgs.cmd || toolArgs || '';
    lines.push(`${gold}\x1b[1m$ ${cmd}${reset}`);

    if (parsed.stdout) {
      lines.push(`${rgb(...s.borderActive)}┄ Output (stdout) ┄${reset}`);
      const sLines = parsed.stdout.split('\n');
      const maxShow = 8;
      sLines.slice(0, maxShow).forEach((l) => lines.push(`  ${mut}${l}${reset}`));
      if (sLines.length > maxShow) {
        lines.push(`  ${c.dim}... [${sLines.length - maxShow} additional lines omitted]${reset}`);
      }
    }

    if (parsed.stderr) {
      lines.push(`${dang}┄ Stderr / Diagnostic ┄${reset}`);
      const eLines = parsed.stderr.split('\n');
      eLines.slice(0, 6).forEach((el) => {
        const wrapped = wrapAnsi(el, contentWidth - 4);
        wrapped.forEach((wl) => lines.push(`  ${dang}${wl}${reset}`));
      });
      if (eLines.length > 6) {
        lines.push(`  ${c.dim}... [${eLines.length - 6} additional error lines omitted]${reset}`);
      }
    }
  } else if (toolName === 'replace_file_content' || toolName === 'multi_replace_file_content') {
    const pth = parsedArgs.path || parsed.path || '';
    lines.push(`${mut}Target File:${reset}   ${p}\x1b[1m${pth}${reset}`);
    if (parsed.byteDelta !== undefined) {
      const deltaStr = parsed.byteDelta >= 0 ? `+${parsed.byteDelta}` : `${parsed.byteDelta}`;
      lines.push(`${mut}Surgical Delta:${reset} ${gold}${deltaStr} bytes${reset} (Total: ${parsed.bytes || 0} bytes)`);
    }
    if (parsedArgs.target) {
      const preview = parsedArgs.target.split('\n')[0].slice(0, 50);
      lines.push(`${mut}Target Hunk:${reset}   ${dang}-${reset} ${c.dim}${preview}...${reset}`);
    }
    if (parsedArgs.replacement) {
      const preview = parsedArgs.replacement.split('\n')[0].slice(0, 50);
      lines.push(`${mut}Replacement:${reset}   ${succ}+${reset} ${c.dim}${preview}...${reset}`);
    }
    lines.push(`${succ}✔ Surgical patch applied · Ready for verification${reset}`);
  } else if (toolName === 'grep_search') {
    lines.push(`${mut}Pattern:${reset}       ${gold}\x1b[1m${parsedArgs.pattern || ''}${reset}`);
    lines.push(`${mut}Matches Found:${reset} ${succ}${parsed.matchCount || 0} occurrences${reset}`);
    if (parsed.output && parsed.matchCount > 0) {
      lines.push(`${rgb(...s.borderActive)}┄ Matches ┄${reset}`);
      parsed.output.split('\n').slice(0, 6).forEach((l) => lines.push(`  ${mut}${l}${reset}`));
      if (parsed.matchCount > 6) {
        lines.push(`  ${c.dim}... [${parsed.matchCount - 6} more matches]${reset}`);
      }
    }
  } else if (toolName === 'get_file_outline') {
    const pth = parsedArgs.path || parsed.path || '';
    lines.push(`${mut}File Outline:${reset}  ${p}\x1b[1m${pth}${reset} (${parsed.symbolCount || 0} symbols)`);
    if (parsed.symbols && parsed.symbols.length > 0) {
      parsed.symbols.slice(0, 5).forEach((sym) => {
        lines.push(`  ${gold}L${sym.line}${reset} [${sym.type}] ${sym.name}`);
      });
      if (parsed.symbols.length > 5) {
        lines.push(`  ${c.dim}... [${parsed.symbols.length - 5} more symbols]${reset}`);
      }
    }
  } else if (toolName.startsWith('browser_')) {
    if (parsedArgs.url) lines.push(`${mut}URL:${reset}           ${gold}${parsedArgs.url}${reset}`);
    if (parsedArgs.selector) lines.push(`${mut}Selector:${reset}      ${gold}${parsedArgs.selector}${reset}`);
    if (parsed.path) lines.push(`${mut}Screenshot:${reset}    ${succ}${parsed.path}${reset}`);
    if (parsed.message) lines.push(`${mut}Browser State:${reset} ${parsed.message}`);
  } else if (toolName.includes('daemon')) {
    if (parsedArgs.id) lines.push(`${mut}Daemon ID:${reset}     ${gold}${parsedArgs.id}${reset}`);
    if (parsedArgs.command) lines.push(`${mut}Command:${reset}       ${gold}${parsedArgs.command}${reset}`);
    if (parsed.port) lines.push(`${mut}Port:${reset}          ${succ}:${parsed.port}${reset} (ready: ${parsed.portReady})`);
    if (parsed.message) lines.push(`${mut}Status:${reset}        ${parsed.message}`);
  } else if (toolName === 'spawn_subagent') {
    lines.push(`${mut}Subagent Role:${reset} ${gold}${parsedArgs.role || 'coder'}${reset}`);
    lines.push(`${mut}Objective:${reset}     ${parsedArgs.objective || ''}`);
    if (parsed.verification_proof) lines.push(`${succ}Proof:${reset}          ${parsed.verification_proof}`);
    if (parsed.git_diff_summary) lines.push(`${mut}Diff:${reset}           ${parsed.git_diff_summary}`);
  } else if (toolName === 'write_file') {
    const pth = parsedArgs.path || parsed.path || '';
    lines.push(`${mut}Target File:${reset}  ${p}\x1b[1m${pth}${reset}`);
    lines.push(`${mut}Payload Size:${reset} ${gold}${parsed.bytes || 0} bytes written${reset}`);
    if (parsedArgs.content) {
      const lineCount = String(parsedArgs.content).split('\n').length;
      lines.push(`${mut}Line Count:${reset}   ${succ}${lineCount} lines${reset} committed`);
    }
    lines.push(`${succ}✔ Workspace mutated · Ready for verification pass${reset}`);
  } else if (toolName === 'read_file') {
    const pth = parsedArgs.path || '';
    lines.push(`${mut}Target File:${reset}  ${p}\x1b[1m${pth}${reset}`);
    const start = parsedArgs.start_line || 1;
    const count = parsedArgs.line_count || parsed.totalLines || 0;
    const total = parsed.totalLines || count;
    lines.push(`${mut}Line Scope:${reset}   Lines ${start}..${start + count - 1} of ${total}`);
    lines.push(`${mut}Context Cache:${reset} ${succ}Retained in working context memory. Discovery complete.${reset}`);
  } else {
    lines.push(`${mut}Parameters:${reset}   ${c.dim}${String(toolArgs).slice(0, 72)}${toolArgs.length > 72 ? '...' : ''}${reset}`);
    if (parsed.message || parsed.summary) {
      lines.push(`${mut}Summary:${reset}      ${parsed.message || parsed.summary}`);
    }
  }

  if (isCircuitBreaker && parsed.error) {
    lines.push(`${dang}\x1b[1mAnti-Loop Alert:${reset} ${parsed.error}`);
  }

  return renderCard({
    title: `🛠️  ${toolName.toUpperCase()}`,
    badge: statusBadge,
    lines,
    footer: `target: ${parsed.target || target || 'local'} · ${stageType.toLowerCase()}`,
    skin: s,
    width,
  });
}

/**
 * Stage 4: Closed-Loop Verification Proof Gate Card (Rule 13 Proof-of-Work Invariant)
 */
export function renderVerificationProofGate({
  gate,
  status = 'passed',
  evidence = '',
  command = '',
  exitCode = 0,
  skin,
  width = 84,
}) {
  const s = skin;
  const isPassed = status === 'passed' || exitCode === 0;
  const succ = rgb(...s.success);
  const dang = rgb(...s.danger);
  const gold = rgb(...s.gold);
  const mut = rgb(...s.muted);
  const reset = c.reset;
  const contentWidth = width - 8;

  const gateBadge = isPassed
    ? badge('✔ GATE PASSED (EXIT 0)', s.success, [15, 35, 25])
    : badge(`✘ GATE FAILED (EXIT ${exitCode || 1})`, s.danger, [45, 15, 20]);

  const lines = [
    `${isPassed ? succ : dang}\x1b[1m🧪 VERIFICATION PROOF GATE EVALUATION${reset}`,
    `${rgb(...s.border)}${'─'.repeat(contentWidth)}${reset}`,
    `${mut}Proof Gate:${reset}      ${gold}\x1b[1m${gate}${reset}`,
  ];

  if (command) {
    lines.push(`${mut}Verification Cmd:${reset} ${gold}$ ${command}${reset}`);
  }

  lines.push(`${mut}Execution Status:${reset} ${isPassed ? `${succ}✔ Passed with exit code 0` : `${dang}✘ Non-zero exit status (${exitCode})`}`);

  if (evidence) {
    lines.push(`${mut}Proof Evidence:${reset}`);
    const wrapped = wrapAnsi(evidence, contentWidth - 4);
    wrapped.slice(0, 4).forEach((wl) => {
      lines.push(`  ${succ}✔${reset} ${mut}${wl}${reset}`);
    });
  }

  return renderCard({
    title: '🛡️  PROOF-OF-WORK INVARIANT',
    badge: gateBadge,
    lines,
    footer: isPassed ? 'Rule 13 Verified · Exit Gate Satisfied' : 'Verification Incomplete · Retrying',
    skin: s,
    width,
  });
}

/**
 * Stage 5: Final Solution Synthesis & Proof-of-Work Deliverable
 */
export function renderAgentResponseStage({
  content,
  skin,
  width = 84,
  stats = {},
  activePlan = null,
  commandsRun = [],
  filesModified = [],
}) {
  const s = skin;
  const renderedMarkdownLines = renderTerminalMarkdown(content, { skin: s, width: width - 8 });

  const summaryPills = [];
  if (stats.rounds) summaryPills.push(`${stats.rounds} round${stats.rounds > 1 ? 's' : ''}`);
  if (commandsRun.length) summaryPills.push(`${commandsRun.length} commands run`);
  if (filesModified.length) summaryPills.push(`${filesModified.length} files modified`);
  if (activePlan && activePlan.isComplete()) summaryPills.push(`100% plan fulfilled`);

  return renderCard({
    title: '✨ AUTONOMOUS AGENT DELIVERABLE',
    badge: badge('OBJECTIVE FULFILLED', s.success, [15, 35, 25]),
    lines: renderedMarkdownLines,
    footer: summaryPills.length ? summaryPills.join(' · ') : 'Task lifecycle completed successfully',
    skin: s,
    width,
  });
}

/**
 * Clean, linear 1-2 line Execution Step rendering instead of a massive 20-line box card.
 */
export function renderExecutionStep({
  stepNumber,
  toolName,
  parsedArgs = {},
  toolArgs = '',
  parsed = {},
  isCircuitBreaker = false,
  skin,
  target,
}) {
  const s = skin;
  const reset = c.reset;
  const isOk = !isCircuitBreaker && parsed.ok !== false && (parsed.exitCode === undefined || parsed.exitCode === 0);
  const ms = parsed.durationMs ? `${parsed.durationMs}ms` : '';
  const clipPlain = (value, max) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1))}…`;
  };

  // Icon and tag determination
  let icon = '⚙️';
  let tag = 'EXEC';
  let desc = '';

  if (['read_file', 'grep', 'grep_search', 'get_file_outline'].includes(toolName)) {
    icon = '🔍';
    tag = toolName === 'read_file' ? 'READ' : toolName === 'get_file_outline' ? 'AST' : 'GREP';
    if (toolName === 'read_file') {
      const pth = parsedArgs.path || '';
      const start = parsedArgs.start_line || 1;
      const count = parsedArgs.line_count || parsed.totalLines || 0;
      desc = `${rgb(...s.primary)}${pth}${reset} ${c.dim}(L${start}..L${start + count - 1})${reset}`;
    } else if (toolName === 'grep_search') {
      desc = `"${rgb(...s.gold)}${parsedArgs.pattern || ''}${reset}" in ${c.dim}${parsedArgs.path || '.'}${reset} (${parsed.matchCount || 0} matches)`;
    } else if (toolName === 'get_file_outline') {
      desc = `${rgb(...s.primary)}${parsedArgs.path || ''}${reset} (${parsed.symbolCount || 0} symbols)`;
    }
  } else if (['write_file', 'replace_file_content', 'multi_replace_file_content'].includes(toolName)) {
    icon = '✂️';
    tag = toolName === 'write_file' ? 'WRITE' : 'PATCH';
    const pth = parsedArgs.path || parsed.path || '';
    let deltaInfo = '';
    if (parsed.byteDelta !== undefined) {
      const deltaStr = parsed.byteDelta >= 0 ? `+${parsed.byteDelta}` : `${parsed.byteDelta}`;
      deltaInfo = ` (${deltaStr} bytes)`;
    } else if (parsed.bytes !== undefined) {
      deltaInfo = ` (${parsed.bytes} bytes)`;
    }
    desc = `${rgb(...s.primary)}${pth}${reset}${rgb(...s.gold)}${deltaInfo}${reset}`;
  } else if (toolName === 'bash') {
    const cmd = (parsedArgs.command || parsedArgs.cmd || toolArgs || '').trim();
    const isTest = /\b(?:test|pytest|check|diff|tsc|lint|verify)\b/i.test(cmd);
    icon = isTest ? '🧪' : '⚙️';
    tag = isTest ? 'TEST' : 'BASH';
    desc = `${rgb(...s.gold)}$ ${cmd.slice(0, 65)}${cmd.length > 65 ? '...' : ''}${reset}`;
  } else if (toolName.startsWith('browser_') || parsedArgs.url || parsedArgs.targetUrl) {
    icon = '🌐';
    tag = toolName.startsWith('browser_') ? 'BROWSER' : 'HTTP';
    const action = toolName.startsWith('browser_') ? `${toolName.replace('browser_', '')} ` : '';
    desc = `${action}${clipPlain(parsedArgs.url || parsedArgs.targetUrl || parsedArgs.selector || '', 72)}`;
  } else if (toolName.includes('daemon')) {
    icon = '⚡';
    tag = 'DAEMON';
    desc = `${parsedArgs.id || parsedArgs.command || ''}`;
  } else if (toolName === 'spawn_subagent') {
    icon = '🤖';
    tag = 'AGENT';
    desc = `${parsedArgs.role || 'coder'}: ${parsedArgs.objective?.slice(0, 48) || ''}`;
  } else {
    desc = `${c.dim}${clipPlain(toolArgs, 60)}${reset}`;
  }

  // Status Badge
  const statusStr = isCircuitBreaker
    ? `${rgb(...s.danger)}\x1b[1mBREAKER TRIPPED${reset}`
    : parsed.exitCode !== undefined
    ? (isOk ? `${rgb(...s.success)}✔ EXIT 0${ms ? ` · ${ms}` : ''}${reset}` : `${rgb(...s.danger)}✘ EXIT ${parsed.exitCode}${ms ? ` · ${ms}` : ''}${reset}`)
    : (isOk ? `${rgb(...s.success)}✔ SUCCESS${ms ? ` · ${ms}` : ''}${reset}` : `${rgb(...s.danger)}✘ FAILED${reset}`);

  const stepLabel = stepNumber ? `${c.dim}[${stepNumber}]${reset} ` : '';
  const mainLine = `  ${icon} ${stepLabel}\x1b[1m${tag.padEnd(5)}\x1b[0m ${desc}  ${statusStr}`;

  const detailLines = [];
  if (toolName === 'bash' && parsed.stdout) {
    const sLines = parsed.stdout.split('\n').filter((l) => l.trim());
    if (sLines.length > 0) {
      const preview = sLines.slice(0, 4).map((l) => {
        const line = l.trim().slice(0, 76);
        let styled = `${rgb(...(s.muted || [148, 163, 184]))}${line}${reset}`;
        if (/^(?:✓|passed|pass|success|ok|done|compiled|ready)/i.test(line)) {
          styled = `${rgb(...s.success)}\x1b[1m${line}${reset}`;
        } else if (/^(?:fatal|error|failed|fail|err|rejected|exception)/i.test(line)) {
          styled = `${rgb(...s.danger)}\x1b[1m${line}${reset}`;
        } else if (/^(?:warn|warning|caution)/i.test(line)) {
          styled = `${rgb(...s.warning)}${line}${reset}`;
        } else if (/^\+\s/i.test(line)) {
          // Git diff addition: theme primary (cyan in AIUI)
          styled = `${rgb(...s.primary)}${line}${reset}`;
        } else if (/^-\s/i.test(line)) {
          // Git diff deletion: theme accent (coral in AIUI)
          styled = `${rgb(...s.accent)}${line}${reset}`;
        } else if (/^[MADRCU\?]{1,2}\s/i.test(line)) {
          // Git status shorthand
          const statChar = line.slice(0, 2);
          const rest = line.slice(2);
          const statColor = statChar.includes('M') ? s.gold : statChar.includes('A') ? s.success : statChar.includes('D') ? s.danger : s.secondary;
          styled = `${rgb(...statColor)}\x1b[1m${statChar}${reset}${rgb(...s.primary)}${rest}${reset}`;
        }
        return `     ${rgb(...s.secondary)}└─${reset} ${styled}`;
      }).join('\n');
      detailLines.push(preview);
    }
  } else if (!isOk && parsed.stderr) {
    const errLine = parsed.stderr.split('\n').find((l) => l.trim()) || '';
    if (errLine) {
      detailLines.push(`     ${rgb(...s.danger)}└─ ${errLine.trim().slice(0, 75)}${reset}`);
    }
  } else if (isCircuitBreaker && parsed.error) {
    const errLine = parsed.error.split('\n')[0] || '';
    detailLines.push(`     ${rgb(...s.danger)}└─ 🛑 ${errLine.slice(0, 75)}${reset}`);
  }

  return [mainLine, ...detailLines].join('\n');
}

/**
 * Celebrates a milestone completion with a clean, high-signal divider.
 */
export function renderMilestoneTransition({ completedStep, nextStep, skin, width = 78 }) {
  const s = skin;
  const bColor = rgb(...s.border);
  const succ = rgb(...s.success);
  const gold = rgb(...s.gold);
  const reset = c.reset;
  const lineBar = bColor + '─'.repeat(Math.min(width, 74)) + reset;

  const lines = [
    '',
    lineBar,
    `  ${succ}\x1b[1m✔ MILESTONE COMPLETE [${completedStep.id}]: ${completedStep.title}${reset}`,
  ];

  if (completedStep.verificationGate) {
    lines.push(`    ${c.dim}Gate Verified: ${completedStep.verificationGate}${reset}`);
  }
  if (completedStep.evidence) {
    lines.push(`    ${succ}Evidence: ${completedStep.evidence}${reset}`);
  }

  if (nextStep) {
    lines.push(`  ${gold}▶ PROCEEDING TO [${nextStep.id}]: ${nextStep.title}${reset} ${c.dim}(Phase: ${nextStep.phase})${reset}`);
  } else {
    lines.push(`  ${succ}\x1b[1m🎉 ALL PLAN MILESTONES COMPLETED${reset}`);
  }

  lines.push(lineBar, '');
  return lines.join('\n');
}

/**
 * Clean Mission Accomplished recap card.
 */
export function renderMissionSummary({
  plan,
  filesModified = [],
  commandsRun = [],
  totalRounds = 1,
  durationMs = 0,
  skin,
  width = 78,
}) {
  const s = skin;
  const succ = rgb(...s.success);
  const gold = rgb(...s.gold);
  const mut = rgb(...s.muted);
  const reset = c.reset;
  const lines = [];

  const completed = plan ? plan.getCompletedCount() : 0;
  const total = plan ? plan.steps.length : 0;

  lines.push(`${succ}\x1b[1m✔ Mission Accomplished${reset} · All objectives satisfied empirically`);
  lines.push(`${rgb(...s.borderActive)}${'┄'.repeat(Math.max(10, width - 6))}${reset}`);

  if (plan && plan.steps.length > 0) {
    lines.push(`${mut}Verified Milestones:${reset}`);
    plan.steps.forEach((step) => {
      lines.push(`  ${succ}✔${reset} [${step.id}/${total}] ${step.title} ${c.dim}(Gate: ${step.verificationGate || 'exit 0'})${reset}`);
    });
    lines.push('');
  }

  if (filesModified.length > 0) {
    lines.push(`${mut}Workspace Mutations:${reset} ${gold}${filesModified.length} file(s) updated${reset}`);
    filesModified.slice(0, 4).forEach((f) => {
      lines.push(`  ${c.dim}• ${f}${reset}`);
    });
    if (filesModified.length > 4) {
      lines.push(`  ${c.dim}• ... and ${filesModified.length - 4} more files${reset}`);
    }
    lines.push('');
  }

  const durationStr = durationMs > 0 ? `${(durationMs / 1000).toFixed(1)}s` : '';
  const telemetry = [
    `${totalRounds} round(s)`,
    `${commandsRun.length} command(s)`,
    durationStr,
  ].filter(Boolean).join(' · ');

  return renderCard({
    title: '🏁 MISSION COMPLETE',
    badge: badge('✔ VERIFIED PROOF', s.success, [15, 35, 25]),
    lines,
    footer: telemetry,
    skin: s,
    width,
  });
}




