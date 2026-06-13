import { Crown } from 'lucide-react';
import type { BN } from '@polkadot/util';
import { AddressIcon } from '@/components/ui';
import { displayName, useIdentity } from '@/governance';
import { formatBalance } from '@/utils';

/**
 * MemberRow — one row in the council / runners-up / tech-comm lists.
 *
 * Renders:
 *   - AddressIcon (32px polkadot identicon)
 *   - Identity-resolved display name with truncated SS58 below
 *     (name MUST be paired with SS58, so a name can never hide the
 *     real address)
 *   - Prime crown badge if this member is the council/committee prime
 *   - Backing stake on the right (council members + runners-up have
 *     this; tech-comm members don't)
 *
 * No tap-through — clicking a member is a no-op.
 */
export function MemberRow({
  address,
  isPrime,
  stake,
}: {
  address: string;
  isPrime?: boolean;
  stake?: BN | null;
}) {
  const { identity } = useIdentity(address);
  const name = displayName(identity, address);
  return (
    <li className="flex items-center gap-3 py-2.5">
      <AddressIcon address={address} size={32} copyOnTap={false} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm text-ink-100 truncate">{name.primary}</p>
          {isPrime && (
            <span
              className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-medium bg-xx-500/10 text-xx-500 border border-xx-500/30"
              title="Prime member — default vote when others don't vote"
            >
              <Crown size={10} strokeWidth={2} />
              Prime
            </span>
          )}
        </div>
        {name.secondary && (
          <p className="text-xs text-ink-300 font-mono truncate">
            {name.secondary}
          </p>
        )}
      </div>
      {stake != null && (
        <div className="text-right shrink-0 pl-1">
          <p className="font-mono text-xs text-ink-200 numeric whitespace-nowrap">
            {formatBalance(stake, {
              decimals: 0,
              trim: true,
              grouping: true,
            })}{' '}
            <span className="text-ink-300">XX</span>
          </p>
          <p className="text-xs text-ink-300">backing</p>
        </div>
      )}
    </li>
  );
}
