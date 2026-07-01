/**
 * Memos — the bottom-nav home for private, 1:1 mixnet messaging.
 *
 * Lists your conversations as THREADS — each a (your account, partner account)
 * pair. Because every one of your accounts is its own unlinkable cMix identity,
 * messaging one partner as account A is a different thread from messaging them as
 * account B (their device sees two contacts), so they show as separate rows. You
 * choose which of your accounts to reach someone from when you START a thread
 * (the "New message" flow), never mid-conversation. History is local + ephemeral
 * by design: cMix keeps no server-side log, so what you see here lives only on
 * this device.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  Share2,
  UserPlus,
  KeyRound,
  Radio,
  Loader2,
  Trash2,
  AlertTriangle,
  PenSquare,
} from 'lucide-react';
import { TopBar } from '@/components/layout';
import { AddressIcon, AddressLabel, Sheet } from '@/components/ui';
import { useAccountsStore } from '@/store';
import { isLocalAccount } from '@/keyring/store';
import { useCmixOnlineStore } from '@/store/cmixOnline';
import { useCmixContactsStore } from '@/store/cmixContacts';
import { useCmixChatStore, type ChatThread } from '@/store/cmixChat';
import { useCmixSecretStore } from '@/store/cmixSecret';
import { deserializeRegistry } from '@/cmix/registrySerde';
import { knownAccounts } from '@/cmix/contactRegistry';
import { useAddressName } from '@/hooks/useAddressName';
import { ShareMyContactSheet, AddContactSheet } from './Contacts';
import { ExportIdentitySheet, ImportIdentitySheet } from './Identity';
import { GoOnlineSheet } from './GoOnline';

export function Memos() {
  const status = useCmixOnlineStore((s) => s.status);
  const goOnlineWithDeviceKey = useCmixOnlineStore((s) => s.goOnlineWithDeviceKey);
  const bindings = useCmixContactsStore((s) => s.bindings);
  const conversations = useCmixChatStore((s) => s.conversations);
  const clearConversation = useCmixChatStore((s) => s.clearConversation);
  const notSetUp = useCmixSecretStore((s) => s.wrap === null);
  const stayEnabled = useCmixSecretStore((s) => s.deviceWrap !== null);
  const [shareOpen, setShareOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newMsgOpen, setNewMsgOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChatThread | null>(null);
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

  // Partners you can start a thread with (any contact on this device).
  const partners = useMemo(
    () => knownAccounts(deserializeRegistry(bindings)),
    [bindings]
  );

  // Rows = every existing thread (your account, partner), most-recent first.
  const rows = useMemo(() => {
    return Object.entries(conversations)
      .map(([key, msgs]) => {
        const i = key.indexOf('|');
        return {
          myAccount: key.slice(0, i),
          partner: key.slice(i + 1),
          last: msgs[msgs.length - 1],
        };
      })
      .sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
  }, [conversations]);

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
            Back up / move your messaging identities
          </button>
        )}

        {partners.length > 0 && (
          <button onClick={() => setNewMsgOpen(true)} className="btn-primary w-full">
            <PenSquare size={16} strokeWidth={2} />
            New message
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
                history only on this device. Go online, add a contact, then start a
                conversation.
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <ThreadRow
                key={`${r.myAccount}|${r.partner}`}
                myAccount={r.myAccount}
                partner={r.partner}
                lastText={
                  r.last ? `${r.last.direction === 'out' ? 'You: ' : ''}${r.last.text}` : null
                }
                onDelete={() => setDeleteTarget({ myAccount: r.myAccount, partner: r.partner })}
              />
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
      <NewMessageSheet open={newMsgOpen} onClose={() => setNewMsgOpen(false)} partners={partners} />
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
              This removes this conversation's history from this device. cMix keeps no
              server copy, so it's gone here. Your contact stays — you can start a new
              conversation with them anytime.
            </p>
          </div>

          {deleteTarget && (
            <div className="space-y-1.5 px-1">
              <div className="flex items-center gap-2">
                <AddressIcon address={deleteTarget.partner} size={28} />
                <AddressLabel address={deleteTarget.partner} className="text-sm" />
              </div>
              <p className="text-xs text-ink-300">
                messaged as <AsName account={deleteTarget.myAccount} />
              </p>
            </div>
          )}

          <button
            onClick={() => {
              if (deleteTarget) {
                clearConversation(deleteTarget.myAccount, deleteTarget.partner);
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

/** One thread row: the partner you're talking to, plus which of your accounts
 *  you're reaching them as (so two threads with the same partner are distinct). */
