import React, { useEffect, useState } from 'react';
import {
  fetchBrowserRunById,
  type DurableBrowserRun,
} from '../../lib/browserRuns';

export interface DiffFileEntry {
  path: string;
  diff?: string;
  originalContent?: string;
  modifiedContent?: string;
  additions?: number;
  deletions?: number;
}

export type DiffPaneMode = 'unified' | 'split' | 'live-steps' | 'results';

export interface DevinDiffEditorPaneProps {
  files?: DiffFileEntry[];
  rawGitDiff?: string;
  onInitGitRepo?: () => void;
  isInitializingGit?: boolean;
  isGitRepo?: boolean;
  /** Active Playwright / browser-run session id from the Work browser window(s). */
  browserSessionId?: string | null;
}

const PANE_MODES: Array<{ id: DiffPaneMode; label: string }> = [
  { id: 'unified', label: 'Unified' },
  { id: 'split', label: 'Split' },
  { id: 'live-steps', label: 'Live steps' },
  { id: 'results', label: 'Results' },
];

export const DevinDiffEditorPane: React.FC<DevinDiffEditorPaneProps> = ({
  files = [],
  rawGitDiff = '',
  onInitGitRepo,
  isInitializingGit = false,
  isGitRepo,
  browserSessionId = null,
}) => {
  const [selectedFileIdx, setSelectedFileIdx] = useState<number>(0);
  const [paneMode, setPaneMode] = useState<DiffPaneMode>('unified');
  const [browserRun, setBrowserRun] = useState<DurableBrowserRun | null>(null);

  const activeFile = files[selectedFileIdx] || (files.length > 0 ? files[0] : null);

  const isNotGitRepo =
    isGitRepo === false ||
    rawGitDiff.includes('not a git repository') ||
    rawGitDiff.includes('(Active environment is not a git repository)');

  const showAutomation = paneMode === 'live-steps' || paneMode === 'results';

  useEffect(() => {
    if (!showAutomation) return;

    let cancelled = false;
    const load = async () => {
      try {
        const record = browserSessionId
          ? await fetchBrowserRunById(browserSessionId)
          : null;
        if (!cancelled) setBrowserRun(record);
      } catch {
        if (!cancelled) setBrowserRun(null);
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [showAutomation, browserSessionId]);

  // Render unified diff lines with syntax styling
  const renderUnifiedDiff = (diffText: string) => {
    if (!diffText.trim()) {
      return (
        <div className="devin-empty-state">
          No git diff changes detected in workspace. Clean working tree.
        </div>
      );
    }

    const lines = diffText.split('\n');
    return (
      <div className="devin-diff-code-table">
        {lines.map((line, idx) => {
          let lineType = 'context';
          if (line.startsWith('+') && !line.startsWith('+++')) lineType = 'addition';
          else if (line.startsWith('-') && !line.startsWith('---')) lineType = 'deletion';
          else if (line.startsWith('@@')) lineType = 'hunk-header';
          else if (line.startsWith('diff') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++')) lineType = 'meta';

          return (
            <div key={idx} className={`diff-line line-${lineType}`}>
              <span className="diff-line-number">{idx + 1}</span>
              <span className="diff-line-content">{line}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderSplitDiff = (diffText: string) => {
    if (!diffText.trim()) {
      return (
        <div className="devin-empty-state">
          No git diff changes detected in workspace. Clean working tree.
        </div>
      );
    }

    const left: string[] = [];
    const right: string[] = [];
    for (const line of diffText.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        right.push(line);
        left.push('');
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        left.push(line);
        right.push('');
      } else {
        left.push(line);
        right.push(line);
      }
    }

    return (
      <div className="devin-diff-split">
        <div className="devin-diff-split-col">
          <div className="devin-diff-split-label">Before</div>
          {left.map((line, idx) => (
            <div
              key={`L${idx}`}
              className={`diff-line ${line.startsWith('-') ? 'line-deletion' : 'line-context'}`}
            >
              <span className="diff-line-number">{idx + 1}</span>
              <span className="diff-line-content">{line || ' '}</span>
            </div>
          ))}
        </div>
        <div className="devin-diff-split-col">
          <div className="devin-diff-split-label">After</div>
          {right.map((line, idx) => (
            <div
              key={`R${idx}`}
              className={`diff-line ${line.startsWith('+') ? 'line-addition' : 'line-context'}`}
            >
              <span className="diff-line-number">{idx + 1}</span>
              <span className="diff-line-content">{line || ' '}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderDiffBody = () => {
    if (isNotGitRepo) {
      return (
        <div className="devin-git-connect-card">
          <div className="devin-git-card-glow" />
          <div className="devin-git-card-badge">
            <span className="devin-git-badge-dot" />
            <span>REPOSITORY UNINITIALIZED</span>
          </div>
          <div className="devin-git-icon-wrapper">
            <span className="devin-git-big-icon">📦</span>
          </div>
          <h3 className="devin-git-card-title">WORKSPACE NOT CONNECTED TO GIT</h3>
          <div className="devin-git-error-banner">
            <code>fatal: not a git repository (or any of the parent directories): .git</code>
          </div>
          <p className="devin-git-card-desc">
            This workspace directory is not initialized with Git version control. Single-click below to connect and initialize Git, track file modifications, inspect surgical diff hunks, and create version checkpoints.
          </p>
          {onInitGitRepo && (
            <button
              type="button"
              className="devin-btn-connect-repo-main"
              onClick={onInitGitRepo}
              disabled={isInitializingGit}
              id="btn-single-click-connect-repo"
            >
              <span className="btn-icon">{isInitializingGit ? '⏳' : '⚡'}</span>
              <span>{isInitializingGit ? 'Connecting & Initializing Git...' : 'Single Click: Connect to Repo (git init)'}</span>
            </button>
          )}
          <div className="devin-git-card-footer-hint">
            <span>Runs command: <code>git init && git status</code></span>
          </div>
        </div>
      );
    }

    const diffText = activeFile?.diff || rawGitDiff || '';
    if (!diffText) {
      return (
        <div className="devin-empty-state">
          Zero pending diffs. When the agent uses <code>replace_file_content</code> or modifies code, live hunks appear here.
        </div>
      );
    }
    return paneMode === 'split' ? renderSplitDiff(diffText) : renderUnifiedDiff(diffText);
  };

  const renderLiveSteps = () => {
    const steps = browserRun?.steps;
    if (!browserSessionId || !steps || steps.length === 0) {
      return <div className="devin-run-empty">No active automation run.</div>;
    }
    return (
      <div className="devin-run-steps" role="list">
        {steps.map((step, idx) => (
          <div
            key={`${step.action}-${idx}`}
            className={`devin-run-step ${step.ok ? 'ok' : 'fail'}`}
            role="listitem"
          >
            <span className="devin-run-step-action">{step.action}</span>
            {step.selector ? <span className="devin-run-step-target">{step.selector}</span> : null}
            <span className="devin-run-step-status">{step.ok ? 'ok' : 'fail'}</span>
            {step.error ? <span className="devin-run-step-error">{step.error}</span> : null}
          </div>
        ))}
      </div>
    );
  };

  const renderResults = () => {
    if (!browserSessionId || !browserRun) {
      return <div className="devin-run-empty">No automation results.</div>;
    }

    const shotBytes = browserRun.screenshot?.bytes ?? 0;
    const screenshotPresent = shotBytes > 0;
    const outcome =
      browserRun.terminal === 'running'
        ? 'running'
        : browserRun.countable === true || browserRun.terminal === 'passed'
          ? 'passed'
          : browserRun.terminal === 'failed' || browserRun.executorRan
            ? 'failed'
            : 'incomplete';

    const assertion = browserRun.domAssertion;
    const assertionText = assertion
      ? `ok=${String(assertion.ok === true)} selector=${assertion.selector ?? '—'} actual=${assertion.actual ?? '—'} expected=${assertion.expected ?? '—'}`
      : '—';

    return (
      <div className="devin-run-results">
        <div className="devin-run-result-row">
          <span className="devin-run-result-key">finalUrl</span>
          <span className="devin-run-result-val">{browserRun.finalUrl || '—'}</span>
        </div>
        <div className="devin-run-result-row">
          <span className="devin-run-result-key">httpStatus</span>
          <span className="devin-run-result-val">{String(browserRun.httpStatus)}</span>
        </div>
        <div className="devin-run-result-row">
          <span className="devin-run-result-key">domAssertion</span>
          <span className="devin-run-result-val">{assertionText}</span>
        </div>
        <div className="devin-run-result-row">
          <span className="devin-run-result-key">consoleErrorCount</span>
          <span className="devin-run-result-val">{String(browserRun.consoleErrorCount)}</span>
        </div>
        <div className="devin-run-result-row">
          <span className="devin-run-result-key">screenshot</span>
          <span className="devin-run-result-val">{screenshotPresent ? `present (${shotBytes} bytes)` : 'absent'}</span>
        </div>
        <div className="devin-run-result-row">
          <span className="devin-run-result-key">outcome</span>
          <span className={`devin-run-result-val outcome-${outcome}`}>{outcome}</span>
        </div>
      </div>
    );
  };

  const footerLabel = showAutomation
    ? browserSessionId
      ? `Run: ${browserSessionId}${browserRun?.terminal ? ` · ${browserRun.terminal}` : ''}`
      : 'No browser session'
    : isNotGitRepo
      ? 'Workspace: Not a Git repository (Click Connect above)'
      : activeFile
        ? activeFile.path
        : 'Working Tree: Clean';

  return (
    <div className="devin-pane devin-pane-diff">
      <div className="devin-pane-header">
        <div className="devin-pane-title">
          <span className={`devin-pane-dot ${isNotGitRepo && !showAutomation ? 'warning-dot' : 'diff-dot'}`} />
          <span className="devin-pane-heading">3. CODE DIFF VIEW (SURGICAL HUNKS)</span>
          {!showAutomation && files.length > 0 && (
            <span className="devin-files-count">({files.length} modified)</span>
          )}
          {!showAutomation && isNotGitRepo && (
            <span className="devin-badge-warning-pill">⚠️ Not a Git Repo</span>
          )}
        </div>
        <div className="devin-pane-tabs devin-pane-mode-toggle" role="tablist" aria-label="Diff pane mode">
          {PANE_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={paneMode === mode.id}
              className={`devin-tab-btn ${paneMode === mode.id ? 'active' : ''}`}
              onClick={() => setPaneMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {!showAutomation && !isNotGitRepo && files.length > 0 && (
        <div className="devin-file-breadcrumbs">
          {files.map((f, idx) => (
            <button
              key={idx}
              type="button"
              className={`devin-breadcrumb-tab ${idx === selectedFileIdx ? 'active' : ''}`}
              onClick={() => setSelectedFileIdx(idx)}
            >
              <span className="file-name">{f.path.split('/').pop()}</span>
              {f.additions !== undefined && (
                <span className="delta-badge add">+{f.additions}</span>
              )}
              {f.deletions !== undefined && (
                <span className="delta-badge del">-{f.deletions}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="devin-pane-body devin-diff-body">
        {paneMode === 'live-steps'
          ? renderLiveSteps()
          : paneMode === 'results'
            ? renderResults()
            : renderDiffBody()}
      </div>

      <div className="devin-pane-footer devin-diff-footer">
        <span className="devin-footer-path">{footerLabel}</span>
      </div>
    </div>
  );
};
