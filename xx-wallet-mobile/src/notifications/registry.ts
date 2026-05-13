/**
 * Notification registry — singleton state holding the active sinks plus
 * the dedupe set for already-emitted events.
 *
 * Module-level singleton state is acceptable here: there's exactly one
 * running wallet instance per page; the registry is conceptually a
 * process-global event bus.
 *
 * Dedupe model:
 *   - Each event has a deterministic ID (see types.ts).
 *   - Already-emitted IDs are tracked in an in-memory Set for this
 *     session, and persisted to localStorage so they survive reload.
 *   - emitEvent is idempotent — passing the same event ID twice is
 *     a no-op the second time, regardless of how the event was built.
 *   - silenceEvent marks an ID as already-emitted without actually
 *     firing it (used to suppress the boot-time "everything is new"
 *     storm — we don't want to spam notifications for every proposal
 *     that piled up while the wallet was closed).
 */

import { noopSink, type NotificationSink } from './sink';
import type { WalletEvent } from './types';

/** localStorage key for the persisted dedupe set. */
const STORAGE_KEY = 'xx-wallet:emitted-events';

/**
 * Cap the persisted dedupe set so localStorage doesn't grow without
 * bound. 5000 event IDs is way more than a wallet user will produce
 * in a year and still fits comfortably under the per-origin quota.
 */
const PERSISTED_MAX = 5000;

const sinks = new Map<string, NotificationSink>();
// Seed with noop so listSinks() is never empty and the iteration code
// path stays exercised even before any plugin has registered.
sinks.set(noopSink.id, noopSink);

const sessionEmitted = new Set<string>();

let persistedEmitted: Set<string> | null = null;

function loadPersisted(): Set<string> {
  if (persistedEmitted) return persistedEmitted;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        persistedEmitted = new Set(arr as string[]);
        return persistedEmitted;
      }
    }
  } catch {
    // Corrupt JSON or localStorage unavailable — start fresh.
  }
  persistedEmitted = new Set();
  return persistedEmitted;
}

function savePersisted(): void {
  if (!persistedEmitted) return;
  try {
    const arr = Array.from(persistedEmitted);
    // Keep the most recent IDs — Set iteration is insertion-ordered, so
    // slicing from the end gives us the newest entries.
    const capped = arr.length > PERSISTED_MAX ? arr.slice(-PERSISTED_MAX) : arr;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // localStorage full or disabled — silently fail; dedupe still
    // works in-memory for the current session.
  }
}

/**
 * Register a notification sink. If a sink with the same ID is already
 * registered, it's replaced (hot-reload friendly for plugin sinks).
 */
export function registerSink(sink: NotificationSink): void {
  sinks.set(sink.id, sink);
}

/**
 * Remove a previously-registered sink. No-op if not present.
 */
export function unregisterSink(id: string): void {
  sinks.delete(id);
}

/**
 * Emit a wallet event to all registered sinks.
 *
 * Deduplicated by event.id — re-emitting the same logical event is a
 * no-op. Sinks that throw are isolated; one misbehaving sink doesn't
 * break the others.
 *
 * Synchronous return: the registry doesn't await sink emit() calls.
 * If a sink's emit returns a Promise, we attach a catch so an async
 * failure gets logged rather than swallowed.
 */
export function emitEvent(event: WalletEvent): void {
  if (sessionEmitted.has(event.id)) return;

  const persisted = loadPersisted();
  if (persisted.has(event.id)) {
    // Mirror to session cache so we don't keep re-reading localStorage
    // on every duplicate poll.
    sessionEmitted.add(event.id);
    return;
  }

  sessionEmitted.add(event.id);
  persisted.add(event.id);
  savePersisted();

  for (const sink of sinks.values()) {
    try {
      const result = sink.emit(event);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((err) => {
          console.warn(`[notifications] sink "${sink.id}" failed async:`, err);
        });
      }
    } catch (err) {
      console.warn(`[notifications] sink "${sink.id}" threw:`, err);
    }
  }
}

/**
 * Mark an event ID as already-emitted WITHOUT firing it. Used at boot
 * to suppress the "everything is new on cold start" storm: the wallet
 * observes existing pending proposals as if they were brand new the
 * first time around, but the user has presumably already been notified
 * about them via whatever channel was active. We mark them as seen so
 * only genuinely-new events (arriving after boot) trigger sinks.
 */
export function silenceEvent(id: string): void {
  if (sessionEmitted.has(id)) return;
  sessionEmitted.add(id);
  const persisted = loadPersisted();
  if (!persisted.has(id)) {
    persisted.add(id);
    savePersisted();
  }
}

/**
 * Inspect current sinks — testing/debug helper. Returns sink IDs in
 * insertion order.
 */
export function listSinks(): string[] {
  return Array.from(sinks.keys());
}

/**
 * Reset the entire registry. EXPORTED FOR TESTS ONLY. Do not call from
 * production code — it wipes all sinks and the dedupe set.
 */
export function __resetForTests(): void {
  sinks.clear();
  sinks.set(noopSink.id, noopSink);
  sessionEmitted.clear();
  persistedEmitted = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
