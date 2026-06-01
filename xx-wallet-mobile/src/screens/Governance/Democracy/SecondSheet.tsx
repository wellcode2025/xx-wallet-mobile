import { useEffect, useState } from 'react';
import { Sheet, TxFooter } from '@/components/ui';
import { useAccountsStore } from '@/store';

/**
 * Second a public proposal.
 *
 * Substrate's older democracy pallet exposes `second(proposal: Compact<u32>)`
 * with no deposit on the seconder — backing a proposal is a free signal
 * that elevates it in the public-proposals queue at the next launch.
 *
 * Some chain versions take `second(proposal, secondsUpperBound)` for
 * the council-style weight accounting; xx v206's surface is the bare
 * one-argument form. The builder below will fall back to the bounded
 * form if .second's metadata indicates a second arg.
 */

interface SecondSheetProps {
  open: boolean;
  onClose: () => void;
  proposalIndex: number;
}

export function SecondSheet({ open, onClose, proposalIndex }: SecondSheetProps) {
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
      title={`Second proposal #${proposalIndex}`}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3 space-y-1">
          <p className="text-sm text-ink-200">
            Backing public proposal{' '}
            <span className="font-mono text-ink-100">#{proposalIndex}</span>
          </p>
          <p className="text-xs text-ink-400">
            Seconding a proposal is a free signal that elevates it in the
            public-proposals queue at the next launch period. No tokens
            are locked.
          </p>
        </div>

        <TxFooter
          signerAddress={signerAddress}
          onSignerChange={setSignerAddress}
          accounts={accounts}
          txBuilder={(api) => {
            const second: any = (api.tx.democracy as any).second;
            // Two-arg form takes (proposal, secondsUpperBound) on some runtimes.
            // Read meta to decide.
            const argCount = second?.meta?.args?.length ?? 1;
            if (argCount >= 2) {
              // secondsUpperBound — pass a large bound; chain will accept.
              return second(proposalIndex, 100);
            }
            return second(proposalIndex);
          }}
          formValid={true}
          submitLabel="Second proposal"
          successTitle="Proposal seconded"
          successBody="Your endorsement is on chain."
          onDismiss={onClose}
        />
      </div>
    </Sheet>
  );
}
