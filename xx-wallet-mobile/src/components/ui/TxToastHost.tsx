/**
 * App-wide transaction toasts.
 *
 * Mounted once at the app root so a transaction can keep being tracked after
 * the user leaves the screen that started it. Each toast spins while the tx is
 * pending, then resolves to a checkmark ("Sent successfully") or an X with the
 * failure reason. Successes auto-dismiss; errors persist until tapped, so a
 * failure reason is never missed. Driven by useTxToastsStore (which useTx
 * feeds); see store/txToasts.ts.
 */
import { useEffect } from 'react';
import { Loader2, Check, X } from 'lucide-react';
import clsx from 'clsx';
import { useTxToastsStore, type TxToast } from '@/store/txToasts';

/** How long a successful toast lingers before auto-dismissing. */
const SUCCESS_DISMISS_MS = 5000;

export function TxToastHost() {
  const toasts = useTxToastsStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none"
      // Sit clear of the fixed bottom nav (min-h-56px) + the home indicator.
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 72px)' }}
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <TxToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}

function TxToastCard({ toast }: { toast: TxToast }) {
  const dismiss = useTxToastsStore((s) => s.dismiss);

  // Successes clear themselves; errors stay until the user taps them so the
  // failure reason is always seen.
  useEffect(() => {
    if (toast.status !== 'success') return;
    const id = setTimeout(() => dismiss(toast.id), SUCCESS_DISMISS_MS);
    return () => clearTimeout(id);
  }, [toast.status, toast.id, dismiss]);

  const sub =
    toast.status === 'pending'
      ? 'Sending…'
      : toast.status === 'success'
        ? 'Sent successfully'
        : (toast.detail ?? 'Failed');

  return (
    <button
      type="button"
      onClick={() => dismiss(toast.id)}
      className={clsx(
        'pointer-events-auto w-full max-w-md flex items-center gap-3 p-3 text-left',
        'rounded-2xl border bg-ink-900/95 backdrop-blur-md shadow-2xl',
        toast.status === 'error' ? 'border-danger/40' : 'border-ink-700/60'
      )}
    >
      <span className="flex-shrink-0">
        {toast.status === 'pending' ? (
          <Loader2 size={18} className="text-xx-500 animate-spin" strokeWidth={2} />
        ) : toast.status === 'success' ? (
          <Check size={18} className="text-xx-500" strokeWidth={2.5} />
        ) : (
          <X size={18} className="text-danger" strokeWidth={2.5} />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink-100 truncate">{toast.label}</p>
        <p
          className={clsx(
            'text-xs',
            // Let a failure reason wrap so it's fully readable (the toast
            // persists until tapped); the short pending/success lines stay tidy.
            toast.status === 'error' ? 'text-danger break-words' : 'text-ink-300 truncate'
          )}
        >
          {sub}
        </p>
      </div>
    </button>
  );
}
