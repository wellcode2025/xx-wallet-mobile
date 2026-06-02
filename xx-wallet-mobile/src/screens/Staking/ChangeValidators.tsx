import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { CheckCircle2, ChevronDown, RefreshCcw } from 'lucide-react';

import { useAccountsStore } from '@/store';
import {
  useAutoNominate,
  useStakingPosition,
  useTx,
  invalidateAutoNominateCache,
} from '@/hooks';
import type { AutoNominateValidator, AutoNominateTimings } from '@/staking';
import { TopBar } from '@/components/layout';
import { AddressLabel, LoadingIndicator } from '@/components/ui';
import { ValidatorPickerSheet } from './ValidatorPickerSheet';

/**
 * Change validators (re-nominate).
 *
 * Submits `staking.nominate(newTargets)` against the account's
 * existing bond. No bondExtra, no chill — just replaces the nomination
 * set in one extrinsic. Cheap (~0.016 XX) and instant in effect from
 * the next era.
 *
 * Reuses StartStaking's auto-nominate selection and ValidatorPickerSheet,
 * with the hand-pick path pre-seeded with the user's current
 * nominations so they can tweak rather than restart.
 */
export function ChangeValidators() {
  const navigate = useNavigate();
  const { accounts, activeAddress } = useAccountsStore();
  const activeAccount = useMemo(
    () => accounts.find((a) => a.address === activeAddress) ?? accounts[0],
    [accounts, activeAddress]
  );

  const { position } = useStakingPosition(activeAccount?.address ?? null);
  const {
    result: autoResult,
    isComputing: autoComputing,
    error: autoError,
    refresh,
  } = useAutoNominate(activeAccount?.address ?? null);
  const { submit, status, error: txError } = useTx();

  // This screen serves two states: re-nominating an account that already
  // nominates, and the first nomination for an account that is bonded but
  // not nominating (e.g. after a chill). Both submit staking.nominate();
  // the only difference is wording.
  const nominating = !!position?.isNominating;
  const isBonded = !!position?.ledger;

  // Form state — initial hand-pick selection is the user's current nominations
  const [mode, setMode] = useState<'auto' | 'pick'>('auto');
  const [handPicked, setHandPicked] = useState<string[]>([]);
  const [handPickedInitialised, setHandPickedInitialised] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showValidators, setShowValidators] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Initialise hand-pick from position.targets once position loads.
  // We don't want to clobber a subsequent edit, so this only fires once.
  useEffect(() => {
    if (handPickedInitialised) return;
    if (position?.targets && position.targets.length > 0) {
      setHandPicked(position.targets);
      setHandPickedInitialised(true);
    }
  }, [position, handPickedInitialised]);

  const targets = useMemo(
    () =>
      mode === 'auto'
        ? autoResult?.selected.map((v) => v.validatorId) ?? []
        : handPicked,
    [mode, autoResult, handPicked]
  );

  const targetsValid = targets.length > 0 && targets.length <= 16;
  const currentTargets = useMemo(
    () => new Set(position?.targets ?? []),
    [position]
  );
  const targetsChanged = useMemo(() => {
    if (targets.length !== currentTargets.size) return true;
    return targets.some((t) => !currentTargets.has(t));
  }, [targets, currentTargets]);

  const isSubmitting =
    status === 'signing' || status === 'broadcasting' || status === 'in-block';
  const isDone = status === 'finalized';
  const canSubmit =
    targetsValid &&
    targetsChanged &&
    password.length > 0 &&
    (status === 'idle' || status === 'error');

  useEffect(() => {
    if (status !== 'finalized') return;
    invalidateAutoNominateCache();
    const t = setTimeout(() => navigate('/staking'), 1200);
    return () => clearTimeout(t);
  }, [status, navigate]);

  if (!activeAccount) return null;

  const handleSubmit = async () => {
    if (!canSubmit || !activeAccount) return;
    setPasswordError(null);
    try {
      await submit(
        (api) => api.tx.staking.nominate(targets),
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
      <TopBar title={nominating ? 'Change validators' : 'Nominate validators'} showBack />
      <div className="px-5 py-4 space-y-4">
        {/* Account context */}
        <div className="card space-y-2">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            {nominating ? 'Re-nominating from' : 'Nominating from'}
          </p>
          <AddressLabel address={activeAccount.address} className="text-sm" />
          {nominating && position?.targets && (
            <p className="text-xs text-ink-400">
              Currently nominating{' '}
              <span className="text-ink-200">
                {position.targets.length}
              </span>{' '}
              validator{position.targets.length === 1 ? '' : 's'}
            </p>
          )}
        </div>

        {!position && (
          <LoadingIndicator message="Loading your position..." />
        )}

        {position && !isBonded && (
          <div className="card">
            <p className="text-sm text-ink-200">
              This account isn't bonded yet. Bond and nominate together in
              Start staking first.
            </p>
          </div>
        )}

        {position && isBonded && !isDone && (
          <>
            {/* Selection */}
            <div className="card space-y-3">
              <label className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                New validator set
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
            {targetsValid && (
              <div className="card space-y-2">
                <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                  Review
                </p>
                <ReviewRow
                  label="Before"
                  value={`${position.targets.length} validator${position.targets.length === 1 ? '' : 's'}`}
                />
                <ReviewRow
                  label="After"
                  value={`${targets.length} validator${targets.length === 1 ? '' : 's'}`}
                />
                <ReviewRow label="Network fee" value="~0.016 XX" />
                {!targetsChanged && (
                  <p className="text-xs text-ink-400 pt-1">
                    Selection matches your current nominations — change it
                    before signing.
                  </p>
                )}
              </div>
            )}

            {/* Password */}
            {targetsValid && targetsChanged && (
              <div className="card space-y-2">
                <label
                  htmlFor="change-password"
                  className="text-xs uppercase tracking-wider text-ink-400 font-medium"
                >
                  Confirm with password
                </label>
                <input
                  id="change-password"
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
              {submitLabel(status, targets.length)}
            </button>
          </>
        )}

        {isDone && (
          <div className="card flex flex-col items-center text-center gap-3 py-6">
            <CheckCircle2 size={36} className="text-success" />
            <p className="font-display font-medium text-sm text-ink-100">
              Nominations updated
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

function submitLabel(status: string, count: number): string {
  if (status === 'signing') return 'Signing…';
  if (status === 'broadcasting') return 'Sending to network…';
  if (status === 'in-block') return 'Waiting for finality…';
  return `Nominate ${count} validator${count === 1 ? '' : 's'}`;
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
          Usually 30–60 seconds the first time, near-instant once cached.
          Pre-fetched when you opened the Staking section.
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
        Top-ranked by projected return. Selected in {(autoResult.timings.totalMs / 1000).toFixed(1)}s.
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
          No validators selected yet. Tap below to choose.
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
