/**
 * Go-online UI — bring messaging onto the mixnet with the dedicated messaging
 * passphrase. Shared so ANY surface can offer it (the Memos tab, a multisig's
 * cosigner section); going online is account- and multisig-independent — it just
 * needs the passphrase. Coordination-specific actions stay in the multisig
 * screen, but joining the mixnet does not belong there.
 */
import { useState, useEffect } from 'react';
import { Loader2, AlertTriangle, KeyRound, ShieldCheck, Check, Circle } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { useCmixOnlineStore } from '@/store/cmixOnline';
import { useCmixSecretStore, MIN_PASSPHRASE_LEN } from '@/store/cmixSecret';
import { CONNECT_PHASE_ORDER, CONNECT_PHASE_LABEL, CONNECT_STORY } from '@/cmix/phases';

/**
 * Bring messaging online with the dedicated messaging passphrase. First time on a
 * device, the user CHOOSES a passphrase (typed twice) — it's separate from any
 * wallet password and protects the device's messaging identity. Later, the same
 * passphrase unlocks it. Account-independent: going online does not depend on
 * which accounts are in the wallet, or on having a multisig.
 */
export function GoOnlineSheet({
  open,
  onClose,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  onRestore: () => void;
}) {
  const goOnline = useCmixOnlineStore((s) => s.goOnline);
  const status = useCmixOnlineStore((s) => s.status);
  const isFirstTime = useCmixSecretStore((s) => s.wrap === null);

  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE_LEN;
  const mismatch = isFirstTime && confirm.length > 0 && passphrase !== confirm;
  const canSubmit =
    Boolean(passphrase) &&
    !busy &&
    (!isFirstTime || (passphrase.length >= MIN_PASSPHRASE_LEN && passphrase === confirm));

  const reset = () => {
    setPassphrase('');
    setConfirm('');
    setError(null);
  };

  const handleGoOnline = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await goOnline(passphrase);
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    reset();
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={isFirstTime ? 'Set up messaging' : 'Go online'}>
      <div className="space-y-4">
        {status === 'connecting' ? (
          <ConnectProgress />
        ) : (
          <>
            {isFirstTime ? (
              <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-xx-500/5 border border-xx-500/20">
                <KeyRound size={16} className="text-xx-500 flex-shrink-0 mt-0.5" strokeWidth={2} />
                <p className="text-xs text-ink-200 leading-relaxed">
                  Choose a <span className="text-ink-100 font-medium">messaging passphrase</span>.
                  This is <span className="text-ink-100 font-medium">not</span> your wallet password
                  — it protects your messaging identity and lets you move it to another device. Keep
                  it safe: if you forget it, you'll set messaging up again as a new identity.
                </p>
              </div>
            ) : (
              <p className="text-xs text-ink-300 leading-relaxed">
                Enter your messaging passphrase to connect to the mixnet. The first connection of a
                session can take a minute.
              </p>
            )}

            <div>
              <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                {isFirstTime ? 'New messaging passphrase' : 'Messaging passphrase'}
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  setError(null);
                }}
                className="input-base"
                placeholder={isFirstTime ? `At least ${MIN_PASSPHRASE_LEN} characters` : 'Messaging passphrase'}
                autoComplete={isFirstTime ? 'new-password' : 'current-password'}
                disabled={busy}
              />
            </div>

            {isFirstTime && (
              <div>
                <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                  Confirm passphrase
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    setError(null);
                  }}
                  className="input-base"
                  placeholder="Re-enter passphrase"
                  autoComplete="new-password"
                  disabled={busy}
                />
              </div>
            )}

            {tooShort && (
              <p className="text-xs text-ink-300">
                Use at least {MIN_PASSPHRASE_LEN} characters.
              </p>
            )}
            {mismatch && <p className="text-xs text-danger">Passphrases don't match.</p>}
            {error && (
              <p className="text-xs text-danger flex items-center gap-1">
                <AlertTriangle size={12} className="flex-shrink-0" />
                {error}
              </p>
            )}

            <button onClick={handleGoOnline} disabled={!canSubmit} className="btn-primary w-full">
              {busy && <Loader2 size={16} className="animate-spin" />}
              {isFirstTime ? 'Set passphrase & go online' : 'Go online'}
            </button>

            {isFirstTime && (
              <button
                onClick={() => {
                  reset();
                  onRestore();
                }}
                className="w-full text-center text-xs text-ink-300 active:text-ink-100"
              >
                Already set up on another device?{' '}
                <span className="text-xx-500">Restore a backup</span>
              </button>
            )}

            <p className="text-xs text-ink-300 leading-snug px-1">
              Being online means your device is present on the mixnet. Closing the
              app takes you offline.
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}

/**
 * Go-online progress: a rotating "worth the wait" story (cMix value props) over
 * a real phase checklist + elapsed timer, so the multi-minute first connect
 * reads as progress rather than a stall. Phases come from the go-online store.
 */
function ConnectProgress() {
  const phase = useCmixOnlineStore((s) => s.phase);
  const [elapsed, setElapsed] = useState(0);
  const [storyIdx, setStoryIdx] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setElapsed((e) => e + 1), 1000);
    const story = setInterval(() => setStoryIdx((i) => (i + 1) % CONNECT_STORY.length), 6000);
    return () => {
      clearInterval(tick);
      clearInterval(story);
    };
  }, []);

  const currentIdx = phase ? CONNECT_PHASE_ORDER.indexOf(phase) : 0;
  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center text-center gap-3 pt-1">
        <div className="w-12 h-12 rounded-2xl bg-xx-500/10 border border-xx-500/30 flex items-center justify-center flex-shrink-0">
          <ShieldCheck size={24} className="text-xx-500" strokeWidth={1.75} />
        </div>
        <p className="text-sm text-ink-100 leading-relaxed min-h-[2.75rem]">{CONNECT_STORY[storyIdx]}</p>
      </div>

      <ul className="space-y-2.5">
        {CONNECT_PHASE_ORDER.map((p, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <li key={p} className="flex items-center gap-2.5 text-sm">
              {done ? (
                <Check size={16} className="text-xx-500 flex-shrink-0" strokeWidth={2.5} />
              ) : active ? (
                <Loader2 size={16} className="text-xx-500 animate-spin flex-shrink-0" strokeWidth={2} />
              ) : (
                <Circle size={14} className="text-ink-600 flex-shrink-0" strokeWidth={2} />
              )}
              <span className={active ? 'text-ink-100' : 'text-ink-300'}>{CONNECT_PHASE_LABEL[p]}</span>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between text-xs text-ink-300">
        <span className="numeric">
          Elapsed {mm}:{ss}
        </span>
        <span>{phase === 'connecting' ? 'first connect is slow — normal' : 'working…'}</span>
      </div>
      <p className="text-xs text-ink-300 leading-relaxed">
        Keep this open. The first connection registers your device with the mixnet
        and can take a few minutes; after that it's quick. You can close this and
        it'll keep going in the background.
      </p>
    </div>
  );
}
