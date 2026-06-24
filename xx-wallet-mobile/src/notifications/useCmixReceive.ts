/**
 * useCmixReceive — while messaging is online, listen for incoming coordination
 * memos from known cosigners and pre-load the call data they carry.
 *
 * On xx, a pending multisig proposal only carries the call HASH on chain; a
 * cosigner can't approve without the call data, which today arrives by file/QR
 * import. When a cosigner sends the proposal over cMix, this caches the memo's
 * (hash-verified) call data into the pending-bytes store — so the approval
 * screen already has what it needs and no manual import is required. The wallet
 * still alerts about the proposal itself via the on-chain
 * `multisig.proposal.received` event; this just removes the file step.
 *
 * Listeners register per known cosigner reception ID, idempotently and per
 * messaging session (a fresh go-online re-registers against the new handle).
 * Only proposals for multisigs this wallet knows are cached, and the package is
 * already hash-gated by parseCoordinationMessage on the way in — the memo is
 * transport, never instruction.
 *
 * Mount once at the authenticated App root (alongside the other notification
 * hooks).
 */
import { useEffect, useRef } from 'react';
import { useCmixOnlineStore } from '@/store/cmixOnline';
import { useCmixContactsStore } from '@/store/cmixContacts';
import { usePendingBytesStore, useMultisigsStore } from '@/store';
import { deserializeRegistry } from '@/cmix/registrySerde';
import { knownAccounts, contactsForAccount } from '@/cmix/contactRegistry';
import { getIDFromContact } from '@/cmix/e2eApi';
import { incomingProposalFrom, type MessagingHandle } from '@/cmix/messaging';
import { emitEvent } from './registry';

function idHex(id: Uint8Array): string {
  let s = '';
  for (const b of id) s += b.toString(16).padStart(2, '0');
  return s;
}

export function useCmixReceive() {
  const status = useCmixOnlineStore((s) => s.status);
  const handle = useCmixOnlineStore((s) => s.handle);
  const bindings = useCmixContactsStore((s) => s.bindings);
  const putBytes = usePendingBytesStore((s) => s.putBytes);

  // Track which cosigner IDs we've registered a listener for, per handle —
  // a new messaging session (new handle) resets and re-registers.
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
          continue; // wasm hiccup / malformed contact — skip, try again next run
        }
        const key = idHex(id);
        if (registered.has(key)) continue;
        registered.add(key);

        handle
          .onCoordination(id, (result) => {
            const inc = incomingProposalFrom(result);
            if (!inc) return; // ack or invalid — nothing to cache
            // Only act on multisigs we actually know.
            const ms = useMultisigsStore.getState().getMultisig(inc.multisigAddress);
            if (!ms) return;
            putBytes({
              multisigAddress: inc.multisigAddress,
              callHash: inc.callHash,
              callBytes: inc.callBytes,
              source: 'received',
              receivedAt: Date.now(),
            });
            // Alert right away instead of waiting for the on-chain poll. Same
            // deterministic id as the chain path (useMultisigNotifications), so
            // whichever fires first wins and the user never gets a double alert.
            emitEvent({
              id: `multisig.proposal.received:${inc.multisigAddress}:${inc.callHash}`,
              timestamp: Date.now(),
              kind: 'multisig.proposal.received',
              multisigAddress: inc.multisigAddress,
              callHash: inc.callHash,
              depositor: inc.proposedBy,
              approvalsCount: 1, // proposer's own signature; chain path refines if it wins
              threshold: ms.threshold,
              multisigLocalName: ms.localName,
            });
          })
          .catch(() => {
            registered.delete(key); // registration failed — allow a retry
          });
      }
    }
  }, [status, handle, bindings, putBytes]);
}
