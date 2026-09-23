import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { UiMessage } from '../../types/ui';
import type { BashExecResult, ExecutionTarget } from '../../lib/bashShell';
import { closeBrowserSession, MAX_BROWSER_WINDOWS } from '../../lib/browserRuns';
import { DevinChatRoadmapPane, type MilestoneItem } from './DevinChatRoadmapPane';
import { DevinTerminalPane, type DaemonInfo } from './DevinTerminalPane';
import { DevinDiffEditorPane, type DiffFileEntry } from './DevinDiffEditorPane';
import { DevinBrowserPreviewPane, type ConsoleLogEntry } from './DevinBrowserPreviewPane';

export type DevinLayoutMode = 'quad';
export type WorkbenchTab = 'terminal' | 'diff' | 'browser' | 'roadmap' | 'daemons';

export type WorkBrowserWindowMeta = {
  id: string;
  label: string;
  sessionId?: string;
  url?: string;
};

export interface DevinWorkspaceViewProps {
  messages: UiMessage[];
  busy: boolean;
  onSend: (text: string) => Promise<void>;
  onStop: () => void;
  terminalLogs: BashExecResult[];
  onClearTerminalLogs?: () => void;
  onRunTerminalCommand?: (cmd: string, target?: ExecutionTarget) => Promise<BashExecResult>;
  executingCmd?: boolean;
  bashTarget?: ExecutionTarget;
  milestones?: MilestoneItem[];
  deliberation?: {
    intent?: string;
    decomposition?: string[];
    risks?: string[];
    verificationCriteria?: string[];
  } | null;
  modifiedFiles?: DiffFileEntry[];
  rawGitDiff?: string;
  previewUrl?: string;
  screenshots?: string[];
  consoleLogs?: ConsoleLogEntry[];
  daemons?: DaemonInfo[];
  onStopDaemon?: (id: string) => void;
  onSwitchToStudio: () => void;
  activeWorkspaceEnvId?: string;
  onWorkChrome?: (chrome: {
    audit: () => void;
    auditing: boolean;
    env: string;
    milestones: string;
    agentBusy: boolean;
    terminalVisible: boolean;
    toggleTerminal: () => void;
    newBrowser: () => void;
    attachBrowserSession?: (meta: { sessionId?: string; url?: string }) => void;
    browserCount: number;
    browserCap: number;
    browserWindows: WorkBrowserWindowMeta[];
    browserCapHit: boolean;
  } | null) => void;
}

// Backwards-compatible alias
export type DevinQuadPaneViewProps = DevinWorkspaceViewProps;

type BrowserWindowState = WorkBrowserWindowMeta;

function createBrowserWindow(ordinal: number): BrowserWindowState {
  return { id: `bw-${Date.now()}-${ordinal}`, label: `Browser ${ordinal}` };
}

