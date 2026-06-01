import { AddressIcon } from '@/components/ui';
import { displayName, useIdentity } from '@/governance';
import { formatBalance } from '@/utils';
import type { TreasuryProposal, useTreasury } from '@/hooks';

type TreasuryResult = ReturnType<typeof useTreasury>;

/**
 * ProposalsTab — pending + approved treasury proposals.
 *
 *   Pending — those the council hasn't decided yet. Read from
 *             treasury.proposals.entries(). Show proposer +
 *             beneficiary + value + bond.
 *   Approved — proposal IDs the council has approved, awaiting payout
 *              at the next spend tick. Read from treasury.approvals().
 *              We render the list of IDs (count + first 5 ids) — the
 *              per-id detail isn't fetched since the queue is currently
 *              0; when payouts become regular we can add the per-id
 *              detail lookup.
 *
 * Both sections render empty-state copy when the chain has none, which
 * is the typical case on xx.
 */
export function ProposalsTab({ treasury }: { treasury: TreasuryResult }) {
  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-base text-ink-100">
            Pending · {treasury.pendingProposals.length}
          </h2>
          <p className="text-xs text-ink-400">
            {treasury.proposalCountHistorical} all-time
          </p>
        </div>
        {treasury.pendingProposals.length === 0 ? (
          <p className="text-sm text-ink-400">
            No pending proposals. New proposals appear here with their
            proposer, beneficiary, and value.
          </p>
        ) : (
          <ul className="divide-y divide-ink-800/60">
            {treasury.pendingProposals.slice(0, 5).map((p) => (
              <ProposalRow key={p.id} proposal={p} />
            ))}
            {treasury.pendingProposals.length > 5 && (
              <li className="pt-2 text-xs text-ink-400">
                + {treasury.pendingProposals.length - 5} more pending
              </li>
            )}
          </ul>
        )}
      </section>

      <section className="card space-y-2">
        <h2 className="font-display text-base text-ink-100">
          Approved · {treasury.approvalsQueue.length}
        </h2>
        {treasury.approvalsQueue.length === 0 ? (
          <p className="text-sm text-ink-400">
            No proposals awaiting payout. Approved proposals queue here
            until the next spend period.
          </p>
        ) : (
          <p className="text-sm text-ink-200">
            Awaiting payout at next spend tick:{' '}
            <span className="font-mono text-ink-300">
              #{treasury.approvalsQueue.slice(0, 8).join(', #')}
              {treasury.approvalsQueue.length > 8 && ' …'}
            </span>
          </p>
        )}
      </section>
    </div>
  );
}

function ProposalRow({ proposal }: { proposal: TreasuryProposal }) {
  const proposerId = useIdentity(proposal.proposer);
  const beneficiaryId = useIdentity(proposal.beneficiary);
  const proposerName = displayName(proposerId.identity, proposal.proposer);
  const beneficiaryName = displayName(
    beneficiaryId.identity,
    proposal.beneficiary
  );

  return (
    <li className="py-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-xs text-ink-400">#{proposal.id}</p>
        <p className="font-mono text-sm text-ink-100 numeric whitespace-nowrap">
          {formatBalance(proposal.value, {
            decimals: 4,
            trim: true,
            grouping: true,
          })}{' '}
          <span className="text-ink-400">XX</span>
        </p>
      </div>

      <PersonInline role="Proposer" address={proposal.proposer} name={proposerName} />
      <PersonInline
        role="Beneficiary"
        address={proposal.beneficiary}
        name={beneficiaryName}
      />

      <p className="text-xs text-ink-400">
        Proposer bond:{' '}
        <span className="font-mono text-ink-200">
          {formatBalance(proposal.bond, {
            decimals: 4,
            trim: true,
            grouping: true,
          })}{' '}
          XX
        </span>
      </p>
    </li>
  );
}

function PersonInline({
  role,
  address,
  name,
}: {
  role: string;
  address: string;
  name: { primary: string; secondary: string };
}) {
  return (
    <div className="flex items-center gap-2">
      <AddressIcon address={address} size={24} copyOnTap={false} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-xs text-ink-400">{role}</p>
        <p className="text-sm text-ink-200 truncate">
          {name.primary}
          {name.secondary && (
            <span className="text-ink-400 font-mono ml-1.5">{name.secondary}</span>
          )}
        </p>
      </div>
    </div>
  );
}
