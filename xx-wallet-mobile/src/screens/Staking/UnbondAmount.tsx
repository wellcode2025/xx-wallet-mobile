import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BN } from '@polkadot/util';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { useAccountsStore } from '@/store';
import {
  isLedgerAddress,
  useSequentialTx,
  useStakingPosition,
  invalidateAutoNominateCache,
} from '@/hooks';
import { formatBalance, parseAmount } from '@/utils';
import { TopBar } from '@/components/layout';
import { AddressLabel, LoadingIndicator } from '@/components/ui';
import { SignerConfirmCard } from './SignerConfirmCard';

/**
 * Unbond.
 *
 * `staking.unbond(amount)` — starts a 28-day unbonding clock for the
 * specified amount. The unbonded chunk shows up on MyNominations with
 * a countdown; once matured (chunk.era ≤ activeEra) the user can call
 * withdrawUnbonded to free it.
 *
 * When the user unbonds the FULL active stake we also chill in the
 * same batch — matches the foundation's simple-staking/actions.ts
 * pattern. Avoids leaving a "bonded zero" account stuck with a
 * dangling nomination set.
 *
 * The 28-day-lock warning is front-loaded loudly. This is the most
 * commitment-heavy action in the staking flow.
 */
export function UnbondAmount() {
  const navigate = useNavigate();
  const { accounts, activeAddress } = useAccountsStore();
  const activeAccount = useMemo(
    () => accounts.find((a) => a.address === activeAddress) ?? accounts[0],
    [accounts, activeAddress]
  );

  const { position } = useStakingPosition(activeAccount?.address ?? null);
  // Sequential submit: one step normally; two steps (chill, then unbond)
  // for a Ledger signer unbonding their full stake, because the Ledger
  // app refuses the chill+unbond batch. Local accounts keep the atomic
  // batchAll as a single step through the same hook.
  const {
    submitSequence,
    status,
    error: txError,
    currentStep,
    totalSteps,
    sequenceDone,
    failedStep,
  } = useSequentialTx();

  const [amount, setAmount] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const parsedAmount = useMemo(() => parseAmount(amount), [amount]);
  const parsedAmountBN = useMemo(
    () => (parsedAmount ? new BN(parsedAmount.toFixed(0)) : null),
    [parsedAmount]
  );
  const activeStake = position?.ledger?.active ?? null;
  const amountTooLarge = Boolean(
    parsedAmountBN && activeStake && parsedAmountBN.gt(activeStake)
  );
  const amountValid =
    parsedAmountBN !== null && parsedAmountBN.gtn(0) && !amountTooLarge;
  const willChill = Boolean(
    parsedAmountBN && activeStake && parsedAmountBN.eq(activeStake)
  );

  const isLedger = isLedgerAddress(activeAccount?.address ?? '');
  const isSubmitting =
    status === 'signing' ||
    status === 'broadcasting' ||
    status === 'in-block' ||
    // Between sequence steps the per-tx status is briefly 'finalized'
    // while the next step hasn't started — still submitting.
    (status === 'finalized' && !sequenceDone);
  const isDone = sequenceDone;
  const canSubmit =
    amountValid &&
    (isLedger || password.length > 0) &&
    (status === 'idle' || status === 'error');

  useEffect(() => {
    if (!sequenceDone) return;
    invalidateAutoNominateCache();
    const t = setTimeout(() => navigate('/staking'), 1200);
    return () => clearTimeout(t);
  }, [sequenceDone, navigate]);

  if (!activeAccount) return null;

  const handleMax = () => {
    if (!activeStake) return;
    setAmount(formatBalance(activeStake, { decimals: 9, grouping: false }));
  };

  const handleSubmit = async () => {
    if (!canSubmit || !parsedAmountBN || !activeAccount) return;
    setPasswordError(null);
    const amountStr = parsedAmountBN.toString();
    try {
      if (willChill && isLedger) {
        // Full unbond from a Ledger account: the device app refuses the
        // chill+unbond batch ("Call nesting not supported"), so submit
        // them as two transactions — two device confirmations. Not
        // atomic: if unbond fails after chill finalized, the account is
        // chilled-but-bonded, which MyNominations surfaces and the user
        // can complete or re-nominate from there.
        await submitSequence(
          [
            { label: 'stop nominating', build: (api) => api.tx.staking.chill() },
            { label: 'unbond', build: (api) => api.tx.staking.unbond(amountStr) },
          ],
          { address: activeAccount.address }
        );
      } else {
        await submitSequence(
          [
            {
              label: willChill ? 'stop nominating + unbond' : 'unbond',
              build: (api) => {
                const unbondCall = api.tx.staking.unbond(amountStr);
                if (willChill) {
                  // Unbonding the full active stake — pair with chill so
                  // the empty nomination set doesn't linger. Matches
                  // foundation's staking.xx.network actions.ts pattern.
                  return api.tx.utility.batchAll([
                    api.tx.staking.chill(),
                    unbondCall,
                  ]);
                }
                return unbondCall;
              },
            },
          ],
          { address: activeAccount.address, password }
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
    }
  };

  return (
    <>
      <TopBar title="Unbond" showBack />
      <div className="px-5 py-4 space-y-4">
        {/* Account context */}
        <div className="card space-y-2">
          <p className="text-xs uppercase tracking-wider text-ink-300 font-medium">
            Unbonding from
          </p>
          <AddressLabel address={activeAccount.address} className="text-sm" />
          {position?.ledger && (
            <p className="text-xs text-ink-300">
              Currently active:{' '}
              <span className="font-mono text-ink-200">
                {formatBalance(position.ledger.active, {
                  decimals: 4,
                  withSymbol: true,
                })}
              </span>
            </p>
          )}
        </div>

        {!position && (
          <LoadingIndicator message="Loading your position..." />
        )}

        {position && !position.ledger && (
          <div className="card">
            <p className="text-sm text-ink-200">
              This account isn't bonded — nothing to unbond.
            </p>
          </div>
        )}

        {position?.ledger && !isDone && (
          <>
            {/* The hard warning */}
            <div className="rounded-2xl bg-warning/10 border border-warning/30 px-4 py-3 flex items-start gap-3">
              <AlertTriangle
                size={18}
                strokeWidth={2}
                className="text-warning flex-shrink-0 mt-0.5"
              />
              <div className="space-y-1">
                <p className="font-display font-medium text-sm text-ink-100">
                  Unbonded XX is locked for 28 days
                </p>
                <p className="text-xs text-ink-300">
                  Once you unbond, the amount stops earning rewards and is
                  not transferable until 28 days pass. After 28 days you'll
                  see a Withdraw action on this screen. There is no way to
                  cancel an unbond early.
                </p>
              </div>
            </div>

            {/* Amount */}
            <div className="card space-y-2">
              <label className="text-xs uppercase tracking-wider text-ink-300 font-medium">
                Amount to unbond
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
                  disabled={!activeStake || activeStake.isZero()}
                  className="px-3 rounded-2xl bg-ink-800 text-xx-500 text-xs font-medium active:opacity-80 disabled:opacity-40"
                >
                  Max
                </button>
              </div>
              {amountTooLarge && !isSubmitting && (
                <p className="text-xs text-danger">
                  Exceeds your active stake.
                </p>
              )}
              {willChill && !amountTooLarge && (
                <p className="text-xs text-warning">
                  {isLedger
                    ? 'This unbonds your full stake — your nominations stop ' +
                      'too. Your Ledger will ask for two approvals: one to ' +
                      'stop nominating, one to unbond.'
                    : "This unbonds your full stake — we'll also stop your " +
                      'nominations in the same signature (no separate chill ' +
                      'required).'}
                </p>
              )}
            </div>

            {/* Review */}
            {amountValid && (
              <div className="card space-y-2">
                <p className="text-xs uppercase tracking-wider text-ink-300 font-medium">
                  Review
                </p>
                <ReviewRow
                  label="Unbonding"
                  value={formatBalance(parsedAmountBN!, {
                    decimals: 4,
                    withSymbol: true,
                  })}
                />
                <ReviewRow
                  label="Stops earning in"
                  value="Next era boundary"
                />
                <ReviewRow label="Available to withdraw in" value="28 days" />
                {willChill && (
                  <ReviewRow label="Also" value="Stops nominating" />
                )}
                <ReviewRow
                  label="Network fee"
                  value={willChill ? '~0.025 XX' : '~0.019 XX'}
                />
              </div>
            )}

            {/* Signer confirmation — password or confirm-on-device */}
            {amountValid && (
              <SignerConfirmCard
                isLedger={isLedger}
                idPrefix="unbond"
                password={password}
                onPasswordChange={(v) => {
                  setPassword(v);
                  setPasswordError(null);
                }}
                passwordError={passwordError}
                disabled={isSubmitting}
                waiting={status === 'signing'}
                steps={
                  isLedger && willChill
                    ? { current: Math.max(currentStep, 1), total: 2 }
                    : null
                }
              />
            )}

            <button
              onClick={handleSubmit}
              disabled={!canSubmit || isSubmitting}
              className={clsx(
                'w-full py-3 rounded-2xl text-sm font-medium transition-opacity flex items-center justify-center gap-2',
                canSubmit && !isSubmitting
                  ? 'bg-warning/15 text-warning border border-warning/30 active:opacity-80'
                  : 'bg-ink-800 text-ink-500 cursor-not-allowed'
              )}
            >
              <AlertTriangle size={14} strokeWidth={2} />
              {submitLabel(status, parsedAmountBN, isLedger, {
                current: currentStep,
                total: totalSteps,
              })}
            </button>
          </>
        )}

        {isDone && (
          <div className="card flex flex-col items-center text-center gap-3 py-6">
            <CheckCircle2 size={36} className="text-success" />
            <p className="font-display font-medium text-sm text-ink-100">
              Unbonding started
            </p>
            <p className="text-xs text-ink-300">
              Withdraw becomes available in 28 days. Returning to staking…
            </p>
          </div>
        )}

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
            {failedStep?.label === 'unbond' && (
              <p className="text-xs text-ink-300 mt-1 leading-relaxed">
                The stop-nominating step already went through — your XX is
                still bonded. Retry the unbond from this screen, or
                re-nominate from Manage stake if you've changed your mind.
              </p>
            )}
          </div>
        )}
      </div>
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
    return isLedger
      ? `${stepPrefix}Confirm on your Ledger…`
      : 'Signing…';
  if (status === 'broadcasting') return `${stepPrefix}Sending to network…`;
  if (status === 'in-block' || status === 'finalized')
    return `${stepPrefix}Waiting for finality…`;
  if (!amount) return 'Unbond';
  return `Unbond ${formatBalance(amount, { decimals: 4, withSymbol: true })}`;
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-ink-300">{label}</span>
      <span className="font-mono text-sm text-ink-100 numeric">{value}</span>
    </div>
  );
}