function ThreadRow({
  myAccount,
  partner,
  lastText,
  onDelete,
}: {
  myAccount: string;
  partner: string;
  lastText: string | null;
  onDelete: () => void;
}) {
  const { name, fragment } = useAddressName(myAccount);
  const asLabel = name ?? fragment;
  return (
    <li className="flex items-center gap-1">
      <Link
        to={`/memos/${myAccount}/${partner}`}
        className="flex-1 min-w-0 flex items-center gap-3 p-3 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700"
      >
        <AddressIcon address={partner} size={36} />
        <div className="flex-1 min-w-0">
          <AddressLabel address={partner} className="text-sm" />
          <p className="text-xs text-ink-300 truncate">
            <span className="font-medium">as {asLabel}</span>
            {lastText ? ` · ${lastText}` : ''}
          </p>
        </div>
        <ChevronRight size={16} className="text-ink-300 flex-shrink-0" />
      </Link>
      <button
        onClick={onDelete}
        className="p-2.5 text-ink-300 active:text-danger flex-shrink-0"
        aria-label="Delete conversation"
      >
        <Trash2 size={16} strokeWidth={2} />
      </button>
    </li>
  );
}

/** Small inline resolver for "messaged as [name]" in the delete sheet. */
function AsName({ account }: { account: string }) {
  const { name, fragment } = useAddressName(account);
  return <span className="text-ink-200">{name ?? fragment}</span>;
}

/**
 * Start a new thread: pick WHO to message, then which of YOUR accounts to message
 * them AS. The account you pick fixes the thread's identity — a separate,
 * unlinkable one per account — so reaching the same person as a different account
 * is a different conversation. Share that account's contact with them so their
 * device can reach it.
 */
function NewMessageSheet({
  open,
  onClose,
  partners,
}: {
  open: boolean;
  onClose: () => void;
  partners: string[];
}) {
  const navigate = useNavigate();
  const accounts = useAccountsStore((s) => s.accounts);
  const myAccounts = useMemo(() => accounts.filter(isLocalAccount), [accounts]);
  const [pickedPartner, setPickedPartner] = useState<string | null>(null);

  const close = () => {
    setPickedPartner(null);
    onClose();
  };

  const start = (myAccount: string, partner: string) => {
    useCmixSecretStore.getState().addIdentityAccount(myAccount);
    close();
    navigate(`/memos/${myAccount}/${partner}`);
  };

  return (
    <Sheet open={open} onClose={close} title={pickedPartner ? 'Message as' : 'New message'}>
      {!pickedPartner ? (
        <div className="space-y-3">
          <p className="text-xs text-ink-300 leading-relaxed">
            Who do you want to message? You can reach anyone whose contact is on this device.
          </p>
          <ul className="space-y-1.5">
            {partners.map((p) => (
              <li key={p}>
                <button
                  onClick={() => setPickedPartner(p)}
                  className="w-full flex items-center gap-2.5 p-2.5 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700"
                >
                  <AddressIcon address={p} size={28} />
                  <AddressLabel address={p} className="text-sm flex-1 min-w-0 text-left" />
                  <ChevronRight size={16} className="text-ink-300 flex-shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            onClick={() => setPickedPartner(null)}
            className="inline-flex items-center gap-1 text-xs font-medium text-xx-500 active:text-xx-400"
          >
            <ChevronLeft size={14} strokeWidth={2.75} />
            Back
          </button>

          <div className="flex items-center gap-2.5 p-2.5 rounded-2xl bg-ink-800 border border-ink-700/50">
            <AddressIcon address={pickedPartner} size={28} />
            <AddressLabel address={pickedPartner} className="text-sm min-w-0" />
          </div>

          <p className="text-xs text-ink-300 leading-relaxed">
            Reach them as which of your accounts? Each is a separate, unlinkable identity —
            they'll see and reply to the one you pick. Share that account's contact with them
            so they can reach it.
          </p>

          <ul className="space-y-1.5">
            {myAccounts.map((a) => (
              <li key={a.address}>
                <button
                  onClick={() => start(a.address, pickedPartner)}
                  className="w-full flex items-center gap-2.5 p-2.5 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700"
                >
                  <AddressIcon address={a.address} size={28} />
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm text-ink-100 truncate">{a.name}</p>
                    <p className="font-mono text-xs text-ink-300 truncate">{a.address}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}
