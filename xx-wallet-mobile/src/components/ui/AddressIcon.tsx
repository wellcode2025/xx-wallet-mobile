import { useState, type MouseEvent } from 'react';
import Identicon from '@polkadot/react-identicon';
import { Check } from 'lucide-react';
import { copyToClipboard } from '@/utils/clipboard';
import clsx from 'clsx';

interface AddressIconProps {
  address: string;
  size?: number;
  /**
   * When true (default), tapping the icon copies the address to clipboard
   * AND prevents the click from bubbling to any clickable parent row
   * (account-switcher, contact details, etc.). Tap-to-copy is the
   * established mental model for these chips/icons across the wallet.
   *
   * Set false when the icon is purely decorative and the surrounding
   * area's click should always pass through (rare — most placements
   * benefit from copy-on-tap).
   */
  copyOnTap?: boolean;
}

/**
 * The visual identicon for an xx address. Uses @polkadot/react-identicon
 * which produces the same avatars as the existing wallet — good for
 * recognition when users switch between the two.
 *
 * Tap-to-copy behavior: by default tapping the identicon copies the
 * address and stops the click from triggering any parent row's
 * navigation. Without that containment, tapping the identicon inside a
 * contact row (or the dashboard's account-switcher) would dump the user
 * into the details / picker screen instead of just copying — surprising
 * UX. The polkadot Identicon's own internal click handling (if any in
 * the installed version) still runs alongside this, harmlessly.
 */
export function AddressIcon({
  address,
  size = 40,
  copyOnTap = true,
}: AddressIconProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = async (e: MouseEvent<HTMLDivElement>) => {
    if (!copyOnTap) return;
    e.stopPropagation();
    e.preventDefault();
    const success = await copyToClipboard(address);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div
      onClick={handleClick}
      role={copyOnTap ? 'button' : undefined}
      aria-label={copyOnTap ? `Copy ${address}` : undefined}
      tabIndex={copyOnTap ? 0 : undefined}
      // Pin the wrapper to an explicit size so the overlay can match it
      // exactly via inset-0. Without this, @polkadot/react-identicon's
      // own inline padding can leave the wrapper a few pixels off and
      // the copied-confirmation overlay either under-covers the icon or
      // gets clipped on the bottom edge.
      style={{ width: size, height: size }}
      className={clsx(
        'relative inline-block rounded-full overflow-hidden ring-1 ring-ink-700/50 align-middle',
        copyOnTap && 'cursor-pointer'
      )}
    >
      <Identicon value={address} size={size} theme="polkadot" />
      {/* Brief overlay confirmation when the address is copied — same
          1.5s feedback duration the AddressChip uses, so the wallet
          feels consistent across both surfaces. inset-0 + rounded-full
          guarantees a clean circle exactly matching the wrapper, even
          if the parent layout context is flex / grid / inline-flex. */}
      {copied && (
        <div className="absolute inset-0 flex items-center justify-center bg-xx-500/85 text-ink-950 rounded-full">
          <Check size={Math.round(size * 0.5)} strokeWidth={2.5} />
        </div>
      )}
    </div>
  );
}
