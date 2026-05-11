import { useState, type MouseEvent } from 'react';
import { Copy, Check } from 'lucide-react';
import { shortenAddress } from '@/utils/address';
import { copyToClipboard } from '@/utils/clipboard';
import clsx from 'clsx';

interface AddressChipProps {
  address: string;
  shortened?: boolean;
  className?: string;
}

export function AddressChip({
  address,
  shortened = true,
  className,
}: AddressChipProps) {
  const [copied, setCopied] = useState(false);

  // Stop the click from bubbling to any parent that's also clickable
  // (e.g., contact rows that navigate to a details page on tap, or
  // the dashboard account-switcher button). The chip is a self-contained
  // copy-to-clipboard control — tapping it should ONLY copy, never
  // trigger the surrounding row's action. We also preventDefault because
  // a chip nested inside another button is technically invalid HTML and
  // some browsers treat the inner click as activating the outer
  // form/button by default.
  const handleCopy = async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const success = await copyToClipboard(address);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={clsx(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full',
        'bg-ink-800 border border-ink-700/50',
        'active:bg-ink-700 transition-colors',
        'font-mono text-xs text-ink-200',
        className
      )}
    >
      <span>{shortened ? shortenAddress(address) : address}</span>
      {copied ? (
        <Check size={14} className="text-xx-500" strokeWidth={2.5} />
      ) : (
        <Copy size={14} className="text-ink-400" strokeWidth={1.75} />
      )}
    </button>
  );
}
