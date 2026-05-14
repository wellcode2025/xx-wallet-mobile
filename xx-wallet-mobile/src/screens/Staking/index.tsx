import { Coins } from 'lucide-react';
import { TopBar } from '@/components/layout';

/**
 * Phase 2b Staking tab — landing screen.
 *
 * This is a placeholder during PR 1 (nav restructure). PR 2 replaces
 * the body with slice 1 — My Nominations: for the currently-active
 * account, render staking.nominators with per-target active-in-era
 * status badges, total bonded, and one of three empty states
 * (never-nominated / ex-nominator with history / currently-validating).
 *
 * Slices 2-4 (validator list, validator detail, rewards history) will
 * eventually live under /staking/* sub-routes; this top-level screen
 * either becomes the My Nominations view directly or a hub that
 * renders it by default. Decision deferred until the Phase 2b
 * implementation pass is further along.
 */
export function Staking() {
  return (
    <>
      <TopBar title="Staking" />
      <div className="px-5 py-12 flex flex-col items-center text-center gap-4">
        <div className="w-16 h-16 rounded-full bg-ink-800 border border-ink-700 flex items-center justify-center">
          <Coins size={28} strokeWidth={1.5} className="text-ink-400" />
        </div>
        <div className="space-y-1 max-w-xs">
          <p className="font-display font-medium text-base text-ink-100">
            Staking coming soon
          </p>
          <p className="text-sm text-ink-400">
            Read-only nomination and validator views land in the next pass.
          </p>
        </div>
      </div>
    </>
  );
}
