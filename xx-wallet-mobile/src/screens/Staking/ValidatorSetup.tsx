import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BN } from '@polkadot/util';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { useAccountsStore } from '@/store';
import {
  useBalance,
  useStakingPosition,
  useTx,
  invalidateAutoNominateCache,
} from '@/hooks';
import { xxApi } from '@/api';
import { formatBalance, parseAmount } from '@/utils';
import { TopBar } from '@/components/layout';
import { AddressLabel, LoadingIndicator } from '@/components/ui';

/**
 * Phase 3.5 — Validator setup.
 *
 * Single screen that auto-detects three states and renders the right
 * form / submit shape:
 *
 *   - 'new'     (not bonded): amount + cmixId + prefs → batchAll([
 *                  bond(stash, amount, cmixId),
 *                  validate(prefs),
 *                ])
 *   - 'convert' (bonded but not validating): cmixId + prefs → either
 *                  validate(prefs) if cmixId unchanged from ledger,
 *                  or batchAll([setCmixId(cmixId), validate(prefs)])
 *                  if changed.
 *   - 'update'  (currently validating): prefs only → validate(prefs),
 *                  or batchAll([setCmixId, validate]) if the user
 *                  changed cmixId.
 *
 * "Currently validating" is detected by `staking.validators(addr).commission > 0`
 * — xx enforces minCommission = 2%, so a zero unambiguously means
 * "default-zero fallback, never registered".
 *
 * Stash/controller is the same account throughout (modern Substrate
 * pattern; xx's bond signature accepts a separate controller but the
 * wallet doesn't surface that distinction).
 */

const MIN_FEE_BUFFER = new BN('100000000'); // 0.1 XX (same as slice 1)
const MIN_VALIDATOR_BOND_PLANCK = new BN('7500000000000'); // 7,500 XX
const MIN_COMMISSION_PCT = 2;
const MAX_COMMISSION_PCT = 100;
/** Format a Perbill (0..1e9) as a percentage with 2 decimal places. */
const perbillToPct = (p: number) => p / 10_000_000;
/** Convert a percentage to Perbill. Accepts fractional input like 5.5. */
const pctToPerbill = (pct: number) => Math.round(pct * 10_000_000);
const isValidH256Hex = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s.trim());

type Mode = 'new' | 'convert' | 'update';

interface ValidatorState {
  mode: Mode;
  /** Current commission as Perbill, or 0 if not validating. */
  currentCommission: number;
  /** Current blocked flag, or false if not validating. */
  currentBlocked: boolean;
  /** Current cmixId on the ledger, base64-encoded the way the indexer
   *  stores it. Null if no cmixId is set (i.e., bonded as nominator). */
  currentCmixIdHex: string | null;
}

