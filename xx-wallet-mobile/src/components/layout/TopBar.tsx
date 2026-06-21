import { ChevronLeft, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ConnectionBadge } from '../ui/ConnectionBadge';

interface TopBarProps {
  title?: string;
  showBack?: boolean;
  showConnection?: boolean;
  /** Render a gear in the top corner that opens Settings (tab-root screens). */
  showSettings?: boolean;
  right?: React.ReactNode;
}

export function TopBar({
  title,
  showBack = false,
  showConnection = true,
  showSettings = false,
  right,
}: TopBarProps) {
  const navigate = useNavigate();

  return (
    <header
      className="sticky top-0 z-30 bg-ink-950/80 backdrop-blur-xl border-b border-ink-800/50"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex items-center justify-between h-14 px-4">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {showBack ? (
            <button
              onClick={() => navigate(-1)}
              className="-ml-2 p-2 rounded-full active:bg-ink-800 transition-colors"
              aria-label="Back"
            >
              <ChevronLeft size={24} strokeWidth={1.75} />
            </button>
          ) : (
            <img
              src="/brand/icon-color.svg"
              alt=""
              className="w-7 h-7 -ml-1"
              draggable={false}
            />
          )}
          {title && (
            <h1 className="font-display font-medium text-lg tracking-tight truncate">
              {title}
            </h1>
          )}
        </div>

        <div className="flex items-center gap-2">
          {showConnection && <ConnectionBadge />}
          {right}
          {showSettings && (
            <button
              onClick={() => navigate('/settings')}
              className="-mr-1 p-2 rounded-full active:bg-ink-800 transition-colors"
              aria-label="Settings"
            >
              <Settings size={20} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
