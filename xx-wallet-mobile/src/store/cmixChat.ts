/**
 * cMix 1:1 chat store — the client-side conversation log.
 *
 * cMix is transport, not a chat-history server: gateways hold an undelivered
 * message ~21 days for offline pickup, then purge, and nothing persists
 * centrally. So the conversation history lives HERE, on the device, persisted in
 * localStorage. It's per-device (not synced across the user's devices) and
 * ephemeral by design — exactly the privacy posture we want for a wallet.
 *
 * Keyed by the partner's reception id (hex). Incoming messages dedup by memo id
 * (a delivery retry can deliver the same memo twice — see withSendRetry).
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
  /** Outgoing only: true once a delivery receipt confirmed it landed. */
  delivered?: boolean;
}

interface CmixChatState {
  /** partner reception id (hex) → messages, in store order (oldest first). */
  conversations: Record<string, ChatMessage[]>;

  /** Append a message to a conversation. Dedups by id (idempotent on a repeat,
   *  e.g. a retried inbound memo) — returns false if it was already present. */
  append(partnerId: string, msg: ChatMessage): boolean;
  /** Mark an outgoing message delivered (or not) by id. */
  markDelivered(partnerId: string, id: string, delivered: boolean): void;
  /** The ordered messages for a partner (empty array if none). */
  conversation(partnerId: string): ChatMessage[];
  /** Whether a message with this id is already stored for the partner. */
  hasMessage(partnerId: string, id: string): boolean;
  /** Partners with at least one message. */
  partners(): string[];
  /** Forget a single conversation. */
  clearConversation(partnerId: string): void;
}

export const useCmixChatStore = create<CmixChatState>()(
  persist(
    (set, get) => ({
      conversations: {},

      append(partnerId, msg) {
        const existing = get().conversations[partnerId] ?? [];
        if (existing.some((m) => m.id === msg.id)) return false;
        set({
          conversations: {
            ...get().conversations,
            [partnerId]: [...existing, msg],
          },
        });
        return true;
      },

      markDelivered(partnerId, id, delivered) {
        const existing = get().conversations[partnerId];
        if (!existing) return;
        set({
          conversations: {
            ...get().conversations,
            [partnerId]: existing.map((m) => (m.id === id ? { ...m, delivered } : m)),
          },
        });
      },

      conversation(partnerId) {
        return get().conversations[partnerId] ?? [];
      },

      hasMessage(partnerId, id) {
        return (get().conversations[partnerId] ?? []).some((m) => m.id === id);
      },

      partners() {
        return Object.keys(get().conversations);
      },

      clearConversation(partnerId) {
        const next = { ...get().conversations };
        delete next[partnerId];
        set({ conversations: next });
      },
    }),
    {
      name: 'xx-wallet:cmix-chat',
      version: 1,
    }
  )
);
