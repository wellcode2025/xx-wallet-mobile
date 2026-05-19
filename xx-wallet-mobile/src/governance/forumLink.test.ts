/**
 * Tests for forumLinkExtractor.
 *
 * Coverage focuses on the trust-model invariants:
 *   - Canonical forum.xx.network links are identified correctly
 *   - Non-forum links are flagged (not refused) so the UI can show a
 *     destination-host warning
 *   - Plain-text descriptions never get parsed as if they were links
 *   - Malformed HTML falls back to plain text
 *
 * The 5 active bounty descriptions observed in the Phase 4 spike are
 * used as fixtures so we know the parser handles real on-chain data.
 */

import { describe, expect, it } from 'vitest';
import { extractForumLink, CANONICAL_FORUM_PREFIX } from './forumLink';

// All 5 live bounty descriptions from the Phase 4 spike (head #23,512,817).
const LIVE_BOUNTY_DESCRIPTIONS = [
  {
    raw: '<a href="https://forum.xx.network/t/xxg-2025-01-moveforchange/7119">xxG-2025-01-MoveForChange</a>',
    expectedHref: 'https://forum.xx.network/t/xxg-2025-01-moveforchange/7119',
    expectedTitle: 'xxG-2025-01-MoveForChange',
  },
  {
    raw: '<a href="https://forum.xx.network/t/xxg-2025-02-ios-app-for-haven/7307/12">xxG-2025-002 iOS App</a>',
    expectedHref: 'https://forum.xx.network/t/xxg-2025-02-ios-app-for-haven/7307/12',
    expectedTitle: 'xxG-2025-002 iOS App',
  },
  {
    raw: '<a href="https://forum.xx.network/t/xxb-2024-004-privacy-preserving-notifications-service-implementation/7059">xxB-2024-004: Privacy-Preserving Notifications Service Implementation</a>',
    expectedHref: 'https://forum.xx.network/t/xxb-2024-004-privacy-preserving-notifications-service-implementation/7059',
    expectedTitle: 'xxB-2024-004: Privacy-Preserving Notifications Service Implementation',
  },
  {
    raw: '<a href="https://forum.xx.network/t/proposed-xxb-2025-001-xx-network-wallet-on-chain-identity-fixes-and-improvements/7255">Bounty xxB-2025-001: xx Network Wallet on-chain identity fixes and improvements</a>',
    expectedHref:
      'https://forum.xx.network/t/proposed-xxb-2025-001-xx-network-wallet-on-chain-identity-fixes-and-improvements/7255',
    expectedTitle:
      'Bounty xxB-2025-001: xx Network Wallet on-chain identity fixes and improvements',
  },
  {
    raw: '<a href="https://forum.xx.network/t/proposed-xxb-2025-003-polkadotjs-etc-integration-50-000-usd-equivalent-in-xx-coins/7257/1">xxB-2025-003: PolkadotJS/etc Integration (PER WALLET)</a>',
    expectedHref:
      'https://forum.xx.network/t/proposed-xxb-2025-003-polkadotjs-etc-integration-50-000-usd-equivalent-in-xx-coins/7257/1',
    expectedTitle: 'xxB-2025-003: PolkadotJS/etc Integration (PER WALLET)',
  },
];

describe('extractForumLink — live bounty fixtures', () => {
  for (const fixture of LIVE_BOUNTY_DESCRIPTIONS) {
    it(`parses: ${fixture.expectedTitle.slice(0, 40)}…`, () => {
      const out = extractForumLink(fixture.raw);
      expect(out.href).toBe(fixture.expectedHref);
      expect(out.title).toBe(fixture.expectedTitle);
      expect(out.raw).toBe(fixture.raw);
      expect(out.isCanonicalForumLink).toBe(true);
      expect(out.host).toBe('forum.xx.network');
    });
  }
});

describe('extractForumLink — canonical detection', () => {
  it('classifies the canonical forum prefix as canonical', () => {
    const out = extractForumLink(
      '<a href="https://forum.xx.network/t/foo/123">Foo</a>'
    );
    expect(out.isCanonicalForumLink).toBe(true);
  });

  it('classifies an external host as non-canonical (but still extracts it)', () => {
    const out = extractForumLink(
      '<a href="https://evil.example.com/phishing">Looks Legit</a>'
    );
    expect(out.isCanonicalForumLink).toBe(false);
    expect(out.href).toBe('https://evil.example.com/phishing');
    expect(out.title).toBe('Looks Legit');
    expect(out.host).toBe('evil.example.com');
  });

  it('treats a subdomain of xx.network as non-canonical (must be forum.xx.network exactly)', () => {
    const out = extractForumLink(
      '<a href="https://malicious.xx.network/t/foo/1">Pretend Forum</a>'
    );
    expect(out.isCanonicalForumLink).toBe(false);
    expect(out.host).toBe('malicious.xx.network');
  });

  it('case-insensitive on the prefix scheme/host', () => {
    const out = extractForumLink(
      '<a href="HTTPS://FORUM.XX.NETWORK/t/foo/1">Foo</a>'
    );
    expect(out.isCanonicalForumLink).toBe(true);
  });
});

describe('extractForumLink — fallback / edge cases', () => {
  it('returns plain text intact when there is no anchor', () => {
    const out = extractForumLink('See the forum for details');
    expect(out.href).toBeNull();
    expect(out.title).toBe('See the forum for details');
    expect(out.raw).toBe('See the forum for details');
    expect(out.isCanonicalForumLink).toBe(false);
    expect(out.host).toBeNull();
  });

  it('falls back to plain text on malformed HTML (no closing tag)', () => {
    const out = extractForumLink(
      '<a href="https://forum.xx.network/t/x/1">Open anchor never closed'
    );
    expect(out.href).toBeNull();
    expect(out.title).toContain('Open anchor never closed');
  });

  it('handles single-quoted href attributes', () => {
    const out = extractForumLink(
      "<a href='https://forum.xx.network/t/foo/1'>Foo</a>"
    );
    expect(out.href).toBe('https://forum.xx.network/t/foo/1');
    expect(out.title).toBe('Foo');
    expect(out.isCanonicalForumLink).toBe(true);
  });

  it('strips nested tags from inner anchor text', () => {
    const out = extractForumLink(
      '<a href="https://forum.xx.network/t/foo/1"><strong>Bold</strong> title</a>'
    );
    expect(out.title).toBe('Bold title');
  });

  it('uses the first anchor when there are multiple', () => {
    const out = extractForumLink(
      '<a href="https://forum.xx.network/t/first/1">First</a> and <a href="https://example.com">Second</a>'
    );
    expect(out.href).toBe('https://forum.xx.network/t/first/1');
    expect(out.title).toBe('First');
    expect(out.isCanonicalForumLink).toBe(true);
  });

  it('handles an empty string defensively', () => {
    const out = extractForumLink('');
    expect(out.href).toBeNull();
    expect(out.title).toBe('');
    expect(out.raw).toBe('');
  });

  it('returns host=null on a malformed URL', () => {
    const out = extractForumLink(
      '<a href="not a valid url">Bogus</a>'
    );
    expect(out.href).toBe('not a valid url');
    expect(out.host).toBeNull();
    expect(out.isCanonicalForumLink).toBe(false);
  });
});

describe('CANONICAL_FORUM_PREFIX', () => {
  it('matches the host the wallet treats as canonical', () => {
    expect(CANONICAL_FORUM_PREFIX).toBe('https://forum.xx.network/');
  });
});
