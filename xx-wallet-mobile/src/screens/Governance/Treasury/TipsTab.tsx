import { AddressIcon } from '@/components/ui';
import { displayName, useIdentity, blocksToHuman } from '@/governance';
import { useConnectionStore } from '@/store';
import { formatBalance } from '@/utils';
import type { TipEntry, useTips } from '@/hooks';

type TipsResult = ReturnType<typeof useTips>;

/**
 * TipsTab — small-grant tips reported via treasury.reportAwesome.
 *
 * Each tip row shows:
 *   - Who's being tipped (identity-resolved)
 *   - Who reported it (identity-resolved)
 *   - Number of council endorsers + sum of their tip values
 *   - Countdown to payout once threshold is crossed
 *
 * On xx there are 0 active tips at observation — the typical state.
 * This tab is mostly empty-state copy + a short explanation of the
 * tipCountdown / finder's-fee mechanics so users understand what
 * would appear here.
 */
export function TipsTab({ tips }: { tips: TipsResult }) {
  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <h2 className="font-display text-base text-ink-100">
          Active tips · {tips.tips.length}
        </h2>
        {tips.tips.length === 0 ? (
          <p className="text-sm text-ink-400">
            No active tips. Anyone can call treasury.reportAwesome to
            propose a tip for a contributor; council members then endorse
            with a tip amount, and after enough endorsements the median
            tip pays out from the treasury.
          </p>
        ) : (
          <ul className="divide-y divide-ink-800/60">
            {tips.tips.map((t) => (
              <TipRow key={t.hash} tip={t} />
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-2">
        <h2 className="font-display text-base text-ink-100">Parameters</h2>
        <ul className="space-y-1 text-sm text-ink-300">
          <li>
            Countdown after threshold:{' '}
            <span className="font-mono text-ink-200">
              {tips.tipCountdown.toLocaleString()} blocks
            </span>
          </li>
          <li>
            Finder's fee:{' '}
            <span className="font-mono text-ink-200">
              {tips.findersFeePercent}%
            </span>
          </li>
          {tips.reportDepositBase && (
            <li>
              Report deposit base:{' '}
              <span className="font-mono text-ink-200">
                {formatBalance(tips.reportDepositBase, {
                  decimals: 4,
                  trim: true,
                  grouping: true,
                })}{' '}
                XX
              </span>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

function TipRow({ tip }: { tip: TipEntry }) {
  const whoId = useIdentity(tip.who);
  const finderId = useIdentity(tip.finder);
  const whoName = displayName(whoId.identity, tip.who);
  const finderName = displayName(finderId.identity, tip.finder);
  const blockNumber = useConnectionStore((s) => s.blockNumber);

  const closesIn =
    tip.closesAt != null
      ? blocksToHuman(blockNumber, tip.closesAt)
      : null;

  return (
    <li className="py-3 space-y-2">
      <div className="flex items-center gap-2">
        <AddressIcon address={tip.who} size={28} copyOnTap={false} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-xs text-ink-400">Tipped</p>
          <p className="text-sm text-ink-100 truncate">{whoName.primary}</p>
          {whoName.secondary && (
            <p className="text-xs text-ink-500 font-mono truncate">
              {whoName.secondary}
            </p>
          )}
        </div>
      </div>
      <p className="text-xs text-ink-400">
        Finder:{' '}
        <span className="text-ink-300">{finderName.primary}</span>
        {finderName.secondary && (
          <span className="text-ink-500 font-mono ml-1">
            {finderName.secondary}
          </span>
        )}
      </p>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs text-ink-400">
          {tip.endorserCount} endorser{tip.endorserCount === 1 ? '' : 's'}
        </p>
        {tip.endorsementSum && (
          <p className="font-mono text-xs text-ink-200">
            sum{' '}
            {formatBalance(tip.endorsementSum, {
              decimals: 4,
              trim: true,
              grouping: true,
            })}{' '}
            XX
          </p>
        )}
      </div>
      {closesIn && (
        <p className="text-xs text-ink-400">
          {closesIn.isOverdue
            ? 'Ready to close'
            : `Closes in ${closesIn.label}`}
        </p>
      )}
    </li>
  );
}
