/**
 * useCmixChatResend — deliver-eventually backstop for 1:1 chat.
 *
 * cMix buffers an undelivered message at the gateway (~21 days), but a receiver
 * whose app was fully CLOSED does NOT reliably backfill that window when it cold-
 * resumes (proven in scratch/cmix-offline-teardown-spike.html: identity + channel
 * resume fine, yet a message sent while closed is never picked up). So we can't
 * lean on the receiver retrieving it later.
 *
 * Instead, the SENDER keeps trying. While messaging is online, this hook
 * periodically re-sends any outbound chat memo that hasn't been ACKed yet
 * (`delivered === false`) to the partner's contact(s). Re-sends are idempotent —
 * the receiver dedups by memo id (see cmixChat.append / useCmixChatReceive) — so
 * the only cost of a redundant re-send is a little traffic. The moment the
 * recipient is online at the same time (which, over repeated passes, is when
 * they next open Memos), the memo lands, they auto-ack, markDelivered fires, and
 * that memo drops out of the re-send set.
 *
 * This fixes the everyday "I messaged them, they opened it later and got nothing"
 * case. It does NOT cover a fully-async pair who are never online together — that
 * needs true receiver-side backfill, which xxdk doesn't expose here.
 *
 * Mount once at the authenticated App root (alongside useCmixChatReceive, which
 * owns the inbound + auto-ack side).
 */
import { useEffect } from 'react';
import { useCmixOnlineStore } from '@/store/cmixOnline';
import { useCmixContactsStore } from '@/store/cmixContacts';
import { useCmixChatStore } from '@/store/cmixChat';
import { deserializeRegistry } from '@/cmix/registrySerde';
import { contactsForAccount } from '@/cmix/contactRegistry';
import { getIDFromContact } from '@/cmix/e2eApi';
import { sendMemoTo } from '@/cmix/messaging';

/** How often to re-attempt undelivered memos while online. */
const RESEND_INTERVAL_MS = 45_000;
/** Give up re-sending a memo older than this (bounds pointless retries to a
 *  contact who's gone for good). It stays in history, just stops re-sending. */
const MAX_RESEND_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function useCmixChatResend() {
  const status = useCmixOnlineStore((s) => s.status);
  const handle = useCmixOnlineStore((s) => s.handle);

  useEffect(() => {
    if (status !== 'online' || !handle) return;
    let cancelled = false;

    // One re-send sweep: read the LATEST store state (not a subscribed selector,
    // so this effect doesn't re-run on every message change — the interval drives
    // it) and re-transmit every un-acked outbound memo across all threads.
    const sweep = async () => {
      const conversations = useCmixChatStore.getState().conversations;
      const registry = deserializeRegistry(useCmixContactsStore.getState().bindings);
      const cutoff = Date.now() - MAX_RESEND_AGE_MS;

      for (const [key, msgs] of Object.entries(conversations)) {
        if (cancelled) return;
        const sep = key.indexOf('|');
        const myAccount = key.slice(0, sep);
        const partner = key.slice(sep + 1);

        const pending = msgs.filter(
          (m) => m.direction === 'out' && !m.delivered && m.at >= cutoff
        );
        if (pending.length === 0) continue;

        const contacts = contactsForAccount(registry, partner);
        if (contacts.length === 0) continue;

        let am;
        try {
          am = await handle.forAccount(myAccount);
        } catch {
          continue; // couldn't log this identity in this pass — try again next sweep
        }
        if (cancelled) return;

        const targets = contacts.map((c) => ({ contact: c, id: getIDFromContact(c) }));
        for (const m of pending) {
          if (cancelled) return;
          for (const t of targets) {
            // sendMemoTo lazily (re)establishes the channel + returns once a round
            // confirms; the recipient's auto-ack (useCmixChatReceive) is what
            // ultimately flips delivered=true and stops future re-sends.
            void sendMemoTo(am, t, {
              kind: 'chat.memo',
              v: 1,
              id: m.id,
              text: m.text,
              sentAt: m.sentAt,
            })
              .then((r) => {
                if (r.delivered) useCmixChatStore.getState().markSent(myAccount, partner, m.id);
              })
              .catch(() => {
                /* offline recipient / channel not up yet — next sweep retries */
              });
          }
        }
      }
    };

    void sweep(); // immediate pass on (re)connect
    const timer = setInterval(() => void sweep(), RESEND_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status, handle]);
}
