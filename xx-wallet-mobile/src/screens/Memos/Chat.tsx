/**
 * Chat — the 1:1 conversation view for the Memos tab.
 *
 * A conversation is a THREAD = (my account, partner account). Both come from the
 * route (`/memos/:myAccount/:partner`), so the identity you send from is FIXED
 * for the thread — it is never switched in-place (switching would merge two
 * genuinely different, unlinkable identities). To reach a partner as a different
 * account you start a new thread from the Memos landing.
 *
 * History comes from the local conversation store (cMix keeps nothing
 * server-side). Sending fans the memo out to every device (cMix contact) of the
 * partner ACCOUNT and marks it delivered if any device confirms a receipt; an
 * undelivered send can be retried. Sending needs messaging online; reading
 * history does not.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Send, Loader2, Check, CheckCheck, AlertTriangle, Share2, Link2 } from 'lucide-react';
import { TopBar } from '@/components/layout';
import { AddressIcon, AddressLabel } from '@/components/ui';
import { ShareMyContactSheet } from './Contacts';
import { useAccountsStore } from '@/store';
import { isLocalAccount } from '@/keyring/store';
import { useCmixOnlineStore } from '@/store/cmixOnline';
import { useCmixContactsStore } from '@/store/cmixContacts';
import { useCmixChatStore, threadKey, type ChatMessage } from '@/store/cmixChat';
import { useCmixSecretStore } from '@/store/cmixSecret';
import { deserializeRegistry } from '@/cmix/registrySerde';
import { contactsForAccount } from '@/cmix/contactRegistry';
import { getIDFromContact } from '@/cmix/e2eApi';
import { newChatMemo } from '@/cmix/chatMessage';
import { sendMemoTo } from '@/cmix/messaging';
import { formatMessageTime } from './messageTime';
import { useAddressName } from '@/hooks/useAddressName';
import { isValidXxAddress } from '@/utils';

/** Stable empty array so the store selector doesn't return a fresh ref each render. */
const NO_MESSAGES: ChatMessage[] = [];

export function Chat() {
  const { myAccount, partner } = useParams<{ myAccount: string; partner: string }>();
  // The thread's sender must be a real local account of mine (its identity is
  // what signs + sends); a stale or hand-typed route falls back to the landing.
  const isMine = useAccountsStore((s) =>
    s.accounts.some((a) => a.address === myAccount && isLocalAccount(a))
  );
  if (
    !myAccount ||
    !isValidXxAddress(myAccount) ||
    !partner ||
    !isValidXxAddress(partner) ||
    !isMine
  ) {
    return <Navigate to="/memos" replace />;
  }
  return <ChatView myAccount={myAccount} partner={partner} />;
}

