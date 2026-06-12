import clsx from 'clsx';
import { AlertTriangle, Check, Usb } from 'lucide-react';
import { useEffect, useState } from 'react';
import { displayName, useIdentity } from '@/governance';
import { isLedgerAddress, useTx } from '@/hooks';

/**
 * TxFooter — reusable footer for governance action sheets.
 *
 * Renders:
 *   - Signed-by picker (defaults to active address, dropdown for others)
 *   - Password field with error-state feedback
 *   - Submit button with status copy ("Signing…" / "Broadcasting…" / …)
 *   - Per-state error UI showing error.message verbatim (surface the
 *     underlying error message on the error UI; mobile browsers have no
 *     easy console)
 *   - Success state with checkmark + Done button
 *
 * The footer provides an explicit signer picker so the user chooses which
 * key signs; it never signs silently as the active account.
 *
 * The footer renders inside an existing Sheet; the calling component
 * owns the Sheet wrapper and renders its own form fields above the
 * footer.
 */

export interface TxFooterProps {
  /** Currently-selected signer address. */
  signerAddress: string;
  /** Callback when signer changes (controlled by the parent). */
  onSignerChange: (addr: string) => void;
  /** Account list. */
  accounts: Array<{ address: string; name?: string }>;
  /**
   * Builder for the extrinsic to submit. Called with the connected
   * api by useTx after unlock.
   */
  txBuilder: Parameters<ReturnType<typeof useTx>['submit']>[0];
  /**
   * Whether the form's other inputs are valid. The submit button stays
   * disabled until this is true AND the password is filled.
   */
  formValid: boolean;
  /** Copy for the submit button when idle (e.g. "Submit vote", "Second"). */
  submitLabel: string;
  /** Success state title and body. */
  successTitle: string;
  successBody: string;
  /** Called when the user dismisses the success state. */
  onDismiss: () => void;
  /**
   * Whether the Ledger xx network app can sign this sheet's extrinsic.
   * Verified per-pallet against a real device: treasury + bounties
   * calls parse; democracy calls are absent from the app entirely.
   * Defaults to 'unsupported' (fail closed) — sheets whose calls are
   * known-good opt in with 'supported'. Irrelevant for local accounts.
   */
  ledgerCapability?: 'supported' | 'unsupported';
}

