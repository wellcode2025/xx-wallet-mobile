/**
 * Release-notes source of truth — edit this file as part of any commit
 * whose changes you want surfaced to installed-PWA users.
 *
 * How it's used:
 *   - WhatsNewSheet compares APP_VERSION against the last-seen value
 *     in localStorage. On first launch where they differ, it renders
 *     the sheet with RELEASE_TAGLINE and RELEASE_NOTES, then writes
 *     APP_VERSION as the new baseline.
 *   - UpdateBanner is independent of this file — it fires whenever the
 *     PWA service worker reports a new build is waiting. The banner
 *     reloads, the new bundle activates, and on the first paint of
 *     that new bundle this file's APP_VERSION is what gates the sheet.
 *
 * Workflow guidance:
 *   - Bump APP_VERSION only for changes a user would feel — UX, new
 *     screens, bug fixes that unblock something, security-relevant
 *     defaults. Don't bump for refactors, doc passes, dependency
 *     upgrades, or other invisible work; that produces notification
 *     fatigue and trains users to dismiss the sheet without reading.
 *   - APP_VERSION's only requirement is that it's a string that
 *     changes when you want the sheet to fire. The date-stamp format
 *     below sorts naturally by commit chronology; append `-b`, `-c`,
 *     etc. for multiple flagged builds in one day.
 *   - RELEASE_NOTES wants 3–6 short bullets. This isn't a changelog
 *     (the commit log is the changelog); it's a launch nudge.
 *   - RELEASE_TAGLINE is optional — leave as empty string to skip.
 */

export const APP_VERSION = '2026-05-18';

/** Optional one-line subtitle rendered above the bullets. Keep <8 words. */
export const RELEASE_TAGLINE = 'Smoother daily flows';

/** Short, user-facing bullets. Substrate jargon is fine — foundation
 *  members and power users already speak it. */
export const RELEASE_NOTES: readonly string[] = [
  'Account switcher in the Dashboard now opens for single-account wallets, shows balance per row, and offers Add account and Contacts shortcuts.',
  'Multisig approvals accept a bytes-package file or QR code from the proposer — no more pasting raw hex.',
  'Wallet import now refuses misformatted JSON files (including multisig configs) with a helpful message.',
  'New: this update banner. When a fresh build is deployed, your wallet will offer to apply it directly instead of leaving you stuck on the old version.',
];