function ChatView({ myAccount, partner }: { myAccount: string; partner: string }) {
  const status = useCmixOnlineStore((s) => s.status);
  const handle = useCmixOnlineStore((s) => s.handle);
  const bindings = useCmixContactsStore((s) => s.bindings);
  const conv = useCmixChatStore((s) => s.conversations[threadKey(myAccount, partner)]);
  const messages = conv ?? NO_MESSAGES;
  const append = useCmixChatStore((s) => s.append);
  const markSent = useCmixChatStore((s) => s.markSent);
  // Resolve the partner's name for the screen title (matches the body label) so
  // it doesn't read as a stray raw address.
  const { name: partnerName, fragment: partnerFragment } = useAddressName(partner);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState<Set<string>>(new Set());
  const online = status === 'online';

  // Whether the partner's contact is on this device (else we can't fan out).
  const hasContact = useMemo(
    () => contactsForAccount(deserializeRegistry(bindings), partner).length > 0,
    [bindings, partner]
  );

  // The partner's primary contact (their first device) — used to watch/open the
  // authenticated channel. Messaging is TWO-WAY: a channel only exists once you
  // both have each other's contact, so we gate sending on it.
  const partnerContact = useMemo(() => {
    const cs = contactsForAccount(deserializeRegistry(bindings), partner);
    return cs[0] ?? null;
  }, [bindings, partner]);

  const [connState, setConnState] = useState<'checking' | 'connected' | 'disconnected'>(
    'checking'
  );
  const [connecting, setConnecting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Watch the channel while online + we have their contact. Poll while it's not
  // up so the compose unlocks the moment the partner adds your contact + the
  // handshake round-trips (from either side).
  useEffect(() => {
    if (!online || !handle || !partnerContact) {
      setConnState('checking');
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const am = await handle.forAccount(myAccount);
        const ok = await am.isConnected(getIDFromContact(partnerContact));
        if (cancelled) return;
        setConnState(ok ? 'connected' : 'disconnected');
        if (!ok) timer = setTimeout(check, 4000);
      } catch {
        if (!cancelled) setConnState('disconnected');
      }
    };
    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [online, handle, partnerContact, myAccount]);

  // Explicit connect: fire the auth-channel request and wait for the partner's
  // auto-confirm to round-trip. Sending would do this lazily too, but we block
  // sending until connected, so this is the user's way to open the channel.
  const connect = async () => {
    if (!handle || !partnerContact || connecting) return;
    setConnecting(true);
    try {
      const am = await handle.forAccount(myAccount);
      const id = getIDFromContact(partnerContact);
      if (!(await am.isConnected(id))) {
        await am.connectToPartner(partnerContact);
        for (let i = 0; i < 8 && !(await am.isConnected(id)); i++) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      setConnState((await am.isConnected(id)) ? 'connected' : 'disconnected');
    } catch {
      setConnState('disconnected');
    } finally {
      setConnecting(false);
    }
  };

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const setSendingFlag = (id: string, on: boolean) =>
    setSending((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // Fan a memo out to all of the partner's devices. The round-result only tells
  // us it entered the mixnet ("sent") — the recipient's ACK is what flips it to
  // "delivered" (handled in useCmixChatReceive). Leaving it un-sent (no handle,
  // no contact, send error) makes the bubble offer Retry once the spinner clears.
  const deliver = async (id: string, text: string, sentAt: number) => {
    if (!handle) return;
    const contacts = contactsForAccount(deserializeRegistry(bindings), partner);
    if (contacts.length === 0) return;
    setSendingFlag(id, true);
    try {
      // Register the sender as a messaging identity (so its inbox is listened on
      // for replies), then send from THAT account's identity — the partner sees
      // + replies to the identity they added under this thread.
      useCmixSecretStore.getState().addIdentityAccount(myAccount);
      const am = await handle.forAccount(myAccount);
      const targets = contacts.map((c) => ({ contact: c, id: getIDFromContact(c) }));
      const results = await Promise.all(
        targets.map((t) => sendMemoTo(am, t, { kind: 'chat.memo', v: 1, id, text, sentAt }))
      );
      if (results.some((r) => r.delivered)) markSent(myAccount, partner, id);
    } catch {
      /* leave un-sent → Retry */
    } finally {
      setSendingFlag(id, false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !online || !handle || !hasContact) return;
    const memo = newChatMemo(text);
    append(myAccount, partner, {
      id: memo.id,
      direction: 'out',
      text,
      sentAt: memo.sentAt,
      at: Date.now(),
    });
    setDraft('');
    await deliver(memo.id, memo.text, memo.sentAt);
  };

  return (
    <>
      <TopBar title={partnerName ?? partnerFragment} showBack />
      <div className="flex flex-col h-[calc(100dvh-3.5rem)] max-w-md mx-auto">
        {/* Header: who you're talking TO, and which of YOUR accounts you're
            messaging AS — both fixed for this thread (a static label, not a
            switch: changing sender means starting a new thread). */}
        <div className="px-4 py-3 border-b border-ink-800 flex-shrink-0 space-y-2">
          <div className="flex items-center gap-2.5">
            <AddressIcon address={partner} size={34} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wider text-ink-300">
                Conversation with
              </p>
              <AddressLabel address={partner} className="text-sm" />
            </div>
          </div>

          <div className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-ink-800 border border-ink-700/70">
            <span className="text-xs font-medium uppercase tracking-wider text-ink-300 flex-shrink-0">
              Messaging as
            </span>
            <AddressLabel address={myAccount} className="text-sm truncate" />
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
          {messages.length === 0 ? (
            <p className="text-xs text-ink-300 text-center py-8">
              No messages yet. Anything you send is end-to-end encrypted over the
              mixnet and kept only on your devices.
            </p>
          ) : (
            messages.map((m) => (
              <Bubble
                key={m.id}
                message={m}
                sending={sending.has(m.id)}
                onRetry={() => deliver(m.id, m.text, m.sentAt)}
              />
            ))
          )}
          <div ref={endRef} />
        </div>

        {/* Compose */}
        <div
          className="px-3 pt-2 border-t border-ink-800 flex-shrink-0"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 68px)' }}
        >
          {!online ? (
            <p className="text-xs text-ink-300 leading-snug px-1 py-1.5">
              Go online from the Memos tab to send.
            </p>
          ) : !hasContact ? (
            <p className="text-xs text-ink-300 leading-snug px-1 py-1.5">
              You don't have this contact on this device, so you can't message them
              here.
            </p>
          ) : connState === 'checking' ? (
            <div className="flex items-center gap-2 text-xs text-ink-300 px-1 py-2">
              <Loader2 size={13} className="animate-spin flex-shrink-0" strokeWidth={2} />
              Checking connection…
            </div>
          ) : connState === 'disconnected' ? (
            <div className="space-y-2 py-1">
              <div className="flex items-start gap-2 p-3 rounded-2xl bg-warning/10 border border-warning/30">
                <AlertTriangle
                  size={14}
                  className="text-warning flex-shrink-0 mt-0.5"
                  strokeWidth={2}
                />
                <p className="text-xs text-ink-200 leading-relaxed">
                  You're not connected with this contact yet. Messaging is two-way — you
                  both have to add each other's contact. You have theirs; make sure
                  they've added yours, then connect.
                </p>
              </div>
              <button onClick={() => setShareOpen(true)} className="btn-secondary w-full">
                <Share2 size={15} strokeWidth={2} />
                Share my contact
              </button>
              <button
                onClick={() => void connect()}
                disabled={connecting}
                className="btn-primary w-full"
              >
                {connecting ? (
                  <Loader2 size={16} className="animate-spin" strokeWidth={2} />
                ) : (
                  <Link2 size={16} strokeWidth={2} />
                )}
                {connecting ? 'Connecting…' : 'Connect'}
              </button>
              <p className="text-xs text-ink-300 leading-snug px-1">
                Opens as soon as they've added your contact and the channel forms.
              </p>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="Message"
                className="input-base flex-1 resize-none min-h-[40px] max-h-28 py-2 text-sm"
              />
              <button
                onClick={() => void send()}
                disabled={!draft.trim()}
                className="btn-primary flex-shrink-0 h-10 w-10 p-0 rounded-full"
                aria-label="Send"
              >
                <Send size={16} strokeWidth={2} />
              </button>
            </div>
          )}
        </div>
      </div>

      <ShareMyContactSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        fixedAccount={myAccount}
      />
    </>
  );
}

function Bubble({
  message,
  sending,
  onRetry,
}: {
  message: ChatMessage;
  sending: boolean;
  onRetry: () => void;
}) {
  const out = message.direction === 'out';
  return (
    <div className={clsx('flex', out ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[80%] rounded-2xl px-3 py-2',
          out ? 'bg-xx-500/15 border border-xx-500/30' : 'bg-ink-800 border border-ink-700/50'
        )}
      >
        <p className="text-sm text-ink-100 whitespace-pre-wrap break-words">{message.text}</p>
        {/* Meta row: when it was sent (sender's clock, rendered in device-local
            time — epoch ms is timezone-free), plus delivery state on outgoing. */}
        <div
          className={clsx('flex items-center gap-1.5 mt-0.5', out ? 'justify-end' : 'justify-start')}
        >
          <span className="text-xs text-ink-300">{formatMessageTime(message.sentAt)}</span>
          {out &&
            (message.delivered ? (
              <CheckCheck size={12} className="text-xx-500" strokeWidth={2.5} aria-label="Delivered" />
            ) : sending ? (
              <Loader2 size={11} className="text-ink-300 animate-spin" strokeWidth={2} />
            ) : message.sent ? (
              <Check size={11} className="text-ink-300" strokeWidth={2} aria-label="Sent" />
            ) : (
              <button
                onClick={onRetry}
                className="inline-flex items-center gap-1 text-xs text-danger active:text-danger/80"
              >
                <AlertTriangle size={11} strokeWidth={2} /> Retry
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
