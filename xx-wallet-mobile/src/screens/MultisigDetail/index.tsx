/**
 * MultisigDetail — read-only view of a multisig the user is part of.
 *
 * Shows: local nickname, derived address, threshold (M of N), live balance,
 * cosigner list, and a timeline of multisig actions executed at this address
 * (from the indexer's pre-decoded `nested_calls`).
 *
 * Read-only surface. Related flows live elsewhere: propose new call,
 * approve / cancel pending, edit local nickname (present here as a minimal
 * stub button that renames via the store), and address-book nickname
 * substitution in the cosigner list.
 */

import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  Users,
  ExternalLink,
  ArrowUpRight,
  Clock,
  Check,
  Clipboard,
  Download,
  QrCode,
  Send,
  Share2,
} from 'lucide-react';
import QRCode from 'qrcode';
import clsx from 'clsx';
import { TopBar } from '@/components/layout';
import { AddressChip, AddressIcon, AddressLabel, Sheet } from '@/components/ui';
import {
  formatAge,
  useBalance,
  useMultisigActivity,
  usePendingMultisigs,
  useStaleness,
  type MultisigActivityItem,
} from '@/hooks';
import { useAccountsStore, useMultisigsStore } from '@/store';
import { formatBalance } from '@/utils/format';
import { shortenAddress } from '@/utils/address';
import {
  buildMultisigConfig,
  copyToClipboard,
  serializeMultisigConfig,
} from '@/utils';
import { XX_SYMBOL } from '@/api';

const EXPLORER_BASE = 'https://explorer.xx.network/blocks/';

export function MultisigDetail() {
  const { address } = useParams<{ address: string }>();
  const multisig = useMultisigsStore((s) =>
    address ? s.getMultisig(address) : undefined
  );

  // If we navigated to an unknown multisig (refresh after deletion, deep
  // link to a removed entry, etc.), bounce back to the dashboard.
  if (!address || !multisig) {
    return <Navigate to="/" replace />;
  }

  return <MultisigView address={address} />;
}

