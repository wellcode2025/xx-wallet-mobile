/**
 * Tests for the chat timestamp formatter. Locale is pinned to en-US so the
 * assertions are deterministic across environments; the timezone-sensitive
 * pieces are tested via same-day/other-day DECISIONS (built from local Date
 * parts), not fixed instants.
 */
import { describe, expect, it } from 'vitest';
import { formatMessageTime, isSameLocalDay } from './messageTime';

/** Epoch ms for a LOCAL calendar date/time (avoids timezone-dependent parsing). */
const local = (y: number, mo: number, d: number, h = 12, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();

describe('isSameLocalDay', () => {
  it('true for two instants on the same local day', () => {
    expect(isSameLocalDay(local(2026, 7, 7, 0, 1), local(2026, 7, 7, 23, 59))).toBe(true);
  });

  it('false across midnight', () => {
    expect(isSameLocalDay(local(2026, 7, 7, 23, 59), local(2026, 7, 8, 0, 1))).toBe(false);
  });

  it('false for same day-of-month in a different month', () => {
    expect(isSameLocalDay(local(2026, 7, 7), local(2026, 6, 7))).toBe(false);
  });
});

describe('formatMessageTime', () => {
  const now = local(2026, 7, 7, 21, 30);

  it('same local day → time only', () => {
    expect(formatMessageTime(local(2026, 7, 7, 20, 59), now, 'en-US')).toBe('8:59 PM');
  });

  it('earlier this year → month + day + time', () => {
    expect(formatMessageTime(local(2026, 7, 6, 20, 59), now, 'en-US')).toBe('Jul 6, 8:59 PM');
  });

  it('a previous year → full date + time', () => {
    expect(formatMessageTime(local(2025, 7, 6, 20, 59), now, 'en-US')).toBe('Jul 6, 2025, 8:59 PM');
  });
});
