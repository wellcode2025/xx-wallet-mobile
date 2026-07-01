/**
 * cMix "go online" state.
 *
 * Bringing messaging online is an explicit, opt-in action (default OFF): the
 * user enters their dedicated MESSAGING PASSPHRASE (separate from any wallet
 * account password), which we use to obtain the device cMix secret (establish on
 * first use, else unwrap) and then connect the cMix + e2e session. Status drives
 * the UI ("connecting to the mixnet…").
 *
 * The messaging identity is one-per-device and decoupled from wallet accounts:
 * the passphrase protects it, and it can be exported + restored onto another
 * device (see identityExport). Account-signed contact bindings still prove which
 * account a contact belongs to — that's orthogonal to going online.
 *
 * Teardown: a fresh app session starts offline, and the cMix follower stops when
 * the page unloads. An in-app "go offline" that stops the follower mid-session
 * is a deliberate later refinement; `reset()` here only clears local UI state
 * (e.g. to retry after an error) and does NOT claim to leave the mixnet.
 */
import { create } from 'zustand';
import { connectMessaging, type MessagingHandle } from '@/cmix/messaging';
import { planSecretAction } from '@/cmix/secretPlan';
import { getIDFromContact, type AuthCallbacks } from '@/cmix/e2eApi';
import { wrapWithDeviceKey, unwrapWithDeviceKey, clearDeviceKey } from '@/cmix/deviceKey';
import type { ConnectPhase } from '@/cmix/phases';
import { useCmixSecretStore } from './cmixSecret';
import { useCmixContactsStore } from './cmixContacts';
import { useAccountsStore } from './accounts';

/**
 * The account whose identity is logged in eagerly + backs the convenience
 * messaging methods — the active account, or the first if none is active.
 * Per-account messaging means every session needs at least one account.
 */
function primaryMessagingAccount(): string {
  const { activeAddress, accounts } = useAccountsStore.getState();
  const primary = activeAddress ?? accounts[0]?.address;
  if (!primary) throw new Error('Add an account before going online for messaging.');
  return primary;
}

/**
 * Bring-up diagnostic: when an inbound channel request does NOT match a known
 * cosigner, log byte heads of the incoming contact vs the stored ones. Lets us
 * tell a facts/serialization delta (heads equal, lengths differ) from a genuinely
 * unknown contact or an empty registry — without a slow live re-run. Flip off
 * (or delete this + its use below) once two-device auto-confirm is verified.
 */
