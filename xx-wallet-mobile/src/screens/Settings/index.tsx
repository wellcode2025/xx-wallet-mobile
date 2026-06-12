import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLockSettings } from './AppLockSettings';
import {
  ChevronRight,
  Check,
  Download,
  DownloadCloud,
  Loader2,
  Package,
  Plus,
  Globe,
  Info,
  AlertTriangle,
  Smartphone,
  Monitor,
  ArrowRight,
  PlusCircle,
  FileJson,
  X,
} from 'lucide-react';
import {
  STALE_THRESHOLD_DAYS_DEFAULT,
  STALE_THRESHOLD_DAYS_MAX,
  STALE_THRESHOLD_DAYS_MIN,
  useAccountsStore,
  useConnectionStore,
  useInstallStore,
  useMultisigsStore,
  useSettingsStore,
} from '@/store';
import { XX_ENDPOINTS } from '@/api';
import { TopBar } from '@/components/layout';
import { AddressIcon, Sheet } from '@/components/ui';
import { isLocalAccount, xxKeyring } from '@/keyring';
import { Users } from 'lucide-react';
import clsx from 'clsx';

export function Settings() {
  const navigate = useNavigate();
  const { accounts, activeAddress } = useAccountsStore();
  const endpoint = useSettingsStore((s) => s.endpoint);
  const customEndpoint = useSettingsStore((s) => s.customEndpoint);
  const setEndpoint = useSettingsStore((s) => s.setEndpoint);
  const setCustomEndpoint = useSettingsStore((s) => s.setCustomEndpoint);
  const setConnectionEndpoint = useConnectionStore((s) => s.setEndpoint);
  const chainName = useConnectionStore((s) => s.chainName);
  const blockNumber = useConnectionStore((s) => s.blockNumber);

  // Captured Chrome install prompt (Android). Hook into the same store
  // App.tsx writes the beforeinstallprompt event into.
  const deferredPrompt = useInstallStore((s) => s.deferredPrompt);
  const setDeferredPrompt = useInstallStore((s) => s.setDeferredPrompt);
  const handleInstall = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      // Whether accepted or dismissed, the captured event is single-use.
      setDeferredPrompt(null);
      // Optional: log accept/dismiss outcome for debugging.
      if (result.outcome === 'accepted') {
        // No-op; the appinstalled listener in App.tsx also clears the
        // prompt, but this branch covers the immediate state update.
      }
    } catch {
      // User dismissed the system prompt — drop the deferred event so
      // we don't re-show the button until Chrome refires.
      setDeferredPrompt(null);
    }
  };

  const [endpointOpen, setEndpointOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

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

  const currentEndpointName =
    XX_ENDPOINTS.find((e) => e.url === endpoint)?.name ?? 'Custom';

  return (
    <>
      <TopBar title="Settings" />

      <div className="px-5 py-4 space-y-6 max-w-md mx-auto">
        {/* Install xx Wallet — visible only when Chrome has captured an
            install prompt. iOS users get a separate banner; this row is
            specifically for Android Chrome users whose auto-prompt
            heuristic didn't fire. */}
        {deferredPrompt && (
          <Section title="App">
            <Row
              icon={<DownloadCloud size={18} className="text-xx-500" />}
              label="Install xx Wallet"
              value="To home screen"
              onClick={handleInstall}
            />
          </Section>
        )}

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

        <AppLockSettings />

        {/* Accounts section */}
        <Section
          title="Accounts"
          action={
            <div className="flex items-center gap-3">
              {accounts.length > 1 && (
                <button
                  onClick={() => setBatchOpen(true)}
                  className="flex items-center gap-1 text-sm text-ink-300 active:text-ink-100"
                  title="Export multiple accounts in one file"
                >
                  <Package size={16} />
                  Batch export
                </button>
              )}
              <button
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-1 text-sm text-xx-500 active:text-xx-600"
              >
                <Plus size={16} />
                Add
              </button>
            </div>
          }
        >
          {accounts.map((acct) => (
            <button
              key={acct.address}
              onClick={() => navigate(`/account/${acct.address}`)}
              className={clsx(
                'w-full flex items-center gap-3 p-3 rounded-2xl border text-left active:bg-ink-700 transition-colors',
                acct.address === activeAddress
                  ? 'bg-ink-800 border-xx-500/30'
                  : 'bg-ink-800 border-ink-700/50'
              )}
            >
              <AddressIcon address={acct.address} size={36} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm truncate">{acct.name}</p>
                  {acct.address === activeAddress && (
                    <span className="text-[10px] uppercase tracking-wider text-xx-500 font-semibold flex-shrink-0">
                      Active
                    </span>
                  )}
                </div>
                <p className="font-mono text-xs text-ink-400 truncate mt-0.5">
                  {acct.address.slice(0, 14)}…
                </p>
              </div>
              <ChevronRight size={18} className="text-ink-400 flex-shrink-0" />
            </button>
          ))}
        </Section>

        {/* Multisig section — only renders if the user has multisigs;
            avoids cluttering Settings for solo users */}
        <MultisigSection />

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
            <ChevronRight size={16} className="text-ink-400" />
          </button>
        </Section>

        {/* About */}
        <Section title="About">
          <div className="px-4 py-3 rounded-2xl bg-ink-800 border border-ink-700/50 space-y-3">
            <div>
              <p className="text-sm font-medium text-ink-200">xx Wallet Mobile</p>
              <p className="text-xs text-ink-400">Version 0.1.0</p>
              <p className="text-xs text-ink-400 pt-1">
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
              <p className="text-sm text-ink-300 mt-0.5">Generate a fresh 24-word recovery phrase</p>
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
              <p className="text-sm text-ink-300 mt-0.5">Use a recovery phrase or keystore file</p>
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

          <p className="text-xs text-ink-400 text-center">
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
              <p className="text-xs text-ink-400 mt-3 leading-relaxed">
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

      {/* Batch export — bundle several accounts into one file shaped for
          polkadot.js-style "import all accounts" flows (including the
          official xx desktop wallet's). */}
      <BatchExportSheet
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
      />

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
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!parsed.host) return 'Missing host (e.g. wss://node.example.com)';
  } catch {
    return 'Invalid URL';
  }
  // ws:// (plaintext) is only allowed for localhost. For remote nodes the
  // wallet would otherwise leak the full transaction history to anyone on
  // the network path — signed extrinsics don't reveal keys, but they do
  // reveal exactly what the user is doing on chain. For a wallet on a
  // privacy-focused network that's particularly off-brand.
  if (parsed.protocol === 'ws:') {
    const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
    if (!localHosts.has(parsed.hostname.toLowerCase())) {
      return 'Plaintext ws:// is only allowed for localhost. Use wss:// for remote nodes.';
    }
  }
  return null;
}

