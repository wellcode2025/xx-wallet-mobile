import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { CheckCircle2 } from 'lucide-react';

import { useAccountsStore } from '@/store';
import { isLedgerAddress, useTx } from '@/hooks';
import { xxApi } from '@/api';
import { TopBar } from '@/components/layout';
import { AddressLabel, LoadingIndicator } from '@/components/ui';
import { SignerConfirmCard } from './SignerConfirmCard';

/**
 * Change cmixId only.
 *
 * `staking.setCmixId(cmixId)`. Standalone variant of the cmixId change
 * inside ValidatorSetup — useful when a validator is just rotating
 * their cMix node id without touching commission or blocked status.
 *
 * Pre-fills the input with the current ledger.cmixId (if any) so the
 * user can see what they're changing FROM. Validator status is not
 * required by the chain; setCmixId works on any bonded account.
 */
const isValidH256Hex = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s.trim());

export function ChangeCmixId() {
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
  const [cmixId, setCmixId] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Read current cmixId from chain
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
            'This account is not bonded — cmixId is set during bond. Use Run validator to bond as a validator first.'
          );
          setReadState('error');
          return;
        }
        const controller = bondedOpt.unwrap().toString();
        const ledgerOpt: any = await api.query.staking.ledger(controller);
        if (cancelled) return;
        if (!ledgerOpt?.isSome) {
          setReadError('Bonded but no ledger — unusual state. Try Run validator.');
          setReadState('error');
          return;
        }
        const l = ledgerOpt.unwrap();
        if (l.cmixId?.isSome) {
          const hex = l.cmixId.unwrap().toHex();
          setCurrentCmixIdHex(hex);
          setCmixId(hex);
        }
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

  const trimmed = cmixId.trim();
  const cmixIdValid = isValidH256Hex(trimmed);
  const changed = trimmed !== currentCmixIdHex;
  const isSubmitting =
    status === 'signing' || status === 'broadcasting' || status === 'in-block';
  const isDone = status === 'finalized';
  const isLedger = isLedgerAddress(activeAccount?.address ?? '');
  const canSubmit =
    cmixIdValid &&
    changed &&
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
        (api) => api.tx.staking.setCmixId(trimmed),
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
      <TopBar title="Change cmixId" showBack />
      <div className="px-5 py-4 space-y-4">
        <div className="card space-y-2">
          <p className="text-xs uppercase tracking-wider text-ink-300 font-medium">
            Account
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

        {readState === 'ready' && !isDone && (
          <>
            <div className="card space-y-2">
              <p className="text-xs uppercase tracking-wider text-ink-300 font-medium">
                Current cmixId
              </p>
              {currentCmixIdHex ? (
                <p className="font-mono text-xs text-ink-300 break-all">
                  {currentCmixIdHex}
                </p>
              ) : (
                <p className="text-xs text-ink-300">
                  No cmixId currently set on this bond. Setting one here is
                  equivalent to setting it for the first time.
                </p>
              )}
            </div>

            <div className="card space-y-2">
              <label className="text-xs uppercase tracking-wider text-ink-300 font-medium">
                New cmixId (H256 hex)
              </label>
              <textarea
                value={cmixId}
                onChange={(e) => setCmixId(e.target.value)}
                placeholder="0x..."
                rows={2}
                disabled={isSubmitting}
                className={clsx(
                  'w-full px-3 py-2 rounded-2xl bg-ink-950 border text-xs font-mono text-ink-100 placeholder:text-ink-300 focus:outline-none break-all',
                  cmixId && !cmixIdValid
                    ? 'border-danger focus:border-danger'
                    : 'border-ink-800 focus:border-ink-600'
                )}
              />
              {cmixId && !cmixIdValid && (
                <p className="text-xs text-danger">
                  Must be a 32-byte hex value (0x + 64 hex characters).
                </p>
              )}
              {cmixIdValid && !changed && (
                <p className="text-xs text-ink-300">
                  Same as current — change the value to enable submission.
                </p>
              )}
            </div>

            <SignerConfirmCard
              isLedger={isLedger}
              idPrefix="cmix"
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
                'w-full py-3 rounded-2xl text-sm font-medium transition-opacity',
                canSubmit && !isSubmitting
                  ? 'bg-xx-500 text-ink-950 active:opacity-80'
                  : 'bg-ink-800 text-ink-500 cursor-not-allowed'
              )}
            >
              {submitLabel(status, isLedger)}
            </button>
          </>
        )}

        {isDone && (
          <div className="card flex flex-col items-center text-center gap-3 py-6">
            <CheckCircle2 size={36} className="text-success" />
            <p className="font-display font-medium text-sm text-ink-100">
              cmixId updated
            </p>
            <p className="text-xs text-ink-300">Returning to staking…</p>
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
  return 'Update cmixId';
}
