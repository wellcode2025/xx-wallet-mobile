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
import {
  Radio,
  Loader2,
  Check,
  Circle,
  AlertTriangle,
  Wifi,
  ShieldCheck,
  Share2,
  Download,
  QrCode,
  Clipboard,
  UserPlus,
  ListOrdered,
  KeyRound,
} from 'lucide-react';
import QRCode from 'qrcode';
import { Sheet, AddressIcon, AddressLabel, QrScanner, Coachmark } from '@/components/ui';
import { useAccountsStore } from '@/store';
import { isLocalAccount, xxKeyring } from '@/keyring/store';
import { useCmixSecretStore } from '@/store/cmixSecret';
import {
  signContactBinding,
  serializeSignedBinding,
  parseSignedBinding,
} from '@/cmix/contactBinding';
import { useCmixOnlineStore, type OnlineStatus } from '@/store/cmixOnline';
import { useCmixContactsStore } from '@/store/cmixContacts';
import { copyToClipboard } from '@/utils';
import { GoOnlineSheet } from '@/screens/Memos/GoOnline';
import { ImportIdentitySheet } from '@/screens/Memos/Identity';
import type { Multisig } from '@/store/multisigs';

export function CosignerMessaging({ multisig }: { multisig: Multisig }) {
  const status = useCmixOnlineStore((s) => s.status);
  const bindings = useCmixContactsStore((s) => s.bindings);
  const { accounts } = useAccountsStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Accounts with at least one registered contact are "connected".
  const connected = useMemo(() => new Set(Object.keys(bindings)), [bindings]);
  // The user's own signer addresses are "You" — never shown as a contact.
  const mine = useMemo(() => new Set(accounts.map((a) => a.address)), [accounts]);

  // Setup progress: the other cosigners (not me) and whether each is connected
  // (their contact is registered on this device). "Ready" = online and every
  // cosigner connected, i.e. you can actually send proposals over cMix.
  const otherSigners = useMemo(
    () => multisig.signers.filter((s) => !mine.has(s.address)),
    [multisig.signers, mine]
  );
  const allConnected =
    otherSigners.length > 0 && otherSigners.every((s) => connected.has(s.address));
  const ready = status === 'online' && allConnected;

  // "Stay enabled on this device": a device-key-wrapped secret lets go-online
  // skip the password. Its presence IS the toggle state.
  const deviceWrap = useCmixSecretStore((s) => s.deviceWrap);
  const goOnlineWithDeviceKey = useCmixOnlineStore((s) => s.goOnlineWithDeviceKey);
  const enableStayOnline = useCmixOnlineStore((s) => s.enableStayOnline);
  const disableStayOnline = useCmixOnlineStore((s) => s.disableStayOnline);
  const stayEnabled = deviceWrap !== null;
  const [stayBusy, setStayBusy] = useState(false);
  const [stayError, setStayError] = useState<string | null>(null);

  // Offline tap: if stay-enabled is set up, reconnect with no password; on any
  // failure (e.g. the device key was cleared) fall back to the password sheet.
  const handleGoOnlineTap = async () => {
    if (stayEnabled) {
      try {
        await goOnlineWithDeviceKey();
        return;
      } catch {
        /* device key gone / unavailable — fall through to the password flow */
      }
    }
    setSheetOpen(true);
  };

  const handleToggleStay = async () => {
    setStayBusy(true);
    setStayError(null);
    try {
      if (stayEnabled) await disableStayOnline();
      else await enableStayOnline();
    } catch (e) {
      setStayError(e instanceof Error ? e.message : String(e));
    } finally {
      setStayBusy(false);
    }
  };

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

      <Coachmark
        hintId="cmix-coordination-intro"
        title="How coordination works"
        icon={<ListOrdered size={13} className="text-xx-500 flex-shrink-0" strokeWidth={2.25} />}
      >
        <ol className="list-decimal pl-4 space-y-1">
          <li>Go online to join the mixnet.</li>
          <li>Share your contact and add each cosigner's — both ways, so you can reach each other.</li>
          <li>Propose a spend, then tap "Send over cMix" on its Share screen.</li>
        </ol>
      </Coachmark>

      {status === 'online' ? (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 text-xs text-ink-300">
            <Wifi size={14} className="text-xx-500 flex-shrink-0" strokeWidth={2} />
            Online — pending memos arrive while you're connected.
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setShareOpen(true)} className="btn-secondary">
              <Share2 size={15} strokeWidth={2} />
              Share contact
            </button>
            <button onClick={() => setAddOpen(true)} className="btn-secondary">
              <UserPlus size={15} strokeWidth={2} />
              Add cosigner
            </button>
          </div>
          {ready ? (
            <div className="flex items-start gap-2 text-xs text-xx-500">
              <Check size={14} strokeWidth={2.5} className="flex-shrink-0 mt-0.5" />
              All cosigners connected — propose a spend and send it over cMix from
              the Share screen.
            </div>
          ) : (
            <p className="text-xs text-ink-300 leading-relaxed">
              Share your contact and add each cosigner below. Once you're connected
              both ways, you can send proposals over cMix.
            </p>
          )}
        </div>
      ) : status === 'connecting' ? (
        <div className="flex items-center gap-2 text-xs text-ink-300">
          <Loader2 size={14} className="animate-spin flex-shrink-0" strokeWidth={2} />
          Connecting to the mixnet — this can take a minute the first time.
        </div>
      ) : (
        <button onClick={handleGoOnlineTap} className="btn-secondary w-full">
          <Radio size={16} strokeWidth={2} />
          {stayEnabled ? 'Go online' : 'Go online for coordination'}
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

      {/* "Stay enabled on this device" — only meaningful while online (the secret
          is in hand): a device-key wrap lets a future session skip the passphrase. */}
      {status === 'online' && (
        <div className="space-y-2 pt-2 border-t border-ink-800/60">
          <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
            <span className="flex items-center gap-1.5 text-xs text-ink-200">
              <KeyRound size={13} className="text-ink-300 flex-shrink-0" strokeWidth={2} />
              Stay enabled on this device
            </span>
            <input
              type="checkbox"
              checked={stayEnabled}
              onChange={handleToggleStay}
              disabled={stayBusy}
              className="w-4 h-4 accent-xx-500 flex-shrink-0"
            />
          </label>
          <p className="text-xs text-ink-300 leading-snug">
            {stayEnabled
              ? "You can go online here without your messaging passphrase. Your app lock still gates access if it's on."
              : "Reconnect without re-entering your messaging passphrase next time. Best paired with the app lock for device security."}
          </p>
          {stayError && <p className="text-xs text-danger leading-snug">{stayError}</p>}
        </div>
      )}

      <GoOnlineSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onRestore={() => {
          setSheetOpen(false);
          setImportOpen(true);
        }}
      />
      <ShareContactSheet open={shareOpen} onClose={() => setShareOpen(false)} multisig={multisig} />
      <AddContactSheet open={addOpen} onClose={() => setAddOpen(false)} multisig={multisig} />
      <ImportIdentitySheet open={importOpen} onClose={() => setImportOpen(false)} />
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

// GoOnlineSheet + its ConnectProgress now live in the shared
// @/screens/Memos/GoOnline module, so the Memos tab can offer go-online too —
// joining the mixnet is account/multisig-independent and shouldn't live only here.

/**
 * Share my messaging contact — sign this device's cMix contact with a signer
 * account's key (binding the contact to that account; see contactBinding) and
 * hand the signed blob to cosigners out-of-band, once. They verify it against
 * the known signer address before adding it, so a contact can't be spoofed.
 * Requires being online — the contact comes from the live e2e session.
 */
function ShareContactSheet({
  open,
  onClose,
  multisig,
}: {
  open: boolean;
  onClose: () => void;
  multisig: Multisig;
}) {
  const { accounts, activeAddress } = useAccountsStore();
  const handle = useCmixOnlineStore((s) => s.handle);

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
  const [blob, setBlob] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!handle || !account || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Share THIS signer account's own identity (per-account), and register it so
      // its inbox is listened on. The coordination send + receive now ride the
      // same per-signer-account identity, so this is consistent end-to-end.
      const am = await handle.forAccount(account);
      const myContact = am.myContact();
      useCmixSecretStore.getState().addIdentityAccount(account);
      const pair = await xxKeyring.unlock(account, password);
      try {
        const binding = signContactBinding(pair, myContact);
        setBlob(serializeSignedBinding(binding));
        setPassword('');
      } finally {
        // The keyring contract: lock + evict the unlocked pair right after use.
        pair.lock();
        xxKeyring.removeFromKeyring(account);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Start fresh on close so a re-open re-prompts rather than showing a stale blob.
  const close = () => {
    setBlob(null);
    setError(null);
    setPassword('');
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title="Share your messaging contact">
      <div className="space-y-4">
        {!handle ? (
          <p className="text-xs text-ink-300 leading-relaxed">
            Go online first — your messaging contact comes from the live connection.
          </p>
        ) : blob ? (
          <ShareContactBlob blob={blob} />
        ) : eligible.length === 0 ? (
          <p className="text-xs text-ink-300 leading-relaxed">
            You need a signer account of this multisig in this wallet, with a
            password, to sign your contact.
          </p>
        ) : (
          <>
            <p className="text-xs text-ink-300 leading-relaxed">
              Sign your messaging contact with a signer account. Cosigners verify it
              against that account's address before adding it — so a contact can't be
              faked.
            </p>

            <div>
              <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                Sign as
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

            <button
              onClick={handleCreate}
              disabled={!account || !password || busy}
              className="btn-primary w-full"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              Create my contact
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** The shareable view once the signed contact blob exists: copy / QR / download. */
function ShareContactBlob({ blob }: { blob: string }) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);

  useEffect(() => {
    if (!qrOpen) return;
    let cancelled = false;
    // Low error-correction for max capacity — the contact blob is larger than a
    // typical QR payload; if it still overflows we fall back to copy/download.
    QRCode.toDataURL(blob, { errorCorrectionLevel: 'L', margin: 2, width: 320 })
      .then((url) => {
        if (!cancelled) {
          setQrUrl(url);
          setQrError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrUrl(null);
          setQrError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [qrOpen, blob]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(blob);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleDownload = () => {
    const file = new Blob([blob], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'xx-messaging-contact.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-xx-500/5 border border-xx-500/20">
        <ShieldCheck size={18} className="text-xx-500 flex-shrink-0 mt-0.5" strokeWidth={2} />
        <p className="text-xs text-ink-200 leading-relaxed">
          Send this to your cosigners over any channel you already trust — just
          once. They add it, and from then on you coordinate privately over the
          mixnet.
        </p>
      </div>

      <button onClick={handleCopy} className="btn-primary w-full">
        {copied ? <Check size={16} strokeWidth={2.5} /> : <Clipboard size={16} strokeWidth={2} />}
        {copied ? 'Copied' : 'Copy contact'}
      </button>

      <button onClick={() => setQrOpen((o) => !o)} className="btn-secondary w-full">
        <QrCode size={16} strokeWidth={2} />
        {qrOpen ? 'Hide QR code' : 'Show QR code'}
      </button>
      {qrOpen && (
        <div className="card flex flex-col items-center space-y-2 bg-white">
          {qrUrl ? (
            <img src={qrUrl} alt="Messaging contact QR code" className="w-full max-w-[280px] h-auto" />
          ) : qrError ? (
            <p className="text-xs text-ink-700 text-center px-2 py-6">
              Contact is too large for a QR — use Copy or Download.
            </p>
          ) : (
            <div className="w-[280px] h-[280px] flex items-center justify-center text-ink-300 text-xs">
              Generating…
            </div>
          )}
        </div>
      )}

      <button onClick={handleDownload} className="btn-secondary w-full">
        <Download size={16} strokeWidth={2} />
        Download as file
      </button>
    </div>
  );
}

/**
 * Add a cosigner's contact — paste or scan a signed binding they shared, verify
 * its signature against a KNOWN signer of THIS multisig (authorization, not just
 * a valid signature — see contactRegistry's note), then register it so it can
 * receive fan-out memos and the row flips to Connected. A faked, tampered, or
 * wrong-account contact is refused with a clear reason.
 */
function AddContactSheet({
  open,
  onClose,
  multisig,
}: {
  open: boolean;
  onClose: () => void;
  multisig: Multisig;
}) {
  const addBinding = useCmixContactsStore((s) => s.addBinding);
  const { accounts } = useAccountsStore();

  const signerSet = useMemo(
    () => new Set(multisig.signers.map((s) => s.address)),
    [multisig.signers]
  );
  const mySet = useMemo(() => new Set(accounts.map((a) => a.address)), [accounts]);

  const [text, setText] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const tryAdd = (input: string) => {
    setError(null);
    const binding = parseSignedBinding(input.trim());
    if (!binding) {
      setError("That doesn't look like a contact — paste the whole thing your cosigner shared.");
      return;
    }
    if (mySet.has(binding.account)) {
      setError("That's one of your own accounts.");
      return;
    }
    if (!signerSet.has(binding.account)) {
      setError("This contact isn't for a signer of this multisig, so it won't be added.");
      return;
    }
    // addBinding re-verifies the signature against the claimed account.
    if (!addBinding(binding)) {
      setError("The signature didn't verify — the contact may be corrupted or tampered with.");
      return;
    }
    setAdded(binding.account);
    setText('');
  };

  const close = () => {
    setText('');
    setError(null);
    setAdded(null);
    setScannerOpen(false);
    onClose();
  };

  return (
    <>
      <Sheet open={open} onClose={close} title="Add a cosigner's contact">
        <div className="space-y-4">
          {added ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-xx-500/5 border border-xx-500/20">
                <Check size={18} className="text-xx-500 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-100">Contact added + verified</p>
                  <AddressLabel address={added} className="text-xs" />
                </div>
              </div>
              <button onClick={() => setAdded(null)} className="btn-secondary w-full">
                Add another
              </button>
            </div>
          ) : (
            <>
              <p className="text-xs text-ink-300 leading-relaxed">
                Paste or scan a contact a cosigner shared. The wallet checks its
                signature against that cosigner's address — a faked or tampered
                contact is rejected.
              </p>

              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
                className="input-base text-xs font-mono h-24 resize-none"
                placeholder="Paste the cosigner's contact here…"
                spellCheck={false}
              />

              {error && (
                <p className="text-xs text-danger flex items-start gap-1">
                  <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                  {error}
                </p>
              )}

              <button
                onClick={() => tryAdd(text)}
                disabled={!text.trim()}
                className="btn-primary w-full"
              >
                <UserPlus size={16} strokeWidth={2} />
                Add contact
              </button>
              <button onClick={() => setScannerOpen(true)} className="btn-secondary w-full">
                <QrCode size={16} strokeWidth={2} />
                Scan QR instead
              </button>
            </>
          )}
        </div>
      </Sheet>
      {scannerOpen && (
        <QrScanner
          onScan={(result) => {
            setScannerOpen(false);
            tryAdd(result);
          }}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </>
  );
}
