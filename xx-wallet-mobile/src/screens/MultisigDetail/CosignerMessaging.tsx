/**
 * Cosigner messaging — the MultisigDetail section for private, mixnet-based
 * coordination between this multisig's cosigners (cMix e2e under the hood).
 *
 * C4a: bring messaging online (explicit opt-in, default off) and show which
 * cosigners have a verified messaging contact registered. Sharing your own
 * contact and adding a cosigner's contact come next (C4b / C4c), so until then
 * everyone other than you reads "Not connected".
 *
 * Going online is gated on having one of this multisig's signer accounts in
 * this wallet with a password — a Ledger signer has no password to unlock the
 * device's encrypted messaging secret.
 */
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Radio, Loader2, Check, Circle, AlertTriangle, Wifi, ShieldCheck } from 'lucide-react';
import { Sheet, AddressIcon, AddressLabel } from '@/components/ui';
import { useAccountsStore } from '@/store';
import { isLocalAccount } from '@/keyring/store';
import { useCmixOnlineStore, type OnlineStatus } from '@/store/cmixOnline';
import { useCmixContactsStore } from '@/store/cmixContacts';
import { CONNECT_PHASE_ORDER, CONNECT_PHASE_LABEL, CONNECT_STORY } from '@/cmix/phases';
import type { Multisig } from '@/store/multisigs';

export function CosignerMessaging({ multisig }: { multisig: Multisig }) {
  const status = useCmixOnlineStore((s) => s.status);
  const bindings = useCmixContactsStore((s) => s.bindings);
  const { accounts } = useAccountsStore();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Accounts with at least one registered contact are "connected".
  const connected = useMemo(() => new Set(Object.keys(bindings)), [bindings]);
  // The user's own signer addresses are "You" — never shown as a contact.
  const mine = useMemo(() => new Set(accounts.map((a) => a.address)), [accounts]);

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-ink-300 font-medium">
          Cosigner messaging
        </p>
        <StatusPill status={status} />
      </div>

      <p className="text-xs text-ink-300 leading-relaxed">
        Coordinate this multisig privately over the xx mixnet — propose, request,
        and approve without a group chat. Off by default.
      </p>

      {status === 'online' ? (
        <div className="flex items-center gap-2 text-xs text-ink-300">
          <Wifi size={14} className="text-xx-500 flex-shrink-0" strokeWidth={2} />
          Online — pending memos arrive while you're connected.
        </div>
      ) : status === 'connecting' ? (
        <div className="flex items-center gap-2 text-xs text-ink-300">
          <Loader2 size={14} className="animate-spin flex-shrink-0" strokeWidth={2} />
          Connecting to the mixnet — this can take a minute the first time.
        </div>
      ) : (
        <button onClick={() => setSheetOpen(true)} className="btn-secondary w-full">
          <Radio size={16} strokeWidth={2} />
          Go online for coordination
        </button>
      )}

      <div className="space-y-2 pt-1">
        {multisig.signers.map((signer) => (
          <CosignerStatusRow
            key={signer.address}
            address={signer.address}
            label={signer.label}
            isSelf={mine.has(signer.address)}
            connected={connected.has(signer.address)}
          />
        ))}
      </div>

      <GoOnlineSheet open={sheetOpen} onClose={() => setSheetOpen(false)} multisig={multisig} />
    </div>
  );
}

function StatusPill({ status }: { status: OnlineStatus }) {
  const config = {
    offline: { label: 'Off', dot: 'bg-ink-500', text: 'text-ink-300' },
    connecting: { label: 'Connecting', dot: 'bg-warning animate-pulse', text: 'text-ink-300' },
    online: { label: 'Online', dot: 'bg-xx-500', text: 'text-xx-500' },
    error: { label: 'Error', dot: 'bg-danger', text: 'text-danger' },
  }[status];
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs', config.text)}>
      <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', config.dot)} />
      {config.label}
    </span>
  );
}

