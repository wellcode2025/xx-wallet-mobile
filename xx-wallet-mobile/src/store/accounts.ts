/**
 * Accounts store.
 *
 * Holds the list of locally-stored accounts and which one is currently active.
 * The active account is what shows up on the Dashboard/Send/Receive screens.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { xxKeyring, type StoredAccount } from '../keyring';

interface AccountsState {
  accounts: StoredAccount[];
  activeAddress: string | null;

  /** Call after keyring.init() to load persisted accounts. */
  refresh(): void;
  setActive(address: string): void;
  remove(address: string): void;
  rename(address: string, name: string): void;
}

// Only persist the active-address selection — accounts themselves live in
// localStorage via the keyring, which is the source of truth.
export const useAccountsStore = create<AccountsState>()(
  persist(
    (set, get) => ({
      accounts: [],
      activeAddress: null,

      refresh() {
        const accounts = xxKeyring.listAccounts();
        const { activeAddress } = get();
        // Pick the first account as active if nothing is selected or the
        // selected one no longer exists.
        const stillExists = accounts.some((a) => a.address === activeAddress);
        const nextActive = stillExists
          ? activeAddress
          : accounts[0]?.address ?? null;
        set({ accounts, activeAddress: nextActive });
      },

      setActive(address: string) {
        const { accounts } = get();
        if (accounts.some((a) => a.address === address)) {
          set({ activeAddress: address });
        }
      },

      remove(address: string) {
        xxKeyring.removeAccount(address);
        get().refresh();
      },

      rename(address: string, name: string) {
        xxKeyring.renameAccount(address, name);
        get().refresh();
      },
    }),
    {
      name: 'xx-wallet:active-account',
      partialize: (state) => ({ activeAddress: state.activeAddress }),
    }
  )
);
