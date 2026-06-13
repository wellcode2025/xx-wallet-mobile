/**
 * AccountDetail — the single home for managing one account.
 *
 * Consolidates everything that used to be split between the Settings account
 * rows (rename / export / remove) and the dashboard switcher (switch / view):
 * full address + QR + copy, set-active, rename, export keystore, remove. Both
 * the dashboard switcher rows and the Settings account list link here, so
 * there's one canonical place to act on an account.
 *
 * Pure UI reorganization — every action reuses existing store/keyring methods
 * (setActive / rename / remove / exportJson). No new capability, nothing
 * touches the keystore-decrypt path.
 */

import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  Copy,
  Check,
  Pencil,
  Download,
  Trash2,
  AlertTriangle,
  QrCode as QrIcon,
  CheckCircle2,
} from 'lucide-react';
import { useAccountsStore } from '@/store';
import { TopBar } from '@/components/layout';
import { AddressIcon, Sheet } from '@/components/ui';
import { isLedgerAccount, xxKeyring } from '@/keyring';
import { copyToClipboard } from '@/utils/clipboard';

export function AccountDetail() {
  const { address } = useParams<{ address: string }>();
  const account = useAccountsStore((s) =>
    address ? s.accounts.find((a) => a.address === address) : undefined
  );
  if (!address || !account) {
    return <Navigate to="/" replace />;
  }
  return <AccountDetailView address={address} />;
}

