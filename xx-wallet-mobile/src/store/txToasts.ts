/**
 * Global transaction toasts.
 *
 * Lets a tx flow be non-blocking: once a transaction is broadcast, the screen
 * navigates away and a toast (rendered app-wide by TxToastHost) tracks it to
 * finality — spinner while pending, then a checkmark (success) or an X with the
 * failure reason. This store is the source of truth that survives the screen
 * unmounting; useTx drives it.
 */
import { create } from 'zustand';

export type TxToastStatus = 'pending' | 'success' | 'error';

export interface TxToast {
  id: string;
  /** What the transaction is, e.g. "Send 10 XX". */
  label: string;
  status: TxToastStatus;
  /** Failure reason on error (success uses a static label). */
  detail?: string;
}

interface TxToastsState {
  toasts: TxToast[];
  /** Begin tracking a transaction (pending). Returns its id. */
  add(label: string): string;
  /** Update a tracked transaction (e.g. to success/error). */
  update(id: string, patch: Partial<Omit<TxToast, 'id'>>): void;
  /** Remove a toast (on dismiss or auto-dismiss). */
  dismiss(id: string): void;
}

let counter = 0;

export const useTxToastsStore = create<TxToastsState>((set) => ({
  toasts: [],

  add(label) {
    const id = `tx-${Date.now()}-${counter++}`;
    set((s) => ({ toasts: [...s.toasts, { id, label, status: 'pending' }] }));
    return id;
  },

  update(id, patch) {
    set((s) => ({
      toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  },

  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
