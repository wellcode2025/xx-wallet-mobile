import { useNavigate } from 'react-router-dom';
import { ChevronRight, Coins, RefreshCcw, StopCircle } from 'lucide-react';
import { Sheet } from '@/components/ui';

/**
 * Phase 3 slice 2 — Manage stake.
 *
 * Triggered from MyNominations when the active account is bonded
 * and nominating. Three actions, each routing to its own screen:
 *
 *   - /staking/add    — staking.bondExtra (add to bonded amount)
 *   - /staking/change — staking.nominate (replace nominations)
 *   - /staking/chill  — staking.chill (stop nominating)
 *
 * Unbond + withdraw arrive in slice 3 and will live alongside these.
 */
export interface ManageStakeSheetProps {
  open: boolean;
  onClose: () => void;
}

export function ManageStakeSheet({ open, onClose }: ManageStakeSheetProps) {
  const navigate = useNavigate();

  const go = (route: string) => {
    onClose();
    navigate(route);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Manage stake">
      <div className="px-5 pb-5">
        <ul className="rounded-2xl bg-ink-950 border border-ink-800 overflow-hidden">
          <ManageRow
            icon={<Coins size={18} strokeWidth={1.75} />}
            title="Add to stake"
            subtitle="Bond more XX onto this account. Adds to your existing stake — earns rewards from the next era."
            onTap={() => go('/staking/add')}
          />
          <ManageRow
            icon={<RefreshCcw size={18} strokeWidth={1.75} />}
            title="Change validators"
            subtitle="Replace your nomination set with a new one. Auto-recommend picks the top 16 by projected return."
            onTap={() => go('/staking/change')}
          />
          <ManageRow
            icon={<StopCircle size={18} strokeWidth={1.75} />}
            title="Stop nominating"
            subtitle="Chill your nominations. Bonded XX stays bonded — the 28-day unbond clock doesn't start."
            onTap={() => go('/staking/chill')}
            tone="warning"
          />
        </ul>
        <p className="text-xs text-ink-400 mt-3 px-1">
          Unbond and withdraw flows arrive in the next slice. For now,
          changes above are reversible and don't start any 28-day clocks.
        </p>
      </div>
    </Sheet>
  );
}

function ManageRow({
  icon,
  title,
  subtitle,
  onTap,
  tone = 'default',
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onTap: () => void;
  tone?: 'default' | 'warning';
}) {
  return (
    <li className="border-b border-ink-800/60 last:border-0">
      <button
        onClick={onTap}
        className="w-full flex items-start gap-3 py-3 px-4 active:bg-ink-800/50 transition-colors text-left"
      >
        <div
          className={
            tone === 'warning'
              ? 'w-9 h-9 rounded-full bg-warning/10 text-warning flex items-center justify-center flex-shrink-0'
              : 'w-9 h-9 rounded-full bg-xx-500/10 text-xx-500 flex items-center justify-center flex-shrink-0'
          }
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-medium text-sm text-ink-100">
            {title}
          </p>
          <p className="text-xs text-ink-400 mt-0.5">{subtitle}</p>
        </div>
        <ChevronRight
          size={16}
          strokeWidth={1.75}
          className="text-ink-500 flex-shrink-0 mt-2"
        />
      </button>
    </li>
  );
}
