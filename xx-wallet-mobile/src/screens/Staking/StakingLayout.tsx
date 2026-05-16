import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { TopBar } from '@/components/layout';

/**
 * Staking section layout — shared chrome for the Phase 2b staking
 * surfaces. TopBar plus a segmented control switching between the
 * section's peer views; the active view renders through the Outlet.
 *
 * Sub-routes: index = My Nominations (account-scoped), /validators =
 * the network-wide Validator List, /rewards = per-account rewards
 * history. Validator detail is a pushed drill-down, not a segment.
 */

const TABS = [
  { to: '/staking', label: 'My Nominations', end: true },
  { to: '/staking/validators', label: 'Validators', end: false },
  { to: '/staking/rewards', label: 'Rewards', end: false },
];

export function StakingLayout() {
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
                    : 'text-ink-400 active:bg-ink-800/50'
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
