/**
 * SignerConfirmCard — the confirm-with-password card shared by every
 * staking action screen, now signer-aware: a Ledger account gets a
 * confirm-on-device prompt instead of a password input (there is no
 * password — the device is the authorization).
 *
 * Extracted from the previously-duplicated inline card so the Ledger
 * branch lands in one place instead of nine. Styling matches the
 * original template exactly.
 */

import clsx from 'clsx';
import { Usb } from 'lucide-react';

export function SignerConfirmCard({
  isLedger,
  idPrefix,
  password,
  onPasswordChange,
  passwordError,
  disabled,
  waiting,
  steps,
}: {
  /** Selected signer is a Ledger account — render the device prompt. */
  isLedger: boolean;
  /** Unique input id prefix per screen (a11y label pairing). */
  idPrefix: string;
  password: string;
  onPasswordChange: (v: string) => void;
  passwordError: string | null;
  disabled: boolean;
  /** True while the device is waiting for the user's confirmation. */
  waiting?: boolean;
  /**
   * Optional multi-approval notice, e.g. { current: 1, total: 2 } when
   * a flow the app can't batch is split into sequential transactions.
   */
  steps?: { current: number; total: number } | null;
}) {
  if (isLedger) {
    return (
      <div className="card space-y-2">
        <div className="flex items-start gap-3">
          <Usb size={18} className="text-xx-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-ink-200 leading-relaxed">
            Your Ledger will show this transaction — check the details on
            the device screen and approve there.
            {steps && steps.total > 1 && (
              <span className="block mt-1 text-ink-300">
                This action needs{' '}
                <span className="text-ink-100 font-medium">
                  {steps.total} separate approvals
                </span>{' '}
                on the device (the Ledger app can't sign them as one
                batch).
                {waiting && (
                  <span className="text-ink-100">
                    {' '}
                    Now signing step {steps.current} of {steps.total}.
                  </span>
                )}
              </span>
            )}
            {waiting && (
              <span className="block mt-1 text-xx-500 font-medium">
                Waiting for the device…
              </span>
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card space-y-2">
      <label
        htmlFor={`${idPrefix}-password`}
        className="text-xs uppercase tracking-wider text-ink-400 font-medium"
      >
        Confirm with password
      </label>
      <input
        id={`${idPrefix}-password`}
        type="password"
        value={password}
        onChange={(e) => onPasswordChange(e.target.value)}
        disabled={disabled}
        className={clsx(
          'w-full px-3 py-2.5 rounded-2xl bg-ink-950 border text-sm text-ink-100 placeholder:text-ink-400 focus:outline-none',
          passwordError
            ? 'border-danger focus:border-danger'
            : 'border-ink-800 focus:border-ink-600'
        )}
        placeholder="Wallet password"
        autoComplete="current-password"
      />
      {passwordError && <p className="text-xs text-danger">{passwordError}</p>}
    </div>
  );
}
