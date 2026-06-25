/**
 * Memos — the bottom-nav home for private, 1:1 mixnet messaging.
 *
 * Lists your conversations (per partner ACCOUNT) plus the contacts you can start
 * a chat with (anyone whose cMix contact is on this device — today that's
 * cosigners you've added). History is local + ephemeral by design: cMix keeps no
 * server-side log, so what you see here lives only on this device.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, ChevronRight } from 'lucide-react';
import { TopBar } from '@/components/layout';
import { AddressIcon, AddressLabel } from '@/components/ui';
import { useCmixOnlineStore } from '@/store/cmixOnline';
import { useCmixContactsStore } from '@/store/cmixContacts';
import { useCmixChatStore } from '@/store/cmixChat';
import { deserializeRegistry } from '@/cmix/registrySerde';
import { knownAccounts } from '@/cmix/contactRegistry';

export function Memos() {
  const status = useCmixOnlineStore((s) => s.status);
  const bindings = useCmixContactsStore((s) => s.bindings);
  const conversations = useCmixChatStore((s) => s.conversations);

  // Rows = anyone you have a contact for (can start a chat) ∪ anyone you already
  // have a conversation with — most-recent first.
  const rows = useMemo(() => {
    const reg = deserializeRegistry(bindings);
    const all = new Set<string>([...knownAccounts(reg), ...Object.keys(conversations)]);
    return [...all]
      .map((account) => {
        const msgs = conversations[account] ?? [];
        return { account, last: msgs[msgs.length - 1] };
      })
      .sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
  }, [bindings, conversations]);

  return (
    <>
      <TopBar title="Memos" showSettings />
      <div className="px-5 py-4 max-w-md mx-auto space-y-3 pb-24">
        {status !== 'online' && (
          <p className="text-xs text-ink-300 leading-relaxed px-1">
            Messaging is offline — you can read your history, but bring it online
            (from a multisig's Cosigner messaging section) to send or receive.
          </p>
        )}

        {rows.length === 0 ? (
          <div className="card flex flex-col items-center text-center space-y-3 py-8">
            <div className="w-14 h-14 rounded-2xl bg-xx-500/10 border border-xx-500/30 flex items-center justify-center">
              <MessageSquare size={26} className="text-xx-500" strokeWidth={1.75} />
            </div>
            <div className="space-y-1.5">
              <p className="font-display font-medium text-lg text-ink-100">No conversations yet</p>
              <p className="text-sm text-ink-300 leading-relaxed">
                Private 1:1 messaging over the xx mixnet — no servers, no group chat,
                history only on this device. Add a contact from a multisig's Cosigner
                messaging section to start one.
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {rows.map(({ account, last }) => (
              <li key={account}>
                <Link
                  to={`/memos/${account}`}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700"
                >
                  <AddressIcon address={account} size={36} />
                  <div className="flex-1 min-w-0">
                    <AddressLabel address={account} className="text-sm" />
                    <p className="text-xs text-ink-300 truncate">
                      {last
                        ? `${last.direction === 'out' ? 'You: ' : ''}${last.text}`
                        : 'No messages yet — tap to start'}
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-ink-300 flex-shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
