'use client';

import { createContext, useContext, useState, useCallback, useRef } from 'react';

/* ── Context ─────────────────────────────────────────────────────────────── */
const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

/* ── Single toast item ───────────────────────────────────────────────────── */
function ToastItem({ toast, onRemove }) {
  const [leaving, setLeaving] = useState(false);

  const dismiss = useCallback(() => {
    setLeaving(true);
    setTimeout(() => onRemove(toast.id), 280);
  }, [toast.id, onRemove]);

  const colors = {
    success: { bg: 'rgba(20,184,166,0.12)', border: 'rgba(20,184,166,0.35)', icon: '#14b8a6', dot: '✓' },
    error:   { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.35)',  icon: '#ef4444', dot: '✕' },
    info:    { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.30)', icon: '#f59e0b', dot: 'ℹ' },
  };
  const c = colors[toast.type] ?? colors.info;

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '12px 14px',
      background: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: 12,
      backdropFilter: 'blur(12px)',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      minWidth: 260, maxWidth: 360,
      animation: leaving ? 'toastOut 0.28s ease forwards' : 'toastIn 0.28s ease',
      cursor: 'default',
    }}>
      {/* Icon */}
      <span style={{
        width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
        background: `${c.icon}20`, border: `1px solid ${c.icon}40`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: c.icon, fontSize: '0.65rem', fontWeight: 700,
      }}>{c.dot}</span>

      {/* Message */}
      <p style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.45, margin: 0 }}>
        {toast.message}
      </p>

      {/* Dismiss */}
      <button
        onClick={dismiss}
        style={{
          background: 'none', border: 'none', padding: '0 0 0 4px',
          color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem',
          lineHeight: 1, flexShrink: 0,
        }}
      >×</button>
    </div>
  );
}

/* ── Provider ────────────────────────────────────────────────────────────── */
export default function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timerMap = useRef({});

  const removeToast = useCallback((id) => {
    clearTimeout(timerMap.current[id]);
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    setToasts(prev => [...prev.slice(-4), { id, message, type }]); // max 5 toasts

    if (duration > 0) {
      timerMap.current[id] = setTimeout(() => {
        // trigger leave animation
        setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t));
        setTimeout(() => removeToast(id), 280);
      }, duration);
    }
    return id;
  }, [removeToast]);

  const toast = {
    success: (msg, dur)  => addToast(msg, 'success', dur),
    error:   (msg, dur)  => addToast(msg, 'error',   dur),
    info:    (msg, dur)  => addToast(msg, 'info',     dur),
    dismiss: removeToast,
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}

      {/* Toast stack — bottom-right */}
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          display: 'flex', flexDirection: 'column', gap: 8,
          pointerEvents: 'none',
        }}>
          {toasts.map(t => (
            <div key={t.id} style={{ pointerEvents: 'auto' }}>
              <ToastItem toast={t} onRemove={removeToast} />
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
