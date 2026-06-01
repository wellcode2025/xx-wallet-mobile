import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BN } from '@polkadot/util';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ChevronDown, RefreshCcw } from 'lucide-react';

import { useAccountsStore } from '@/store';
import {
  useAutoNominate,
  useBalance,
  useTx,
  invalidateAutoNominateCache,
} from '@/hooks';
import type { AutoNominateValidator, AutoNominateTimings } from '@/staking';
import { formatBalance, parseAmount } from '@/utils';
import { TopBar } from '@/components/layout';
import { AddressLabel, LoadingIndicator } from '@/components/ui';
import { ValidatorPickerSheet } from './ValidatorPickerSheet';

/**
 * Start staking (bond + nominate, one signature).
 *
 * The auto-nominate path uses the wallet's port of the foundation's
 * sequential Phragmén pass to score every elected validator and
 * pick the top 16 by projected return. The hand-pick path opens a
 * sheet wrapping the validator list with multi-select (capped at 16).
 *
 * Submit is `utility.batchAll([staking.bond(stash, amount, null),
 * staking.nominate(targets)])` — one signature for the whole flow.
 * Mirrors the foundation Simple Staker's submit pipeline.
 *
 * On success the auto-nominate cache is invalidated (next bond
 * flow re-selects against fresh chain state) and the user lands
 * back on /staking.
 */

/** Reserve ~0.1 XX for fee + existential deposit when using Max. */
const MIN_FEE_BUFFER = new BN('100000000'); // 0.1 XX in planck

