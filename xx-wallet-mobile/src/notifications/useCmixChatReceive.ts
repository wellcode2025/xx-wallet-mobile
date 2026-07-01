/**
 * useCmixChatReceive — while messaging is online, listen for incoming 1:1 chat
 * memos on EVERY one of the user's messaging identities (one per account), and
 * append them to the local conversation store.
 *
 * Per-account: a partner reaches you on the identity of whichever of your
 * accounts you shared with them, so we register listeners on each of your
 * accounts' identities (handle.forAccount) for every known partner contact, and
 * record which of your accounts they reached (so a reply uses the same identity).
 *
 * cMix keeps no server-side history (gateways hold an undelivered message ~21
 * days for offline pickup, then purge), so this is what makes a received message
 * persist. Dedups by memo id; listeners register idempotently per (my account,
 * partner reception id) per messaging session.
 *
 * Mount once at the authenticated App root (alongside the other inbound hooks).
 */
import { useEffect, useRef } from 'react';
import { useCmixOnlineStore } from '@/store/cmixOnline';
import { useCmixContactsStore } from '@/store/cmixContacts';
import { useCmixChatStore } from '@/store/cmixChat';
import { useCmixSecretStore } from '@/store/cmixSecret';
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
  const myAccounts = useCmixSecretStore((s) => s.identityAccounts);

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
    const partners = knownAccounts(registry);

    // For each of MY accounts' identities, listen for every known partner. The
    // identity a partner reaches is whichever account I shared with them, so only
    // that identity actually hears them; the rest are harmless no-ops.
    for (const myAccount of myAccounts) {
      handle
        .forAccount(myAccount)
        .then((am) => {
          for (const partner of partners) {
            for (const contact of contactsForAccount(registry, partner)) {
              let id: Uint8Array;
              try {
                id = getIDFromContact(contact);
              } catch {
                continue;
              }
              const regKey = `${myAccount}|${idHex(id)}`;
              if (registered.has(regKey)) continue;
              registered.add(regKey);

              am
                .onMemo(id, (memo) => {
                  // They reached me on `myAccount` — this inbound belongs to the
                  // (myAccount, partner) thread, and a reply sends from the same
                  // identity because the thread's sender is that account.
                  useCmixChatStore.getState().append(myAccount, partner, {
                    id: memo.id,
                    direction: 'in',
                    text: memo.text,
                    sentAt: memo.sentAt,
                    at: Date.now(),
                  });
                  // Auto-ack receipt FROM the same identity they messaged.
                  void am.sendMemoAck(id, memo.id).catch(() => {});
                })
                .catch(() => {
                  registered.delete(regKey); // registration failed — allow a retry
                });

              am
                .onMemoAck(id, (ack) => {
                  useCmixChatStore
                    .getState()
                    .markDelivered(myAccount, partner, ack.ackId, true);
                })
                .catch(() => {});
            }
          }
        })
        .catch(() => {
          /* couldn't log in this account's identity — skip it this pass */
        });
    }
  }, [status, handle, bindings, myAccounts]);
}
