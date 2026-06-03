import { useEffect } from 'react';
import { useSettingsStore, useLockStore, useAccountsStore } from '@/store';

/**
 * Auto-lock controller. Re-locks the app after it's been backgrounded for
 * longer than the configured delay (0 = lock immediately on background).
 * Renders nothing; mounted once at the app root.
 *
 * Uses the page Visibility API — on mobile, the app going to the background
 * (screen off, app switch) fires `visibilitychange` to `hidden`.
 */
export function LockController() {
  const mode = useSettingsStore((s) => s.appLock.mode);
  const autoLockMs = useSettingsStore((s) => s.appLock.autoLockMs);
  const hasAccount = useAccountsStore((s) => s.accounts.length > 0);

  useEffect(() => {
    if (mode === 'off' || !hasAccount) return;

    const onVisibility = () => {
      const lockStore = useLockStore.getState();
      if (document.visibilityState === 'hidden') {
        lockStore.setHiddenAt(Date.now());
        if (autoLockMs === 0) lockStore.lock();
      } else {
        const { hiddenAt } = lockStore;
        if (hiddenAt !== null && Date.now() - hiddenAt >= autoLockMs) {
          lockStore.lock();
        }
        lockStore.setHiddenAt(null);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [mode, autoLockMs, hasAccount]);

  return null;
}
