import { useEffect, useState } from 'react';
import { AlertTriangle, Share, X } from 'lucide-react';

/**
 * iOS Safari install banner — Phase D of the native-app-feel polish.
 *
 * Why this exists: Android Chrome auto-prompts users to install PWAs;
 * iOS Safari does not. Users have to manually tap Share → Add to Home
 * Screen and most don't know to. Without a nudge the install path is
 * effectively invisible.
 *
 * Shows when ALL of:
 *   - The browser is iOS Safari specifically (not Chrome/Firefox/Edge
 *     on iOS — those use WebKit but can't install PWAs at all).
 *   - The app is NOT already running standalone (display-mode standalone
 *     or navigator.standalone === true).
 *   - The user hasn't previously dismissed this banner (localStorage
 *     flag — shown one time).
 *
 * Includes a heads-up about iOS's storage isolation: the installed PWA
 * has a separate storage bucket from Safari, so any accounts created in
 * the Safari session won't appear in the installed app. Users should
 * export the keystore before installing and import after.
 *
 * Mounted at the top level in App.tsx so it's visible whether the user
 * is in onboarding or in the main app — first-visit users are often in
 * onboarding and they're exactly the audience that needs the storage
 * heads-up.
 */

const DISMISSED_KEY = 'xx-wallet:ios-install-banner-dismissed';

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  if (!isIos) return false;
  // Other iOS browsers: Chrome (CriOS), Firefox (FxiOS), Edge (EdgiOS),
  // Opera (OPiOS). All use WebKit under the hood but none can install
  // PWAs — that's Safari-only. Filter them out so we don't show the
  // banner to users who can't actually act on it.
  const isOtherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return !isOtherIosBrowser;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS-specific. Type-cast because navigator.standalone is non-standard
  // and missing from the lib.dom types.
  if ((window.navigator as unknown as { standalone?: boolean }).standalone === true)
    return true;
  return false;
}

export function IOSInstallBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isIosSafari()) return;
    if (isStandalone()) return;
    try {
      if (localStorage.getItem(DISMISSED_KEY) === 'true') return;
    } catch {
      // localStorage may be blocked — show the banner anyway; worst
      // case is the user dismisses again on the next visit.
    }
    setShow(true);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // If localStorage is blocked, hiding for the session is the
      // best we can do.
    }
    setShow(false);
  };

  if (!show) return null;

  return (
    <div
      // Top-anchored banner — matches iOS's native smart-app-banner
      // pattern, and avoids overlapping the Welcome screen's
      // 'Create new wallet' / 'Import existing wallet' CTAs which sit
      // at the bottom of OnboardingLayout. Padding respects the iPhone
      // notch / dynamic island via env(safe-area-inset-top).
      className="fixed inset-x-0 top-0 z-40 px-4 animate-fade-in"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 12px)',
      }}
    >
      <div className="card border border-xx-500/40 bg-ink-900/95 backdrop-blur-md shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 space-y-2">
            <p className="font-display font-medium text-sm text-ink-100">
              Install xx Wallet
            </p>
            <p className="text-xs text-ink-300">
              Add to your home screen for the full experience: works offline,
              launches instantly, no Safari chrome.
            </p>
            <ol className="space-y-1.5 mt-1">
              <li className="flex items-center gap-2 text-xs text-ink-200">
                <span className="w-5 h-5 rounded-full bg-xx-500/15 text-xx-500 text-xs font-mono flex items-center justify-center flex-shrink-0">
                  1
                </span>
                <span className="flex items-center gap-1.5">
                  Tap the
                  <Share
                    size={12}
                    strokeWidth={2}
                    className="text-xx-500 flex-shrink-0"
                  />
                  Share button in Safari's bar
                </span>
              </li>
              <li className="flex items-center gap-2 text-xs text-ink-200">
                <span className="w-5 h-5 rounded-full bg-xx-500/15 text-xx-500 text-xs font-mono flex items-center justify-center flex-shrink-0">
                  2
                </span>
                <span>Tap "Add to Home Screen"</span>
              </li>
            </ol>
            <div className="flex items-start gap-2 pt-2 border-t border-ink-800/60">
              <AlertTriangle
                size={12}
                strokeWidth={2}
                className="text-warning flex-shrink-0 mt-0.5"
              />
              <p className="text-xs text-ink-400">
                Installing creates separate storage from Safari. If you've
                already made accounts here, export the keystore from Settings
                first, then import after install.
              </p>
            </div>
          </div>
          <button
            onClick={dismiss}
            className="text-ink-400 active:text-ink-300 flex-shrink-0 -mt-1 -mr-1 p-1"
            aria-label="Dismiss install banner"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
