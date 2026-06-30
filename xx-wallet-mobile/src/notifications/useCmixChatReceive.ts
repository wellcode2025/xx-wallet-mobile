/**
 * useCmixChatReceive — while messaging is online, listen for incoming 1:1 chat
 * memos from known contacts and append them to the local conversation store.
 *
 * cMix keeps no server-side history (gateways hold an undelivered message ~21
 * days for offline pickup, then purge), so this is what makes a received message
 * persist — it's the receiving half of the in-wallet chat. Dedups by memo id (a
 * delivery retry can deliver the same memo twice). Listeners register per known
 * contact reception ID, idempotently and per messaging session.
 *
 * Mount once at the authenticated App root (alongside the other inbound hooks).
 */
import { useEffect, useRef } from 'react';
import { useCmixOnlineStore } from '@/store/cmixOnline';
import { useCmixContactsStore } from '@/store/cmixContacts';
import { useCmixChatStore } from '@/store/cmixChat';
import { deserializeRegistry } from '@/cmix/registrySerde';
import { knownAccounts, contactsForAccount } from '@/cmix/contactRegistry';
import { getIDFromContact } from '@/cmix/e2eApi';
import type { MessagingHandle } from '@/cmix/messaging';

function idHex(id: Uint8Array): string {
  let s = '';
  for (const b of id) s += b.toString(16).padStart(2, '0');
  return s;
}

export function useCmixChatReceive() {
  const status = useCmixOnlineStore((s) => s.status);
  const handle = useCmixOnlineStore((s) => s.handle);
  const bindings = useCmixContactsStore((s) => s.bindings);

  const reg = useRef<{ handle: MessagingHandle | null; ids: Set<string> }>({
    handle: null,
    ids: new Set(),
  });

  useEffect(() => {
    if (status !== 'online' || !handle) return;
    if (reg.current.handle !== handle) {
      reg.current = { handle, ids: new Set() };
    }
    const registered = reg.current.ids;
    const registry = deserializeRegistry(bindings);

    for (const account of knownAccounts(registry)) {
      for (const contact of contactsForAccount(registry, account)) {
        let id: Uint8Array;
        try {
          id = getIDFromContact(contact);
        } catch {
          continue;
        }
        // Register one listener per device (reception id), but file every memo
        // under the partner's ACCOUNT so a multi-device contact stays one thread.
        const regKey = idHex(id);
        if (registered.has(regKey)) continue;
        registered.add(regKey);

        handle
          .onMemo(id, (memo) => {
            useCmixChatStore.getState().append(account, {
              id: memo.id,
              direction: 'in',
              text: memo.text,
              sentAt: memo.sentAt,
              at: Date.now(),
            });
            // Auto-ack receipt so the sender's checkmark means "they got it",
            // not just "it entered a round". Fire-and-forget; ack even on a
            // duplicate (the sender resends until it sees an ack). `id` is the
            // sender's reception id we're listening to.
            void handle.sendMemoAck(id, memo.id).catch(() => {});
          })
          .catch(() => {
            registered.delete(regKey); // registration failed — allow a retry
          });

        // The other half: when a partner acks one of OUR outgoing memos, mark it
        // delivered (flips the checkmark). Best-effort registration.
        handle
          .onMemoAck(id, (ack) => {
            useCmixChatStore.getState().markDelivered(account, ack.ackId, true);
          })
          .catch(() => {});
      }
    }
  }, [status, handle, bindings]);
}