export function ValidatorSetup() {
  const navigate = useNavigate();
  const { accounts, activeAddress } = useAccountsStore();
  const activeAccount = useMemo(
    () => accounts.find((a) => a.address === activeAddress) ?? accounts[0],
    [accounts, activeAddress]
  );

  const { balance } = useBalance(activeAccount?.address);
  const { position } = useStakingPosition(activeAccount?.address ?? null);
  const { submit, status, error: txError } = useTx();

  const [validatorState, setValidatorState] = useState<ValidatorState | null>(
    null
  );
  const [stateError, setStateError] = useState<Error | null>(null);

  // Read current validator state directly from chain on mount.
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
        const isBonded = bondedOpt?.isSome;
        let currentCmixIdHex: string | null = null;
        if (isBonded) {
          const controller = bondedOpt.unwrap().toString();
          const ledgerOpt: any = await api.query.staking.ledger(controller);
          if (ledgerOpt?.isSome) {
            const l = ledgerOpt.unwrap();
            if (l.cmixId?.isSome) {
              currentCmixIdHex = l.cmixId.unwrap().toHex();
            }
          }
        }
        if (cancelled) return;
        const prefs: any = await api.query.staking.validators(
          activeAccount.address
        );
        const currentCommission = prefs?.commission?.toNumber?.() ?? 0;
        const currentBlocked = Boolean(prefs?.blocked?.toPrimitive?.());
        if (cancelled) return;
        const mode: Mode = !isBonded
          ? 'new'
          : currentCommission > 0
            ? 'update'
            : 'convert';
        setValidatorState({
          mode,
          currentCommission,
          currentBlocked,
          currentCmixIdHex,
        });
      } catch (e) {
        if (!cancelled) setStateError(e as Error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAccount, status]);

  // Form state — initialised once when validatorState resolves.
  const [amount, setAmount] = useState('');
  const [cmixId, setCmixId] = useState('');
  const [commissionPct, setCommissionPct] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [formInitialised, setFormInitialised] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (formInitialised || !validatorState) return;
    if (validatorState.currentCmixIdHex) {
      setCmixId(validatorState.currentCmixIdHex);
    }
    if (validatorState.mode === 'update') {
      setCommissionPct(perbillToPct(validatorState.currentCommission).toFixed(2));
      setBlocked(validatorState.currentBlocked);
    } else {
      setCommissionPct('5'); // sensible default for a new validator
    }
    setFormInitialised(true);
  }, [validatorState, formInitialised]);

  // Derived parsed values
  const parsedAmount = useMemo(
    () => (validatorState?.mode === 'new' ? parseAmount(amount) : null),
    [amount, validatorState]
  );
  const parsedAmountBN = useMemo(
    () => (parsedAmount ? new BN(parsedAmount.toFixed(0)) : null),
    [parsedAmount]
  );
  const transferable = balance?.transferable ?? null;
  const parsedCommissionPct = useMemo(() => {
    const n = Number(commissionPct);
    return Number.isFinite(n) ? n : NaN;
  }, [commissionPct]);

  // Validation
  const cmixIdValid = isValidH256Hex(cmixId);
  const commissionValid =
    !Number.isNaN(parsedCommissionPct) &&
    parsedCommissionPct >= MIN_COMMISSION_PCT &&
    parsedCommissionPct <= MAX_COMMISSION_PCT;
  const amountValid =
    validatorState?.mode !== 'new'
      ? true
      : parsedAmountBN !== null &&
        parsedAmountBN.gte(MIN_VALIDATOR_BOND_PLANCK) &&
        transferable !== null &&
        parsedAmountBN.lte(transferable.sub(MIN_FEE_BUFFER));

  const isSubmitting =
    status === 'signing' || status === 'broadcasting' || status === 'in-block';
  const isDone = status === 'finalized';
  const canSubmit =
    Boolean(validatorState) &&
    cmixIdValid &&
    commissionValid &&
    amountValid &&
    password.length > 0 &&
    (status === 'idle' || status === 'error');

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
    if (max.lten(0)) return;
    setAmount(formatBalance(max, { decimals: 9, grouping: false }));
  };

  const handleSubmit = async () => {
    if (!canSubmit || !activeAccount || !validatorState) return;
    setPasswordError(null);
    const prefs = {
      commission: pctToPerbill(parsedCommissionPct),
      blocked,
    };
    const trimmedCmix = cmixId.trim();
    const cmixIdChanged = trimmedCmix !== validatorState.currentCmixIdHex;
    try {
      await submit(
        (api) => {
          if (validatorState.mode === 'new') {
            // bond(stash, amount, cmixId) + validate(prefs)
            const bondCall = api.tx.staking.bond(
              activeAccount.address,
              parsedAmountBN!.toString(),
              trimmedCmix
            );
            const validateCall = api.tx.staking.validate(prefs);
            return api.tx.utility.batchAll([bondCall, validateCall]);
          }
          if (cmixIdChanged) {
            // setCmixId(...) + validate(prefs) — covers convert AND
            // currently-validating-but-changing-cmixId.
            const setCall = api.tx.staking.setCmixId(trimmedCmix);
            const validateCall = api.tx.staking.validate(prefs);
            return api.tx.utility.batchAll([setCall, validateCall]);
          }
          // Just update prefs.
          return api.tx.staking.validate(prefs);
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
    }
  };

  const title =
    validatorState?.mode === 'update'
      ? 'Validator settings'
      : 'Run a validator';

  return (
    <>
      <TopBar title={title} showBack />
      <div className="px-5 py-4 space-y-4">
        {/* Account context */}
        <div className="card space-y-2">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            {validatorState?.mode === 'update'
              ? 'Updating'
              : 'Setting up validator for'}
          </p>
          <AddressLabel address={activeAccount.address} className="text-sm" />
          {transferable && validatorState?.mode === 'new' && (
            <p className="text-xs text-ink-400">
              Available:{' '}
              <span className="font-mono text-ink-200">
                {formatBalance(transferable, { decimals: 4, withSymbol: true })}
              </span>
            </p>
          )}
        </div>

        {/* Loading state-detection */}
        {!validatorState && !stateError && (
          <LoadingIndicator message="Reading validator state from chain..." />
        )}
        {stateError && (
          <div className="card">
            <p className="text-sm text-danger">
              Couldn't read validator state: {stateError.message}
            </p>
          </div>
        )}

        {validatorState && !isDone && (
          <>
            {/* Mode-specific intro */}
            <ModeIntro mode={validatorState.mode} />

            {/* Amount — only for new validators */}
            {validatorState.mode === 'new' && (
              <div className="card space-y-2">
                <label className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                  Bond amount (minimum 7,500 XX)
                </label>
                <div className="flex items-stretch gap-2">
                  <div className="flex-1 flex items-center bg-ink-950 border border-ink-800 rounded-2xl px-3 focus-within:border-ink-600">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="7500.0"
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
                {parsedAmountBN &&
                  parsedAmountBN.lt(MIN_VALIDATOR_BOND_PLANCK) && (
                    <p className="text-xs text-danger">
                      Validator bond floor is 7,500 XX.
                    </p>
                  )}
                {parsedAmountBN &&
                  transferable &&
                  parsedAmountBN.gt(transferable.sub(MIN_FEE_BUFFER)) &&
                  !isSubmitting && (
                    <p className="text-xs text-danger">
                      Exceeds available balance (reserve ~0.1 XX for fees).
                    </p>
                  )}
              </div>
            )}

            {/* cMix node id */}
            <div className="card space-y-2">
              <label className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                cMix node id (H256 hex)
              </label>
              <textarea
                value={cmixId}
                onChange={(e) => setCmixId(e.target.value)}
                placeholder="0x..."
                rows={2}
                disabled={isSubmitting}
                className={clsx(
                  'w-full px-3 py-2 rounded-2xl bg-ink-950 border text-xs font-mono text-ink-100 placeholder:text-ink-400 focus:outline-none break-all',
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
              {validatorState.currentCmixIdHex &&
                cmixId.trim() === validatorState.currentCmixIdHex && (
                  <p className="text-xs text-ink-400">
                    Unchanged from current — no setCmixId call needed.
                  </p>
                )}
              {validatorState.mode !== 'new' &&
                !validatorState.currentCmixIdHex && (
                  <p className="text-xs text-warning">
                    No cmixId is currently set on this bond. (Either you
                    bonded as a nominator, or you previously chilled —
                    xx clears the ledger's cmixId when a validator
                    chills.) The wallet will setCmixId before validate
                    in the same signature.
                  </p>
                )}
            </div>

            {/* Commission */}
            <div className="card space-y-2">
              <label className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                Commission (% — min 2, max 100)
              </label>
              <div className="flex items-center bg-ink-950 border border-ink-800 rounded-2xl px-3 focus-within:border-ink-600">
                <input
                  type="text"
                  inputMode="decimal"
                  value={commissionPct}
                  onChange={(e) => setCommissionPct(e.target.value)}
                  placeholder="5"
                  className="flex-1 bg-transparent py-2.5 text-base font-mono text-ink-100 placeholder:text-ink-400 focus:outline-none numeric"
                />
                <span className="text-sm text-ink-400 pl-2">%</span>
              </div>
              {commissionPct && !commissionValid && (
                <p className="text-xs text-danger">
                  Commission must be between {MIN_COMMISSION_PCT}% and{' '}
                  {MAX_COMMISSION_PCT}%.
                </p>
              )}
              <p className="text-xs text-ink-400">
                The cut your validator takes before rewards are distributed
                to nominators. xx network enforces a 2% floor.
              </p>
            </div>

            {/* Blocked toggle */}
            <div className="card flex items-start gap-3">
              <button
                onClick={() => setBlocked(!blocked)}
                disabled={isSubmitting}
                className={clsx(
                  'mt-0.5 w-10 h-6 rounded-full flex-shrink-0 transition-colors relative',
                  blocked ? 'bg-xx-500' : 'bg-ink-700'
                )}
                aria-pressed={blocked}
                aria-label="Block new nominators"
              >
                <span
                  className={clsx(
                    'absolute top-0.5 w-5 h-5 rounded-full bg-ink-950 transition-all',
                    blocked ? 'left-[1.125rem]' : 'left-0.5'
                  )}
                />
              </button>
              <div className="flex-1">
                <p className="text-sm text-ink-100">Block new nominators</p>
                <p className="text-xs text-ink-400 mt-0.5">
                  When on, this validator won't accept new nominations.
                  Existing nominators keep backing you. Useful when at
                  capacity or winding down.
                </p>
              </div>
            </div>

            {/* Review */}
            {amountValid && cmixIdValid && commissionValid && (
              <div className="card space-y-2">
                <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                  Review
                </p>
                {validatorState.mode === 'new' && parsedAmountBN && (
                  <ReviewRow
                    label="Bonding"
                    value={formatBalance(parsedAmountBN, {
                      decimals: 4,
                      withSymbol: true,
                    })}
                  />
                )}
                <ReviewRow
                  label="Commission"
                  value={`${parsedCommissionPct.toFixed(2)}%`}
                />
                <ReviewRow
                  label="Accepting nominators"
                  value={blocked ? 'No (blocked)' : 'Yes'}
                />
                <ReviewRow label="Network fee" value="~0.02 XX" />
                <div className="flex gap-2 items-start pt-1 text-warning">
                  <AlertTriangle
                    size={14}
                    strokeWidth={2}
                    className="flex-shrink-0 mt-0.5"
                  />
                  <p className="text-xs">
                    Validator status takes effect at the next era boundary.
                    You're responsible for keeping your cMix node online —
                    poor performance reduces your projected return and
                    severe faults can be slashed.
                  </p>
                </div>
              </div>
            )}

            {/* Password */}
            {cmixIdValid && commissionValid && amountValid && (
              <div className="card space-y-2">
                <label
                  htmlFor="validator-password"
                  className="text-xs uppercase tracking-wider text-ink-400 font-medium"
                >
                  Confirm with password
                </label>
                <input
                  id="validator-password"
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
              {submitLabel(status, validatorState.mode)}
            </button>

            {validatorState.mode === 'update' && (
              <div className="card space-y-2">
                <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                  Node maintenance
                </p>
                <p className="text-xs text-ink-400">
                  Rotate or transfer the cMix node id without changing
                  validator prefs — useful when migrating to new hardware.
                </p>
                <div className="flex flex-col gap-1.5 pt-1">
                  <Link
                    to="/staking/cmix"
                    className="text-xs text-xx-500 active:opacity-70"
                  >
                    Change cmixId →
                  </Link>
                  <Link
                    to="/staking/cmix/transfer"
                    className="text-xs text-xx-500 active:opacity-70"
                  >
                    Transfer cmixId to another account →
                  </Link>
                </div>
              </div>
            )}
          </>
        )}

        {isDone && (
          <div className="card flex flex-col items-center text-center gap-3 py-6">
            <CheckCircle2 size={36} className="text-success" />
            <p className="font-display font-medium text-sm text-ink-100">
              {validatorState?.mode === 'update'
                ? 'Validator settings updated'
                : 'Validator registered'}
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

function submitLabel(status: string, mode: Mode): string {
  if (status === 'signing') return 'Signing…';
  if (status === 'broadcasting') return 'Sending to network…';
  if (status === 'in-block') return 'Waiting for finality…';
  if (mode === 'update') return 'Update settings';
  if (mode === 'convert') return 'Run as validator';
  return 'Bond and validate';
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-ink-400">{label}</span>
      <span className="font-mono text-sm text-ink-100 numeric">{value}</span>
    </div>
  );
}

function ModeIntro({ mode }: { mode: Mode }) {
  if (mode === 'update') {
    return (
      <div className="card">
        <p className="text-sm text-ink-200">
          You're currently validating. Adjust commission, blocked status,
          or update your cmixId below — all changes go in one signed
          transaction. Updates take effect at the next era boundary.
        </p>
      </div>
    );
  }
  if (mode === 'convert') {
    return (
      <div className="card">
        <p className="text-sm text-ink-200">
          You're bonded but not currently validating. Provide a cMix node
          id and your commission to register as a validator. Any existing
          nominations on this account will be replaced.
        </p>
      </div>
    );
  }
  return (
    <div className="card">
      <p className="text-sm text-ink-200">
        Set up this account as a validator. You'll bond at least 7,500 XX
        and register your cMix node id and commission in one signature.
        Make sure your cMix node is running and stable before you
        register — performance affects your projected return.
      </p>
    </div>
  );
}
