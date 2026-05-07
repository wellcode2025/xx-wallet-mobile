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
 */
export function OnboardingLayout() {
  return (
    <div className="min-h-screen bg-ink-950 relative overflow-hidden">
      <div className="absolute inset-0 bg-mesh opacity-60 pointer-events-none" />
      <div className="relative z-10 min-h-screen flex flex-col">
        <Outlet />
      </div>
    </div>
  );
}
