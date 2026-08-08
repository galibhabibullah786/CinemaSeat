import { createContext, useContext } from 'react';

export interface ToastMessage {
  id: string;
  text: string;
  tone: 'error' | 'success';
  /** Shown as small print so a user can quote it in a bug report. */
  requestId?: string | undefined;
}

export interface ToastApi {
  showError: (text: string, requestId?: string) => void;
  showSuccess: (text: string) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

/**
 * Lives in its own module, separate from <ToastProvider>.
 *
 * React Fast Refresh can only hot-swap a module whose exports are ALL
 * components. Exporting this hook next to the provider silently downgrades
 * every edit in that file to a full page reload -- which looks like "hot
 * reload is broken" and costs a hackathon team an hour of confusion.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  // Throws rather than returning a no-op: a silently swallowed toast means the
  // user gets no feedback that their action failed, which is the exact failure
  // this component exists to prevent.
  if (!ctx) throw new Error('useToast must be used inside a <ToastProvider>');
  return ctx;
}
