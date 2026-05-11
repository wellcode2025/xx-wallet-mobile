/**
 * MultisigDetail — read-only view of a multisig the user is part of.
 *
 * Shows: local nickname, derived address, threshold (M of N), live balance,
 * cosigner list, and a timeline of multisig actions executed at this address
 * (from the indexer's pre-decoded `nested_calls`).
 *
 * Slice 1 surface — no actions yet:
 *   - Propose new call → slice 3
 *   - Approve / Cancel pending → slice 2 / slice 4
 *   - Edit local nickname → present here as a stub button (renames via the
 *     store but is intentionally minimal — full label/UX comes with slice 5)
 *   - Address-book nickname substitution in cosigners → slice 7
 *
 * Per design doc §6.3.
 */

import { useMemo } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Users, ExternalLink, Plus, Clock } from 'lucide-react';
import clsx from 'clsx';
import { TopBar } from '@/components/layout';
import { AddressChip, AddressIcon } from '@/components/ui';
import {
  useBalance,
  useMultisigActivity,
  usePendingMultisigs,
  type MultisigActivityItem,
} from '@/hooks';
import { useAccountsStore, useMultisigsStore } from '@/store';
import { formatBalance } from '@/utils/format';
import { shortenAddress } from '@/utils/address';
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
            <p className="text-xs text-ink-500">
              {formatBalance(balance.reserved)} {XX_SYMBOL} reserved
              <span className="text-ink-600"> · multisig deposits</span>
            </p>
          )}
        </div>

        {/* Cosigners */}
        <div className="card space-y-3">
          <p className="text-[10px] uppercase tracking-wider text-ink-500 font-medium">
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
              <p className="text-[10px] uppercase tracking-wider text-amber-400 font-medium">
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
                return (
                  <button
                    key={p.callHash}
                    onClick={() =>
                      navigate(`/multisig/${address}/approve/${p.callHash}`)
                    }
                    className={clsx(
                      'w-full flex items-center gap-3 p-2.5 rounded-md text-left transition-colors',
                      needsUser
                        ? 'bg-amber-500/10 border border-amber-500/30 active:bg-amber-500/15'
                        : 'bg-ink-900 border border-ink-700 active:bg-ink-800'
                    )}
                  >
                    <Clock
                      size={14}
                      className={
                        needsUser ? 'text-amber-300' : 'text-ink-400'
                      }
                      strokeWidth={2}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink-100">
                        {needsUser
                          ? 'Awaiting your approval'
                          : userIsDepositor
                          ? 'Your proposal'
                          : userHasApproved
                          ? "You've approved"
                          : 'Awaiting other signers'}
                      </p>
                      <p className="text-[11px] text-ink-400">
                        {p.approvals.length} of {multisig.threshold} signed
                        · proposed at #{p.whenBlock.toLocaleString()}
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
            <p className="text-[10px] uppercase tracking-wider text-ink-500 font-medium">
              Recent activity
            </p>
            {total > 0 && (
              <span className="text-[10px] text-ink-500">
                {total} executed
              </span>
            )}
          </div>
          {activityLoading && (
            <p className="text-xs text-ink-500">Loading activity…</p>
          )}
          {activityError && (
            <p className="text-xs text-ink-500">
              Couldn't load activity. The multisig itself is fine — only the
              historical view is affected.
            </p>
          )}
          {!activityLoading && !activityError && activity.length === 0 && (
            <p className="text-xs text-ink-500">
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

        {/* Propose new call — primary action on this screen for signers */}
        {userIsSigner && (
          <button
            onClick={() => navigate(`/multisig/${address}/propose`)}
            className="btn-primary w-full"
          >
            <Plus size={16} strokeWidth={2} />
            Propose new call
          </button>
        )}
      </div>
    </>
  );
}

function SignerRow({ address, label }: { address: string; label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <AddressIcon address={address} size={28} />
      <div className="flex-1 min-w-0">
        {label ? (
          <>
            <p className="text-sm font-medium text-ink-100 truncate">{label}</p>
            <p className="font-mono text-[11px] text-ink-400 truncate">
              {address}
            </p>
          </>
        ) : (
          <p className="font-mono text-xs text-ink-200 truncate">{address}</p>
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
          className="inline-flex items-center gap-1 text-[11px] text-ink-500 active:text-ink-300"
          title="View block on explorer"
        >
          #{item.blockNumber.toLocaleString()}
          <ExternalLink size={10} strokeWidth={1.75} />
        </a>
      </div>
      <p
        className={clsx(
          'text-sm leading-snug',
          item.success ? 'text-ink-100' : 'text-ink-500'
        )}
      >
        {action}
        {!item.success && (
          <span className="text-danger text-xs ml-2">· failed</span>
        )}
      </p>
      <p className="font-mono text-[10px] text-ink-500 truncate">
        finalized by {shortenAddress(item.signer)}
      </p>
    </div>
  );
}

/**
 * Render a description of what a multisig action did, from the indexer's
 * decoded nested_calls structure.
 *
 * For slice 1, only `balances.transferKeepAlive` (the 100% of foundation
 * usage we observed in the spike) gets a "friendly" rendering. Anything
 * else falls back to `section.method` — truthful and clearly generic.
 *
 * Slice 7 broadens this. The shape of nested_calls is loose (`unknown`)
 * because the indexer's exact JSON varies with runtime upgrades; we parse
 * defensively here and elsewhere it's consumed.
 */
function describeAction(nestedCalls: unknown): string {
  if (!Array.isArray(nestedCalls) || nestedCalls.length === 0) {
    return 'Multisig action (no decoded data available)';
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
    return wrapper
      ? `${wrapper.module}.${wrapper.call ?? 'unknown'}(...)`
      : 'Multisig action';
  }

  const fq = `${inner.module}.${inner.call}`;

  // Friendly rendering for the one call type the foundation actually uses.
  if (
    fq === 'balances.transferKeepAlive' ||
    fq === 'balances.transferAllowDeath' ||
    fq === 'balances.transfer'
  ) {
    const parsed = parseArgs(inner.args);
    const dest = extractDestAddress(parsed?.[0]);
    const value = typeof parsed?.[1] === 'number' || typeof parsed?.[1] === 'string'
      ? formatBalance(String(parsed[1]))
      : '?';
    return `Sent ${value} ${XX_SYMBOL} to ${dest}`;
  }

  // Truthful fallback for anything else — slice 7 will broaden this.
  return `${fq}(...)`;
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
 * `Id` variant; for everything else we render the destination opaquely.
 */
function extractDestAddress(dest: unknown): string {
  if (typeof dest === 'string') return shortenAddress(dest);
  if (dest && typeof dest === 'object') {
    const d = dest as Record<string, unknown>;
    const id = d.id ?? d.Id;
    if (typeof id === 'string') return shortenAddress(id);
  }
  return '?';
}
