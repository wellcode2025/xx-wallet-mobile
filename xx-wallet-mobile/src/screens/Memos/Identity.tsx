/**
 * Messaging-identity backup — export the device's cMix identity as an encrypted,
 * portable file/string so it can be restored onto another device (same contact,
 * no re-introductions). Locked with the messaging passphrase; the raw identity is
 * never shown. Import/restore lives alongside this in a later slice.
 */
import { useState, useRef, useMemo } from 'react';
import {
  Loader2,
  AlertTriangle,
  KeyRound,
  Clipboard,
  Check,
  Download,
  Upload,
  ShieldCheck,
} from 'lucide-react';
import { Sheet } from '@/components/ui';
import { useCmixOnlineStore } from '@/store/cmixOnline';
import { useCmixSecretStore } from '@/store/cmixSecret';
import {
  encryptIdentitiesExport,
  decryptIdentitiesExport,
  readBackupCount,
  EXPORT_FILE_NAME,
  EXPORT_MIME,
} from '@/cmix/identityExport';
import { copyToClipboard } from '@/utils';

export function ExportIdentitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const handle = useCmixOnlineStore((s) => s.handle);
  const unlock = useCmixSecretStore((s) => s.unlock);
  const identityAccounts = useCmixSecretStore((s) => s.identityAccounts);

  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blob, setBlob] = useState<string | null>(null);

  const handleExport = async () => {
    if (!handle || !passphrase || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Confirm this is the device's messaging passphrase (unlock throws on a
      // wrong one) so the backup is encrypted under a passphrase the user knows
      // and will re-enter on the other device. We only need it to verify here.
      const secret = await unlock(passphrase);
      secret.fill(0);
      // Bundle EVERY account's identity (fall back to whatever's logged in).
      const accounts = identityAccounts.length > 0 ? identityAccounts : handle.loadedAccounts();
      const entries: { account: string; identity: Uint8Array }[] = [];
      for (const account of accounts) {
        const am = await handle.forAccount(account);
        entries.push({ account, identity: am.exportIdentity() });
      }
      const env = await encryptIdentitiesExport(entries, passphrase);
      setBlob(env);
      setPassphrase('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setBlob(null);
    setError(null);
    setPassphrase('');
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title="Back up messaging identity">
      <div className="space-y-4">
        {!handle ? (
          <p className="text-xs text-ink-300 leading-relaxed">
            Go online first — your messaging identity comes from the live connection.
          </p>
        ) : blob ? (
          <ExportBlob blob={blob} />
        ) : (
          <>
            <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-xx-500/5 border border-xx-500/20">
              <ShieldCheck size={16} className="text-xx-500 flex-shrink-0 mt-0.5" strokeWidth={2} />
              <p className="text-xs text-ink-200 leading-relaxed">
                Save an encrypted copy of your messaging identity, then import it on another device
                to stay reachable as the same contact. It's locked with your messaging passphrase —
                keep both somewhere safe.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                Messaging passphrase
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  setError(null);
                }}
                className="input-base"
                placeholder="Confirm your messaging passphrase"
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
              onClick={handleExport}
              disabled={!passphrase || busy}
              className="btn-primary w-full"
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <KeyRound size={16} strokeWidth={2} />
              )}
              Create encrypted backup
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** The shareable view once the encrypted backup exists: download a file or copy text. */
function ExportBlob({ blob }: { blob: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(blob);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleDownload = () => {
    const file = new Blob([blob], { type: EXPORT_MIME });
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = EXPORT_FILE_NAME;
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
          Encrypted backup ready. Move it to your other device — file, AirDrop, cloud — and import it
          there with the same passphrase. Without the passphrase it can't be read.
        </p>
      </div>

      <button onClick={handleDownload} className="btn-primary w-full">
        <Download size={16} strokeWidth={2} />
        Download backup file
      </button>
      <button onClick={handleCopy} className="btn-secondary w-full">
        {copied ? <Check size={16} strokeWidth={2.5} /> : <Clipboard size={16} strokeWidth={2} />}
        {copied ? 'Copied' : 'Copy as text'}
      </button>
    </div>
  );
}

/**
 * Restore a backed-up messaging identity onto this device: paste or open the
 * encrypted backup, enter the messaging passphrase it was made with, then go
 * online as the SAME messaging party. Use one device at a time — restoring makes
 * this device that identity (two live devices on one identity desync channels).
 */
export function ImportIdentitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const goOnlineWithImport = useCmixOnlineStore((s) => s.goOnlineWithImport);
  const status = useCmixOnlineStore((s) => s.status);

  const [text, setText] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const backupCount = useMemo(() => readBackupCount(text), [text]);
  const connecting = status === 'connecting';

  const handleFile = async (file: File) => {
    try {
      const content = await file.text();
      setText(content);
      setError(null);
    } catch {
      setError("Couldn't read that file.");
    }
  };

  const handleImport = async () => {
    if (!text.trim() || !passphrase || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Decrypt first (fails fast + clearly on a wrong passphrase / bad backup),
      // then restore all identities + connect.
      const entries = await decryptIdentitiesExport(text, passphrase);
      await goOnlineWithImport(passphrase, entries);
      setText('');
      setPassphrase('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setText('');
    setPassphrase('');
    setError(null);
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title="Restore messaging identity">
      <div className="space-y-4">
        {connecting ? (
          <div className="flex items-start gap-2.5 py-2">
            <Loader2 size={16} className="text-xx-500 animate-spin flex-shrink-0 mt-0.5" strokeWidth={2} />
            <p className="text-xs text-ink-200 leading-relaxed">
              Restoring your identity and connecting to the mixnet — the first connection can take a
              minute. You can close this; it keeps going.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-xx-500/5 border border-xx-500/20">
              <ShieldCheck size={16} className="text-xx-500 flex-shrink-0 mt-0.5" strokeWidth={2} />
              <p className="text-xs text-ink-200 leading-relaxed">
                Paste or open an encrypted backup from your other device and enter the messaging
                passphrase you used there. This device becomes the same messaging contact.
              </p>
            </div>

            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              className="input-base text-xs font-mono h-24 resize-none"
              placeholder="Paste your backup here…"
              spellCheck={false}
              disabled={busy}
            />

            <input
              type="file"
              ref={fileRef}
              accept=".xxid,application/json,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = '';
              }}
            />
            <button onClick={() => fileRef.current?.click()} className="btn-secondary w-full" disabled={busy}>
              <Upload size={16} strokeWidth={2} />
              Open backup file
            </button>

            {backupCount !== null && (
              <p className="text-xs text-ink-300">
                This backup holds{' '}
                <span className="text-ink-200 font-medium">{backupCount}</span>{' '}
                {backupCount === 1 ? 'identity' : 'identities'}.
              </p>
            )}

            <div>
              <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                Messaging passphrase
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  setError(null);
                }}
                className="input-base"
                placeholder="The passphrase from your other device"
                autoComplete="current-password"
                disabled={busy}
              />
            </div>

            {error && (
              <p className="text-xs text-danger flex items-start gap-1">
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                {error}
              </p>
            )}

            <button
              onClick={handleImport}
              disabled={!text.trim() || !passphrase || busy}
              className="btn-primary w-full"
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <KeyRound size={16} strokeWidth={2} />
              )}
              Restore &amp; go online
            </button>
            <p className="text-xs text-ink-300 leading-snug px-1">
              Restoring makes this device that identity. Use one device at a time — if both are live
              on the same identity, your channels can fall out of sync.
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}