function AccountDetailView({ address }: { address: string }) {
  const navigate = useNavigate();
  const { accounts, activeAddress, setActive, rename, remove } =
    useAccountsStore();
  const account = accounts.find((a) => a.address === address)!;
  const isActive = activeAddress === address;
  // Ledger accounts have no keystore: no export affordance, and the
  // remove/rename copy must not promise keystore-based restoration.
  const isLedger = isLedgerAccount(account);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState(account.name);
  const [removeOpen, setRemoveOpen] = useState(false);

  // Render the QR only once the user expands it.
  useEffect(() => {
    if (!qrOpen || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, address, {
      width: 220,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }).catch(() => {});
  }, [qrOpen, address]);

  const handleCopy = async () => {
    if (await copyToClipboard(address)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleExport = () => {
    try {
      const json = xxKeyring.exportJson(address);
      const blob = new Blob([JSON.stringify(json, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `xx-wallet-${address.slice(0, 8)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    }
  };

  const renameTrimmed = renameDraft.trim();
  const renameValid =
    renameTrimmed.length > 0 &&
    renameTrimmed.length <= 50 &&
    renameTrimmed !== account.name;

  const handleRename = () => {
    if (!renameValid) return;
    rename(address, renameTrimmed);
    setRenameOpen(false);
  };

  const handleRemove = () => {
    remove(address);
    const remaining = useAccountsStore.getState().accounts;
    navigate(remaining.length === 0 ? '/onboarding' : '/', { replace: true });
  };

  return (
    <>
      <TopBar title="Account" showBack />
      <div className="px-5 py-6 max-w-md mx-auto space-y-5 pb-24">
        {/* Header */}
        <div className="flex items-center gap-3">
          <AddressIcon address={address} size={48} copyOnTap={false} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-display font-medium text-lg text-ink-100 truncate">
                {account.name}
              </p>
              {isActive && (
                <span className="text-xs uppercase tracking-wider text-xx-500 font-semibold flex-shrink-0">
                  Active
                </span>
              )}
            </div>
            <p className="text-xs text-ink-300">
              {isLedger
                ? 'Ledger account · key stays on the device'
                : 'xx network account'}
            </p>
          </div>
        </div>

        {/* Full address + copy + QR */}
        <div className="card space-y-3">
          <p className="text-xs uppercase tracking-wider text-ink-300 font-medium">
            Full address
          </p>
          <p className="font-mono text-xs text-ink-100 break-all leading-relaxed select-all">
            {address}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={handleCopy} className="btn-secondary">
              {copied ? (
                <>
                  <Check size={16} className="text-xx-500" />
                  Copied
                </>
              ) : (
                <>
                  <Copy size={16} />
                  Copy
                </>
              )}
            </button>
            <button
              onClick={() => setQrOpen((o) => !o)}
              className="btn-secondary"
            >
              <QrIcon size={16} />
              {qrOpen ? 'Hide QR' : 'Show QR'}
            </button>
          </div>
          {qrOpen && (
            <div className="flex justify-center pt-1">
              <div className="p-3 rounded-2xl bg-white">
                <canvas ref={canvasRef} className="block" />
              </div>
            </div>
          )}
        </div>

        {/* Set active */}
        {!isActive && (
          <button
            onClick={() => setActive(address)}
            className="btn-primary w-full"
          >
            <CheckCircle2 size={16} strokeWidth={2} />
            Set as active account
          </button>
        )}

        {/* Manage actions */}
        <div className="space-y-2">
          <button
            onClick={() => {
              setRenameDraft(account.name);
              setRenameOpen(true);
            }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-ink-900 border border-ink-800 active:bg-ink-800/40 text-left"
          >
            <Pencil size={18} className="text-ink-400" />
            <span className="text-sm text-ink-100">Rename</span>
          </button>
          {/* No keystore to export for Ledger accounts — the key never
              enters the browser, so there is genuinely nothing to back
              up from this wallet's side. */}
          {!isLedger && (
            <button
              onClick={handleExport}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-ink-900 border border-ink-800 active:bg-ink-800/40 text-left"
            >
              <Download size={18} className="text-ink-400" />
              <span className="text-sm text-ink-100">Export keystore (.json)</span>
            </button>
          )}
          <button
            onClick={() => setRemoveOpen(true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-ink-900 border border-danger/30 active:bg-danger/10 text-left"
          >
            <Trash2 size={18} className="text-danger/80" />
            <span className="text-sm text-danger">Remove account</span>
          </button>
        </div>

        <p className="text-xs text-ink-300 leading-relaxed px-1">
          {isLedger
            ? 'Removing this account only deletes its record from this device. ' +
              'The key stays on your Ledger — reconnect the device any time to add it back.'
            : 'Removing an account only deletes it from this device. You can restore ' +
              'it later from its recovery phrase or an exported keystore file.'}
        </p>
      </div>

      {/* Rename sheet */}
      <Sheet
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename account"
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-ink-300 font-medium mb-2 block">
              New name
            </label>
            <input
              type="text"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameValid) handleRename();
              }}
              maxLength={50}
              autoFocus
              autoCapitalize="words"
              autoCorrect="off"
              spellCheck={false}
              className="input-base"
              placeholder="e.g. Savings"
            />
            <p className="text-xs text-ink-300 mt-2">
              {isLedger
                ? 'Local label, only visible on this device.'
                : "Updates the display name and the keystore JSON's metadata, so an " +
                  'export of this account carries the new name to other devices.'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setRenameOpen(false)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleRename}
              disabled={!renameValid}
              className="btn-primary"
            >
              Save
            </button>
          </div>
        </div>
      </Sheet>

      {/* Remove confirmation */}
      <Sheet
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        title="Remove account"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-danger/10 border border-danger/30">
            <AlertTriangle
              size={20}
              className="text-danger flex-shrink-0 mt-0.5"
            />
            <div className="text-sm text-ink-200">
              {isLedger ? (
                <>
                  <p className="font-medium mb-1">Your key is safe on the Ledger.</p>
                  <p className="text-ink-300 text-xs leading-relaxed">
                    This only removes the account's record from this device.
                    Reconnect your Ledger any time to add it back.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium mb-1">This cannot be undone.</p>
                  <p className="text-ink-300 text-xs leading-relaxed">
                    Make sure you have your recovery phrase or keystore backup.
                    Without it, removed accounts cannot be restored.
                  </p>
                </>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setRemoveOpen(false)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleRemove}
              className="btn-primary bg-danger text-white active:bg-danger/80"
            >
              Remove
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
