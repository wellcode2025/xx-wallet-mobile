import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BN } from '@polkadot/util';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { useAccountsStore } from '@/store';
import {
  useAutoNominate,
  useAutoSelection,
  useBalance,
  useSequentialTx,
  isLedgerAddress,
  invalidateAutoNominateCache,
} from '@/hooks';
import { formatBalance, parseAmount } from '@/utils';
import { TopBar } from '@/components/layout';
import { AddressLabel } from '@/components/ui';
import { ValidatorPickerSheet } from './ValidatorPickerSheet';
import { SignerConfirmCard } from './SignerConfirmCard';
import { AutoNominateBlock } from './AutoNominateBlock';

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
  // Sequential submit: bond+nominate is one atomic batchAll for local
  // accounts, but two transactions (two device confirmations) for a
  // Ledger signer — the Ledger app refuses nested calls.
  const {
    submitSequence,
    status,
    error: txError,
    currentStep,
    totalSteps,
    sequenceDone,
    failedStep,
  } = useSequentialTx();
  // Auto-pick after the user's optional quality levers (no-op by default).
  const autoSelection = useAutoSelection(autoResult);

  // Form state
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'auto' | 'pick'>('auto');
  const [handPicked, setHandPicked] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Derived
  const parsedAmount = useMemo(() => parseAmount(amount), [amount]);
  const transferable = balance?.transferable ?? null;
  const targets = useMemo(
    () =>
      mode === 'auto'
        ? autoSelection.selected.map((v) => v.validatorId)
        : handPicked,
    [mode, autoSelection.selected, handPicked]
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
  const isLedger = isLedgerAddress(activeAccount?.address ?? '');
  const canSubmit =
    amountValid &&
    targetsValid &&
    (isLedger || password.length > 0) &&
    (status === 'idle' || status === 'error');

  const isSubmitting =
    status === 'signing' ||
    status === 'broadcasting' ||
    status === 'in-block' ||
    // Between sequence steps the per-tx status is briefly 'finalized'
    // while the next step hasn't started — still submitting.
    (status === 'finalized' && !sequenceDone);
  const isDone = sequenceDone;

  // On sequence completion: cache invalidate + bounce back to /staking
  useEffect(() => {
    if (!sequenceDone) return;
    invalidateAutoNominateCache();
    const t = setTimeout(() => navigate('/staking'), 1200);
    return () => clearTimeout(t);
  }, [sequenceDone, navigate]);

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
    const amountStr = parsedAmountBN.toString();
    const stash = activeAccount.address;
    try {
      if (isLedger) {
        // The Ledger app refuses nested calls, so bond and nominate go
        // as two transactions — two device confirmations, bond first.
        // Not atomic: if nominate fails after bond finalized, the
        // account is bonded-but-not-nominating, which MyNominations
        // surfaces with a "choose validators" path to complete.
        await submitSequence(
          [
            {
              label: 'bond',
              build: (api) => api.tx.staking.bond(stash, amountStr, null),
            },
            {
              label: 'nominate',
              build: (api) => api.tx.staking.nominate(targets),
            },
          ],
          { address: stash }
        );
      } else {
        await submitSequence(
          [
            {
              label: 'bond + nominate',
              build: (api) =>
                api.tx.utility.batchAll([
                  api.tx.staking.bond(stash, amountStr, null),
                  api.tx.staking.nominate(targets),
                ]),
            },
          ],
          { address: stash, password }
        );
      }
    } catch (err) {
      const msg = (err as Error).message.toLowerCase();
      if (
        !isLedger &&
        (msg.includes('password') ||
          msg.includes('unable to decode') ||
          msg.includes('incorrect'))
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
          <p className="text-xs uppercase tracking-wider text-ink-300 font-medium">
            Bonding from
          </p>
          <AddressLabel address={activeAccount.address} className="text-sm" />
          {transferable && (
            <p className="text-xs text-ink-300">
              Available:{' '}
              <span className="font-mono text-ink-200">
                {formatBalance(transferable, { decimals: 4, withSymbol: true })}
              </span>
            </p>
          )}
        </div>

        {/* Amount */}
        <div className="card space-y-2">
          <label className="text-xs uppercase tracking-wider text-ink-300 font-medium">
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
                className="flex-1 bg-transparent py-2.5 text-base font-mono text-ink-100 placeholder:text-ink-300 focus:outline-none numeric"
              />
              <span className="text-sm text-ink-300 pl-2">XX</span>
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
            <p className="text-xs text-ink-300">
              Max keeps ~0.1 XX in reserve for the bond fee and existential
              deposit. You can change validators or unbond later.
            </p>
          )}
        </div>

        {/* Validator selection */}
        <div className="card space-y-3">
          <label className="text-xs uppercase tracking-wider text-ink-300 font-medium">
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
                    : 'text-ink-300 active:bg-ink-800/50'
                )}
              >
                {m === 'auto' ? 'Auto-recommend' : 'Hand-pick'}
              </button>
            ))}
          </div>

          {mode === 'auto' ? (
            <AutoNominateBlock
              autoComputing={autoComputing}
              autoError={autoError}
              autoResult={autoResult}
              onRefresh={refresh}
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
            <p className="text-xs uppercase tracking-wider text-ink-300 font-medium">
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

        {/* Signer confirmation — password or confirm-on-device */}
        {amountValid && targetsValid && !isDone && (
          <SignerConfirmCard
            isLedger={isLedger}
            idPrefix="bond"
            password={password}
            onPasswordChange={(v) => {
              setPassword(v);
              setPasswordError(null);
            }}
            passwordError={passwordError}
            disabled={isSubmitting}
            waiting={status === 'signing'}
            steps={
              isLedger
                ? { current: Math.max(currentStep, 1), total: 2 }
                : null
            }
          />
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
            {submitLabel(status, parsedAmountBN, isLedger, {
              current: currentStep,
              total: totalSteps,
            })}
          </button>
        )}

        {/* Done */}
        {isDone && (
          <div className="card flex flex-col items-center text-center gap-3 py-6">
            <CheckCircle2 size={36} className="text-success" />
            <p className="font-display font-medium text-sm text-ink-100">
              Bonded and nominating
            </p>
            <p className="text-xs text-ink-300">
              Returning to staking…
            </p>
          </div>
        )}

        {/* Tx error */}
        {txError && !passwordError && (
          <div className="card">
            <p className="text-sm text-danger">
              {failedStep && totalSteps > 1 && (
                <>
                  Step {currentStep} of {totalSteps} ({failedStep.label})
                  failed:{' '}
                </>
              )}
              {txError.message}
            </p>
            {failedStep?.label === 'nominate' && (
              <p className="text-xs text-ink-300 mt-1 leading-relaxed">
                Your XX is bonded — only the validator selection didn't go
                through. Finish from the staking screen: Manage stake →
                Change validators.
              </p>
            )}
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

function submitLabel(
  status: string,
  amount: BN | null,
  isLedger: boolean,
  steps: { current: number; total: number }
): string {
  const stepPrefix =
    steps.total > 1 && steps.current > 0
      ? `Step ${steps.current}/${steps.total}: `
      : '';
  if (status === 'signing')
    return isLedger ? `${stepPrefix}Confirm on your Ledger…` : 'Signing…';
  if (status === 'broadcasting') return `${stepPrefix}Sending to network…`;
  if (status === 'in-block' || status === 'finalized')
    return `${stepPrefix}Waiting for finality…`;
  if (!amount) return 'Stake';
  return `Stake ${formatBalance(amount, { decimals: 4, withSymbol: true })}`;
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-ink-300">{label}</span>
      <span className="font-mono text-sm text-ink-100 numeric">{value}</span>
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
        <p className="text-sm text-ink-300">
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
                <span className="text-ink-300 w-5 flex-shrink-0">{idx + 1}</span>
                <AddressLabel address={address} className="text-xs min-w-0" />
              </li>
            ))}
            {handPicked.length > 5 && (
              <li className="text-xs text-ink-300 pl-7">
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
