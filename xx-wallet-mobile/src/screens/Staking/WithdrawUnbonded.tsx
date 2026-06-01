import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BN } from '@polkadot/util';
import clsx from 'clsx';
import { CheckCircle2 } from 'lucide-react';

import { useAccountsStore } from '@/store';
import { useStakingPosition, useTx } from '@/hooks';
import { xxApi } from '@/api';
import { formatBalance } from '@/utils';
import { TopBar } from '@/components/layout';
import { AddressLabel, LoadingIndicator } from '@/components/ui';

/**
 * Withdraw unbonded.
 *
 * `staking.withdrawUnbonded(numSlashingSpans)` — moves all matured
 * unlocking chunks (era ≤ activeEra) from "unbonding" to fully
 * transferable. Reachable from MyNominations only when at least one
 * chunk has matured.
 *
 * numSlashingSpans comes from `staking.slashingSpans(stash)` — count
 * of distinct slashing spans on this account. Almost always 0 for
 * normal accounts; the chain still wants the number so it can clean
 * up storage atomically.
 */
export function WithdrawUnbonded() {
  const navigate = useNavigate();
  const { accounts, activeAddress } = useAccountsStore();
  const activeAccount = useMemo(
    () => accounts.find((a) => a.address === activeAddress) ?? accounts[0],
    [accounts, activeAddress]
  );

  const { position } = useStakingPosition(activeAccount?.address ?? null);
  const { submit, status, error: txError } = useTx();

  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [spanCount, setSpanCount] = useState<number | null>(null);
  const [spanError, setSpanError] = useState<Error | null>(null);

  const matured = useMemo(() => {
    if (!position?.ledger || position.activeEra === null) return [];
    return position.ledger.unlocking.filter(
      (c) => c.era <= position.activeEra!
    );
  }, [position]);

  const maturedTotal = useMemo(
    () => matured.reduce((acc, c) => acc.add(c.value), new BN(0)),
    [matured]
  );

  // Fetch slashing spans count once the account is known. Almost always 0.
  useEffect(() => {
    if (!activeAccount) return;
    let cancelled = false;
    (async () => {
      try {
        const api = await xxApi.getApi();
        const opt: any = await api.query.staking.slashingSpans(
          activeAccount.address
        );
        if (cancelled) return;
        if (!opt?.isSome) {
          setSpanCount(0);
          return;
        }
        const spans = opt.unwrap();
        // prior.length + 1 for the current span, matching foundation's
        // redeem(...) helper in simple-staking/actions.ts.
        const count = (spans.prior?.length ?? 0) + 1;
        setSpanCount(count);
      } catch (err) {
        if (!cancelled) {
          // Fail closed at 0 — chain rejects undercount with a clear error,
          // never silently misbehaves.
          setSpanCount(0);
          setSpanError(err as Error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAccount]);

  const isSubmitting =
    status === 'signing' || status === 'broadcasting' || status === 'in-block';
  const isDone = status === 'finalized';
  const canSubmit =
    matured.length > 0 &&
    spanCount !== null &&
    password.length > 0 &&
    (status === 'idle' || status === 'error');

  useEffect(() => {
    if (status !== 'finalized') return;
    const t = setTimeout(() => navigate('/staking'), 1200);
    return () => clearTimeout(t);
  }, [status, navigate]);

  if (!activeAccount) return null;

  const handleSubmit = async () => {
    if (!canSubmit || spanCount === null || !activeAccount) return;
    setPasswordError(null);
    try {
      await submit(
        (api) => api.tx.staking.withdrawUnbonded(spanCount),
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

  return (
    <>
      <TopBar title="Withdraw unbonded" showBack />
      <div className="px-5 py-4 space-y-4">
        {/* Account context */}
        <div className="card space-y-2">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Withdrawing to
          </p>
          <AddressLabel address={activeAccount.address} className="text-sm" />
        </div>

        {!position && (
          <LoadingIndicator message="Loading your position..." />
        )}

        {position && matured.length === 0 && !isDone && (
          <div className="card">
            <p className="text-sm text-ink-200">
              Nothing to withdraw right now. Unbonded chunks become
              available 28 days after you initiate the unbond.
            </p>
          </div>
        )}

        {position && matured.length > 0 && !isDone && (
          <>
            {/* What's being withdrawn */}
            <div className="card space-y-3">
              <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                Ready to withdraw
              </p>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-ink-400">Total</span>
                <span className="font-mono text-base text-ink-100 numeric">
                  {formatBalance(maturedTotal, {
                    decimals: 4,
                    withSymbol: true,
                  })}
                </span>
              </div>
              {matured.length > 1 && (
                <>
                  <p className="text-xs text-ink-400 pt-2 border-t border-ink-800/60">
                    Across {matured.length} matured chunks
                  </p>
                  <ul className="space-y-1.5">
                    {matured.map((c, idx) => (
                      <li
                        key={`${c.era}-${idx}`}
                        className="flex items-baseline justify-between gap-3 text-xs"
                      >
                        <span className="text-ink-400">Era {c.era}</span>
                        <span className="font-mono text-ink-200 numeric">
                          {formatBalance(c.value, {
                            decimals: 4,
                            withSymbol: true,
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="text-xs text-ink-400 pt-2 border-t border-ink-800/60">
                Once withdrawn, this XX becomes transferable again. Your
                remaining bonded stake is unaffected.
              </p>
            </div>

            {/* Slashing spans (transparency) */}
            {spanCount !== null && spanCount > 0 && (
              <div className="card">
                <p className="text-xs text-ink-400">
                  This account has {spanCount} slashing span
                  {spanCount === 1 ? '' : 's'} recorded on chain. The
                  withdraw extrinsic cleans those up as part of the call.
                </p>
              </div>
            )}
            {spanError && (
              <div className="card">
                <p className="text-xs text-warning">
                  Couldn't read slashing spans — assuming 0. If the chain
                  rejects, retry later.
                </p>
              </div>
            )}

            {/* Password */}
            <div className="card space-y-2">
              <label
                htmlFor="withdraw-password"
                className="text-xs uppercase tracking-wider text-ink-400 font-medium"
              >
                Confirm with password
              </label>
              <input
                id="withdraw-password"
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
              {submitLabel(status, maturedTotal)}
            </button>
          </>
        )}

        {isDone && (
          <div className="card flex flex-col items-center text-center gap-3 py-6">
            <CheckCircle2 size={36} className="text-success" />
            <p className="font-display font-medium text-sm text-ink-100">
              Withdrew {formatBalance(maturedTotal, { decimals: 4, withSymbol: true })}
            </p>
            <p className="text-xs text-ink-400">Returning to staking…</p>
          </div>
        )}

        {txError && !passwordError && (
          <div className="card">
            <p className="text-sm text-danger">{txError.message}</p>
          </div>
        )}
      </div>
    </>
  );
}

function submitLabel(status: string, total: BN): string {
  if (status === 'signing') return 'Signing…';
  if (status === 'broadcasting') return 'Sending to network…';
  if (status === 'in-block') return 'Waiting for finality…';
  return `Withdraw ${formatBalance(total, { decimals: 4, withSymbol: true })}`;
}
