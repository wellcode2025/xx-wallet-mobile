import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';

/**
 * Service-worker update banner. Mounted at the top level alongside
 * IOSInstallBanner.
 *
 * Why this exists: vite.config.ts configures vite-plugin-pwa with
 * `registerType: 'prompt'`, which means a new SW downloads in the
 * background after a deploy but stays in *waiting* state — the old SW
 * keeps serving the old precached bundle until something tells the
 * new one to take over. On installed iOS PWAs, that "something" is
 * effectively impossible to trigger naturally: there's no reload
 * button, backgrounding/foregrounding doesn't release the SW client,
 * and the only way to get the new version is to force-quit the PWA
 * from the iOS app switcher. Users don't know to do that.
 *
 * This banner closes the loop: useRegisterSW from vite-plugin-pwa
 * fires `needRefresh` when the new SW is waiting, we render a tap-to-
 * apply prompt at the top of the screen, and on tap we call
 * `updateServiceWorker(true)` which does skipWaiting + clientsClaim
 * and reloads on the new bundle. After the reload, WhatsNewSheet
 * (gated on src/release/version.ts) surfaces what shipped.
 *
 * Dismiss behaviour: session-only. If the user taps X, the banner
 * goes away but comes back on next launch. We deliberately don't
 * persist the dismissal — missing updates is more user-impacting than
 * being slightly nudgy.
 *
 * Update polling: most browsers poll for SW updates on navigation or
 * after a long period of inactivity. Mobile browsers with a
 * backgrounded tab are unreliable. We schedule an hourly registration
 * .update() to keep the banner responsive without thrashing — the
 * check itself is a 304-headed HEAD-ish request to the SW URL, so
 * it's cheap when nothing has changed.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Hourly background check. .update() returns a promise that
      // resolves whether a new SW was found or not — failures (offline,
      // network blip) are benign because the next interval will retry.
      setInterval(
        () => {
          registration.update().catch(() => {
            /* swallow — retry on next tick */
          });
        },
        60 * 60 * 1000
      );
    },
  });

  const [updating, setUpdating] = useState(false);

  if (!needRefresh) return null;

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      // The `true` flag means: skipWaiting + reload. The page will
      // reload as part of this call; nothing after it will run.
      await updateServiceWorker(true);
    } catch {
      // If the reload somehow doesn't fire (very rare — browser-
      // specific edge cases), clear the spinner so the user can
      // retry rather than stare at it forever.
      setUpdating(false);
    }
  };

  return (
    <div
      // Top-anchored, same layer as IOSInstallBanner. In practice the
      // two never overlap: IOSInstallBanner only shows on pre-install
      // Safari sessions, and UpdateBanner only shows after the wallet
      // is installed and a new SW has registered. Safe-area padding
      // matches IOSInstallBanner for visual consistency.
      className="fixed inset-x-0 top-0 z-40 px-4 animate-fade-in"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}
    >
      <div className="card border border-xx-500/40 bg-ink-900/95 backdrop-blur-md shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-xx-500/15 flex items-center justify-center flex-shrink-0">
            <RefreshCw
              size={18}
              strokeWidth={2}
              className={
                updating ? 'text-xx-500 animate-spin' : 'text-xx-500'
              }
            />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div>
              <p className="font-display font-medium text-sm text-ink-100">
                Update available
              </p>
              <p className="text-xs text-ink-300 mt-0.5 leading-relaxed">
                A new version of xx Wallet is ready. Apply it now to
                see the latest changes.
              </p>
            </div>
            <button
              onClick={handleUpdate}
              disabled={updating}
              className="btn-primary text-xs py-2 px-3 w-auto"
            >
              <RefreshCw
                size={12}
                strokeWidth={2}
                className={updating ? 'animate-spin' : ''}
              />
              {updating ? 'Updating…' : 'Update now'}
            </button>
          </div>
          <button
            onClick={() => setNeedRefresh(false)}
            className="text-ink-400 active:text-ink-300 flex-shrink-0 -mt-1 -mr-1 p-1"
            aria-label="Dismiss update prompt"
            disabled={updating}
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