export function TxFooter({
  signerAddress,
  onSignerChange,
  accounts,
  txBuilder,
  formValid,
  submitLabel,
  successTitle,
  successBody,
  onDismiss,
  ledgerCapability = 'unsupported',
}: TxFooterProps) {
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const { submit, status, error, reset: resetTx } = useTx();

  // Ledger signer handling: when the selected signer is a Ledger
  // account, there is no password — either the sheet's call is
  // app-supported and signing happens on the device, or it isn't and
  // we block with an honest explanation instead of letting the device
  // refuse mid-flow.
  const signerIsLedger = isLedgerAddress(signerAddress);
  const ledgerBlocked = signerIsLedger && ledgerCapability === 'unsupported';

  const isSubmitting =
    status === 'signing' ||
    status === 'broadcasting' ||
    status === 'in-block';
  const isFinalized = status === 'finalized';

  // Clear password + diagnostic when the form is dismissed externally.
  useEffect(() => {
    return () => {
      // best-effort cleanup; the consumer typically resets via state too
      resetTx();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    setPassword('');
    setPasswordError(null);
    resetTx();
    onDismiss();
  };

  const onSubmit = async () => {
    if (!formValid || ledgerBlocked) return;
    if (!signerIsLedger && !password.trim()) {
      setPasswordError('Enter your password to sign');
      return;
    }
    setPasswordError(null);
    try {
      await submit(txBuilder, {
        address: signerAddress,
        password: signerIsLedger ? undefined : password,
      });
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (
        !signerIsLedger &&
        (msg.toLowerCase().includes('password') ||
          msg.toLowerCase().includes('unable to decode') ||
          msg.toLowerCase().includes('incorrect'))
      ) {
        setPasswordError('Incorrect password. Please try again.');
      }
    }
  };

  if (isFinalized) {
    return (
      <div className="space-y-3 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-xx-500/10 text-xx-500 flex items-center justify-center">
          <Check size={24} strokeWidth={2.5} />
        </div>
        <p className="font-display text-base text-ink-100">{successTitle}</p>
        <p className="text-sm text-ink-400">{successBody}</p>
        <button
          onClick={dismiss}
          className="w-full py-3 rounded-2xl bg-ink-800 text-ink-100 font-medium text-base active:bg-ink-700 transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SignerPicker
        accounts={accounts}
        signerAddress={signerAddress}
        onChange={onSignerChange}
        disabled={isSubmitting}
      />

      {ledgerBlocked ? (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-warning flex-shrink-0 mt-0.5" />
          <p className="text-xs text-ink-200 leading-relaxed">
            The Ledger xx network app can't sign this type of transaction
            yet. Pick one of your password-protected accounts as the
            signer instead.
          </p>
        </div>
      ) : signerIsLedger ? (
        <div className="rounded-xl border border-ink-700/50 bg-ink-800 p-3 flex items-start gap-2">
          <Usb size={14} className="text-xx-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-ink-200 leading-relaxed">
            Your Ledger will show this transaction — check the details on
            the device screen and approve there.
            {status === 'signing' && (
              <span className="block mt-1 text-xx-500 font-medium">
                Waiting for the device…
              </span>
            )}
          </p>
        </div>
      ) : (
        <PasswordField
          value={password}
          onChange={(v) => {
            setPassword(v);
            setPasswordError(null);
          }}
          error={passwordError}
          disabled={isSubmitting}
        />
      )}

      {error && status === 'error' && (
        <div className="rounded-xl border border-danger/40 bg-danger/5 p-3 space-y-1">
          <p className="text-xs text-danger font-medium">Submission failed</p>
          <p className="text-xs text-ink-400 font-mono break-all">
            {error.message || String(error)}
          </p>
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={!formValid || isSubmitting || ledgerBlocked}
        className="w-full py-3 rounded-2xl bg-xx-500 text-ink-950 font-display font-medium text-base active:bg-xx-600 disabled:opacity-40 disabled:active:bg-xx-500 transition-colors"
      >
        {isSubmitting ? statusLabel(status, signerIsLedger) : submitLabel}
      </button>
    </div>
  );
}

function SignerPicker({
  accounts,
  signerAddress,
  onChange,
  disabled,
}: {
  accounts: Array<{ address: string; name?: string }>;
  signerAddress: string;
  onChange: (addr: string) => void;
  disabled?: boolean;
}) {
  const { identity } = useIdentity(signerAddress);
  const name = displayName(identity, signerAddress);
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-ink-400">Signed by</label>
      <select
        value={signerAddress}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || accounts.length <= 1}
        className="w-full px-3 py-2.5 rounded-2xl bg-ink-900 border border-ink-800 text-sm text-ink-100 focus:outline-none focus:border-ink-600 disabled:opacity-50"
      >
        {accounts.map((a) => (
          <option key={a.address} value={a.address}>
            {a.name || a.address.slice(0, 8) + '…'} ({a.address.slice(0, 5)}…{a.address.slice(-4)})
          </option>
        ))}
      </select>
      {name.secondary && (
        <p className="text-xs text-ink-500 font-mono truncate">
          {name.secondary}
        </p>
      )}
    </div>
  );
}

function PasswordField({
  value,
  onChange,
  error,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-ink-400">Password</label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Your wallet password"
        className={clsx(
          'w-full px-3 py-2.5 rounded-2xl bg-ink-900 border text-sm text-ink-100 focus:outline-none focus:border-ink-600 disabled:opacity-50',
          error ? 'border-danger/50' : 'border-ink-800'
        )}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function statusLabel(
  s: ReturnType<typeof useTx>['status'],
  isLedger: boolean
): string {
  switch (s) {
    case 'signing':
      // For a Ledger signer, 'signing' means the user is reading and
      // approving on the device — say so.
      return isLedger ? 'Confirm on your Ledger…' : 'Signing…';
    case 'broadcasting':
      return 'Broadcasting…';
    case 'in-block':
      return 'In block, waiting for finality…';
    default:
      return 'Submitting…';
  }
}
