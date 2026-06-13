import { useMemo } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { TopBar } from '@/components/layout';
import { useAccountsStore } from '@/store';
import { useAutoNominate } from '@/hooks';

/**
 * Staking section layout — shared chrome for the staking
 * surfaces. TopBar plus a segmented control switching between the
 * section's peer views; the active view renders through the Outlet.
 *
 * Sub-routes: index = My Nominations (account-scoped), /validators =
 * the network-wide Validator List, /rewards = per-account rewards
 * history. Validator detail and the Start-staking bond flow are
 * pushed drill-downs, not segments.
 *
 * Pre-fetch — when the user enters the Staking section, fire the
 * auto-nominate selection in the background so the bond flow opens
 * with a warm cache. Measured at ~40s in-browser,
 * which is fine while the user is reading My Nominations / browsing
 * Validators but jarring as on-screen wait time. The hook is a no-op
 * if a fresh cache already exists for this address.
 */

const TABS = [
  { to: '/staking', label: 'My Nominations', end: true },
  { to: '/staking/validators', label: 'Validators', end: false },
  { to: '/staking/rewards', label: 'Rewards', end: false },
];

export function StakingLayout() {
  const { accounts, activeAddress } = useAccountsStore();
  const activeAccount = useMemo(
    () => accounts.find((a) => a.address === activeAddress) ?? accounts[0],
    [accounts, activeAddress]
  );
  // Fire-and-forget pre-fetch — result is consumed by the bond flow.
  useAutoNominate(activeAccount?.address ?? null, { mode: 'prefetch' });

  return (
    <>
      <TopBar title="Staking" />
      <div className="px-5 pt-4">
        <div className="flex gap-1 p-1 rounded-2xl bg-ink-900 border border-ink-800">
          {TABS.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'flex-1 text-center text-sm font-medium py-2 rounded-xl transition-colors',
                  isActive
                    ? 'bg-ink-800 text-xx-500'
                    : 'text-ink-300 active:bg-ink-800/50'
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      </div>
      <Outlet />
    </>
  );
}
