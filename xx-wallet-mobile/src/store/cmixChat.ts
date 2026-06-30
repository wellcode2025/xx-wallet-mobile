/**
 * cMix 1:1 chat store — the client-side conversation log.
 *
 * cMix is transport, not a chat-history server: gateways hold an undelivered
 * message ~21 days for offline pickup, then purge, and nothing persists
 * centrally. So the conversation history lives HERE, on the device, persisted in
 * localStorage. It's per-device (not synced across the user's devices) and
 * ephemeral by design — exactly the privacy posture we want for a wallet.
 *
 * Keyed by the partner's wallet ACCOUNT (SS58): a conversation is with a person,
 * aggregating any devices (cMix contacts) they run — you message the account,
 * fan out to its device(s), and a reply from any device lands in the same
 * thread. Display is the account (name + identicon) with no reception-id lookup.
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

interface CmixChatState {
  /** partner account (SS58) → messages, in store order (oldest first). */
  conversations: Record<string, ChatMessage[]>;
  /** Which of MY accounts I message a partner AS (partner SS58 → my account
   *  SS58). Each partner is reached from ONE of my per-account identities; this
   *  records which, so a send uses the same identity they added — and so the UI
   *  can show "messaging as X". */
  partnerAccounts: Record<string, string>;

  /** Append a message to a conversation. Dedups by id (idempotent on a repeat,
   *  e.g. a retried inbound memo) — returns false if it was already present. */
  append(account: string, msg: ChatMessage): boolean;
  /** The account I message `partner` as, if recorded. */
  partnerAccount(partner: string): string | undefined;
  /** Record which of my accounts I message `partner` as (idempotent — keeps the
   *  first unless `force`, so an inbound message doesn't override my choice). */
  setPartnerAccount(partner: string, myAccount: string, force?: boolean): void;
  /** Mark an outgoing message as having entered the mixnet (round-confirmed). */
  markSent(account: string, id: string): void;
  /** Mark an outgoing message delivered (recipient acked) by id. */
  markDelivered(account: string, id: string, delivered: boolean): void;
  /** The ordered messages for a partner (empty array if none). */
  conversation(account: string): ChatMessage[];
  /** Whether a message with this id is already stored for the partner. */
  hasMessage(account: string, id: string): boolean;
  /** Partner accounts with at least one message. */
  partners(): string[];
  /** Forget a single conversation. */
  clearConversation(account: string): void;
}

export const useCmixChatStore = create<CmixChatState>()(
  persist(
    (set, get) => ({
      conversations: {},
      partnerAccounts: {},

      partnerAccount(partner) {
        return get().partnerAccounts[partner];
      },

      setPartnerAccount(partner, myAccount, force = false) {
        if (!force && get().partnerAccounts[partner]) return;
        set({ partnerAccounts: { ...get().partnerAccounts, [partner]: myAccount } });
      },

      append(account, msg) {
        const existing = get().conversations[account] ?? [];
        if (existing.some((m) => m.id === msg.id)) return false;
        set({
          conversations: {
            ...get().conversations,
            [account]: [...existing, msg],
          },
        });
        return true;
      },

      markSent(account, id) {
        const existing = get().conversations[account];
        if (!existing) return;
        set({
          conversations: {
            ...get().conversations,
            [account]: existing.map((m) => (m.id === id ? { ...m, sent: true } : m)),
          },
        });
      },

      markDelivered(account, id, delivered) {
        const existing = get().conversations[account];
        if (!existing) return;
        set({
          conversations: {
            ...get().conversations,
            [account]: existing.map((m) => (m.id === id ? { ...m, delivered } : m)),
          },
        });
      },

      conversation(account) {
        return get().conversations[account] ?? [];
      },

      hasMessage(account, id) {
        return (get().conversations[account] ?? []).some((m) => m.id === id);
      },

      partners() {
        return Object.keys(get().conversations);
      },

      clearConversation(account) {
        const next = { ...get().conversations };
        delete next[account];
        set({ conversations: next });
      },
    }),
    {
      name: 'xx-wallet:cmix-chat',
      version: 1,
    }
  )
);
