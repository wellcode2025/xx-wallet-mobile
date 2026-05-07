import { useEffect } from 'react';
import { X } from 'lucide-react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

/**
 * Bottom-anchored modal sheet — the native mobile pattern for secondary flows.
 * Slides up from below, dismissed by tap on backdrop or the X button.
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <button
        onClick={onClose}
        className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm animate-fade-in"
        aria-label="Close"
      />

      {/* Sheet */}
      <div
        className="relative bg-ink-900 rounded-t-3xl border-t border-ink-700/50 animate-slide-up max-h-[90vh] overflow-y-auto"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-ink-600" />
        </div>

        {title && (
          <div className="flex items-center justify-between px-5 py-3">
            <h2 className="font-display font-medium text-lg">{title}</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full active:bg-ink-800"
              aria-label="Close"
            >
              <X size={20} strokeWidth={1.75} />
            </button>
          </div>
        )}

        <div className="px-5 pb-6">{children}</div>
      </div>
    </div>
  );
}