/**
 * Multisig settings — the stale-proposal threshold. Only renders when
 * the user actually has multisigs in their wallet, so solo users don't
 * see configuration for a feature they don't use.
 *
 * Threshold defaults to 30 days; bounded 7..365 in the store so a
 * malformed input here can't break the staleness compare downstream.
 */
function MultisigSection() {
  const multisigs = useMultisigsStore((s) => s.multisigs);
  const staleThresholdDays = useSettingsStore((s) => s.staleThresholdDays);
  const setStaleThresholdDays = useSettingsStore(
    (s) => s.setStaleThresholdDays
  );

  // Local input state so the user can type freely; we commit to the
  // store on blur (after clamping). This avoids resetting the input
  // mid-typing if they're heading toward a value outside the bounds.
  const [draft, setDraft] = useState<string>(String(staleThresholdDays));
  useEffect(() => {
    setDraft(String(staleThresholdDays));
  }, [staleThresholdDays]);

  if (multisigs.length === 0) return null;

  const commit = () => {
    const parsed = parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setDraft(String(staleThresholdDays));
      return;
    }
    setStaleThresholdDays(parsed);
  };

  return (
    <Section title="Multisig">
      <div className="px-4 py-3 rounded-2xl bg-ink-800 border border-ink-700/50 space-y-3">
        <div className="flex items-center gap-3">
          <Users size={16} className="text-ink-400" strokeWidth={1.75} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-ink-200">
              Stale-proposal threshold
            </p>
            <p className="text-xs text-ink-400 leading-snug">
              Pending proposals older than this get the stale treatment in
              your wallet — depositors are nudged to cancel and reclaim
              their deposit.
            </p>
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <input
            type="number"
            min={STALE_THRESHOLD_DAYS_MIN}
            max={STALE_THRESHOLD_DAYS_MAX}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            className="input-base w-24 text-center font-mono"
            inputMode="numeric"
          />
          <span className="text-sm text-ink-400">days</span>
          {staleThresholdDays !== STALE_THRESHOLD_DAYS_DEFAULT && (
            <button
              onClick={() => setStaleThresholdDays(STALE_THRESHOLD_DAYS_DEFAULT)}
              className="ml-auto text-xs text-xx-500 active:text-xx-600"
            >
              Reset to {STALE_THRESHOLD_DAYS_DEFAULT}
            </button>
          )}
        </div>
        <p className="text-xs text-ink-400">
          Bounds: {STALE_THRESHOLD_DAYS_MIN}–{STALE_THRESHOLD_DAYS_MAX} days.
        </p>
      </div>
    </Section>
  );
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

