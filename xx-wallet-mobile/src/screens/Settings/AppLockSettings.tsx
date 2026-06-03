import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Check, Clock, KeyRound, Lock } from 'lucide-react';
import { Sheet } from '@/components/ui';
import {
  useSettingsStore,
  useLockStore,
  AUTO_LOCK_OPTIONS,
} from '@/store';
import { PIN_MIN_LENGTH, hashPin, randomSaltHex, verifyPin } from '@/utils';

/**
 * App-lock settings — enable / change / disable the opt-in PIN access gate
 * and choose the auto-lock delay. The lock gates opening the app; it does
 * not protect the keys, which stay encrypted with the signing password.
 */
export function AppLockSettings() {
  const appLock = useSettingsStore((s) => s.appLock);
  const [pinSheet, setPinSheet] = useState<null | 'set' | 'change' | 'disable'>(
    null
  );
  const [autoLockSheet, setAutoLockSheet] = useState(false);

  const isOn = appLock.mode !== 'off';
  const autoLockLabel =
    AUTO_LOCK_OPTIONS.find((o) => o.ms === appLock.autoLockMs)?.label ?? 'Custom';

  return (
    <section className="space-y-2">
      <div className="px-1">
        <h2 className="text-xs uppercase tracking-wider text-ink-400 font-medium">
          App lock
        </h2>
      </div>

      <div className="space-y-2">
        <LockRow
          icon={<Lock size={18} className="text-ink-400" />}
          label="App lock"
          value={isOn ? 'On · PIN' : 'Off'}
          onClick={() => setPinSheet(isOn ? 'disable' : 'set')}
        />

        {isOn && (
          <>
            <LockRow
              icon={<Clock size={18} className="text-ink-400" />}
              label="Auto-lock"
              value={autoLockLabel}
              onClick={() => setAutoLockSheet(true)}
            />
            <LockRow
              icon={<KeyRound size={18} className="text-ink-400" />}
              label="Change PIN"
              value=""
              onClick={() => setPinSheet('change')}
            />
          </>
        )}

        <p className="px-1 text-xs text-ink-400 leading-relaxed">
          Requires a PIN to open the wallet. This protects your privacy on a
          shared or lost phone — it doesn't replace your wallet password, which
          is still needed to send.
        </p>
      </div>

      <PinManageSheet
        mode={pinSheet}
        onClose={() => setPinSheet(null)}
      />
      <AutoLockSheet
        open={autoLockSheet}
        onClose={() => setAutoLockSheet(false)}
      />
    </section>
  );
}

function LockRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-ink-900 border border-ink-800 active:bg-ink-800/40 transition-colors text-left"
    >
      <span className="flex items-center gap-3 min-w-0">
        {icon}
        <span className="text-sm text-ink-100">{label}</span>
      </span>
      <span className="text-sm text-ink-400 flex-shrink-0">{value}</span>
    </button>
  );
}

type PinMode = 'set' | 'change' | 'disable' | null;

