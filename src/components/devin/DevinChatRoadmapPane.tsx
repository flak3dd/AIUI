import React, { useState, useRef, useEffect } from 'react';
import type { UiMessage, UiFollowUp } from '../../types/ui';
import type { BashExecResult, ExecutionTarget } from '../../lib/bashShell';
import { resolveVerificationGateCommand } from '../../lib/goalVerification';

export interface MilestoneItem {
  id: number;
  phase: string;
  title: string;
  targetFiles?: string[];
  status: 'pending' | 'active' | 'completed' | 'failed' | 'skipped';
  verificationGate?: string;
  evidence?: string;
}

export interface DevinChatRoadmapPaneProps {
  messages: UiMessage[];
  busy: boolean;
  onSend: (text: string) => Promise<void>;
  onStop: () => void;
  milestones?: MilestoneItem[];
  deliberation?: {
    intent?: string;
    decomposition?: string[];
    risks?: string[];
    verificationCriteria?: string[];
  } | null;
  onUpdateMilestones?: (milestones: MilestoneItem[]) => void;
  onRunCommand?: (cmd: string, target?: ExecutionTarget) => Promise<any>;
  terminalLogs?: BashExecResult[];
  onClearTerminalLogs?: () => void;
  target?: ExecutionTarget;
  executingCmd?: boolean;
}

