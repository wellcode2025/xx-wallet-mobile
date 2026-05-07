import { useConnectionStore } from '@/store';
import clsx from 'clsx';

/**
 * Small pill showing the current RPC connection state.
 * Lives in the top bar so it's always visible.
 */
export function ConnectionBadge() {
  const status = useConnectionStore((s) => s.status);

  const config = {
    connected: { label: 'Live', color: 'bg-xx-500', pulse: false },
    connecting: { label: 'Connecting', color: 'bg-warning', pulse: true },
    disconnected: { label: 'Offline', color: 'bg-ink-500', pulse: false },
    error: { label: 'Error', color: 'bg-danger', pulse: true },
  }[status];

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-ink-800/60 border border-ink-700/50">
      <span
        className={clsx(
          'w-1.5 h-1.5 rounded-full',
          config.color,
          config.pulse && 'animate-pulse-subtle'
        )}
      />
      <span className="text-xs font-sans text-ink-300">{config.label}</span>
    </div>
  );
}
