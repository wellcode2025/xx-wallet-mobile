/**
 * TransactionDetail — full detail view for a single transfer.
 *
 * Reached by tapping a TransactionItem on the Dashboard. The Transfer object
 * is handed off via react-router `state` so the screen renders instantly
 * without re-querying the indexer. If the user lands here via a refresh or
 * deep link (no state in history), we send them back to the dashboard rather
 * than re-fetch on a single transfer's id (the list query is keyed on
 * address + offset, not on transfer id).
 */

import { useMemo, useState } from 'react';
import { useLocation, useParams, Navigate } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  XCircle,
  CheckCircle2,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';
import clsx from 'clsx';
import { TopBar } from '@/components/layout';
import { AddressChip, AddressIcon } from '@/components/ui';
import { copyToClipboard } from '@/utils/clipboard';
import { formatBalance } from '@/utils/format';
import { planckToHuman, type Transfer } from '@/hooks/useTransfers';
import { XX_SYMBOL } from '@/api';

const EXPLORER_BASE = 'https://explorer.xx.network/extrinsics/';

export function TransactionDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();

  // Transfer is passed via route state from TransactionItem on the dashboard.
  const transfer = (location.state as { transfer?: Transfer } | null)?.transfer;

  // Deep-link / refresh fallback: no state, so send back to dashboard.
  // (We could rebuild this by re-querying the indexer, but the list query
  // is keyed on address+offset, not on a single transfer's id — not worth
  // adding a new endpoint just for refresh-survival.)
  if (!transfer || transfer.id !== id) {
    return <Navigate to="/" replace />;
  }

  return <DetailView transfer={transfer} />;
}

function DetailView({ transfer }: { transfer: Transfer }) {
  const {
    direction,
    success,
    amount,
    from,
    to,
    fromIdentity,
    toIdentity,
    blockNumber,
    era,
    extrinsicIndex,
    timestamp,
    txHash,
    fee,
    tip,
  } = transfer;

  const humanAmount = planckToHuman(amount);
  const explorerUrl = txHash ? `${EXPLORER_BASE}${txHash}` : null;
  const feeDisplay = formatBalance(fee, { decimals: 6, withSymbol: true });
  const tipIsNonZero = tip && tip !== '0';
  const tipDisplay = tipIsNonZero
    ? formatBalance(tip, { decimals: 6, withSymbol: true })
    : null;

  const config = {
    in: {
      icon: ArrowDownLeft,
      label: 'Received',
      color: 'text-xx-500',
      bgColor: 'bg-xx-500/10',
      prefix: '+',
    },
    out: {
      icon: ArrowUpRight,
      label: 'Sent',
      color: 'text-ink-300',
      bgColor: 'bg-ink-700/40',
      prefix: '-',
    },
    self: {
      icon: RefreshCw,
      label: 'Self transfer',
      color: 'text-ink-400',
      bgColor: 'bg-ink-700/40',
      prefix: '',
    },
  }[direction];

  const Icon = config.icon;

  const dateStr = useMemo(() => {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [timestamp]);

  return (
    <>
      <TopBar title="Transaction" showBack />
      <div className="px-5 py-6 max-w-md mx-auto space-y-5">
        {/* Hero */}
        <div className="flex flex-col items-center text-center space-y-3 pt-2">
          <div
            className={clsx(
              'w-16 h-16 rounded-full flex items-center justify-center',
              config.bgColor
            )}
          >
            {success ? (
              <Icon size={28} className={config.color} strokeWidth={2} />
            ) : (
              <XCircle size={28} className="text-danger" strokeWidth={2} />
            )}
          </div>
          <p className="text-xs uppercase tracking-wider text-ink-300 font-medium">
            {success ? config.label : 'Failed transfer'}
          </p>
          <div className="flex items-baseline gap-2 justify-center">
            <span
              className={clsx(
                'text-balance numeric',
                success ? 'text-ink-100' : 'text-ink-300 line-through'
              )}
            >
              {config.prefix}
              {humanAmount}
            </span>
            <span className="text-base text-ink-300 font-display font-medium">
              {XX_SYMBOL}
            </span>
          </div>
          <StatusBadge success={success} />
        </div>

        {/* Parties */}
        <div className="space-y-3">
          <PartyCard
            label="From"
            address={from}
            identity={fromIdentity}
            highlight={direction === 'out' || direction === 'self'}
          />
          <PartyCard
            label="To"
            address={to}
            identity={toIdentity}
            highlight={direction === 'in'}
          />
        </div>

        {/* On-chain details */}
        <div className="card space-y-3">
          <p className="text-xs uppercase tracking-wider text-ink-300 font-medium">
            On-chain details
          </p>
          <DetailRow label="Block" value={`#${blockNumber.toLocaleString()}`} mono />
          <DetailRow label="Era" value={era ? `#${era}` : '—'} mono />
          <DetailRow
            label="Extrinsic"
            value={`${blockNumber}-${extrinsicIndex}`}
            mono
          />
          <DetailRow label="Fee" value={feeDisplay} mono />
          {tipDisplay && <DetailRow label="Tip" value={tipDisplay} mono />}
          <DetailRow label="Time" value={dateStr} />
        </div>

        {/* Hash */}
        <HashCard hash={txHash} />

        {/* Explorer link */}
        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
          >
            <ExternalLink size={18} strokeWidth={1.75} />
            View on explorer
          </a>
        ) : (
          <p className="text-xs text-ink-300 text-center">
            No transaction hash recorded — cannot link to explorer.
          </p>
        )}
      </div>
    </>
  );
}

