import type { UseCouncilResult } from './CouncilOverview';
import { MemberRow } from './MemberRow';
import { MotionsSection } from './MotionsSection';

/**
 * MembersTab — the council half of /governance/council.
 *
 * Sections, in order:
 *   - Members (13 on xx) with backing stake + prime badge
 *   - Runners-up (10 on xx) with backing stake
 *   - Candidates (currently 0) with empty-state copy
 *   - Live council motions (currently 0) with historical count
 *
 * "Backing" stake = the Phragmen-elected total amount each voter
 * placed behind this member. Rendered to the right of each row in
 * "X XX backing" form.
 */
export function MembersTab({ council }: { council: UseCouncilResult }) {
  return (
    <div className="space-y-4">
      <section className="card space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-base text-ink-100">
            Members · {council.members.length}
          </h2>
          <p className="text-xs text-ink-400">
            {council.desiredMembers} seats
          </p>
        </div>
        {council.members.length === 0 ? (
          <p className="text-sm text-ink-400">No members on chain.</p>
        ) : (
          <ul className="divide-y divide-ink-800/60">
            {council.members.map((m) => (
              <MemberRow
                key={m.address}
                address={m.address}
                isPrime={m.isPrime}
                stake={m.stake}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-base text-ink-100">
            Runners-up · {council.runnersUp.length}
          </h2>
          <p className="text-xs text-ink-400">
            {council.desiredRunnersUp} slots
          </p>
        </div>
        {council.runnersUp.length === 0 ? (
          <p className="text-sm text-ink-400">No runners-up on chain.</p>
        ) : (
          <ul className="divide-y divide-ink-800/60">
            {council.runnersUp.map((r) => (
              <MemberRow key={r.address} address={r.address} stake={r.stake} />
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-2">
        <h2 className="font-display text-base text-ink-100">
          Candidates · {council.candidates.length}
        </h2>
        {council.candidates.length === 0 ? (
          <p className="text-sm text-ink-400">
            No candidates have submitted for the next election. Anyone
            with the candidacy bond can put themselves forward.
          </p>
        ) : (
          <ul className="divide-y divide-ink-800/60">
            {council.candidates.map((c) => (
              <MemberRow key={c.address} address={c.address} stake={c.stake} />
            ))}
          </ul>
        )}
      </section>

      <MotionsSection
        title="Live motions"
        motions={council.councilMotions}
        historicalCount={council.councilProposalCount}
      />
    </div>
  );
}