export const DevinChatRoadmapPane: React.FC<DevinChatRoadmapPaneProps> = ({
  messages,
  busy,
  onSend,
  onStop,
  milestones: milestoneProp = [],
  deliberation = null,
  onUpdateMilestones,
  onRunCommand,
  target = 'dgx_spark',
}) => {
  // Redesigned: Primary default is dedicated agent chat window
  const [activeTab, setActiveTab] = useState<'chat' | 'roadmap'>('chat');
  const [liveMilestones, setLiveMilestones] = useState<MilestoneItem[] | null>(null);
  useEffect(() => {
    let stop = false
    const pull = () => {
      fetch('/api/agent-runs/latest')
        .then((res) => res.json())
        .then((json) => {
          const rows = json?.record?.milestones
          if (stop || !Array.isArray(rows) || rows.length === 0) return
          setLiveMilestones(rows.map((m: { title: string; status: string; verificationGate?: string }, i: number) => ({
            id: i + 1,
            phase: 'Run',
            title: m.title,
            status: m.status === 'verified' ? 'completed' : (m.status as MilestoneItem['status']),
            verificationGate: m.verificationGate,
          })))
        })
        .catch(() => {})
    }
    pull()
    const timer = window.setInterval(pull, 4000)
    return () => { stop = true; window.clearInterval(timer) }
  }, [busy]);
  const milestones = liveMilestones && liveMilestones.length > 0 ? liveMilestones : milestoneProp;
  const [chatInput, setChatInput] = useState('');
  const [copiedCodeKey, setCopiedCodeKey] = useState<string | null>(null);

  // Roadmap creation state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPhase, setNewPhase] = useState('Implementation');
  const [newGate, setNewGate] = useState('test -f package.json && npm test || git status --short');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (activeTab === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, busy, activeTab]);

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setChatInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleChatSubmit();
    }
  };

  const handleChatSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || busy) return;
    const text = chatInput.trim();
    setChatInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    await onSend(text);
  };

  const handleQuickPrompt = (prompt: string) => {
    setChatInput(prompt);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleCopyCode = (key: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCodeKey(key);
    setTimeout(() => setCopiedCodeKey(null), 1600);
  };

  const handleRunCodeInTerminal = async (code: string) => {
    if (onRunCommand) {
      await onRunCommand(code.trim(), target);
    }
  };

  const completedCount = milestones.filter((m) => m.status === 'completed').length;
  const progressPct = milestones.length > 0 ? Math.round((completedCount / milestones.length) * 100) : 0;
  const activeMilestone = milestones.find((m) => m.status === 'active') || milestones.find((m) => m.status === 'pending');

  const handleToggleStatus = (id: number) => {
    if (!onUpdateMilestones) return;
    const nextList = milestones.map((m) => {
      if (m.id !== id) return m;
      const nextStatus: MilestoneItem['status'] =
        m.status === 'pending'
          ? 'active'
          : m.status === 'active'
          ? 'completed'
          : m.status === 'completed'
          ? 'pending'
          : 'completed';
      return { ...m, status: nextStatus };
    });
    onUpdateMilestones(nextList);
  };

  const handleAddMilestoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !onUpdateMilestones) return;
    const newItem: MilestoneItem = {
      id: milestones.length + 1,
      phase: newPhase,
      title: newTitle.trim(),
      status: 'pending',
      verificationGate: newGate.trim() || 'git status --short 2>/dev/null || ls -lah',
    };
    onUpdateMilestones([...milestones, newItem]);
    setNewTitle('');
    setShowAddModal(false);
  };

  const handleRunGate = (m: MilestoneItem) => {
    const gateCmd = resolveVerificationGateCommand(m.verificationGate || '', m.phase, m.targetFiles);
    if (onRunCommand) {
      void onRunCommand(gateCmd, target);
    } else {
      void onSend(`Run verification gate for Step ${m.id} (${m.phase}): ${gateCmd}`);
    }
  };

  const handleSteerToStep = (m: MilestoneItem) => {
    setActiveTab('chat');
    const cleanGate = resolveVerificationGateCommand(m.verificationGate || '', m.phase, m.targetFiles);
    const steerPrompt = `Focus on Step ${m.id} (${m.phase}): ${m.title}. Ensure verification gate "${cleanGate}" passes.`;
    setChatInput(steerPrompt);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  // Helper to parse code blocks out of assistant text
  const renderMessageContent = (content: string, msgId: string) => {
    const codeBlockRegex = /```([a-zA-Z0-9_\-#+]*)\n([\s\S]*?)```/g;
    const parts: Array<{ type: 'text' | 'code'; content: string; lang?: string }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // Filter out <think> tags from main text (rendered in accordion above)
    const cleanText = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    while ((match = codeBlockRegex.exec(cleanText)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: cleanText.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'code', lang: match[1] || 'bash', content: match[2] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < cleanText.length) {
      parts.push({ type: 'text', content: cleanText.slice(lastIndex) });
    }

    if (parts.length === 0) {
      return <div className="devin-msg-prose">{cleanText}</div>;
    }

    return (
      <div className="devin-msg-parsed">
        {parts.map((p, idx) => {
          if (p.type === 'text') {
            return (
              <div key={idx} className="devin-msg-prose" style={{ whiteSpace: 'pre-wrap' }}>
                {p.content}
              </div>
            );
          }
          const blockKey = `${msgId}_code_${idx}`;
          const isCopied = copiedCodeKey === blockKey;
          return (
            <div key={idx} className="devin-chat-code-block">
              <div className="chat-code-header">
                <span className="code-lang-tag">{p.lang || 'code'}</span>
                <div className="code-actions">
                  <button
                    type="button"
                    className="btn-code-action"
                    onClick={() => handleCopyCode(blockKey, p.content)}
                    title="Copy code"
                  >
                    {isCopied ? '✔ Copied' : '📋 Copy'}
                  </button>
                  {onRunCommand && (
                    <button
                      type="button"
                      className="btn-code-action btn-code-run"
                      onClick={() => void handleRunCodeInTerminal(p.content)}
                      title="Run in Live Terminal (Pane 2)"
                    >
                      ▶ Run in Term
                    </button>
                  )}
                </div>
              </div>
              <pre className="chat-code-pre">
                <code>{p.content}</code>
              </pre>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="devin-pane devin-pane-agent-chat">
      {/* Pane Header: Dedicated Agent Chat Window */}
      <div className="devin-pane-header">
        <div className="devin-pane-title">
          <span className={`devin-pane-dot ${busy ? 'busy-dot' : 'chat-dot'}`} />
          <span className="devin-pane-heading">
            {activeTab === 'chat' ? '1. AGENT COGNITIVE CHAT' : '1. SWE ROADMAP & GATES'}
          </span>
          <span className="agent-role-badge">AIUI</span>

          {busy ? (
            <span className="agent-status-pill busy">
              <span className="agent-pulse-dot" />
              <span>THINKING &amp; EXECUTING</span>
            </span>
          ) : (
            <span className="agent-status-pill ready">
              <span className="agent-dot-green" />
              <span>READY</span>
            </span>
          )}

          {activeTab === 'roadmap' && milestones.length > 0 && (
            <span className="devin-milestone-pill" onClick={() => setActiveTab('roadmap')}>
              <span className={`pill-dot ${progressPct === 100 ? 'done' : busy ? 'busy' : ''}`} />
              <span className="pill-text">{completedCount}/{milestones.length}</span>
              <span className="pill-pct">({progressPct}%)</span>
            </span>
          )}
        </div>

        {/* Tab Controls: Chat vs Roadmap */}
        <div className="devin-pane-tabs">
          <button
            type="button"
            className={`devin-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
            title="Dedicated Agent Chat Stream & Cognitive Deliberation"
          >
            💬 Chat Stream ({messages.length})
          </button>
          <button
            type="button"
            className={`devin-tab-btn ${activeTab === 'roadmap' ? 'active' : ''}`}
            onClick={() => setActiveTab('roadmap')}
            title="SWE Execution Roadmap & Proof Gates"
          >
            📋 SWE Roadmap ({completedCount}/{milestones.length})
          </button>
        </div>
      </div>

      {/* Mini Progress Bar Under Header if Milestones Active */}
      {milestones.length > 0 && (
        <div className="devin-roadmap-progress-bar">
          <div className="devin-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      )}

      {/* Pane Body */}
      <div className="devin-pane-body devin-chat-pane-body">
        {activeTab === 'chat' ? (
          /* =========================================================================
             DEDICATED FULL AGENT CHAT STREAM
             ========================================================================= */
          <div className="devin-full-chat-stream">
            {messages.length === 0 ? (
              <div className="devin-chat-welcome-hero">
                <div className="welcome-hero-badge">
                  <span className="hero-pulse" />
                  <span>AUTONOMOUS COGNITIVE SWE ENGINE</span>
                </div>
                <h2 className="welcome-hero-title">AIUI READY</h2>
                <p className="welcome-hero-desc">
                  Issue engineering objectives, bug fix requests, full test suite verification, or architecture refactoring.
                  The agent plans surgically, edits code without regressions, and runs proof-of-work test assertions.
                </p>

                <div className="welcome-capabilities-grid">
                  <button
                    type="button"
                    className="capability-card"
                    onClick={() => handleQuickPrompt('Run full deterministic test suite and verify proof-of-work exit code 0')}
                  >
                    <span className="card-icon">🧪</span>
                    <div className="card-text">
                      <div className="card-title">Run Verification Suite</div>
                      <div className="card-sub">Execute test assertions and audit invariants</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="capability-card"
                    onClick={() => handleQuickPrompt('Audit repository architecture, locate symbols, and examine invariants')}
                  >
                    <span className="card-icon">🔍</span>
                    <div className="card-text">
                      <div className="card-title">Repository Recon</div>
                      <div className="card-sub">Map symbols, types, and module dependencies</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="capability-card"
                    onClick={() => handleQuickPrompt('Diagnose defects, formulate surgical patches, and execute fixes')}
                  >
                    <span className="card-icon">🛠️</span>
                    <div className="card-text">
                      <div className="card-title">Surgical Code Fix</div>
                      <div className="card-sub">Exact hunk replacement with zero line drift</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="capability-card"
                    onClick={() => handleQuickPrompt('Launch Playwright headless browser E2E test on active web environment')}
                  >
                    <span className="card-icon">🌐</span>
                    <div className="card-text">
                      <div className="card-title">Browser E2E Automation</div>
                      <div className="card-sub">Headless Chromium test verification in Pane 4</div>
                    </div>
                  </button>
                </div>
              </div>
            ) : (
              (() => {
                const runs: UiMessage[][] = [];
                for (const m of messages) {
                  const last = runs[runs.length - 1];
                  if (last && last[0].role === m.role) last.push(m);
                  else runs.push([m]);
                }
                return runs.map((run) => (
                  <div key={`run_${run[0].id}`} className={`devin-chat-run role-${run[0].role}`}>
                    {run.map((m, i) => {
                      const isUser = m.role === 'user';
                      const isTool = m.role === 'tool';
                      const continues = i > 0;
                      const hasThink = m.content && m.content.includes('<think>');
                      const thinkMatch = hasThink ? m.content.match(/<think>([\s\S]*?)<\/think>/i) : null;
                      const reasoningText = m.reasoning || (thinkMatch ? thinkMatch[1].trim() : '');

                      return (
                        <div
                          key={m.id}
                          className={`devin-chat-card role-${m.role}${continues ? ' continues' : ''}`}
                        >
                          {!continues && (
                            <div className="devin-card-header">
                              <div className="card-sender">
                                <span className="sender-name">
                                  {isUser ? 'You' : isTool ? `Tool: ${m.name || 'system'}` : 'AIUI'}
                                </span>
                              </div>
                              <span className="card-time">
                                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          )}

                          {reasoningText && (
                            <details className="devin-deliberation-box">
                              <summary className="deliberation-summary">
                                <span>Reasoning</span>
                              </summary>
                              <pre className="deliberation-content">{reasoningText}</pre>
                            </details>
                          )}

                          {m.execResult && (
                            <div className="devin-inline-exec-card">
                              <div className="exec-meta">
                                <code className="exec-cmd">$ {m.execResult.command}</code>
                                <span className={`exec-exit-badge ${m.execResult.exitCode === 0 ? 'exit-zero' : 'exit-fail'}`}>
                                  exit {m.execResult.exitCode}
                                </span>
                                <span className="exec-duration">{m.execResult.durationMs}ms</span>
                              </div>
                              {(m.execResult.stdout || m.execResult.stderr) && (
                                <pre className="exec-output-pre">
                                  {m.execResult.stdout || m.execResult.stderr}
                                </pre>
                              )}
                            </div>
                          )}

                          {m.actionsOverview && (
                            <div className="devin-actions-pill">
                              <span>{m.actionsOverview}</span>
                            </div>
                          )}

                          <div className="devin-card-body">
                            {renderMessageContent(m.content, m.id)}
                          </div>

                          {m.followUps && m.followUps.length > 0 && (
                            <div className="devin-followups-row">
                              {m.followUps.map((f: UiFollowUp) => (
                                <button
                                  key={f.id}
                                  type="button"
                                  className="devin-followup-pill"
                                  onClick={() => handleQuickPrompt(f.prompt || f.label)}
                                >
                                  {f.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ));
              })()
            )}

            {/* In-Flight Thinking Indicator */}
            {busy && (
              <div className="devin-chat-run role-assistant">
                <div className="devin-chat-card role-assistant thinking-card">
                  <div className="devin-card-header">
                    <div className="card-sender">
                      <span className="sender-name">AIUI</span>
                    </div>
                    <span className="agent-thinking-tag">Working…</span>
                  </div>
                  <div className="thinking-body">
                    <div className="thinking-text-block">
                      <div className="thinking-headline">Planning next steps…</div>
                      <div className="thinking-sub">Reading workspace context</div>
                    </div>
                    <div className="thinking-dots">
                      <span className="dot dot-1" />
                      <span className="dot dot-2" />
                      <span className="dot dot-3" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        ) : (
          /* =========================================================================
             TAB 2: SWE EXECUTION ROADMAP & PROOF GATES
             ========================================================================= */
          <div className="devin-roadmap-view">
            {/* Overview Banner Card */}
            <div className="devin-roadmap-overview-card">
              <div className="overview-header">
                <div className="overview-metric">
                  <span className="metric-pct">{progressPct}%</span>
                  <div className="metric-details">
                    <span className="metric-title">SWE ROADMAP PROGRESS</span>
                    <span className="metric-sub">
                      {completedCount} of {milestones.length} proof milestones verified
                    </span>
                  </div>
                </div>

                <div className="overview-actions">
                  <button
                    type="button"
                    className="devin-btn-sm btn-add-step"
                    onClick={() => setShowAddModal(!showAddModal)}
                  >
                    {showAddModal ? '✕ Cancel' : '+ Add Step'}
                  </button>
                </div>
              </div>

              {activeMilestone && (
                <div className="overview-active-step">
                  <span className="active-tag">ACTIVE STEP</span>
                  <span className="active-title">
                    Step {activeMilestone.id} ({activeMilestone.phase}): {activeMilestone.title}
                  </span>
                </div>
              )}
            </div>

            {/* Inline Add Milestone Form */}
            {showAddModal && (
              <form className="devin-add-milestone-form" onSubmit={handleAddMilestoneSubmit}>
                <div className="form-row">
                  <input
                    type="text"
                    className="add-milestone-input"
                    placeholder="Milestone objective (e.g. 'Build auth middleware test')"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    autoFocus
                  />
                  <select
                    className="add-milestone-select"
                    value={newPhase}
                    onChange={(e) => setNewPhase(e.target.value)}
                  >
                    <option value="Recon">Recon</option>
                    <option value="Design">Design</option>
                    <option value="Implementation">Implementation</option>
                    <option value="Verification">Verification</option>
                    <option value="Audit">Audit</option>
                  </select>
                </div>
                <div className="form-row">
                  <input
                    type="text"
                    className="add-milestone-input gate-input"
                    placeholder="Verification Gate (e.g. 'npm test', 'git diff --stat')"
                    value={newGate}
                    onChange={(e) => setNewGate(e.target.value)}
                  />
                  <button type="submit" className="devin-btn-sm btn-confirm" disabled={!newTitle.trim()}>
                    Add to Roadmap
                  </button>
                </div>
              </form>
            )}

            {/* Cognitive Deliberation Cards */}
            {deliberation?.intent && (
              <div className="devin-card devin-intent-card">
                <div className="devin-card-label">🎯 CORE USER INTENT</div>
                <div className="devin-card-content">{deliberation.intent}</div>
              </div>
            )}

            {deliberation?.risks && deliberation.risks.length > 0 && (
              <div className="devin-card devin-risks-card">
                <div className="devin-card-label">⚠️ IDENTIFIED RISKS &amp; INVARIANT HAZARDS</div>
                <ul className="devin-card-list">
                  {deliberation.risks.map((risk, idx) => (
                    <li key={idx}>{risk}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Milestone List */}
            <div className="devin-milestone-list">
              <div className="devin-section-label">
                <span>EXECUTION MILESTONES &amp; PROOF GATES</span>
                <span className="section-count">{milestones.length} STEPS</span>
              </div>

              {milestones.length === 0 ? (
                <div className="devin-empty-state">
                  No milestones active. Issue an engineering objective in the Chat tab or click "+ Add Step" above.
                </div>
              ) : (
                milestones.map((m) => {
                  const isDone = m.status === 'completed';
                  const isActive = m.status === 'active';
                  const isFailed = m.status === 'failed';

                  return (
                    <div
                      key={m.id}
                      className={`devin-milestone-row status-${m.status}`}
                    >
                      <button
                        type="button"
                        className="milestone-status-toggle"
                        onClick={() => handleToggleStatus(m.id)}
                        title="Click to toggle milestone status"
                      >
                        {isDone && <span className="icon-done">✔</span>}
                        {isActive && <span className="icon-active">▶</span>}
                        {isFailed && <span className="icon-fail">✘</span>}
                        {!isDone && !isActive && !isFailed && <span className="icon-pending">○</span>}
                      </button>

                      <div className="milestone-details">
                        <div className="milestone-header-line">
                          <span className={`milestone-phase-tag phase-${m.phase.toLowerCase()}`}>
                            {m.phase}
                          </span>
                          <span className="milestone-id">Step {m.id}</span>
                          <span className="milestone-title-text">{m.title}</span>
                        </div>

                        {m.targetFiles && m.targetFiles.length > 0 && (
                          <div className="milestone-files">
                            <span className="meta-icon">📁</span>
                            {m.targetFiles.map((f, i) => (
                              <code key={i} className="milestone-file-chip">{f}</code>
                            ))}
                          </div>
                        )}

                        {m.verificationGate && (
                          <div className="milestone-gate-row">
                            <span className="gate-badge">
                              <span className="gate-icon">🧪</span>
                              <code>{m.verificationGate}</code>
                            </span>
                            {onRunCommand && (
                              <button
                                type="button"
                                className="btn-run-gate"
                                onClick={() => handleRunGate(m)}
                                title={`Execute gate in active target: ${resolveVerificationGateCommand(m.verificationGate, m.phase, m.targetFiles)}`}
                              >
                                ▶ Test Gate
                              </button>
                            )}
                          </div>
                        )}

                        {m.evidence && (
                          <div className="milestone-evidence">
                            <span className="evidence-icon">✔ Verified:</span> {m.evidence}
                          </div>
                        )}

                        <div className="milestone-actions-bar">
                          <button
                            type="button"
                            className="btn-milestone-steer"
                            onClick={() => handleSteerToStep(m)}
                            title="Switch to chat and steer agent towards completing this step"
                          >
                            ⚡ Steer Agent to this Step
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pane Footer: Dedicated Multi-Line Agent Chat Composer */}
      <footer className="devin-pane-footer devin-agent-chat-footer">
        {/* Quick Action Chips */}
        <div className="devin-prompt-chips">
          <button
            type="button"
            className="devin-prompt-chip"
            onClick={() => handleQuickPrompt('Run deterministic test assertions and verify exit code 0')}
          >
            ⚡ Run full tests
          </button>
          <button
            type="button"
            className="devin-prompt-chip"
            onClick={() => handleQuickPrompt('Audit git diff and verify working tree cleanliness')}
          >
            🔍 Audit git diff
          </button>
          <button
            type="button"
            className="devin-prompt-chip"
            onClick={() => handleQuickPrompt('Diagnose failing assertions and apply surgical bug fix')}
          >
            🛠️ Surgical fix
          </button>
          <button
            type="button"
            className="devin-prompt-chip"
            onClick={() => handleQuickPrompt('Synthesize structured SWE roadmap for active objective')}
          >
            📋 Generate roadmap
          </button>
          <button
            type="button"
            className="devin-prompt-chip"
            onClick={() => handleQuickPrompt('Run Playwright headless browser E2E test')}
          >
            🌐 Browser QA
          </button>
        </div>

        {/* Composer Form with Auto-Growing Textarea */}
        <form className="devin-chat-composer-form" onSubmit={handleChatSubmit}>
          <div className="composer-input-wrapper">
            <textarea
              ref={textareaRef}
              rows={1}
              className="devin-chat-textarea"
              placeholder="Give autonomous SWE agent an objective or steer execution... (Enter to send, Shift+Enter for newline)"
              value={chatInput}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className="composer-actions">
            {busy ? (
              <button
                type="button"
                className="devin-btn devin-btn-stop"
                onClick={onStop}
                title="Halt current agent turn immediately"
              >
                🛑 Stop Agent
              </button>
            ) : (
              <button
                type="submit"
                className="devin-btn devin-btn-send"
                disabled={!chatInput.trim()}
                title="Send objective to agent (Enter ↵)"
              >
                Send ↵
              </button>
            )}
          </div>
        </form>
      </footer>
    </div>
  );
};

export default DevinChatRoadmapPane;
