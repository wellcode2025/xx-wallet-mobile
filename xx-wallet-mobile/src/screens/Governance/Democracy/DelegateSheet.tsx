import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { BN } from '@polkadot/util';
import { Check } from 'lucide-react';
import { Sheet, TxFooter } from '@/components/ui';
import { useAccountsStore } from '@/store';
import { useBalance } from '@/hooks';
import {
  CONVICTIONS,
  convictionMultiplier,
  voteWeight,
  type ConvictionId,
} from '@/hooks';
import { formatBalance } from '@/utils';
import { isValidXxAddress } from '@/utils/address';
import { parseAmount } from './VoteSheet';

/**
 * Phase 4b Slice 7 — Delegate voting power to another account.
 *
 * Submits `democracy.delegate(target: MultiAddress, conviction: Conviction,
 * balance: u128)`. The target votes on the delegator's behalf at the
 * chosen conviction × balance weight on every active referendum until
 * the delegator calls `undelegate()`.
 *
 * Conviction id is the same 0–6 range as for direct votes — None (0.1×)
 * through Locked6x (32 days). Higher conviction means more vote weight
 * for the delegator but a longer lock if the delegator undelegates or
 * the target votes.
 */

interface DelegateSheetProps {
  open: boolean;
  onClose: () => void;
  /** Optional pre-filled target (e.g. when opened from a council member row). */
  initialTarget?: string;
}

export function DelegateSheet({
  open,
  onClose,
  initialTarget,
}: DelegateSheetProps) {
  const accounts = useAccountsStore((s) => s.accounts);
  const activeAddress = useAccountsStore((s) => s.activeAddress);
  const [signerAddress, setSignerAddress] = useState<string>(
    () => activeAddress ?? accounts[0]?.address ?? ''
  );
  const [target, setTarget] = useState(initialTarget ?? '');
  const [amountStr, setAmountStr] = useState('');
  const [conviction, setConviction] = useState<ConvictionId>(1);

  useEffect(() => {
    if (!open) return;
    if (!signerAddress || !accounts.some((a) => a.address === signerAddress)) {
      setSignerAddress(activeAddress ?? accounts[0]?.address ?? '');
    }
    if (initialTarget && !target) setTarget(initialTarget);
  }, [open, activeAddress, accounts, signerAddress, initialTarget, target]);

  useEffect(() => {
    if (open) return;
    setTarget('');
    setAmountStr('');
    setConviction(1);
  }, [open]);

  const { balance } = useBalance(signerAddress || null);
  const available = balance?.transferable ?? new BN(0);

  const amountBn = useMemo(() => parseAmount(amountStr), [amountStr]);
  const targetValid = useMemo(() => isValidXxAddress(target.trim()), [target]);
  const balanceValid = !!amountBn && !amountBn.gt(available);
  const targetIsSelf = target.trim() === signerAddress;
  const formValid = targetValid && balanceValid && !targetIsSelf;

  const previewVotePower = useMemo(
    () => (amountBn ? voteWeight(amountBn, conviction) : null),
    [amountBn, conviction]
  );

  return (
    <Sheet open={open} onClose={onClose} title="Delegate voting power">
      <div className="space-y-4">
        <TargetInput value={target} onChange={setTarget} />
        {target.trim() && !targetValid && (
          <p className="text-xs text-warning">
            Not a valid xx address.
          </p>
        )}
        {targetIsSelf && (
          <p className="text-xs text-warning">
            You can't delegate to yourself.
          </p>
        )}

        <ConvictionPicker conviction={conviction} onChange={setConviction} />

        <BalanceInput
          value={amountStr}
          onChange={setAmountStr}
          available={available}
        />
        {amountBn && amountBn.gt(available) && (
          <p className="text-xs text-warning">Balance exceeds available.</p>
        )}

        {previewVotePower && (
          <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3">
            <p className="text-xs text-ink-400">Delegated vote power</p>
            <p className="font-mono text-sm text-ink-100 numeric">
              {formatBalance(previewVotePower, {
                decimals: 4,
                trim: true,
                grouping: true,
              })}{' '}
              <span className="text-ink-400">XX</span>
            </p>
            <p className="text-xs text-ink-400 mt-1">
              = {formatBalance(amountBn, {
                decimals: 4,
                trim: true,
                grouping: true,
              })}{' '}
              XX × {convictionMultiplier(conviction)}×
            </p>
          </div>
        )}

        <TxFooter
          signerAddress={signerAddress}
          onSignerChange={setSignerAddress}
          accounts={accounts}
          txBuilder={(api) =>
            api.tx.democracy.delegate(
              target.trim(),
              conviction,
              amountBn ?? new BN(0)
            )
          }
          formValid={formValid}
          submitLabel="Delegate"
          successTitle="Delegation set"
          successBody="Your delegated vote power is active on chain."
          onDismiss={onClose}
        />
      </div>
    </Sheet>
  );
}

function TargetInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-ink-400">Delegate to address</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="6Xx…"
        spellCheck={false}
        className="w-full px-3 py-2.5 rounded-2xl bg-ink-900 border border-ink-800 text-sm font-mono text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-ink-600"
      />
    </div>
  );
}

function BalanceInput({
  value,
  onChange,
  available,
}: {
  value: string;
  onChange: (v: string) => void;
  available: BN;
}) {
  const onMax = () => {
    if (available.isZero()) return;
    onChange(
      formatBalance(available, { decimals: 9, trim: true, grouping: false })
    );
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-xs text-ink-400">Balance to delegate</label>
        <button
          type="button"
          onClick={onMax}
          disabled={available.isZero()}
          className="text-xs text-xx-500 active:text-xx-400 disabled:text-ink-500"
        >
          Max
        </button>
      </div>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="0.0000"
          className="w-full pl-3 pr-12 py-2.5 rounded-2xl bg-ink-900 border border-ink-800 text-base font-mono text-ink-100 numeric placeholder:text-ink-500 focus:outline-none focus:border-ink-600"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-400 pointer-events-none">
          XX
        </span>
      </div>
      <p className="text-xs text-ink-400">
        Available:{' '}
        <span className="font-mono text-ink-300">
          {formatBalance(available, {
            decimals: 4,
            trim: true,
            grouping: true,
          })}{' '}
          XX
        </span>
      </p>
    </div>
  );
}

function ConvictionPicker({
  conviction,
  onChange,
}: {
  conviction: ConvictionId;
  onChange: (id: ConvictionId) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-ink-400">Conviction</label>
      <div className="grid grid-cols-1 gap-1.5">
        {CONVICTIONS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id as ConvictionId)}
            className={clsx(
              'flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-colors',
              conviction === c.id
                ? 'bg-xx-500/10 text-xx-500 border border-xx-500/30'
                : 'bg-ink-900 text-ink-300 border border-ink-800 active:bg-ink-800'
            )}
          >
            <span>{c.label}</span>
            {conviction === c.id && <Check size={14} strokeWidth={2.5} />}
          </button>
        ))}
      </div>
    </div>
  );
}
