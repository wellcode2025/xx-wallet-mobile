import type { UseCouncilResult } from './CouncilOverview';
import { MemberRow } from './MemberRow';
import { MotionsSection } from './MotionsSection';

/**
 * CommitteeTab — the Technical Committee half of /governance/council.
 *
 * On xx the 4 tech-comm members are a strict subset of the 13 council
 * members (RICHARD CARBACK, BERNIE, KEITH, BALTASAR observed in the
 * spike). The web wallet shows them on a separate Tech. comm. page;
 * we collapse it under Council since the mobile bottom-nav has finite
 * tab space and this section is small.
 *
 * Tech-comm members don't carry backing stake (the elections pallet
 * doesn't apply here — appointments are by council motion). The row
 * therefore renders without the "X XX backing" column.
 */
export function CommitteeTab({ council }: { council: UseCouncilResult }) {
  const tc = council.techComm;
  return (
    <div className="space-y-4">
      <section className="card space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-base text-ink-100">
            Members · {tc.members.length}
          </h2>
        </div>
        {tc.members.length === 0 ? (
          <p className="text-sm text-ink-400">
            No technical committee members on chain.
          </p>
        ) : (
          <>
            <p className="text-xs text-ink-400">
              The Technical Committee is appointed by council motion.
              Members are also council members.
            </p>
            <ul className="divide-y divide-ink-800/60">
              {tc.members.map((m) => (
                <MemberRow
                  key={m.address}
                  address={m.address}
                  isPrime={m.isPrime}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      <MotionsSection
        title="Live motions"
        motions={tc.motions}
        historicalCount={tc.proposalCount}
      />
    </div>
  );
}
