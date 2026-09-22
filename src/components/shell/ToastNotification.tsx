import React, { createContext, useContext, useState, useCallback } from 'react'

export interface Toast {
  id: string
  message: string
  type?: 'info' | 'success' | 'warning' | 'error'
  icon?: string
  duration?: number
}

interface ToastContextValue {
  showToast: (message: string, options?: { type?: Toast['type']; icon?: string; duration?: number }) => void
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
})

export const useToast = () => useContext(ToastContext)

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback(
    (message: string, options?: { type?: Toast['type']; icon?: string; duration?: number }) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const newToast: Toast = {
        id,
        message,
        type: options?.type || 'info',
        icon: options?.icon || (options?.type === 'success' ? '✓' : options?.type === 'error' ? '✕' : 'ℹ'),
        duration: options?.duration || 3000,
      }

      // Max 1 visible toast per design spec
      setToasts([newToast])

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, newToast.duration)
    },
    [],
  )

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast-pill ${toast.type}`} onClick={() => dismissToast(toast.id)}>
            <span className="toast-icon">{toast.icon}</span>
            <span className="toast-message">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