export function StartStaking() {
  const navigate = useNavigate();
  const { accounts, activeAddress } = useAccountsStore();
  const activeAccount = useMemo(
    () => accounts.find((a) => a.address === activeAddress) ?? accounts[0],
    [accounts, activeAddress]
  );

  const { balance } = useBalance(activeAccount?.address);
  const {
    result: autoResult,
    isComputing: autoComputing,
    error: autoError,
    refresh,
  } = useAutoNominate(activeAccount?.address ?? null);
  const { submit, status, error: txError } = useTx();

  // Form state
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'auto' | 'pick'>('auto');
  const [handPicked, setHandPicked] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showValidators, setShowValidators] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Derived
  const parsedAmount = useMemo(() => parseAmount(amount), [amount]);
  const transferable = balance?.transferable ?? null;
  const targets = useMemo(
    () =>
      mode === 'auto'
        ? autoResult?.selected.map((v) => v.validatorId) ?? []
        : handPicked,
    [mode, autoResult, handPicked]
  );

  // Validation
  const parsedAmountBN = useMemo(
    () => (parsedAmount ? new BN(parsedAmount.toFixed(0)) : null),
    [parsedAmount]
  );
  const amountTooLarge = Boolean(
    parsedAmountBN &&
      transferable &&
      parsedAmountBN.gt(transferable.sub(MIN_FEE_BUFFER))
  );
  const amountValid =
    parsedAmountBN !== null && parsedAmountBN.gtn(0) && !amountTooLarge;
  const targetsValid = targets.length > 0 && targets.length <= 16;
  const canSubmit =
    amountValid &&
    targetsValid &&
    password.length > 0 &&
    (status === 'idle' || status === 'error');

  const isSubmitting =
    status === 'signing' || status === 'broadcasting' || status === 'in-block';
  const isDone = status === 'finalized';

  // On finalized: cache invalidate + bounce back to /staking
  useEffect(() => {
    if (status !== 'finalized') return;
    invalidateAutoNominateCache();
    const t = setTimeout(() => navigate('/staking'), 1200);
    return () => clearTimeout(t);
  }, [status, navigate]);

  if (!activeAccount) return null;

  const handleMax = () => {
    if (!transferable) return;
    const max = transferable.sub(MIN_FEE_BUFFER);
    if (max.lten(0)) {
      setAmount('0');
      return;
    }
    // Convert planck BN → human-readable string at full chain precision.
    // grouping:false so the input value can be re-parsed without stripping
    // commas; trim:true strips trailing zeros for a clean display.
    setAmount(formatBalance(max, { decimals: 9, grouping: false }));
  };

  const handleSubmit = async () => {
    if (!canSubmit || !parsedAmountBN || !activeAccount) return;
    setPasswordError(null);
    try {
      await submit(
        (api) => {
          const bondCall = api.tx.staking.bond(
            activeAccount.address,
            parsedAmountBN.toString(),
            null
          );
          const nominateCall = api.tx.staking.nominate(targets);
          return api.tx.utility.batchAll([bondCall, nominateCall]);
        },
        { address: activeAccount.address, password }
      );
    } catch (err) {
      const msg = (err as Error).message.toLowerCase();
      if (
        msg.includes('password') ||
        msg.includes('unable to decode') ||
        msg.includes('incorrect')
      ) {
        setPasswordError('Incorrect password. Please try again.');
      }
      // Other errors fall through to the txError block
    }
  };

  return (
    <>
      <TopBar title="Start staking" showBack />
      <div className="px-5 py-4 space-y-4">
        {/* Account context */}
        <div className="card space-y-2">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Bonding from
          </p>
          <AddressLabel address={activeAccount.address} className="text-sm" />
          {transferable && (
            <p className="text-xs text-ink-400">
              Available:{' '}
              <span className="font-mono text-ink-200">
                {formatBalance(transferable, { decimals: 4, withSymbol: true })}
              </span>
            </p>
          )}
        </div>

        {/* Amount */}
        <div className="card space-y-2">
          <label className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Amount to bond
          </label>
          <div className="flex items-stretch gap-2">
            <div className="flex-1 flex items-center bg-ink-950 border border-ink-800 rounded-2xl px-3 focus-within:border-ink-600">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                className="flex-1 bg-transparent py-2.5 text-base font-mono text-ink-100 placeholder:text-ink-400 focus:outline-none numeric"
              />
              <span className="text-sm text-ink-400 pl-2">XX</span>
            </div>
            <button
              onClick={handleMax}
              disabled={!transferable || transferable.lten(0)}
              className="px-3 rounded-2xl bg-ink-800 text-xx-500 text-xs font-medium active:opacity-80 disabled:opacity-40"
            >
              Max
            </button>
          </div>
          {/* Suppress the validation warning while a submission is in
              flight or done — the balance subscription updates mid-tx
              (as soon as bond is in-block) so amountTooLarge would flash
              true even though the chain is happily processing the bond. */}
          {amountTooLarge && !isSubmitting && !isDone && (
            <p className="text-xs text-danger">
              Exceeds your available balance (reserve ~0.1 XX for fees).
            </p>
          )}
          {(!amountTooLarge || isSubmitting || isDone) && (
            <p className="text-xs text-ink-400">
              Max keeps ~0.1 XX in reserve for the bond fee and existential
              deposit. You can change validators or unbond later.
            </p>
          )}
        </div>

        {/* Validator selection */}
        <div className="card space-y-3">
          <label className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Validators
          </label>

          <div className="flex p-1 rounded-xl bg-ink-950 border border-ink-800 gap-1">
            {(['auto', 'pick'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={clsx(
                  'flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  mode === m
                    ? 'bg-ink-800 text-xx-500'
                    : 'text-ink-400 active:bg-ink-800/50'
                )}
              >
                {m === 'auto' ? 'Auto-recommend' : 'Hand-pick'}
              </button>
            ))}
          </div>

          {mode === 'auto' ? (
            <AutoBlock
              autoComputing={autoComputing}
              autoError={autoError}
              autoResult={autoResult}
              onRefresh={refresh}
              showValidators={showValidators}
              setShowValidators={setShowValidators}
            />
          ) : (
            <PickBlock
              handPicked={handPicked}
              onOpenPicker={() => setPickerOpen(true)}
            />
          )}
        </div>

        {/* Review */}
        {amountValid && targetsValid && (
          <div className="card space-y-2">
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
              Review
            </p>
            <ReviewRow
              label="Bonding"
              value={formatBalance(parsedAmountBN!, {
                decimals: 4,
                withSymbol: true,
              })}
            />
            <ReviewRow
              label="Nominating"
              value={`${targets.length} validator${targets.length === 1 ? '' : 's'}`}
            />
            <ReviewRow label="Network fee" value="~0.02 XX" />
            <div className="flex gap-2 items-start pt-1 text-warning">
              <AlertTriangle size={14} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
              <p className="text-xs">
                Unbonding takes 28 days on xx. You can change validators or
                stop nominating instantly, but withdrawing bonded XX requires
                a 28-day unbond.
              </p>
            </div>
          </div>
        )}

        {/* Password */}
        {amountValid && targetsValid && !isDone && (
          <div className="card space-y-2">
            <label
              htmlFor="bond-password"
              className="text-xs uppercase tracking-wider text-ink-400 font-medium"
            >
              Confirm with password
            </label>
            <input
              id="bond-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(null);
              }}
              disabled={isSubmitting}
              className={clsx(
                'w-full px-3 py-2.5 rounded-2xl bg-ink-950 border text-sm text-ink-100 placeholder:text-ink-400 focus:outline-none',
                passwordError
                  ? 'border-danger focus:border-danger'
                  : 'border-ink-800 focus:border-ink-600'
              )}
              placeholder="Wallet password"
              autoComplete="current-password"
            />
            {passwordError && (
              <p className="text-xs text-danger">{passwordError}</p>
            )}
          </div>
        )}

        {/* CTA */}
        {!isDone && (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || isSubmitting}
            className={clsx(
              'w-full py-3 rounded-2xl text-sm font-medium transition-opacity',
              canSubmit && !isSubmitting
                ? 'bg-xx-500 text-ink-950 active:opacity-80'
                : 'bg-ink-800 text-ink-500 cursor-not-allowed'
            )}
          >
            {submitLabel(status, parsedAmountBN)}
          </button>
        )}

        {/* Done */}
        {isDone && (
          <div className="card flex flex-col items-center text-center gap-3 py-6">
            <CheckCircle2 size={36} className="text-success" />
            <p className="font-display font-medium text-sm text-ink-100">
              Bonded and nominating
            </p>
            <p className="text-xs text-ink-400">
              Returning to staking…
            </p>
          </div>
        )}

        {/* Tx error */}
        {txError && !passwordError && (
          <div className="card">
            <p className="text-sm text-danger">{txError.message}</p>
          </div>
        )}
      </div>

      <ValidatorPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        initial={handPicked}
        onConfirm={(selected) => {
          setHandPicked(selected);
          setPickerOpen(false);
        }}
      />
    </>
  );
}