function PinManageSheet({
  mode,
  onClose,
}: {
  mode: PinMode;
  onClose: () => void;
}) {
  const appLock = useSettingsStore((s) => s.appLock);
  const setAppPin = useSettingsStore((s) => s.setAppPin);
  const disableAppLock = useSettingsStore((s) => s.disableAppLock);
  const unlock = useLockStore((s) => s.unlock);

  // For 'change' and 'disable' we first verify the current PIN.
  const needsCurrent = mode === 'change' || mode === 'disable';
  const [step, setStep] = useState<'current' | 'new' | 'confirm'>(
    needsCurrent ? 'current' : 'new'
  );
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset whenever the sheet opens for a new mode.
  useEffect(() => {
    setStep(mode === 'change' || mode === 'disable' ? 'current' : 'new');
    setCurrent('');
    setPin('');
    setConfirm('');
    setError(null);
    setBusy(false);
  }, [mode]);

  const title =
    mode === 'set'
      ? 'Set a PIN'
      : mode === 'change'
        ? 'Change PIN'
        : 'Turn off app lock';

  const verifyCurrent = async () => {
    if (busy || !appLock.pinSalt || !appLock.pinHash) return;
    setBusy(true);
    setError(null);
    const ok = await verifyPin(current, appLock.pinSalt, appLock.pinHash);
    setBusy(false);
    if (!ok) {
      setError('Incorrect PIN.');
      setCurrent('');
      return;
    }
    if (mode === 'disable') {
      disableAppLock();
      onClose();
    } else {
      setStep('new');
    }
  };

  const submitNew = () => {
    if (pin.length < PIN_MIN_LENGTH) {
      setError(`Use at least ${PIN_MIN_LENGTH} digits.`);
      return;
    }
    setError(null);
    setStep('confirm');
  };

  const submitConfirm = async () => {
    if (busy) return;
    if (confirm !== pin) {
      setError("PINs don't match.");
      setConfirm('');
      return;
    }
    setBusy(true);
    const salt = randomSaltHex();
    const hash = await hashPin(pin, salt);
    setAppPin(salt, hash);
    unlock(); // we're already in the app; don't lock the user out
    setBusy(false);
    onClose();
  };

  const pinInput = (
    value: string,
    setValue: (v: string) => void,
    placeholder: string,
    onEnter: () => void
  ) => (
    <input
      type="password"
      inputMode="numeric"
      autoComplete="off"
      autoFocus
      value={value}
      onChange={(e) => {
        setValue(e.target.value.replace(/\D/g, ''));
        setError(null);
      }}
      onKeyDown={(e) => e.key === 'Enter' && onEnter()}
      disabled={busy}
      placeholder={placeholder}
      className="w-full text-center tracking-[0.4em] px-3 py-3 rounded-2xl bg-ink-950 border border-ink-800 text-lg font-mono text-ink-100 placeholder:text-ink-600 focus:outline-none focus:border-ink-600 disabled:opacity-50"
    />
  );

  return (
    <Sheet open={mode !== null} onClose={onClose} title={title}>
      <div className="space-y-3">
        {step === 'current' && (
          <>
            <p className="text-sm text-ink-400">Enter your current PIN.</p>
            {pinInput(current, setCurrent, '••••••', verifyCurrent)}
            {error && <p className="text-xs text-danger">{error}</p>}
            <PrimaryButton
              onClick={verifyCurrent}
              disabled={busy || current.length === 0}
              label={busy ? 'Checking…' : 'Continue'}
            />
          </>
        )}

        {step === 'new' && (
          <>
            <p className="text-sm text-ink-400">
              Choose a PIN ({PIN_MIN_LENGTH}+ digits).
            </p>
            {pinInput(pin, setPin, 'New PIN', submitNew)}
            {error && <p className="text-xs text-danger">{error}</p>}
            <PrimaryButton
              onClick={submitNew}
              disabled={pin.length === 0}
              label="Next"
            />
          </>
        )}

        {step === 'confirm' && (
          <>
            <p className="text-sm text-ink-400">Re-enter your PIN to confirm.</p>
            {pinInput(confirm, setConfirm, 'Confirm PIN', submitConfirm)}
            {error && <p className="text-xs text-danger">{error}</p>}
            <PrimaryButton
              onClick={submitConfirm}
              disabled={busy || confirm.length === 0}
              label={busy ? 'Saving…' : 'Save PIN'}
            />
          </>
        )}
      </div>
    </Sheet>
  );
}

function AutoLockSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const autoLockMs = useSettingsStore((s) => s.appLock.autoLockMs);
  const setAutoLockMs = useSettingsStore((s) => s.setAutoLockMs);
  return (
    <Sheet open={open} onClose={onClose} title="Auto-lock">
      <p className="text-sm text-ink-400 mb-3">
        Lock the app after it's been in the background this long.
      </p>
      <ul className="space-y-1">
        {AUTO_LOCK_OPTIONS.map((o) => {
          const active = o.ms === autoLockMs;
          return (
            <li key={o.ms}>
              <button
                onClick={() => {
                  setAutoLockMs(o.ms);
                  onClose();
                }}
                className={clsx(
                  'w-full flex items-center justify-between px-4 py-3 rounded-2xl border transition-colors',
                  active
                    ? 'bg-xx-500/10 border-xx-500/30 text-xx-500'
                    : 'bg-ink-900 border-ink-800 text-ink-100 active:bg-ink-800/40'
                )}
              >
                <span className="text-sm">{o.label}</span>
                {active && <Check size={16} strokeWidth={2.5} />}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  label,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full py-3 rounded-2xl bg-xx-500 text-ink-950 text-sm font-medium active:opacity-80 disabled:bg-ink-800 disabled:text-ink-500"
    >
      {label}
    </button>
  );
}
