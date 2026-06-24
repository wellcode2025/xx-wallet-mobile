/**
 * cMix "go online" state.
 *
 * Bringing messaging online is an explicit, opt-in action (default OFF): the
 * user picks an account and enters its password, which we use to obtain the
 * device cMix secret (establish on first use, else unwrap) and then connect the
 * cMix + e2e session. Status drives the UI ("connecting to the mixnet…").
 *
 * Multi-account note: every enabled account wraps the SAME device secret, so it
 * doesn't matter which account brings messaging online — the resulting session
 * (a process-wide singleton) is identical. Going online with a second enabled
 * account just unlocks the same secret.
 *
 * Teardown: a fresh app session starts offline, and the cMix follower stops when
 * the page unloads. An in-app "go offline" that stops the follower mid-session
 * is a deliberate later refinement; `reset()` here only clears local UI state
 * (e.g. to retry after an error) and does NOT claim to leave the mixnet.
 */
import { create } from 'zustand';
import { xxKeyring } from '@/keyring/store';
import { connectMessaging, type MessagingHandle } from '@/cmix/messaging';
import { planSecretAction } from '@/cmix/secretPlan';
import { getIDFromContact, type AuthCallbacks } from '@/cmix/e2eApi';
import { wrapWithDeviceKey, unwrapWithDeviceKey, clearDeviceKey } from '@/cmix/deviceKey';
import type { ConnectPhase } from '@/cmix/phases';
import { useCmixSecretStore } from './cmixSecret';
import { useCmixContactsStore } from './cmixContacts';

/**
 * Bring-up diagnostic: when an inbound channel request does NOT match a known
 * cosigner, log byte heads of the incoming contact vs the stored ones. Lets us
 * tell a facts/serialization delta (heads equal, lengths differ) from a genuinely
 * unknown contact or an empty registry — without a slow live re-run. Flip off
 * (or delete this + its use below) once two-device auto-confirm is verified.
 */
const DEBUG_AUTOCONFIRM = true;
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
   * Bring messaging online using an account + its password. Establishes the
   * device secret on first use (verifying the password is genuinely the
   * account's), otherwise unwraps it. Throws (and sets status 'error') if the
   * account isn't enabled yet or the password is wrong.
   */
  goOnline(account: string, password: string, authCallbacks?: Partial<AuthCallbacks>): Promise<void>;

  /**
   * Bring messaging online WITHOUT a password, using the device-key-wrapped
   * secret saved by "stay enabled on this device". Throws if stay-enabled isn't
   * set up (or the device key is gone) — callers fall back to the password flow.
   */
  goOnlineWithDeviceKey(): Promise<void>;

  /**
   * Turn ON "stay enabled on this device": wrap the in-hand device secret under
   * the device-bound key so future sessions can go online without the password.
   * Requires being online (the secret must be in hand).
   */
  enableStayOnline(): Promise<void>;

  /** Turn OFF "stay enabled": forget the device-wrapped secret + device key. */
  disableStayOnline(): Promise<void>;

  /**
   * Enroll ANOTHER local account for messaging while online: wrap the in-hand
   * device secret under that account's password so it can also bring messaging
   * online. Verifies the password is genuinely the account's (so a typo can't
   * lock the account out of its own messaging). No-op if already enrolled.
   * Throws if offline or the password is wrong.
   */
  enableAccount(account: string, password: string): Promise<void>;

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

  async goOnline(account, password, authCallbacks) {
    const { status } = get();
    if (status === 'connecting' || status === 'online') return;
    set({ status: 'connecting', error: null, phase: 'loading' });
    try {
      const secrets = useCmixSecretStore.getState();
      const action = planSecretAction(secrets.hasSecret(), secrets.isEnabledFor(account));

      let secret: Uint8Array;
      if (action === 'establish') {
        // First-ever: confirm the password really is this account's, so the
        // messaging secret is tied to the account password (not a typo that
        // would lock the user out of their own messaging later).
        const ok = await xxKeyring.verifyPassword(account, password);
        if (!ok) throw new Error('Incorrect password for this account.');
        secret = await secrets.establish(account, password);
      } else if (action === 'unlock') {
        // unwrapSecret throws on a wrong password, so this doubles as the check.
        secret = await secrets.unlock(account, password);
      } else {
        throw new Error(
          'This account is not enabled for messaging yet. Go online with an enabled account, then add this one.'
        );
      }

      const handle = await connectMessaging({
        session: { storagePassword: secret },
        authCallbacks,
        autoConfirm: makeAutoConfirm(),
        onPhase: (phase) => set({ phase }),
      });
      set({ status: 'online', handle, error: null, phase: null, secret });
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
        autoConfirm: makeAutoConfirm(),
        onPhase: (phase) => set({ phase }),
      });
      set({ status: 'online', handle, error: null, phase: null, secret });
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

  async enableAccount(account, password) {
    const { status, secret } = get();
    if (status !== 'online' || !secret) {
      throw new Error('Bring messaging online first, then enable another account.');
    }
    const secrets = useCmixSecretStore.getState();
    if (secrets.isEnabledFor(account)) return; // already enrolled — no-op
    // Verify the password is genuinely this account's, so we never wrap the
    // secret under a typo (which would lock that account out of messaging).
    const ok = await xxKeyring.verifyPassword(account, password);
    if (!ok) throw new Error('Incorrect password for this account.');
    await secrets.addAccount(account, password, secret);
  },

  reset() {
    set({ status: 'offline', error: null, handle: null, phase: null, secret: null });
  },
}));
