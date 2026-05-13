/**
 * AddressLabel — display an xx address as "Name [6XXX…YYY]" when the
 * address is known (own account, address book contact, or known
 * multisig), or as just the truncated fragment when it isn't.
 *
 * Design doc §7.3 rule: never show the name alone. The address
 * fragment is always present so the user can tell at a glance what's
 * actually being signed. A typo'd contact entry or a malicious import
 * can't hide behind a familiar-looking label.
 *
 * Two visual variants:
 *   - default (inline): "Operations" [6Wwj…PojL] — fits in dense rows
 *   - stacked: name on its own line, fragment underneath in monospace
 *
 * For the no-name case both variants collapse to just rendering the
 * fragment in monospace.
 */

import clsx from 'clsx';
import { useAddressName } from '@/hooks/useAddressName';

interface AddressLabelProps {
  address: string;
  /** Stack name above fragment instead of placing them inline. Useful
   *  for prominent displays (action confirmation, share screen). */
  stacked?: boolean;
  /** Override the default text size for the name. Fragment is always
   *  monospace and one step smaller. */
  className?: string;
  /** When true, omit the name's surrounding quotes. Used in places
   *  where the formatting is already differentiated by typography. */
  unquoted?: boolean;
}

export function AddressLabel({
  address,
  stacked = false,
  className,
  unquoted = false,
}: AddressLabelProps) {
  const { name, fragment } = useAddressName(address);

  if (!name) {
    // No nickname — just render the truncated address. Monospace so
    // it's recognizable as an address.
    return (
      <span className={clsx('font-mono text-ink-300', className)}>
        {fragment}
      </span>
    );
  }

  if (stacked) {
    return (
      <span className={clsx('inline-flex flex-col leading-tight', className)}>
        <span className="font-medium text-ink-100">{name}</span>
        <span className="font-mono text-xs text-ink-400">{fragment}</span>
      </span>
    );
  }

  // Inline: "Name" [6Wwj…PojL]
  return (
    <span className={className}>
      <span className="font-medium text-ink-100">
        {unquoted ? name : `"${name}"`}
      </span>{' '}
      <span className="font-mono text-xs text-ink-400">[{fragment}]</span>
    </span>
  );
}
