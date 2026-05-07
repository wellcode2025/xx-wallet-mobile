/**
 * Settings store — user preferences that persist across sessions.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_ENDPOINT } from '../api';

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

  setEndpoint(endpoint: string): void;
  setCustomEndpoint(endpoint: string): void;
  toggleHideBalances(): void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      endpoint: DEFAULT_ENDPOINT,
      customEndpoint: '',
      hideBalances: false,

      setEndpoint(endpoint: string) {
        set({ endpoint });
      },

      setCustomEndpoint(customEndpoint: string) {
        set({ customEndpoint });
      },

      toggleHideBalances() {
        set((s) => ({ hideBalances: !s.hideBalances }));
      },
    }),
    { name: 'xx-wallet:settings' }
  )
);
