/**
 * LoadingIndicator — small indeterminate progress bar + descriptive
 * label, shown at the top of a loading state.
 *
 * Pairs with the existing layout-preserving skeleton cards. The
 * skeleton shows users *that* the page is loading by reserving space;
 * this component tells them *what's* loading and that the wait is
 * normal — so the screen doesn't read as frozen during the ~1-3
 * seconds of bulk chain reads.
 */

import clsx from 'clsx';

interface LoadingIndicatorProps {
  /** Descriptive label shown below the bar. */
  message?: string;
  className?: string;
}

export function LoadingIndicator({
  message,
  className,
}: LoadingIndicatorProps) {
  return (
    <div className={clsx('space-y-2', className)}>
      <div
        className="h-1 w-full bg-ink-800 rounded-full overflow-hidden"
        role="progressbar"
        aria-busy="true"
        aria-label={message ?? 'Loading'}
      >
        <div className="h-full w-1/4 bg-xx-500 rounded-full animate-progress-slide" />
      </div>
      {message && <p className="text-xs text-ink-300">{message}</p>}
    </div>
  );
}
