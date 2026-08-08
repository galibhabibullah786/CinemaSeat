import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import { ToastContext, type ToastApi, type ToastMessage } from './toast-context.js';

const DISMISS_AFTER_MS = 6_000;

/**
 * Transient, user-safe feedback.
 *
 * This module exports ONLY components, so Fast Refresh can hot-swap it. The
 * context object and the `useToast` hook live in ./toast-context.ts for that
 * reason -- see the note there.
 */
export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Timers are tracked so dismissal can clear them. Without this, a timer that
  // fires after unmount calls setState on a dead component -- a warning in
  // React 18 and a real leak if the tree mounts and unmounts repeatedly.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (text: string, tone: ToastMessage['tone'], requestId?: string) => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current, { id, text, tone, requestId }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_AFTER_MS),
      );
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      showError: (text, requestId) => push(text, 'error', requestId),
      showSuccess: (text) => push(text, 'success'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/*
        aria-live="polite" so a screen reader announces the message without
        interrupting, and role="status" gives it the right semantics. A toast
        invisible to assistive tech is a toast that did not happen.
      */}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            <span>{toast.text}</span>
            {toast.requestId ? <code className="toast__id">{toast.requestId}</code> : null}
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
