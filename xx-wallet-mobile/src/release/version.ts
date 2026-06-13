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
 *     changes when you want the sheet to fire. It now tracks the app's
 *     semver (kept in sync with package.json and the Settings → About
 *     screen) so the sheet's "v0.9.0" header matches the version users
 *     see everywhere else. Bump it when you cut a release worth a nudge.
 *   - RELEASE_NOTES wants 3–6 short bullets. This isn't a changelog
 *     (the commit log is the changelog); it's a launch nudge.
 *   - RELEASE_TAGLINE is optional — leave as empty string to skip.
 *
 * House style — keep every release looking consistent and professional.
 * The WhatsNewSheet component owns the visuals (badge, layout, button), so
 * never restyle it per release; only edit the copy below, to these rules:
 *   - TAGLINE: <=8 words, sentence case, no end punctuation required.
 *     Describe the release's THEME, not the version number (the sheet already
 *     shows "v<APP_VERSION>"). e.g. "Sharper, safer, and more accessible."
 *   - BULLETS: 3–6, each ONE sentence, sentence case, ending in a period.
 *     Benefit-first and user-facing — say what the user can now do, not what
 *     we built ("Connect a Ledger…", not "Added Ledger transport"). Keep a
 *     parallel grammatical shape across bullets; lead with the marquee item;
 *     use an em-dash to elaborate a single bullet.
 *   - TONE: plain and confident, never hype. Don't over-claim (e.g. avoid
 *     "production-ready" until it's earned). No internal/dev framing
 *     (refactors, dependency bumps, file names). Substrate terms are fine.
 */

export const APP_VERSION = '0.9.0';

/** Optional one-line subtitle rendered above the bullets. Keep <8 words. */
export const RELEASE_TAGLINE = 'Sharper, safer, and more accessible.';

/** Short, user-facing bullets. Substrate jargon is fine — foundation
 *  members and power users already speak it. */
export const RELEASE_NOTES: readonly string[] = [
  'Connect a Ledger hardware wallet and sign transactions with your keys never leaving the device.',
  'Take part in on-chain governance — vote on referenda, delegate your vote, second proposals, and follow treasury, council, and bounties.',
  'Protect your funds with an optional app lock (PIN or biometric) and two-device approval for larger balances.',
  'Clearer, more legible text across every screen, with higher-contrast labels and addresses that meet WCAG AA.',
  'Completed an independent security review with every finding resolved, ahead of a planned external audit.',
];
