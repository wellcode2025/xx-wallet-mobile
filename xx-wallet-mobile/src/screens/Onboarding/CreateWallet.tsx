import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Eye,
  EyeOff,
  Shield,
  Copy,
  Check,
  AlertTriangle,
  Loader2,
  KeyRound,
  Atom,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { xxKeyring, generateSleeveAccount, initSleeve } from '@/keyring';
import { useAccountsStore } from '@/store';
import { TopBar } from '@/components/layout';
import { isCommonPassword } from '@/utils';
import { copyToClipboard } from '@/utils/clipboard';
import clsx from 'clsx';

type Step = 'password' | 'security' | 'generating' | 'reveal' | 'confirm';

// ---------------------------------------------------------------------------
// Persisted onboarding state
//
// Mobile browsers (and the PWA service worker, even with the new 'prompt'
// update mode) can lose the React JS context when the user backgrounds the
// wallet — for example, to switch to a password manager and paste a
// mnemonic. Without persistence, the next foreground brings up a fresh
// CreateWallet component with empty state, and the *generating* step would
// produce DIFFERENT mnemonics than what the user just wrote down. That's
// not just bad UX; it's a path to lost funds (the user backs up phrases
// that don't correspond to the eventually-created account).
//
// We persist to sessionStorage (per-tab; auto-cleared when the tab/PWA is
// closed) so the same mnemonics are restored on remount. Password fields
// are included because handleConfirm needs them to call createFromMnemonic
// at the end — without them we'd have to re-prompt for password mid-flow,
// which is its own UX trap.
//
// Threat model: same-origin JS can read sessionStorage during the create
// flow's lifetime. Our CSP disallows external/inline scripts, so the
// realistic attacker is a malicious browser extension — explicitly out of
// scope per SECURITY.md. Cleared on successful account creation.
// ---------------------------------------------------------------------------
const CREATE_FLOW_STATE_KEY = 'xx-wallet:create-flow:state';

interface PersistedCreateFlowState {
  step: Step;
  name: string;
  password: string;
  passwordConfirm: string;
  ackOffline: boolean;
  ackBrowser: boolean;
  quantumMnemonic: string;
  standardMnemonic: string;
  confirmPicks: { quantum: number[]; standard: number[] };
  // The words the user has typed back during the confirm step. Persisted
  // so backgrounding mid-verification (e.g. to check the next word in a
  // password manager) doesn't lose what they've already typed. Same
  // threat model as the mnemonics themselves — these words are a subset
  // of the full mnemonic, which is already in sessionStorage during the
  // create flow.
  confirmInputs: {
    quantum: Record<number, string>;
    standard: Record<number, string>;
  };
}