function StatusBadge({ success }: { success: boolean }) {
  if (success) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-xx-500/10 text-xx-500 text-xs font-medium">
        <CheckCircle2 size={14} strokeWidth={2.25} />
        Confirmed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-danger/10 text-danger text-xs font-medium">
      <XCircle size={14} strokeWidth={2.25} />
      Failed
    </span>
  );
}

function PartyCard({
  label,
  address,
  identity,
  highlight,
}: {
  label: string;
  address: string;
  identity?: string | null;
  highlight: boolean;
}) {
  return (
    <div
      className={clsx(
        'card flex items-center gap-3',
        highlight && 'border-xx-500/30'
      )}
    >
      <AddressIcon address={address} size={36} />
      <div className="flex-1 min-w-0">
        <p className="text-xs uppercase tracking-wider text-ink-300 font-medium mb-0.5">
          {label}
        </p>
        {identity ? (
          <>
            <p className="text-sm font-medium text-ink-100 truncate">
              {identity}
            </p>
            <p className="font-mono text-xs text-ink-300 truncate">
              {address}
            </p>
          </>
        ) : (
          <p className="font-mono text-xs text-ink-200 break-all leading-snug">
            {address}
          </p>
        )}
      </div>
      <AddressChip address={address} shortened className="flex-shrink-0" />
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
  hint,
}: {
  label: string;
  value: string;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-ink-300">{label}</span>
      <span className="flex items-baseline gap-2 min-w-0">
        {hint && (
          <span className="text-xs text-ink-300 italic">{hint}</span>
        )}
        <span
          className={clsx(
            'text-sm text-ink-200 truncate',
            mono && 'font-mono'
          )}
        >
          {value}
        </span>
      </span>
    </div>
  );
}

function HashCard({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!hash) return;
    const ok = await copyToClipboard(hash);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  if (!hash) {
    return (
      <div className="card">
        <p className="text-xs uppercase tracking-wider text-ink-300 font-medium mb-1">
          Transaction hash
        </p>
        <p className="text-sm text-ink-300">Not available for this transfer.</p>
      </div>
    );
  }

  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-ink-300 font-medium">
          Transaction hash
        </p>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 text-xs text-ink-300 active:text-ink-100"
          aria-label="Copy transaction hash"
        >
          {copied ? (
            <>
              <Check size={14} className="text-xx-500" strokeWidth={2.25} />
              Copied
            </>
          ) : (
            <>
              <Copy size={14} strokeWidth={1.75} />
              Copy
            </>
          )}
        </button>
      </div>
      <p className="font-mono text-xs text-ink-100 break-all leading-relaxed select-all">
        {hash}
      </p>
    </div>
  );
}
