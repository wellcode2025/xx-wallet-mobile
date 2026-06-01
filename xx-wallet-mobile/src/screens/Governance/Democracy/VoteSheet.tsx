import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import BigNumber from 'bignumber.js';
import { BN } from '@polkadot/util';
import { Check, X } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { useAccountsStore } from '@/store';
import { useBalance, useTx } from '@/hooks';
import {
  CONVICTIONS,
  encodeVoteByte,
  validateVoteInputs,
  voteWeight,
  type ConvictionId,
} from '@/hooks';
import { formatBalance } from '@/utils';
import { displayName, useIdentity } from '@/governance';

/**
 * Phase 4b Slice 6 — Vote action sheet.
 *
 * Submits `democracy.vote(refIndex, AccountVote::Standard{vote, balance})`
 * where vote is the packed u8 from encodeVoteByte.
 *
 * Per feedback_multisig_signer_picker the signer is explicitly chosen
 * via the "Signed by" picker — defaulting to the active account but
 * NEVER silently submitting under it without a user-visible choice.
 *
 * Per feedback_surface_error_message_on_screen any submit failure shows
 * the actual error.message (decoded if it's a dispatch error — useTx
 * handles that) below the generic "Vote failed" line.
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

  // Signer state — defaults to active account, user can pick another.
  const [signerAddress, setSignerAddress] = useState<string>(
    () => activeAddress ?? accounts[0]?.address ?? ''
  );

  // Form state.
  const [aye, setAye] = useState<boolean>(initialAye);
  const [amountStr, setAmountStr] = useState('');
  const [conviction, setConviction] = useState<ConvictionId>(1);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Re-derive default signer when the sheet opens or the active account
  // changes. Don't override an explicit user pick mid-flow.
  useEffect(() => {
    if (!open) return;
    if (
      !signerAddress ||
      !accounts.some((a) => a.address === signerAddress)
    ) {
      setSignerAddress(activeAddress ?? accounts[0]?.address ?? '');
    }
  }, [open, activeAddress, accounts, signerAddress]);

  // Reset state on close.
  useEffect(() => {
    if (open) return;
    setAmountStr('');
    setPassword('');
    setPasswordError(null);
  }, [open]);

  // Sync aye with the initialAye prop when the sheet opens.
  useEffect(() => {
    if (open) setAye(initialAye);
  }, [open, initialAye]);

  const { balance } = useBalance(signerAddress || null);
  const available = balance?.transferable ?? new BN(0);

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
        : { ok: false, error: 'balance-required' as const },
    [amountBn, available, conviction, refIndex]
  );

  const previewVotePower = useMemo(
    () => (amountBn ? voteWeight(amountBn, conviction) : null),
    [amountBn, conviction]
  );

  const { submit, status, error, reset: resetTx } = useTx();
  const isSubmitting =
    status === 'signing' ||
    status === 'broadcasting' ||
    status === 'in-block';
  const isFinalized = status === 'finalized';

  const onSubmit = async () => {
    if (validation.ok === false || !amountBn) return;
    if (!password.trim()) {
      setPasswordError('Enter your password to sign');
      return;
    }
    setPasswordError(null);

    try {
      const voteByte = encodeVoteByte(aye, conviction);
      await submit(
        (api) =>
          api.tx.democracy.vote(refIndex, {
            Standard: {
              vote: voteByte,
              balance: amountBn,
            },
          } as any),
        { address: signerAddress, password }
      );
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (
        msg.toLowerCase().includes('password') ||
        msg.toLowerCase().includes('unable to decode') ||
        msg.toLowerCase().includes('incorrect')
      ) {
        setPasswordError('Incorrect password. Please try again.');
      }
    }
  };

  const dismissSuccess = () => {
    resetTx();
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Vote on referendum #${refIndex}`}>
      {isFinalized ? (
        <SuccessState onDismiss={dismissSuccess} />
      ) : (
        <div className="space-y-4">
          <AyeNayToggle aye={aye} onChange={setAye} disabled={isSubmitting} />

          <BalanceInput
            value={amountStr}
            onChange={setAmountStr}
            available={available}
            disabled={isSubmitting}
          />

          <ConvictionPicker
            conviction={conviction}
            onChange={setConviction}
            disabled={isSubmitting}
          />

          {previewVotePower && (
            <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3">
              <p className="text-xs text-ink-400">Vote power</p>
              <p className="font-mono text-sm text-ink-100 numeric">
                {formatBalance(previewVotePower, {
                  decimals: 4,
                  trim: true,
                  grouping: true,
                })}{' '}
                <span className="text-ink-400">XX</span>
              </p>
              <p className="text-xs text-ink-500 mt-1">
                = {formatBalance(amountBn ?? new BN(0), {
                  decimals: 4,
                  trim: true,
                  grouping: true,
                })}{' '}
                XX × {CONVICTIONS[conviction].multiplier}×
              </p>
            </div>
          )}

          <SignerPicker
            accounts={accounts}
            signerAddress={signerAddress}
            onChange={setSignerAddress}
            disabled={isSubmitting}
          />

          <PasswordField
            value={password}
            onChange={(v) => {
              setPassword(v);
              setPasswordError(null);
            }}
            error={passwordError}
            disabled={isSubmitting}
          />

          {error && status === 'error' && (
            <div className="rounded-xl border border-danger/40 bg-danger/5 p-3 space-y-1">
              <p className="text-xs text-danger font-medium">Vote failed</p>
              <p className="text-xs text-ink-400 font-mono break-all">
                {error.message || String(error)}
              </p>
            </div>
          )}

          <button
            onClick={onSubmit}
            disabled={validation.ok === false || isSubmitting}
            className="w-full py-3 rounded-2xl bg-xx-500 text-ink-950 font-display font-medium text-base active:bg-xx-600 disabled:opacity-40 disabled:active:bg-xx-500 transition-colors"
          >
            {isSubmitting ? statusLabel(status) : 'Submit vote'}
          </button>

          {validation.ok === false && amountStr.length > 0 && (
            <p className="text-xs text-warning text-center">
              {validationLabel(validation.error)}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AyeNayToggle({
  aye,
  onChange,
  disabled,
}: {
  aye: boolean;
  onChange: (aye: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onChange(true)}
        disabled={disabled}
        className={clsx(
          'flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-medium text-sm transition-colors',
          aye
            ? 'bg-xx-500/15 text-xx-500 border border-xx-500/40'
            : 'bg-ink-900 text-ink-400 border border-ink-800 active:bg-ink-800',
          disabled && 'opacity-50'
        )}
      >
        <Check size={16} strokeWidth={2} />
        Aye
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        disabled={disabled}
        className={clsx(
          'flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-medium text-sm transition-colors',
          !aye
            ? 'bg-warning/15 text-warning border border-warning/40'
            : 'bg-ink-900 text-ink-400 border border-ink-800 active:bg-ink-800',
          disabled && 'opacity-50'
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
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  available: BN;
  disabled?: boolean;
}) {
  const onMax = () => {
    if (available.isZero()) return;
    // Format with decimals 9 (XX has 9 decimals).
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
        <label className="text-xs text-ink-400">Balance to lock</label>
        <button
          type="button"
          onClick={onMax}
          disabled={disabled || available.isZero()}
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
          disabled={disabled}
          placeholder="0.0000"
          className="w-full pl-3 pr-12 py-2.5 rounded-2xl bg-ink-900 border border-ink-800 text-base font-mono text-ink-100 numeric placeholder:text-ink-500 focus:outline-none focus:border-ink-600 disabled:opacity-50"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-400 pointer-events-none">
          XX
        </span>
      </div>
      <p className="text-xs text-ink-500">
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
  disabled,
}: {
  conviction: ConvictionId;
  onChange: (id: ConvictionId) => void;
  disabled?: boolean;
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
            disabled={disabled}
            className={clsx(
              'flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-colors',
              conviction === c.id
                ? 'bg-xx-500/10 text-xx-500 border border-xx-500/30'
                : 'bg-ink-900 text-ink-300 border border-ink-800 active:bg-ink-800',
              disabled && 'opacity-50'
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

function SignerPicker({
  accounts,
  signerAddress,
  onChange,
  disabled,
}: {
  accounts: Array<{ address: string; name?: string }>;
  signerAddress: string;
  onChange: (addr: string) => void;
  disabled?: boolean;
}) {
  const { identity } = useIdentity(signerAddress);
  const name = displayName(identity, signerAddress);
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-ink-400">Signed by</label>
      <select
        value={signerAddress}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || accounts.length <= 1}
        className="w-full px-3 py-2.5 rounded-2xl bg-ink-900 border border-ink-800 text-sm text-ink-100 focus:outline-none focus:border-ink-600 disabled:opacity-50"
      >
        {accounts.map((a) => (
          <option key={a.address} value={a.address}>
            {a.name || a.address.slice(0, 8) + '…'} ({a.address.slice(0, 5)}…{a.address.slice(-4)})
          </option>
        ))}
      </select>
      {name.secondary && (
        <p className="text-xs text-ink-500 font-mono truncate">
          {name.secondary}
        </p>
      )}
    </div>
  );
}

function PasswordField({
  value,
  onChange,
  error,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-ink-400">Password</label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Your wallet password"
        className={clsx(
          'w-full px-3 py-2.5 rounded-2xl bg-ink-900 border text-sm text-ink-100 focus:outline-none focus:border-ink-600 disabled:opacity-50',
          error ? 'border-danger/50' : 'border-ink-800'
        )}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function SuccessState({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="space-y-3 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-xx-500/10 text-xx-500 flex items-center justify-center">
        <Check size={24} strokeWidth={2.5} />
      </div>
      <p className="font-display text-base text-ink-100">Vote submitted</p>
      <p className="text-sm text-ink-400">
        Your vote is finalized on chain.
      </p>
      <button
        onClick={onDismiss}
        className="w-full py-3 rounded-2xl bg-ink-800 text-ink-100 font-medium text-base active:bg-ink-700 transition-colors"
      >
        Done
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLANCK_PER_XX = new BigNumber(1_000_000_000); // 9 decimals

function parseAmount(s: string): BN | null {
  if (!s.trim()) return null;
  try {
    const x = new BigNumber(s);
    if (!x.isFinite() || x.isNegative()) return null;
    if (x.isZero()) return null;
    const planck = x.times(PLANCK_PER_XX);
    if (!planck.isInteger()) {
      // Truncate to integer planck (xx has 9 decimals, beyond that is lost).
      return new BN(planck.integerValue(BigNumber.ROUND_DOWN).toFixed(0));
    }
    return new BN(planck.toFixed(0));
  } catch {
    return null;
  }
}

function statusLabel(s: ReturnType<typeof useTx>['status']): string {
  switch (s) {
    case 'signing':
      return 'Signing…';
    case 'broadcasting':
      return 'Broadcasting…';
    case 'in-block':
      return 'In block, waiting for finality…';
    default:
      return 'Submitting…';
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
