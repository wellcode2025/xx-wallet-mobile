import { NavLink } from 'react-router-dom';
import { Wallet, Send, QrCode, Settings } from 'lucide-react';
import clsx from 'clsx';

/**
 * Fixed bottom tab bar — the primary navigation on mobile.
 * Sits above the home indicator on iOS via safe-area padding.
 *
 * Only 4 slots are shown in Phase 1. Staking and Governance will take
 * dedicated entries in later phases (and the bar will expand to 5 slots,
 * which is the max for comfortable thumb reach).
 */
export function BottomNav() {
  const tabs = [
    { to: '/', label: 'Wallet', icon: Wallet, end: true },
    { to: '/send', label: 'Send', icon: Send },
    { to: '/receive', label: 'Receive', icon: QrCode },
    { to: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-ink-800 bg-ink-950/95 backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex items-stretch justify-around">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'flex flex-col items-center justify-center gap-1 py-2.5 px-1',
                  'min-h-[56px] transition-colors duration-150',
                  'active:bg-ink-800/60',
                  isActive ? 'text-xx-500' : 'text-ink-400'
                )
              }
            >
              <Icon size={22} strokeWidth={1.75} />
              <span className="text-[10px] font-sans font-medium tracking-wide uppercase">
                {label}
              </span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
