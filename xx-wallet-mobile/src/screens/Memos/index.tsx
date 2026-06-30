/**
 * Memos — the bottom-nav home for private, 1:1 mixnet messaging.
 *
 * Lists your conversations (per partner ACCOUNT) plus the contacts you can start
 * a chat with (anyone whose cMix contact is on this device — today that's
 * cosigners you've added). History is local + ephemeral by design: cMix keeps no
 * server-side log, so what you see here lives only on this device.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, ChevronRight, Share2, UserPlus, KeyRound, Radio, Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { TopBar } from '@/components/layout';
import { AddressIcon, AddressLabel, Sheet } from '@/components/ui';
import { useCmixOnlineStore } from '@/store/cmixOnline';
import { useCmixContactsStore } from '@/store/cmixContacts';
import { useCmixChatStore } from '@/store/cmixChat';
import { useCmixSecretStore } from '@/store/cmixSecret';
import { deserializeRegistry } from '@/cmix/registrySerde';
import { knownAccounts } from '@/cmix/contactRegistry';
import { ShareMyContactSheet, AddContactSheet } from './Contacts';
import { ExportIdentitySheet, ImportIdentitySheet } from './Identity';
import { GoOnlineSheet } from './GoOnline';

export function Memos() {
  const status = useCmixOnlineStore((s) => s.status);
  const goOnlineWithDeviceKey = useCmixOnlineStore((s) => s.goOnlineWithDeviceKey);
  const bindings = useCmixContactsStore((s) => s.bindings);
  const conversations = useCmixChatStore((s) => s.conversations);
  const clearConversation = useCmixChatStore((s) => s.clearConversation);
  const forgetAccount = useCmixContactsStore((s) => s.forgetAccount);
  const notSetUp = useCmixSecretStore((s) => s.wrap === null);
  const stayEnabled = useCmixSecretStore((s) => s.deviceWrap !== null);
  const [shareOpen, setShareOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [goOnlineOpen, setGoOnlineOpen] = useState(false);

  // Tapping "Go online": if "stay enabled" is set up, reconnect with no
  // passphrase; on any failure (device key gone) fall back to the passphrase sheet.
  const handleGoOnlineTap = async () => {
    if (stayEnabled) {
      try {
        await goOnlineWithDeviceKey();
        return;
      } catch {
        /* device key unavailable — fall through to the passphrase sheet */
      }
    }
    setGoOnlineOpen(true);
  };

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
        {status === 'connecting' ? (
          <div className="flex items-center gap-2 text-xs text-ink-300 px-1">
            <Loader2 size={14} className="animate-spin flex-shrink-0" strokeWidth={2} />
            Connecting to the mixnet — this can take a minute the first time.
          </div>
        ) : status !== 'online' ? (
          <button onClick={handleGoOnlineTap} className="btn-secondary w-full">
            <Radio size={16} strokeWidth={2} />
            {stayEnabled ? 'Go online' : 'Go online for messaging'}
          </button>
        ) : null}

        {notSetUp && status !== 'connecting' && (
          <button
            onClick={() => setImportOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-ink-300 active:text-ink-100 py-1"
          >
            <KeyRound size={13} strokeWidth={2} className="flex-shrink-0" />
            Moving from another device? Restore a backup
          </button>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setShareOpen(true)} className="btn-secondary">
            <Share2 size={15} strokeWidth={2} />
            Share my contact
          </button>
          <button onClick={() => setAddOpen(true)} className="btn-secondary">
            <UserPlus size={15} strokeWidth={2} />
            Add a contact
          </button>
        </div>

        {status === 'online' && (
          <button
            onClick={() => setExportOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-ink-300 active:text-ink-100 py-1"
          >
            <KeyRound size={13} strokeWidth={2} className="flex-shrink-0" />
            Back up / move this messaging identity
          </button>
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
                history only on this device. Go online, then add a contact to start a
                conversation.
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {rows.map(({ account, last }) => (
              <li key={account} className="flex items-center gap-1">
                <Link
                  to={`/memos/${account}`}
                  className="flex-1 min-w-0 flex items-center gap-3 p-3 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700"
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
                <button
                  onClick={() => setDeleteTarget(account)}
                  className="p-2.5 text-ink-300 active:text-danger flex-shrink-0"
                  aria-label="Delete conversation"
                >
                  <Trash2 size={16} strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <GoOnlineSheet
        open={goOnlineOpen}
        onClose={() => setGoOnlineOpen(false)}
        onRestore={() => {
          setGoOnlineOpen(false);
          setImportOpen(true);
        }}
      />
      <ShareMyContactSheet open={shareOpen} onClose={() => setShareOpen(false)} />
      <AddContactSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <ExportIdentitySheet open={exportOpen} onClose={() => setExportOpen(false)} />
      <ImportIdentitySheet open={importOpen} onClose={() => setImportOpen(false)} />

      <Sheet
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete conversation"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-danger/5 border border-danger/20">
            <AlertTriangle size={16} className="text-danger flex-shrink-0 mt-0.5" strokeWidth={2} />
            <p className="text-xs text-ink-200 leading-relaxed">
              This removes the chat history and this contact from this device. cMix keeps no
              server copy, so it's gone here — you'd re-add the contact to message them again.
            </p>
          </div>

          {deleteTarget && (
            <div className="flex items-center gap-2 px-1">
              <AddressIcon address={deleteTarget} size={28} />
              <AddressLabel address={deleteTarget} className="text-sm" />
            </div>
          )}

          <button
            onClick={() => {
              if (deleteTarget) {
                clearConversation(deleteTarget);
                forgetAccount(deleteTarget);
              }
              setDeleteTarget(null);
            }}
            className="w-full flex items-center justify-center gap-1.5 rounded-2xl bg-danger/15 border border-danger/40 text-danger font-medium py-2.5 active:bg-danger/25"
          >
            <Trash2 size={16} strokeWidth={2} />
            Delete conversation
          </button>
          <button onClick={() => setDeleteTarget(null)} className="btn-secondary w-full">
            Cancel
          </button>
        </div>
      </Sheet>
    </>
  );
}
