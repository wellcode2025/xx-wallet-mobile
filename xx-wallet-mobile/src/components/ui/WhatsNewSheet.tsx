import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Sheet } from './Sheet';
import {
  APP_VERSION,
  RELEASE_NOTES,
  RELEASE_TAGLINE,
} from '@/release/version';

const LAST_SEEN_KEY = 'xx-wallet:last-seen-version';

/**
 * "What's new" sheet that fires on the first launch after a version
 * bump in src/release/version.ts.
 *
 * Mechanism:
 *   - On mount, compare APP_VERSION against the last-seen version in
 *     localStorage (LAST_SEEN_KEY).
 *   - First-ever launch (no entry in storage): silently write
 *     APP_VERSION as baseline and DON'T show the sheet. New users
 *     don't get a tour of changes they never experienced.
 *   - Matches: nothing to do.
 *   - Differs: render the sheet. On dismiss (Got it / backdrop / X),
 *     write APP_VERSION as the new baseline so it doesn't re-fire.
 *
 * Why localStorage instead of sessionStorage or in-memory: we want
 * "I already saw the v2026-05-18 notes" to survive across launches.
 * iOS PWA storage is isolated per origin and persists across reboots,
 * which is exactly what we need. The same iOS-storage caveat that
 * affects keystore portability (storage isolated from Safari) doesn't
 * matter here — the sheet just shouldn't re-fire within the installed
 * app's own context, which localStorage already handles.
 *
 * Backdrop tap dismisses (per Sheet component); explicit Got it
 * button is the obvious dismissal path. Both call the same close
 * handler, which persists the new baseline.
 */
export function WhatsNewSheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let lastSeen: string | null = null;
    try {
      lastSeen = localStorage.getItem(LAST_SEEN_KEY);
    } catch {
      // localStorage blocked (private browsing, etc.) — can't gate
      // re-shows, can't persist. Skip entirely rather than show on
      // every launch.
      return;
    }

    if (lastSeen === null) {
      // First-ever launch: silently baseline so we don't tour a new
      // user through "what's new" relative to a build they never used.
      try {
        localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);
      } catch {
        // Write blocked — accept the trade-off; sheet may fire on a
        // future non-private session. Not catastrophic.
      }
      return;
    }

    if (lastSeen !== APP_VERSION) {
      setOpen(true);
    }
  }, []);

  const close = () => {
    try {
      localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);
    } catch {
      // Persist failed — close anyway; sheet will re-fire next launch.
      // Acceptable degradation.
    }
    setOpen(false);
  };

  // If there are no notes (unusual but possible if someone bumps the
  // version without adding bullets), don't show an empty sheet — just
  // silently baseline.
  useEffect(() => {
    if (open && RELEASE_NOTES.length === 0) {
      close();
    }
     
  }, [open]);

  return (
    <Sheet open={open} onClose={close}>
      <div className="flex flex-col items-center text-center py-2 space-y-4">
        <div className="w-14 h-14 rounded-full bg-xx-500/10 border border-xx-500/40 flex items-center justify-center">
          <Sparkles size={28} className="text-xx-500" strokeWidth={1.75} />
        </div>

        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Just updated · v{APP_VERSION}
          </p>
          <h2 className="font-display font-semibold text-xl text-ink-100">
            What's new
          </h2>
          {RELEASE_TAGLINE && (
            <p className="text-sm text-ink-300 leading-relaxed pt-1">
              {RELEASE_TAGLINE}
            </p>
          )}
        </div>

        <ul className="w-full space-y-3 text-left pt-2">
          {RELEASE_NOTES.map((note, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 text-sm text-ink-200 leading-relaxed"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-xx-500 flex-shrink-0 mt-2" />
              <span>{note}</span>
            </li>
          ))}
        </ul>

        <button onClick={close} className="btn-primary w-full mt-2">
          Got it
        </button>
      </div>
    </Sheet>
  );
}
