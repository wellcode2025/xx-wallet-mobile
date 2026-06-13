import { useEffect, useState } from 'react';
import { Fingerprint, Lock } from 'lucide-react';
import { useSettingsStore, useLockStore, useAccountsStore } from '@/store';
import { verifyPin, verifyBiometric } from '@/utils';
import { xxKeyring } from '@/keyring';

/**
 * Full-screen unlock gate, shown by RequireAccount when an app-lock is
 * enabled and the session is locked.
 *
 * Three views:
 *  - biometric: tap to prompt the platform authenticator (fingerprint/face);
 *    shown first when biometric mode is on. "Use PIN instead" falls back.
 *  - pin: PIN entry with attempt rate limiting; "Forgot PIN?" → recovery.
 *  - recovery: verify any wallet's signing password (which the user must know
 *    to use the wallet anyway) and turn the lock off so they can set a new PIN.
 *
 * The lock is an access gate only — it never touches the keys, which stay
 * encrypted with the signing password regardless.
 */
export function LockScreen() {
  const { mode, pinSalt, pinHash, biometricCredentialId } = useSettingsStore(
    (s) => s.appLock
  );
  const disableAppLock = useSettingsStore((s) => s.disableAppLock);
  const { accounts, activeAddress } = useAccountsStore();
  const unlock = useLockStore((s) => s.unlock);
  const recordFailure = useLockStore((s) => s.recordFailure);
  const cooldownUntil = useLockStore((s) => s.cooldownUntil);

  const [view, setView] = useState<'biometric' | 'pin' | 'recovery'>(
    mode === 'biometric' ? 'biometric' : 'pin'
  );

  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [bioError, setBioError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [recoverError, setRecoverError] = useState<string | null>(null);

  // Tick once a second while in cooldown so the countdown updates.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  const inCooldown = cooldownLeft > 0;

  const submitBiometric = async () => {
    if (busy || !biometricCredentialId) return;
    setBusy(true);
    setBioError(null);
    const ok = await verifyBiometric(biometricCredentialId);
    setBusy(false);
    if (ok) {
      unlock();
    } else {
      setBioError("Couldn't verify. Try again, or use your PIN.");
    }
  };

  const submitPin = async () => {
    if (busy || inCooldown || pin.length === 0 || !pinSalt || !pinHash) return;
    setBusy(true);
    setError(null);
    const ok = await verifyPin(pin, pinSalt, pinHash);
    setBusy(false);
    if (ok) {
      unlock();
    } else {
      recordFailure();
      setPin('');
      setError('Incorrect PIN.');
    }
  };

  const submitRecovery = async () => {
    if (busy || accounts.length === 0 || password.length === 0) return;
    setBusy(true);
    setRecoverError(null);
    try {
      // A forgotten PIN can be cleared with the password to ANY of the
      // user's wallets (each account has its own, possibly different,
      // password). Try the active account first for speed, then the rest,
      // and unlock on the first that decrypts.
      const ordered = [
        ...(activeAddress ? [activeAddress] : []),
        ...accounts
          .map((a) => a.address)
          .filter((a) => a !== activeAddress),
      ];
      let ok = false;
      for (const addr of ordered) {
        try {
          if (await xxKeyring.verifyPassword(addr, password)) {
            ok = true;
            break;
          }
        } catch {
          /* try the next account */
        }
      }
      if (ok) {
        disableAppLock(); // user re-enables + sets a new PIN in Settings
        unlock();
      } else {
        setRecoverError("That password didn't match any of your wallets.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink-950 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-xs flex flex-col items-center gap-6">
        <div className="w-16 h-16 rounded-full bg-ink-900 border border-ink-800 flex items-center justify-center">
          {view === 'biometric' ? (
            <Fingerprint size={26} strokeWidth={1.75} className="text-xx-500" />
          ) : (
            <Lock size={26} strokeWidth={1.75} className="text-xx-500" />
          )}
        </div>

        {view === 'biometric' && (
          <>
            <div className="text-center space-y-1">
              <p className="font-display font-medium text-lg text-ink-100">
                Wallet locked
              </p>
              <p className="text-sm text-ink-400">
                Unlock with your fingerprint or face.
              </p>
            </div>

            <div className="w-full space-y-2">
              {bioError && (
                <p className="text-xs text-danger text-center">{bioError}</p>
              )}
              <button
                onClick={submitBiometric}
                disabled={busy}
                className="w-full py-3 rounded-2xl bg-xx-500 text-ink-950 text-sm font-medium active:opacity-80 disabled:bg-ink-800 disabled:text-ink-500 flex items-center justify-center gap-2"
              >
                <Fingerprint size={18} strokeWidth={2} />
                {busy ? 'Verifying…' : 'Unlock with biometrics'}
              </button>
            </div>

            <button
              onClick={() => {
                setView('pin');
                setBioError(null);
              }}
              className="text-xs text-ink-400 active:text-ink-200"
            >
              Use PIN instead
            </button>
          </>
        )}

        {view === 'pin' && (
          <>
            <div className="text-center space-y-1">
              <p className="font-display font-medium text-lg text-ink-100">
                Wallet locked
              </p>
              <p className="text-sm text-ink-400">Enter your PIN to continue.</p>
            </div>

            <div className="w-full space-y-2">
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, ''));
                  setError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && submitPin()}
                disabled={busy || inCooldown}
                placeholder="••••••"
                className="w-full text-center tracking-[0.4em] px-3 py-3 rounded-2xl bg-ink-900 border border-ink-800 text-lg font-mono text-ink-100 placeholder:text-ink-600 focus:outline-none focus:border-ink-600 disabled:opacity-50"
              />
              {error && <p className="text-xs text-danger text-center">{error}</p>}
              {inCooldown && (
                <p className="text-xs text-warning text-center">
                  Too many attempts. Try again in {cooldownLeft}s.
                </p>
              )}
              <button
                onClick={submitPin}
                disabled={busy || inCooldown || pin.length === 0}
                className="w-full py-3 rounded-2xl bg-xx-500 text-ink-950 text-sm font-medium active:opacity-80 disabled:bg-ink-800 disabled:text-ink-500"
              >
                {busy ? 'Checking…' : 'Unlock'}
              </button>
            </div>

            <div className="flex flex-col items-center gap-2">
              {mode === 'biometric' && biometricCredentialId && (
                <button
                  onClick={() => {
                    setView('biometric');
                    setError(null);
                  }}
                  className="text-xs text-ink-400 active:text-ink-200"
                >
                  Use biometrics instead
                </button>
              )}
              <button
                onClick={() => {
                  setView('recovery');
                  setError(null);
                }}
                className="text-xs text-ink-400 active:text-ink-200"
              >
                Forgot PIN?
              </button>
            </div>
          </>
        )}

        {view === 'recovery' && (
          <>
            <div className="text-center space-y-1">
              <p className="font-display font-medium text-lg text-ink-100">
                Forgot PIN
              </p>
              <p className="text-sm text-ink-400 leading-relaxed">
                Enter the password for any of your wallets to unlock. This turns
                the app lock off — set a new PIN afterward in Settings.
              </p>
            </div>

            <div className="w-full space-y-2">
              <input
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setRecoverError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && submitRecovery()}
                disabled={busy}
                placeholder="Wallet password"
                className="w-full px-3 py-3 rounded-2xl bg-ink-900 border border-ink-800 text-sm text-ink-100 placeholder:text-ink-300 focus:outline-none focus:border-ink-600 disabled:opacity-50"
              />
              {recoverError && (
                <p className="text-xs text-danger text-center">{recoverError}</p>
              )}
              <button
                onClick={submitRecovery}
                disabled={busy || password.length === 0}
                className="w-full py-3 rounded-2xl bg-xx-500 text-ink-950 text-sm font-medium active:opacity-80 disabled:bg-ink-800 disabled:text-ink-500"
              >
                {busy ? 'Checking…' : 'Unlock with password'}
              </button>
            </div>

            <p className="text-xs text-ink-400 text-center leading-relaxed">
              Don't remember any password either? You can reinstall the app and
              restore from your recovery phrase — your keys aren't lost.
            </p>

            <button
              onClick={() => {
                setView(mode === 'biometric' ? 'biometric' : 'pin');
                setPassword('');
                setRecoverError(null);
              }}
              className="text-xs text-ink-400 active:text-ink-200"
            >
              ← Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
