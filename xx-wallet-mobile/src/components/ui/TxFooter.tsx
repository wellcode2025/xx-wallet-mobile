import clsx from 'clsx';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { displayName, useIdentity } from '@/governance';
import { useTx } from '@/hooks';

/**
 * TxFooter — reusable footer for all democracy action sheets in
 * Slice 6+.
 *
 * Renders:
 *   - Signed-by picker (defaults to active address, dropdown for others)
 *   - Password field with error-state feedback
 *   - Submit button with status copy ("Signing…" / "Broadcasting…" / …)
 *   - Per-state error UI showing error.message verbatim (per
 *     feedback_surface_error_message_on_screen)
 *   - Success state with checkmark + Done button
 *
 * The signer-picker discipline (never silently use activeAddress)
 * comes from feedback_multisig_signer_picker — established in Phase
 * 2a multisig, mirrored in every Phase 4b participate sheet.
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
}: TxFooterProps) {
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const { submit, status, error, reset: resetTx } = useTx();

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
    if (!formValid) return;
    if (!password.trim()) {
      setPasswordError('Enter your password to sign');
      return;
    }
    setPasswordError(null);
    try {
      await submit(txBuilder, { address: signerAddress, password });
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (
        msg.toLowerCase().includes('password') ||
        msg.toLowerCase().includes('unable to decode') ||
        msg.toLowerCase().includes('incorrect')
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

      <PasswordField
        value={password}
        onChange={(v) => {
          setPassword(v);
          setPasswordError(null);
        }}
        error={passwordError}
        disabled={isSubmitting}
      />

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
        disabled={!formValid || isSubmitting}
        className="w-full py-3 rounded-2xl bg-xx-500 text-ink-950 font-display font-medium text-base active:bg-xx-600 disabled:opacity-40 disabled:active:bg-xx-500 transition-colors"
      >
        {isSubmitting ? statusLabel(status) : submitLabel}
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

function statusLabel(s: ReturnType<typeof useTx>['status']): string {
  switch (s) {
    case 'signing':
      return 'Signing…';
    case 'broadcasting':
      return 'Broadcasting…';
    case 'in-block':
      return 'In block, waiting for finality…';
    default:
      return 'Submitting…';
  }
}
