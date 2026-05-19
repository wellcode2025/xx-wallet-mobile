/**
 * forumLinkExtractor — parse a governance description into its canonical
 * forum-link form, when present.
 *
 * **Why this exists.** The Phase 4 spike confirmed that bounty descriptions
 * on xx are stored as on-chain bytes that decode to HTML anchor tags
 * pointing to `forum.xx.network` threads:
 *
 *   <a href="https://forum.xx.network/t/xxg-2025-01-moveforchange/7119">
 *     xxG-2025-01-MoveForChange
 *   </a>
 *
 * The forum is the single canonical off-chain narrative source on xx (no
 * Polkassembly, no Subsquare). Every governance description that follows
 * this shape should render as a tappable link to the linked thread, with
 * the inner text as the visible title. Descriptions that *don't* follow
 * this shape (plain text, malformed HTML, an anchor to a non-forum URL)
 * must NOT be presented as if they did — that's the
 * proposer-supplied-narrative attack we guard against generally.
 *
 * **Trust model.** The proposer chooses both the URL and the title text.
 * The wallet renders both, but:
 *   - Canonical (`https://forum.xx.network/...`) links open without warning.
 *   - Non-canonical links are flagged: the visible URL and the rendered
 *     title may not agree, and the user should see the host before tapping
 *     through. Renderers should require a tap-confirm for external links
 *     and always show the destination host alongside the title.
 * Per `feedback_visible_choice_over_gatekeeping`: we don't refuse external
 * links, but we make the trust decision visible.
 *
 * **Parsing strategy.** A single regex matches the first `<a>` tag in the
 * input. Strict HTML parsing would be overkill — these strings are bounded
 * by `bounties.bountyDescriptions` storage limits and follow a narrow
 * template the foundation has used for years. The regex is permissive on
 * whitespace and attribute-quote style; if it doesn't match, we treat the
 * whole input as plain text.
 */

/** The canonical xx-network forum host. Anything outside this prefix is "external". */
export const CANONICAL_FORUM_PREFIX = 'https://forum.xx.network/';

export interface ExtractedForumLink {
  /** href attribute of the parsed anchor, or null if no anchor was found. */
  href: string | null;
  /**
   * Visible title — anchor text if an anchor matched, otherwise the
   * input string itself. The wallet renders this; never use it for
   * trust decisions (the proposer chose it).
   */
  title: string;
  /** Original description bytes-decoded to UTF-8, as supplied. */
  raw: string;
  /** True iff href starts with the canonical xx-network forum prefix. */
  isCanonicalForumLink: boolean;
  /**
   * Hostname extracted from href for visible-host display. Null if there
   * was no anchor or the href didn't parse as a URL. Always rendered
   * alongside the title for non-canonical links so the user can see
   * where they're being sent.
   */
  host: string | null;
}

const ANCHOR_RE = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;

/**
 * Extract the first forum-link anchor from a governance description.
 *
 * Accepts a UTF-8-decoded description string. (Callers reading on-chain
 * bytes should `bytes.toUtf8()` or equivalent before passing in.)
 *
 * Returns a fully-populated `ExtractedForumLink`. `href` is null when no
 * anchor matched; `title` always has a value (falls back to `raw`).
 */
export function extractForumLink(raw: string): ExtractedForumLink {
  if (!raw || typeof raw !== 'string') {
    return {
      href: null,
      title: '',
      raw: raw ?? '',
      isCanonicalForumLink: false,
      host: null,
    };
  }
  const match = raw.match(ANCHOR_RE);
  if (!match) {
    // No anchor — treat the whole string as plain text.
    return {
      href: null,
      title: raw.trim(),
      raw,
      isCanonicalForumLink: false,
      host: null,
    };
  }
  const href = match[1].trim();
  const innerText = stripInnerTags(match[2]).trim();
  const isCanonical = href.toLowerCase().startsWith(CANONICAL_FORUM_PREFIX);
  let host: string | null = null;
  try {
    host = new URL(href).host;
  } catch {
    // Malformed URL — keep the link visible but flag it as non-canonical
    // and without a host. The UI will render it disabled-ish so users
    // don't tap through to something the wallet can't validate.
    host = null;
  }
  return {
    href,
    title: innerText.length > 0 ? innerText : raw.trim(),
    raw,
    isCanonicalForumLink: isCanonical,
    host,
  };
}

/**
 * Strip nested tags from an anchor's inner text, leaving the visible
 * characters only. Defensive against `<a href="..."><strong>X</strong></a>`
 * and similar markup — we want "X", not "<strong>X</strong>".
 */
function stripInnerTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}
