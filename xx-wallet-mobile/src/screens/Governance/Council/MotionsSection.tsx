import type { CouncilMotion } from '@/hooks';

/**
 * MotionsSection — list of live council / tech-comm motion hashes,
 * with an explanatory empty state when none are open (which is the
 * usual case on xx).
 *
 * Motion bodies (`council.voting`, `council.proposalOf`) aren't
 * fetched — in typical operation there are 0 live motions. This section
 * renders the hash list; row taps can later expand into a detail panel
 * when motions become regular.
 */
export function MotionsSection({
  title,
  motions,
  historicalCount,
}: {
  title: string;
  motions: CouncilMotion[];
  historicalCount: number;
}) {
  return (
    <section className="card space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base text-ink-100">
          {title} · {motions.length}
        </h3>
        {historicalCount > 0 && (
          <p className="text-xs text-ink-400">
            {historicalCount} historical
          </p>
        )}
      </div>
      {motions.length === 0 ? (
        <p className="text-sm text-ink-400">
          No live motions. Active motions appear here with their hash.
        </p>
      ) : (
        <ul className="space-y-1">
          {motions.map((m) => (
            <li key={m.hash} className="font-mono text-xs text-ink-200 truncate">
              {shortenHex(m.hash)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function shortenHex(hex: string): string {
  if (hex.length <= 18) return hex;
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}