function MultisigView({ address }: { address: string }) {
  const navigate = useNavigate();
  const multisig = useMultisigsStore((s) => s.getMultisig(address))!;
  const { activeAddress } = useAccountsStore();
  const { balance } = useBalance(address);
  const { activity, isLoading: activityLoading, error: activityError, total } =
    useMultisigActivity(address);
  const { pending } = usePendingMultisigs(address);
  const stalenessOf = useStaleness();
  const [exportOpen, setExportOpen] = useState(false);

  // The user can only propose at this multisig if they're a signer of it.
  // Defensive check — for a multisig that's been imported, this should
  // always be true (the import flow won't let you create one you're not in)
  // but we re-check here in case a future import path forgets to enforce it.
  const userIsSigner = activeAddress
    ? multisig.signers.some((s) => s.address === activeAddress)
    : false;

  return (
    <>
      <TopBar title={multisig.localName} showBack />
      <div className="px-5 py-6 max-w-md mx-auto space-y-5">
        {/* Hero: identicon, address, threshold, balance */}
        <div className="flex flex-col items-center text-center space-y-3 pt-2">
          <AddressIcon address={address} size={56} />
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-xx-500/10 text-xx-500 text-xs font-medium">
              <Users size={12} strokeWidth={2.25} />
              {multisig.threshold}-of-{multisig.signers.length} multisig
            </span>
          </div>
          <p className="font-mono text-xs text-ink-300 break-all leading-snug max-w-[20rem]">
            {address}
          </p>
          <div className="flex items-baseline gap-2 justify-center pt-1">
            <span className="text-balance numeric text-ink-100">
              {balance ? formatBalance(balance.free) : '—'}
            </span>
            <span className="text-base text-ink-300 font-display font-medium">
              {XX_SYMBOL}
            </span>
          </div>
          {balance && balance.reserved.gtn(0) && (
            <p className="text-xs text-ink-400">
              {formatBalance(balance.reserved)} {XX_SYMBOL} reserved
              <span className="text-ink-600"> · multisig deposits</span>
            </p>
          )}
        </div>

        {/* Quick action — primary entry into the propose flow. Mirrors
            Dashboard's Send affordance (right under the balance hero) so
            the multisig surface has the same discoverable shape as a
            regular account. Previously this entry lived at the bottom of
            the screen below Cosigners / Pending / Activity, where users
            had to scroll past everything to find it. */}
        {userIsSigner && (
          <button
            onClick={() => navigate(`/multisig/${address}/propose`)}
            className="btn-primary w-full"
          >
            <ArrowUpRight size={18} strokeWidth={2} />
            Propose
          </button>
        )}

        {/* Cosigners */}
        <div className="card space-y-3">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Signers ({multisig.threshold} required to execute)
          </p>
          <div className="space-y-2">
            {multisig.signers.map((signer) => (
              <SignerRow
                key={signer.address}
                address={signer.address}
                label={signer.label}
              />
            ))}
          </div>
        </div>

        {/* Pending proposals — surfaced before historical activity since they
            need attention. Each row links to the same approval flow as the
            dropdown's Pending actions. */}
        {pending.length > 0 && (
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-amber-400 font-medium">
                Pending proposals ({pending.length})
              </p>
            </div>
            <div className="space-y-2">
              {pending.map((p) => {
                const userHasApproved = activeAddress
                  ? p.approvals.includes(activeAddress)
                  : false;
                const userIsDepositor = p.depositor === activeAddress;
                const needsUser =
                  userIsSigner && !userHasApproved && !userIsDepositor;
                const stale = stalenessOf(p.whenBlock);
                // Stale items get the amber treatment regardless of role —
                // they're attention-worthy. Non-stale items use the
                // existing needs-user-vs-not styling.
                const highlight = stale.isStale || needsUser;
                return (
                  <button
                    key={p.callHash}
                    onClick={() =>
                      navigate(`/multisig/${address}/approve/${p.callHash}`)
                    }
                    className={clsx(
                      'w-full flex items-center gap-3 p-2.5 rounded-md text-left transition-colors',
                      highlight
                        ? 'bg-amber-500/10 border border-amber-500/30 active:bg-amber-500/15'
                        : 'bg-ink-900 border border-ink-700 active:bg-ink-800'
                    )}
                  >
                    <Clock
                      size={14}
                      className={
                        highlight ? 'text-amber-300' : 'text-ink-400'
                      }
                      strokeWidth={2}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink-100">
                        {stale.isStale && userIsDepositor
                          ? 'Stale — cancel & reclaim'
                          : stale.isStale
                          ? 'Stale proposal'
                          : needsUser
                          ? 'Awaiting your approval'
                          : userIsDepositor
                          ? 'Your proposal'
                          : userHasApproved
                          ? "You've approved"
                          : 'Awaiting other signers'}
                      </p>
                      <p className="text-xs text-ink-400">
                        {p.approvals.length} of {multisig.threshold} signed
                        {stale.ageDays > 0 && (
                          <> · {formatAge(stale.ageDays)} old</>
                        )}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Activity */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
              Recent activity
            </p>
            {total > 0 && (
              <span className="text-xs text-ink-400">
                {total} executed
              </span>
            )}
          </div>
          {activityLoading && (
            <p className="text-xs text-ink-400">Loading activity…</p>
          )}
          {activityError && (
            <p className="text-xs text-ink-400">
              Couldn't load activity. The multisig itself is fine — only the
              historical view is affected.
            </p>
          )}
          {!activityLoading && !activityError && activity.length === 0 && (
            <p className="text-xs text-ink-400">
              No executed actions yet at this multisig.
            </p>
          )}
          {!activityLoading && activity.length > 0 && (
            <div className="space-y-2">
              {activity.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>

        {/* Action row: Export config. The Propose entry now lives as a
            quick-action right under the balance hero; keeping it here
            too would just be a duplicate entry point. Export remains
            available to all viewers — even watch-only — so they can
            re-share the config to bring others onto the same multisig. */}
        <button
          onClick={() => setExportOpen(true)}
          className="btn-secondary w-full"
        >
          <Share2 size={16} strokeWidth={2} />
          Export config to share with cosigners
        </button>
      </div>

      {/* Export sheet — produces a config JSON that other signers can
          import to bring the same multisig into their wallets without
          having to retype every signer + threshold. The receiving
          wallet's parseMultisigConfig re-derives the address from the
          JSON's parameters and refuses if it doesn't match what the
          JSON claims, so this can be sent over untrusted channels
          (Slack, email, etc.) safely. */}
      <ExportConfigSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        address={address}
      />
    </>
  );
}

/**
 * Sheet that produces a multisig config JSON and offers the same first-
 * class share affordances as MultisigShare (file download primary, QR,
 * native share, copy as text). Inlined here as a sub-component rather
 * than a full screen because the export action is one-step (not a
 * multi-screen flow) and a sheet maps cleanly to that.
 */
function ExportConfigSheet({
  open,
  onClose,
  address,
}: {
  open: boolean;
  onClose: () => void;
  address: string;
}) {
  const multisig = useMultisigsStore((s) => s.getMultisig(address))!;
  const { activeAddress } = useAccountsStore();

  // Build the config once when the sheet opens. The build itself is
  // fast (just sorting + a hash check) so re-running on every open is
  // fine — keeps the export current if the multisig record changes.
  const config = useMemo(() => {
    if (!open) return null;
    try {
      return buildMultisigConfig({
        multisigAddress: address,
        threshold: multisig.threshold,
        signers: multisig.signers.map((s) => s.address),
        suggestedName: multisig.localName,
        // Stamp the active account as the creator if they're a signer
        // of this multisig — informational only, the wallet does not
        // authenticate this. Skip if the user isn't a signer (they're
        // re-sharing someone else's multisig and shouldn't claim
        // creator credit).
        createdBy:
          activeAddress &&
          multisig.signers.some((s) => s.address === activeAddress)
            ? activeAddress
            : undefined,
      });
    } catch {
      return null;
    }
  }, [open, address, multisig, activeAddress]);

  const json = useMemo(
    () => (config ? serializeMultisigConfig(config) : ''),
    [config]
  );

  const fileName = `multisig-config-${address.slice(0, 10)}.json`;

  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  // Pre-render the QR when the JSON is ready so toggling the QR
  // section doesn't show a flash of loading.
  useEffect(() => {
    if (!json) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(json, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [json]);

  const handleDownload = () => {
    setShareError(null);
    if (!json) return;
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setShareError(`Download failed: ${(e as Error).message}`);
    }
  };

  const handleCopy = async () => {
    setShareError(null);
    if (!json) return;
    const ok = await copyToClipboard(json);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      setShareError('Could not copy — try the download option instead.');
    }
  };

  const handleShareSheet = async () => {
    setShareError(null);
    if (!json) return;
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const file = new File([blob], fileName, { type: 'application/json' });
      const navWithCanShare = navigator as Navigator & {
        canShare?: (data: { files?: File[] }) => boolean;
      };
      if (
        navWithCanShare.canShare &&
        navWithCanShare.canShare({ files: [file] })
      ) {
        await navigator.share({
          files: [file],
          title: 'Multisig config',
          text: `Multisig config for ${multisig.localName}`,
        });
      } else if (navigator.share) {
        await navigator.share({ title: 'Multisig config', text: json });
      } else {
        setShareError(
          'Share sheet not available in this browser. Use Download or Copy instead.'
        );
      }
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (!/abort|cancel/i.test(msg)) {
        setShareError(`Share failed: ${msg}`);
      }
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Export multisig config">
      <div className="space-y-3">
        <p className="text-xs text-ink-400 leading-relaxed">
          Share this with other signers so they can import this multisig
          into their wallet — no need for them to manually retype every
          signer or threshold. Their wallet re-derives the address from
          the JSON locally and refuses if anything's been tampered with,
          so it's safe to send over Slack, email, AirDrop, or any
          channel you trust.
        </p>

        {!config && (
          <p className="text-xs text-danger">
            Couldn't build the config (the stored multisig record is
            inconsistent). Try removing and re-adding the multisig.
          </p>
        )}

        {config && (
          <>
            <button onClick={handleDownload} className="btn-primary w-full">
              <Download size={16} strokeWidth={2} />
              Download as file
            </button>
            <p className="text-xs text-ink-400 leading-relaxed -mt-1 px-1">
              Recommended. Saves <code>{fileName}</code> — share via any
              channel you trust.
            </p>

            <button
              onClick={() => setQrOpen((o) => !o)}
              className="btn-secondary w-full"
            >
              <QrCode size={16} strokeWidth={2} />
              {qrOpen ? 'Hide QR code' : 'Show QR code'}
            </button>
            {qrOpen && (
              <div className="card flex flex-col items-center space-y-2 bg-white">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Multisig config QR code"
                    className="w-full max-w-[280px] h-auto"
                  />
                ) : (
                  <div className="w-[280px] h-[280px] flex items-center justify-center text-ink-400 text-xs">
                    Generating…
                  </div>
                )}
                <p className="text-xs text-ink-700 text-center px-2 pb-1">
                  Have your cosigner scan this with their wallet.
                </p>
              </div>
            )}

            <button onClick={handleShareSheet} className="btn-secondary w-full">
              <Send size={16} strokeWidth={2} />
              Share via…
            </button>

            <button onClick={handleCopy} className="btn-secondary w-full">
              {copied ? (
                <Check size={16} className="text-xx-500" strokeWidth={2.25} />
              ) : (
                <Clipboard size={16} strokeWidth={2} />
              )}
              {copied ? 'Copied' : 'Copy as text'}
            </button>

            {shareError && (
              <p className="text-xs text-danger leading-snug px-1">
                {shareError}
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function SignerRow({ address, label }: { address: string; label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <AddressIcon address={address} size={28} />
      <div className="flex-1 min-w-0">
        {label ? (
          // Multisig record carries an explicit per-signer label — most
          // specific source, prefer it over address-book lookup. Still
          // pair with the truncated address per design doc §7.3.
          <>
            <p className="text-sm font-medium text-ink-100 truncate">{label}</p>
            <p className="font-mono text-xs text-ink-400 truncate">
              {shortenAddress(address)}
            </p>
          </>
        ) : (
          // Fall through to AddressLabel — it'll surface a name from
          // own accounts / contacts / known multisigs if any of those
          // match, else render just the truncated fragment.
          <AddressLabel address={address} stacked className="text-sm" />
        )}
      </div>
      <AddressChip address={address} shortened className="flex-shrink-0" />
    </div>
  );
}

function ActivityRow({ item }: { item: MultisigActivityItem }) {
  const date = useMemo(() => {
    if (!item.timestamp) return '—';
    return new Date(item.timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, [item.timestamp]);

  const action = useMemo(() => describeAction(item.nestedCalls), [item.nestedCalls]);
  const explorerUrl = `${EXPLORER_BASE}${item.blockNumber}`;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-400 numeric">{date}</span>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-ink-400 active:text-ink-300"
          title="View block on explorer"
        >
          #{item.blockNumber.toLocaleString()}
          <ExternalLink size={10} strokeWidth={1.75} />
        </a>
      </div>
      <p
        className={clsx(
          'text-sm leading-snug',
          item.success ? 'text-ink-100' : 'text-ink-400'
        )}
      >
        {action.kind === 'transfer' ? (
          <>
            Sent{' '}
            <span className="numeric">
              {action.amount} {XX_SYMBOL}
            </span>{' '}
            to{' '}
            {action.recipient ? (
              <AddressLabel address={action.recipient} />
            ) : (
              <span className="font-mono text-xs text-ink-300">?</span>
            )}
          </>
        ) : (
          action.text
        )}
        {!item.success && (
          <span className="text-danger text-xs ml-2">· failed</span>
        )}
      </p>
      <p className="text-xs text-ink-400 truncate">
        finalized by{' '}
        <AddressLabel address={item.signer} className="text-xs" />
      </p>
    </div>
  );
}

/**
 * Decoded description of a multisig action, suitable for inline rendering.
 *
 * For transfers we keep the recipient's full SS58 string (not a truncation)
 * so the row can render it through AddressLabel — that surfaces a
 * known-name + truncated fragment when the recipient is in the user's
 * accounts / address book / known multisigs, and falls back to the
 * truncated fragment otherwise.
 *
 * Anything else gets a truthful fallback string (`section.method(...)`).
 */
type ActivityDescription =
  | { kind: 'transfer'; amount: string; recipient: string | null }
  | { kind: 'other'; text: string };

/**
 * Decode a multisig action from the indexer's nested_calls structure.
 *
 * Returns structured data so callers can apply address-book name
 * substitution to recipient addresses. The shape of
 * nested_calls is loose (`unknown`) because the indexer's exact JSON
 * varies with runtime upgrades; we parse defensively here and elsewhere
 * it's consumed.
 */
function describeAction(nestedCalls: unknown): ActivityDescription {
  if (!Array.isArray(nestedCalls) || nestedCalls.length === 0) {
    return { kind: 'other', text: 'Multisig action (no decoded data available)' };
  }

  // The first depth-0 entry is the multisig wrapper; the inner call is
  // the actual action. Find the deepest entry that isn't the multisig
  // pallet itself — that's the thing that actually got executed.
  type CallEntry = { module?: string; call?: string; args?: string };
  const inner = (nestedCalls as CallEntry[])
    .slice()
    .reverse()
    .find((c) => c?.module && c.module !== 'multisig' && c.module !== 'utility');
  const wrapper = (nestedCalls as CallEntry[]).find(
    (c) => c?.module === 'multisig'
  );

  if (!inner) {
    // Just a multisig wrapper with no inner call we can describe — possibly
    // a proposal-only call (asMulti at first signature with `call` being a
    // hash-only reference). Should be rare for executed events but possible.
    return {
      kind: 'other',
      text: wrapper
        ? `${wrapper.module}.${wrapper.call ?? 'unknown'}(...)`
        : 'Multisig action',
    };
  }

  const fq = `${inner.module}.${inner.call}`;

  if (
    fq === 'balances.transferKeepAlive' ||
    fq === 'balances.transferAllowDeath' ||
    fq === 'balances.transfer'
  ) {
    const parsed = parseArgs(inner.args);
    const recipient = extractDestAddress(parsed?.[0]);
    const amount =
      typeof parsed?.[1] === 'number' || typeof parsed?.[1] === 'string'
        ? formatBalance(String(parsed[1]))
        : '?';
    return { kind: 'transfer', amount, recipient };
  }

  // Truthful fallback for anything else — broader friendly rendering can
  // come later. The `section.method(...)` form is at least never lying.
  return { kind: 'other', text: `${fq}(...)` };
}

function parseArgs(args: unknown): unknown[] | null {
  if (!args) return null;
  if (Array.isArray(args)) return args;
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Extract a Substrate-style account address from a destination argument.
 * Polkadot encodes destinations as MultiAddress: `{id: "6..."}` or `{Id: "6..."}`,
 * sometimes also `{raw: "0x..."}` or `{index: N}`. We handle the common
 * `Id` variant; for everything else we return null and the caller renders
 * a placeholder. Returns the FULL SS58 string so callers can pass it to
 * AddressLabel for name resolution.
 */
function extractDestAddress(dest: unknown): string | null {
  if (typeof dest === 'string') return dest;
  if (dest && typeof dest === 'object') {
    const d = dest as Record<string, unknown>;
    const id = d.id ?? d.Id;
    if (typeof id === 'string') return id;
  }
  return null;
}
