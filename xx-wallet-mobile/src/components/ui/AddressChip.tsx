import { useState } from 'react';
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

  const handleCopy = async () => {
    const success = await copyToClipboard(address);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <button
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
