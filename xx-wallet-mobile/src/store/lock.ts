/**
 * Live app-lock state — whether the app is currently unlocked this session.
 *
 * Intentionally NOT persisted: on a fresh load / reopen the app starts
 * locked (when a lock mode is enabled). The lock *config* (mode, PIN hash,
 * auto-lock delay) lives in the persisted settings store; this is just the
 * ephemeral locked/unlocked flag plus failed-attempt rate limiting.
 */

import { create } from 'zustand';

/** Failed attempts before a cooldown kicks in. */
export const LOCK_MAX_ATTEMPTS = 5;
/** Cooldown length once the attempt limit is hit. */
export const LOCK_COOLDOWN_MS = 30_000;

interface LockState {
  isUnlocked: boolean;
  failedAttempts: number;
  /** Epoch ms until which entry is locked out; 0 when not in cooldown. */
  cooldownUntil: number;
  /** When the app was last backgrounded; null when foregrounded. */
  hiddenAt: number | null;

  unlock(): void;
  lock(): void;
  recordFailure(): void;
  setHiddenAt(t: number | null): void;
}

export const useLockStore = create<LockState>((set) => ({
  isUnlocked: false,
  failedAttempts: 0,
  cooldownUntil: 0,
  hiddenAt: null,

  unlock() {
    set({ isUnlocked: true, failedAttempts: 0, cooldownUntil: 0, hiddenAt: null });
  },

  lock() {
    set({ isUnlocked: false });
  },

  recordFailure() {
    set((s) => {
      const failedAttempts = s.failedAttempts + 1;
      return {
        failedAttempts,
        cooldownUntil:
          failedAttempts >= LOCK_MAX_ATTEMPTS
            ? Date.now() + LOCK_COOLDOWN_MS
            : 0,
      };
    });
  },

  setHiddenAt(t: number | null) {
    set({ hiddenAt: t });
  },
}));
