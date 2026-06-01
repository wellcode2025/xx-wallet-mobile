import { useEffect, useState } from 'react';
import type { BN } from '@polkadot/util';
import { Sheet, TxFooter } from '@/components/ui';
import { useAccountsStore } from '@/store';
import { formatBalance } from '@/utils';

/**
 * Phase 4 Slice 9.1 — Release a matured conviction lock.
 *
 * Submits `democracy.unlock(target: MultiAddress)`. Releases any
 * locks on the target account whose unlockAt block has passed; locks
 * still in their lock window stay put. Anyone can call it for any
 * account (no permission check); typically users call it for their
 * own account.
 *
 * The sheet auto-targets the signer — the user picks "Signed by" in
 * TxFooter, and target = signer. If a future flow wants to release
 * locks for a different account (e.g. a custody pattern) the sheet
 * can grow a target picker, but for now the 1:1 signer=target case
 * covers everything Slice 9's notification surfaces.
 */

interface UnlockSheetProps {
  open: boolean;
  onClose: () => void;
  /** Amount currently locked (for the confirm copy). */
  amount?: BN | null;
  /** Block at which the lock matured. */
  unlockAt?: number;
}

export function UnlockSheet({
  open,
  onClose,
  amount,
  unlockAt,
}: UnlockSheetProps) {
  const accounts = useAccountsStore((s) => s.accounts);
  const activeAddress = useAccountsStore((s) => s.activeAddress);
  const [signerAddress, setSignerAddress] = useState<string>(
    () => activeAddress ?? accounts[0]?.address ?? ''
  );

  useEffect(() => {
    if (!open) return;
    if (!signerAddress || !accounts.some((a) => a.address === signerAddress)) {
      setSignerAddress(activeAddress ?? accounts[0]?.address ?? '');
    }
  }, [open, activeAddress, accounts, signerAddress]);

  return (
    <Sheet open={open} onClose={onClose} title="Release locked balance">
      <div className="space-y-4">
        <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3 space-y-1">
          <p className="text-sm text-ink-200">
            Releasing your matured conviction lock
            {amount && (
              <>
                {' will return '}
                <span className="font-mono text-ink-100">
                  {formatBalance(amount, {
                    decimals: 4,
                    trim: true,
                    grouping: true,
                  })}{' '}
                  XX
                </span>
                {' to your transferable balance'}
              </>
            )}
            .
          </p>
          {unlockAt != null && (
            <p className="text-xs text-ink-400">
              The lock matured at block{' '}
              <span className="font-mono">#{unlockAt.toLocaleString()}</span>.
            </p>
          )}
          <p className="text-xs text-ink-400">
            Only locks whose end block has passed get released. Active
            votes and delegations keep their locks until they expire.
          </p>
        </div>

        <TxFooter
          signerAddress={signerAddress}
          onSignerChange={setSignerAddress}
          accounts={accounts}
          txBuilder={(api) => api.tx.democracy.unlock(signerAddress)}
          formValid={!!signerAddress}
          submitLabel="Release lock"
          successTitle="Lock released"
          successBody="The matured portion is back in your transferable balance."
          onDismiss={onClose}
        />
      </div>
    </Sheet>
  );
}