export const DevinQuadPaneView: React.FC<DevinWorkspaceViewProps> = ({
  messages,
  busy,
  onSend,
  onStop,
  terminalLogs,
  onClearTerminalLogs,
  onRunTerminalCommand,
  executingCmd = false,
  bashTarget = 'local_mac',
  milestones = [],
  deliberation = null,
  modifiedFiles = [],
  rawGitDiff = '',
  previewUrl = '',
  screenshots = [],
  consoleLogs = [],
  daemons = [],
  onStopDaemon,
  onSwitchToStudio: _onSwitchToStudio,
  activeWorkspaceEnvId = 'workspace1',
  onWorkChrome,
}) => {
  // Live PTY stream is hidden until chosen from the Work menu (session UI state).
  const [terminalVisible, setTerminalVisible] = useState(false);

  const [browserWindows, setBrowserWindows] = useState<BrowserWindowState[]>(() => [createBrowserWindow(1)]);
  const [browserCapHit, setBrowserCapHit] = useState(false);

  // Internal Git diff state populated from automatic git audit
  const [localDiffText, setLocalDiffText] = useState<string>(rawGitDiff);
  const [localDiffFiles, setLocalDiffFiles] = useState<DiffFileEntry[]>(modifiedFiles);
  const [isAuditingGit, setIsAuditingGit] = useState<boolean>(false);
  const [gitAvailable, setGitAvailable] = useState<boolean>(true);
  const isAuditingRef = useRef<boolean>(false);
  const initialAuditAttemptedRef = useRef<boolean>(false);

  const parseGitDiff = useCallback((diffText: string): DiffFileEntry[] => {
    if (!diffText || !diffText.trim()) return [];
    const files: DiffFileEntry[] = [];
    const chunks = diffText.split(/^diff --git /m).filter(Boolean);

    for (const chunk of chunks) {
      const match = chunk.match(/^[ab]\/(.+?)\s+[ab]\/(.+?)$/m);
      const filePath = match ? match[2] : 'unknown';
      let additions = 0;
      let deletions = 0;

      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) additions++;
        else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
      }

      files.push({
        path: filePath,
        diff: `diff --git ${chunk}`,
        additions,
        deletions,
      });
    }

    return files;
  }, []);

  const runGitDiffAudit = useCallback(async () => {
    if (!onRunTerminalCommand || isAuditingRef.current) return;
    isAuditingRef.current = true;
    setIsAuditingGit(true);
    try {
      const res = await onRunTerminalCommand('git status --short 2>&1', bashTarget);
      if (res && res.stdout) {
        if (res.stdout.includes('not a git repository') || res.exitCode === 128) {
          setGitAvailable(false);
          setLocalDiffText('(Active environment is not a git repository)');
          return;
        }

        setGitAvailable(true);
        const fullDiffRes = await onRunTerminalCommand('git diff -n 500', bashTarget);
        const fullText = fullDiffRes?.stdout || res.stdout;
        setLocalDiffText(fullText);
        const parsed = parseGitDiff(fullText);
        if (parsed.length > 0) {
          setLocalDiffFiles(parsed);
        } else if (res.stdout.trim()) {
          const statusLines = res.stdout.split('\n').filter((l) => l.trim() && !l.includes('fatal:'));
          const entries: DiffFileEntry[] = statusLines.map((line) => {
            const trimmed = line.trim();
            const filePath = trimmed.slice(2).trim();
            return {
              path: filePath,
              diff: `Status: ${trimmed}\n(Run 'git diff' to inspect full unified hunk)`,
              additions: 1,
              deletions: 0,
            };
          });
          setLocalDiffFiles(entries);
        }
      }
    } catch {
      // Ignored: fallback to props
    } finally {
      isAuditingRef.current = false;
      setIsAuditingGit(false);
    }
  }, [onRunTerminalCommand, bashTarget, parseGitDiff]);

  const [isInitializingGit, setIsInitializingGit] = useState<boolean>(false);

  const handleInitGitRepo = useCallback(async () => {
    if (!onRunTerminalCommand || isInitializingGit) return;
    setIsInitializingGit(true);
    try {
      const res = await onRunTerminalCommand('git init && git status', bashTarget);
      if (res && (res.exitCode === 0 || !res.stderr?.includes('fatal:'))) {
        setGitAvailable(true);
        setTimeout(() => {
          void runGitDiffAudit();
        }, 150);
      }
    } catch (err) {
      console.error('Failed to initialize Git repository:', err);
    } finally {
      setIsInitializingGit(false);
    }
  }, [onRunTerminalCommand, bashTarget, isInitializingGit, runGitDiffAudit]);

  useEffect(() => {
    if (initialAuditAttemptedRef.current) return;
    initialAuditAttemptedRef.current = true;
    if (modifiedFiles.length === 0 && !rawGitDiff && onRunTerminalCommand) {
      void runGitDiffAudit();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (modifiedFiles.length > 0) setLocalDiffFiles(modifiedFiles);
  }, [modifiedFiles]);

  useEffect(() => {
    if (rawGitDiff) setLocalDiffText(rawGitDiff);
  }, [rawGitDiff]);

  const [userMilestones, setUserMilestones] = useState<MilestoneItem[] | null>(null);

  const computedMilestones = useMemo<MilestoneItem[]>(() => {
    if (userMilestones && userMilestones.length > 0) return userMilestones;
    if (milestones && milestones.length > 0) return milestones;

    const extracted: MilestoneItem[] = [];
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.content) {
        const lines = msg.content.split('\n');
        for (const line of lines) {
          const stepMatch = line.match(/(?:^|\s)(?:Step|Milestone|\d+\.)\s*(\d+)?:?\s*(.+)/i);
          if (stepMatch && line.length < 120 && !line.includes('http') && !line.includes('.tsx') && !line.includes('.ts')) {
            const isDone = line.includes('✔') || line.includes('[x]') || line.includes('DONE');
            extracted.push({
              id: extracted.length + 1,
              phase: extracted.length === 0 ? 'Recon' : extracted.length === 1 ? 'Design' : extracted.length === 2 ? 'Implementation' : 'Verification',
              title: stepMatch[2].replace(/^[*\s]+/, '').trim(),
              status: isDone ? 'completed' : 'active',
              verificationGate: 'test -f package.json && npm test || node --test 2>/dev/null || git status --short',
            });
          }
        }
      }
    }

    if (extracted.length >= 2) return extracted.slice(0, 6);

    const hasModifications = modifiedFiles.length > 0 || (localDiffFiles && localDiffFiles.length > 0);
    const hasMessages = messages.length > 0;

    return [
      {
        id: 1,
        phase: 'Recon',
        title: 'Discover Context & Repository Architecture',
        status: hasMessages ? 'completed' : 'active',
        verificationGate: 'git status --short 2>/dev/null || ls -lah',
        evidence: hasMessages ? 'Workspace structure mapped' : undefined,
      },
      {
        id: 2,
        phase: 'Design',
        title: 'Synthesize Invariant Safety Constraints & Diff Plan',
        status: hasMessages ? 'completed' : 'pending',
        verificationGate: 'git log -n 1 --oneline 2>/dev/null || ls -lah',
        evidence: hasMessages ? 'Invariants established' : undefined,
      },
      {
        id: 3,
        phase: 'Implementation',
        title: 'Apply Surgical Code Modifications & Exact Patches',
        status: hasModifications ? 'completed' : busy ? 'active' : 'pending',
        targetFiles: (localDiffFiles.length > 0 ? localDiffFiles : modifiedFiles)
          .slice(0, 4)
          .map((f) => (typeof f === 'string' ? f : f.path)),
        verificationGate: 'git diff --stat 2>/dev/null || git status --short',
        evidence: hasModifications ? `${(localDiffFiles.length > 0 ? localDiffFiles : modifiedFiles).length} files patched` : undefined,
      },
      {
        id: 4,
        phase: 'Verification',
        title: 'Execute Proof-of-Work Test Assertions',
        status: busy ? 'active' : hasModifications ? 'completed' : 'pending',
        verificationGate: 'test -f package.json && npm test || git status --short',
      },
      {
        id: 5,
        phase: 'Audit',
        title: 'Audit Git Diff & Clean State Invariants',
        status: 'pending',
        verificationGate: 'git diff --stat',
      },
    ];
  }, [userMilestones, milestones, messages, busy, modifiedFiles, localDiffFiles]);

  const completedMilestones = computedMilestones.filter((m) => m.status === 'completed').length;

  const effectiveFiles = localDiffFiles.length > 0 ? localDiffFiles : modifiedFiles;
  const effectiveDiffText = localDiffText || rawGitDiff;

  /** Prefer the first Work browser window that owns a Playwright / run session id. */
  const activeBrowserSessionId = useMemo(
    () => browserWindows.find((w) => w.sessionId)?.sessionId ?? null,
    [browserWindows],
  );

  const toggleTerminal = useCallback(() => {
    setTerminalVisible((prev) => !prev);
  }, []);

  const addBrowserWindow = useCallback(() => {
    setBrowserWindows((prev) => {
      if (prev.length >= MAX_BROWSER_WINDOWS) {
        setBrowserCapHit(true);
        return prev;
      }
      setBrowserCapHit(false);
      return [...prev, createBrowserWindow(prev.length + 1)];
    });
  }, []);

  const closeBrowserWindow = useCallback((windowId: string) => {
    setBrowserWindows((prev) => {
      if (prev.length <= 1) return prev;
      const closing = prev.find((w) => w.id === windowId);
      if (closing?.sessionId) {
        void closeBrowserSession(closing.sessionId);
      }
      setBrowserCapHit(false);
      return prev.filter((w) => w.id !== windowId);
    });
  }, []);

  const updateBrowserMeta = useCallback((windowId: string, meta: { sessionId?: string; url?: string }) => {
    setBrowserWindows((prev) =>
      prev.map((w) =>
        w.id === windowId
          ? {
              ...w,
              sessionId: meta.sessionId ?? w.sessionId,
              url: meta.url ?? w.url,
            }
          : w,
      ),
    );
  }, []);

  const attachBrowserSession = useCallback((meta: { sessionId?: string; url?: string }) => {
    setBrowserWindows((prev) => {
      if (!prev.length) {
        return [{ ...createBrowserWindow(1), sessionId: meta.sessionId, url: meta.url }];
      }
      const [first, ...rest] = prev;
      return [
        {
          ...first,
          sessionId: meta.sessionId ?? first.sessionId,
          url: meta.url ?? first.url,
        },
        ...rest,
      ];
    });
  }, []);

  useEffect(() => {
    if (!onWorkChrome) return;
    onWorkChrome({
      audit: () => {
        void runGitDiffAudit();
      },
      auditing: isAuditingGit,
      env: `${activeWorkspaceEnvId} · ${bashTarget}`,
      milestones: `${completedMilestones}/${computedMilestones.length}`,
      agentBusy: busy,
      terminalVisible,
      toggleTerminal,
      newBrowser: addBrowserWindow,
      attachBrowserSession,
      browserCount: browserWindows.length,
      browserCap: MAX_BROWSER_WINDOWS,
      browserWindows,
      browserCapHit,
    });
    return () => onWorkChrome(null);
  }, [
    onWorkChrome,
    runGitDiffAudit,
    isAuditingGit,
    activeWorkspaceEnvId,
    bashTarget,
    completedMilestones,
    computedMilestones.length,
    busy,
    terminalVisible,
    toggleTerminal,
    addBrowserWindow,
    attachBrowserSession,
    browserWindows,
    browserCapHit,
  ]);

  return (
    <div className="devin-quad-root devin-workspace-root">
      <main className={`devin-quad-grid${terminalVisible ? '' : ' pty-hidden'}`}>
        <div className="quad-cell quad-cell-1">
          <DevinChatRoadmapPane
            messages={messages}
            busy={busy}
            onSend={onSend}
            onStop={onStop}
            milestones={computedMilestones}
            deliberation={deliberation}
            onUpdateMilestones={setUserMilestones}
            onRunCommand={onRunTerminalCommand}
            terminalLogs={terminalLogs}
            onClearTerminalLogs={onClearTerminalLogs}
            target={bashTarget}
            executingCmd={executingCmd}
          />
        </div>
        {terminalVisible && (
          <div className="quad-cell quad-cell-2">
            <DevinTerminalPane
              logs={terminalLogs}
              onClearLogs={onClearTerminalLogs}
              onRunCommand={onRunTerminalCommand}
              executingCmd={executingCmd}
              target={bashTarget}
              daemons={daemons}
              onStopDaemon={onStopDaemon}
              onInitGitRepo={handleInitGitRepo}
              isInitializingGit={isInitializingGit}
              onClose={() => setTerminalVisible(false)}
            />
          </div>
        )}
        <div className="quad-cell quad-cell-3">
          <DevinDiffEditorPane
            files={effectiveFiles}
            rawGitDiff={effectiveDiffText}
            onInitGitRepo={handleInitGitRepo}
            isInitializingGit={isInitializingGit}
            isGitRepo={gitAvailable}
            browserSessionId={activeBrowserSessionId}
          />
        </div>
        <div className="quad-cell quad-cell-4">
          <div
            className={`devin-browser-windows count-${Math.min(browserWindows.length, MAX_BROWSER_WINDOWS)}`}
          >
            {browserWindows.map((win, index) => (
              <div key={win.id} className="devin-browser-window">
                <div className="devin-browser-window-title" title={win.sessionId || win.url || win.label}>
                  <span className="devin-browser-window-label">
                    {win.label}
                    {win.sessionId ? ` · ${win.sessionId}` : ''}
                    {win.url ? ` · ${win.url}` : ''}
                  </span>
                  {browserWindows.length > 1 && (
                    <button
                      type="button"
                      className="devin-browser-window-close"
                      onClick={() => closeBrowserWindow(win.id)}
                      title="Close this browser window"
                    >
                      Close
                    </button>
                  )}
                </div>
                <DevinBrowserPreviewPane
                  windowId={win.id}
                  sessionId={win.sessionId}
                  previewUrl={index === 0 && !win.sessionId && !win.url ? previewUrl : win.url || ''}
                  screenshots={index === 0 ? screenshots : undefined}
                  consoleLogs={index === 0 ? consoleLogs : undefined}
                  onSessionMeta={(meta) => updateBrowserMeta(win.id, meta)}
                  isLiveRunning={executingCmd || busy}
                />
              </div>
            ))}
          </div>
          {browserCapHit && (
            <div className="devin-browser-cap-note" role="status">
              Browser cap reached ({MAX_BROWSER_WINDOWS}). Close a window before opening another.
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export const DevinWorkspaceView = DevinQuadPaneView;
export default DevinQuadPaneView;
