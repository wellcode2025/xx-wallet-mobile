import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import BigNumber from 'bignumber.js';
import { BN } from '@polkadot/util';
import { Check, X } from 'lucide-react';
import { Sheet, TxFooter } from '@/components/ui';
import { useAccountsStore } from '@/store';
import { useBalance } from '@/hooks';
import {
  CONVICTIONS,
  encodeVoteByte,
  validateVoteInputs,
  voteWeight,
  type ConvictionId,
} from '@/hooks';
import { formatBalance } from '@/utils';

/**
 * Vote action sheet. Uses the shared TxFooter.
 *
 * Submits `democracy.vote(refIndex, AccountVote::Standard{vote, balance})`
 * where vote is the packed u8 from encodeVoteByte. The form chrome
 * (signer picker + password + submit + status + success / error UIs)
 * lives in TxFooter; this component owns only the form-specific
 * inputs (aye/nay, balance, conviction) and the preview math.
 */

interface VoteSheetProps {
  open: boolean;
  onClose: () => void;
  refIndex: number;
  initialAye: boolean;
}

export function VoteSheet({
  open,
  onClose,
  refIndex,
  initialAye,
}: VoteSheetProps) {
  const accounts = useAccountsStore((s) => s.accounts);
  const activeAddress = useAccountsStore((s) => s.activeAddress);

  const [signerAddress, setSignerAddress] = useState<string>(
    () => activeAddress ?? accounts[0]?.address ?? ''
  );
  const [aye, setAye] = useState<boolean>(initialAye);
  const [amountStr, setAmountStr] = useState('');
  const [conviction, setConviction] = useState<ConvictionId>(1);

  // Re-derive default signer when the sheet opens.
  useEffect(() => {
    if (!open) return;
    if (
      !signerAddress ||
      !accounts.some((a) => a.address === signerAddress)
    ) {
      setSignerAddress(activeAddress ?? accounts[0]?.address ?? '');
    }
  }, [open, activeAddress, accounts, signerAddress]);

  // Reset form on close.
  useEffect(() => {
    if (open) return;
    setAmountStr('');
  }, [open]);

  useEffect(() => {
    if (open) setAye(initialAye);
  }, [open, initialAye]);

  const { balance } = useBalance(signerAddress || null);
  const available = useMemo(
    () => balance?.transferable ?? new BN(0),
    [balance]
  );

  const amountBn = useMemo(() => parseAmount(amountStr), [amountStr]);

  const validation = useMemo(
    () =>
      amountBn
        ? validateVoteInputs({
            balance: amountBn,
            available,
            conviction,
            refIndex,
          })
        : ({ ok: false, error: 'balance-required' } as const),
    [amountBn, available, conviction, refIndex]
  );

  const previewVotePower = useMemo(
    () => (amountBn ? voteWeight(amountBn, conviction) : null),
    [amountBn, conviction]
  );

  return (
    <Sheet open={open} onClose={onClose} title={`Vote on referendum #${refIndex}`}>
      <div className="space-y-4">
        <AyeNayToggle aye={aye} onChange={setAye} />

        <BalanceInput
          value={amountStr}
          onChange={setAmountStr}
          available={available}
        />

        <ConvictionPicker conviction={conviction} onChange={setConviction} />

        {previewVotePower && (
          <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3">
            <p className="text-xs text-ink-300">Vote power</p>
            <p className="font-mono text-sm text-ink-100 numeric">
              {formatBalance(previewVotePower, {
                decimals: 4,
                trim: true,
                grouping: true,
              })}{' '}
              <span className="text-ink-300">XX</span>
            </p>
            <p className="text-xs text-ink-300 mt-1">
              = {formatBalance(amountBn ?? new BN(0), {
                decimals: 4,
                trim: true,
                grouping: true,
              })}{' '}
              XX × {CONVICTIONS[conviction].multiplier}×
            </p>
          </div>
        )}

        <TxFooter
          signerAddress={signerAddress}
          onSignerChange={setSignerAddress}
          accounts={accounts}
          txBuilder={(api) =>
            api.tx.democracy.vote(refIndex, {
              Standard: {
                vote: amountBn ? encodeVoteByte(aye, conviction) : 0,
                balance: amountBn ?? new BN(0),
              },
            } as any)
          }
          formValid={validation.ok === true}
          submitLabel="Submit vote"
          successTitle="Vote submitted"
          successBody="Your vote is finalized on chain."
          onDismiss={onClose}
        />

        {validation.ok === false && amountStr.length > 0 && (
          <p className="text-xs text-warning text-center">
            {validationLabel(validation.error)}
          </p>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Form sub-components — kept local to VoteSheet, not shared
// ---------------------------------------------------------------------------

function AyeNayToggle({
  aye,
  onChange,
}: {
  aye: boolean;
  onChange: (aye: boolean) => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={clsx(
          'flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-medium text-sm transition-colors',
          aye
            ? 'bg-xx-500/15 text-xx-500 border border-xx-500/40'
            : 'bg-ink-900 text-ink-300 border border-ink-800 active:bg-ink-800'
        )}
      >
        <Check size={16} strokeWidth={2} />
        Aye
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={clsx(
          'flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-medium text-sm transition-colors',
          !aye
            ? 'bg-warning/15 text-warning border border-warning/40'
            : 'bg-ink-900 text-ink-300 border border-ink-800 active:bg-ink-800'
        )}
      >
        <X size={16} strokeWidth={2} />
        Nay
      </button>
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
    const asString = formatBalance(available, {
      decimals: 9,
      trim: true,
      grouping: false,
    });
    onChange(asString);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-xs text-ink-300">Balance to lock</label>
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
          className="w-full pl-3 pr-12 py-2.5 rounded-2xl bg-ink-900 border border-ink-800 text-base font-mono text-ink-100 numeric placeholder:text-ink-300 focus:outline-none focus:border-ink-600"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-300 pointer-events-none">
          XX
        </span>
      </div>
      <p className="text-xs text-ink-300">
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
      <label className="text-xs text-ink-300">Conviction</label>
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLANCK_PER_XX = new BigNumber(1_000_000_000); // 9 decimals

export function parseAmount(s: string): BN | null {
  if (!s.trim()) return null;
  try {
    const x = new BigNumber(s);
    if (!x.isFinite() || x.isNegative()) return null;
    if (x.isZero()) return null;
    const planck = x.times(PLANCK_PER_XX);
    if (!planck.isInteger()) {
      return new BN(planck.integerValue(BigNumber.ROUND_DOWN).toFixed(0));
    }
    return new BN(planck.toFixed(0));
  } catch {
    return null;
  }
}

function validationLabel(
  e: Exclude<ReturnType<typeof validateVoteInputs>, { ok: true }>['error']
): string {
  switch (e) {
    case 'balance-required':
      return 'Enter a balance to lock.';
    case 'balance-exceeds-available':
      return 'Balance exceeds available.';
    case 'conviction-out-of-range':
      return 'Invalid conviction.';
    case 'ref-index-invalid':
      return 'Invalid referendum.';
  }
}
