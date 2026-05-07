import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Download,
  Trash2,
  Plus,
  Globe,
  Info,
  AlertTriangle,
  Smartphone,
  Monitor,
  ArrowRight,
  PlusCircle,
  FileJson,
  Pencil,
} from 'lucide-react';
import { useAccountsStore, useConnectionStore, useSettingsStore } from '@/store';
import { XX_ENDPOINTS } from '@/api';
import { TopBar } from '@/components/layout';
import { AddressIcon, Sheet } from '@/components/ui';
import { xxKeyring } from '@/keyring';
import clsx from 'clsx';

export function Settings() {
  const navigate = useNavigate();
  const { accounts, activeAddress, remove, rename } = useAccountsStore();
  const endpoint = useSettingsStore((s) => s.endpoint);
  const customEndpoint = useSettingsStore((s) => s.customEndpoint);
  const setEndpoint = useSettingsStore((s) => s.setEndpoint);
  const setCustomEndpoint = useSettingsStore((s) => s.setCustomEndpoint);
  const setConnectionEndpoint = useConnectionStore((s) => s.setEndpoint);
  const chainName = useConnectionStore((s) => s.chainName);
  const blockNumber = useConnectionStore((s) => s.blockNumber);

  const [endpointOpen, setEndpointOpen] = useState(false);
  const [toRemove, setToRemove] = useState<string | null>(null);
  const [toRename, setToRename] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [syncOpen, setSyncOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  const renameTarget = toRename ? accounts.find((a) => a.address === toRename) : null;
  const renameTrimmed = renameDraft.trim();
  const renameValid =
    renameTrimmed.length > 0 &&
    renameTrimmed.length <= 50 &&
    renameTrimmed !== renameTarget?.name;

  const isCustomActive = !XX_ENDPOINTS.some((e) => e.url === endpoint);

  // Pre-fill the custom URL input whenever the picker opens. Prefer the
  // currently-active URL (if it's already custom), else the last saved
  // custom URL, else empty.
  useEffect(() => {
    if (!endpointOpen) return;
    setCustomDraft(isCustomActive ? endpoint : customEndpoint);
    setCustomError(null);
  }, [endpointOpen, endpoint, customEndpoint, isCustomActive]);

  const handleSwitchEndpoint = async (url: string) => {
    setEndpoint(url);
    setEndpointOpen(false);
    await setConnectionEndpoint(url);
  };

  const handleConnectCustom = async () => {
    const url = customDraft.trim();
    const err = validateRpcUrl(url);
    if (err) {
      setCustomError(err);
      return;
    }
    setCustomEndpoint(url);
    await handleSwitchEndpoint(url);
  };

  const handleExport = (address: string) => {
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

  const handleRemove = () => {
    if (!toRemove) return;
    remove(toRemove);
    setToRemove(null);
    // If this was the last account, navigate back to onboarding
    const remaining = useAccountsStore.getState().accounts;
    if (remaining.length === 0) {
      navigate('/onboarding', { replace: true });
    }
  };

  const openRename = (address: string) => {
    const acct = accounts.find((a) => a.address === address);
    if (!acct) return;
    setRenameDraft(acct.name);
    setToRename(address);
  };

  const handleRename = () => {
    if (!toRename || !renameValid) return;
    rename(toRename, renameTrimmed);
    setToRename(null);
  };

  const currentEndpointName =
    XX_ENDPOINTS.find((e) => e.url === endpoint)?.name ?? 'Custom';

  return (
    <>
      <TopBar title="Settings" />

      <div className="px-5 py-4 space-y-6 max-w-md mx-auto">
        {/* Network section */}
        <Section title="Network">
          <Row
            icon={<Globe size={18} className="text-ink-400" />}
            label="RPC endpoint"
            value={currentEndpointName}
            onClick={() => setEndpointOpen(true)}
          />
          <Row
            icon={<Info size={18} className="text-ink-400" />}
            label="Chain"
            value={chainName ?? '—'}
            readonly
          />
          <Row
            icon={<Info size={18} className="text-ink-400" />}
            label="Latest block"
            value={blockNumber?.toLocaleString() ?? '—'}
            readonly
          />
        </Section>

        {/* Accounts section */}
        <Section
          title="Accounts"
          action={
            <button
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1 text-sm text-xx-500 active:text-xx-600"
            >
              <Plus size={16} />
              Add
            </button>
          }
        >
          {accounts.map((acct) => (
            <div
              key={acct.address}
              className={clsx(
                'flex items-center gap-3 p-3 rounded-2xl border',
                acct.address === activeAddress
                  ? 'bg-ink-800 border-xx-500/30'
                  : 'bg-ink-800 border-ink-700/50'
              )}
            >
              <AddressIcon address={acct.address} size={36} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{acct.name}</p>
                <p className="font-mono text-xs text-ink-400 truncate">
                  {acct.address.slice(0, 14)}…
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => openRename(acct.address)}
                  className="p-2 rounded-full active:bg-ink-700"
                  aria-label="Rename"
                >
                  <Pencil size={18} className="text-ink-400" />
                </button>
                <button
                  onClick={() => handleExport(acct.address)}
                  className="p-2 rounded-full active:bg-ink-700"
                  aria-label="Export"
                >
                  <Download size={18} className="text-ink-400" />
                </button>
                <button
                  onClick={() => setToRemove(acct.address)}
                  className="p-2 rounded-full active:bg-ink-700"
                  aria-label="Remove"
                >
                  <Trash2 size={18} className="text-danger/80" />
                </button>
              </div>
            </div>
          ))}
        </Section>

        {/* Sync section */}
        <Section title="Sync to another device">
          <button
            onClick={() => setSyncOpen(true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700"
          >
            <Smartphone size={18} className="text-ink-400" />
            <span className="flex-1 text-sm font-medium text-left">
              How to use on another device
            </span>
            <ChevronRight size={16} className="text-ink-500" />
          </button>
        </Section>

        {/* About */}
        <Section title="About">
          <div className="px-4 py-3 rounded-2xl bg-ink-800 border border-ink-700/50 space-y-3">
            <div>
              <p className="text-sm font-medium text-ink-200">xx Wallet Mobile</p>
              <p className="text-xs text-ink-400">Version 0.1.0 · Phase 1</p>
              <p className="text-xs text-ink-500 pt-1">
                Open source, non-custodial. Your keys stay on this device.
              </p>
            </div>
            <div className="pt-3 border-t border-ink-700/50 flex items-center gap-2">
              <img
                src="/brand/icon-color.svg"
                alt=""
                className="w-5 h-5"
                draggable={false}
              />
              <span className="text-xs text-ink-400">
                Built for{' '}
                <span className="text-ink-200 font-medium">xx network</span>
              </span>
            </div>
          </div>
        </Section>
      </div>

      {/* Add account sheet */}
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Add account">
        <div className="space-y-3">
          <p className="text-sm text-ink-400">
            How would you like to add the new account?
          </p>
          <button
            onClick={() => { setAddOpen(false); navigate('/onboarding/create'); }}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700 text-left"
          >
            <div className="w-10 h-10 rounded-full bg-xx-500/10 border border-xx-500/30 flex items-center justify-center flex-shrink-0">
              <PlusCircle size={20} className="text-xx-500" strokeWidth={1.75} />
            </div>
            <div>
              <p className="font-medium text-sm text-ink-100">Create new wallet</p>
              <p className="text-xs text-ink-400 mt-0.5">Generate a fresh 24-word recovery phrase</p>
            </div>
          </button>
          <button
            onClick={() => { setAddOpen(false); navigate('/onboarding/import'); }}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700 text-left"
          >
            <div className="w-10 h-10 rounded-full bg-ink-700/50 border border-ink-600/50 flex items-center justify-center flex-shrink-0">
              <FileJson size={20} className="text-ink-300" strokeWidth={1.75} />
            </div>
            <div>
              <p className="font-medium text-sm text-ink-100">Import existing wallet</p>
              <p className="text-xs text-ink-400 mt-0.5">Use a recovery phrase or keystore file</p>
            </div>
          </button>
        </div>
      </Sheet>

      {/* Sync instructions sheet */}
      <Sheet
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        title="Use on another device"
      >
        <div className="space-y-5">
          <p className="text-sm text-ink-300 leading-relaxed">
            Your wallet is stored in this browser only. To access the same
            account on another device or browser, follow these steps:
          </p>

          {/* Step 1 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-xx-500/20 border border-xx-500/40 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-xx-500">1</span>
              </div>
              <p className="text-sm font-medium text-ink-100">
                Export your keystore file
              </p>
            </div>
            <div className="ml-8 p-3 rounded-xl bg-ink-900 border border-ink-800 text-sm text-ink-300 leading-relaxed">
              In Settings, tap the <span className="text-ink-100 font-medium">↓ download icon</span> next
              to your account. This saves an encrypted <code className="font-mono text-xx-500 text-xs">.json</code> file
              to your device. Your password is required to use it.
            </div>
          </div>

          {/* Arrow */}
          <div className="flex justify-center">
            <ArrowRight size={18} className="text-ink-600 rotate-90" />
          </div>

          {/* Step 2 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-xx-500/20 border border-xx-500/40 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-xx-500">2</span>
              </div>
              <p className="text-sm font-medium text-ink-100">
                Transfer the file
              </p>
            </div>
            <div className="ml-8 p-3 rounded-xl bg-ink-900 border border-ink-800 text-sm text-ink-300 leading-relaxed">
              Send the <code className="font-mono text-xx-500 text-xs">.json</code> file to your other
              device via email, Google Drive, iCloud, AirDrop, or any file
              transfer method you prefer.
            </div>
          </div>

          {/* Arrow */}
          <div className="flex justify-center">
            <ArrowRight size={18} className="text-ink-600 rotate-90" />
          </div>

          {/* Step 3 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-xx-500/20 border border-xx-500/40 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-xx-500">3</span>
              </div>
              <p className="text-sm font-medium text-ink-100">
                Import on the other device
              </p>
            </div>
            <div className="ml-8 p-3 rounded-xl bg-ink-900 border border-ink-800 text-sm text-ink-300 leading-relaxed">
              Open xx Wallet on the other device, tap{' '}
              <span className="text-ink-100 font-medium">Import wallet</span> on
              the welcome screen (or Settings →{' '}
              <span className="text-ink-100 font-medium">Add account</span>),
              choose <span className="text-ink-100 font-medium">Keystore file</span>,
              select the <code className="font-mono text-xx-500 text-xs">.json</code> file,
              and enter your password.
            </div>
          </div>

          {/* Security note */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-warning/10 border border-warning/30 mt-2">
            <AlertTriangle size={16} className="text-warning flex-shrink-0 mt-0.5" />
            <p className="text-xs text-ink-300 leading-relaxed">
              The keystore file is encrypted with your password. Never share
              your password with anyone. Delete the file from shared services
              like email or Google Drive after importing it.
            </p>
          </div>

          {/* Devices */}
          <div className="flex items-center justify-center gap-4 py-2">
            <div className="flex flex-col items-center gap-1">
              <Smartphone size={24} className="text-xx-500" strokeWidth={1.5} />
              <span className="text-xs text-ink-400">Phone</span>
            </div>
            <ArrowRight size={16} className="text-ink-600" />
            <div className="flex flex-col items-center gap-1">
              <Monitor size={24} className="text-ink-400" strokeWidth={1.5} />
              <span className="text-xs text-ink-400">Desktop</span>
            </div>
          </div>

          <p className="text-xs text-ink-500 text-center">
            Works between phone ↔ desktop ↔ wallet.xx.network
          </p>
        </div>
      </Sheet>

      {/* Endpoint picker sheet */}
      <Sheet
        open={endpointOpen}
        onClose={() => setEndpointOpen(false)}
        title="RPC endpoint"
      >
        <ul className="space-y-2">
          {XX_ENDPOINTS.map((ep) => (
            <li key={ep.url}>
              <button
                onClick={() => handleSwitchEndpoint(ep.url)}
                className={clsx(
                  'w-full text-left p-4 rounded-2xl border transition-colors',
                  ep.url === endpoint
                    ? 'bg-xx-500/10 border-xx-500/40'
                    : 'bg-ink-800 border-ink-700/50 active:bg-ink-700'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{ep.name}</span>
                  {ep.url === endpoint && (
                    <span className="text-xs text-xx-500 font-medium">Active</span>
                  )}
                </div>
                <p className="font-mono text-xs text-ink-400 mt-1 break-all">
                  {ep.url}
                </p>
              </button>
            </li>
          ))}

          {/* Custom endpoint */}
          <li>
            <div
              className={clsx(
                'p-4 rounded-2xl border transition-colors',
                isCustomActive
                  ? 'bg-xx-500/10 border-xx-500/40'
                  : 'bg-ink-800 border-ink-700/50'
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">Custom</span>
                {isCustomActive && (
                  <span className="text-xs text-xx-500 font-medium">Active</span>
                )}
              </div>
              <input
                type="url"
                inputMode="url"
                value={customDraft}
                onChange={(e) => {
                  setCustomDraft(e.target.value);
                  if (customError) setCustomError(null);
                }}
                placeholder="wss://your-node.example.com"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="input-base font-mono text-xs"
              />
              {customError && (
                <p className="text-xs text-danger mt-2">{customError}</p>
              )}
              <button
                onClick={handleConnectCustom}
                disabled={!customDraft.trim()}
                className="btn-primary mt-3"
              >
                Connect
              </button>
              <p className="text-[10px] text-ink-500 mt-3 leading-relaxed">
                Point at a self-hosted xx node or alternate RPC provider. Use{' '}
                <code className="font-mono text-xx-500">wss://</code> for remote
                hosts; <code className="font-mono text-xx-500">ws://</code> only
                for local development (e.g.{' '}
                <code className="font-mono text-xx-500">ws://localhost:9944</code>).
              </p>
            </div>
          </li>
        </ul>
      </Sheet>

      {/* Rename account */}
      <Sheet
        open={toRename !== null}
        onClose={() => setToRename(null)}
        title="Rename account"
      >
        <div className="space-y-4">
          {renameTarget && (
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-ink-900 border border-ink-800">
              <AddressIcon address={renameTarget.address} size={36} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-ink-500 font-medium">
                  Current name
                </p>
                <p className="text-sm font-medium text-ink-100 truncate">
                  {renameTarget.name}
                </p>
                <p className="font-mono text-[11px] text-ink-400 truncate">
                  {renameTarget.address.slice(0, 14)}…
                </p>
              </div>
            </div>
          )}

          <div>
            <label className="text-[10px] uppercase tracking-wider text-ink-500 font-medium mb-2 block">
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
              placeholder="e.g. Foundation Multisig"
            />
            <p className="text-[10px] text-ink-500 mt-2">
              Updates the display name and the keystore JSON's metadata, so an
              export of this account will carry the new name to other devices.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setToRename(null)} className="btn-secondary">
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
        open={toRemove !== null}
        onClose={() => setToRemove(null)}
        title="Remove account"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-danger/10 border border-danger/30">
            <AlertTriangle size={20} className="text-danger flex-shrink-0 mt-0.5" />
            <div className="text-sm text-ink-200">
              <p className="font-medium mb-1">This cannot be undone.</p>
              <p className="text-ink-300 text-xs leading-relaxed">
                Make sure you have your recovery phrase or keystore backup.
                Without it, removed accounts cannot be restored.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setToRemove(null)} className="btn-secondary">
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

/**
 * Validate a user-entered RPC URL. Returns null on success, or an error
 * message string. We don't try to be exhaustive — WsProvider will surface
 * its own error if the URL is malformed past these basic checks.
 */
function validateRpcUrl(url: string): string | null {
  if (!url) return 'URL is required';
  if (!/^wss?:\/\//i.test(url)) return 'Must start with wss:// or ws://';
  try {
    const parsed = new URL(url);
    if (!parsed.host) return 'Missing host (e.g. wss://node.example.com)';
  } catch {
    return 'Invalid URL';
  }
  return null;
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs uppercase tracking-wider text-ink-400 font-medium">
          {title}
        </h2>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({
  icon,
  label,
  value,
  onClick,
  readonly,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onClick?: () => void;
  readonly?: boolean;
}) {
  const content = (
    <>
      {icon}
      <span className="flex-1 text-sm font-medium">{label}</span>
      <span className="text-sm text-ink-400 font-mono truncate max-w-[140px]">
        {value}
      </span>
      {!readonly && <ChevronRight size={16} className="text-ink-500" />}
    </>
  );

  if (readonly) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-ink-800 border border-ink-700/50">
        {content}
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700"
    >
      {content}
    </button>
  );
}