function loadCreateFlowState(): Partial<PersistedCreateFlowState> {
  try {
    const raw = sessionStorage.getItem(CREATE_FLOW_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedCreateFlowState;
    // Restore mid-flow steps only when we actually have mnemonics.
    // Otherwise reset to 'password' — restoring 'generating' would
    // deadlock (the gen-useEffect skips when mnemonics are present).
    if ((parsed.step === 'reveal' || parsed.step === 'confirm') &&
        (!parsed.quantumMnemonic || !parsed.standardMnemonic)) {
      parsed.step = 'password';
    }
    if (parsed.step === 'generating') {
      parsed.step = 'password';
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveCreateFlowState(state: PersistedCreateFlowState): void {
  try {
    sessionStorage.setItem(CREATE_FLOW_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore — sessionStorage may be disabled (private mode in some
    // browsers) or quota-exceeded. The wallet still works; the user
    // just loses the persistence safety net.
  }
}

function clearCreateFlowState(): void {
  try {
    sessionStorage.removeItem(CREATE_FLOW_STATE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Four-step Sleeve-by-default create flow:
 *   1. Name + password.
 *   2. Generate Sleeve via the WASM (loads on demand). Spinner while running.
 *   3. Reveal BOTH the quantum and standard recovery phrases for backup.
 *   4. Confirm a few random words from each phrase to prove backup.
 *
 * Sleeve is the only account-creation flow (no plain-account opt-out),
 * the quantum mnemonic is shown once and never stored, and the standard
 * mnemonic feeds the existing createFromMnemonic path so the resulting
 * xx network address is identical to what wallet.xx.network would produce
 * from the same standard mnemonic.
 */
export function CreateWallet() {
  const navigate = useNavigate();
  const refreshAccounts = useAccountsStore((s) => s.refresh);

  // Load any persisted in-progress create flow state. This restores the
  // exact same mnemonics the user just wrote down if the page is reloaded
  // (service-worker update, mobile-tab-eviction, manual refresh, etc.)
  // mid-onboarding. See the PersistedCreateFlowState block above for the
  // threat-model rationale.
  const persisted = useMemo(() => loadCreateFlowState(), []);

  const [step, setStep] = useState<Step>(persisted.step ?? 'password');

  // Step 1 — name + password
  const [name, setName] = useState(persisted.name ?? 'Main account');
  const [password, setPassword] = useState(persisted.password ?? '');
  const [passwordConfirm, setPasswordConfirm] = useState(persisted.passwordConfirm ?? '');
  const [showPassword, setShowPassword] = useState(false);

  // Step 2 — OPSEC attestations. Modeled on sleeve.xx.network's flow because
  // if this wallet ever gets foundation endorsement we want the security
  // hygiene to match what the official tool already trains users to expect.
  const [ackOffline, setAckOffline] = useState(persisted.ackOffline ?? false);
  const [ackBrowser, setAckBrowser] = useState(persisted.ackBrowser ?? false);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  // Step 2/3 — Sleeve mnemonics (generated, never stored after this screen
  // beyond sessionStorage during the create flow itself; cleared on success)
  const [quantumMnemonic, setQuantumMnemonic] = useState(persisted.quantumMnemonic ?? '');
  const [standardMnemonic, setStandardMnemonic] = useState(persisted.standardMnemonic ?? '');
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<'quantum' | 'standard' | null>(null);

  // Step 4 — confirm words from both phrases
  const [confirmPicks, setConfirmPicks] = useState<{
    quantum: number[];
    standard: number[];
  }>(persisted.confirmPicks ?? { quantum: [], standard: [] });
  const [confirmInputs, setConfirmInputs] = useState<{
    quantum: Record<number, string>;
    standard: Record<number, string>;
  }>(persisted.confirmInputs ?? { quantum: {}, standard: {} });
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Persist the flow state on every meaningful change. Skip 'generating' —
  // that's a transient step that resolves to 'reveal' in the same render
  // cycle once mnemonics arrive, and persisting it would risk a deadlocked
  // restore (covered defensively in loadCreateFlowState too).
  useEffect(() => {
    if (step === 'generating') return;
    saveCreateFlowState({
      step,
      name,
      password,
      passwordConfirm,
      ackOffline,
      ackBrowser,
      quantumMnemonic,
      standardMnemonic,
      confirmPicks,
      confirmInputs,
    });
  }, [
    step,
    name,
    password,
    passwordConfirm,
    ackOffline,
    ackBrowser,
    quantumMnemonic,
    standardMnemonic,
    confirmPicks,
    confirmInputs,
  ]);

  // Pre-warm the Sleeve WASM as soon as the user lands on the password screen.
  // The 3.3 MB module takes a noticeable moment to fetch + instantiate on
  // first use; doing it in the background while they type avoids a second
  // wait when they hit "Continue". (If they go offline before the security
  // step, the WASM is already cached and will run from the service worker.)
  useEffect(() => {
    if (step === 'password') {
      initSleeve().catch(() => {
        // Swallow — the actual generation call will surface a real error if
        // init still fails when we get to step 'generating'.
      });
    }
  }, [step]);

  // Track online/offline state reactively so the security step's indicator
  // updates the moment the user toggles airplane mode / disconnects WiFi.
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // When entering 'generating', kick off the actual Sleeve generation.
  useEffect(() => {
    if (step === 'generating' && !quantumMnemonic) {
      (async () => {
        try {
          const result = await generateSleeveAccount();
          setQuantumMnemonic(result.quantumMnemonic);
          setStandardMnemonic(result.standardMnemonic);
          setStep('reveal');
        } catch (err) {
          setGenerationError((err as Error).message);
        }
      })();
    }
  }, [step, quantumMnemonic]);

  // When entering 'confirm', pick 2 random words from each phrase to verify.
  useEffect(() => {
    if (step === 'confirm' && confirmPicks.quantum.length === 0) {
      setConfirmPicks({
        quantum: pickRandomIndices(2, 24),
        standard: pickRandomIndices(2, 24),
      });
    }
  }, [step, confirmPicks.quantum.length]);

  // L-3: refuse the worst-offending common passwords. This isn't a strength
  // meter — just a hard floor that catches `12345678`, `password123`, etc.
  // before they get encrypted under any KDF.
  const passwordTooCommon = password.length > 0 && isCommonPassword(password);

  const passwordValid =
    password.length >= 8 &&
    password === passwordConfirm &&
    name.trim().length > 0 &&
    !passwordTooCommon;

  const allConfirmInputsFilled = useMemo(() => {
    return (
      confirmPicks.quantum.every((i) => (confirmInputs.quantum[i] ?? '').trim().length > 0) &&
      confirmPicks.standard.every((i) => (confirmInputs.standard[i] ?? '').trim().length > 0)
    );
  }, [confirmPicks, confirmInputs]);

  const handleCopy = async (kind: 'quantum' | 'standard') => {
    const text = kind === 'quantum' ? quantumMnemonic : standardMnemonic;
    // Use the shared copyToClipboard helper, which tries
    // navigator.clipboard.writeText first (secure context only) and falls
    // back to document.execCommand('copy') on plain-HTTP origins like the
    // LAN dev server. Without this, the button silently no-ops on HTTP.
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedKey(kind);
      setTimeout(() => setCopiedKey((c) => (c === kind ? null : c)), 1500);
      // Clipboard hygiene (AUDIT-2026-06-12-009): a recovery phrase left on the
      // system clipboard can be read by clipboard-history managers and
      // cross-device clipboard sync. Best-effort: after a delay, clear it — but
      // only if OUR phrase is still the clipboard contents, so we never clobber
      // anything the user copied since. Silently no-ops on the legacy/HTTP path
      // or where clipboard read is denied; the on-screen caution is the
      // user-facing guarantee, this is defense-in-depth.
      if (navigator.clipboard && window.isSecureContext) {
        window.setTimeout(async () => {
          try {
            if ((await navigator.clipboard.readText()) === text) {
              await navigator.clipboard.writeText('');
            }
          } catch {
            // clipboard read/write unavailable or denied — leave it untouched
          }
        }, 45_000);
      }
    }
  };

  const handleConfirm = async () => {
    setError(null);
    const qWords = quantumMnemonic.split(' ');
    const sWords = standardMnemonic.split(' ');

    for (const idx of confirmPicks.quantum) {
      const expected = qWords[idx].toLowerCase().trim();
      const actual = (confirmInputs.quantum[idx] ?? '').toLowerCase().trim();
      if (expected !== actual) {
        setError(
          `Quantum word #${idx + 1} doesn't match. Check your backup and try again.`
        );
        return;
      }
    }
    for (const idx of confirmPicks.standard) {
      const expected = sWords[idx].toLowerCase().trim();
      const actual = (confirmInputs.standard[idx] ?? '').toLowerCase().trim();
      if (expected !== actual) {
        setError(
          `Standard word #${idx + 1} doesn't match. Check your backup and try again.`
        );
        return;
      }
    }

    setCreating(true);
    try {
      // The standard mnemonic feeds the existing sr25519 path, producing
      // the canonical xx network address. The quantum mnemonic is dropped
      // here — only the user's backup preserves it.
      await xxKeyring.createFromMnemonic(standardMnemonic, {
        name: name.trim(),
        password,
      });
      // Account is now persisted; the in-flight create-flow state (which
      // includes the password and both mnemonics) is no longer needed and
      // shouldn't linger in sessionStorage where another script in the
      // same origin could read it.
      clearCreateFlowState();
      refreshAccounts();
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  };

  return (
    <>
      <TopBar title="Create wallet" showBack showConnection={false} />
      <div className="px-6 py-6 max-w-md mx-auto">
        {step === 'password' && (
          <div className="space-y-6">
            <div>
              <h2 className="font-display font-semibold text-2xl tracking-tight">
                Name & password
              </h2>
              <p className="text-ink-400 text-sm mt-1">
                Your password encrypts your wallet on this device.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                  Account name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-base"
                  placeholder="Main account"
                  maxLength={32}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-base pr-12"
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-ink-400"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {passwordTooCommon && (
                  <p className="text-xs text-danger mt-1.5">
                    This password is on a list of commonly-used passwords.
                    Please choose a different one.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                  Confirm password
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  className="input-base"
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                />
                {passwordConfirm && password !== passwordConfirm && (
                  <p className="text-xs text-danger mt-1.5">Passwords don't match</p>
                )}
              </div>
            </div>

            <button
              onClick={() => setStep('security')}
              disabled={!passwordValid}
              className="btn-primary w-full"
            >
              Continue
            </button>
          </div>
        )}

        {step === 'security' && (
          <div className="space-y-6">
            <div>
              <h2 className="font-display font-semibold text-2xl tracking-tight">
                Security check
              </h2>
              <p className="text-ink-400 text-sm mt-1">
                A few acknowledgements before we generate your recovery
                phrases.
              </p>
            </div>

            {/* Live online/offline indicator. Wallet generation never makes
                network calls, but disconnecting reduces the attack surface
                from compromised browser extensions, malicious scripts on
                other tabs, screen-monitoring tools, etc. */}
            <div
              className={clsx(
                'flex items-center gap-3 p-3 rounded-2xl border',
                isOnline
                  ? 'bg-warning/10 border-warning/30'
                  : 'bg-xx-500/10 border-xx-500/40'
              )}
            >
              {isOnline ? (
                <Wifi size={18} className="text-warning flex-shrink-0" />
              ) : (
                <WifiOff size={18} className="text-xx-500 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p
                  className={clsx(
                    'text-sm font-medium',
                    isOnline ? 'text-warning' : 'text-xx-500'
                  )}
                >
                  {isOnline ? 'You are online' : 'You are offline'}
                </p>
                <p className="text-sm text-ink-300 mt-0.5 leading-relaxed">
                  {isOnline
                    ? 'Generation will work fine, but disconnecting first is recommended.'
                    : 'Ideal — generation runs entirely on this device, no network needed.'}
                </p>
              </div>
            </div>

            {/* The actual warning card */}
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-ink-800 border border-ink-700/50">
              <Shield
                size={20}
                className="text-ink-300 flex-shrink-0 mt-0.5"
                strokeWidth={1.75}
              />
              <div className="text-sm text-ink-200 space-y-2">
                <p className="font-medium">
                  Wallet generation runs locally
                </p>
                <p className="text-ink-300 text-xs leading-relaxed">
                  Your recovery phrases are produced by code running in this
                  browser, on your device. Nothing is sent to any server.
                </p>
                <p className="text-ink-300 text-xs leading-relaxed">
                  Recommended: write both phrases on paper. If you'll be
                  doing that, disconnecting from the internet now adds
                  extra protection against screen-monitoring or compromised
                  extensions during generation.
                </p>
              </div>
            </div>

            {/* Attestations — same pattern as sleeve.xx.network */}
            <div className="space-y-3">
              <Attestation
                checked={ackOffline}
                onChange={setAckOffline}
                label="I acknowledge I have disconnected from the internet, or I understand the risk of remaining connected."
              />
              <Attestation
                checked={ackBrowser}
                onChange={setAckBrowser}
                label="I acknowledge I am using a trusted, non-compromised browser."
              />
            </div>

            <button
              onClick={() => setStep('generating')}
              disabled={!ackOffline || !ackBrowser}
              className="btn-primary w-full"
            >
              Generate recovery phrases
            </button>
          </div>
        )}

        {step === 'generating' && (
          <div className="space-y-6 py-12 flex flex-col items-center text-center">
            {!generationError ? (
              <>
                <Loader2 size={40} className="text-xx-500 animate-spin" />
                <div className="space-y-1">
                  <p className="font-display font-medium text-lg text-ink-100">
                    Generating your Sleeve wallet
                  </p>
                  <p className="text-sm text-ink-400 max-w-xs leading-relaxed">
                    Producing two recovery phrases — one for everyday use,
                    one for future quantum-secure rollover.
                  </p>
                </div>
              </>
            ) : (
              <>
                <AlertTriangle size={40} className="text-danger" />
                <div className="space-y-1">
                  <p className="font-display font-medium text-lg text-ink-100">
                    Generation failed
                  </p>
                  <p className="text-sm text-ink-400 max-w-xs leading-relaxed">
                    {generationError}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setGenerationError(null);
                    setStep('password');
                  }}
                  className="btn-secondary"
                >
                  Try again
                </button>
              </>
            )}
          </div>
        )}

        {step === 'reveal' && (
          <div className="space-y-6">
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-warning/10 border border-warning/30">
              <Shield size={20} className="text-warning flex-shrink-0 mt-0.5" />
              <div className="text-sm text-ink-200 space-y-2">
                <p className="font-medium">Two phrases — both required</p>
                <p className="text-ink-300 text-xs leading-relaxed">
                  Recommended: write both down on paper by hand, in order,
                  and store somewhere safe. Password managers and clipboard
                  copy work but trade some security for convenience — your
                  call.
                </p>
                <p className="text-ink-300 text-xs leading-relaxed">
                  Your progress is saved on this device until creation is
                  complete, so you can take your time and switch apps if
                  you need to. The wallet itself never saves these phrases —
                  losing them means losing access.
                </p>
              </div>
            </div>

            <PhraseCard
              kind="quantum"
              title="Quantum recovery phrase"
              accent="text-xx-cyan"
              accentBg="bg-xx-cyan/10"
              accentBorder="border-xx-cyan/40"
              icon={<Atom size={16} className="text-xx-cyan" strokeWidth={2.25} />}
              description="Used to enable quantum-secure protection when xx network adopts it. Back this one up first — it is the master from which the standard phrase is derived."
              mnemonic={quantumMnemonic}
              revealed={revealed}
              onReveal={() => setRevealed(true)}
              onCopy={() => handleCopy('quantum')}
              copied={copiedKey === 'quantum'}
            />

            <PhraseCard
              kind="standard"
              title="Standard recovery phrase"
              accent="text-xx-500"
              accentBg="bg-xx-500/10"
              accentBorder="border-xx-500/40"
              icon={<KeyRound size={16} className="text-xx-500" strokeWidth={2.25} />}
              description="Used for everyday signing on xx network today. Equivalent to a normal recovery phrase from any other Substrate wallet."
              mnemonic={standardMnemonic}
              revealed={revealed}
              onReveal={() => setRevealed(true)}
              onCopy={() => handleCopy('standard')}
              copied={copiedKey === 'standard'}
            />

            <button
              onClick={() => setStep('confirm')}
              disabled={!revealed}
              className="btn-primary w-full"
            >
              I've written down both phrases — continue
            </button>
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-6">
            <div>
              <h2 className="font-display font-semibold text-2xl tracking-tight">
                Verify both backups
              </h2>
              <p className="text-ink-400 text-sm mt-1">
                Enter the requested words from each phrase to confirm you
                have them safely written down.
              </p>
            </div>

            <ConfirmSection
              title="Quantum phrase"
              accent="text-xx-cyan"
              icon={<Atom size={14} className="text-xx-cyan" strokeWidth={2.25} />}
              indices={confirmPicks.quantum}
              inputs={confirmInputs.quantum}
              onChange={(idx, val) =>
                setConfirmInputs((prev) => ({
                  ...prev,
                  quantum: { ...prev.quantum, [idx]: val },
                }))
              }
            />

            <ConfirmSection
              title="Standard phrase"
              accent="text-xx-500"
              icon={<KeyRound size={14} className="text-xx-500" strokeWidth={2.25} />}
              indices={confirmPicks.standard}
              inputs={confirmInputs.standard}
              onChange={(idx, val) =>
                setConfirmInputs((prev) => ({
                  ...prev,
                  standard: { ...prev.standard, [idx]: val },
                }))
              }
            />

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-danger/10 border border-danger/30 text-sm text-ink-200">
                <AlertTriangle size={16} className="text-danger flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <button
              onClick={handleConfirm}
              disabled={creating || !allConfirmInputsFilled}
              className="btn-primary w-full"
            >
              {creating ? 'Creating…' : 'Create wallet'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers / sub-components

interface AttestationProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

function Attestation({ checked, onChange, label }: AttestationProps) {
  return (
    <label className="flex items-start gap-3 p-3 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700/70 cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <div
        className={clsx(
          'flex-shrink-0 mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors',
          checked
            ? 'bg-xx-500 border-xx-500'
            : 'bg-transparent border-ink-600'
        )}
      >
        {checked && <Check size={14} className="text-ink-950" strokeWidth={3} />}
      </div>
      <span className="text-xs text-ink-200 leading-relaxed flex-1">
        {label}
      </span>
    </label>
  );
}

/**
 * Pick `count` distinct random indices from [0, range). Uses
 * crypto.getRandomValues with rejection sampling against the largest
 * uint32 multiple of `range` to avoid modulo bias for non-power-of-2
 * ranges (24 in our case).
 *
 * Math.random() would technically work for the current "verify 2 words"
 * use case, but switching to a CSPRNG with unbiased sampling is the
 * conservative default for anything in onboarding security.
 */
function pickRandomIndices(count: number, range: number): number[] {
  const pool = Array.from({ length: range }, (_, i) => i);
  const picks: number[] = [];
  const buf = new Uint32Array(1);
  while (picks.length < count) {
    const limit = pool.length;
    // Largest multiple of `limit` that fits in uint32. Values at or above
    // this are rejected; everything below is uniformly distributed mod limit.
    const cutoff = Math.floor(0x100000000 / limit) * limit;
    let r: number;
    do {
      crypto.getRandomValues(buf);
      r = buf[0];
    } while (r >= cutoff);
    const idx = r % limit;
    picks.push(pool.splice(idx, 1)[0]);
  }
  return picks.sort((a, b) => a - b);
}

interface PhraseCardProps {
  kind: 'quantum' | 'standard';
  title: string;
  accent: string;
  accentBg: string;
  accentBorder: string;
  icon: React.ReactNode;
  description: string;
  mnemonic: string;
  revealed: boolean;
  onReveal: () => void;
  onCopy: () => void;
  copied: boolean;
}

function PhraseCard({
  title,
  accent,
  accentBg,
  accentBorder,
  icon,
  description,
  mnemonic,
  revealed,
  onReveal,
  onCopy,
  copied,
}: PhraseCardProps) {
  return (
    <div className={clsx('card space-y-3 border', accentBorder)}>
      <div className="flex items-center gap-2">
        {icon}
        <p className={clsx('text-xs uppercase tracking-wider font-medium', accent)}>
          {title}
        </p>
      </div>
      <p className="text-xs text-ink-400 leading-relaxed">{description}</p>

      <div className="relative">
        <div
          className={clsx(
            'grid grid-cols-2 gap-2 transition-all',
            !revealed && 'blur-md select-none pointer-events-none'
          )}
        >
          {mnemonic.split(' ').map((word, i) => (
            <div
              key={i}
              className={clsx(
                'flex items-center gap-2 p-2 rounded-lg',
                accentBg
              )}
            >
              <span className="text-ink-400 text-xs font-mono w-5 text-right">
                {i + 1}
              </span>
              <span className="font-mono text-sm text-ink-100">{word}</span>
            </div>
          ))}
        </div>

        {!revealed && (
          <button
            onClick={onReveal}
            className="absolute inset-0 flex items-center justify-center"
          >
            <span className="btn-secondary">
              <Eye size={18} />
              Tap to reveal
            </span>
          </button>
        )}
      </div>

      {revealed && (
        <button onClick={onCopy} className="btn-ghost w-full text-ink-300">
          {copied ? (
            <>
              <Check size={16} className="text-xx-500" />
              Copied
            </>
          ) : (
            <>
              <Copy size={16} />
              Copy to clipboard
            </>
          )}
        </button>
      )}
      {revealed && (
        <p className="text-xs text-warning leading-relaxed">
          Copying puts your recovery phrase on the system clipboard, where
          clipboard-history and cross-device-sync apps can read it. If you copy,
          paste it where you need it and clear your clipboard afterwards.
        </p>
      )}
    </div>
  );
}

interface ConfirmSectionProps {
  title: string;
  accent: string;
  icon: React.ReactNode;
  indices: number[];
  inputs: Record<number, string>;
  onChange: (idx: number, value: string) => void;
}

function ConfirmSection({
  title,
  accent,
  icon,
  indices,
  inputs,
  onChange,
}: ConfirmSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <p className={clsx('text-xs uppercase tracking-wider font-medium', accent)}>
          {title}
        </p>
      </div>
      {indices.map((idx) => (
        <div key={idx}>
          <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
            Word #{idx + 1}
          </label>
          <input
            type="text"
            value={inputs[idx] ?? ''}
            onChange={(e) => onChange(idx, e.target.value)}
            className="input-base font-mono"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
      ))}
    </div>
  );
}
