/**
 * Chat message timestamp formatting.
 *
 * Messages carry `sentAt` — the SENDER's clock at send time, as epoch ms.
 * Epoch time is timezone-free, so rendering it with the device's locale +
 * timezone (the `toLocale*` defaults) shows the moment the message was sent
 * expressed in the reader's local time, regardless of the sender's timezone.
 * The value is display-only (a peer's clock can't be trusted for ordering —
 * the store orders by local receive time).
 */

/** Whether two epoch-ms instants fall on the same calendar day locally. */
export function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * Format a message timestamp for display in a chat bubble, in device-local
 * time: time-of-day for today's messages ("8:59 PM"), month + day for this
 * year ("Jul 7, 8:59 PM"), full date beyond that ("Jul 7, 2025, 8:59 PM").
 * `now` and `locale` are injectable for deterministic tests; both default to
 * the device.
 */
export function formatMessageTime(
  sentAt: number,
  now: number = Date.now(),
  locale?: string
): string {
  const time = new Date(sentAt).toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (isSameLocalDay(sentAt, now)) return time;
  const sameYear = new Date(sentAt).getFullYear() === new Date(now).getFullYear();
  const date = new Date(sentAt).toLocaleDateString(
    locale,
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }
  );
  return `${date}, ${time}`;
}
