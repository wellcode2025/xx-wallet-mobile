import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { useAccountsStore } from '@/store';
import { isLedgerAddress, useTx } from '@/hooks';
import { xxApi } from '@/api';
import { isValidXxAddress } from '@/utils';
import { TopBar } from '@/components/layout';
import { SignerConfirmCard } from './SignerConfirmCard';
import { AddressLabel, LoadingIndicator } from '@/components/ui';

/**
 * Transfer cmixId to another account.
 *
 * `staking.transferCmixId(dest)`. Hands off the calling account's cMix
 * node id to the destination account. Used when a validator is
 * migrating their operation to a different stash without rebuilding
 * the cMix node from scratch.
 *
 * Both source (current account) and destination need to be bonded for
 * the chain to accept the transfer in most runtime versions; we
 * surface the warning but let chain validation enforce the rule.
 */
export function TransferCmixId() {
  const navigate = useNavigate();
  const { accounts, activeAddress } = useAccountsStore();
  const activeAccount = useMemo(
    () => accounts.find((a) => a.address === activeAddress) ?? accounts[0],
    [accounts, activeAddress]
  );
  const { submit, status, error: txError } = useTx();

  const [currentCmixIdHex, setCurrentCmixIdHex] = useState<string | null>(null);
  const [readState, setReadState] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [readError, setReadError] = useState<string | null>(null);
  const [destination, setDestination] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeAccount) return;
    let cancelled = false;
    (async () => {
      try {
        const api = await xxApi.getApi();
        const bondedOpt: any = await api.query.staking.bonded(
          activeAccount.address
        );
        if (cancelled) return;
        if (!bondedOpt?.isSome) {
          setReadError(
            'This account is not bonded — there is no cmixId to transfer.'
          );
          setReadState('error');
          return;
        }
        const controller = bondedOpt.unwrap().toString();
        const ledgerOpt: any = await api.query.staking.ledger(controller);
        if (cancelled) return;
        if (!ledgerOpt?.isSome) {
          setReadError('Bonded but no ledger — unusual state.');
          setReadState('error');
          return;
        }
        const l = ledgerOpt.unwrap();
        if (!l.cmixId?.isSome) {
          setReadError(
            "This account has no cmixId set on its ledger — there's nothing to transfer."
          );
          setReadState('error');
          return;
        }
        setCurrentCmixIdHex(l.cmixId.unwrap().toHex());
        setReadState('ready');
      } catch (e) {
        if (!cancelled) {
          setReadError((e as Error).message);
          setReadState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAccount]);

  const trimmed = destination.trim();
  const destValid = isValidXxAddress(trimmed);
  const destIsSelf = trimmed === activeAccount?.address;
  const isSubmitting =
    status === 'signing' || status === 'broadcasting' || status === 'in-block';
  const isDone = status === 'finalized';
  const isLedger = isLedgerAddress(activeAccount?.address ?? '');
  const canSubmit =
    destValid &&
    !destIsSelf &&
    (isLedger || password.length > 0) &&
    (status === 'idle' || status === 'error');

  useEffect(() => {
    if (status !== 'finalized') return;
    const t = setTimeout(() => navigate('/staking'), 1200);
    return () => clearTimeout(t);
  }, [status, navigate]);

  if (!activeAccount) return null;

  const handleSubmit = async () => {
    if (!canSubmit || !activeAccount) return;
    setPasswordError(null);
    try {
      await submit(
        (api) => api.tx.staking.transferCmixId(trimmed),
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
      <TopBar title="Transfer cmixId" showBack />
      <div className="px-5 py-4 space-y-4">
        <div className="card space-y-2">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Transferring from
          </p>
          <AddressLabel address={activeAccount.address} className="text-sm" />
        </div>

        {readState === 'loading' && (
          <LoadingIndicator message="Reading current cmixId..." />
        )}

        {readState === 'error' && (
          <div className="card">
            <p className="text-sm text-danger">{readError}</p>
          </div>
        )}

        {readState === 'ready' && !isDone && currentCmixIdHex && (
          <>
            <div className="card space-y-2">
              <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                Current cmixId
              </p>
              <p className="font-mono text-xs text-ink-300 break-all">
                {currentCmixIdHex}
              </p>
            </div>

            <div className="rounded-2xl bg-warning/10 border border-warning/30 px-4 py-3 flex items-start gap-3">
              <AlertTriangle
                size={18}
                strokeWidth={2}
                className="text-warning flex-shrink-0 mt-0.5"
              />
              <div className="space-y-1">
                <p className="font-display font-medium text-sm text-ink-100">
                  This hands off your cMix node identity
                </p>
                <p className="text-xs text-ink-300">
                  After this transaction, the destination account owns
                  your cMix node id and can validate with it. Your
                  current account loses validator status. Make sure
                  the destination is a stash you control.
                </p>
              </div>
            </div>

            <div className="card space-y-2">
              <label className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                Destination account (SS58)
              </label>
              <textarea
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="6..."
                rows={2}
                disabled={isSubmitting}
                className={clsx(
                  'w-full px-3 py-2 rounded-2xl bg-ink-950 border text-xs font-mono text-ink-100 placeholder:text-ink-400 focus:outline-none break-all',
                  destination && !destValid
                    ? 'border-danger focus:border-danger'
                    : 'border-ink-800 focus:border-ink-600'
                )}
              />
              {destination && !destValid && (
                <p className="text-xs text-danger">
                  Not a valid xx network address.
                </p>
              )}
              {destIsSelf && (
                <p className="text-xs text-danger">
                  Destination is the same as the source account.
                </p>
              )}
            </div>

            <SignerConfirmCard
              isLedger={isLedger}
              idPrefix="transfer-cmix"
              password={password}
              onPasswordChange={(v) => {
                setPassword(v);
                setPasswordError(null);
              }}
              passwordError={passwordError}
              disabled={isSubmitting}
              waiting={status === 'signing'}
            />

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

        {isDone && (
          <div className="card flex flex-col items-center text-center gap-3 py-6">
            <CheckCircle2 size={36} className="text-success" />
            <p className="font-display font-medium text-sm text-ink-100">
              cmixId transferred
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

function submitLabel(status: string, isLedger: boolean): string {
  if (status === 'signing')
    return isLedger ? 'Confirm on your Ledger…' : 'Signing…';
  if (status === 'broadcasting') return 'Sending to network…';
  if (status === 'in-block') return 'Waiting for finality…';
  return 'Transfer cmixId';
}