/**
 * Batch export sheet — bundles multiple accounts into one JSON file
 * shaped for polkadot{.js}-style "import all accounts" flows.
 *
 * The official xx desktop wallet (and other polkadot.js-derived wallets)
 * no longer expose a single-account import path in their UI — the only
 * way in for a fresh keystore is the bulk "import all" flow, which
 * expects a top-level JSON array of single-account KeyringPair$Json
 * objects: `[{address, encoded, encoding, meta}, ...]`. This sheet
 * produces exactly that.
 *
 * Each account is independently encrypted under its own password, so
 * no re-encryption is needed — we just gather the per-account JSON
 * blobs and write them to a single file. BUT we still ask the user
 * for the password(s) up front and verify that they decrypt the
 * stored keystores: a backup the user can't open later is a useless
 * backup, and surfacing that problem now is far less painful than
 * six months from now when they actually need to restore.
 */
function BatchExportSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const allAccounts = useAccountsStore((s) => s.accounts);
  // Only local (keystore-backed) accounts can be exported. Ledger
  // accounts have no keystore — their key never enters the browser —
  // so they're excluded from the batch list entirely rather than shown
  // as unexportable rows.
  const accounts = useMemo(
    () => allAccounts.filter(isLocalAccount),
    [allAccounts]
  );

  // Which accounts the user wants included in the batch.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Password per account — typical case is each account uses its own.
  // Keyed by SS58 address.
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  // Verification result sets — both are subsets of `selected`.
  const [verified, setVerified] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [verifying, setVerifying] = useState(false);
  // Which address we're currently chewing through scrypt for (so the
  // user gets per-row progress instead of a single dead spinner).
  const [verifyingAddress, setVerifyingAddress] = useState<string | null>(null);

  // Reset state every time the sheet opens, defaulting to "all selected".
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(accounts.map((a) => a.address)));
    setPasswords({});
    setVerified(new Set());
    setFailed(new Set());
    setVerifying(false);
    setVerifyingAddress(null);
  }, [open, accounts]);

  const allSelected =
    accounts.length > 0 && selected.size === accounts.length;
  const allVerified = useMemo(
    () =>
      selected.size > 0 && [...selected].every((a) => verified.has(a)),
    [selected, verified]
  );
  // Verify is enabled whenever at least one selected account has a
  // password typed AND hasn't already been verified — i.e. there's at
  // least one row that could potentially flip green.
  const hasUnverifiedWithPassword = useMemo(
    () =>
      [...selected].some(
        (addr) =>
          !verified.has(addr) &&
          (passwords[addr]?.length ?? 0) > 0
      ),
    [selected, verified, passwords]
  );

  const toggle = (addr: string) => {
    if (verifying) return;
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(addr)) next.delete(addr);
      else next.add(addr);
      return next;
    });
    // Toggling invalidates any prior verification result for that row.
    setVerified((cur) => {
      const next = new Set(cur);
      next.delete(addr);
      return next;
    });
    setFailed((cur) => {
      const next = new Set(cur);
      next.delete(addr);
      return next;
    });
  };

  const selectAll = () => {
    if (verifying) return;
    setSelected(new Set(accounts.map((a) => a.address)));
    setFailed(new Set());
  };
  const selectNone = () => {
    if (verifying) return;
    setSelected(new Set());
    setVerified(new Set());
    setFailed(new Set());
  };

  const handleVerify = async () => {
    if (selected.size === 0 || verifying) return;
    setVerifying(true);
    const nextVerified = new Set(verified);
    const nextFailed = new Set<string>();
    // Run each verification sequentially. scrypt at N=131072 is
    // intentionally expensive (~1s per account); running in parallel
    // would pin the browser tab even harder and gain little.
    for (const addr of selected) {
      if (nextVerified.has(addr)) continue;
      const pw = passwords[addr] ?? '';
      if (!pw) {
        // No password typed for this row — leave it as "not yet
        // verified" rather than marking it failed (which would imply
        // a wrong password rather than an empty one).
        continue;
      }
      setVerifyingAddress(addr);
      try {
        const ok = await xxKeyring.verifyPassword(addr, pw);
        if (ok) nextVerified.add(addr);
        else nextFailed.add(addr);
      } catch {
        nextFailed.add(addr);
      }
    }
    setVerified(nextVerified);
    setFailed(nextFailed);
    setVerifying(false);
    setVerifyingAddress(null);
  };

  const handleDownload = () => {
    const batch = [...selected].map((addr) => xxKeyring.exportJson(addr));
    const blob = new Blob([JSON.stringify(batch)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `xx-wallet-batch-${selected.size}-accounts-${date}.json`;
    link.click();
    URL.revokeObjectURL(url);
    onClose();
  };

  // Count of selected rows that still need a password typed — drives
  // the helper text on the action button.
  const pendingPasswordCount = [...selected].filter(
    (a) => !verified.has(a) && !(passwords[a]?.length ?? 0)
  ).length;

  return (
    <Sheet open={open} onClose={onClose} title="Batch export accounts">
      <div className="space-y-4">
        <p className="text-xs text-ink-400 leading-relaxed">
          Bundle multiple accounts into a single JSON file shaped for the
          "import all accounts" flow used by the official xx desktop wallet
          and other polkadot{'{.js}'}-derived wallets. Each account stays
          encrypted under its own password.
        </p>

        {/* Account selector */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
              Select accounts ({selected.size}/{accounts.length})
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={selectAll}
                disabled={allSelected || verifying}
                className="text-xs text-xx-500 active:text-xx-600 disabled:opacity-40"
              >
                All
              </button>
              <button
                onClick={selectNone}
                disabled={selected.size === 0 || verifying}
                className="text-xs text-ink-400 active:text-ink-200 disabled:opacity-40"
              >
                None
              </button>
            </div>
          </div>

          <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
            {accounts.map((acct) => {
              const isSelected = selected.has(acct.address);
              const isVerified = verified.has(acct.address);
              const isFailed = failed.has(acct.address);
              const isCurrent = verifyingAddress === acct.address;
              return (
                <li key={acct.address} className="space-y-1.5">
                  <button
                    onClick={() => toggle(acct.address)}
                    disabled={verifying}
                    className={clsx(
                      'w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-colors',
                      isSelected
                        ? isVerified
                          ? 'bg-xx-500/10 border-xx-500/40'
                          : isFailed
                          ? 'bg-danger/10 border-danger/30'
                          : 'bg-ink-800 border-ink-700/50'
                        : 'bg-ink-900 border-ink-800',
                      verifying && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <div
                      className={clsx(
                        'w-5 h-5 rounded flex items-center justify-center flex-shrink-0',
                        isSelected
                          ? 'bg-xx-500 text-ink-950'
                          : 'border border-ink-600'
                      )}
                    >
                      {isSelected && <Check size={12} strokeWidth={2.5} />}
                    </div>
                    <AddressIcon
                      address={acct.address}
                      size={28}
                      copyOnTap={false}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink-100 truncate">
                        {acct.name}
                      </p>
                      <p className="font-mono text-xs text-ink-400 truncate">
                        {acct.address.slice(0, 14)}…
                      </p>
                    </div>
                    {isCurrent && (
                      <Loader2
                        size={14}
                        className="animate-spin text-xx-500 flex-shrink-0"
                      />
                    )}
                    {isSelected && isVerified && !isCurrent && (
                      <Check
                        size={14}
                        className="text-xx-500 flex-shrink-0"
                      />
                    )}
                    {isSelected && isFailed && !isCurrent && (
                      <X size={14} className="text-danger flex-shrink-0" />
                    )}
                  </button>

                  {/* Password input — one per selected row. Hidden once
                      the row is verified (no need to keep showing the
                      field for an account we've already cleared). */}
                  {isSelected && !isVerified && (
                    <div className="ml-8">
                      <input
                        type="password"
                        value={passwords[acct.address] ?? ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          setPasswords((cur) => ({
                            ...cur,
                            [acct.address]: value,
                          }));
                          // Clear any prior failure state for this row
                          // when the user edits the password — they're
                          // actively correcting, no need to keep the
                          // red highlight.
                          if (failed.has(acct.address)) {
                            setFailed((cur) => {
                              const next = new Set(cur);
                              next.delete(acct.address);
                              return next;
                            });
                          }
                        }}
                        placeholder={`Password for ${acct.name}`}
                        className={clsx(
                          'input-base text-xs',
                          isFailed && 'border-danger/50'
                        )}
                        disabled={verifying}
                        autoComplete="off"
                      />
                      {isFailed && (
                        <p className="text-xs text-danger mt-1 pl-1">
                          Wrong password — try again.
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Action button */}
        {allVerified ? (
          <button onClick={handleDownload} className="btn-primary w-full">
            <Download size={16} strokeWidth={2} />
            Download {selected.size} account
            {selected.size === 1 ? '' : 's'}
          </button>
        ) : (
          <div className="space-y-2">
            <button
              onClick={handleVerify}
              disabled={
                selected.size === 0 || verifying || !hasUnverifiedWithPassword
              }
              className="btn-primary w-full"
            >
              {verifying ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Verifying…
                </>
              ) : (
                <>
                  <Check size={16} strokeWidth={2} />
                  Verify passwords
                </>
              )}
            </button>
            {pendingPasswordCount > 0 && !verifying && (
              <p className="text-xs text-ink-400 text-center leading-relaxed">
                {pendingPasswordCount} selected account
                {pendingPasswordCount === 1 ? '' : 's'} still need
                {pendingPasswordCount === 1 ? 's' : ''} a password.
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-ink-400 leading-relaxed text-center">
          The exported file is a JSON array of encrypted keystores —
          import it on the receiving wallet via its "Import all accounts"
          or equivalent batch flow.
        </p>
      </div>
    </Sheet>
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
      {!readonly && <ChevronRight size={16} className="text-ink-400" />}
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
