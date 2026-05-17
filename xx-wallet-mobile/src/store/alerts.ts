/**
 * Alerts store — in-wallet inbox for actionable slash notifications.
 *
 * The notification scaffold emits WalletEvents through registered
 * sinks. One of the registered sinks (in src/notifications/inlineSink.ts)
 * pushes slash-flavored events into this store so a banner on
 * MyNominations can render them directly — no external sink required.
 *
 * Persisted to localStorage so a slash alert survives a reload during
 * the 27-era defer window (the actionable period). Entries auto-prune
 * on read once their applicableEra has passed by 2 eras (any genuine
 * reason to act has gone with it).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AlertKind = 'slash.reported' | 'slash.applied';

export interface SlashReportedAlert {
  id: string;
  kind: 'slash.reported';
  validatorAddress: string;
  fraction: number;
  slashEra: number;
  applicableEra: number;
  affectedUserAddress: string;
  isOwnValidator: boolean;
  blockNumber: number;
  /** UTC milliseconds when the wallet observed the event. */
  observedAt: number;
  /** User dismissed it from the banner. The alert persists in the store
   *  for record-keeping but doesn't render. */
  dismissed: boolean;
}

export interface SlashAppliedAlert {
  id: string;
  kind: 'slash.applied';
  stakerAddress: string;
  amount: string;
  blockNumber: number;
  observedAt: number;
  dismissed: boolean;
}

export type Alert = SlashReportedAlert | SlashAppliedAlert;

interface AlertsState {
  alerts: Alert[];
  /** Add an alert. Dedup'd by id. */
  push: (alert: Alert) => void;
  /** Hide an alert from the banner. Stays in localStorage for the
   *  audit trail. */
  dismiss: (id: string) => void;
  /** Clear everything. Useful after a user signs a chill that resolves
   *  the underlying offence. */
  clearForValidator: (validatorAddress: string) => void;
  /** Read currently-actionable alerts: not dismissed, applicableEra not
   *  yet past (with a 2-era grace). */
  activeFor: (activeEra: number | null) => Alert[];
}

const STORE_KEY = 'xx-wallet:alerts';
const APPLICABLE_ERA_GRACE = 2;

export const useAlertsStore = create<AlertsState>()(
  persist(
    (set, get) => ({
      alerts: [],
      push: (alert) =>
        set((s) =>
          s.alerts.some((a) => a.id === alert.id)
            ? s
            : { alerts: [alert, ...s.alerts].slice(0, 50) }
        ),
      dismiss: (id) =>
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id ? { ...a, dismissed: true } : a
          ),
        })),
      clearForValidator: (validatorAddress) =>
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.kind === 'slash.reported' &&
            a.validatorAddress === validatorAddress
              ? { ...a, dismissed: true }
              : a
          ),
        })),
      activeFor: (activeEra) =>
        get().alerts.filter((a) => {
          if (a.dismissed) return false;
          if (a.kind !== 'slash.reported') return true;
          if (activeEra === null) return true;
          return a.applicableEra + APPLICABLE_ERA_GRACE >= activeEra;
        }),
    }),
    { name: STORE_KEY, version: 1 }
  )
);
