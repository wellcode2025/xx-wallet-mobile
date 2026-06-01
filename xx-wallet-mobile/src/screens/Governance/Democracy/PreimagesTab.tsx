import { useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { formatBalance } from '@/utils';
import { copyToClipboard } from '@/utils/clipboard';
import { DECODE_FAILURE_LABEL } from '@/utils/decodeCall';
import { displayName, useIdentity } from '@/governance';
import type { PreimageEntry } from '@/hooks';

/**
 * Preimages tab inside /governance/democracy.
 *
 * One row per on-chain preimage. Each row shows:
 *   - Truncated hash (with a copy button — preimage hashes are how
 *     referendums and external proposals reference the preimage)
 *   - Status badge (Unrequested / Requested · N)
 *   - Length in bytes + deposit amount + depositor (identity-resolved)
 *   - Either the decoded section.method (truncated) with an expand to
 *     show full literal form, OR the canonical "Unable to decode
 *     preimage bytes into a valid Call" banner (per §6.4)
 *
 * The decoder uses safeDecodeCall — failures are surfaced to the user
 * with the exact wording the web wallet uses, never swallowed or
 * softened. This is the bytes-package trust invariant restated for
 * preimages.
 */
export function PreimagesTab({ preimages }: { preimages: PreimageEntry[] }) {
  if (preimages.length === 0) {
    return (
      <div className="card">
        <p className="text-sm text-ink-100 font-medium">No preimages on chain</p>
        <p className="mt-1 text-sm text-ink-400">
          Preimages are call bytes uploaded ahead of a referendum or
          motion. They appear here once someone calls preimage.notePreimage.
        </p>
      </div>
    );
  }
  return (
    <div className="card">
      <ul className="divide-y divide-ink-800/60">
        {preimages.map((p) => (
          <li key={p.hash}>
            <PreimageRow entry={p} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreimageRow({ entry }: { entry: PreimageEntry }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const { identity } = useIdentity(entry.depositor);
  const name = displayName(identity, entry.depositor);

  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyToClipboard(entry.hash);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="py-3 space-y-2">
      <div className="flex items-start gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 p-1 -ml-1 rounded text-ink-400 active:bg-ink-800/40"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? (
            <ChevronDown size={16} strokeWidth={1.75} />
          ) : (
            <ChevronRight size={16} strokeWidth={1.75} />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="font-mono text-xs text-ink-200 truncate">
              {shortenHex(entry.hash)}
            </p>
            <button
              onClick={onCopy}
              className={clsx(
                'shrink-0 p-1 rounded transition-colors',
                copied
                  ? 'text-xx-500'
                  : 'text-ink-400 active:text-xx-500 active:bg-ink-800/40'
              )}
              aria-label="Copy full hash"
              title={copied ? 'Copied!' : 'Copy full hash'}
            >
              <Copy size={12} strokeWidth={1.75} />
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-400 truncate">
            <StatusBadge kind={entry.kind} count={entry.count} /> ·{' '}
            <span className="text-ink-300">{entry.length} bytes</span>
            {entry.deposit && (
              <>
                {' '}· deposit{' '}
                <span className="text-ink-300 font-mono">
                  {formatBalance(entry.deposit, {
                    decimals: 4,
                    trim: true,
                    grouping: true,
                  })}
                </span>{' '}
                XX
              </>
            )}
          </p>
          <p className="mt-0.5 text-xs text-ink-400 truncate">
            Submitted by{' '}
            <span className="text-ink-300">{name.primary}</span>
            {name.secondary && (
              <span className="text-ink-400 font-mono"> {name.secondary}</span>
            )}
          </p>
        </div>
      </div>

      <DecodeBlock entry={entry} expanded={expanded} />
    </div>
  );
}

function DecodeBlock({
  entry,
  expanded,
}: {
  entry: PreimageEntry;
  expanded: boolean;
}) {
  if (!entry.decodeResult) {
    return (
      <p className="ml-6 text-xs text-ink-400 italic">
        Preimage bytes not stored — only the hash is on chain.
      </p>
    );
  }
  if (!entry.decodeResult.ok) {
    return (
      <div className="ml-6 rounded-xl border border-warning/40 bg-warning/5 p-2.5">
        <p className="text-xs text-warning flex items-start gap-1.5">
          <AlertTriangle size={12} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>{DECODE_FAILURE_LABEL}</span>
        </p>
        {expanded && entry.decodeResult.error && (
          <p className="mt-2 text-xs text-ink-400 font-mono break-words">
            {entry.decodeResult.error}
          </p>
        )}
      </div>
    );
  }
  const decoded = entry.decodeResult.decoded;
  // Compact label for the collapsed view: section.method
  return (
    <div className="ml-6">
      <p className="font-mono text-xs text-ink-100">
        <span className="text-xx-500">{decoded.section}.</span>
        <span className="text-ink-100">{decoded.method}</span>
      </p>
      {expanded && (
        <div className="mt-2 rounded-xl bg-ink-950/60 border border-ink-800/60 p-2.5">
          {decoded.friendly && (
            <p className="text-xs text-ink-100 whitespace-pre-wrap break-words">
              {decoded.friendly}
            </p>
          )}
          <p
            className={clsx(
              decoded.friendly && 'mt-2',
              'text-xs text-ink-400 font-mono break-words'
            )}
          >
            {decoded.literal}
          </p>
        </div>
      )}
    </div>
  );
}

function StatusBadge({
  kind,
  count,
}: {
  kind: 'unrequested' | 'requested';
  count: number;
}) {
  if (kind === 'requested') {
    return (
      <span className="text-xx-500 font-medium">
        Requested{count > 0 ? ` · ${count}` : ''}
      </span>
    );
  }
  return <span className="text-ink-300">Unrequested</span>;
}

function shortenHex(hex: string): string {
  if (hex.length <= 18) return hex;
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}
