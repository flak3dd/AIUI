import React, { useEffect, useState } from 'react';
import {
  fetchBrowserRunById,
  latestScreenshotUrl,
  openAllowlistedPage,
  type DurableBrowserRun,
} from '../../lib/browserRuns';

export interface ConsoleLogEntry {
  type: 'info' | 'warn' | 'error' | 'debug' | string;
  text: string;
  timestamp?: string;
  line?: string;
  source?: string;
}

export interface DevinBrowserPreviewPaneProps {
  /** Stable UI window id (not the Playwright session). */
  windowId?: string;
  /** Optional Playwright session / run id owned by this window only. */
  sessionId?: string | null;
  previewUrl?: string;
  activeRunUrl?: string;
  isLiveRunning?: boolean;
  screenshots?: string[];
  consoleLogs?: ConsoleLogEntry[];
  /** Notify parent when this window’s session or URL changes. */
  onSessionMeta?: (meta: { sessionId?: string; url?: string }) => void;
}

/**
 * Screen-only browser proof viewer. No address bar, toolbars, directive bars,
 * status chips, or config controls — those live in the Work menu / window title.
 */
export const DevinBrowserPreviewPane: React.FC<DevinBrowserPreviewPaneProps> = ({
  sessionId = null,
  previewUrl = '',
  activeRunUrl = '',
  onSessionMeta,
}) => {
  const initialTarget =
    activeRunUrl || (previewUrl && previewUrl !== 'google' && previewUrl !== 'about:blank' ? previewUrl : '');
  const [liveUrl, setLiveUrl] = useState<string>(initialTarget);
  const [ownedSessionId, setOwnedSessionId] = useState<string | null>(sessionId);
  const [durableRun, setDurableRun] = useState<DurableBrowserRun | null>(null);

  useEffect(() => {
    if (sessionId && sessionId !== ownedSessionId) {
      setOwnedSessionId(sessionId);
    }
  }, [sessionId, ownedSessionId]);

  useEffect(() => {
    const targetUrl =
      activeRunUrl || (previewUrl && previewUrl !== 'google' && previewUrl !== 'about:blank' ? previewUrl : '');
    if (!targetUrl || targetUrl === liveUrl) return;

    let cancelled = false;
    void (async () => {
      const opened = await openAllowlistedPage(targetUrl);
      if (cancelled) return;
      if (opened.ok && opened.engine === 'playwright-chromium' && opened.url) {
        setLiveUrl(opened.url);
        if (opened.sessionId) {
          setOwnedSessionId(opened.sessionId);
          onSessionMeta?.({ sessionId: opened.sessionId, url: opened.url });
        } else {
          onSessionMeta?.({ url: opened.url });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeRunUrl, previewUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ownedSessionId) {
      setDurableRun(null);
      return;
    }
    let cancelled = false;
    void fetchBrowserRunById(ownedSessionId)
      .then((record) => {
        if (!cancelled) setDurableRun(record);
      })
      .catch(() => {
        if (!cancelled) setDurableRun(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ownedSessionId]);

  const shotBytes = durableRun?.screenshot?.bytes ?? 0;
  const showShot = Boolean(ownedSessionId && shotBytes > 0 && durableRun?.engine === 'playwright-chromium');

  return (
    <div className="devin-pane devin-pane-preview devin-browser-screen-only">
      <div className="devin-browser-screen">
        {showShot ? (
          <img
            src={latestScreenshotUrl(ownedSessionId || durableRun?.id)}
            alt=""
            className="devin-browser-screen-media"
          />
        ) : liveUrl ? (
          <iframe
            src={liveUrl}
            className="devin-browser-screen-media"
            title={ownedSessionId || 'browser'}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        ) : (
          <div className="devin-browser-screen-empty" aria-hidden="true" />
        )}
      </div>
    </div>
  );
};

export default DevinBrowserPreviewPane;
