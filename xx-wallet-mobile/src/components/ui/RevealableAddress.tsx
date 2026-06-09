/**
 * RevealableAddress — a truncated address with an eye toggle to reveal the
 * full string inline. Pairs with the tap-the-identicon-to-copy affordance:
 * copy lives on the icon, reveal lives here.
 *
 * The toggle is a clickable span (not a <button>) with stopPropagation, so
 * it can live inside a row that is itself a button (account switcher rows,
 * settings rows) without nesting interactive <button> elements — the same
 * pattern AddressIcon uses for its copy tap.
 *
 * Why reveal matters: truncation hides the middle of the address, which is
 * exactly the part address-poisoning lookalikes manipulate. Letting users
 * expand to the full string on demand is a verification affordance, not
 * just convenience.
 */

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import clsx from 'clsx';
import { shortenAddress } from '@/utils';

export function RevealableAddress({
  address,
  start = 10,
  end = 6,
  className,
}: {
  address: string;
  start?: number;
  end?: number;
  className?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const toggle = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    setRevealed((r) => !r);
  };
  return (
    <span className={clsx('inline-flex items-start gap-1.5 min-w-0', className)}>
      <span
        className={clsx(
          'font-mono text-xs text-ink-400 leading-snug',
          revealed ? 'break-all' : 'truncate'
        )}
      >
        {revealed ? address : shortenAddress(address, { start, end })}
      </span>
      <span
        role="button"
        tabIndex={0}
        aria-label={revealed ? 'Hide full address' : 'Reveal full address'}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') toggle(e);
        }}
        className="flex-shrink-0 text-ink-400 active:text-ink-200 cursor-pointer mt-px"
      >
        {revealed ? (
          <EyeOff size={13} strokeWidth={2} />
        ) : (
          <Eye size={13} strokeWidth={2} />
        )}
      </span>
    </span>
  );
}
