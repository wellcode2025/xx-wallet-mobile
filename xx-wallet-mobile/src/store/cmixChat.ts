/**
 * cMix 1:1 chat store — the client-side conversation log.
 *
 * cMix is transport, not a chat-history server: gateways hold an undelivered
 * message ~21 days for offline pickup, then purge, and nothing persists
 * centrally. So the conversation history lives HERE, on the device, persisted in
 * localStorage. It's per-device (not synced across the user's devices) and
 * ephemeral by design — exactly the privacy posture we want for a wallet.
 *
 * Keyed by a THREAD = (my account, partner account). Each of my wallet accounts
 * has its OWN unlinkable cMix identity, so messaging one partner AS account A is
 * a genuinely different channel from messaging them AS account B — the partner's
 * device sees A and B as two separate contacts (different reception ids) and
 * gets two threads, so my side mirrors that with two threads too. The identity a
 * thread is sent from is therefore FIXED by its key, never a mutable attribute:
 * to reach a partner as a different account you start a new thread.
 *
 * Incoming messages dedup by memo id (a delivery retry can deliver the same memo
 * twice — see withSendRetry).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ChatDirection = 'out' | 'in';

export interface ChatMessage {
  /** The memo's client-generated id (stable across a resend). */
  id: string;
  direction: ChatDirection;
  text: string;
  /** Sender's clock at send time (ms) — display only. */
  sentAt: number;
  /** Local clock when this message was stored (ms) — used for ordering, since a
   *  peer's sentAt can't be trusted against our clock. */
  at: number;
  /** Outgoing only: true once the cMix round-result confirmed it entered the
   *  mixnet (in transit to the recipient), even before they've received it. */
  sent?: boolean;
  /** Outgoing only: true once the RECIPIENT acked it — i.e. their device
   *  received + decoded it (the honest "delivered", distinct from `sent`). */
  delivered?: boolean;
}

/** A conversation is one (my account, partner account) pair. */
export interface ChatThread {
  /** Which of MY accounts (SS58) this thread is sent from. */
  myAccount: string;
  /** The partner's wallet account (SS58). */
  partner: string;
}

/** SS58 addresses are base58 (no `|`), so `|` is a safe composite separator.
 *  Exported so views can select `conversations[threadKey(...)]` reactively. */
export function threadKey(myAccount: string, partner: string): string {
  return `${myAccount}|${partner}`;
}

function parseThreadKey(key: string): ChatThread {
  const i = key.indexOf('|');
  return { myAccount: key.slice(0, i), partner: key.slice(i + 1) };
}

interface CmixChatState {
  /** thread key (`${myAccount}|${partner}`) → messages, oldest first. */
  conversations: Record<string, ChatMessage[]>;

  /** Append a message to a thread. Dedups by id (idempotent on a repeat, e.g. a
   *  retried inbound memo) — returns false if it was already present. */
  append(myAccount: string, partner: string, msg: ChatMessage): boolean;
  /** Mark an outgoing message as having entered the mixnet (round-confirmed). */
  markSent(myAccount: string, partner: string, id: string): void;
  /** Mark an outgoing message delivered (recipient acked) by id. */
  markDelivered(myAccount: string, partner: string, id: string, delivered: boolean): void;
  /** The ordered messages for a thread (empty array if none). */
  conversation(myAccount: string, partner: string): ChatMessage[];
  /** Whether a message with this id is already stored for the thread. */
  hasMessage(myAccount: string, partner: string, id: string): boolean;
  /** All threads that have at least one message. */
  threads(): ChatThread[];
  /** Forget a single thread. */
  clearConversation(myAccount: string, partner: string): void;
}

export const useCmixChatStore = create<CmixChatState>()(
  persist(
    (set, get) => ({
      conversations: {},

      append(myAccount, partner, msg) {
        const key = threadKey(myAccount, partner);
        const existing = get().conversations[key] ?? [];
        if (existing.some((m) => m.id === msg.id)) return false;
        set({
          conversations: {
            ...get().conversations,
            [key]: [...existing, msg],
          },
        });
        return true;
      },

      markSent(myAccount, partner, id) {
        const key = threadKey(myAccount, partner);
        const existing = get().conversations[key];
        if (!existing) return;
        set({
          conversations: {
            ...get().conversations,
            [key]: existing.map((m) => (m.id === id ? { ...m, sent: true } : m)),
          },
        });
      },

      markDelivered(myAccount, partner, id, delivered) {
        const key = threadKey(myAccount, partner);
        const existing = get().conversations[key];
        if (!existing) return;
        set({
          conversations: {
            ...get().conversations,
            [key]: existing.map((m) => (m.id === id ? { ...m, delivered } : m)),
          },
        });
      },

      conversation(myAccount, partner) {
        return get().conversations[threadKey(myAccount, partner)] ?? [];
      },

      hasMessage(myAccount, partner, id) {
        return (get().conversations[threadKey(myAccount, partner)] ?? []).some(
          (m) => m.id === id
        );
      },

      threads() {
        return Object.keys(get().conversations).map(parseThreadKey);
      },

      clearConversation(myAccount, partner) {
        const conversations = { ...get().conversations };
        delete conversations[threadKey(myAccount, partner)];
        set({ conversations });
      },
    }),
    {
      // v2 rekeys conversations from partner-only to (myAccount|partner). Old v1
      // data was partner-keyed and can't be migrated meaningfully (we don't know
      // which of your accounts each old thread was sent from), so it's dropped
      // by the new persist name.
      name: 'xx-wallet:cmix-chat-v2',
      version: 2,
    }
  )
);
