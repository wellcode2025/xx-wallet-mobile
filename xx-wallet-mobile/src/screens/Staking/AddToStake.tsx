import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BN } from '@polkadot/util';
import clsx from 'clsx';
import { CheckCircle2 } from 'lucide-react';

import { useAccountsStore } from '@/store';
import {
  isLedgerAddress,
  useBalance,
  useStakingPosition,
  useTx,
  invalidateAutoNominateCache,
} from '@/hooks';
import { formatBalance, parseAmount } from '@/utils';
import { TopBar } from '@/components/layout';
import { AddressLabel, LoadingIndicator } from '@/components/ui';
import { SignerConfirmCard } from './SignerConfirmCard';

/**
 * Add to stake (bondExtra).
 *
 * Increases the user's already-bonded amount. Doesn't touch validators.
 * Doesn't restart anything; the added stake earns rewards from the next
 * era boundary forward.
 *
 * Compared to StartStaking this drops the validator-selection
 * section entirely (existing nominations stand) and the call is
 * `staking.bondExtra(value)` rather than the bond+nominate batch.
 */

/** Reserve for fee + ED on Max calculation. Matches StartStaking. */
const MIN_FEE_BUFFER = new BN('100000000'); // 0.1 XX in planck

export function AddToStake() {
  const navigate = useNavigate();
  const { accounts, activeAddress } = useAccountsStore();
  const activeAccount = useMemo(
    () => accounts.find((a) => a.address === activeAddress) ?? accounts[0],
    [accounts, activeAddress]
  );

  const { balance } = useBalance(activeAccount?.address);
  const { position } = useStakingPosition(activeAccount?.address ?? null);
  const { submit, status, error: txError } = useTx();

  const [amount, setAmount] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const parsedAmount = useMemo(() => parseAmount(amount), [amount]);
  const transferable = balance?.transferable ?? null;
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

  const isLedger = isLedgerAddress(activeAccount?.address ?? '');
  const isSubmitting =
    status === 'signing' || status === 'broadcasting' || status === 'in-block';
  const isDone = status === 'finalized';
  const canSubmit =
    amountValid &&
    (isLedger || password.length > 0) &&
    (status === 'idle' || status === 'error');

  useEffect(() => {
    if (status !== 'finalized') return;
    // Bond changes shouldn't affect the auto-nominate selection, but the
    // freshly-bonded amount makes us a slightly larger nominator —
    // invalidate so any subsequent re-nominate sees a fresh election.
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
    setAmount(formatBalance(max, { decimals: 9, grouping: false }));
  };

  const handleSubmit = async () => {
    if (!canSubmit || !parsedAmountBN || !activeAccount) return;
    setPasswordError(null);
    try {
      await submit(
        (api) => api.tx.staking.bondExtra(parsedAmountBN.toString()),
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
    }
  };

  const projectedTotal =
    position?.ledger && parsedAmountBN
      ? position.ledger.total.add(parsedAmountBN)
      : null;

  return (
    <>
      <TopBar title="Add to stake" showBack />
      <div className="px-5 py-4 space-y-4">
        {/* Account context */}
        <div className="card space-y-2">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Adding to
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
          {position?.ledger && (
            <p className="text-xs text-ink-400">
              Currently bonded:{' '}
              <span className="font-mono text-ink-200">
                {formatBalance(position.ledger.total, {
                  decimals: 4,
                  withSymbol: true,
                })}
              </span>
            </p>
          )}
        </div>

        {/* Not bonded — bail early */}
        {position && !position.ledger && (
          <div className="card">
            <p className="text-sm text-ink-200">
              This account isn't bonded yet. Use Start staking to bond and
              nominate together in one signature.
            </p>
          </div>
        )}

        {position?.ledger && !isDone && (
          <>
            {/* Amount */}
            <div className="card space-y-2">
              <label className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                Amount to add
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
              {amountTooLarge && !isSubmitting && (
                <p className="text-xs text-danger">
                  Exceeds your available balance (reserve ~0.1 XX for fees).
                </p>
              )}
              {(!amountTooLarge || isSubmitting) && (
                <p className="text-xs text-ink-400">
                  Max keeps ~0.1 XX in reserve for the bondExtra fee and
                  existential deposit.
                </p>
              )}
            </div>

            {/* Review */}
            {amountValid && projectedTotal && (
              <div className="card space-y-2">
                <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                  Review
                </p>
                <ReviewRow
                  label="Adding"
                  value={formatBalance(parsedAmountBN!, {
                    decimals: 4,
                    withSymbol: true,
                  })}
                />
                <ReviewRow
                  label="New bonded total"
                  value={formatBalance(projectedTotal, {
                    decimals: 4,
                    withSymbol: true,
                  })}
                />
                <ReviewRow label="Network fee" value="~0.013 XX" />
              </div>
            )}

            {/* Signer confirmation — password or confirm-on-device */}
            {amountValid && (
              <SignerConfirmCard
                isLedger={isLedger}
                idPrefix="bondextra"
                password={password}
                onPasswordChange={(v) => {
                  setPassword(v);
                  setPasswordError(null);
                }}
                passwordError={passwordError}
                disabled={isSubmitting}
                waiting={status === 'signing'}
              />
            )}

            {/* CTA */}
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
              {submitLabel(status, parsedAmountBN, isLedger)}
            </button>
          </>
        )}

        {!position && (
          <LoadingIndicator message="Loading your position..." />
        )}

        {/* Done */}
        {isDone && (
          <div className="card flex flex-col items-center text-center gap-3 py-6">
            <CheckCircle2 size={36} className="text-success" />
            <p className="font-display font-medium text-sm text-ink-100">
              Stake increased
            </p>
            <p className="text-xs text-ink-400">Returning to staking…</p>
          </div>
        )}

        {/* Tx error */}
        {txError && !passwordError && (
          <div className="card">
            <p className="text-sm text-danger">{txError.message}</p>
          </div>
        )}
      </div>
    </>
  );
}

function submitLabel(
  status: string,
  amount: BN | null,
  isLedger: boolean
): string {
  if (status === 'signing')
    return isLedger ? 'Confirm on your Ledger…' : 'Signing…';
  if (status === 'broadcasting') return 'Sending to network…';
  if (status === 'in-block') return 'Waiting for finality…';
  if (!amount) return 'Add to stake';
  return `Add ${formatBalance(amount, { decimals: 4, withSymbol: true })}`;
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-ink-400">{label}</span>
      <span className="font-mono text-sm text-ink-100 numeric">{value}</span>
    </div>
  );
}
