import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, RefreshCw, XCircle } from 'lucide-react';
import { shortenAddress } from '@/utils';
import { planckToHuman, type Transfer } from '@/hooks/useTransfers';
import { XX_SYMBOL } from '@/api';
import clsx from 'clsx';

interface TransactionItemProps {
  transfer: Transfer;
}

export function TransactionItem({ transfer }: TransactionItemProps) {
  const { direction, from, to, amount, success, timestamp, blockNumber, id } =
    transfer;

  const counterparty = direction === 'out' ? to : from;
  const humanAmount = planckToHuman(amount);

  const config = {
    in: {
      icon: ArrowDownLeft,
      label: 'Received',
      color: 'text-xx-500',
      bgColor: 'bg-xx-500/10',
      prefix: '+',
    },
    out: {
      icon: ArrowUpRight,
      label: 'Sent',
      color: 'text-ink-300',
      bgColor: 'bg-ink-700/40',
      prefix: '-',
    },
    self: {
      icon: RefreshCw,
      label: 'Self',
      color: 'text-ink-400',
      bgColor: 'bg-ink-700/40',
      prefix: '',
    },
  }[direction];

  const Icon = config.icon;

  const timeStr = timestamp
    ? new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : `#${blockNumber}`;

  return (
    <Link
      to={`/tx/${id}`}
      state={{ transfer }}
      aria-label={`${success ? config.label : 'Failed'} ${humanAmount} ${XX_SYMBOL}`}
      className={clsx(
        'flex items-center gap-3 py-3 -mx-1 px-1 rounded-lg',
        'border-b border-ink-800/60 last:border-0',
        'active:bg-ink-800/40 transition-colors min-h-[52px]'
      )}
    >
      {/* Icon */}
      <div
        className={clsx(
          'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
          config.bgColor
        )}
      >
        {success ? (
          <Icon size={16} className={config.color} strokeWidth={2} />
        ) : (
          <XCircle size={16} className="text-danger" strokeWidth={2} />
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink-100">
            {success ? config.label : 'Failed'}
          </span>
          <span
            className={clsx(
              'font-mono text-sm font-medium flex-shrink-0',
              success ? config.color : 'text-ink-400 line-through'
            )}
          >
            {config.prefix}
            {humanAmount} {XX_SYMBOL}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className="font-mono text-xs text-ink-400 truncate">
            {direction === 'self'
              ? 'Self transfer'
              : shortenAddress(counterparty, { start: 6, end: 4 })}
          </span>
          <span className="text-xs text-ink-400 flex-shrink-0">{timeStr}</span>
        </div>
      </div>
    </Link>
  );
}
