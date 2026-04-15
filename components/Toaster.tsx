'use client'
import { useEffect, useState } from 'react'

/**
 * Lightweight toast system.
 *
 * Pattern: an imperative `toast()` function dispatches a CustomEvent on
 * window. The <Toaster /> component, mounted once per page, listens for
 * those events and renders a stack bottom-right. No context, no global
 * store, no third-party library — the whole thing is ~100 lines and has
 * zero dependencies.
 *
 * Usage:
 *   import { toast } from '@/components/Toaster'
 *   toast.success('Reboot sent')
 *   toast.error('M360 returned 502')
 *   toast.info('Saving…', { durationMs: 2000 })
 *
 * Notes:
 *   - Toasts auto-dismiss after `durationMs` (default 4500ms). Errors default
 *     to 7000ms because they matter more.
 *   - Click any toast to dismiss early.
 *   - The component is client-only because it binds window event listeners
 *     and manages transient UI state.
 */

export type ToastKind = 'success' | 'error' | 'info'
export interface ToastEventDetail {
  id:        string
  kind:      ToastKind
  message:   string
  detail?:   string
  durationMs?: number
}
interface ToastState extends ToastEventDetail {
  leaving?: boolean
}

const EVENT_NAME = 'fleet-portal-toast'

function emit(detail: Omit<ToastEventDetail, 'id'>) {
  if (typeof window === 'undefined') return
  const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  window.dispatchEvent(new CustomEvent<ToastEventDetail>(EVENT_NAME, { detail: { id, ...detail } }))
}

export const toast = {
  success: (message: string, opts?: { detail?: string; durationMs?: number }) =>
    emit({ kind: 'success', message, detail: opts?.detail, durationMs: opts?.durationMs ?? 4500 }),
  error: (message: string, opts?: { detail?: string; durationMs?: number }) =>
    emit({ kind: 'error', message, detail: opts?.detail, durationMs: opts?.durationMs ?? 7000 }),
  info: (message: string, opts?: { detail?: string; durationMs?: number }) =>
    emit({ kind: 'info', message, detail: opts?.detail, durationMs: opts?.durationMs ?? 3500 }),
}

export default function Toaster() {
  const [toasts, setToasts] = useState<ToastState[]>([])

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastEventDetail>).detail
      setToasts(prev => [...prev, detail])
      const duration = detail.durationMs ?? 4500
      window.setTimeout(() => {
        // Start the fade-out animation; actually remove after 250ms.
        setToasts(prev => prev.map(t => t.id === detail.id ? { ...t, leaving: true } : t))
        window.setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== detail.id))
        }, 250)
      }, duration)
    }
    window.addEventListener(EVENT_NAME, onToast)
    return () => window.removeEventListener(EVENT_NAME, onToast)
  }, [])

  function dismiss(id: string) {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t))
    window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 250)
  }

  if (toasts.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20, right: 20,
        display: 'flex', flexDirection: 'column', gap: 8,
        zIndex: 9999, maxWidth: 380,
        pointerEvents: 'none',
      }}
      aria-live="polite"
    >
      {toasts.map(t => {
        const { bg, border, icon } = styleFor(t.kind)
        return (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            style={{
              pointerEvents: 'auto',
              background: bg,
              border: `1px solid ${border}`,
              borderRadius: 'var(--radius-lg)',
              padding: '10px 14px',
              color: 'var(--text)',
              fontSize: 13,
              boxShadow: 'var(--shadow-lg)',
              cursor: 'pointer',
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              transform: t.leaving ? 'translateX(20px)' : 'translateX(0)',
              opacity: t.leaving ? 0 : 1,
              transition: 'transform 0.25s ease, opacity 0.25s ease',
              minWidth: 240,
            }}
            role="status"
          >
            <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1 }}>{icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{t.message}</div>
              {t.detail && (
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, wordBreak: 'break-word' }}>
                  {t.detail}
                </div>
              )}
            </div>
            <span style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0, marginTop: 2 }}>×</span>
          </div>
        )
      })}
    </div>
  )
}

function styleFor(kind: ToastKind): { bg: string; border: string; icon: string } {
  switch (kind) {
    case 'success': return { bg: 'var(--bg2)', border: 'var(--green)', icon: '✅' }
    case 'error':   return { bg: 'var(--bg2)', border: 'var(--red)',   icon: '⚠️' }
    default:        return { bg: 'var(--bg2)', border: 'var(--border2)', icon: 'ℹ️' }
  }
}
