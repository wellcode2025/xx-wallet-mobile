/**
 * Settings store — user preferences that persist across sessions.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_ENDPOINT } from '../api';

/**
 * Bounds for the multisig stale-proposal threshold. 7 days minimum so
 * the user can't accidentally flag every proposal as stale within a day
 * (eroding the signal); 365 days max so dead-letter cost (reserved
 * deposits) doesn't get to accumulate forever before the wallet
 * surfaces it. Default 30 days matches the design doc §6.7 default.
 */
export const STALE_THRESHOLD_DAYS_DEFAULT = 30;
export const STALE_THRESHOLD_DAYS_MIN = 7;
export const STALE_THRESHOLD_DAYS_MAX = 365;

interface SettingsState {
  /** The currently active RPC endpoint (preset or custom URL). */
  endpoint: string;
  /**
   * Last custom RPC URL the user entered, remembered even after switching
   * back to a preset, so the input can pre-fill if they tap "Custom" again.
   * Empty string when never set.
   */
  customEndpoint: string;
  /** Whether to hide balances (for privacy in public). */
  hideBalances: boolean;
  /**
   * Multisig stale-proposal threshold, in days. Pending proposals older
   * than this get the "stale" treatment in the UI (more prominent for
   * depositors who can cancel & reclaim, informational for non-depositor
   * cosigners who can only ask the depositor to clean up). Used by the
   * stale-detection logic in usePendingMultisigs / approval surfaces.
   */
  staleThresholdDays: number;

  setEndpoint(endpoint: string): void;
  setCustomEndpoint(endpoint: string): void;
  toggleHideBalances(): void;
  setStaleThresholdDays(days: number): void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      endpoint: DEFAULT_ENDPOINT,
      customEndpoint: '',
      hideBalances: false,
      staleThresholdDays: STALE_THRESHOLD_DAYS_DEFAULT,

      setEndpoint(endpoint: string) {
        set({ endpoint });
      },

      setCustomEndpoint(customEndpoint: string) {
        set({ customEndpoint });
      },

      toggleHideBalances() {
        set((s) => ({ hideBalances: !s.hideBalances }));
      },

      setStaleThresholdDays(days: number) {
        // Clamp to bounds so a malformed input from the UI (or an old
        // persisted value from a future schema) can't break downstream
        // staleness comparisons.
        const clamped = Math.max(
          STALE_THRESHOLD_DAYS_MIN,
          Math.min(STALE_THRESHOLD_DAYS_MAX, Math.round(days))
        );
        set({ staleThresholdDays: clamped });
      },
    }),
    { name: 'xx-wallet:settings' }
  )
);
