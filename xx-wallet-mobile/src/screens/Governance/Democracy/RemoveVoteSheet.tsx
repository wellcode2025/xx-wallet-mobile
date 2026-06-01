import { useEffect, useState } from 'react';
import type { BN } from '@polkadot/util';
import { Sheet, TxFooter } from '@/components/ui';
import { useAccountsStore } from '@/store';
import { formatBalance } from '@/utils';

/**
 * Phase 4b Slice 7 — Remove vote on an active referendum.
 *
 * Submits `democracy.removeVote(index: u32)`. Returns the locked
 * balance to the user's transferable balance (subject to any
 * conviction-based prior lock that may persist).
 */

interface RemoveVoteSheetProps {
  open: boolean;
  onClose: () => void;
  refIndex: number;
  /** Locked balance from the original vote, for the confirm copy. */
  lockedAmount?: BN | null;
}

export function RemoveVoteSheet({
  open,
  onClose,
  refIndex,
  lockedAmount,
}: RemoveVoteSheetProps) {
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
    <Sheet
      open={open}
      onClose={onClose}
      title={`Remove vote on #${refIndex}`}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3 space-y-1">
          <p className="text-sm text-ink-200">
            Removing your vote on referendum{' '}
            <span className="font-mono text-ink-100">#{refIndex}</span>
            {lockedAmount && (
              <>
                {' will return '}
                <span className="font-mono text-ink-100">
                  {formatBalance(lockedAmount, {
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
          <p className="text-xs text-ink-400">
            A conviction lock from the original vote may persist until
            its lock end is reached.
          </p>
        </div>

        <TxFooter
          signerAddress={signerAddress}
          onSignerChange={setSignerAddress}
          accounts={accounts}
          txBuilder={(api) => api.tx.democracy.removeVote(refIndex)}
          formValid={true}
          submitLabel="Remove vote"
          successTitle="Vote removed"
          successBody="Your vote is no longer counted on this referendum."
          onDismiss={onClose}
        />
      </div>
    </Sheet>
  );
}
