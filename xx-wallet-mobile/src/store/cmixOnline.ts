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
import type { AuthCallbacks } from '@/cmix/e2eApi';
import { useCmixSecretStore } from './cmixSecret';

export type OnlineStatus = 'offline' | 'connecting' | 'online' | 'error';

interface CmixOnlineState {
  status: OnlineStatus;
  error: string | null;
  /** The connected messaging handle while online (null otherwise). */
  handle: MessagingHandle | null;

  /**
   * Bring messaging online using an account + its password. Establishes the
   * device secret on first use (verifying the password is genuinely the
   * account's), otherwise unwraps it. Throws (and sets status 'error') if the
   * account isn't enabled yet or the password is wrong.
   */
  goOnline(account: string, password: string, authCallbacks?: Partial<AuthCallbacks>): Promise<void>;

  /** Clear local online UI state (for retry after an error). Does NOT stop the
   *  mixnet follower — see the file header. */
  reset(): void;
}

export const useCmixOnlineStore = create<CmixOnlineState>((set, get) => ({
  status: 'offline',
  error: null,
  handle: null,

  async goOnline(account, password, authCallbacks) {
    const { status } = get();
    if (status === 'connecting' || status === 'online') return;
    set({ status: 'connecting', error: null });
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
      });
      set({ status: 'online', handle, error: null });
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        handle: null,
      });
      throw err;
    }
  },

  reset() {
    set({ status: 'offline', error: null, handle: null });
  },
}));