function CosignerStatusRow({
  address,
  label,
  isSelf,
  connected,
}: {
  address: string;
  label?: string;
  isSelf: boolean;
  connected: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <AddressIcon address={address} size={24} />
      <div className="flex-1 min-w-0">
        {label ? (
          <p className="text-sm text-ink-100 truncate">{label}</p>
        ) : (
          <AddressLabel address={address} className="text-sm" />
        )}
      </div>
      {isSelf ? (
        <span className="text-xs text-ink-300 flex-shrink-0">You</span>
      ) : connected ? (
        <span className="inline-flex items-center gap-1 text-xs text-xx-500 flex-shrink-0">
          <Check size={12} strokeWidth={2.5} /> Connected
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-ink-300 flex-shrink-0">
          <Circle size={9} strokeWidth={2} /> Not connected
        </span>
      )}
    </div>
  );
}

/**
 * Unlock a signer account to bring messaging online. The password is used to
 * establish (first time) or unwrap the device's encrypted cMix secret, then
 * connect the session — see the go-online store. Mirrors the propose-confirm
 * sheet's account + password shape.
 */
function GoOnlineSheet({
  open,
  onClose,
  multisig,
}: {
  open: boolean;
  onClose: () => void;
  multisig: Multisig;
}) {
  const { accounts, activeAddress } = useAccountsStore();
  const goOnline = useCmixOnlineStore((s) => s.goOnline);
  const status = useCmixOnlineStore((s) => s.status);

  const eligible = useMemo(
    () =>
      accounts.filter(
        (a) => isLocalAccount(a) && multisig.signers.some((s) => s.address === a.address)
      ),
    [accounts, multisig.signers]
  );

  const [account, setAccount] = useState(() => {
    if (activeAddress && eligible.some((a) => a.address === activeAddress)) return activeAddress;
    return eligible[0]?.address ?? '';
  });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = Boolean(account) && Boolean(password) && !busy;

  const handleGoOnline = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await goOnline(account, password);
      setPassword('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Go online for coordination">
      <div className="space-y-4">
        {status === 'connecting' ? (
          <ConnectProgress />
        ) : eligible.length === 0 ? (
          <p className="text-xs text-ink-300 leading-relaxed">
            You need one of this multisig's signer accounts in this wallet, with a
            password (not a Ledger account), to bring messaging online.
          </p>
        ) : (
          <>
            <p className="text-xs text-ink-300 leading-relaxed">
              Unlock a signer account to connect to the mixnet. This encrypts your
              messaging identity on this device under that account's password. The
              first connection can take a minute.
            </p>

            <div>
              <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                Account
              </label>
              {eligible.length === 1 ? (
                <div className="flex items-center gap-2">
                  <AddressIcon address={eligible[0].address} size={28} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-100 truncate">{eligible[0].name}</p>
                    <p className="font-mono text-xs text-ink-300 truncate">{eligible[0].address}</p>
                  </div>
                </div>
              ) : (
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  className="input-base text-sm"
                >
                  {eligible.map((a) => (
                    <option key={a.address} value={a.address}>
                      {a.name} — {a.address.slice(0, 8)}…{a.address.slice(-6)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                className="input-base"
                placeholder="Account password"
                autoComplete="current-password"
                disabled={busy}
              />
            </div>

            {error && (
              <p className="text-xs text-danger flex items-center gap-1">
                <AlertTriangle size={12} className="flex-shrink-0" />
                {error}
              </p>
            )}

            <button onClick={handleGoOnline} disabled={!canSubmit} className="btn-primary w-full">
              {busy && <Loader2 size={16} className="animate-spin" />}
              Go online
            </button>
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
    const story = setInterval(
      () => setStoryIdx((i) => (i + 1) % CONNECT_STORY.length),
      6000
    );
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
        <p className="text-sm text-ink-100 leading-relaxed min-h-[2.75rem]">
          {CONNECT_STORY[storyIdx]}
        </p>
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
                <Loader2
                  size={16}
                  className="text-xx-500 animate-spin flex-shrink-0"
                  strokeWidth={2}
                />
              ) : (
                <Circle size={14} className="text-ink-600 flex-shrink-0" strokeWidth={2} />
              )}
              <span className={active ? 'text-ink-100' : 'text-ink-300'}>
                {CONNECT_PHASE_LABEL[p]}
              </span>
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
