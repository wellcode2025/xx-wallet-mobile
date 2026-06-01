import { Link } from 'react-router-dom';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { formatBalance } from '@/utils';
import { displayName, useIdentity, blocksToHuman } from '@/governance';
import { useConnectionStore } from '@/store';
import type {
  ExternalProposal,
  OngoingReferendum,
  PublicProposal,
  useDemocracy,
} from '@/hooks';

type DemocracyResult = ReturnType<typeof useDemocracy>;

const EXPLORER_DEMOCRACY_URL =
  'https://explorer.xx.network/governance/democracy';

/**
 * Renders the three Gov1 democracy streams in stacked sections:
 *
 *   Referenda  — currently-ongoing referenda, with end-block countdown
 *                and tally. Tap-through deferred until there's something
 *                to drill into (currently 0 active on xx).
 *   Proposals  — open public proposals awaiting referendum launch.
 *                Each shows depositor (identity-resolved) and the
 *                preimage hash being proposed.
 *   External   — any external proposal queued by council. Single-slot
 *                queue, displayed only when populated.
 *
 * Empty sections render copy explaining what would appear there. Per
 * the trust-model invariants, the preimage hash is the truthful
 * identifier — proposer-supplied titles aren't on the chain for Gov1
 * referenda, so titles aren't shown at all (the official web wallet
 * doesn't either).
 */
export function OverviewTab({ democracy }: { democracy: DemocracyResult }) {
  return (
    <div className="space-y-4">
      <ReferendaSection
        ongoing={democracy.ongoing}
        scanCapHit={democracy.scanCapHit}
        total={democracy.referendumCount}
      />
      <ProposalsSection
        proposals={democracy.publicProposals}
        total={democracy.publicPropCount}
      />
      <ExternalSection external={democracy.externalProposal} />

      <a
        href={EXPLORER_DEMOCRACY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-ink-300 active:text-xx-500 transition-colors"
      >
        Open democracy history on explorer.xx.network
        <ExternalLink size={14} strokeWidth={1.75} />
      </a>
    </div>
  );
}

function ReferendaSection({
  ongoing,
  scanCapHit,
  total,
}: {
  ongoing: OngoingReferendum[];
  scanCapHit: boolean;
  total: number;
}) {
  return (
    <section className="card space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base text-ink-100">
          Referenda · {ongoing.length}
        </h2>
        <p className="text-xs text-ink-400">{total} all-time</p>
      </div>
      {ongoing.length === 0 ? (
        <p className="text-sm text-ink-400">
          No active referenda. Active ones appear here with their tally
          and end block.
        </p>
      ) : (
        <ul className="space-y-3">
          {ongoing.slice(0, 5).map((r) => (
            <ReferendumRow key={r.id} ref_={r} />
          ))}
          {ongoing.length > 5 && (
            <li className="text-xs text-ink-400">
              + {ongoing.length - 5} more active
            </li>
          )}
        </ul>
      )}
      {scanCapHit && (
        <p className="text-xs text-warning">
          Scan limit reached — some referenda may not be shown. Open the
          explorer for the complete list.
        </p>
      )}
    </section>
  );
}

function ReferendumRow({ ref_ }: { ref_: OngoingReferendum }) {
  const blockNumber = useConnectionStore((s) => s.blockNumber);
  const end = blocksToHuman(blockNumber, ref_.end);
  return (
    <li className="border-b border-ink-800/60 last:border-0">
      <Link
        to={`/governance/democracy/${ref_.id}`}
        className="block py-3 -mx-3 px-3 rounded-xl active:bg-ink-800/40 transition-colors"
      >
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <p className="text-sm text-ink-100 font-medium">#{ref_.id}</p>
            <ChevronRight
              size={14}
              strokeWidth={1.75}
              className="text-ink-400"
            />
          </div>
          <p className="text-xs text-ink-400">{ref_.threshold}</p>
        </div>
        {ref_.proposalHash && (
          <p className="mt-1 font-mono text-xs text-ink-400 truncate">
            {shortenHex(ref_.proposalHash)}
          </p>
        )}
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <TallyCell label="Ayes" amount={ref_.tally.ayes} />
          <TallyCell label="Nays" amount={ref_.tally.nays} />
          <TallyCell label="Turnout" amount={ref_.tally.turnout} />
        </div>
        <p className="mt-2 text-xs text-ink-400">
          Ends in <span className="text-ink-200">{end.label}</span>
          <span className="text-ink-500"> (block #{ref_.end.toLocaleString()})</span>
        </p>
      </Link>
    </li>
  );
}

function TallyCell({
  label,
  amount,
}: {
  label: string;
  amount: import('@polkadot/util').BN;
}) {
  return (
    <div>
      <p className="text-ink-400">{label}</p>
      <p className="font-mono text-ink-200 numeric truncate">
        {formatBalance(amount, {
          decimals: 0,
          trim: true,
          grouping: true,
        })}
        <span className="text-ink-500"> XX</span>
      </p>
    </div>
  );
}

function ProposalsSection({
  proposals,
  total,
}: {
  proposals: PublicProposal[];
  total: number;
}) {
  return (
    <section className="card space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base text-ink-100">
          Proposals · {proposals.length}
        </h2>
        <p className="text-xs text-ink-400">{total} all-time</p>
      </div>
      {proposals.length === 0 ? (
        <p className="text-sm text-ink-400">
          No open public proposals. Anyone can propose by submitting a
          preimage and depositing the minimum bond.
        </p>
      ) : (
        <ul className="space-y-2">
          {proposals.slice(0, 5).map((p) => (
            <ProposalRow key={p.id} proposal={p} />
          ))}
          {proposals.length > 5 && (
            <li className="text-xs text-ink-400">
              + {proposals.length - 5} more open
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function ProposalRow({ proposal }: { proposal: PublicProposal }) {
  const { identity } = useIdentity(proposal.depositor);
  const name = displayName(identity, proposal.depositor);
  return (
    <li className="border-b border-ink-800/60 last:border-0 pb-2 last:pb-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-ink-100">#{proposal.id}</p>
        <p className="text-xs text-ink-400 truncate">
          Depositor: <span className="text-ink-300">{name.primary}</span>
        </p>
      </div>
      {proposal.proposalHash && (
        <p className="mt-1 font-mono text-xs text-ink-400 truncate">
          {shortenHex(proposal.proposalHash)}
        </p>
      )}
    </li>
  );
}

function ExternalSection({ external }: { external: ExternalProposal | null }) {
  return (
    <section className="card space-y-2">
      <h2 className="font-display text-base text-ink-100">External</h2>
      {!external ? (
        <p className="text-sm text-ink-400">
          No external proposal queued. Council can route a referendum
          here when they want to bypass the public proposal queue.
        </p>
      ) : (
        <div>
          <p className="text-xs text-ink-400">{external.threshold}</p>
          {external.proposalHash && (
            <p className="mt-1 font-mono text-xs text-ink-200 truncate">
              {shortenHex(external.proposalHash)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function shortenHex(hex: string): string {
  if (hex.length <= 16) return hex;
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}
