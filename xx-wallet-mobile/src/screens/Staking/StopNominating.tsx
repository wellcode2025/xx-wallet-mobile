import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { useAccountsStore } from '@/store';
import {
  isLedgerAddress,
  useStakingPosition,
  useTx,
  invalidateAutoNominateCache,
} from '@/hooks';
import { formatBalance } from '@/utils';
import { TopBar } from '@/components/layout';
import { AddressLabel, LoadingIndicator } from '@/components/ui';
import { SignerConfirmCard } from './SignerConfirmCard';

/**
 * Stop nominating (chill).
 *
 * `staking.chill()` removes your nominations from on-chain election
 * but keeps your XX bonded. No unbonding kicks off; the user can
 * resume nominating anytime by submitting a fresh nominate(). To
 * actually withdraw bonded XX they need the unbond flow.
 *
 * Lighter than bond — no params, no validator picking. Just confirm
 * and sign.
 */
export function StopNominating() {
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

  const isLedger = isLedgerAddress(activeAccount?.address ?? '');
  const isSubmitting =
    status === 'signing' || status === 'broadcasting' || status === 'in-block';
  const isDone = status === 'finalized';
  const canSubmit =
    (isLedger || password.length > 0) &&
    (status === 'idle' || status === 'error') &&
    Boolean(position?.isNominating);

  useEffect(() => {
    if (status !== 'finalized') return;
    // Re-nomination cache is unaffected by chill, but invalidate so the
    // next selection runs against fresh nominator-count state.
    invalidateAutoNominateCache();
    const t = setTimeout(() => navigate('/staking'), 1200);
    return () => clearTimeout(t);
  }, [status, navigate]);

  const handleSubmit = async () => {
    if (!canSubmit || !activeAccount) return;
    setPasswordError(null);
    try {
      await submit(
        (api) => api.tx.staking.chill(),
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

  if (!activeAccount) return null;

  return (
    <>
      <TopBar title="Stop nominating" showBack />
      <div className="px-5 py-4 space-y-4">
        {/* Account context */}
        <div className="card space-y-2">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Account
          </p>
          <AddressLabel address={activeAccount.address} className="text-sm" />
        </div>

        {/* Loading state if position not yet known */}
        {!position && (
          <LoadingIndicator message="Loading your position..." />
        )}

        {/* Not nominating — show nothing to do */}
        {position && !position.isNominating && (
          <div className="card">
            <p className="text-sm text-ink-200">
              This account isn't currently nominating, so there's nothing
              to chill.
            </p>
          </div>
        )}

        {/* Confirmation */}
        {position && position.isNominating && !isDone && (
          <>
            <div className="card space-y-3">
              <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                What this does
              </p>
              <p className="text-sm text-ink-200">
                Removes your nominations from on-chain election. Your bonded XX
                stays bonded — you stop earning rewards, but the 28-day
                unbonding clock does <em>not</em> start.
              </p>
              <ul className="text-xs text-ink-400 space-y-1.5 pt-1">
                <li className="flex gap-2">
                  <span className="text-ink-500">•</span>
                  <span>
                    You can resume by nominating again — any time, no waiting.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-ink-500">•</span>
                  <span>
                    To withdraw your XX, you'll still need to unbond
                    (28-day lock). That's a separate action.
                  </span>
                </li>
              </ul>
              {position.ledger && (
                <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-ink-800/60">
                  <span className="text-xs text-ink-400">Currently bonded</span>
                  <span className="font-mono text-sm text-ink-100 numeric">
                    {formatBalance(position.ledger.total, {
                      decimals: 4,
                      withSymbol: true,
                    })}
                  </span>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-ink-400">Currently nominating</span>
                <span className="font-mono text-sm text-ink-100 numeric">
                  {position.targets.length} validator
                  {position.targets.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-ink-400">Network fee</span>
                <span className="font-mono text-sm text-ink-100 numeric">
                  ~0.013 XX
                </span>
              </div>
            </div>

            {/* Signer confirmation — password or confirm-on-device */}
            <SignerConfirmCard
              isLedger={isLedger}
              idPrefix="chill"
              password={password}
              onPasswordChange={(v) => {
                setPassword(v);
                setPasswordError(null);
              }}
              passwordError={passwordError}
              disabled={isSubmitting}
              waiting={status === 'signing'}
            />

            {/* CTA */}
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
              {submitLabel(status, isLedger)}
            </button>
          </>
        )}

        {/* Done */}
        {isDone && (
          <div className="card flex flex-col items-center text-center gap-3 py-6">
            <CheckCircle2 size={36} className="text-success" />
            <p className="font-display font-medium text-sm text-ink-100">
              Nominations stopped
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

function submitLabel(status: string, isLedger: boolean): string {
  if (status === 'signing')
    return isLedger ? 'Confirm on your Ledger…' : 'Signing…';
  if (status === 'broadcasting') return 'Sending to network…';
  if (status === 'in-block') return 'Waiting for finality…';
  return 'Stop nominating';
}
