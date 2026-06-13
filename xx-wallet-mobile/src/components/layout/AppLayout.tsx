import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav';

/**
 * Main app layout — includes the bottom nav.
 * Used for authenticated screens (Dashboard, Send, etc.).
 */
export function AppLayout() {
  return (
    <div className="min-h-screen bg-ink-950 flex flex-col">
      <main className="flex-1 pb-[calc(64px+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}

/**
 * Layout for onboarding flows — no bottom nav, full-bleed.
 *
 * Safe-area-inset padding on the inner container ensures Welcome /
 * CreateWallet / ImportWallet content doesn't clip under the iPhone
 * notch / dynamic island at the top or the iOS home indicator /
 * Android gesture bar at the bottom when running standalone.
 */
export function OnboardingLayout() {
  return (
    <div className="min-h-screen bg-ink-950 relative overflow-hidden">
      <div className="absolute inset-0 bg-mesh opacity-60 pointer-events-none" />
      <div
        role="main"
        className="relative z-10 min-h-screen flex flex-col"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <Outlet />
      </div>
    </div>
  );
}
