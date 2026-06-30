/**
 * General messaging-contact flows for the Memos tab — share your own contact and
 * add anyone else's, NOT scoped to a multisig (slice 3).
 *
 * Same signed-binding mechanism as the cosigner flow: a contact is your account
 * key signing your device's cMix contact, so a peer verifies it against your
 * on-chain address — a faked contact can't be added. The only difference here is
 * there's no multisig signer-set to authorize against: you can exchange contacts
 * with any wallet, and any verified contact lands in the registry, so it appears
 * in the Memos list to message.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clipboard,
  Download,
  Loader2,
  QrCode,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import QRCode from 'qrcode';
import { Sheet, AddressIcon, AddressLabel, QrScanner } from '@/components/ui';
import { useAccountsStore } from '@/store';
import { isLocalAccount, xxKeyring } from '@/keyring/store';
import {
  signContactBinding,
  serializeSignedBinding,
  parseSignedBinding,
} from '@/cmix/contactBinding';
import { useCmixContactsStore } from '@/store/cmixContacts';
import { useCmixOnlineStore } from '@/store/cmixOnline';
import { useCmixSecretStore } from '@/store/cmixSecret';
import { copyToClipboard } from '@/utils';

/** Share your own messaging contact: sign your cMix contact with one of your
 *  accounts (so the recipient can verify it) and hand out the blob. */
export function ShareMyContactSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { accounts, activeAddress } = useAccountsStore();
  const handle = useCmixOnlineStore((s) => s.handle);

  // Any local (password) account can sign + share its contact.
  const eligible = useMemo(() => accounts.filter((a) => isLocalAccount(a)), [accounts]);

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
      // Share THIS account's own identity (per-account) — so the binding says
      // "account X owns identity X", and X is now a messaging identity that the
      // receive hook listens on.
      const am = await handle.forAccount(account);
      const myContact = am.myContact();
      useCmixSecretStore.getState().addIdentityAccount(account);
      const pair = await xxKeyring.unlock(account, password);
      try {
        setBlob(serializeSignedBinding(signContactBinding(pair, myContact)));
        setPassword('');
      } finally {
        pair.lock();
        xxKeyring.removeFromKeyring(account);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

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
          <ContactBlob blob={blob} />
        ) : eligible.length === 0 ? (
          <p className="text-xs text-ink-300 leading-relaxed">
            You need a password account in this wallet to sign your contact.
          </p>
        ) : (
          <>
            <p className="text-xs text-ink-300 leading-relaxed">
              Sign your messaging contact with one of your accounts. Whoever adds it
              verifies the signature against that account's address — so a contact
              can't be faked.
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

/** Add anyone's messaging contact — paste/scan a signed binding, verify, store. */
export function AddContactSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addBinding = useCmixContactsStore((s) => s.addBinding);
  const { accounts } = useAccountsStore();
  const mySet = useMemo(() => new Set(accounts.map((a) => a.address)), [accounts]);

  const [text, setText] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const tryAdd = (input: string) => {
    setError(null);
    const binding = parseSignedBinding(input.trim());
    if (!binding) {
      setError("That doesn't look like a contact — paste the whole thing they shared.");
      return;
    }
    if (mySet.has(binding.account)) {
      setError("That's one of your own accounts.");
      return;
    }
    // addBinding re-verifies the signature against the claimed account; a faked or
    // tampered contact is rejected. No multisig signer-set check here — this is
    // general messaging, so any verified contact is accepted.
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
      <Sheet open={open} onClose={close} title="Add a contact">
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
                Paste or scan a contact someone shared with you. The wallet checks its
                signature against their account address — a faked or tampered contact
                is rejected. Once added, they appear in your Memos list.
              </p>

              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
                className="input-base text-xs font-mono h-24 resize-none"
                placeholder="Paste the contact here…"
                spellCheck={false}
              />

              {error && (
                <p className="text-xs text-danger flex items-start gap-1">
                  <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                  {error}
                </p>
              )}

              <button onClick={() => tryAdd(text)} disabled={!text.trim()} className="btn-primary w-full">
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

/** Copy / QR / download the signed contact blob. */
function ContactBlob({ blob }: { blob: string }) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);

  useEffect(() => {
    if (!qrOpen) return;
    let cancelled = false;
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
    if (await copyToClipboard(blob)) {
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
          Send this to someone over any channel you already trust — just once. They
          add it, and from then on you message privately over the mixnet.
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
