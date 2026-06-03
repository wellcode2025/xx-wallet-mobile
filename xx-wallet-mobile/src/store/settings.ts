/**
 * Settings store — user preferences that persist across sessions.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_ENDPOINT } from '../api';
import { DEFAULT_LEVERS, type QualityLevers } from '../staking';

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

/** Auto-lock options (ms of background/idle before the app re-locks). */
export const AUTO_LOCK_OPTIONS: { label: string; ms: number }[] = [
  { label: 'Immediately', ms: 0 },
  { label: '30 seconds', ms: 30_000 },
  { label: '1 minute', ms: 60_000 },
  { label: '5 minutes', ms: 300_000 },
];
export const AUTO_LOCK_DEFAULT_MS = 60_000;

/**
 * App-lock config. The lock is an opt-in *access gate* (privacy / speed
 * bump) — it does not protect the keys, which stay encrypted with the
 * signing password. Persisted; the live locked/unlocked state is separate
 * and in-memory (see store/lock.ts).
 */
export interface AppLockConfig {
  /** 'off' = no lock; 'pin' = PIN gate; 'biometric' = biometric + PIN backup. */
  mode: 'off' | 'pin' | 'biometric';
  /** scrypt salt for the PIN hash, hex; null when no PIN set. */
  pinSalt: string | null;
  /** scrypt hash of the PIN, hex; null when no PIN set. */
  pinHash: string | null;
  /** WebAuthn credential id (base64) for biometric unlock; null when off. */
  biometricCredentialId: string | null;
  /** Background/idle time before re-locking, in ms. */
  autoLockMs: number;
}

const DEFAULT_APP_LOCK: AppLockConfig = {
  mode: 'off',
  pinSalt: null,
  pinHash: null,
  biometricCredentialId: null,
  autoLockMs: AUTO_LOCK_DEFAULT_MS,
};

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
  /**
   * Optional, opt-in "advanced" levers that re-rank the auto-nominate
   * picks (prefer on-chain identity, prefer less-saturated validators,
   * cap commission). All off by default = the base ranking. Applied
   * client-side to the already-computed candidate set; see
   * docs/validator-selection.md.
   */
  autoNominateLevers: QualityLevers;
  /** Opt-in app-lock (access gate). See AppLockConfig. */
  appLock: AppLockConfig;

  setEndpoint(endpoint: string): void;
  setCustomEndpoint(endpoint: string): void;
  toggleHideBalances(): void;
  setStaleThresholdDays(days: number): void;
  setAutoNominateLevers(partial: Partial<QualityLevers>): void;
  resetAutoNominateLevers(): void;
  /** Enable the PIN gate with an already-derived salt + hash. */
  setAppPin(pinSalt: string, pinHash: string): void;
  /** Enable biometric unlock (PIN must already be set, stays as backup). */
  setBiometric(credentialId: string): void;
  /** Turn biometric off, keeping the PIN gate. */
  disableBiometric(): void;
  /** Turn the app lock off and forget the PIN + biometric. */
  disableAppLock(): void;
  /** Update the auto-lock delay (ms). */
  setAutoLockMs(ms: number): void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      endpoint: DEFAULT_ENDPOINT,
      customEndpoint: '',
      hideBalances: false,
      staleThresholdDays: STALE_THRESHOLD_DAYS_DEFAULT,
      autoNominateLevers: { ...DEFAULT_LEVERS },
      appLock: { ...DEFAULT_APP_LOCK },

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

      setAutoNominateLevers(partial: Partial<QualityLevers>) {
        set((s) => ({
          autoNominateLevers: { ...s.autoNominateLevers, ...partial },
        }));
      },

      resetAutoNominateLevers() {
        set({ autoNominateLevers: { ...DEFAULT_LEVERS } });
      },

      setAppPin(pinSalt: string, pinHash: string) {
        set((s) => ({
          appLock: {
            ...s.appLock,
            mode: s.appLock.mode === 'biometric' ? 'biometric' : 'pin',
            pinSalt,
            pinHash,
          },
        }));
      },

      setBiometric(credentialId: string) {
        // Biometric is additive on top of the PIN; only flip the mode when
        // a PIN already exists (the required backup). Otherwise no-op.
        set((s) =>
          s.appLock.pinHash
            ? {
                appLock: {
                  ...s.appLock,
                  mode: 'biometric',
                  biometricCredentialId: credentialId,
                },
              }
            : s
        );
      },

      disableBiometric() {
        set((s) => ({
          appLock: {
            ...s.appLock,
            mode: s.appLock.pinHash ? 'pin' : 'off',
            biometricCredentialId: null,
          },
        }));
      },

      disableAppLock() {
        set((s) => ({
          appLock: {
            ...s.appLock,
            mode: 'off',
            pinSalt: null,
            pinHash: null,
            biometricCredentialId: null,
          },
        }));
      },

      setAutoLockMs(ms: number) {
        set((s) => ({ appLock: { ...s.appLock, autoLockMs: ms } }));
      },
    }),
    { name: 'xx-wallet:settings' }
  )
);