function submitLabel(status: string, amount: BN | null): string {
  if (status === 'signing') return 'Signing…';
  if (status === 'broadcasting') return 'Sending to network…';
  if (status === 'in-block') return 'Waiting for finality…';
  if (!amount) return 'Stake';
  return `Stake ${formatBalance(amount, { decimals: 4, withSymbol: true })}`;
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-ink-400">{label}</span>
      <span className="font-mono text-sm text-ink-100 numeric">{value}</span>
    </div>
  );
}

function AutoBlock({
  autoComputing,
  autoError,
  autoResult,
  onRefresh,
  showValidators,
  setShowValidators,
}: {
  autoComputing: boolean;
  autoError: Error | null;
  autoResult: { selected: AutoNominateValidator[]; timings: AutoNominateTimings } | null;
  onRefresh: () => void;
  showValidators: boolean;
  setShowValidators: (v: boolean) => void;
}) {
  if (autoComputing && !autoResult) {
    return (
      <div className="space-y-2">
        <LoadingIndicator message="Selecting validators for you..." />
        <p className="text-xs text-ink-400">
          This usually takes 30–60 seconds in the browser. The wallet pulls
          every bonded account, ledger, validator, and nominator from chain,
          runs the election locally, then scores each elected validator by
          recent performance, stake dilution, and commission.
        </p>
      </div>
    );
  }
  if (autoError) {
    return (
      <div>
        <p className="text-sm text-danger">
          Couldn't select validators — {autoError.message}.
        </p>
        <button
          onClick={onRefresh}
          className="mt-2 text-sm text-xx-500 active:opacity-70"
        >
          Try again →
        </button>
      </div>
    );
  }
  if (!autoResult) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-100">
          {autoResult.selected.length} validators chosen for you
        </p>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1 text-xs text-xx-500 active:opacity-70"
        >
          <RefreshCcw size={11} />
          Refresh
        </button>
      </div>
      <p className="text-xs text-ink-400">
        Top-ranked by projected return (performance × stake dilution ×
        commission). Selected in {(autoResult.timings.totalMs / 1000).toFixed(1)}s.
      </p>
      <button
        onClick={() => setShowValidators(!showValidators)}
        className="flex items-center gap-1 text-xs text-xx-500 active:opacity-70"
      >
        <ChevronDown
          size={12}
          className={clsx(
            'transition-transform',
            showValidators && 'rotate-180'
          )}
        />
        {showValidators ? 'Hide' : 'Show'} validators
      </button>
      {showValidators && (
        <ul className="space-y-1">
          {autoResult.selected.map((v, idx) => (
            <li
              key={v.validatorId}
              className="flex items-center gap-2 py-1 text-xs"
            >
              <span className="text-ink-500 w-5 flex-shrink-0">{idx + 1}</span>
              <AddressLabel address={v.validatorId} className="text-xs min-w-0" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PickBlock({
  handPicked,
  onOpenPicker,
}: {
  handPicked: string[];
  onOpenPicker: () => void;
}) {
  return (
    <div className="space-y-2">
      {handPicked.length === 0 ? (
        <p className="text-sm text-ink-400">
          No validators chosen. Tap below to pick from the live validator list.
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-100">
            {handPicked.length} validator{handPicked.length === 1 ? '' : 's'}{' '}
            selected
          </p>
          <ul className="space-y-1">
            {handPicked.slice(0, 5).map((address, idx) => (
              <li
                key={address}
                className="flex items-center gap-2 py-1 text-xs"
              >
                <span className="text-ink-500 w-5 flex-shrink-0">{idx + 1}</span>
                <AddressLabel address={address} className="text-xs min-w-0" />
              </li>
            ))}
            {handPicked.length > 5 && (
              <li className="text-xs text-ink-400 pl-7">
                + {handPicked.length - 5} more
              </li>
            )}
          </ul>
        </>
      )}
      <button
        onClick={onOpenPicker}
        className="text-sm text-xx-500 active:opacity-70"
      >
        {handPicked.length === 0 ? 'Choose validators →' : 'Edit selection →'}
      </button>
    </div>
  );
}
