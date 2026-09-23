import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null }
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in React component tree:', error, errorInfo)
    this.setState({ errorInfo })
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleResetStorage = () => {
    if (window.confirm('Reset all localStorage session and configuration data?')) {
      try {
        localStorage.clear()
        sessionStorage.clear()
      } catch {
        /* ignore */
      }
      window.location.reload()
    }
  }

  private handleCopyError = () => {
    const text = `${this.state.error?.toString()}\n\nStack:\n${this.state.error?.stack || ''}\n\nComponent Stack:\n${this.state.errorInfo?.componentStack || ''}`
    navigator.clipboard.writeText(text).catch(() => {})
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#09090b',
            color: '#f4f4f5',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '24px',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              maxWidth: '720px',
              width: '100%',
              background: '#18181b',
              border: '1px solid #27272a',
              borderRadius: '16px',
              padding: '32px',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <span style={{ fontSize: '28px' }}>⚠️</span>
              <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0, color: '#f87171' }}>
                Abliterated Studio Error
              </h1>
            </div>

            <p style={{ fontSize: '14px', color: '#a1a1aa', margin: '0 0 20px 0', lineHeight: 1.5 }}>
              An unexpected render error occurred in the application. You can reload the page or reset
              local cache to restore functionality.
            </p>

            <div
              style={{
                background: '#09090b',
                border: '1px solid #27272a',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '24px',
                overflowX: 'auto',
              }}
            >
              <div style={{ color: '#ef4444', fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>
                {this.state.error?.toString() || 'Unknown Error'}
              </div>
              {this.state.error?.stack && (
                <pre
                  style={{
                    color: '#71717a',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.4,
                  }}
                >
                  {this.state.error.stack}
                </pre>
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={this.handleReload}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  background: '#8b5cf6',
                  color: '#fff',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Reload Studio
              </button>

              <button
                onClick={this.handleCopyError}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  background: '#27272a',
                  color: '#e4e4e7',
                  border: '1px solid #3f3f46',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Copy Error Details
              </button>

              <button
                onClick={this.handleResetStorage}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  background: 'transparent',
                  color: '#a1a1aa',
                  border: '1px solid #27272a',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Reset Storage & Reload
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
