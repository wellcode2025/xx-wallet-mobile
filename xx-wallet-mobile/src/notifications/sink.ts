/**
 * NotificationSink — the consumer interface for wallet events.
 *
 * Sinks may render in-app toasts, fire browser Notification API
 * popups, post to external channels (Telegram, Discord, Matrix),
 * forward to a downstream wallet like OpenClaw, or anything else
 * the integrator wants — that's their business.
 *
 * Contract:
 *   - Sinks MUST NOT throw. The registry guards against it defensively
 *     (try/catch around each call) but a misbehaving sink still gets
 *     console-warned and degrades the user experience.
 *   - Sinks MAY be async. The registry doesn't await — fire and forget.
 *   - Sinks are responsible for their own filtering. The registry fires
 *     every event to every registered sink; if a sink only cares about
 *     `transfer.received`, it ignores everything else in its switch.
 *   - Sinks should be idempotent. The registry dedupes by event.id but
 *     a defensive sink ignores duplicates of its own accord too (e.g.,
 *     by tracking what it has already pushed to its channel).
 */

import type { WalletEvent } from './types';

export interface NotificationSink {
  /** Stable identifier — used for register/unregister. Each registered
   *  sink must have a unique ID; re-registering the same ID replaces
   *  the previous sink (allowing hot-reload of plugin sinks). */
  id: string;

  /** Receive a wallet event. Sinks should `switch` on `event.kind` and
   *  ignore anything they don't handle. Errors should not propagate;
   *  if a sink needs to surface a failure it should log internally. */
  emit(event: WalletEvent): void | Promise<void>;
}

/**
 * The default sink. Does nothing. Registered initially so the registry
 * always has at least one entry — keeps the call path warm even when
 * no plugins are present. Plugins replace or augment with their own.
 */
export const noopSink: NotificationSink = {
  id: 'noop',
  emit() {
    // intentionally empty — plugins replace this
  },
};
