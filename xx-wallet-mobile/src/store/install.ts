/**
 * Install prompt store — captures Android Chrome's beforeinstallprompt
 * event so the wallet can surface a manual "Install xx Wallet" button
 * in Settings for users whose Chrome didn't auto-prompt.
 *
 * Background: Chrome decides whether to auto-prompt based on its own
 * engagement heuristics (PWA visited multiple times, minimum interaction
 * threshold, etc.). Power users + first-time visitors who DO want to
 * install often miss the auto-prompt entirely. The W3C
 * BeforeInstallPromptEvent gives us a way to capture and re-fire it
 * later from a button tap.
 *
 * In-memory only — the event object can't be serialised and shouldn't
 * survive a reload (Chrome re-fires beforeinstallprompt on each page
 * load if the user is still eligible).
 *
 * iOS Safari does NOT fire beforeinstallprompt; there's no native
 * install API on iOS. The iOSInstallBanner component handles the iOS
 * "tap Share → Add to Home Screen" path separately.
 */

import { create } from 'zustand';

/** W3C BeforeInstallPromptEvent — not in standard lib.dom yet. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
  /** Captured beforeinstallprompt event, ready to be fired on demand.
   *  null when not capturable (iOS, desktop, already-installed, etc.). */
  deferredPrompt: BeforeInstallPromptEvent | null;
  setDeferredPrompt: (event: BeforeInstallPromptEvent | null) => void;
}

export const useInstallStore = create<InstallState>((set) => ({
  deferredPrompt: null,
  setDeferredPrompt: (event) => set({ deferredPrompt: event }),
}));
