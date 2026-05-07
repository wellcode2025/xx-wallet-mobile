import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Eye, EyeOff, ChevronDown, Loader2 } from 'lucide-react';
import { useAccountsStore, useSettingsStore } from '@/store';
import { useBalance, useTransfers } from '@/hooks';
import { formatBalance, splitBalance } from '@/utils';
import { XX_SYMBOL } from '@/api';
import { TopBar } from '@/components/layout';
import { AddressIcon, AddressChip, Sheet, TransactionItem } from '@/components/ui';
import clsx from 'clsx';

export function Dashboard() {
  const { accounts, activeAddress, setActive } = useAccountsStore();
  const { hideBalances, toggleHideBalances } = useSettingsStore();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.address === activeAddress) ?? accounts[0],
    [accounts, activeAddress]
  );

  const { balance, isLoading } = useBalance(activeAccount?.address ?? null);
  const { transfers, isLoading: txLoading, error: txError, total: txTotal } = useTransfers(activeAccount?.address ?? null);

  const hero = useMemo(() => {
    if (!balance) return { integer: '0', fraction: '0000' };
    return splitBalance(balance.transferable, 4);
  }, [balance]);

  if (!activeAccount) {
    // Shouldn't happen if the route guard works, but just in case
    return null;
  }

  return (
    <>
      <TopBar
        title="Wallet"
        right={
          <button
            onClick={toggleHideBalances}
            className="p-2 rounded-full active:bg-ink-800"
            aria-label={hideBalances ? 'Show balances' : 'Hide balances'}
          >
            {hideBalances ? (
              <EyeOff size={20} strokeWidth={1.75} />
            ) : (
              <Eye size={20} strokeWidth={1.75} />
            )}
          </button>
        }
      />

      <div className="px-5 py-4 space-y-5">
        {/* Account switcher */}
        <button
          onClick={() => accounts.length > 1 && setSwitcherOpen(true)}
          className="w-full flex items-center gap-3 p-3 rounded-2xl bg-ink-900 border border-ink-800 active:bg-ink-800"
        >
          <AddressIcon address={activeAccount.address} size={40} />
          <div className="flex-1 min-w-0 text-left">
            <p className="font-display font-medium text-base truncate">
              {activeAccount.name}
            </p>
            <p className="font-mono text-xs text-ink-400 truncate">
              {activeAccount.address.slice(0, 10)}…
              {activeAccount.address.slice(-6)}
            </p>
          </div>
          {accounts.length > 1 && (
            <ChevronDown size={18} className="text-ink-400 flex-shrink-0" />
          )}
        </button>

        {/* Balance hero */}
        <div className="relative overflow-hidden rounded-3xl border border-ink-800 bg-ink-900 grain">
          <div className="absolute inset-0 bg-mesh opacity-40 pointer-events-none" />
          <div className="relative p-6 space-y-5">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                Transferable
              </span>
              {isLoading && !balance && (
                <span className="text-xs text-ink-500 animate-pulse-subtle">
                  Loading…
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-2">
              {hideBalances ? (
                <span className="text-balance-xl text-ink-100">••••••</span>
              ) : (
                <>
                  <span className="text-balance-xl text-ink-100 numeric">
                    {hero.integer}
                  </span>
                  <span className="text-2xl text-ink-400 numeric font-display font-medium">
                    .{hero.fraction}
                  </span>
                </>
              )}
              <span className="text-sm text-ink-300 font-display font-medium ml-1">
                {XX_SYMBOL}
              </span>
            </div>

            {/* Breakdown */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-ink-800/80">
              <BalanceRow
                label="Reserved"
                value={balance?.reserved}
                hidden={hideBalances}
              />
              <BalanceRow
                label="Frozen"
                value={balance?.frozen}
                hidden={hideBalances}
              />
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-3">
          <Link to="/send" className="btn-primary">
            <ArrowUpRight size={18} strokeWidth={2} />
            Send
          </Link>
          <Link to="/receive" className="btn-secondary">
            <ArrowDownLeft size={18} strokeWidth={2} />
            Receive
          </Link>
        </div>

        {/* Address card */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-ink-400 font-medium">
              Your address
            </span>
            <AddressChip address={activeAccount.address} shortened className="flex-shrink-0" />
          </div>
          <p className="font-mono text-xs text-ink-300 break-all leading-relaxed select-all">
            {activeAccount.address}
          </p>
        </div>

        {/* Transaction history */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-medium text-sm text-ink-200">
              Recent activity
              {txTotal > 0 && (
                <span className="ml-2 text-xs text-ink-400 font-sans font-normal">
                  ({txTotal.toLocaleString()} total)
                </span>
              )}
            </h3>
            {txLoading && (
              <div className="flex items-center gap-1.5 text-xs text-ink-400">
                <Loader2 size={12} className="animate-spin" />
                Loading…
              </div>
            )}
          </div>

          {txError && (
            <p className="text-xs text-danger py-2">
              Could not load history — check your connection.
            </p>
          )}

          {transfers.length === 0 && !txLoading && (
            <p className="text-sm text-ink-400 py-2">
              No recent transactions found.
            </p>
          )}

          {transfers.length === 0 && txLoading && (
            <div className="space-y-3 py-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-ink-700/50 animate-pulse-subtle" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 rounded bg-ink-700/50 animate-pulse-subtle w-2/3" />
                    <div className="h-2.5 rounded bg-ink-700/30 animate-pulse-subtle w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {transfers.map((tx) => (
            <TransactionItem
              key={tx.id}
              transfer={tx}
            />
          ))}
        </div>
      </div>

      {/* Account switcher sheet */}
      <Sheet
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        title="Switch account"
      >
        <ul className="space-y-2">
          {accounts.map((acct) => (
            <li key={acct.address}>
              <button
                onClick={() => {
                  setActive(acct.address);
                  setSwitcherOpen(false);
                }}
                className={clsx(
                  'w-full flex items-center gap-3 p-3 rounded-2xl border transition-colors',
                  acct.address === activeAccount.address
                    ? 'bg-xx-500/10 border-xx-500/40'
                    : 'bg-ink-800 border-ink-700/50 active:bg-ink-700'
                )}
              >
                <AddressIcon address={acct.address} size={36} />
                <div className="flex-1 min-w-0 text-left">
                  <p className="font-medium text-sm truncate">{acct.name}</p>
                  <p className="font-mono text-xs text-ink-400 truncate">
                    {acct.address.slice(0, 12)}…
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}

function BalanceRow({
  label,
  value,
  hidden,
}: {
  label: string;
  // Mirror whatever formatBalance accepts so a future signature change
  // propagates here without manual upkeep. Currently BN | bigint | string
  // | null | undefined.
  value: Parameters<typeof formatBalance>[0];
  hidden: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-ink-500 font-medium mb-0.5">
        {label}
      </p>
      <p className="font-mono text-sm text-ink-200">
        {hidden ? '••••' : formatBalance(value, { decimals: 4 })}
      </p>
    </div>
  );
}