const DEBUG_AUTOCONFIRM = false;
const byteHead = (b: Uint8Array, n = 12): string =>
  Array.from(b.slice(0, n), (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Compare two marshalled contacts by canonical cMix identity (reception ID),
 * which is invariant across marshalled forms — an inbound channel request
 * carries an ownership proof that GetContact() does not, so raw bytes differ for
 * the same identity (verified live: 651 B request vs 611 B GetContact()). Fails
 * CLOSED: if an ID can't be extracted we return false, so we never auto-confirm
 * a request we can't positively identify.
 */
const sameCmixIdentity = (a: Uint8Array, b: Uint8Array): boolean => {
  try {
    const ia = getIDFromContact(a);
    const ib = getIDFromContact(b);
    if (ia.length !== ib.length) return false;
    for (let i = 0; i < ia.length; i++) if (ia[i] !== ib[i]) return false;
    return true;
  } catch {
    return false;
  }
};

/**
 * Build the auto-confirm callback for connectMessaging: confirm an incoming
 * channel request iff its contact matches a known cosigner (by reception ID),
 * with a bring-up diagnostic on a non-match. Shared by both go-online paths
 * (password and device-key).
 */
function makeAutoConfirm(): (contact: Uint8Array) => boolean {
  return (contact) => {
    const contacts = useCmixContactsStore.getState();
    const known = contacts.isKnownContact(contact, sameCmixIdentity);
    if (DEBUG_AUTOCONFIRM && !known) {
      const stored = contacts
        .knownAccounts()
        .flatMap((a) => contacts.contactsForAccount(a));
      console.info('[cmix-auth] inbound channel request did NOT match a known cosigner', {
        incomingLen: contact.length,
        incomingHead: byteHead(contact),
        storedCount: stored.length,
        stored: stored.map((c) => ({ len: c.length, head: byteHead(c) })),
      });
    }
    return known;
  };
}

export type OnlineStatus = 'offline' | 'connecting' | 'online' | 'error';

interface CmixOnlineState {
  status: OnlineStatus;
  error: string | null;
  /** Current connect phase while status is 'connecting' (else null). Drives the
   *  go-online progress checklist. */
  phase: ConnectPhase | null;
  /** The connected messaging handle while online (null otherwise). */
  handle: MessagingHandle | null;
  /** The raw device secret while online (in-memory only — this store isn't
   *  persisted). Held so we can enroll another account without re-deriving it.
   *  Null when offline. */
  secret: Uint8Array | null;

  /**
   * Bring messaging online using the dedicated messaging passphrase. Establishes
   * the device secret on first use, otherwise unwraps it. Throws (and sets status
   * 'error') if the passphrase is wrong or shorter than the minimum.
   */
  goOnline(passphrase: string, authCallbacks?: Partial<AuthCallbacks>): Promise<void>;

  /**
   * Bring messaging online WITHOUT a password, using the device-key-wrapped
   * secret saved by "stay enabled on this device". Throws if stay-enabled isn't
   * set up (or the device key is gone) — callers fall back to the password flow.
   */
  goOnlineWithDeviceKey(): Promise<void>;

  /**
   * Restore backed-up messaging identities (already decrypted, one per account)
   * and bring messaging online: establish a fresh storage secret under the
   * passphrase, persist each identity, connect, and register every restored
   * account — so this device becomes the SAME messaging party as the backup's
   * origin for each account. Throws (status 'error') on a connect failure.
   */
  goOnlineWithImport(
    passphrase: string,
    entries: { account: string; identity: Uint8Array }[]
  ): Promise<void>;

  /**
   * Turn ON "stay enabled on this device": wrap the in-hand device secret under
   * the device-bound key so future sessions can go online without the password.
   * Requires being online (the secret must be in hand).
   */
  enableStayOnline(): Promise<void>;

  /** Turn OFF "stay enabled": forget the device-wrapped secret + device key. */
  disableStayOnline(): Promise<void>;

  /** Clear local online UI state (for retry after an error). Does NOT stop the
   *  mixnet follower — see the file header. */
  reset(): void;
}

export const useCmixOnlineStore = create<CmixOnlineState>((set, get) => ({
  status: 'offline',
  error: null,
  phase: null,
  handle: null,
  secret: null,

  async goOnline(passphrase, authCallbacks) {
    const { status } = get();
    if (status === 'connecting' || status === 'online') return;
    set({ status: 'connecting', error: null, phase: 'loading' });
    try {
      const secrets = useCmixSecretStore.getState();
      const action = planSecretAction(secrets.hasSecret());

      // establish (first-ever) mints + wraps a fresh secret under the passphrase;
      // unlock unwraps it (and throws on a wrong passphrase, so it doubles as the
      // check). No account is involved — the passphrase is the only gate.
      const secret =
        action === 'establish'
          ? await secrets.establish(passphrase)
          : await secrets.unlock(passphrase);

      const handle = await connectMessaging({
        session: { storagePassword: secret },
        primaryAccount: primaryMessagingAccount(),
        authCallbacks,
        autoConfirm: makeAutoConfirm(),
        onPhase: (phase) => set({ phase }),
      });
      set({ status: 'online', handle, error: null, phase: null, secret });
      useCmixSecretStore.getState().addIdentityAccount(primaryMessagingAccount());
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        handle: null,
        phase: null,
        secret: null,
      });
      throw err;
    }
  },

  async goOnlineWithDeviceKey() {
    const { status } = get();
    if (status === 'connecting' || status === 'online') return;
    const blob = useCmixSecretStore.getState().deviceWrap;
    if (!blob) throw new Error('Stay-enabled is not set up on this device.');
    set({ status: 'connecting', error: null, phase: 'loading' });
    try {
      const secret = await unwrapWithDeviceKey(blob);
      const handle = await connectMessaging({
        session: { storagePassword: secret },
        primaryAccount: primaryMessagingAccount(),
        autoConfirm: makeAutoConfirm(),
        onPhase: (phase) => set({ phase }),
      });
      set({ status: 'online', handle, error: null, phase: null, secret });
      useCmixSecretStore.getState().addIdentityAccount(primaryMessagingAccount());
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        handle: null,
        phase: null,
        secret: null,
      });
      throw err;
    }
  },

  async goOnlineWithImport(passphrase, entries) {
    const { status } = get();
    if (status === 'connecting' || status === 'online') return;
    if (entries.length === 0) throw new Error('Backup contained no identities.');
    set({ status: 'connecting', error: null, phase: 'loading' });
    try {
      const secrets = useCmixSecretStore.getState();
      // Fresh device → mint a local storage secret; already-set-up device →
      // unlock the existing one (the imported identities overwrite stored ones).
      const secret = secrets.hasSecret()
        ? await secrets.unlock(passphrase)
        : await secrets.establish(passphrase);
      const handle = await connectMessaging({
        session: { storagePassword: secret },
        // Primary = the first restored account (the backup carries its own).
        primaryAccount: entries[0].account,
        importIdentities: entries,
        autoConfirm: makeAutoConfirm(),
        onPhase: (phase) => set({ phase }),
      });
      set({ status: 'online', handle, error: null, phase: null, secret });
      // Register every restored account so the receive hooks listen on all of them.
      for (const e of entries) secrets.addIdentityAccount(e.account);
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        handle: null,
        phase: null,
        secret: null,
      });
      throw err;
    }
  },

  async enableStayOnline() {
    const { status, secret } = get();
    if (status !== 'online' || !secret) {
      throw new Error('Bring messaging online first, then turn on stay-enabled.');
    }
    const blob = await wrapWithDeviceKey(secret);
    useCmixSecretStore.getState().setDeviceWrap(blob);
  },

  async disableStayOnline() {
    useCmixSecretStore.getState().setDeviceWrap(null);
    try {
      await clearDeviceKey();
    } catch {
      /* best effort — the wrap is already forgotten, which is what matters */
    }
  },

  reset() {
    set({ status: 'offline', error: null, handle: null, phase: null, secret: null });
  },
}));
