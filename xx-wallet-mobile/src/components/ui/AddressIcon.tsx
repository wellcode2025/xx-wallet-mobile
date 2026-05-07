import Identicon from '@polkadot/react-identicon';

interface AddressIconProps {
  address: string;
  size?: number;
}

/**
 * The visual identicon for an xx address. Uses @polkadot/react-identicon
 * which produces the same avatars as the existing wallet — good for
 * recognition when users switch between the two.
 */
export function AddressIcon({ address, size = 40 }: AddressIconProps) {
  return (
    <div className="rounded-full overflow-hidden ring-1 ring-ink-700/50">
      <Identicon value={address} size={size} theme="polkadot" />
    </div>
  );
}
