import { useEffect, useState } from 'react';
import { Sheet, TxFooter } from '@/components/ui';
import { useAccountsStore } from '@/store';
import { displayName, useIdentity } from '@/governance';

/**
 * Phase 4b Slice 7 — Stop delegating.
 *
 * Submits `democracy.undelegate()`. No args; clears the delegating
 * voter state on chain for the signer's account. The conviction lock
 * the user set when they delegated still applies until its lock end.
 */

interface UndelegateSheetProps {
  open: boolean;
  onClose: () => void;
  /** Current delegation target, for the confirm copy. */
  currentTarget: string;
}

export function UndelegateSheet({
  open,
  onClose,
  currentTarget,
}: UndelegateSheetProps) {
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

  const { identity } = useIdentity(currentTarget);
  const targetName = displayName(identity, currentTarget);

  return (
    <Sheet open={open} onClose={onClose} title="Stop delegating">
      <div className="space-y-4">
        <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3 space-y-1">
          <p className="text-sm text-ink-200">
            Stop delegating to{' '}
            <span className="text-ink-100">{targetName.primary}</span>
            {targetName.secondary && (
              <span className="text-ink-400 font-mono"> {targetName.secondary}</span>
            )}
          </p>
          <p className="text-xs text-ink-400">
            Your conviction lock from the original delegation continues
            until its lock end. Once cleared you can vote directly again.
          </p>
        </div>

        <TxFooter
          signerAddress={signerAddress}
          onSignerChange={setSignerAddress}
          accounts={accounts}
          txBuilder={(api) => api.tx.democracy.undelegate()}
          formValid={true}
          submitLabel="Undelegate"
          successTitle="Delegation cleared"
          successBody="You're no longer delegating your vote."
          onDismiss={onClose}
        />
      </div>
    </Sheet>
  );
}
